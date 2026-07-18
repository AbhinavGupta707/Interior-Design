import {
  c10DefaultCompileConfiguration,
  createSceneJobRequestSchema,
  modelSnapshotRecordSchema,
  sceneJobSchema,
  sceneManifestSchema,
  sceneRecordSchema,
  type SceneJob,
  type SceneManifest,
  type SceneRecord,
} from "@interior-design/contracts";
import { canonicalizeHomeSnapshot } from "@interior-design/domain-model";

import { sceneConflict } from "../../src/modules/scenes/errors.js";
import {
  configurationSha256,
  manifestSha256,
  sceneDeterminismKey,
} from "../../src/modules/scenes/glb.js";
import type {
  AcknowledgeSceneCancellationCommand,
  ClaimSceneAttemptCommand,
  CreateSceneJobCommand,
  FailSceneAttemptCommand,
  HeartbeatSceneAttemptCommand,
  LeasedSceneAttempt,
  PersistScenePublicationCommand,
  SceneCompilerDescriptor,
  SceneRepository,
  SceneSnapshotVerifier,
  TransitionSceneJobCommand,
} from "../../src/modules/scenes/types.js";
import {
  alphaProjectId,
  alphaTenantId,
  canonicalSnapshotFixture,
  existingModelId,
  ownerUserId,
  spaceId,
} from "../c4/fixtures.js";

export const c10Now = "2026-07-17T20:00:00.000Z";
export const c10SnapshotId = "aa000000-0000-4000-8000-000000000001";
export const compiler: SceneCompilerDescriptor = {
  name: "interior-design-scene-compiler",
  version: "1.0.0",
};

const snapshot = canonicalSnapshotFixture();
const canonical = canonicalizeHomeSnapshot(snapshot);

export const sourceRecord = modelSnapshotRecordSchema.parse({
  canonicalByteLength: canonical.canonicalByteLength,
  createdAt: c10Now,
  createdBy: ownerUserId,
  id: c10SnapshotId,
  modelId: existingModelId,
  profile: "existing",
  projectId: alphaProjectId,
  schemaVersion: "c4-canonical-home-v1",
  snapshot: canonical.snapshot,
  snapshotSha256: canonical.snapshotSha256,
  version: 1,
});

export const sceneRequest = createSceneJobRequestSchema.parse({
  configuration: c10DefaultCompileConfiguration,
  label: "Visibly synthetic exact committed scene",
  sourceSnapshot: {
    modelId: existingModelId,
    profile: "existing",
    projectId: alphaProjectId,
    schemaVersion: "c4-canonical-home-v1",
    snapshotId: c10SnapshotId,
    snapshotSha256: canonical.snapshotSha256,
  },
});

export class MemorySceneSnapshotVerifier implements SceneSnapshotVerifier {
  available = true;
  record = sourceRecord;

  findExactCommitted(tenantId: string, projectId: string) {
    return Promise.resolve(
      this.available && tenantId === alphaTenantId && projectId === alphaProjectId
        ? this.record
        : undefined,
    );
  }
}

function pad4(value: number): number {
  return (value + 3) & ~3;
}

export function validGlb(): Uint8Array {
  const binary = new Uint8Array(44);
  const binaryView = new DataView(binary.buffer);
  const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  positions.forEach((value, index) => {
    binaryView.setFloat32(index * 4, value, true);
  });
  binaryView.setUint16(36, 0, true);
  binaryView.setUint16(38, 1, true);
  binaryView.setUint16(40, 2, true);
  const document = {
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        max: [1, 1, 0],
        min: [0, 0, 0],
        type: "VEC3",
      },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
    ],
    asset: { generator: "C10 synthetic test", version: "2.0" },
    bufferViews: [
      { buffer: 0, byteLength: 36, byteOffset: 0, target: 34962 },
      { buffer: 0, byteLength: 6, byteOffset: 36, target: 34963 },
    ],
    buffers: [{ byteLength: binary.byteLength }],
    materials: [{ name: "Neutral synthetic material" }],
    meshes: [
      {
        primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0, mode: 4 }],
      },
    ],
    nodes: [{ extras: { canonicalElementId: spaceId }, mesh: 0 }],
    scene: 0,
    scenes: [{ nodes: [0] }],
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = pad4(jsonBytes.byteLength);
  const total = 12 + 8 + jsonLength + 8 + binary.byteLength;
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + jsonLength);
  bytes.set(jsonBytes, 20);
  const binaryHeader = 20 + jsonLength;
  view.setUint32(binaryHeader, binary.byteLength, true);
  view.setUint32(binaryHeader + 4, 0x004e4942, true);
  bytes.set(binary, binaryHeader + 8);
  return bytes;
}

