import { describe, expect, it } from "vitest";

import { verifyGlb } from "../../src/modules/scenes/glb.js";
import { InMemorySceneObjectStorage } from "../../src/modules/scenes/storage.js";
import { SceneService, SceneWorkerService } from "../../src/modules/scenes/service.js";
import { alphaProjectId, alphaTenantId } from "../c4/fixtures.js";
import { actors } from "../c6/support.js";
import {
  c10Now,
  compiler,
  MemorySceneRepository,
  MemorySceneSnapshotVerifier,
  sceneRequest,
  validGlb,
  validManifest,
} from "./support.js";

function owner() {
  const actor = actors["fixture|owner-alpha"];
  if (!actor) throw new Error("Synthetic C10 owner fixture is missing.");
  return actor;
}

function command(key = "c10-service-create-0001") {
  return {
    actor: owner(),
    correlation: {
      requestId: key,
      spanId: "a".repeat(16),
      traceId: "a".repeat(32),
      traceParent: `00-${"a".repeat(32)}-${"a".repeat(16)}-01`,
    },
    idempotencyKey: key,
    projectId: alphaProjectId,
    request: sceneRequest,
  };
}

function services() {
  const repository = new MemorySceneRepository();
  const verifier = new MemorySceneSnapshotVerifier();
  const storage = new InMemorySceneObjectStorage({
    now: () => new Date(c10Now),
  });
  return {
    repository,
    service: new SceneService({
      clock: { now: () => new Date(c10Now) },
      compiler,
      repository,
      snapshotVerifier: verifier,
      storage,
    }),
    storage,
    verifier,
    worker: new SceneWorkerService({ repository, snapshotVerifier: verifier, storage }),
  };
}

