import { c6PlanPolicy } from "@interior-design/contracts";
import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp, { type Metadata } from "sharp";

import {
  ProcessExecutionError,
  runBoundedProcess,
  type ProcessLimits,
  type ProcessResult,
} from "../subprocess.js";
import {
  PlanNormalizationError,
  type NormalizedPlanInput,
  type PlanNormalizationRequest,
  type PlanNormalizerToolchain,
} from "./types.js";

export interface PlanProcessPort {
  run(
    executable: string,
    arguments_: readonly string[],
    limits: ProcessLimits,
    signal?: AbortSignal,
  ): Promise<ProcessResult>;
}

const defaultProcessPort: PlanProcessPort = { run: runBoundedProcess };
const maximumVectorElements = 10_000;
const maximumVectorManifestBytes = c6PlanPolicy.maximumParserOutputBytes;

function safeWorkspacePath(workspaceDirectory: string, fileName: string): string {
  if (!/^[a-z0-9][a-z0-9.-]{0,99}$/u.test(fileName))
    throw new Error("Unsafe normalized plan file name.");
  const root = path.resolve(workspaceDirectory);
  const target = path.resolve(root, fileName);
  if (path.dirname(target) !== root) throw new Error("Normalized plan path escaped its workspace.");
  return target;
}

async function assertBoundedRegularFile(filePath: string): Promise<void> {
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new PlanNormalizationError("unsafe-content");
  if (metadata.size > c6PlanPolicy.maximumAssetBytes)
    throw new PlanNormalizationError("resource-limit");
}

async function readBoundedFile(filePath: string): Promise<Buffer> {
  await assertBoundedRegularFile(filePath);
  return readFile(filePath);
}

