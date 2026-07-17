import type {
  Actor,
  CreateFusionJobRequest,
  FusionJob,
  FusionJobState,
  FusionOperationDraft,
  FusionProposal,
  FusionSource,
  ModelBranch,
  ModelSnapshotRecord,
} from "@interior-design/contracts";
import type {
  createFusionOperationDraftRequestSchema,
  fusionDiscrepancyDecisionSchema,
  reviewFusionDiscrepanciesRequestSchema,
} from "@interior-design/contracts";
import type { z } from "zod";

import type { RequestCorrelation } from "../../correlation.js";

export type ReviewFusionDiscrepanciesRequest = z.infer<
  typeof reviewFusionDiscrepanciesRequestSchema
>;
export type CreateFusionOperationDraftRequest = z.infer<
  typeof createFusionOperationDraftRequestSchema
>;
export type FusionDiscrepancyDecision = z.infer<typeof fusionDiscrepancyDecisionSchema>;

export interface FusionClock {
  now(): Date;
}

export interface FusionUuidFactory {
  randomUUID(): string;
}

export interface VerifiedFusionSource {
  readonly elementCount: number;
  readonly evidenceState: FusionSource["evidenceState"];
  readonly kind: FusionSource["kind"];
  readonly projectId: string;
  readonly referenceId: string;
  readonly rightsActive: boolean;
  readonly schemaVersion: string;
  readonly sha256: string;
  readonly tenantId: string;
}

export interface FusionSourceVerifier {
  verify(
    tenantId: string,
    projectId: string,
    source: FusionSource,
  ): Promise<VerifiedFusionSource | undefined>;
}

export interface FusionBaseVerifier {
  findExact(
    tenantId: string,
    projectId: string,
    base: CreateFusionJobRequest["baseSnapshot"],
  ): Promise<ModelSnapshotRecord | undefined>;
}

interface UserMutationCommand {
  readonly actor: Actor;
  readonly correlation: RequestCorrelation;
  readonly idempotencyKey: string;
  readonly projectId: string;
}

export interface CreateFusionJobCommand extends UserMutationCommand {
  readonly request: CreateFusionJobRequest;
  readonly requestSha256: string;
  readonly sourceManifestSha256: string;
}

export interface TransitionFusionJobCommand extends UserMutationCommand {
  readonly expectedVersion: number;
  readonly fusionJobId: string;
}

export interface ReviewFusionDiscrepanciesCommand extends UserMutationCommand {
  readonly fusionJobId: string;
  readonly request: ReviewFusionDiscrepanciesRequest;
}

export interface CreateFusionOperationDraftCommand extends UserMutationCommand {
  readonly fusionJobId: string;
  readonly request: CreateFusionOperationDraftRequest;
}

export type FusionWorkerStage = Extract<FusionJobState, "registering" | "fitting" | "comparing">;

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

export interface ClaimFusionAttemptCommand {
  readonly leaseSeconds?: number;
  readonly workerId: string;
}

interface FusionLeaseCommand {
  readonly attempt: number;
  readonly jobId: string;
  readonly leaseToken: string;
  readonly projectId: string;
  readonly tenantId: string;
  readonly workerId: string;
}

export interface AdvanceFusionAttemptCommand extends FusionLeaseCommand {
  readonly stage: FusionWorkerStage;
}

export interface PublishFusionProposalCommand extends FusionLeaseCommand {
  readonly proposal: FusionProposal;
}

export interface FailFusionAttemptCommand extends FusionLeaseCommand {
  readonly retryable: boolean;
  readonly safeCode: string;
}

export type AcknowledgeFusionCancellationCommand = FusionLeaseCommand;

export interface WithdrawFusionSourceCommand {
  readonly kind: FusionSource["kind"];
  readonly projectId: string;
  readonly reasonCode: "RIGHTS_WITHDRAWN";
  readonly referenceId: string;
  readonly tenantId: string;
}

export interface FusionReviewResult {
  readonly decisions: readonly FusionDiscrepancyDecision[];
  readonly proposal: FusionProposal;
  readonly replayed: boolean;
}

export interface FusionDraftResult {
  readonly draft: FusionOperationDraft;
  readonly replayed: boolean;
}

export interface FusionRepository {
  acknowledgeCancellation(command: AcknowledgeFusionCancellationCommand): Promise<void>;
  advanceAttempt(command: AdvanceFusionAttemptCommand): Promise<FusionJob>;
  cancelJob(
    command: TransitionFusionJobCommand,
  ): Promise<{ readonly job: FusionJob; readonly replayed: boolean }>;
  claimNext(command: ClaimFusionAttemptCommand): Promise<LeasedFusionAttempt | undefined>;
  createJob(
    command: CreateFusionJobCommand,
  ): Promise<{ readonly job: FusionJob; readonly replayed: boolean }>;
  createOperationDraft(command: CreateFusionOperationDraftCommand): Promise<FusionDraftResult>;
  failAttempt(command: FailFusionAttemptCommand): Promise<FusionJob>;
  findBranch(
    tenantId: string,
    projectId: string,
    branchId: string,
  ): Promise<ModelBranch | undefined>;
  findJob(tenantId: string, projectId: string, fusionJobId: string): Promise<FusionJob | undefined>;
  findProposal(
    tenantId: string,
    projectId: string,
    fusionJobId: string,
  ): Promise<FusionProposal | undefined>;
  listJobs(tenantId: string, projectId: string): Promise<readonly FusionJob[]>;
  publishProposal(command: PublishFusionProposalCommand): Promise<FusionJob>;
  retryJob(
    command: TransitionFusionJobCommand,
  ): Promise<{ readonly job: FusionJob; readonly replayed: boolean }>;
  reviewDiscrepancies(command: ReviewFusionDiscrepanciesCommand): Promise<FusionReviewResult>;
  withdrawSource(command: WithdrawFusionSourceCommand): Promise<number>;
}

export interface FusionTelemetry {
  record(event: {
    readonly outcome: "accepted" | "conflict" | "denied" | "failed" | "replayed";
    readonly stage:
      "cancel" | "create" | "draft" | "lease" | "publish" | "retry" | "review" | FusionWorkerStage;
  }): void;
}
