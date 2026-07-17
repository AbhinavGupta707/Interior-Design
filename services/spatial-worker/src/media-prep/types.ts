import type { MediaPreparationManifest, ReconstructionSource } from "@interior-design/contracts";
import type { ProcessLimits, ProcessResult } from "../subprocess.js";

export const c8MediaPreparationAdapterVersion = "1.0.0" as const;

export type RGBMediaSource = ReconstructionSource &
  ({ readonly kind: "rgb-image" } | { readonly kind: "rgb-video" });

export interface MediaPreparationSource {
  readonly descriptor: RGBMediaSource;
  open(): Promise<AsyncIterable<Uint8Array>>;
}

export interface MediaPreparationRequest {
  readonly jobId: string;
  readonly projectId: string;
  /** Exact durable job source manifest; orchestration supplies this after rights checks. */
  readonly sourceManifestSha256?: string;
  readonly sources: readonly MediaPreparationSource[];
}

export interface MediaPreparationPolicy {
  readonly frameIntervalMicroseconds: number;
  readonly maximumDecodedDurationMicroseconds: number;
  readonly maximumFramesPerSource: number;
  readonly maximumFramesTotal: number;
  readonly maximumFramePixels: number;
  readonly maximumOutputBytes: number;
  readonly maximumProbeBytes: number;
  readonly maximumSourceBytes: number;
  readonly maximumSourceCount: number;
  readonly maximumTemporaryBytes: number;
  readonly maximumVideoFramesPerSecond: number;
  readonly processTimeoutMilliseconds: number;
}

export const defaultMediaPreparationPolicy: Readonly<MediaPreparationPolicy> = Object.freeze({
  frameIntervalMicroseconds: 1_000_000,
  maximumDecodedDurationMicroseconds: 3_600_000_000,
  maximumFramesPerSource: 1_200,
  maximumFramesTotal: 10_000,
  maximumFramePixels: 50_000_000,
  maximumOutputBytes: 1_048_576,
  maximumProbeBytes: 1_048_576,
  maximumSourceBytes: 21_474_836_480,
  maximumSourceCount: 512,
  maximumTemporaryBytes: 4_294_967_296,
  maximumVideoFramesPerSecond: 240,
  processTimeoutMilliseconds: 120_000,
});

export type MediaPreparationSafeCode =
  | "CANCELLED"
  | "DECODED_TYPE_MISMATCH"
  | "DISK_LIMIT_EXCEEDED"
  | "DURATION_LIMIT_EXCEEDED"
  | "FRAME_LIMIT_EXCEEDED"
  | "FRAME_RATE_LIMIT_EXCEEDED"
  | "HASH_MISMATCH"
  | "MALFORMED_MEDIA"
  | "PIXEL_LIMIT_EXCEEDED"
  | "PRIVACY_REJECTED"
  | "PROCESS_FAILED"
  | "PROCESS_OUTPUT_LIMIT"
  | "PROCESS_TIMEOUT"
  | "SOURCE_LIMIT_EXCEEDED"
  | "SOURCE_SIZE_MISMATCH"
  | "UNSUPPORTED_MEDIA";

export class MediaPreparationError extends Error {
  readonly safeCode: MediaPreparationSafeCode;
  readonly retryable: boolean;

  constructor(
    safeCode: MediaPreparationSafeCode,
    options: { readonly cause?: unknown; readonly retryable?: boolean } = {},
  ) {
    // The nested decoder/process error can contain a temporary path or tool
    // output. Keep only a stable safe code at this boundary.
    super(`media-preparation-${safeCode.toLowerCase().replaceAll("_", "-")}`);
    this.name = "MediaPreparationError";
    this.safeCode = safeCode;
    this.retryable = options.retryable ?? false;
  }
}

export type MediaExecutable = "ffmpeg" | "ffprobe";

export interface MediaProcessPort {
  run(
    executable: MediaExecutable,
    arguments_: readonly string[],
    limits: ProcessLimits,
    signal?: AbortSignal,
  ): Promise<ProcessResult>;
}

export interface PrivacyReviewFrame {
  readonly frameId: string;
  readonly heightPixels: number;
  openSanitizedFrame(): AsyncIterable<Uint8Array>;
  readonly sourceAssetId: string;
  readonly timestampMicroseconds: number;
  readonly widthPixels: number;
}

export type PrivacyReviewDecision =
  | { readonly status: "not-required" }
  | { readonly status: "applied"; readonly replacementPng: Uint8Array }
  | { readonly status: "review-required" }
  | { readonly status: "rejected" };

export interface PrivacyReviewer {
  readonly reviewerId: string;
  readonly reviewerVersion: string;
  review(frame: PrivacyReviewFrame, signal?: AbortSignal): Promise<PrivacyReviewDecision>;
}

export class ReviewRequiredPrivacyReviewer implements PrivacyReviewer {
  readonly reviewerId = "manual-privacy-review";
  readonly reviewerVersion = "1.0.0";

  review(): Promise<PrivacyReviewDecision> {
    return Promise.resolve({ status: "review-required" });
  }
}

export interface PreparedFrameStream {
  readonly frameId: string;
  open(): AsyncIterable<Uint8Array>;
}

export interface PreparedMediaBundle {
  readonly frames: readonly PreparedFrameStream[];
  readonly manifest: MediaPreparationManifest;
  cleanup(): Promise<void>;
}

export interface DecodedMediaProbe {
  readonly codecName: string;
  readonly durationMicroseconds: number;
  readonly formatNames: readonly string[];
  readonly framesPerSecond: number;
  readonly heightPixels: number;
  readonly rotationDegrees: 0 | 90 | 180 | 270;
  readonly widthPixels: number;
}
