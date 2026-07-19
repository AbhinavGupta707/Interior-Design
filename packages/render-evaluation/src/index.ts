import { createHash } from "node:crypto";

import type { RenderArtifact } from "@interior-design/contracts";
import sharp from "sharp";

import { inspectExrHeader, inspectPngHeader } from "./browser.js";
import type { ExrHeaderInspection, PngHeaderInspection } from "./browser.js";

export * from "./browser.js";

export const renderEvaluationPackageVersion = "1.0.0" as const;

export interface EvaluationLimits {
  readonly maximumBytes: number;
  readonly maximumChannels: number;
  readonly maximumHeaderBytes: number;
  readonly maximumPixels: number;
}

export const defaultEvaluationLimits: EvaluationLimits = Object.freeze({
  maximumBytes: 64 * 1024 * 1024,
  maximumChannels: 128,
  maximumHeaderBytes: 1024 * 1024,
  maximumPixels: 16_777_216,
});

export class RenderEvaluationError extends Error {
  constructor(
    readonly code:
      | "BYTE_LENGTH_MISMATCH"
      | "DECODE_FAILED"
      | "DIMENSION_MISMATCH"
      | "HASH_MISMATCH"
      | "INVALID_EXR"
      | "INVALID_PNG"
      | "MEDIA_TYPE_MISMATCH"
      | "RESOURCE_LIMIT_EXCEEDED"
      | "ROLE_MISMATCH",
    message: string,
  ) {
    super(message);
    this.name = "RenderEvaluationError";
  }
}

export interface ArtifactInspection {
  readonly byteLength: number;
  readonly format: "exr" | "png";
  readonly heightPx: number;
  readonly metadata: ExrHeaderInspection | PngHeaderInspection;
  readonly role: RenderArtifact["role"];
  readonly sha256: string;
  readonly validationScope:
    "container-header-only-no-pixel-validation" | "sharp-decoded-pixels-and-container";
  readonly widthPx: number;
}

