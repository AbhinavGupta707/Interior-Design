import {
  assetTechnicalMetadataSchema,
  c2IngestionPolicy,
  type AssetProcessingCommand,
  type AssetProcessingResult,
} from "@interior-design/contracts";
import { stat, readFile } from "node:fs/promises";
import sharp from "sharp";
import type { Metadata, Sharp } from "sharp";
import { z } from "zod";

import type { WorkerConfig } from "./config.js";
import type { DetectionResult } from "./detection.js";
import { isMissingExecutable, MediaRejection } from "./errors.js";
import { ProcessExecutionError, runBoundedProcess } from "./subprocess.js";
import type { IsolatedWorkspace } from "./workspace.js";

export type ProvenanceTool = AssetProcessingResult["provenance"]["tools"][number];

export interface ArtifactDraft {
  readonly filePath: string;
  readonly kind: "preview" | "thumbnail";
  readonly mimeType: "image/jpeg";
}

export interface InspectionResult {
  readonly artifacts: readonly ArtifactDraft[];
  readonly detectedMimeType: string;
  readonly technicalMetadata: AssetProcessingResult["technicalMetadata"];
  readonly tools: readonly ProvenanceTool[];
}

const maximumVideoDurationMilliseconds = 30 * 60 * 1_000;
const maximumSvgBytes = 16 * 1_024 * 1_024;
const maximumMediaStreams = 16;

export function validatePixelEnvelope(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new MediaRejection("malformed-media");
  }
  const exceedsDimensions =
    width > c2IngestionPolicy.maximumImageDimension ||
    height > c2IngestionPolicy.maximumImageDimension;
  const exceedsPixels =
    BigInt(width) * BigInt(height) > BigInt(c2IngestionPolicy.maximumImagePixels);
  if (exceedsDimensions || exceedsPixels) {
    throw new MediaRejection("resource-limit", {
      technicalMetadata: {
        ...(width <= c2IngestionPolicy.maximumImageDimension ? { widthPixels: width } : {}),
        ...(height <= c2IngestionPolicy.maximumImageDimension ? { heightPixels: height } : {}),
      },
    });
  }
}

export function validateVideoDurationMilliseconds(durationMilliseconds: number): void {
  if (!Number.isSafeInteger(durationMilliseconds) || durationMilliseconds < 1) {
    throw new MediaRejection("malformed-media");
  }
  if (durationMilliseconds > maximumVideoDurationMilliseconds) {
    throw new MediaRejection("resource-limit");
  }
}

function sharpTool(): ProvenanceTool {
  return { name: "sharp", version: sharp.versions.sharp };
}

function baseTools(detection: DetectionResult): ProvenanceTool[] {
  return [
    { name: "spatial-worker", version: "c2-ingest-v1" },
    { name: "file-type", version: "22.0.1" },
    { name: "file", version: detection.fileUtilityVersion },
  ];
}

function validateImageMetadata(
  metadata: Pick<Metadata, "height" | "width"> & { readonly pages?: number | undefined },
): AssetProcessingResult["technicalMetadata"] {
  const width = metadata.width;
  const height = metadata.height;
  validatePixelEnvelope(width, height);
  if ((metadata.pages ?? 1) !== 1) {
    throw new MediaRejection("unsupported-type");
  }
  return assetTechnicalMetadataSchema.parse({ heightPixels: height, widthPixels: width });
}

