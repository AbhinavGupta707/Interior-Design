import type { renderArtifactAccessSchema } from "@interior-design/contracts";
import type {
  Actor,
  CreateRenderJobRequest,
  EnhancementResult,
  RenderArtifact,
  RenderArtifactRole,
  RenderJob,
  RenderJobState,
  RenderOutputManifest,
  RenderResult,
  RenderSourceReference,
} from "@interior-design/contracts";

export type RenderArtifactAccess = ReturnType<typeof renderArtifactAccessSchema.parse>;

import type { RequestCorrelation } from "../../correlation.js";

export interface RenderClock {
  now(): Date;
}

export interface RenderUuidFactory {
  randomUUID(): string;
}

export type RenderWorkerStage = Extract<
  RenderJobState,
  "preparing" | "publishing-safe" | "rendering-safe" | "validating-safe"
>;

export interface ResolvedRenderSource {
  readonly cacheSourceIdentitySha256: string;
  readonly estimatedJobBytes: number;
  readonly requiredCapability: string;
  readonly source: RenderSourceReference;
}

/**
 * Server-owned authority boundary. It accepts selection IDs only and must resolve the exact
 * succeeded C10 scene, immutable GLB extras, C13 revision/release and active rights itself.
 */
export interface RenderSourceResolver {
  resolveForNewJob(
    tenantId: string,
    projectId: string,
    request: CreateRenderJobRequest,
  ): Promise<ResolvedRenderSource | undefined>;
  revalidatePinnedSource(
    tenantId: string,
    projectId: string,
    source: RenderSourceReference,
  ): Promise<boolean>;
}

interface UserCommand {
  readonly actor: Actor;
  readonly correlation: RequestCorrelation;
  readonly idempotencyKey: string;
  readonly projectId: string;
}

export interface CreateRenderJobCommand extends UserCommand {
  readonly cacheIdentitySha256: string;
  readonly enhancementProviderEnabled: boolean;
  readonly request: CreateRenderJobRequest;
  readonly requestSha256: string;
  readonly requestedJobId?: string;
  readonly resolved: ResolvedRenderSource;
}

export interface TransitionRenderJobCommand extends UserCommand {
  readonly expectedVersion: number;
  readonly jobId: string;
}

export interface RequestEnhancementCommand extends UserCommand {
  readonly expectedVersion: number;
  readonly jobId: string;
  readonly providerEnabled: boolean;
}

export interface ClaimRenderJobCommand {
  readonly capabilities: readonly string[];
  readonly freeBytes: number;
  readonly leaseSeconds: number;
  readonly volumeId: string;
  readonly workerId: string;
}

export interface LeasedRenderJob {
  readonly attempt: number;
  readonly cacheIdentitySha256: string;
  readonly estimatedJobBytes: number;
  readonly jobId: string;
  readonly leaseExpiresAt: string;
  readonly leaseToken: string;
  readonly projectId: string;
  readonly request: CreateRenderJobRequest;
  readonly requiredCapability: string;
  readonly resultId: string;
  readonly source: RenderSourceReference;
  readonly stage: RenderWorkerStage;
  readonly tenantId: string;
  readonly volumeId: string;
}

interface LeaseCommand {
  readonly attempt: number;
  readonly jobId: string;
  readonly leaseToken: string;
  readonly projectId: string;
  readonly tenantId: string;
  readonly workerId: string;
}

export interface HeartbeatRenderJobCommand extends LeaseCommand {
  readonly freeBytes: number;
  readonly stage: RenderWorkerStage;
}

export type AcknowledgeRenderCancellationCommand = LeaseCommand;

export interface FailRenderJobCommand extends LeaseCommand {
  readonly retryable: boolean;
  readonly safeCode: string;
}

export interface PublishedArtifact {
  readonly artifact: RenderArtifact;
  /** Never returned by an API and never admitted to logs/audit/outbox payloads. */
  readonly objectKey: string;
}

export interface PublishRenderResultCommand extends LeaseCommand {
  readonly artifacts: readonly PublishedArtifact[];
  readonly manifest: RenderOutputManifest;
  readonly manifestSha256: string;
  readonly resultId: string;
}

export interface PublishSafeRenderBundleCommand extends LeaseCommand {
  readonly artifactBytes: ReadonlyMap<RenderArtifactRole, Uint8Array>;
  readonly manifest: RenderOutputManifest;
  readonly manifestBytes: Uint8Array;
  readonly manifestSha256: string;
  readonly resultId: string;
}

