import {
  c10ScenePolicy,
  createSceneJobRequestSchema,
  sceneAccessResponseSchema,
  sceneManifestSchema,
  type SceneAccessResponse,
  type SceneJob,
  type SceneRecord,
  type SceneSnapshotReference,
} from "@interior-design/contracts";

import { notFound } from "../identity/http.js";
import { requestHash } from "../projects/idempotency.js";
import { sceneConflict, sceneInvalid, sceneUnavailable } from "./errors.js";
import { configurationSha256, manifestSha256, sceneDeterminismKey, verifyGlb } from "./glb.js";
import type { SceneObjectStorage } from "./storage.js";
import { sceneTelemetry } from "./telemetry.js";
import type {
  AcknowledgeSceneCancellationCommand,
  ClaimSceneAttemptCommand,
  CreateSceneJobCommand,
  FailSceneAttemptCommand,
  HeartbeatSceneAttemptCommand,
  LeasedSceneAttempt,
  LoadSceneCompilationSourceCommand,
  PublishCompiledSceneCommand,
  SceneClock,
  SceneCompilerDescriptor,
  SceneCompilerWorkerPort,
  SceneRepository,
  SceneSnapshotVerifier,
  SceneTelemetry,
  TransitionSceneJobCommand,
} from "./types.js";

const systemClock: SceneClock = { now: () => new Date() };
const compilerVersionPattern = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,99}$/u;

function exactReferenceMatches(
  left: SceneSnapshotReference,
  right: SceneSnapshotReference,
): boolean {
  return (
    left.modelId === right.modelId &&
    left.profile === right.profile &&
    left.projectId === right.projectId &&
    left.snapshotId === right.snapshotId &&
    left.snapshotSha256 === right.snapshotSha256
  );
}

function validateCompiler(compiler: SceneCompilerDescriptor): SceneCompilerDescriptor {
  if (!compilerVersionPattern.test(compiler.version)) {
    throw sceneUnavailable(
      "SCENE_COMPILER_UNAVAILABLE",
      "A versioned production scene compiler has not been composed.",
    );
  }
  return compiler;
}

async function requireExactCommittedSnapshot(
  verifier: SceneSnapshotVerifier,
  tenantId: string,
  projectId: string,
  reference: SceneSnapshotReference,
) {
  if (reference.projectId !== projectId) {
    throw sceneConflict(
      "SCENE_SNAPSHOT_SCOPE_MISMATCH",
      "The scene request and exact source snapshot must share one project scope.",
    );
  }
  const snapshot = await verifier.findExactCommitted(tenantId, projectId, reference);
  if (
    snapshot === undefined ||
    snapshot.projectId !== projectId ||
    snapshot.modelId !== reference.modelId ||
    snapshot.profile !== reference.profile ||
    snapshot.id !== reference.snapshotId ||
    snapshot.snapshotSha256 !== reference.snapshotSha256 ||
    snapshot.snapshot.projectId !== reference.projectId ||
    snapshot.snapshot.modelId !== reference.modelId ||
    snapshot.snapshot.profile !== reference.profile
  ) {
    throw sceneConflict(
      "SCENE_SNAPSHOT_MISMATCH",
      "The exact committed canonical snapshot is unavailable, stale, uncommitted, or out of scope.",
    );
  }
  return snapshot;
}

export class SceneService {
  readonly #clock: SceneClock;
  readonly #compiler: SceneCompilerDescriptor | undefined;
  readonly #repository: SceneRepository;
  readonly #snapshotVerifier: SceneSnapshotVerifier;
  readonly #storage: SceneObjectStorage;
  readonly #telemetry: SceneTelemetry;

  constructor(options: {
    readonly clock?: SceneClock;
    readonly compiler?: SceneCompilerDescriptor;
    readonly repository: SceneRepository;
    readonly snapshotVerifier: SceneSnapshotVerifier;
    readonly storage: SceneObjectStorage;
    readonly telemetry?: SceneTelemetry;
  }) {
    this.#clock = options.clock ?? systemClock;
    this.#compiler = options.compiler;
    this.#repository = options.repository;
    this.#snapshotVerifier = options.snapshotVerifier;
    this.#storage = options.storage;
    this.#telemetry = options.telemetry ?? sceneTelemetry;
  }

