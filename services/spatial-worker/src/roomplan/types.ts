import type {
  CaptureArtifactKind,
  CaptureProposalResult,
  CreateCapturePackageRequest,
} from "@interior-design/contracts";

export type RoomPlanProcessingFailureCode =
  "conversion-failed" | "resource-limit" | "source-mismatch" | "storage-unavailable";

export interface LeasedCaptureArtifact {
  readonly artifactId: string;
  readonly byteSize: number;
  readonly contentType: "application/json" | "model/vnd.usdz+zip";
  readonly kind: CaptureArtifactKind;
  readonly objectKey: string;
  readonly roomId?: string;
  readonly sha256: string;
}

export interface LeasedRoomPlanCapture {
  readonly artifacts: readonly LeasedCaptureArtifact[];
  readonly attempt: number;
  readonly attemptId: string;
  readonly captureSessionId: string;
  readonly leaseExpiresAt: string;
  readonly leaseToken: string;
  readonly manifest: CreateCapturePackageRequest;
  readonly packageId: string;
  readonly packageManifestSha256: string;
  readonly projectId: string;
  readonly tenantId: string;
}

export interface RoomPlanProcessingQueue {
  acknowledgeCancellation(job: LeasedRoomPlanCapture, workerId: string): Promise<boolean>;
  claimNext(
    workerId: string,
    leaseMilliseconds: number,
  ): Promise<LeasedRoomPlanCapture | undefined>;
  fail(
    job: LeasedRoomPlanCapture,
    workerId: string,
    code: RoomPlanProcessingFailureCode,
    retryable: boolean,
  ): Promise<boolean>;
  heartbeat(
    job: LeasedRoomPlanCapture,
    workerId: string,
    leaseMilliseconds: number,
  ): Promise<"cancel-requested" | "leased" | "lost">;
  publish(
    job: LeasedRoomPlanCapture,
    workerId: string,
    result: CaptureProposalResult,
  ): Promise<boolean>;
}

export class RoomPlanSourceError extends Error {
  readonly code: "resource-limit" | "source-mismatch" | "storage-unavailable";
  readonly retryable: boolean;

  constructor(
    code: "resource-limit" | "source-mismatch" | "storage-unavailable",
    retryable = false,
    options?: ErrorOptions,
  ) {
    super(`roomplan-source-${code}`, options);
    this.name = "RoomPlanSourceError";
    this.code = code;
    this.retryable = retryable;
  }
}