describe("C10 scene service and compiler publication boundary", () => {
  it("refuses creation until a real compiler descriptor is composed", async () => {
    const repository = new MemorySceneRepository();
    const verifier = new MemorySceneSnapshotVerifier();
    const storage = new InMemorySceneObjectStorage();
    const service = new SceneService({ repository, snapshotVerifier: verifier, storage });
    await expect(service.createJob(command())).rejects.toMatchObject({
      code: "SCENE_COMPILER_UNAVAILABLE",
      statusCode: 503,
    });
    expect(repository.jobs.size).toBe(0);
  });

  it("reloads one exact committed snapshot and rejects stale or uncommitted references", async () => {
    const { repository, service, verifier } = services();
    verifier.available = false;
    await expect(service.createJob(command("c10-stale-create-0001"))).rejects.toMatchObject({
      code: "SCENE_SNAPSHOT_MISMATCH",
      statusCode: 409,
    });
    expect(repository.jobs.size).toBe(0);

    verifier.available = true;
    await expect(
      service.createJob({
        ...command("c10-scope-create-0001"),
        request: {
          ...sceneRequest,
          sourceSnapshot: { ...sceneRequest.sourceSnapshot, projectId: crypto.randomUUID() },
        },
      }),
    ).rejects.toMatchObject({ code: "SCENE_SNAPSHOT_SCOPE_MISMATCH", statusCode: 409 });
    expect(repository.jobs.size).toBe(0);
  });

  it("creates one durable cache identity and never claims success without real publication", async () => {
    const { repository, service } = services();
    const created = await service.createJob(command());
    const replay = await service.createJob(command());
    const cacheReuse = await service.createJob(command("c10-service-create-0002"));
    expect(created).toMatchObject({ replayed: false, job: { attempt: 1, state: "queued" } });
    expect(replay).toMatchObject({ replayed: true, job: { id: created.job.id } });
    expect(cacheReuse).toMatchObject({ replayed: true, job: { id: created.job.id } });
    expect(repository.jobs).toHaveLength(1);
    expect(created.job.sceneId).toBeUndefined();
  });

  it("publishes only checksum-bound GLB bytes and an exact immutable manifest", async () => {
    const { repository, service, storage, worker } = services();
    const created = await service.createJob(command());
    const lease = await worker.claimNext({ compiler, workerId: "scene-worker-1" });
    if (lease === undefined) throw new Error("Synthetic C10 lease is missing.");
    const source = await worker.loadSource({
      attempt: lease.attempt,
      jobId: lease.jobId,
      leaseToken: lease.leaseToken,
      projectId: lease.projectId,
      tenantId: lease.tenantId,
      workerId: "scene-worker-1",
    });
    expect(source.id).toBe(sceneRequest.sourceSnapshot.snapshotId);
    await worker.heartbeat({
      attempt: lease.attempt,
      jobId: lease.jobId,
      leaseToken: lease.leaseToken,
      projectId: lease.projectId,
      stage: "compiling",
      tenantId: lease.tenantId,
      workerId: "scene-worker-1",
    });
    await worker.heartbeat({
      attempt: lease.attempt,
      jobId: lease.jobId,
      leaseToken: lease.leaseToken,
      projectId: lease.projectId,
      stage: "publishing",
      tenantId: lease.tenantId,
      workerId: "scene-worker-1",
    });
    const published = await worker.publish({
      attempt: lease.attempt,
      jobId: lease.jobId,
      leaseToken: lease.leaseToken,
      output: { glb: validGlb(), manifest: validManifest() },
      projectId: lease.projectId,
      tenantId: lease.tenantId,
      workerId: "scene-worker-1",
    });
    expect(published).toMatchObject({ id: created.job.id, state: "succeeded" });
    expect(typeof published.sceneId).toBe("string");
    const scene = await service.getScene(alphaTenantId, alphaProjectId, created.job.id);
    expect(scene.artifact.glbSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(scene.artifact.manifestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(storage.readForTest(scene.artifact.glbSha256)).toEqual(validGlb());
    expect(JSON.stringify(scene)).not.toMatch(/objectKey|leaseToken|credential|providerId/u);
    expect(repository.scenes.size).toBe(1);
  });

  it("rejects malformed bytes, manifest count drift, and stale publication leases", async () => {
    const { service, worker } = services();
    const created = await service.createJob(command());
    const lease = await worker.claimNext({ compiler, workerId: "scene-worker-2" });
    if (lease === undefined) throw new Error("Synthetic C10 lease is missing.");
    const scope = {
      attempt: lease.attempt,
      jobId: lease.jobId,
      leaseToken: lease.leaseToken,
      projectId: lease.projectId,
      tenantId: lease.tenantId,
      workerId: "scene-worker-2",
    };
    await worker.heartbeat({ ...scope, stage: "compiling" });
    await worker.heartbeat({ ...scope, stage: "publishing" });
    const malformed = validGlb();
    malformed[0] = 0;
    await expect(
      worker.publish({ ...scope, output: { glb: malformed, manifest: validManifest() } }),
    ).rejects.toMatchObject({ code: "SCENE_GLB_INVALID", statusCode: 422 });
    await expect(
      worker.publish({
        ...scope,
        output: {
          glb: validGlb(),
          manifest: { ...validManifest(), counts: { ...validManifest().counts, triangles: 2 } },
        },
      }),
    ).rejects.toMatchObject({ code: "SCENE_GLB_INVALID", statusCode: 422 });
    const nonFinite = validGlb();
    const nonFiniteView = new DataView(nonFinite.buffer);
    const nonFiniteBinaryOffset = 28 + nonFiniteView.getUint32(12, true);
    nonFiniteView.setFloat32(nonFiniteBinaryOffset, Number.NaN, true);
    expect(() => verifyGlb(nonFinite, validManifest())).toThrow(/NaN or infinity/u);
    const invalidIndex = validGlb();
    const invalidIndexView = new DataView(invalidIndex.buffer);
    const invalidIndexBinaryOffset = 28 + invalidIndexView.getUint32(12, true);
    invalidIndexView.setUint16(invalidIndexBinaryOffset + 40, 3, true);
    expect(() => verifyGlb(invalidIndex, validManifest())).toThrow(/outside its POSITION/u);
    expect((await service.getJob(alphaTenantId, alphaProjectId, created.job.id)).state).toBe(
      "publishing",
    );
    await expect(
      worker.publish({
        ...scope,
        leaseToken: crypto.randomUUID(),
        output: { glb: validGlb(), manifest: validManifest() },
      }),
    ).rejects.toMatchObject({ code: "SCENE_LEASE_FENCED", statusCode: 409 });
  });

  it("fences cancellation at an active stage, appends a retry attempt, and audits access", async () => {
    const { repository, service, worker } = services();
    const created = await service.createJob(command());
    const lease = await worker.claimNext({ compiler, workerId: "scene-worker-3" });
    if (lease === undefined) throw new Error("Synthetic C10 lease is missing.");
    const active = await service.getJob(alphaTenantId, alphaProjectId, created.job.id);
    const cancelled = await service.cancelJob({
      ...command("c10-service-cancel-0001"),
      expectedVersion: active.version,
      sceneJobId: active.id,
    });
    expect(cancelled.job.state).toBe("cancel-requested");
    await expect(
      worker.heartbeat({
        attempt: lease.attempt,
        jobId: lease.jobId,
        leaseToken: lease.leaseToken,
        projectId: lease.projectId,
        stage: "compiling",
        tenantId: lease.tenantId,
        workerId: "scene-worker-3",
      }),
    ).rejects.toMatchObject({ code: "SCENE_CANCELLATION_REQUESTED" });
    await worker.acknowledgeCancellation({
      attempt: lease.attempt,
      jobId: lease.jobId,
      leaseToken: lease.leaseToken,
      projectId: lease.projectId,
      tenantId: lease.tenantId,
      workerId: "scene-worker-3",
    });
    const terminal = await service.getJob(alphaTenantId, alphaProjectId, created.job.id);
    const retried = await service.retryJob({
      ...command("c10-service-retry-0001"),
      expectedVersion: terminal.version,
      sceneJobId: terminal.id,
    });
    expect(retried.job).toMatchObject({ attempt: 2, state: "queued" });
    await expect(
      worker.loadSource({
        attempt: lease.attempt,
        jobId: lease.jobId,
        leaseToken: lease.leaseToken,
        projectId: lease.projectId,
        tenantId: lease.tenantId,
        workerId: "scene-worker-3",
      }),
    ).rejects.toMatchObject({ code: "SCENE_LEASE_FENCED" });

    const retryLease = await worker.claimNext({ compiler, workerId: "scene-worker-3" });
    if (retryLease === undefined) throw new Error("Synthetic retry lease is missing.");
    const retryScope = {
      attempt: retryLease.attempt,
      jobId: retryLease.jobId,
      leaseToken: retryLease.leaseToken,
      projectId: retryLease.projectId,
      tenantId: retryLease.tenantId,
      workerId: "scene-worker-3",
    };
    await worker.heartbeat({ ...retryScope, stage: "compiling" });
    await worker.heartbeat({ ...retryScope, stage: "publishing" });
    await worker.publish({
      ...retryScope,
      output: { glb: validGlb(), manifest: validManifest() },
    });
    const access = await service.createAccess({
      actor: owner(),
      correlation: command().correlation,
      projectId: alphaProjectId,
      sceneJobId: created.job.id,
    });
    expect(access.url).toMatch(/^http:\/\/127[.]0[.]0[.]1/u);
    expect(access.expiresAt).toBe("2026-07-17T20:05:00.000Z");
    expect(repository.accessCount).toBe(1);
    expect(JSON.stringify(access)).not.toMatch(/objectKey|leaseToken|credential|providerId/u);
  });
});