async function rasterArtifacts(
  sourcePath: string,
  workspace: IsolatedWorkspace,
  config: WorkerConfig,
): Promise<readonly ArtifactDraft[]> {
  const previewPath = workspace.resolve("preview.jpg");
  const thumbnailPath = workspace.resolve("thumbnail.jpg");
  const timeoutSeconds = Math.max(1, Math.ceil(config.subprocess.timeoutMs / 1_000));
  const input = (): Sharp =>
    sharp(sourcePath, {
      failOn: "warning",
      limitInputPixels: c2IngestionPolicy.maximumImagePixels,
      sequentialRead: true,
    }).timeout({ seconds: timeoutSeconds });
  try {
    await input()
      .rotate()
      .flatten({ background: "#ffffff" })
      .resize({
        fit: "inside",
        height: 1_600,
        kernel: sharp.kernel.lanczos3,
        withoutEnlargement: true,
        width: 1_600,
      })
      .jpeg({ chromaSubsampling: "4:2:0", mozjpeg: true, progressive: true, quality: 85 })
      .toFile(previewPath);
    await sharp(previewPath, {
      failOn: "warning",
      limitInputPixels: c2IngestionPolicy.maximumImagePixels,
      sequentialRead: true,
    })
      .timeout({ seconds: timeoutSeconds })
      .resize({ fit: "inside", height: 400, withoutEnlargement: true, width: 400 })
      .jpeg({ chromaSubsampling: "4:2:0", mozjpeg: true, progressive: true, quality: 78 })
      .toFile(thumbnailPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/pixel limit|Input image exceeds pixel limit|timeout/iu.test(message)) {
      throw new MediaRejection("resource-limit");
    }
    throw new MediaRejection("malformed-media");
  }
  await workspace.assertWithinQuota();
  return [
    { filePath: previewPath, kind: "preview", mimeType: "image/jpeg" },
    { filePath: thumbnailPath, kind: "thumbnail", mimeType: "image/jpeg" },
  ];
}

async function inspectImage(
  sourcePath: string,
  workspace: IsolatedWorkspace,
  config: WorkerConfig,
  detection: DetectionResult,
): Promise<InspectionResult> {
  let metadata: Metadata;
  try {
    const timeoutSeconds = Math.max(1, Math.ceil(config.subprocess.timeoutMs / 1_000));
    metadata = await sharp(sourcePath, {
      failOn: "warning",
      limitInputPixels: c2IngestionPolicy.maximumImagePixels,
      sequentialRead: true,
    })
      .timeout({ seconds: timeoutSeconds })
      .metadata();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/pixel limit|Input image exceeds pixel limit/iu.test(message)) {
      throw new MediaRejection("resource-limit", {
        detectedMimeType: detection.detectedMimeType,
      });
    }
    throw new MediaRejection("malformed-media", {
      detectedMimeType: detection.detectedMimeType,
    });
  }
  const technicalMetadata = validateImageMetadata(metadata);
  return {
    artifacts: await rasterArtifacts(sourcePath, workspace, config),
    detectedMimeType: detection.detectedMimeType,
    technicalMetadata,
    tools: [...baseTools(detection), sharpTool()],
  };
}