export interface RenderCapabilities {
  readonly acceptingNewJobs: boolean;
  readonly enhancementProvider: "disabled" | "enabled";
  readonly hardwareEvidence: "deferred" | "verified-authorised-host";
  readonly profiles: readonly {
    readonly available: boolean;
    readonly capability: string;
    readonly profileId: CreateRenderJobRequest["profileId"];
    readonly reason?: string;
  }[];
}

export interface RecordArtifactAccessCommand {
  readonly actor: Actor;
  readonly artifactId: string;
  readonly correlation: RequestCorrelation;
  readonly jobId: string;
  readonly projectId: string;
  readonly resultId: string;
}

export interface StoredRenderArtifact {
  readonly artifact: RenderArtifact;
  readonly manifestSha256: string;
  readonly objectKey: string;
  readonly resultId: string;
}

export interface RenderEnhancementRecord {
  readonly attempt: number;
  readonly baseArtifactSha256: string;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly id: string;
  readonly projectId: string;
  readonly renderJobId: string;
  readonly result?: EnhancementResult;
  readonly safeCode?: string;
  readonly state:
    "cancelled" | "disabled" | "failed" | "queued" | "rejected" | "running" | "succeeded";
  readonly updatedAt: string;
  readonly version: number;
}

export interface RenderRepository {
  acknowledgeCancellation(command: AcknowledgeRenderCancellationCommand): Promise<void>;
  assertLease(command: LeaseCommand): Promise<void>;
  cancelJob(
    command: TransitionRenderJobCommand,
  ): Promise<{ readonly job: RenderJob; readonly replayed: boolean }>;
  claimNext(command: ClaimRenderJobCommand): Promise<LeasedRenderJob | undefined>;
  createJob(
    command: CreateRenderJobCommand,
  ): Promise<{ readonly job: RenderJob; readonly replayed: boolean }>;
  failAttempt(command: FailRenderJobCommand): Promise<RenderJob>;
  findArtifact(
    tenantId: string,
    projectId: string,
    jobId: string,
    artifactId: string,
  ): Promise<StoredRenderArtifact | undefined>;
  findEnhancement(
    tenantId: string,
    projectId: string,
    jobId: string,
  ): Promise<RenderEnhancementRecord | undefined>;
  findJob(tenantId: string, projectId: string, jobId: string): Promise<RenderJob | undefined>;
  findPinnedSource(
    tenantId: string,
    projectId: string,
    jobId: string,
  ): Promise<RenderSourceReference | undefined>;
  findResult(tenantId: string, projectId: string, jobId: string): Promise<RenderResult | undefined>;
  heartbeat(command: HeartbeatRenderJobCommand): Promise<RenderJob>;
  listJobs(tenantId: string, projectId: string): Promise<readonly RenderJob[]>;
  publishResult(command: PublishRenderResultCommand): Promise<RenderJob>;
  recordArtifactAccess(command: RecordArtifactAccessCommand): Promise<void>;
  requestEnhancement(
    command: RequestEnhancementCommand,
  ): Promise<{ readonly enhancement: RenderEnhancementRecord; readonly replayed: boolean }>;
  retryJob(
    command: TransitionRenderJobCommand,
  ): Promise<{ readonly job: RenderJob; readonly replayed: boolean }>;
}

export interface PutRenderObjectInput {
  readonly bytes: Uint8Array;
  readonly mediaType: RenderArtifact["mediaType"];
  readonly role: RenderArtifactRole;
  readonly sha256: string;
}

export interface RenderObjectStorage {
  putImmutable(input: PutRenderObjectInput): Promise<{ readonly objectKey: string }>;
  readiness(): Promise<void>;
  signExactAccess(input: {
    readonly artifact: RenderArtifact;
    readonly expiresAt: Date;
    readonly manifestSha256: string;
    readonly objectKey: string;
    readonly resultId: string;
  }): Promise<Pick<RenderArtifactAccess, "expiresAt" | "url">>;
}

export interface RenderTelemetry {
  record(event: {
    readonly outcome: "accepted" | "conflict" | "denied" | "failed" | "replayed";
    readonly stage:
      | "access"
      | "cancel"
      | "claim"
      | "create"
      | "enhancement"
      | "publish"
      | "retry"
      | RenderWorkerStage;
  }): void;
}
