import type {
  Actor,
  CreateReconstructionJobRequest,
  ReconstructionJob,
  ReconstructionJobState,
  ReconstructionResult,
  ReconstructionSource,
} from "@interior-design/contracts";

import type { RequestCorrelation } from "../../correlation.js";

export interface ReconstructionClock {
  now(): Date;
}

export interface ReconstructionUuidFactory {
  randomUUID(): string;
}

export interface EligibleReconstructionSource {
  readonly assetId: string;
  readonly byteSize: number;
  readonly detectedMimeType?: string;
  readonly projectId: string;
  readonly rights: {
    readonly basis: string;
    readonly serviceProcessingConsent: boolean;
    readonly trainingUseConsent: string;
  };
  readonly sha256: string;
  readonly status: string;
  readonly tenantId: string;
  readonly withdrawn: boolean;
}

interface UserMutationCommand {
  readonly actor: Actor;
  readonly correlation: RequestCorrelation;
  readonly idempotencyKey: string;
  readonly projectId: string;
}

export interface CreateReconstructionJobCommand extends UserMutationCommand {
  readonly request: CreateReconstructionJobRequest;
  readonly requestSha256: string;
  readonly sourceManifestSha256: string;
}

export interface TransitionReconstructionJobCommand extends UserMutationCommand {
  readonly expectedVersion: number;
  readonly reconstructionJobId: string;
}

export type ReconstructionWorkerStage = Exclude<
  ReconstructionJobState,
  "abstained" | "cancel-requested" | "cancelled" | "completed" | "created" | "failed"
>;

export interface LeasedReconstructionAttempt {
  readonly attempt: number;
  readonly jobId: string;
  readonly leaseExpiresAt: string;
  readonly leaseToken: string;
  readonly projectId: string;
  readonly request: CreateReconstructionJobRequest;
  readonly sourceManifestSha256: string;
  readonly stage: ReconstructionWorkerStage;
  readonly tenantId: string;
}

export interface ClaimReconstructionAttemptCommand {
  readonly leaseSeconds?: number;
  readonly workerId: string;
}

interface WorkerLeaseCommand {
  readonly attempt: number;
  readonly jobId: string;
  readonly leaseToken: string;
  readonly workerId: string;
}

export interface AdvanceReconstructionAttemptCommand extends WorkerLeaseCommand {
  readonly stage: ReconstructionWorkerStage;
}

export interface PublishReconstructionResultCommand extends WorkerLeaseCommand {
  readonly result: ReconstructionResult;
}

export interface FailReconstructionAttemptCommand extends WorkerLeaseCommand {
  readonly retryable: boolean;
  readonly safeCode: string;
}

export type AcknowledgeReconstructionCancellationCommand = WorkerLeaseCommand;

export interface WithdrawReconstructionSourceCommand {
  readonly assetId: string;
  readonly projectId: string;
  readonly reasonCode: "RIGHTS_WITHDRAWN";
  readonly tenantId: string;
}

export interface ReconstructionRepository {
  acknowledgeCancellation(command: AcknowledgeReconstructionCancellationCommand): Promise<void>;
  advanceAttempt(command: AdvanceReconstructionAttemptCommand): Promise<ReconstructionJob>;
  cancelJob(
    command: TransitionReconstructionJobCommand,
  ): Promise<{ readonly job: ReconstructionJob; readonly replayed: boolean }>;
  claimNext(
    command: ClaimReconstructionAttemptCommand,
  ): Promise<LeasedReconstructionAttempt | undefined>;
  createJob(
    command: CreateReconstructionJobCommand,
  ): Promise<{ readonly job: ReconstructionJob; readonly replayed: boolean }>;
  failAttempt(command: FailReconstructionAttemptCommand): Promise<ReconstructionJob>;
  findJob(
    tenantId: string,
    projectId: string,
    reconstructionJobId: string,
  ): Promise<ReconstructionJob | undefined>;
  findResult(
    tenantId: string,
    projectId: string,
    reconstructionJobId: string,
  ): Promise<ReconstructionResult | undefined>;
  findSource(
    tenantId: string,
    projectId: string,
    assetId: string,
  ): Promise<EligibleReconstructionSource | undefined>;
  listJobs(tenantId: string, projectId: string): Promise<readonly ReconstructionJob[]>;
  publishResult(command: PublishReconstructionResultCommand): Promise<ReconstructionJob>;
  retryJob(
    command: TransitionReconstructionJobCommand,
  ): Promise<{ readonly job: ReconstructionJob; readonly replayed: boolean }>;
  withdrawSource(command: WithdrawReconstructionSourceCommand): Promise<number>;
}

export interface ReconstructionTelemetry {
  record(event: {
    readonly outcome: "accepted" | "conflict" | "denied" | "failed" | "replayed";
    readonly stage: "cancel" | "create" | "lease" | "publish" | "retry" | ReconstructionWorkerStage;
  }): void;
}

export interface ParsedReconstructionSource extends EligibleReconstructionSource {
  readonly detectedMimeType: ReconstructionSource["detectedMimeType"];
  readonly rights: CreateReconstructionJobRequest["rights"];
  readonly status: "ready";
  readonly withdrawn: false;
}
