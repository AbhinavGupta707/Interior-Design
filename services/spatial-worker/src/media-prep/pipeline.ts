import {
  c8ReconstructionPolicy,
  mediaPreparationManifestSchema,
  reconstructionSourceSchema,
  type MediaPreparationManifest,
} from "@interior-design/contracts";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import type { SafeLogger } from "../logger.js";
import { canonicalSha256, deterministicUuid } from "./canonical.js";
import { FFmpegMediaTools } from "./ffmpeg.js";
import { inspectPreparedFrame, overlapScoreMillionths } from "./metrics.js";
import {
  c8MediaPreparationAdapterVersion,
  defaultMediaPreparationPolicy,
  MediaPreparationError,
  type MediaPreparationPolicy,
  type MediaPreparationRequest,
  type MediaProcessPort,
  type PreparedFrameStream,
  type PreparedMediaBundle,
  type PrivacyReviewer,
  ReviewRequiredPrivacyReviewer,
  type RGBMediaSource,
} from "./types.js";
import { MediaPreparationWorkspace } from "./workspace.js";

export interface MediaPreparationPipelineOptions {
  readonly logger?: SafeLogger;
  readonly policy?: Readonly<Partial<MediaPreparationPolicy>>;
  readonly privacyReviewer?: PrivacyReviewer;
  readonly process?: MediaProcessPort;
  readonly temporaryRoot: string;
}

interface MutableFrame {
  readonly filePath: string;
  readonly manifest: PreparedFrame;
}

type PreparedFrame = MediaPreparationManifest["frames"][number];

export class MediaPreparationPipeline {
  readonly #logger: SafeLogger | undefined;
  readonly #policy: Readonly<MediaPreparationPolicy>;
  readonly #privacyReviewer: PrivacyReviewer;
  readonly #process: MediaProcessPort | undefined;
  readonly #temporaryRoot: string;

