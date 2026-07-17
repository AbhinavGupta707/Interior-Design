import sharp, { type Metadata } from "sharp";

import type { MediaPreparationPolicy } from "./types.js";
import { MediaPreparationError } from "./types.js";

export interface FrameMetrics {
  readonly blurScoreMillionths: number;
  readonly exposureScoreMillionths: number;
  readonly heightPixels: number;
  readonly lumaFingerprint: Uint8Array;
  readonly widthPixels: number;
}

export async function inspectPreparedFrame(
  filePath: string,
  policy: Readonly<MediaPreparationPolicy>,
): Promise<FrameMetrics> {
  let metadata: Metadata;
  try {
    metadata = await sharp(filePath, {
      failOn: "error",
      limitInputPixels: policy.maximumFramePixels,
      sequentialRead: true,
    }).metadata();
  } catch (error) {
    throw new MediaPreparationError("MALFORMED_MEDIA", { cause: error });
  }
  const widthPixels = metadata.width;
  const heightPixels = metadata.height;
  const pixels = widthPixels * heightPixels;
  if (
    widthPixels <= 0 ||
    heightPixels <= 0 ||
    !Number.isSafeInteger(pixels) ||
    pixels > policy.maximumFramePixels
  ) {
    throw new MediaPreparationError("PIXEL_LIMIT_EXCEEDED");
  }
  let raw: Buffer;
  try {
    raw = await sharp(filePath, {
      failOn: "error",
      limitInputPixels: policy.maximumFramePixels,
      sequentialRead: true,
    })
      .greyscale()
      .resize(128, 128, { fit: "fill", kernel: "lanczos3" })
      .raw()
      .toBuffer();
  } catch (error) {
    throw new MediaPreparationError("MALFORMED_MEDIA", { cause: error });
  }
  let clipped = 0;
  let laplacianCount = 0;
  let laplacianSum = 0;
  let laplacianSquareSum = 0;
  for (const value of raw) {
    if (value < 18 || value > 237) clipped += 1;
  }
  const width = 128;
  for (let y = 1; y < 127; y += 1) {
    for (let x = 1; x < 127; x += 1) {
      const index = y * width + x;
      const centre = (raw[index] ?? 0) * 4;
      const laplacian =
        centre -
        (raw[index - 1] ?? 0) -
        (raw[index + 1] ?? 0) -
        (raw[index - width] ?? 0) -
        (raw[index + width] ?? 0);
      laplacianSum += laplacian;
      laplacianSquareSum += laplacian * laplacian;
      laplacianCount += 1;
    }
  }
  const mean = laplacianSum / Math.max(laplacianCount, 1);
  const variance = Math.max(0, laplacianSquareSum / Math.max(laplacianCount, 1) - mean * mean);
  return {
    blurScoreMillionths: clampMillionths(Math.round((variance / 1_200) * 1_000_000)),
    exposureScoreMillionths: clampMillionths(
      1_000_000 - Math.round((clipped / raw.byteLength) * 1_000_000),
    ),
    heightPixels,
    lumaFingerprint: raw,
    widthPixels,
  };
}

export function overlapScoreMillionths(
  current: Uint8Array,
  previous: Uint8Array | undefined,
): number {
  if (previous === undefined) return 1_000_000;
  if (current.byteLength !== previous.byteLength || current.byteLength === 0) return 0;
  let difference = 0;
  for (let index = 0; index < current.byteLength; index += 1) {
    difference += Math.abs((current[index] ?? 0) - (previous[index] ?? 0));
  }
  return clampMillionths(
    1_000_000 - Math.round((difference / (current.byteLength * 255)) * 1_000_000),
  );
}

function clampMillionths(value: number): number {
  return Math.max(0, Math.min(1_000_000, value));
}
