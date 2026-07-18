import type {
  Actor,
  CreateSceneJobRequest,
  ModelSnapshotRecord,
  SceneCompileConfiguration,
  SceneJob,
  SceneJobState,
  SceneManifest,
  SceneRecord,
  SceneSnapshotReference,
} from "@interior-design/contracts";

import type { RequestCorrelation } from "../../correlation.js";

export interface SceneClock {
  now(): Date;
}

export interface SceneUuidFactory {
  randomUUID(): string;
}

export interface SceneCompilerDescriptor {
  readonly name: "interior-design-scene-compiler";
  readonly version: string;
}

export interface SceneSnapshotVerifier {
  findExactCommitted(
    tenantId: string,
    projectId: string,
    reference: SceneSnapshotReference,
  ): Promise<ModelSnapshotRecord | undefined>;
}

interface UserMutationCommand {
  readonly actor: Actor;
  readonly correlation: RequestCorrelation;
  readonly idempotencyKey: string;
  readonly projectId: string;
}

export interface CreateSceneJobCommand extends UserMutationCommand {
  readonly cacheKeySha256: string;
  readonly cacheContextSha256?: string;
  readonly compiler: SceneCompilerDescriptor;
  readonly configurationSha256: string;
  readonly request: CreateSceneJobRequest;
  readonly requestSha256: string;
  readonly requestedJobId?: string;
  readonly sourceSnapshotVersion: number;
}

export interface TransitionSceneJobCommand extends UserMutationCommand {
  readonly expectedVersion: number;
  readonly sceneJobId: string;
}

export type SceneWorkerStage = Extract<SceneJobState, "leased" | "compiling" | "publishing">;

export interface ClaimSceneAttemptCommand {
  readonly compiler: SceneCompilerDescriptor;
  readonly leaseSeconds?: number;
  readonly workerId: string;
}

export interface LeasedSceneAttempt {
  readonly attempt: number;
  readonly cacheKeySha256: string;
  readonly compiler: SceneCompilerDescriptor;
  readonly configurationSha256: string;
  readonly jobId: string;
  readonly leaseExpiresAt: string;
  readonly leaseToken: string;
  readonly projectId: string;
  readonly request: CreateSceneJobRequest;
  readonly stage: SceneWorkerStage;
  readonly tenantId: string;
}

interface SceneLeaseCommand {
  readonly attempt: number;
  readonly jobId: string;
  readonly leaseToken: string;
  readonly projectId: string;
  readonly tenantId: string;
  readonly workerId: string;
}

export interface HeartbeatSceneAttemptCommand extends SceneLeaseCommand {
  readonly stage: SceneWorkerStage;
}

export type AcknowledgeSceneCancellationCommand = SceneLeaseCommand;

export interface FailSceneAttemptCommand extends SceneLeaseCommand {
  readonly retryable: boolean;
  readonly safeCode: string;
}

export interface PersistScenePublicationCommand extends SceneLeaseCommand {
  readonly artifact: {
    readonly byteSize: number;
    readonly glbSha256: string;
    readonly manifestSha256: string;
    readonly mimeType: "model/gltf-binary";
  };
  readonly manifest: SceneManifest;
}

export interface RecordSceneAccessCommand {
  readonly actor: Actor;
  readonly correlation: RequestCorrelation;
  readonly jobId: string;
  readonly projectId: string;
  readonly sceneId: string;
}

export interface SceneRepository {
  acknowledgeCancellation(command: AcknowledgeSceneCancellationCommand): Promise<void>;
  assertPublicationLease(command: SceneLeaseCommand): Promise<void>;
  cancelJob(
    command: TransitionSceneJobCommand,
  ): Promise<{ readonly job: SceneJob; readonly replayed: boolean }>;
  claimNext(command: ClaimSceneAttemptCommand): Promise<LeasedSceneAttempt | undefined>;
  createJob(
    command: CreateSceneJobCommand,
  ): Promise<{ readonly job: SceneJob; readonly replayed: boolean }>;
  failAttempt(command: FailSceneAttemptCommand): Promise<SceneJob>;
  findJob(tenantId: string, projectId: string, sceneJobId: string): Promise<SceneJob | undefined>;
  findScene(
    tenantId: string,
    projectId: string,
    sceneJobId: string,
  ): Promise<SceneRecord | undefined>;
  heartbeat(command: HeartbeatSceneAttemptCommand): Promise<SceneJob>;
  listJobs(tenantId: string, projectId: string): Promise<readonly SceneJob[]>;
  publishScene(command: PersistScenePublicationCommand): Promise<SceneJob>;
  recordAccess(command: RecordSceneAccessCommand): Promise<void>;
  retryJob(
    command: TransitionSceneJobCommand,
  ): Promise<{ readonly job: SceneJob; readonly replayed: boolean }>;
}

export interface SceneTelemetry {
  record(event: {
    readonly outcome: "accepted" | "conflict" | "denied" | "failed" | "replayed";
    readonly stage:
      "access" | "cancel" | "create" | "lease" | "publish" | "retry" | SceneWorkerStage;
  }): void;
}

export interface SceneCompilationOutput {
  readonly glb: Uint8Array;
  readonly manifest: SceneManifest;
}

export interface PublishCompiledSceneCommand extends SceneLeaseCommand {
  readonly output: SceneCompilationOutput;
}

export type LoadSceneCompilationSourceCommand = SceneLeaseCommand;

/**
 * Narrow integration surface for the C10-L1 compiler. It supplies an exact committed snapshot and
 * accepts only real GLB bytes plus a frozen manifest; it exposes no storage locator or credential.
 */
export interface SceneCompilerWorkerPort {
  acknowledgeCancellation(command: AcknowledgeSceneCancellationCommand): Promise<void>;
  claimNext(command: ClaimSceneAttemptCommand): Promise<LeasedSceneAttempt | undefined>;
  fail(command: FailSceneAttemptCommand): Promise<SceneJob>;
  heartbeat(command: HeartbeatSceneAttemptCommand): Promise<SceneJob>;
  loadSource(command: LoadSceneCompilationSourceCommand): Promise<ModelSnapshotRecord>;
  publish(command: PublishCompiledSceneCommand): Promise<SceneJob>;
}

export function compilerConfigurationIdentity(input: {
  readonly compiler: SceneCompilerDescriptor;
  readonly configuration: SceneCompileConfiguration;
  readonly snapshotSha256: string;
}): object {
  return {
    compiler: input.compiler,
    configuration: input.configuration,
    snapshotSha256: input.snapshotSha256,
  };
}