  constructor(options: MediaPreparationPipelineOptions) {
    this.#temporaryRoot = path.resolve(options.temporaryRoot);
    this.#policy = Object.freeze({
      ...defaultMediaPreparationPolicy,
      ...options.policy,
    });
    this.#privacyReviewer = options.privacyReviewer ?? new ReviewRequiredPrivacyReviewer();
    this.#process = options.process;
    this.#logger = options.logger;
    validatePolicy(this.#policy);
  }

  async prepare(
    request: MediaPreparationRequest,
    signal?: AbortSignal,
  ): Promise<PreparedMediaBundle> {
    const sources = validateRequest(request, this.#policy);
    const workspace = await MediaPreparationWorkspace.create(
      this.#temporaryRoot,
      this.#policy.maximumTemporaryBytes,
    );
    try {
      const tools =
        this.#process === undefined
          ? new FFmpegMediaTools(workspace, this.#policy)
          : new FFmpegMediaTools(workspace, this.#policy, this.#process);
      const versions = await tools.versions(signal);
      const configSha256 = canonicalSha256({
        adapterVersion: c8MediaPreparationAdapterVersion,
        colorNormalization: "ffmpeg-scale-bt709-full-rgb24-v1",
        metadataPolicy: "strip-all-source-metadata-v1",
        policy: this.#policy,
        privacyReviewer: {
          id: this.#privacyReviewer.reviewerId,
          version: this.#privacyReviewer.reviewerVersion,
        },
        sampling: "ffmpeg-fps-start-zero-round-down-v1",
      });
      const sourceManifestSha256 =
        request.sourceManifestSha256 ??
        canonicalSha256(sources.map(({ descriptor }) => descriptor));
      if (!/^[a-f0-9]{64}$/u.test(sourceManifestSha256)) {
        throw new MediaPreparationError("HASH_MISMATCH");
      }
      const prepared: MutableFrame[] = [];
      let privacyStatus: MediaPreparationManifest["privacyStatus"] = "accepted";
      for (const [sourceIndex, source] of sources.entries()) {
        throwIfAborted(signal);
        const sourcePath = workspace.sourcePath(sourceIndex, source.descriptor);
        await workspace.streamSource(
          await source.open(),
          sourcePath,
          source.descriptor.byteSize,
          source.descriptor.sha256,
          signal,
        );
        const probe = await tools.probe(sourcePath, source.descriptor, signal);
        const remaining = this.#policy.maximumFramesTotal - prepared.length;
        if (remaining <= 0) throw new MediaPreparationError("FRAME_LIMIT_EXCEEDED");
        const expectedFrames = tools.expectedFrameCount(source.descriptor, probe);
        const framePaths = await tools.extractFrames(
          sourcePath,
          sourceIndex,
          source.descriptor,
          probe,
          Math.min(expectedFrames, remaining),
          signal,
        );
        let previousFingerprint: Uint8Array | undefined;
        for (const [frameIndex, framePath] of framePaths.entries()) {
          throwIfAborted(signal);
          const timestampMicroseconds =
            source.descriptor.kind === "rgb-image"
              ? 0
              : frameIndex * this.#policy.frameIntervalMicroseconds;
          const preReview = await inspectPreparedFrame(framePath, this.#policy);
          const provisionalId = deterministicUuid(
            `${source.descriptor.assetId}:${String(timestampMicroseconds)}:${String(frameIndex)}`,
          );
          const decision = await this.#privacyReviewer.review(
            {
              frameId: provisionalId,
              heightPixels: preReview.heightPixels,
              openSanitizedFrame: () => workspace.openFile(framePath),
              sourceAssetId: source.descriptor.assetId,
              timestampMicroseconds,
              widthPixels: preReview.widthPixels,
            },
            signal,
          );
          let redactionStatus: PreparedFrame["redactionStatus"];
          switch (decision.status) {
            case "not-required":
              redactionStatus = "not-required";
              break;
            case "applied": {
              const normalized = await normalizeReplacement(
                decision.replacementPng,
                preReview.widthPixels,
                preReview.heightPixels,
                this.#policy,
              );
              await writeFile(framePath, normalized, { mode: 0o600 });
              await workspace.assertWithinQuota();
              redactionStatus = "applied";
              break;
            }
            case "review-required":
              privacyStatus = privacyStatus === "rejected" ? "rejected" : "review-required";
              redactionStatus = "review-required";
              break;
            case "rejected":
              privacyStatus = "rejected";
              redactionStatus = "review-required";
              break;
          }
          const metrics = await inspectPreparedFrame(framePath, this.#policy);
          const sanitizedSha256 = await workspace.sha256(framePath, signal);
          const frameId = deterministicUuid(
            `${source.descriptor.assetId}:${String(timestampMicroseconds)}:${sanitizedSha256}`,
          );
          prepared.push({
            filePath: framePath,
            manifest: {
              blurScoreMillionths: metrics.blurScoreMillionths,
              exposureScoreMillionths: metrics.exposureScoreMillionths,
              frameId,
              heightPixels: metrics.heightPixels,
              metadataStripped: true,
              overlapScoreMillionths: overlapScoreMillionths(
                metrics.lumaFingerprint,
                previousFingerprint,
              ),
              redactionStatus,
              sanitizedSha256,
              sourceAssetId: source.descriptor.assetId,
              timestampMicroseconds,
              widthPixels: metrics.widthPixels,
            },
          });
          previousFingerprint = metrics.lumaFingerprint;
        }
      }
      if (prepared.length > this.#policy.maximumFramesTotal) {
        throw new MediaPreparationError("FRAME_LIMIT_EXCEEDED");
      }
      const manifestPayload = {
        frames: prepared.map(({ manifest }) => manifest),
        jobId: request.jobId,
        privacyStatus,
        projectId: request.projectId,
        schemaVersion: "c8-media-preparation-v1" as const,
        sourceManifestSha256,
        tool: {
          adapterId: "ffmpeg-media-prep",
          adapterVersion: c8MediaPreparationAdapterVersion,
          configSha256,
          executableVersion: versions.executableVersion,
        },
      };
      const manifest = mediaPreparationManifestSchema.parse({
        ...manifestPayload,
        manifestSha256: canonicalSha256(manifestPayload),
      });
      const streams: PreparedFrameStream[] = prepared.map(({ filePath, manifest: frame }) => ({
        frameId: frame.frameId,
        open: () => workspace.openFile(filePath),
      }));
      this.#logger?.info("media-prep.completed", {
        frameCount: manifest.frames.length,
        jobId: manifest.jobId,
        manifestSha256: manifest.manifestSha256,
        privacyStatus: manifest.privacyStatus,
        projectId: manifest.projectId,
        sourceManifestSha256: manifest.sourceManifestSha256,
      });
      return {
        cleanup: () => workspace.cleanup(),
        frames: streams,
        manifest,
      };
    } catch (error) {
      await workspace.cleanup();
      const failure = normalizeError(error, signal);
      this.#logger?.warn("media-prep.failed", {
        jobId: request.jobId,
        projectId: request.projectId,
        retryable: failure.retryable,
        safeCode: failure.safeCode,
      });
      throw failure;
    }
  }
}

