import type {
  MediaPreparationManifest,
  ReconstructionResult,
  ReconstructionSource,
} from "@interior-design/contracts";
import type {
  LeasedReconstructionAttempt,
  ReconstructionRepository,
} from "@interior-design/platform-api/reconstruction";

import type { PreparedMediaBundle } from "../media-prep/index.js";

export type ReconstructionProcessingQueue = Pick<
  ReconstructionRepository,
  "acknowledgeCancellation" | "advanceAttempt" | "claimNext" | "failAttempt" | "publishResult"
>;

export interface LeasedReconstructionSource extends ReconstructionSource {
  readonly objectKey: string;
}

export interface ReconstructionSourceLoader {
  load(
    lease: LeasedReconstructionAttempt,
    signal?: AbortSignal,
  ): Promise<readonly LeasedReconstructionSource[]>;
}

export interface ReconstructionProcessor {
  abstain(
    lease: LeasedReconstructionAttempt,
    prepared: MediaPreparationManifest | undefined,
    safeCode: string,
    signal?: AbortSignal,
  ): Promise<ReconstructionResult>;
  process(
    lease: LeasedReconstructionAttempt,
    prepared: PreparedMediaBundle,
    signal?: AbortSignal,
  ): Promise<ReconstructionResult>;
}

export class ReconstructionWorkerError extends Error {
  readonly retryable: boolean;
  readonly safeCode: string;

  constructor(
    safeCode: string,
    options: { readonly cause?: unknown; readonly retryable?: boolean } = {},
  ) {
    super(`reconstruction-worker-${safeCode.toLowerCase().replaceAll("_", "-")}`, {
      cause: options.cause,
    });
    this.name = "ReconstructionWorkerError";
    this.safeCode = safeCode;
    this.retryable = options.retryable ?? false;
  }
}
