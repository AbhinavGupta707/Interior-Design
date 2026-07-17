import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { registerRequestCorrelation } from "../../src/correlation.js";
import { registerErrorHandling } from "../../src/errors.js";
import { registerSceneRoutes } from "../../src/modules/scenes/routes.js";
import { SceneService, SceneWorkerService } from "../../src/modules/scenes/service.js";
import { InMemorySceneObjectStorage } from "../../src/modules/scenes/storage.js";
import { alphaProjectId } from "../c4/fixtures.js";
import { FixtureProjectRepository, fixtureIdentity, tokenFor } from "../c6/support.js";
import {
  c10Now,
  compiler,
  MemorySceneRepository,
  MemorySceneSnapshotVerifier,
  sceneRequest,
  validGlb,
  validManifest,
} from "./support.js";

function authorization(subject: Parameters<typeof tokenFor>[0]) {
  return { authorization: `Bearer ${tokenFor(subject)}` };
}

describe("C10 public scene routes", () => {
  let repository: MemorySceneRepository;
  let server: FastifyInstance;
  let worker: SceneWorkerService;

  beforeEach(() => {
    server = Fastify({ logger: false });
    registerRequestCorrelation(server);
    registerErrorHandling(server);
    repository = new MemorySceneRepository();
    const verifier = new MemorySceneSnapshotVerifier();
    const storage = new InMemorySceneObjectStorage({ now: () => new Date(c10Now) });
    const service = new SceneService({
      clock: { now: () => new Date(c10Now) },
      compiler,
      repository,
      snapshotVerifier: verifier,
      storage,
    });
    worker = new SceneWorkerService({ repository, snapshotVerifier: verifier, storage });
    registerSceneRoutes(server, fixtureIdentity(), new FixtureProjectRepository(), service);
  });

  afterEach(async () => server.close());

  it("creates and exactly replays while viewer access remains read-only", async () => {
    const url = `/v1/projects/${alphaProjectId}/scene-jobs`;
    const request = {
      headers: {
        ...authorization("fixture|owner-alpha"),
        "idempotency-key": "c10-route-create-0001",
      },
      method: "POST" as const,
      payload: sceneRequest,
      url,
    };
    const created = await server.inject(request);
    const replayed = await server.inject(request);
    expect(created.statusCode).toBe(201);
    expect(replayed.statusCode).toBe(201);
    expect(replayed.headers["idempotent-replay"]).toBe("true");
    expect(replayed.json()).toEqual(created.json());
    const conflictingReplay = await server.inject({
      ...request,
      payload: { ...sceneRequest, label: "Different request under the same key" },
    });
    expect(conflictingReplay.statusCode).toBe(409);
    const job = created.json<{ readonly id: string }>();
    const listed = await server.inject({
      headers: authorization("fixture|viewer-alpha"),
      method: "GET",
      url,
    });
    const fetched = await server.inject({
      headers: authorization("fixture|viewer-alpha"),
      method: "GET",
      url: `${url}/${job.id}`,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json<{ readonly jobs: unknown[] }>().jobs).toHaveLength(1);
    expect(fetched.statusCode).toBe(200);

    const denied = await server.inject({
      headers: {
        ...authorization("fixture|viewer-alpha"),
        "idempotency-key": "c10-route-viewer-create",
      },
      method: "POST",
      payload: sceneRequest,
      url,
    });
    expect(denied.statusCode).toBe(403);
    const deniedCancellation = await server.inject({
      headers: {
        ...authorization("fixture|viewer-alpha"),
        "idempotency-key": "c10-route-viewer-cancel",
      },
      method: "POST",
      payload: { expectedVersion: 1 },
      url: `${url}/${job.id}/cancel`,
    });
    expect(deniedCancellation.statusCode).toBe(403);
    expect(repository.jobs.size).toBe(1);
  });

  it("denies foreign tenant scope before job or scene existence disclosure", async () => {
    const url = `/v1/projects/${alphaProjectId}/scene-jobs`;
    const list = await server.inject({
      headers: authorization("fixture|owner-beta"),
      method: "GET",
      url,
    });
    const guessed = await server.inject({
      headers: authorization("fixture|owner-beta"),
      method: "GET",
      url: `${url}/${crypto.randomUUID()}`,
    });
    expect(list.statusCode).toBe(404);
    expect(guessed.statusCode).toBe(404);
    expect(list.json()).toMatchObject({ code: "NOT_FOUND" });
    expect(guessed.json()).toMatchObject({ code: "NOT_FOUND" });
  });

  it("requires optimistic cancellation/retry versions and rejects unknown request fields", async () => {
    const url = `/v1/projects/${alphaProjectId}/scene-jobs`;
    const created = await server.inject({
      headers: {
        ...authorization("fixture|editor-alpha"),
        "idempotency-key": "c10-route-transition-create",
      },
      method: "POST",
      payload: sceneRequest,
      url,
    });
    const job = created.json<{ readonly id: string; readonly version: number }>();
    const stale = await server.inject({
      headers: {
        ...authorization("fixture|editor-alpha"),
        "idempotency-key": "c10-route-transition-stale",
      },
      method: "POST",
      payload: { expectedVersion: 99 },
      url: `${url}/${job.id}/cancel`,
    });
    expect(stale.statusCode).toBe(409);
    const cancelled = await server.inject({
      headers: {
        ...authorization("fixture|editor-alpha"),
        "idempotency-key": "c10-route-transition-cancel",
      },
      method: "POST",
      payload: { expectedVersion: job.version },
      url: `${url}/${job.id}/cancel`,
    });
    const terminal = cancelled.json<{ readonly version: number }>();
    const retried = await server.inject({
      headers: {
        ...authorization("fixture|editor-alpha"),
        "idempotency-key": "c10-route-transition-retry",
      },
      method: "POST",
      payload: { expectedVersion: terminal.version },
      url: `${url}/${job.id}/retry`,
    });
    expect(retried.json()).toMatchObject({ attempt: 2, state: "queued" });

    const directPayload = await server.inject({
      headers: {
        ...authorization("fixture|editor-alpha"),
        "idempotency-key": "c10-route-direct-payload",
      },
      method: "POST",
      payload: { ...sceneRequest, snapshot: { direct: true } },
      url,
    });
    expect(directPayload.statusCode).toBe(400);
  });

  it("returns an immutable scene and audited short-lived access to a viewer without locators", async () => {
    const url = `/v1/projects/${alphaProjectId}/scene-jobs`;
    const created = await server.inject({
      headers: {
        ...authorization("fixture|owner-alpha"),
        "idempotency-key": "c10-route-publish-create",
      },
      method: "POST",
      payload: sceneRequest,
      url,
    });
    const job = created.json<{ readonly id: string }>();
    const lease = await worker.claimNext({ compiler, workerId: "route-scene-worker" });
    if (lease === undefined) throw new Error("Synthetic route lease is missing.");
    const scope = {
      attempt: lease.attempt,
      jobId: lease.jobId,
      leaseToken: lease.leaseToken,
      projectId: lease.projectId,
      tenantId: lease.tenantId,
      workerId: "route-scene-worker",
    };
    await worker.heartbeat({ ...scope, stage: "compiling" });
    await worker.heartbeat({ ...scope, stage: "publishing" });
    await worker.publish({
      ...scope,
      output: { glb: validGlb(), manifest: validManifest() },
    });

    const scene = await server.inject({
      headers: authorization("fixture|viewer-alpha"),
      method: "GET",
      url: `${url}/${job.id}/scene`,
    });
    const access = await server.inject({
      headers: authorization("fixture|viewer-alpha"),
      method: "POST",
      payload: {},
      url: `${url}/${job.id}/scene/access`,
    });
    expect(scene.statusCode).toBe(200);
    expect(access.statusCode).toBe(200);
    expect(scene.headers["cache-control"]).toBe("private, no-store");
    expect(access.headers["cache-control"]).toBe("private, no-store");
    expect(access.json()).toMatchObject({
      expiresAt: "2026-07-17T20:05:00.000Z",
      mimeType: "model/gltf-binary",
      sceneId: scene.json<{ readonly id: string }>().id,
    });
    expect(repository.accessCount).toBe(1);
    expect(`${scene.body}${access.body}`).not.toMatch(
      /objectKey|providerId|credential|leaseToken|sourceObjectKey/u,
    );
  });
});