  async createJob(
    command: Omit<
      CreateSceneJobCommand,
      | "cacheKeySha256"
      | "compiler"
      | "configurationSha256"
      | "requestSha256"
      | "sourceSnapshotVersion"
    >,
  ): Promise<{ readonly job: SceneJob; readonly replayed: boolean }> {
    const compiler = validateCompiler(
      this.#compiler ?? {
        name: "interior-design-scene-compiler",
        version: "",
      },
    );
    const request = createSceneJobRequestSchema.parse(command.request);
    const source = await requireExactCommittedSnapshot(
      this.#snapshotVerifier,
      command.actor.tenantId,
      command.projectId,
      request.sourceSnapshot,
    );
    const configurationHash = configurationSha256(request.configuration);
    const cacheKey = sceneDeterminismKey({
      compiler,
      configurationSha256: configurationHash,
      snapshotSha256: request.sourceSnapshot.snapshotSha256,
    });
    const result = await this.#repository.createJob({
      ...command,
      cacheKeySha256: cacheKey,
      compiler,
      configurationSha256: configurationHash,
      request,
      requestSha256: requestHash(request),
      sourceSnapshotVersion: source.version,
    });
    this.#telemetry.record({
      outcome: result.replayed ? "replayed" : "accepted",
      stage: "create",
    });
    return result;
  }

  listJobs(tenantId: string, projectId: string): Promise<readonly SceneJob[]> {
    return this.#repository.listJobs(tenantId, projectId);
  }

  async getJob(tenantId: string, projectId: string, sceneJobId: string): Promise<SceneJob> {
    const job = await this.#repository.findJob(tenantId, projectId, sceneJobId);
    if (job === undefined) throw notFound();
    return job;
  }

  async getScene(tenantId: string, projectId: string, sceneJobId: string): Promise<SceneRecord> {
    const job = await this.getJob(tenantId, projectId, sceneJobId);
    if (job.state !== "succeeded" || job.sceneId === undefined) {
      throw sceneConflict(
        "SCENE_UNAVAILABLE",
        "This job has not atomically published an immutable scene.",
      );
    }
    const scene = await this.#repository.findScene(tenantId, projectId, sceneJobId);
    if (scene === undefined || scene.id !== job.sceneId) {
      throw new Error("A succeeded scene job has no matching immutable publication.");
    }
    return scene;
  }

  async cancelJob(command: TransitionSceneJobCommand) {
    const result = await this.#repository.cancelJob(command);
    this.#telemetry.record({
      outcome: result.replayed ? "replayed" : "accepted",
      stage: "cancel",
    });
    return result;
  }

  async retryJob(command: TransitionSceneJobCommand) {
    const current = await this.getJob(
      command.actor.tenantId,
      command.projectId,
      command.sceneJobId,
    );
    await requireExactCommittedSnapshot(
      this.#snapshotVerifier,
      command.actor.tenantId,
      command.projectId,
      current.request.sourceSnapshot,
    );
    const result = await this.#repository.retryJob(command);
    this.#telemetry.record({
      outcome: result.replayed ? "replayed" : "accepted",
      stage: "retry",
    });
    return result;
  }

  async createAccess(input: {
    readonly actor: Parameters<SceneRepository["recordAccess"]>[0]["actor"];
    readonly correlation: Parameters<SceneRepository["recordAccess"]>[0]["correlation"];
    readonly projectId: string;
    readonly sceneJobId: string;
  }): Promise<SceneAccessResponse> {
    const scene = await this.getScene(input.actor.tenantId, input.projectId, input.sceneJobId);
    const expiresAt = new Date(
      this.#clock.now().getTime() + c10ScenePolicy.accessTtlSeconds * 1_000,
    );
    const signed = await this.#storage.signAccess({
      expiresAt,
      glbSha256: scene.artifact.glbSha256,
      mimeType: scene.artifact.mimeType,
    });
    const response = sceneAccessResponseSchema.parse({
      byteSize: scene.artifact.byteSize,
      expiresAt: signed.expiresAt,
      glbSha256: scene.artifact.glbSha256,
      manifestSha256: scene.artifact.manifestSha256,
      mimeType: scene.artifact.mimeType,
      sceneId: scene.id,
      url: signed.url,
    });
    await this.#repository.recordAccess({
      actor: input.actor,
      correlation: input.correlation,
      jobId: input.sceneJobId,
      projectId: input.projectId,
      sceneId: scene.id,
    });
    this.#telemetry.record({ outcome: "accepted", stage: "access" });
    return response;
  }
}

export class SceneWorkerService implements SceneCompilerWorkerPort {
  readonly #repository: SceneRepository;
  readonly #snapshotVerifier: SceneSnapshotVerifier;
  readonly #storage: SceneObjectStorage;
  readonly #telemetry: SceneTelemetry;