function mergedLimits(limits: Partial<EvaluationLimits> | undefined): EvaluationLimits {
  return { ...defaultEvaluationLimits, ...limits };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertBounded(bytes: Uint8Array, limits: EvaluationLimits): void {
  if (bytes.byteLength === 0 || bytes.byteLength > limits.maximumBytes) {
    throw new RenderEvaluationError(
      "RESOURCE_LIMIT_EXCEEDED",
      "Artifact bytes are empty or exceed the independent evaluator byte budget.",
    );
  }
}

function assertExpected(bytes: Uint8Array, artifact: RenderArtifact): string {
  if (artifact.byteLength !== bytes.byteLength) {
    throw new RenderEvaluationError(
      "BYTE_LENGTH_MISMATCH",
      "Artifact bytes do not match the immutable byte-length declaration.",
    );
  }
  const digest = sha256(bytes);
  if (digest !== artifact.sha256) {
    throw new RenderEvaluationError(
      "HASH_MISMATCH",
      "Artifact bytes do not match the immutable SHA-256 declaration.",
    );
  }
  const expectedMediaType = artifact.role.endsWith("-png") ? "image/png" : "image/x-exr";
  if (artifact.mediaType !== expectedMediaType) {
    throw new RenderEvaluationError(
      "MEDIA_TYPE_MISMATCH",
      "Artifact role and immutable media type disagree.",
    );
  }
  return digest;
}

export async function inspectRenderArtifact(
  bytes: Uint8Array,
  artifact: RenderArtifact,
  options: { readonly limits?: Partial<EvaluationLimits> } = {},
): Promise<ArtifactInspection> {
  const limits = mergedLimits(options.limits);
  assertBounded(bytes, limits);
  const digest = assertExpected(bytes, artifact);

  if (artifact.role.endsWith("-png")) {
    let header: PngHeaderInspection;
    try {
      header = inspectPngHeader(bytes, { maximumPixels: limits.maximumPixels });
    } catch (error) {
      throw new RenderEvaluationError(
        "INVALID_PNG",
        error instanceof Error ? error.message : "PNG header inspection failed.",
      );
    }
    if (header.widthPx !== artifact.widthPx || header.heightPx !== artifact.heightPx) {
      throw new RenderEvaluationError(
        "DIMENSION_MISMATCH",
        "PNG header dimensions do not match the immutable artifact declaration.",
      );
    }
    try {
      const metadata = await sharp(bytes, {
        failOn: "warning",
        limitInputPixels: limits.maximumPixels,
        sequentialRead: true,
      }).metadata();
      if (
        metadata.format !== "png" ||
        metadata.width !== header.widthPx ||
        metadata.height !== header.heightPx
      ) {
        throw new Error("Sharp metadata does not match the PNG container header.");
      }
      await sharp(bytes, {
        failOn: "warning",
        limitInputPixels: limits.maximumPixels,
        sequentialRead: true,
      })
        .raw()
        .toBuffer();
    } catch {
      throw new RenderEvaluationError(
        "DECODE_FAILED",
        "Sharp could not safely decode the complete PNG pixel payload.",
      );
    }
    return {
      byteLength: bytes.byteLength,
      format: "png",
      heightPx: header.heightPx,
      metadata: header,
      role: artifact.role,
      sha256: digest,
      validationScope: "sharp-decoded-pixels-and-container",
      widthPx: header.widthPx,
    };
  }

  let header: ExrHeaderInspection;
  try {
    header = inspectExrHeader(bytes, {
      maximumChannels: limits.maximumChannels,
      maximumHeaderBytes: limits.maximumHeaderBytes,
      maximumPixels: limits.maximumPixels,
    });
  } catch (error) {
    throw new RenderEvaluationError(
      "INVALID_EXR",
      error instanceof Error ? error.message : "EXR header inspection failed.",
    );
  }
  if (header.widthPx !== artifact.widthPx || header.heightPx !== artifact.heightPx) {
    throw new RenderEvaluationError(
      "DIMENSION_MISMATCH",
      "EXR data-window dimensions do not match the immutable artifact declaration.",
    );
  }
  return {
    byteLength: bytes.byteLength,
    format: "exr",
    heightPx: header.heightPx,
    metadata: header,
    role: artifact.role,
    sha256: digest,
    validationScope: "container-header-only-no-pixel-validation",
    widthPx: header.widthPx,
  };
}

interface DecodedRgba {
  readonly data: Uint8Array;
  readonly height: number;
  readonly width: number;
}

function channelAt(data: Uint8Array, index: number): number {
  const value = data[index];
  if (value === undefined) {
    throw new RenderEvaluationError("DECODE_FAILED", "Decoded PNG channel data is truncated.");
  }
  return value;
}

async function decodeRgba(bytes: Uint8Array, limits: EvaluationLimits): Promise<DecodedRgba> {
  assertBounded(bytes, limits);
  let header: PngHeaderInspection;
  try {
    header = inspectPngHeader(bytes, { maximumPixels: limits.maximumPixels });
  } catch (error) {
    throw new RenderEvaluationError(
      "INVALID_PNG",
      error instanceof Error ? error.message : "PNG header inspection failed.",
    );
  }
  let result: Awaited<ReturnType<ReturnType<typeof sharp>["toBuffer"]>>;
  try {
    result = await sharp(bytes, {
      failOn: "warning",
      limitInputPixels: limits.maximumPixels,
      sequentialRead: true,
    })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new RenderEvaluationError(
      "DECODE_FAILED",
      "Sharp could not safely decode the complete PNG pixel payload.",
    );
  }
  if (
    result.info.channels !== 4 ||
    result.info.width !== header.widthPx ||
    result.info.height !== header.heightPx
  ) {
    throw new RenderEvaluationError("DECODE_FAILED", "Decoded PNG shape is inconsistent.");
  }
  return { data: result.data, height: result.info.height, width: result.info.width };
}

function colourAt(image: DecodedRgba, pixelIndex: number): string {
  const offset = pixelIndex * 4;
  return `${String(channelAt(image.data, offset))},${String(channelAt(image.data, offset + 1))},${String(channelAt(image.data, offset + 2))}`;
}

export interface SegmentationInspection {
  readonly backgroundPixels: number;
  readonly heightPx: number;
  readonly missingPaletteColours: readonly string[];
  readonly palettePixelCounts: Readonly<Record<string, number>>;
  readonly unexpectedColours: readonly string[];
  readonly widthPx: number;
}

export async function inspectSegmentationPng(
  bytes: Uint8Array,
  expectedPalette: readonly (readonly [number, number, number])[],
  options: { readonly limits?: Partial<EvaluationLimits> } = {},
): Promise<SegmentationInspection> {
  const limits = mergedLimits(options.limits);
  const image = await decodeRgba(bytes, limits);
  const allowed = new Set(expectedPalette.map((colour) => colour.join(",")));
  const counts = new Map<string, number>();
  const unexpected = new Set<string>();
  let backgroundPixels = 0;
  for (let pixel = 0; pixel < image.width * image.height; pixel += 1) {
    const offset = pixel * 4;
    const alpha = channelAt(image.data, offset + 3);
    const colour = colourAt(image, pixel);
    if (alpha === 0 || colour === "0,0,0") {
      backgroundPixels += 1;
      continue;
    }
    counts.set(colour, (counts.get(colour) ?? 0) + 1);
    if (!allowed.has(colour)) unexpected.add(colour);
  }
  return {
    backgroundPixels,
    heightPx: image.height,
    missingPaletteColours: [...allowed].filter((colour) => !counts.has(colour)).sort(),
    palettePixelCounts: Object.fromEntries(
      [...counts].sort(([left], [right]) => left.localeCompare(right)),
    ),
    unexpectedColours: [...unexpected].sort(),
    widthPx: image.width,
  };
}

function pixelsDiffer(
  left: DecodedRgba,
  right: DecodedRgba,
  pixel: number,
  tolerance: number,
): boolean {
  const offset = pixel * 4;
  return [0, 1, 2, 3].some(
    (channel) =>
      Math.abs(channelAt(left.data, offset + channel) - channelAt(right.data, offset + channel)) >
      tolerance,
  );
}

function luma(image: DecodedRgba, x: number, y: number): number {
  const offset = (y * image.width + x) * 4;
  return (
    channelAt(image.data, offset) * 0.2126 +
    channelAt(image.data, offset + 1) * 0.7152 +
    channelAt(image.data, offset + 2) * 0.0722
  );
}

function edgePixels(
  image: DecodedRgba,
  protectedPixels: Uint8Array,
  threshold: number,
): Set<number> {
  const edges = new Set<number>();
  for (let y = 1; y < image.height - 1; y += 1) {
    for (let x = 1; x < image.width - 1; x += 1) {
      const pixel = y * image.width + x;
      if (protectedPixels[pixel] !== 1) continue;
      const gx =
        -luma(image, x - 1, y - 1) +
        luma(image, x + 1, y - 1) -
        2 * luma(image, x - 1, y) +
        2 * luma(image, x + 1, y) -
        luma(image, x - 1, y + 1) +
        luma(image, x + 1, y + 1);
      const gy =
        -luma(image, x - 1, y - 1) -
        2 * luma(image, x, y - 1) -
        luma(image, x + 1, y - 1) +
        luma(image, x - 1, y + 1) +
        2 * luma(image, x, y + 1) +
        luma(image, x + 1, y + 1);
      if (Math.hypot(gx, gy) >= threshold) edges.add(pixel);
    }
  }
  return edges;
}

function setAgreementBasisPoints(left: ReadonlySet<number>, right: ReadonlySet<number>): number {
  if (left.size === 0 && right.size === 0) return 10_000;
  let intersection = 0;
  for (const item of left) if (right.has(item)) intersection += 1;
  const union = left.size + right.size - intersection;
  return Math.round((intersection / Math.max(1, union)) * 10_000);
}

function meanSegmentationIoU(left: DecodedRgba, right: DecodedRgba): number {
  const colours = new Set<string>();
  const leftByColour = new Map<string, Set<number>>();
  const rightByColour = new Map<string, Set<number>>();
  const add = (map: Map<string, Set<number>>, image: DecodedRgba, pixel: number) => {
    const colour = colourAt(image, pixel);
    const alpha = channelAt(image.data, pixel * 4 + 3);
    if (alpha === 0 || colour === "0,0,0") return;
    colours.add(colour);
    const pixels = map.get(colour) ?? new Set<number>();
    pixels.add(pixel);
    map.set(colour, pixels);
  };
  for (let pixel = 0; pixel < left.width * left.height; pixel += 1) {
    add(leftByColour, left, pixel);
    add(rightByColour, right, pixel);
  }
  if (colours.size === 0) return 10_000;
  let total = 0;
  for (const colour of colours) {
    const leftPixels = leftByColour.get(colour) ?? new Set<number>();
    const rightPixels = rightByColour.get(colour) ?? new Set<number>();
    total += setAgreementBasisPoints(leftPixels, rightPixels);
  }
  return Math.round(total / colours.size);
}

export interface ImageGeometryComparison {
  readonly changedOutsideAllowedMaskPixels: number;
  readonly changedPixelCount: number;
  readonly heightPx: number;
  readonly protectedEdgeAgreementBasisPoints: number;
  readonly segmentationIoUBasisPoints: number;
  readonly validationScope: "bounded-png-pixel-comparison-no-camera-or-blender-validation";
  readonly widthPx: number;
}

export async function compareProtectedImageGeometry(input: {
  readonly allowedEditMaskPng: Uint8Array;
  readonly basePng: Uint8Array;
  readonly baseSegmentationPng: Uint8Array;
  readonly candidatePng: Uint8Array;
  readonly candidateSegmentationPng: Uint8Array;
  readonly channelTolerance?: number;
  readonly edgeThreshold?: number;
  readonly limits?: Partial<EvaluationLimits>;
}): Promise<ImageGeometryComparison> {
  const limits = mergedLimits(input.limits);
  const encodedImages = [
    input.basePng,
    input.candidatePng,
    input.allowedEditMaskPng,
    input.baseSegmentationPng,
    input.candidateSegmentationPng,
  ];
  const totalBytes = encodedImages.reduce((total, bytes) => total + bytes.byteLength, 0);
  if (totalBytes > limits.maximumBytes) {
    throw new RenderEvaluationError(
      "RESOURCE_LIMIT_EXCEEDED",
      "Geometry-guard inputs exceed the aggregate encoded-byte budget.",
    );
  }
  let totalPixels = 0;
  for (const bytes of encodedImages) {
    assertBounded(bytes, limits);
    let header: PngHeaderInspection;
    try {
      header = inspectPngHeader(bytes, { maximumPixels: limits.maximumPixels });
    } catch (error) {
      throw new RenderEvaluationError(
        "INVALID_PNG",
        error instanceof Error ? error.message : "PNG header inspection failed.",
      );
    }
    totalPixels += header.widthPx * header.heightPx;
  }
  if (totalPixels > limits.maximumPixels) {
    throw new RenderEvaluationError(
      "RESOURCE_LIMIT_EXCEEDED",
      "Geometry-guard inputs exceed the aggregate decoded-pixel budget.",
    );
  }
  const [base, candidate, mask, baseSegmentation, candidateSegmentation] = await Promise.all([
    decodeRgba(input.basePng, limits),
    decodeRgba(input.candidatePng, limits),
    decodeRgba(input.allowedEditMaskPng, limits),
    decodeRgba(input.baseSegmentationPng, limits),
    decodeRgba(input.candidateSegmentationPng, limits),
  ]);
  const shape = `${String(base.width)}x${String(base.height)}`;
  for (const image of [candidate, mask, baseSegmentation, candidateSegmentation]) {
    if (image.width !== base.width || image.height !== base.height) {
      throw new RenderEvaluationError(
        "DIMENSION_MISMATCH",
        `Geometry-guard image shape ${String(image.width)}x${String(image.height)} does not match ${shape}.`,
      );
    }
  }
  const protectedPixels = new Uint8Array(base.width * base.height);
  let changedPixelCount = 0;
  let changedOutsideAllowedMaskPixels = 0;
  const tolerance = Math.max(0, Math.min(255, input.channelTolerance ?? 0));
  for (let pixel = 0; pixel < base.width * base.height; pixel += 1) {
    const maskOffset = pixel * 4;
    const allowed =
      channelAt(mask.data, maskOffset + 3) > 0 &&
      (channelAt(mask.data, maskOffset) > 0 ||
        channelAt(mask.data, maskOffset + 1) > 0 ||
        channelAt(mask.data, maskOffset + 2) > 0);
    const segmentationColour = colourAt(baseSegmentation, pixel);
    const protectedPixel =
      channelAt(baseSegmentation.data, maskOffset + 3) > 0 && segmentationColour !== "0,0,0";
    protectedPixels[pixel] = protectedPixel ? 1 : 0;
    if (pixelsDiffer(base, candidate, pixel, tolerance)) {
      changedPixelCount += 1;
      if (!allowed) changedOutsideAllowedMaskPixels += 1;
    }
  }
  const edgeThreshold = Math.max(1, input.edgeThreshold ?? 96);
  const baseEdges = edgePixels(base, protectedPixels, edgeThreshold);
  const candidateEdges = edgePixels(candidate, protectedPixels, edgeThreshold);
  return {
    changedOutsideAllowedMaskPixels,
    changedPixelCount,
    heightPx: base.height,
    protectedEdgeAgreementBasisPoints: setAgreementBasisPoints(baseEdges, candidateEdges),
    segmentationIoUBasisPoints: meanSegmentationIoU(baseSegmentation, candidateSegmentation),
    validationScope: "bounded-png-pixel-comparison-no-camera-or-blender-validation",
    widthPx: base.width,
  };
}