async function fingerprint(
  filePath: string,
): Promise<{ readonly byteSize: number; readonly sha256: string }> {
  const bytes = await readBoundedFile(filePath);
  return { byteSize: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function parseDecimalToMicrounits(value: string): number {
  if (!/^[+]?(?:\d+(?:\.\d{0,6})?|\.\d{1,6})$/u.test(value.trim()))
    throw new PlanNormalizationError("unsupported-input");
  const scaled = Math.round(Number(value) * 1_000_000);
  if (!Number.isSafeInteger(scaled) || scaled <= 0 || scaled > 1_000_000_000)
    throw new PlanNormalizationError("resource-limit");
  return scaled;
}

function svgDimensions(svg: string): { readonly height: number; readonly width: number } {
  const root = /<svg\b([^>]*)>/iu.exec(svg)?.[1];
  if (root === undefined) throw new PlanNormalizationError("unsupported-input");
  const viewBox =
    /\bviewBox\s*=\s*["']\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s+([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s+([+]?(?:\d+(?:\.\d+)?|\.\d+))\s+([+]?(?:\d+(?:\.\d+)?|\.\d+))\s*["']/iu.exec(
      root,
    );
  if (viewBox?.[3] !== undefined && viewBox[4] !== undefined) {
    return {
      height: parseDecimalToMicrounits(viewBox[4]),
      width: parseDecimalToMicrounits(viewBox[3]),
    };
  }
  const width =
    /\bwidth\s*=\s*["']\s*([+]?(?:\d+(?:\.\d{0,6})?|\.\d{1,6}))(?:px|pt|mm|cm|in)?\s*["']/iu.exec(
      root,
    )?.[1];
  const height =
    /\bheight\s*=\s*["']\s*([+]?(?:\d+(?:\.\d{0,6})?|\.\d{1,6}))(?:px|pt|mm|cm|in)?\s*["']/iu.exec(
      root,
    )?.[1];
  if (width === undefined || height === undefined)
    throw new PlanNormalizationError("unsupported-input");
  return { height: parseDecimalToMicrounits(height), width: parseDecimalToMicrounits(width) };
}

function assertSafeSvg(svg: string): void {
  if (
    svg.includes("\0") ||
    /<!DOCTYPE|<!ENTITY|<script\b|<style\b|<foreignObject\b|<image\b|<use\b|<iframe\b|<object\b|<embed\b|<audio\b|<video\b|<animate\b|<set\b|<discard\b/iu.test(
      svg,
    ) ||
    /\son[a-z0-9_-]+\s*=/iu.test(svg) ||
    /\b(?:href|xlink:href)\s*=\s*["'](?!#)[^"']+/iu.test(svg) ||
    /url\s*\(|@import|<\?xml-stylesheet/iu.test(svg)
  ) {
    throw new PlanNormalizationError("unsafe-content");
  }
}

function decodeSvg(source: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(source);
  } catch (error) {
    throw new PlanNormalizationError("unsafe-content", false, { cause: error });
  }
}

function canonicalVectorElements(svg: string): readonly object[] {
  const allowed =
    /<(path|line|polyline|polygon|rect|circle|ellipse|text)\b([^>]*)>(?:([^<]{0,500})<\/text\s*>)?|<(path|line|polyline|polygon|rect|circle|ellipse)\b([^>]*)\/?\s*>/giu;
  const elements: object[] = [];
  for (const match of svg.matchAll(allowed)) {
    const tag = (match[1] ?? match[4])?.toLowerCase();
    const rawAttributes = match[2] ?? match[5] ?? "";
    if (tag === undefined) continue;
    const attributes: Record<string, string> = {};
    for (const attribute of rawAttributes.matchAll(
      /\b([A-Za-z][A-Za-z0-9:-]{0,39})\s*=\s*["']([^"']{0,100000})["']/gu,
    )) {
      const name = attribute[1]?.toLowerCase();
      const value = attribute[2];
      if (name === undefined || value === undefined) continue;
      if (["id", "class", "style", "href", "xlink:href"].includes(name) || name.startsWith("on"))
        continue;
      attributes[name] = value.trim().replace(/\s+/gu, " ");
    }
    const sortedAttributes = Object.fromEntries(
      Object.entries(attributes).sort(([left], [right]) => left.localeCompare(right)),
    );
    const textContent = tag === "text" ? (match[3] ?? "").trim().replace(/\s+/gu, " ") : undefined;
    elements.push({
      attributes: sortedAttributes,
      ...(textContent === undefined || textContent.length === 0
        ? {}
        : {
            labelUtf8Bytes: Buffer.byteLength(textContent, "utf8"),
            labelSha256: createHash("sha256").update(textContent).digest("hex"),
          }),
      tag,
    });
    if (elements.length > maximumVectorElements) throw new PlanNormalizationError("resource-limit");
  }
  return elements;
}

async function normalizeSvgVector(
  sourcePath: string,
  workspace: string,
  fileName: string,
): Promise<NormalizedPlanInput> {
  const source = await readBoundedFile(sourcePath);
  const svg = decodeSvg(source);
  assertSafeSvg(svg);
  const dimensions = svgDimensions(svg);
  const elements = canonicalVectorElements(svg);
  if (elements.length === 0) throw new PlanNormalizationError("no-plan-geometry");
  const manifest = JSON.stringify({
    coordinateSpace: "svg-microunits",
    elements,
    heightSourceUnits: dimensions.height,
    schemaVersion: "c6-vector-manifest-v1",
    widthSourceUnits: dimensions.width,
  });
  if (Buffer.byteLength(manifest) > maximumVectorManifestBytes)
    throw new PlanNormalizationError("resource-limit");
  const filePath = safeWorkspacePath(workspace, fileName);
  await writeFile(filePath, manifest, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return {
    coordinateSpace: "svg-microunits",
    filePath,
    heightSourceUnits: dimensions.height,
    mode: "deterministic-vector",
    normalizers: [{ name: "c6-svg-vector-manifest", version: "1.0.0" }],
    sha256: createHash("sha256").update(manifest).digest("hex"),
    widthSourceUnits: dimensions.width,
  };
}

async function normalizeRaster(
  sourcePath: string,
  workspace: string,
  fileName: string,
): Promise<NormalizedPlanInput> {
  await assertBoundedRegularFile(sourcePath);
  let metadata: Metadata;
  try {
    metadata = await sharp(sourcePath, {
      failOn: "error",
      limitInputPixels: c6PlanPolicy.maximumRasterPixels,
    }).metadata();
  } catch (error) {
    throw new PlanNormalizationError("unsupported-input", false, { cause: error });
  }
  const width = metadata.width;
  const height = metadata.height;
  if (width <= 0 || height <= 0 || width * height > c6PlanPolicy.maximumRasterPixels) {
    throw new PlanNormalizationError("resource-limit");
  }
  const filePath = safeWorkspacePath(workspace, fileName);
  try {
    await sharp(sourcePath, { failOn: "error", limitInputPixels: c6PlanPolicy.maximumRasterPixels })
      .rotate()
      .flatten({ background: "white" })
      .greyscale()
      .toColourspace("b-w")
      .png({ adaptiveFiltering: false, compressionLevel: 9, palette: false })
      .toFile(filePath);
  } catch (error) {
    throw new PlanNormalizationError("unsupported-input", false, { cause: error });
  }
  const normalizedMetadata = await sharp(filePath).metadata();
  const normalizedWidth = normalizedMetadata.width;
  const normalizedHeight = normalizedMetadata.height;
  const result = await fingerprint(filePath);
  return {
    coordinateSpace: "pixels",
    filePath,
    heightSourceUnits: normalizedHeight,
    mode: "deterministic-raster",
    normalizers: [{ name: "sharp-grayscale-png", version: sharp.versions.sharp }],
    sha256: result.sha256,
    widthSourceUnits: normalizedWidth,
  };
}

function pageCount(output: string): number {
  const value = /^Pages:\s+(\d+)\s*$/imu.exec(output)?.[1];
  const parsed = value === undefined ? Number.NaN : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new PlanNormalizationError("unsupported-input");
  if (parsed > c6PlanPolicy.maximumPageCount) throw new PlanNormalizationError("resource-limit");
  return parsed;
}

function assertPdfRasterPixelLimit(output: string): void {
  const size =
    /^(?:Page\s+\d+\s+)?size:\s+([0-9]+(?:\.[0-9]+)?)\s+x\s+([0-9]+(?:\.[0-9]+)?)\s+pts\s*$/imu.exec(
      output,
    ) ?? /^Page size:\s+([0-9]+(?:\.[0-9]+)?)\s+x\s+([0-9]+(?:\.[0-9]+)?)\s+pts/imu.exec(output);
  const widthPoints = Number(size?.[1]);
  const heightPoints = Number(size?.[2]);
  if (
    !Number.isFinite(widthPoints) ||
    !Number.isFinite(heightPoints) ||
    widthPoints <= 0 ||
    heightPoints <= 0
  ) {
    throw new PlanNormalizationError("unsupported-input");
  }
  const estimatedPixels =
    Math.ceil((widthPoints * 150) / 72) * Math.ceil((heightPoints * 150) / 72);
  if (estimatedPixels > c6PlanPolicy.maximumRasterPixels)
    throw new PlanNormalizationError("resource-limit");
}

function mapProcessError(error: unknown): PlanNormalizationError {
  if (error instanceof PlanNormalizationError) return error;
  if (error instanceof ProcessExecutionError) {
    if (error.reason === "timeout") return new PlanNormalizationError("parser-timeout", true);
    if (error.reason === "output-limit") return new PlanNormalizationError("resource-limit");
    if (error.reason === "spawn") return new PlanNormalizationError("parser-unavailable", true);
    return new PlanNormalizationError("unsupported-input", false, { cause: error });
  }
  return new PlanNormalizationError("parser-unavailable", true, { cause: error });
}

export class PlanNormalizer {
  readonly #process: PlanProcessPort;
  readonly #toolchain: PlanNormalizerToolchain;

  constructor(
    toolchain: PlanNormalizerToolchain,
    processPort: PlanProcessPort = defaultProcessPort,
  ) {
    this.#toolchain = toolchain;
    this.#process = processPort;
  }

  async normalize(
    request: PlanNormalizationRequest,
    signal?: AbortSignal,
  ): Promise<NormalizedPlanInput> {
    const source = await fingerprint(request.sourcePath);
    if (source.byteSize !== request.expectedByteSize || source.sha256 !== request.expectedSha256) {
      throw new PlanNormalizationError("source-mismatch");
    }
    if (source.byteSize > c6PlanPolicy.maximumAssetBytes)
      throw new PlanNormalizationError("resource-limit");
    if (request.parserPreference === "fixture") {
      const filePath = safeWorkspacePath(request.workspaceDirectory, "fixture-input.json");
      const content = JSON.stringify({
        schemaVersion: "c6-fixture-input-v1",
        sourceSha256: source.sha256,
      });
      await writeFile(filePath, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
      return {
        coordinateSpace: "fixture-microunits",
        filePath,
        heightSourceUnits: 1_000_000,
        mode: "deterministic-fixture",
        normalizers: [{ name: "c6-fixture-normalizer", version: "1.0.0" }],
        sha256: createHash("sha256").update(content).digest("hex"),
        widthSourceUnits: 1_000_000,
      };
    }
    if (request.detectedMimeType === "image/png" || request.detectedMimeType === "image/jpeg") {
      if (request.pageIndex !== 0 || request.parserPreference === "vector")
        throw new PlanNormalizationError("unsupported-input");
      return normalizeRaster(
        request.sourcePath,
        request.workspaceDirectory,
        "normalized-raster.png",
      );
    }
    if (request.detectedMimeType === "image/svg+xml") {
      if (request.pageIndex !== 0) throw new PlanNormalizationError("unsupported-input");
      if (request.parserPreference === "raster") {
        const svg = decodeSvg(await readFile(request.sourcePath));
        assertSafeSvg(svg);
        return normalizeRaster(
          request.sourcePath,
          request.workspaceDirectory,
          "normalized-raster.png",
        );
      }
      return normalizeSvgVector(
        request.sourcePath,
        request.workspaceDirectory,
        "normalized-vector.json",
      );
    }
    const limits = {
      maximumOutputBytes: 1_048_576,
      timeoutMs: c6PlanPolicy.parserTimeoutMilliseconds,
    };
    try {
      const info = await this.#process.run(
        this.#toolchain.pdfInfo,
        [
          "-f",
          String(request.pageIndex + 1),
          "-l",
          String(request.pageIndex + 1),
          request.sourcePath,
        ],
        limits,
        signal,
      );
      const count = pageCount(info.stdout);
      if (request.pageIndex >= count) throw new PlanNormalizationError("unsupported-input");
      if (request.parserPreference !== "raster") {
        const vectorSvg = safeWorkspacePath(request.workspaceDirectory, "pdf-vector.svg");
        try {
          await this.#process.run(
            this.#toolchain.pdfToCairo,
            [
              "-svg",
              "-f",
              String(request.pageIndex + 1),
              "-l",
              String(request.pageIndex + 1),
              request.sourcePath,
              vectorSvg,
            ],
            limits,
            signal,
          );
          const normalized = await normalizeSvgVector(
            vectorSvg,
            request.workspaceDirectory,
            "normalized-vector.json",
          );
          return {
            ...normalized,
            normalizers: [
              { name: "poppler-pdftocairo", version: this.#toolchain.popplerVersion },
              ...normalized.normalizers,
            ],
          };
        } catch (error) {
          const mapped = mapProcessError(error);
          if (
            request.parserPreference === "vector" ||
            mapped.code === "resource-limit" ||
            mapped.code === "parser-timeout"
          )
            throw mapped;
        }
      }
      assertPdfRasterPixelLimit(info.stdout);
      const rasterPrefix = safeWorkspacePath(request.workspaceDirectory, "pdf-raster");
      await this.#process.run(
        this.#toolchain.pdfToPpm,
        [
          "-f",
          String(request.pageIndex + 1),
          "-l",
          String(request.pageIndex + 1),
          "-singlefile",
          "-gray",
          "-r",
          "150",
          "-png",
          request.sourcePath,
          rasterPrefix,
        ],
        limits,
        signal,
      );
      const normalized = await normalizeRaster(
        `${rasterPrefix}.png`,
        request.workspaceDirectory,
        "normalized-raster.png",
      );
      return {
        ...normalized,
        normalizers: [
          { name: "poppler-pdftoppm", version: this.#toolchain.popplerVersion },
          ...normalized.normalizers,
        ],
      };
    } catch (error) {
      throw mapProcessError(error);
    }
  }
}