export function validManifest(): SceneManifest {
  const configHash = configurationSha256(sceneRequest.configuration);
  return sceneManifestSchema.parse({
    authority: "derived-visualisation-only",
    boundsMm: {
      maximum: { xMm: 4_000, yMm: 3_000, zMm: 0 },
      minimum: { xMm: 0, yMm: 0, zMm: 0 },
    },
    compiler: {
      configuration: sceneRequest.configuration,
      configurationSha256: configHash,
      name: compiler.name,
      version: compiler.version,
    },
    coordinateSystem: {
      canonicalAxes: "+X east, +Y north, +Z up",
      gltfAxes: "+Y up, +Z forward, right-handed",
      mapping: "[Xmm/1000, Zmm/1000, -Ymm/1000]",
      outputLengthUnit: "metre",
    },
    counts: { materials: 1, meshes: 1, nodes: 1, triangles: 1, vertices: 3 },
    determinismKeySha256: sceneDeterminismKey({
      compiler,
      configurationSha256: configHash,
      snapshotSha256: sceneRequest.sourceSnapshot.snapshotSha256,
    }),
    elementMappings: [
      {
        elementId: spaceId,
        elementType: "space",
        findingCodes: [],
        materialIndices: [0],
        meshIndices: [0],
        nodeIndices: [0],
        status: "mapped",
      },
    ],
    findings: [],
    gltf: { container: "GLB", specificationVersion: "2.0" },
    schemaVersion: "c10-scene-manifest-v1",
    sourceSnapshot: sceneRequest.sourceSnapshot,
  });
}

interface Lease {
  readonly attempt: number;
  readonly expiresAt: string;
  readonly token: string;
  readonly workerId: string;
}

function nextJob(job: SceneJob, changes: Partial<SceneJob>): SceneJob {
  return sceneJobSchema.parse({
    ...job,
    ...changes,
    updatedAt: new Date(Date.parse(job.updatedAt) + 1).toISOString(),
    version: job.version + 1,
  });
}

export class MemorySceneRepository implements SceneRepository {
  accessCount = 0;
  readonly jobs = new Map<string, SceneJob>();
  readonly scenes = new Map<string, SceneRecord>();
  readonly #cache = new Map<string, string>();
  readonly #idempotency = new Map<
    string,
    { readonly job: SceneJob; readonly requestSha256: string }
  >();
  readonly #leases = new Map<string, Lease>();
  #counter = 100;

