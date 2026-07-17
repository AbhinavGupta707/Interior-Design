import type {
  CanonicalHomeSnapshot,
  CreateFusionJobRequest,
  FusionDiscrepancy,
  FusionProposal,
  FusionRegistrationResult,
  FusionSource,
} from "@interior-design/contracts";
import type { fusionCoverageSchema } from "@interior-design/contracts";
import type { z } from "zod";

export type FusionCoverage = z.infer<typeof fusionCoverageSchema>;

export type FusionWorkerStage = "registering" | "fitting" | "comparing";

export interface LeasedFusionAttempt {
  readonly attempt: number;
  readonly jobId: string;
  readonly leaseExpiresAt: string;
  readonly leaseToken: string;
  readonly projectId: string;
  readonly request: CreateFusionJobRequest;
  readonly sourceManifestSha256: string;
  readonly stage: FusionWorkerStage;
  readonly tenantId: string;
}

export interface FusionSourcePayload {
  readonly descriptor: FusionSource;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface FusionAcquisitionBundle {
  readonly baseSnapshot: CanonicalHomeSnapshot;
  readonly sources: readonly FusionSourcePayload[];
}

export interface FusionSourceAcquisitionPort {
  acquire(lease: LeasedFusionAttempt, signal?: AbortSignal): Promise<FusionAcquisitionBundle>;
}

export interface FusionRegistrationProducerPort {
  register(
    input: {
      readonly anchorGroups: CreateFusionJobRequest["anchorGroups"];
      readonly limits: FusionProducerLimits;
      readonly sources: readonly FusionSourcePayload[];
    },
    signal?: AbortSignal,
  ): Promise<readonly FusionRegistrationResult[]>;
}

export type FusionSemanticOutput =
  | {
      readonly candidateSnapshot: CanonicalHomeSnapshot;
      readonly candidateSnapshotSha256: string;
      readonly coverage: FusionCoverage;
      readonly discrepancies: readonly FusionDiscrepancy[];
      readonly status: "full-house-proposal" | "partial-proposal";
    }
  | {
      readonly coverage: FusionCoverage;
      readonly discrepancies: readonly FusionDiscrepancy[];
      readonly findings: readonly {
        readonly code: string;
        readonly detail: string;
        readonly severity: "information" | "warning" | "error";
      }[];
      readonly safeCode: string;
      readonly status: "abstained";
    };

export interface FusionSemanticProducerPort {
  fit(
    input: {
      readonly baseSnapshot: CanonicalHomeSnapshot;
      readonly baseSnapshotReference: CreateFusionJobRequest["baseSnapshot"];
      readonly inferencePolicy: "label-and-expose";
      readonly jobId: string;
      readonly limits: FusionProducerLimits;
      readonly projectId: string;
      readonly registrations: readonly FusionRegistrationResult[];
      readonly sources: readonly FusionSourcePayload[];
    },
    signal?: AbortSignal,
  ): Promise<FusionSemanticOutput>;
}

export interface FusionProducerLimits {
  readonly maximumDiscrepancies: 10_000;
  readonly maximumOutputBytes: number;
  readonly maximumSources: 32;
  readonly timeoutMilliseconds: 3_600_000;
}

export interface FusionProcessingQueue {
  acknowledgeCancellation(command: FusionLeaseCommand): Promise<void>;
  advance(command: FusionLeaseCommand & { readonly stage: FusionWorkerStage }): Promise<void>;
  claim(command: {
    readonly leaseSeconds: number;
    readonly workerId: string;
  }): Promise<LeasedFusionAttempt | undefined>;
  fail(
    command: FusionLeaseCommand & {
      readonly retryable: boolean;
      readonly safeCode: string;
    },
  ): Promise<void>;
  heartbeat(command: FusionLeaseCommand): Promise<"active" | "cancel-requested">;
  publish(command: FusionLeaseCommand & { readonly proposal: FusionProposal }): Promise<void>;
}

export interface FusionLeaseCommand {
  readonly attempt: number;
  readonly jobId: string;
  readonly leaseToken: string;
  readonly projectId: string;
  readonly tenantId: string;
  readonly workerId: string;
}

export class FusionWorkerError extends Error {
  readonly retryable: boolean;
  readonly safeCode: string;

  constructor(
    safeCode: string,
    options: { readonly cause?: unknown; readonly retryable?: boolean } = {},
  ) {
    super(`fusion-worker-${safeCode.toLowerCase().replaceAll("_", "-")}`, {
      cause: options.cause,
    });
    this.name = "FusionWorkerError";
    this.safeCode = safeCode;
    this.retryable = options.retryable ?? false;
  }
}
