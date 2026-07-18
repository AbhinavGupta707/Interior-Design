import type {
  AcceptedBriefReference,
  Actor,
  CanonicalHomeSnapshot,
  DesignBrief,
  DesignConstraint,
  DesignOption,
  DesignOptionSet,
  InteriorAssetRef,
  ModelSnapshotRecord,
  OptionConfirmation,
  OptionJob,
  OptionSourceModelReference,
  OptionWorkingModelReference,
  confirmOptionRequestSchema,
  createOptionJobRequestSchema,
} from "@interior-design/contracts";
import type { z } from "zod";

import type { RequestCorrelation } from "../../correlation.js";

export type ConfirmOptionRequest = z.infer<typeof confirmOptionRequestSchema>;
export type CreateOptionJobRequest = z.infer<typeof createOptionJobRequestSchema>;

export interface DesignOptionClock {
  now(): Date;
}

export interface DesignOptionUuidFactory {
  randomUUID(): string;
}

export interface VerifiedOptionInputs {
  readonly brief: DesignBrief;
  readonly briefReference: AcceptedBriefReference;
  readonly currentProposed?: ModelSnapshotRecord;
  readonly source: ModelSnapshotRecord;
  readonly sourceReference: OptionSourceModelReference;
}

export interface DesignOptionSourceVerifier {
  findExactAcceptedInputs(
    tenantId: string,
    projectId: string,
    request: CreateOptionJobRequest,
  ): Promise<VerifiedOptionInputs | undefined>;
}

export interface ConstraintDerivationResult {
  readonly assetManifestSha256: string;
  readonly constraints: readonly DesignConstraint[];
}

export interface DesignConstraintDerivationPort {
  derive(input: {
    readonly brief: DesignBrief;
    readonly request: CreateOptionJobRequest;
    readonly source: ModelSnapshotRecord;
    readonly workingModel: OptionWorkingModelReference;
    readonly workingSnapshot: CanonicalHomeSnapshot;
  }): Promise<ConstraintDerivationResult>;
}

export interface DesignAssetVerificationPort {
  verifyExact(asset: InteriorAssetRef): Promise<boolean>;
}

interface MutationCommand {
  readonly actor: Actor;
  readonly correlation: RequestCorrelation;
  readonly idempotencyKey: string;
  readonly projectId: string;
}

export interface CreateOptionJobCommand extends MutationCommand {
  readonly acceptedBrief: DesignBrief;
  readonly assetManifestSha256: string;
  readonly constraints: readonly DesignConstraint[];
  readonly constraintsSha256: string;
  readonly jobId: string;
  readonly request: CreateOptionJobRequest;
  readonly requestSha256: string;
  readonly sourceSnapshot: ModelSnapshotRecord;
  readonly workingModel: OptionWorkingModelReference;
  readonly workingSnapshot: CanonicalHomeSnapshot;
}

export interface TransitionOptionJobCommand extends MutationCommand {
  readonly expectedVersion: number;
  readonly jobId: string;
}

export interface ConfirmOptionCommand {
  readonly actor: Actor;
  readonly correlation: RequestCorrelation;
  readonly jobId: string;
  readonly optionId: string;
  readonly projectId: string;
  readonly request: ConfirmOptionRequest;
  readonly requestSha256: string;
}

export type OptionWorkerStage = "deriving-constraints" | "generating" | "validating" | "publishing";

export interface LeasedOptionAttempt {
  readonly acceptedBrief: DesignBrief;
  readonly attempt: number;
  readonly constraints: readonly DesignConstraint[];
  readonly job: OptionJob;
  readonly leaseExpiresAt: string;
  readonly leaseToken: string;
  readonly sourceSnapshot: ModelSnapshotRecord;
  readonly tenantId: string;
  readonly workingSnapshot: CanonicalHomeSnapshot;
}

export interface ClaimOptionAttemptCommand {
  readonly leaseSeconds?: number;
  readonly workerId: string;
}

interface OptionLeaseCommand {
  readonly attempt: number;
  readonly expectedJobVersion: number;
  readonly jobId: string;
  readonly leaseToken: string;
  readonly projectId: string;
  readonly tenantId: string;
  readonly workerId: string;
}

export interface HeartbeatOptionAttemptCommand extends OptionLeaseCommand {
  readonly leaseSeconds?: number;
}

export interface AdvanceOptionAttemptCommand extends OptionLeaseCommand {
  readonly stage: OptionWorkerStage;
}

export interface PublishOptionSetCommand extends OptionLeaseCommand {
  readonly optionSet: DesignOptionSet;
  readonly options: readonly DesignOption[];
}

export interface AbstainOptionAttemptCommand extends OptionLeaseCommand {
  readonly safeCode: "NO_FEASIBLE_DIVERSE_SET";
}

export interface FailOptionAttemptCommand extends OptionLeaseCommand {
  readonly retryable: boolean;
  readonly safeCode:
    | "BRIEF_NOT_ACCEPTED"
    | "CONSTRAINTS_INFEASIBLE"
    | "MODEL_NOT_PROPOSED"
    | "SOURCE_CHANGED"
    | "RESOURCE_LIMIT"
    | "INTERNAL_FAILURE";
}

export type AcknowledgeOptionCancellationCommand = OptionLeaseCommand;

export interface DesignOptionConfirmationResult {
  readonly confirmation: OptionConfirmation;
  readonly replayed: boolean;
}

export interface DesignOptionRepository {
  acknowledgeCancellation(command: AcknowledgeOptionCancellationCommand): Promise<OptionJob>;
  abstainAttempt(command: AbstainOptionAttemptCommand): Promise<OptionJob>;
  advanceAttempt(command: AdvanceOptionAttemptCommand): Promise<OptionJob>;
  cancelJob(
    command: TransitionOptionJobCommand,
  ): Promise<{ readonly job: OptionJob; readonly replayed: boolean }>;
  claimNext(command: ClaimOptionAttemptCommand): Promise<LeasedOptionAttempt | undefined>;
  confirmOption(command: ConfirmOptionCommand): Promise<DesignOptionConfirmationResult>;
  createJob(
    command: CreateOptionJobCommand,
  ): Promise<{ readonly job: OptionJob; readonly replayed: boolean }>;
  failAttempt(command: FailOptionAttemptCommand): Promise<OptionJob>;
  findJob(tenantId: string, projectId: string, jobId: string): Promise<OptionJob | undefined>;
  findOption(
    tenantId: string,
    projectId: string,
    jobId: string,
    optionId: string,
  ): Promise<DesignOption | undefined>;
  heartbeatAttempt(command: HeartbeatOptionAttemptCommand): Promise<LeasedOptionAttempt>;
  listJobs(tenantId: string, projectId: string): Promise<readonly OptionJob[]>;
  listOptions(
    tenantId: string,
    projectId: string,
    jobId: string,
  ): Promise<{ readonly optionSet?: DesignOptionSet; readonly options: readonly DesignOption[] }>;
  publishOptions(command: PublishOptionSetCommand): Promise<OptionJob>;
  retryJob(
    command: TransitionOptionJobCommand,
  ): Promise<{ readonly job: OptionJob; readonly replayed: boolean }>;
}

export interface DesignOptionTelemetry {
  record(event: {
    readonly count?: number;
    readonly outcome: "accepted" | "abstained" | "conflict" | "failed" | "replayed";
    readonly stage:
      "cancel" | "confirm" | "create" | "lease" | "publish" | "read" | "retry" | OptionWorkerStage;
  }): void;
}