function rejectUnsafeSvg(svg: string): void {
  const forbiddenMarkup =
    /<!DOCTYPE|<!ENTITY|<\?(?:xml-stylesheet)|<(?:animate|audio|discard|embed|foreignObject|iframe|image|object|script|set|style|video)\b|\son[a-z]+\s*=|@import\b/iu;
  if (forbiddenMarkup.test(svg)) {
    throw new MediaRejection("unsupported-type", { detectedMimeType: "image/svg+xml" });
  }
  for (const match of svg.matchAll(/(?:href|xlink:href|src)\s*=\s*(["'])(.*?)\1/giu)) {
    const reference = match[2]?.trim() ?? "";
    if (!reference.startsWith("#")) {
      throw new MediaRejection("unsupported-type", { detectedMimeType: "image/svg+xml" });
    }
  }
  for (const match of svg.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/giu)) {
    const reference = match[2]?.trim() ?? "";
    if (!reference.startsWith("#")) {
      throw new MediaRejection("unsupported-type", { detectedMimeType: "image/svg+xml" });
    }
  }
}

async function inspectSvg(
  sourcePath: string,
  workspace: IsolatedWorkspace,
  config: WorkerConfig,
  detection: DetectionResult,
): Promise<InspectionResult> {
  const metadata = await stat(sourcePath);
  if (metadata.size > maximumSvgBytes) {
    throw new MediaRejection("resource-limit", { detectedMimeType: "image/svg+xml" });
  }
  let svg: string;
  try {
    svg = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(sourcePath));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/pixel limit|Input image exceeds pixel limit/iu.test(message)) {
      throw new MediaRejection("resource-limit", { detectedMimeType: "image/svg+xml" });
    }
    throw new MediaRejection("malformed-media", { detectedMimeType: "image/svg+xml" });
  }
  if (!/^\s*(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/iu.test(svg) || svg.includes("\u0000")) {
    throw new MediaRejection("malformed-media", { detectedMimeType: "image/svg+xml" });
  }
  rejectUnsafeSvg(svg);
  let imageMetadata: Metadata;
  try {
    const timeoutSeconds = Math.max(1, Math.ceil(config.subprocess.timeoutMs / 1_000));
    imageMetadata = await sharp(sourcePath, {
      density: 144,
      failOn: "warning",
      limitInputPixels: c2IngestionPolicy.maximumImagePixels,
    })
      .timeout({ seconds: timeoutSeconds })
      .metadata();
  } catch {
    throw new MediaRejection("malformed-media", { detectedMimeType: "image/svg+xml" });
  }
  const technicalMetadata = validateImageMetadata(imageMetadata);
  return {
    artifacts: await rasterArtifacts(sourcePath, workspace, config),
    detectedMimeType: "image/svg+xml",
    technicalMetadata,
    tools: [...baseTools(detection), sharpTool()],
  };
}

function executableVersion(output: string, fallback: string): string {
  const line = output.split("\n").find((candidate) => candidate.trim().length > 0);
  return (line?.trim() ?? fallback).slice(0, 100);
}

async function inspectPdf(
  sourcePath: string,
  workspace: IsolatedWorkspace,
  config: WorkerConfig,
  detection: DetectionResult,
  signal?: AbortSignal,
): Promise<InspectionResult> {
  let information: string;
  let pdfinfoVersion: string;
  let pdftoppmVersion: string;
  try {
    const [info, infoVersion, rasterVersion] = await Promise.all([
      runBoundedProcess(
        config.executables.pdfinfo,
        ["-box", sourcePath],
        config.subprocess,
        signal,
      ),
      runBoundedProcess(config.executables.pdfinfo, ["-v"], config.subprocess, signal),
      runBoundedProcess(config.executables.pdftoppm, ["-v"], config.subprocess, signal),
    ]);
    information = info.stdout;
    pdfinfoVersion = executableVersion(
      `${infoVersion.stdout}\n${infoVersion.stderr}`,
      "pdfinfo-unknown",
    );
    pdftoppmVersion = executableVersion(
      `${rasterVersion.stdout}\n${rasterVersion.stderr}`,
      "pdftoppm-unknown",
    );
  } catch (error) {
    if (
      error instanceof ProcessExecutionError &&
      (error.reason === "timeout" || error.reason === "output-limit")
    ) {
      throw new MediaRejection("resource-limit", { detectedMimeType: "application/pdf" });
    }
    if (
      (error instanceof ProcessExecutionError &&
        error.reason === "spawn" &&
        isMissingExecutable(error.cause)) ||
      isMissingExecutable(error)
    ) {
      throw new MediaRejection("unsupported-type", { detectedMimeType: "application/pdf" });
    }
    throw new MediaRejection("malformed-media", { detectedMimeType: "application/pdf" });
  }
  const pages = /^Pages:\s+(\d+)$/imu.exec(information)?.[1];
  const pageCount = pages === undefined ? Number.NaN : Number.parseInt(pages, 10);
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new MediaRejection("malformed-media", { detectedMimeType: "application/pdf" });
  }
  if (pageCount > c2IngestionPolicy.maximumPdfPages) {
    throw new MediaRejection("resource-limit", { detectedMimeType: "application/pdf" });
  }
  const rasterPrefix = workspace.resolve("pdf-first-page");
  try {
    await runBoundedProcess(
      config.executables.pdftoppm,
      ["-f", "1", "-l", "1", "-singlefile", "-scale-to", "1600", "-png", sourcePath, rasterPrefix],
      config.subprocess,
      signal,
    );
  } catch (error) {
    if (
      error instanceof ProcessExecutionError &&
      (error.reason === "timeout" || error.reason === "output-limit")
    ) {
      throw new MediaRejection("resource-limit", { detectedMimeType: "application/pdf" });
    }
    throw new MediaRejection("malformed-media", { detectedMimeType: "application/pdf" });
  }
  const rawRaster = `${rasterPrefix}.png`;
  return {
    artifacts: await rasterArtifacts(rawRaster, workspace, config),
    detectedMimeType: "application/pdf",
    technicalMetadata: { pageCount },
    tools: [
      ...baseTools(detection),
      { name: "pdfinfo", version: pdfinfoVersion },
      { name: "pdftoppm", version: pdftoppmVersion },
      sharpTool(),
    ],
  };
}

