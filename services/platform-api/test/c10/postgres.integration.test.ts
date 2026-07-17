import { loadPlatformApiConfig } from "@interior-design/config";
import {
  modelSnapshotRecordSchema,
  type LocalPersona,
  type Project,
} from "@interior-design/contracts";
import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createServer } from "../../src/app.js";
import { applyC1Migration, bootstrapC1Fixtures, createC1Sql } from "../../src/c1.js";
import { applyC2Migration } from "../../src/c2.js";
import { applyC3Migration } from "../../src/c3.js";
import { applyC4Migration } from "../../src/c4.js";
import { applyC5Migration } from "../../src/c5.js";
import { applyC6Migration } from "../../src/c6.js";
import { applyC7Migration } from "../../src/c7.js";
import { applyC8Migration } from "../../src/c8.js";
import { applyC9Migration } from "../../src/c9.js";
import { applyC10Migration } from "../../src/c10.js";
import { DomainCanonicalSnapshotCodec } from "../../src/modules/models/core/canonical.js";
import { PostgresSceneRepository } from "../../src/modules/scenes/postgres.js";
import { SceneWorkerService } from "../../src/modules/scenes/service.js";
import { PostgresSceneSnapshotVerifier } from "../../src/modules/scenes/snapshot.js";
import { InMemorySceneObjectStorage } from "../../src/modules/scenes/storage.js";
import { canonicalSnapshotFixture } from "../c4/fixtures.js";
import { compiler, validGlb, validManifest } from "./support.js";

const databaseUrl = process.env.C10_TEST_DATABASE_URL ?? "";
const describeWithPostgres = databaseUrl.length === 0 ? describe.skip : describe;
const sessionSecret = "c10-postgres-session-secret-with-at-least-thirty-two-bytes";
const config = loadPlatformApiConfig({
  NODE_ENV: "test",
  PLATFORM_API_LOG_LEVEL: "silent",
  PLATFORM_API_SHUTDOWN_TIMEOUT_MS: "2000",
});
const activeServers = new Set<ReturnType<typeof createServer>>();