  constructor(options: {
    readonly repository: SceneRepository;
    readonly snapshotVerifier: SceneSnapshotVerifier;
    readonly storage: SceneObjectStorage;
    readonly telemetry?: SceneTelemetry;
  }) {
    this.#repository = options.repository;
    this.#snapshotVerifier = options.snapshotVerifier;
    this.#storage = options.storage;
    this.#telemetry = options.telemetry ?? sceneTelemetry;
  }

  async claimNext(command: ClaimSceneAttemptCommand): Promise<LeasedSceneAttempt | undefined> {
    validateCompiler(command.compiler);
    const lease = await this.#repository.claimNext(command);
    this.#telemetry.record({ outcome: "accepted", stage: "lease" });
    return lease;
  }

  heartbeat(command: HeartbeatSceneAttemptCommand): Promise<SceneJob> {
    this.#telemetry.record({ outcome: "accepted", stage: command.stage });
    return this.#repository.heartbeat(command);
  }

  async loadSource(command: LoadSceneCompilationSourceCommand) {
    await this.#repository.assertPublicationLease(command);
    const job = await this.#repository.findJob(command.tenantId, command.projectId, command.jobId);
    if (job === undefined || job.attempt !== command.attempt) {
      throw sceneConflict("SCENE_LEASE_FENCED", "A newer attempt owns this scene job.");
    }
    return requireExactCommittedSnapshot(
      this.#snapshotVerifier,
      command.tenantId,
      command.projectId,
      job.request.sourceSnapshot,
    );
  }

  async publish(command: PublishCompiledSceneCommand): Promise<SceneJob> {
    await this.#repository.assertPublicationLease(command);
    const job = await this.#repository.findJob(command.tenantId, command.projectId, command.jobId);
    if (job === undefined || job.attempt !== command.attempt || job.state !== "publishing") {
      throw sceneConflict(
        "SCENE_PUBLICATION_STAGE_INVALID",
        "A scene can publish only from the fenced publishing stage.",
      );
    }
    await requireExactCommittedSnapshot(
      this.#snapshotVerifier,
      command.tenantId,
      command.projectId,
      job.request.sourceSnapshot,
    );
    const manifest = sceneManifestSchema.parse(command.output.manifest);
    if (!exactReferenceMatches(manifest.sourceSnapshot, job.request.sourceSnapshot)) {
      throw sceneInvalid(
        "SCENE_MANIFEST_SCOPE_MISMATCH",
        "The scene manifest does not match the leased exact source snapshot.",
      );
    }
    if (requestHash(manifest.compiler.configuration) !== requestHash(job.request.configuration)) {
      throw sceneInvalid(
        "SCENE_CONFIGURATION_MISMATCH",
        "The scene manifest configuration does not match the leased job.",
      );
    }
    const configurationHash = configurationSha256(manifest.compiler.configuration);
    if (manifest.compiler.configurationSha256 !== configurationHash) {
      throw sceneInvalid(
        "SCENE_CONFIGURATION_HASH_MISMATCH",
        "The scene manifest configuration hash is not canonical.",
      );
    }
    const determinismKey = sceneDeterminismKey({
      compiler: { name: manifest.compiler.name, version: manifest.compiler.version },
      configurationSha256: configurationHash,
      snapshotSha256: manifest.sourceSnapshot.snapshotSha256,
    });
    if (manifest.determinismKeySha256 !== determinismKey) {
      throw sceneInvalid(
        "SCENE_DETERMINISM_KEY_MISMATCH",
        "The scene manifest does not bind the exact snapshot, compiler, and configuration.",
      );
    }
    const glb = verifyGlb(command.output.glb, manifest);
    const artifact = {
      byteSize: glb.byteSize,
      glbSha256: glb.glbSha256,
      manifestSha256: manifestSha256(manifest),
      mimeType: "model/gltf-binary" as const,
    };
    await this.#storage.putImmutable({
      ...artifact,
      bytes: command.output.glb,
    });
    const published = await this.#repository.publishScene({
      ...command,
      artifact,
      manifest,
    });
    this.#telemetry.record({ outcome: "accepted", stage: "publish" });
    return published;
  }

  fail(command: FailSceneAttemptCommand): Promise<SceneJob> {
    this.#telemetry.record({ outcome: "failed", stage: "publish" });
    return this.#repository.failAttempt(command);
  }

  acknowledgeCancellation(command: AcknowledgeSceneCancellationCommand): Promise<void> {
    return this.#repository.acknowledgeCancellation(command);
  }
}