  #uuid(): string {
    this.#counter += 1;
    return `aa000000-0000-4000-8000-${String(this.#counter).padStart(12, "0")}`;
  }

  createJob(command: CreateSceneJobCommand) {
    const replay = this.#idempotency.get(command.idempotencyKey);
    if (replay !== undefined) {
      if (replay.requestSha256 !== command.requestSha256) {
        throw sceneConflict("IDEMPOTENCY_CONFLICT", "Synthetic idempotency key reuse conflict.");
      }
      return Promise.resolve({ job: replay.job, replayed: true });
    }
    const cachedId = this.#cache.get(command.cacheKeySha256);
    if (cachedId !== undefined) {
      const cached = this.jobs.get(cachedId);
      if (cached === undefined) throw new Error("Synthetic cache job is missing.");
      this.#idempotency.set(command.idempotencyKey, {
        job: cached,
        requestSha256: command.requestSha256,
      });
      return Promise.resolve({ job: cached, replayed: true });
    }
    const job = sceneJobSchema.parse({
      attempt: 1,
      createdAt: c10Now,
      createdBy: command.actor.userId,
      id: this.#uuid(),
      projectId: command.projectId,
      request: command.request,
      state: "queued",
      updatedAt: c10Now,
      version: 1,
    });
    this.jobs.set(job.id, job);
    this.#cache.set(command.cacheKeySha256, job.id);
    this.#idempotency.set(command.idempotencyKey, {
      job,
      requestSha256: command.requestSha256,
    });
    return Promise.resolve({ job, replayed: false });
  }

  listJobs(tenantId: string, projectId: string) {
    return Promise.resolve(
      tenantId === alphaTenantId
        ? [...this.jobs.values()].filter((job) => job.projectId === projectId)
        : [],
    );
  }

  findJob(tenantId: string, projectId: string, sceneJobId: string) {
    const job = this.jobs.get(sceneJobId);
    return Promise.resolve(
      tenantId === alphaTenantId && job?.projectId === projectId ? job : undefined,
    );
  }

  findScene(tenantId: string, projectId: string, sceneJobId: string) {
    const scene = this.scenes.get(sceneJobId);
    return Promise.resolve(
      tenantId === alphaTenantId && scene?.projectId === projectId ? scene : undefined,
    );
  }

  cancelJob(command: TransitionSceneJobCommand) {
    const current = this.jobs.get(command.sceneJobId);
    if (current === undefined) throw new Error("Synthetic scene job is missing.");
    if (current.version !== command.expectedVersion) {
      throw sceneConflict("SCENE_JOB_VERSION_CONFLICT", "Synthetic stale version.");
    }
    const active = ["leased", "compiling", "publishing"].includes(current.state);
    const job = nextJob(current, { state: active ? "cancel-requested" : "cancelled" });
    this.jobs.set(job.id, job);
    return Promise.resolve({ job, replayed: false });
  }

  retryJob(command: TransitionSceneJobCommand) {
    const current = this.jobs.get(command.sceneJobId);
    if (current === undefined || current.version !== command.expectedVersion) {
      throw sceneConflict("SCENE_JOB_VERSION_CONFLICT", "Synthetic stale version.");
    }
    if (!["cancelled", "failed"].includes(current.state) || current.attempt >= 3) {
      throw sceneConflict("SCENE_JOB_NOT_RETRYABLE", "Synthetic job is not retryable.");
    }
    const job = nextJob(current, {
      attempt: current.attempt + 1,
      safeCode: undefined,
      sceneId: undefined,
      state: "queued",
    });
    this.jobs.set(job.id, job);
    return Promise.resolve({ job, replayed: false });
  }

  claimNext(command: ClaimSceneAttemptCommand): Promise<LeasedSceneAttempt | undefined> {
    const current = [...this.jobs.values()].find((job) => job.state === "queued");
    if (current === undefined) return Promise.resolve(undefined);
    const token = this.#uuid();
    const expiresAt = new Date(Date.parse(c10Now) + 300_000).toISOString();
    const job = nextJob(current, { state: "leased" });
    this.jobs.set(job.id, job);
    this.#leases.set(job.id, {
      attempt: job.attempt,
      expiresAt,
      token,
      workerId: command.workerId,
    });
    return Promise.resolve({
      attempt: job.attempt,
      cacheKeySha256: sceneDeterminismKey({
        compiler: command.compiler,
        configurationSha256: configurationSha256(job.request.configuration),
        snapshotSha256: job.request.sourceSnapshot.snapshotSha256,
      }),
      compiler: command.compiler,
      configurationSha256: configurationSha256(job.request.configuration),
      jobId: job.id,
      leaseExpiresAt: expiresAt,
      leaseToken: token,
      projectId: job.projectId,
      request: job.request,
      stage: "leased",
      tenantId: alphaTenantId,
    });
  }

  #assert(command: {
    readonly attempt: number;
    readonly jobId: string;
    readonly leaseToken: string;
    readonly workerId: string;
  }): Lease {
    const lease = this.#leases.get(command.jobId);
    if (
      lease === undefined ||
      lease.attempt !== command.attempt ||
      lease.token !== command.leaseToken ||
      lease.workerId !== command.workerId
    ) {
      throw sceneConflict("SCENE_LEASE_FENCED", "Synthetic stale lease.");
    }
    return lease;
  }

  assertPublicationLease(command: Parameters<SceneRepository["assertPublicationLease"]>[0]) {
    this.#assert(command);
    return Promise.resolve();
  }

  heartbeat(command: HeartbeatSceneAttemptCommand) {
    return Promise.resolve().then(() => {
      this.#assert(command);
      const current = this.jobs.get(command.jobId);
      if (current === undefined || current.state === "cancel-requested") {
        throw sceneConflict("SCENE_CANCELLATION_REQUESTED", "Synthetic cancellation requested.");
      }
      const job = nextJob(current, { state: command.stage });
      this.jobs.set(job.id, job);
      return job;
    });
  }

  publishScene(command: PersistScenePublicationCommand) {
    this.#assert(command);
    const current = this.jobs.get(command.jobId);
    if (current === undefined || current.state !== "publishing") {
      throw sceneConflict("SCENE_PUBLICATION_STAGE_INVALID", "Synthetic wrong stage.");
    }
    const sceneId = this.#uuid();
    const scene = sceneRecordSchema.parse({
      artifact: {
        ...command.artifact,
        id: this.#uuid(),
        schemaVersion: "c10-scene-artifact-v1",
      },
      createdAt: c10Now,
      createdBy: current.createdBy,
      id: sceneId,
      manifest: command.manifest,
      projectId: current.projectId,
    });
    this.scenes.set(current.id, scene);
    const job = nextJob(current, { sceneId, state: "succeeded" });
    this.jobs.set(job.id, job);
    this.#leases.delete(job.id);
    return Promise.resolve(job);
  }

  failAttempt(command: FailSceneAttemptCommand) {
    this.#assert(command);
    const current = this.jobs.get(command.jobId);
    if (current === undefined) throw new Error("Synthetic scene job is missing.");
    const job = nextJob(current, { safeCode: command.safeCode, state: "failed" });
    this.jobs.set(job.id, job);
    this.#leases.delete(job.id);
    return Promise.resolve(job);
  }

  acknowledgeCancellation(command: AcknowledgeSceneCancellationCommand) {
    this.#assert(command);
    const current = this.jobs.get(command.jobId);
    if (current === undefined || current.state !== "cancel-requested") {
      throw sceneConflict("SCENE_LEASE_FENCED", "Synthetic cancellation is not active.");
    }
    this.jobs.set(current.id, nextJob(current, { state: "cancelled" }));
    this.#leases.delete(current.id);
    return Promise.resolve();
  }

  recordAccess() {
    this.accessCount += 1;
    return Promise.resolve();
  }
}

export function publishedArtifactHashes() {
  const manifest = validManifest();
  return { manifestSha256: manifestSha256(manifest) };
}