function authorization(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function signIn(server: ReturnType<typeof createServer>, persona: LocalPersona) {
  const response = await server.inject({
    method: "POST",
    payload: { persona },
    url: "/v1/auth/local/session",
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ readonly accessToken: string }>().accessToken;
}

async function createProject(server: ReturnType<typeof createServer>, token: string) {
  const response = await server.inject({
    headers: { ...authorization(token), "idempotency-key": `c10-project-${randomUUID()}` },
    method: "POST",
    payload: { name: `Synthetic C10 ${randomUUID()}` },
    url: "/v1/projects",
  });
  expect(response.statusCode).toBe(201);
  return response.json<Project>();
}

describeWithPostgres("C10 live Postgres workflow and immutable publication", () => {
  let administration: Sql;

  beforeAll(async () => {
    administration = createC1Sql(databaseUrl);
    await applyC1Migration(administration);
    await bootstrapC1Fixtures(administration, "test");
    await applyC2Migration(administration);
    await applyC3Migration(administration);
    await applyC4Migration(administration);
    await applyC5Migration(administration);
    await applyC6Migration(administration);
    await applyC7Migration(administration);
    await applyC8Migration(administration);
    await applyC9Migration(administration);
    await applyC10Migration(administration);
  });

  afterAll(async () => administration.end({ timeout: 5 }));
  afterEach(async () => {
    await Promise.all(
      [...activeServers].map(async (server) => {
        await server.close();
        activeServers.delete(server);
      }),
    );
  });

  it("applies every store and defaults unknown committed-snapshot checks to denied", async () => {
    const tables = await administration<{ readonly name: string }[]>`
      SELECT table_name AS name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY(${administration.array([
        "scene_jobs",
        "scene_attempts",
        "scene_artifacts",
        "scenes",
        "scene_cache_entries",
        "scene_audit_events",
        "scene_outbox",
      ])}::text[])
      ORDER BY table_name
    `;
    expect(tables).toHaveLength(7);
    const denied = await administration<{ readonly committed: boolean }[]>`
      SELECT c10_snapshot_is_committed(
        ${randomUUID()}::uuid, ${randomUUID()}::uuid, ${randomUUID()}::uuid,
        'existing', ${randomUUID()}::uuid, ${"a".repeat(64)}
      ) AS committed
    `;
    expect(denied).toEqual([{ committed: false }]);
  });

  it("proves idempotency/cache, leases, cancellation, retry fencing, publication, access audit, and zero model mutation", async () => {
    const storage = new InMemorySceneObjectStorage();
    const server = createServer({
      c1: { closeDatabase: true, database: createC1Sql(databaseUrl) },
      c4: {
        closeDatabase: true,
        codec: new DomainCanonicalSnapshotCodec(),
        database: createC1Sql(databaseUrl),
        geometryValidator: () => [],
      },
      c10: {
        closeDatabase: true,
        compiler,
        database: createC1Sql(databaseUrl),
        storage,
      },
      config,
      environment: { C1_LOCAL_SESSION_SECRET: sessionSecret, NODE_ENV: "test" },
      logger: false,
    });
    activeServers.add(server);
    const ownerToken = await signIn(server, "homeowner-alpha");
    const viewerToken = await signIn(server, "viewer-alpha");
    const project = await createProject(server, ownerToken);
    const modelId = randomUUID();
    const firstSnapshotResponse = await server.inject({
      headers: {
        ...authorization(ownerToken),
        "idempotency-key": `c10-snapshot-${randomUUID()}`,
      },
      method: "POST",
      payload: {
        expectedCurrentSnapshotSha256: null,
        snapshot: canonicalSnapshotFixture({ modelId, projectId: project.id }),
      },
      url: `/v1/projects/${project.id}/models/existing/snapshots`,
    });
    expect(firstSnapshotResponse.statusCode).toBe(201);
    const firstSnapshot = modelSnapshotRecordSchema.parse(firstSnapshotResponse.json());
    const request = {
      configuration: {
        coordinateMapping: "c4-z-up-to-gltf-y-up-v1" as const,
        geometryMode: "parametric-v1" as const,
        materialMode: "status-aware-neutral-v1" as const,
        purpose: "interactive-browser" as const,
        unknownGeometryPolicy: "omit-and-report" as const,
      },
      label: "Synthetic live exact scene",
      sourceSnapshot: {
        modelId,
        profile: "existing" as const,
        projectId: project.id,
        schemaVersion: "c4-canonical-home-v1" as const,
        snapshotId: firstSnapshot.id,
        snapshotSha256: firstSnapshot.snapshotSha256,
      },
    };
    const createInput = {
      headers: {
        ...authorization(ownerToken),
        "idempotency-key": `c10-job-${randomUUID()}`,
      },
      method: "POST" as const,
      payload: request,
      url: `/v1/projects/${project.id}/scene-jobs`,
    };
    const created = await server.inject(createInput);
    const replayed = await server.inject(createInput);
    const cacheReused = await server.inject({
      ...createInput,
      headers: {
        ...authorization(ownerToken),
        "idempotency-key": `c10-cache-${randomUUID()}`,
      },
      payload: { ...request, label: "A different presentation label" },
    });
    expect([created.statusCode, replayed.statusCode, cacheReused.statusCode]).toEqual([
      201, 201, 201,
    ]);
    expect(replayed.json()).toEqual(created.json());
    expect(cacheReused.json()).toEqual(created.json());
    const job = created.json<{ readonly id: string }>();

    const workerRepository = new PostgresSceneRepository(administration);
    const verifier = new PostgresSceneSnapshotVerifier(administration);
    const worker = new SceneWorkerService({
      repository: workerRepository,
      snapshotVerifier: verifier,
      storage,
    });
    const lease = await worker.claimNext({ compiler, workerId: "live-scene-worker" });
    if (lease === undefined) throw new Error("Live C10 lease is missing.");
    expect(
      (
        await worker.loadSource({
          attempt: lease.attempt,
          jobId: lease.jobId,
          leaseToken: lease.leaseToken,
          projectId: lease.projectId,
          tenantId: lease.tenantId,
          workerId: "live-scene-worker",
        })
      ).id,
    ).toBe(firstSnapshot.id);
    const scope = {
      attempt: lease.attempt,
      jobId: lease.jobId,
      leaseToken: lease.leaseToken,
      projectId: lease.projectId,
      tenantId: lease.tenantId,
      workerId: "live-scene-worker",
    };
    await worker.heartbeat({ ...scope, stage: "compiling" });
    await worker.heartbeat({ ...scope, stage: "publishing" });
    const fixtureManifest = validManifest();
    const manifest = {
      ...fixtureManifest,
      compiler: {
        ...fixtureManifest.compiler,
        configuration: request.configuration,
      },
      sourceSnapshot: request.sourceSnapshot,
    };
    const { configurationSha256, sceneDeterminismKey } =
      await import("../../src/modules/scenes/glb.js");
    const configHash = configurationSha256(request.configuration);
    const exactManifest = {
      ...manifest,
      compiler: { ...manifest.compiler, configurationSha256: configHash },
      determinismKeySha256: sceneDeterminismKey({
        compiler,
        configurationSha256: configHash,
        snapshotSha256: firstSnapshot.snapshotSha256,
      }),
    };
    const published = await worker.publish({
      ...scope,
      output: { glb: validGlb(), manifest: exactManifest },
    });
    expect(published.state).toBe("succeeded");

    const scene = await server.inject({
      headers: authorization(viewerToken),
      method: "GET",
      url: `/v1/projects/${project.id}/scene-jobs/${job.id}/scene`,
    });
    const access = await server.inject({
      headers: authorization(viewerToken),
      method: "POST",
      payload: {},
      url: `/v1/projects/${project.id}/scene-jobs/${job.id}/scene/access`,
    });
    expect(scene.statusCode).toBe(200);
    expect(access.statusCode).toBe(200);
    expect(`${scene.body}${access.body}`).not.toMatch(
      /objectKey|leaseToken|credential|providerId/u,
    );

    const counts = await administration<
      Array<{
        readonly accesses: number;
        readonly attempts: number;
        readonly branches: number;
        readonly cache_entries: number;
        readonly jobs: number;
        readonly operation_commits: number;
        readonly scenes: number;
        readonly snapshots: number;
      }>
    >`
      SELECT
        (SELECT count(*)::int FROM scene_jobs WHERE project_id = ${project.id}::uuid) AS jobs,
        (SELECT count(*)::int FROM scene_attempts WHERE project_id = ${project.id}::uuid) AS attempts,
        (SELECT count(*)::int FROM scenes WHERE project_id = ${project.id}::uuid) AS scenes,
        (SELECT count(*)::int FROM scene_cache_entries WHERE project_id = ${project.id}::uuid) AS cache_entries,
        (SELECT count(*)::int FROM scene_audit_events WHERE project_id = ${project.id}::uuid
          AND action = 'scene.artifact.access') AS accesses,
        (SELECT count(*)::int FROM canonical_model_snapshots WHERE project_id = ${project.id}::uuid) AS snapshots,
        (SELECT count(*)::int FROM model_branches WHERE project_id = ${project.id}::uuid) AS branches,
        (SELECT count(*)::int FROM model_operation_commits WHERE project_id = ${project.id}::uuid) AS operation_commits
    `;
    expect(counts[0]).toEqual({
      accesses: 1,
      attempts: 1,
      branches: 0,
      cache_entries: 1,
      jobs: 1,
      operation_commits: 0,
      scenes: 1,
      snapshots: 1,
    });
    await expect(
      administration`
        UPDATE scenes SET created_at = clock_timestamp()
        WHERE project_id = ${project.id}::uuid
      `,
    ).rejects.toThrow(/append-only/u);
    await expect(
      worker.publish({
        ...scope,
        output: { glb: validGlb(), manifest: exactManifest },
      }),
    ).rejects.toMatchObject({ code: "SCENE_LEASE_FENCED" });

    const secondSnapshotResponse = await server.inject({
      headers: {
        ...authorization(ownerToken),
        "idempotency-key": `c10-snapshot-${randomUUID()}`,
      },
      method: "POST",
      payload: {
        expectedCurrentSnapshotSha256: firstSnapshot.snapshotSha256,
        snapshot: canonicalSnapshotFixture({
          limitationDetail: "Synthetic second committed snapshot used for C10 retry fencing.",
          modelId,
          projectId: project.id,
        }),
      },
      url: `/v1/projects/${project.id}/models/existing/snapshots`,
    });
    expect(secondSnapshotResponse.statusCode).toBe(201);
    const secondSnapshot = modelSnapshotRecordSchema.parse(secondSnapshotResponse.json());
    const secondJobResponse = await server.inject({
      headers: {
        ...authorization(ownerToken),
        "idempotency-key": `c10-job-${randomUUID()}`,
      },
      method: "POST",
      payload: {
        ...request,
        label: "Synthetic cancellation and retry",
        sourceSnapshot: {
          ...request.sourceSnapshot,
          snapshotId: secondSnapshot.id,
          snapshotSha256: secondSnapshot.snapshotSha256,
        },
      },
      url: `/v1/projects/${project.id}/scene-jobs`,
    });
    expect(secondJobResponse.statusCode).toBe(201);
    const secondJob = secondJobResponse.json<{ readonly id: string }>();
    const cancelledLease = await worker.claimNext({
      compiler,
      workerId: "live-cancel-worker",
    });
    if (cancelledLease === undefined) throw new Error("Live C10 cancellation lease is missing.");
    const expiredScope = {
      attempt: cancelledLease.attempt,
      jobId: cancelledLease.jobId,
      leaseToken: cancelledLease.leaseToken,
      projectId: cancelledLease.projectId,
      tenantId: cancelledLease.tenantId,
      workerId: "live-cancel-worker",
    };
    await worker.heartbeat({ ...expiredScope, stage: "compiling" });
    await administration`
      UPDATE scene_attempts
      SET lease_expires_at = clock_timestamp() - interval '1 second',
        updated_at = GREATEST(updated_at + interval '1 microsecond', clock_timestamp()),
        fence_version = fence_version + 1
      WHERE project_id = ${project.id}::uuid AND job_id = ${secondJob.id}::uuid
        AND attempt = 1 AND state = 'leased'
    `;
    const reclaimedLease = await worker.claimNext({
      compiler,
      workerId: "live-reclaim-worker",
    });
    if (reclaimedLease === undefined) throw new Error("Live C10 reclaimed lease is missing.");
    expect(reclaimedLease).toMatchObject({
      attempt: 1,
      jobId: secondJob.id,
      stage: "compiling",
    });
    await expect(worker.loadSource(expiredScope)).rejects.toMatchObject({
      code: "SCENE_LEASE_FENCED",
    });
    const cancelledScope = {
      attempt: reclaimedLease.attempt,
      jobId: reclaimedLease.jobId,
      leaseToken: reclaimedLease.leaseToken,
      projectId: reclaimedLease.projectId,
      tenantId: reclaimedLease.tenantId,
      workerId: "live-reclaim-worker",
    };
    const activeSecondJob = await server.inject({
      headers: authorization(ownerToken),
      method: "GET",
      url: `/v1/projects/${project.id}/scene-jobs/${secondJob.id}`,
    });
    expect(activeSecondJob.statusCode).toBe(200);
    const cancellation = await server.inject({
      headers: {
        ...authorization(ownerToken),
        "idempotency-key": `c10-cancel-${randomUUID()}`,
      },
      method: "POST",
      payload: {
        expectedVersion: activeSecondJob.json<{ readonly version: number }>().version,
      },
      url: `/v1/projects/${project.id}/scene-jobs/${secondJob.id}/cancel`,
    });
    expect(cancellation.json()).toMatchObject({ state: "cancel-requested" });
    await expect(worker.heartbeat({ ...cancelledScope, stage: "compiling" })).rejects.toMatchObject(
      { code: "SCENE_CANCELLATION_REQUESTED" },
    );
    await worker.acknowledgeCancellation(cancelledScope);
    const terminalSecondJob = await server.inject({
      headers: authorization(ownerToken),
      method: "GET",
      url: `/v1/projects/${project.id}/scene-jobs/${secondJob.id}`,
    });
    const retry = await server.inject({
      headers: {
        ...authorization(ownerToken),
        "idempotency-key": `c10-retry-${randomUUID()}`,
      },
      method: "POST",
      payload: {
        expectedVersion: terminalSecondJob.json<{ readonly version: number }>().version,
      },
      url: `/v1/projects/${project.id}/scene-jobs/${secondJob.id}/retry`,
    });
    expect(retry.json()).toMatchObject({ attempt: 2, state: "queued" });
    await expect(worker.loadSource(cancelledScope)).rejects.toMatchObject({
      code: "SCENE_LEASE_FENCED",
    });
    const retryLease = await worker.claimNext({ compiler, workerId: "live-retry-worker" });
    if (retryLease === undefined) throw new Error("Live C10 retry lease is missing.");
    expect(retryLease).toMatchObject({ attempt: 2, jobId: secondJob.id });
    await worker.fail({
      attempt: retryLease.attempt,
      jobId: retryLease.jobId,
      leaseToken: retryLease.leaseToken,
      projectId: retryLease.projectId,
      retryable: false,
      safeCode: "SCENE_COMPILER_FAILED",
      tenantId: retryLease.tenantId,
      workerId: "live-retry-worker",
    });

    const finalCounts = await administration<
      Array<{
        readonly attempts: number;
        readonly branches: number;
        readonly jobs: number;
        readonly operation_commits: number;
        readonly snapshots: number;
      }>
    >`
      SELECT
        (SELECT count(*)::int FROM scene_jobs WHERE project_id = ${project.id}::uuid) AS jobs,
        (SELECT count(*)::int FROM scene_attempts WHERE project_id = ${project.id}::uuid) AS attempts,
        (SELECT count(*)::int FROM canonical_model_snapshots WHERE project_id = ${project.id}::uuid) AS snapshots,
        (SELECT count(*)::int FROM model_branches WHERE project_id = ${project.id}::uuid) AS branches,
        (SELECT count(*)::int FROM model_operation_commits WHERE project_id = ${project.id}::uuid) AS operation_commits
    `;
    expect(finalCounts[0]).toEqual({
      attempts: 3,
      branches: 0,
      jobs: 2,
      operation_commits: 0,
      snapshots: 2,
    });
  });
});