const ffprobeSchema = z
  .object({
    format: z
      .object({
        duration: z.string().optional(),
        format_name: z.string().optional(),
        tags: z.object({ major_brand: z.string().optional() }).loose().optional(),
      })
      .loose(),
    streams: z
      .array(
        z
          .object({
            codec_name: z.string().optional(),
            codec_type: z.string().optional(),
            height: z.number().int().optional(),
            width: z.number().int().optional(),
          })
          .loose(),
      )
      .max(maximumMediaStreams),
  })
  .loose();

const supportedVideoCodecs = new Set(["h264", "hevc", "mjpeg", "mpeg4"]);
const supportedAudioCodec = /^(?:aac|alac|mp3|pcm_[a-z0-9_]+)$/u;

async function inspectVideo(
  command: AssetProcessingCommand,
  sourcePath: string,
  workspace: IsolatedWorkspace,
  config: WorkerConfig,
  detection: DetectionResult,
  signal?: AbortSignal,
): Promise<InspectionResult> {
  let probe: z.infer<typeof ffprobeSchema>;
  let ffprobeVersion: string;
  let ffmpegVersion: string;
  try {
    const [result, probeVersion, encoderVersion] = await Promise.all([
      runBoundedProcess(
        config.executables.ffprobe,
        [
          "-v",
          "error",
          "-show_entries",
          "format=format_name,duration:format_tags=major_brand:stream=index,codec_type,codec_name,width,height",
          "-of",
          "json",
          sourcePath,
        ],
        config.subprocess,
        signal,
      ),
      runBoundedProcess(config.executables.ffprobe, ["-version"], config.subprocess, signal),
      runBoundedProcess(config.executables.ffmpeg, ["-version"], config.subprocess, signal),
    ]);
    probe = ffprobeSchema.parse(JSON.parse(result.stdout) as unknown);
    ffprobeVersion = executableVersion(probeVersion.stdout, "ffprobe-unknown");
    ffmpegVersion = executableVersion(encoderVersion.stdout, "ffmpeg-unknown");
  } catch (error) {
    if (
      error instanceof ProcessExecutionError &&
      (error.reason === "timeout" || error.reason === "output-limit")
    ) {
      throw new MediaRejection("resource-limit", { detectedMimeType: detection.detectedMimeType });
    }
    if (error instanceof ProcessExecutionError && error.reason === "spawn") {
      throw new MediaRejection("unsupported-type", {
        detectedMimeType: detection.detectedMimeType,
      });
    }
    throw new MediaRejection("malformed-media", { detectedMimeType: detection.detectedMimeType });
  }
  if (!probe.format.format_name?.split(",").some((name) => name === "mov" || name === "mp4")) {
    throw new MediaRejection("unsupported-type", { detectedMimeType: detection.detectedMimeType });
  }
  const majorBrand = probe.format.tags?.major_brand?.trim().toLowerCase();
  const containerMimeType = majorBrand === "qt" ? "video/quicktime" : "video/mp4";
  if (containerMimeType !== command.expected.declaredMimeType) {
    throw new MediaRejection("signature-mismatch", { detectedMimeType: containerMimeType });
  }
  const durationSeconds = Number(probe.format.duration);
  const durationMilliseconds = Math.round(durationSeconds * 1_000);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new MediaRejection("malformed-media", { detectedMimeType: containerMimeType });
  }
  try {
    validateVideoDurationMilliseconds(durationMilliseconds);
  } catch (error) {
    if (error instanceof MediaRejection) {
      throw new MediaRejection(error.code, { detectedMimeType: containerMimeType });
    }
    throw error;
  }
  const videoStreams = probe.streams.filter((stream) => stream.codec_type === "video");
  if (videoStreams.length !== 1) {
    throw new MediaRejection(videoStreams.length > 1 ? "resource-limit" : "malformed-media", {
      detectedMimeType: containerMimeType,
    });
  }
  for (const stream of probe.streams) {
    const codec = stream.codec_name ?? "";
    if (
      (stream.codec_type === "video" && !supportedVideoCodecs.has(codec)) ||
      (stream.codec_type === "audio" && !supportedAudioCodec.test(codec)) ||
      (stream.codec_type !== "video" && stream.codec_type !== "audio")
    ) {
      throw new MediaRejection("unsupported-type", { detectedMimeType: containerMimeType });
    }
  }
  const video = videoStreams[0];
  if (video === undefined || video.width === undefined || video.height === undefined) {
    throw new MediaRejection("malformed-media", { detectedMimeType: containerMimeType });
  }
  const dimensions = validateImageMetadata({ height: video.height, width: video.width });
  const rawFrame = workspace.resolve("video-first-frame.png");
  try {
    await runBoundedProcess(
      config.executables.ffmpeg,
      [
        "-nostdin",
        "-v",
        "error",
        "-threads",
        "1",
        "-i",
        sourcePath,
        "-map",
        "0:v:0",
        "-frames:v",
        "1",
        "-vf",
        "scale=1600:1600:force_original_aspect_ratio=decrease",
        "-f",
        "image2",
        "-vcodec",
        "png",
        rawFrame,
      ],
      config.subprocess,
      signal,
    );
  } catch (error) {
    if (
      error instanceof ProcessExecutionError &&
      (error.reason === "timeout" || error.reason === "output-limit")
    ) {
      throw new MediaRejection("resource-limit", { detectedMimeType: containerMimeType });
    }
    const stderr = error instanceof ProcessExecutionError ? (error.stderr ?? "") : "";
    if (/decoder .* not found|unknown decoder|not currently supported/iu.test(stderr)) {
      throw new MediaRejection("unsupported-type", { detectedMimeType: containerMimeType });
    }
    throw new MediaRejection("malformed-media", { detectedMimeType: containerMimeType });
  }
  return {
    artifacts: await rasterArtifacts(rawFrame, workspace, config),
    detectedMimeType: containerMimeType,
    technicalMetadata: { ...dimensions, durationMilliseconds },
    tools: [
      ...baseTools(detection),
      { name: "ffprobe", version: ffprobeVersion },
      { name: "ffmpeg", version: ffmpegVersion },
      sharpTool(),
    ],
  };
}

export async function inspectMedia(
  command: AssetProcessingCommand,
  sourcePath: string,
  workspace: IsolatedWorkspace,
  config: WorkerConfig,
  detection: DetectionResult,
  signal?: AbortSignal,
): Promise<InspectionResult> {
  switch (detection.detectedMimeType) {
    case "image/jpeg":
    case "image/png":
      return inspectImage(sourcePath, workspace, config, detection);
    case "image/svg+xml":
      return inspectSvg(sourcePath, workspace, config, detection);
    case "application/pdf":
      return inspectPdf(sourcePath, workspace, config, detection, signal);
    case "video/mp4":
    case "video/quicktime":
      return inspectVideo(command, sourcePath, workspace, config, detection, signal);
    default:
      throw new MediaRejection("unsupported-type", {
        detectedMimeType: detection.detectedMimeType,
      });
  }
}

export const workerMediaLimits = Object.freeze({
  maximumMediaStreams,
  maximumSvgBytes,
  maximumVideoDurationMilliseconds,
});