function validateRequest(
  request: MediaPreparationRequest,
  policy: Readonly<MediaPreparationPolicy>,
): readonly { readonly descriptor: RGBMediaSource; open(): Promise<AsyncIterable<Uint8Array>> }[] {
  if (request.sources.length === 0 || request.sources.length > policy.maximumSourceCount) {
    throw new MediaPreparationError("SOURCE_LIMIT_EXCEEDED");
  }
  const assetIds = new Set<string>();
  let totalBytes = 0;
  return request.sources.map((source) => {
    let parsed: ReturnType<typeof reconstructionSourceSchema.parse>;
    try {
      parsed = reconstructionSourceSchema.parse(source.descriptor);
    } catch (error) {
      throw new MediaPreparationError("UNSUPPORTED_MEDIA", { cause: error });
    }
    if (parsed.kind !== "rgb-image" && parsed.kind !== "rgb-video") {
      throw new MediaPreparationError("UNSUPPORTED_MEDIA");
    }
    if (assetIds.has(parsed.assetId)) throw new MediaPreparationError("SOURCE_LIMIT_EXCEEDED");
    assetIds.add(parsed.assetId);
    if (parsed.byteSize > policy.maximumSourceBytes) {
      throw new MediaPreparationError("SOURCE_LIMIT_EXCEEDED");
    }
    totalBytes += parsed.byteSize;
    if (
      !Number.isSafeInteger(totalBytes) ||
      totalBytes > c8ReconstructionPolicy.maximumSourceBytes ||
      totalBytes > policy.maximumTemporaryBytes
    ) {
      throw new MediaPreparationError("DISK_LIMIT_EXCEEDED");
    }
    return { descriptor: parsed as RGBMediaSource, open: source.open.bind(source) };
  });
}

async function normalizeReplacement(
  replacement: Uint8Array,
  width: number,
  height: number,
  policy: Readonly<MediaPreparationPolicy>,
): Promise<Buffer> {
  if (replacement.byteLength === 0 || replacement.byteLength > policy.maximumOutputBytes * 8) {
    throw new MediaPreparationError("PROCESS_OUTPUT_LIMIT");
  }
  try {
    const normalized = await sharp(replacement, {
      failOn: "error",
      limitInputPixels: policy.maximumFramePixels,
    })
      .resize(width, height, { fit: "fill", kernel: "lanczos3" })
      .removeAlpha()
      .toColourspace("srgb")
      .png({ compressionLevel: 9, progressive: false })
      .toBuffer();
    if (normalized.byteLength > policy.maximumOutputBytes * 8) {
      throw new MediaPreparationError("PROCESS_OUTPUT_LIMIT");
    }
    return normalized;
  } catch (error) {
    if (error instanceof MediaPreparationError) throw error;
    throw new MediaPreparationError("MALFORMED_MEDIA", { cause: error });
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw new MediaPreparationError("CANCELLED");
}

function normalizeError(error: unknown, signal?: AbortSignal): MediaPreparationError {
  if (error instanceof MediaPreparationError) return error;
  if (signal?.aborted === true) return new MediaPreparationError("CANCELLED", { cause: error });
  return new MediaPreparationError("PROCESS_FAILED", { cause: error, retryable: true });
}

function validatePolicy(policy: Readonly<MediaPreparationPolicy>): void {
  const integers = Object.values(policy);
  if (integers.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new TypeError("Media preparation limits must be positive safe integers.");
  }
  if (
    policy.maximumFramesTotal > c8ReconstructionPolicy.maximumFrameCount ||
    policy.maximumFramePixels > c8ReconstructionPolicy.maximumFramePixels ||
    policy.maximumSourceCount > c8ReconstructionPolicy.maximumSourceAssetCount ||
    policy.maximumSourceBytes > c8ReconstructionPolicy.maximumSourceAssetBytes
  ) {
    throw new TypeError("Media preparation limits cannot exceed the frozen C8 contract.");
  }
}
