import { loadPlatformApiConfig } from "../../../packages/config/src/index.js";
import { canonicalFixture } from "../../../packages/scene-compiler/test/fixture.js";
import {
  modelSnapshotRecordSchema,
  sceneAccessResponseSchema,
  sceneJobSchema,
  sceneRecordSchema,
  type LocalPersona,
  type Project,
} from "../../../packages/contracts/src/index.js";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createServer } from "../../../services/platform-api/src/app.js";
import {
  applyC1Migration,
  bootstrapC1Fixtures,
  createC1Sql,
} from "../../../services/platform-api/src/c1.js";
import { applyC2Migration } from "../../../services/platform-api/src/c2.js";
import { applyC3Migration } from "../../../services/platform-api/src/c3.js";
import { applyC4Migration } from "../../../services/platform-api/src/c4.js";
import { applyC5Migration } from "../../../services/platform-api/src/c5.js";
import { applyC6Migration } from "../../../services/platform-api/src/c6.js";
import { applyC7Migration } from "../../../services/platform-api/src/c7.js";
import { applyC8Migration } from "../../../services/platform-api/src/c8.js";
import { applyC9Migration } from "../../../services/platform-api/src/c9.js";
import { applyC10Migration } from "../../../services/platform-api/src/c10.js";
import { DomainCanonicalSnapshotCodec } from "../../../services/platform-api/src/modules/models/core/canonical.js";
import { PostgresSceneRepository } from "../../../services/platform-api/src/modules/scenes/postgres.js";
import { SceneWorkerService } from "../../../services/platform-api/src/modules/scenes/service.js";
import { PostgresSceneSnapshotVerifier } from "../../../services/platform-api/src/modules/scenes/snapshot.js";
import { S3SceneObjectStorage } from "../../../services/platform-api/src/modules/scenes/storage.js";
import { createJsonLogger } from "../../../services/spatial-worker/src/logger.js";
import { SceneCompilationRunner } from "../../../services/spatial-worker/src/scene-compile/runner.js";

const databaseUrl = process.env.C10_RUNNER_TEST_DATABASE_URL ?? "";
const storageEndpoint = process.env.C10_RUNNER_TEST_STORAGE_ENDPOINT ?? "";
const describeLive =
  databaseUrl.length === 0 || storageEndpoint.length === 0 ? describe.skip : describe;
const sessionSecret = "c10-production-runner-test-secret-at-least-thirty-two-bytes";
const compiler = {
  name: "interior-design-scene-compiler" as const,
  version: "1.0.0",
};
const config = loadPlatformApiConfig({
  NODE_ENV: "test",
  PLATFORM_API_LOG_LEVEL: "silent",
  PLATFORM_API_SHUTDOWN_TIMEOUT_MS: "2000",
});

function authorization(token: string) {
  return { authorization: `Bearer ${token}` };
}

describeLive("C10 production-composed API, runner, compiler, Postgres and S3", () => {
  const sql = createC1Sql(databaseUrl);
  const storage = new S3SceneObjectStorage({
    accessKeyId: process.env.C10_RUNNER_TEST_STORAGE_ACCESS_KEY_ID ?? "localdev",
    endpoint: storageEndpoint,
    forcePathStyle: true,
    region: process.env.C10_RUNNER_TEST_STORAGE_REGION ?? "local",
    secretAccessKey:
      process.env.C10_RUNNER_TEST_STORAGE_SECRET_ACCESS_KEY ?? "local-development-only",
  });
  const server = createServer({
    c1: { database: sql },
    c4: {
      codec: new DomainCanonicalSnapshotCodec(),
      database: sql,
      geometryValidator: () => [],
    },
    c10: { compiler, database: sql, storage },
    config,
    environment: { C1_LOCAL_SESSION_SECRET: sessionSecret, NODE_ENV: "test" },
    logger: false,
  });

  beforeAll(async () => {
    await applyC1Migration(sql);
    await bootstrapC1Fixtures(sql, "test");
    await applyC2Migration(sql);
    await applyC3Migration(sql);
    await applyC4Migration(sql);
    await applyC5Migration(sql);
    await applyC6Migration(sql);
    await applyC7Migration(sql);
    await applyC8Migration(sql);
    await applyC9Migration(sql);
    await applyC10Migration(sql);
    await storage.readiness();
  });

  afterAll(async () => {
    await server.close();
    await sql.end({ timeout: 5 });
  });

  async function signIn(persona: LocalPersona): Promise<string> {
    const response = await server.inject({
      method: "POST",
      payload: { persona },
      url: "/v1/auth/local/session",
    });
    expect(response.statusCode).toBe(201);
    return response.json<{ readonly accessToken: string }>().accessToken;
  }

  it("publishes and downloads a real deterministic scene without mutating the canonical model", async () => {
    const ownerToken = await signIn("homeowner-alpha");
    const viewerToken = await signIn("viewer-alpha");
    const projectResponse = await server.inject({
      headers: {
        ...authorization(ownerToken),
        "idempotency-key": `c10-runner-project-${randomUUID()}`,
      },
      method: "POST",
      payload: { name: `Synthetic C10 runner ${randomUUID()}` },
      url: "/v1/projects",
    });
    expect(projectResponse.statusCode).toBe(201);
    const project = projectResponse.json<Project>();
    const modelId = randomUUID();
    const fixture = canonicalFixture();
    const snapshotResponse = await server.inject({
      headers: {
        ...authorization(ownerToken),
        "idempotency-key": `c10-runner-snapshot-${randomUUID()}`,
      },
      method: "POST",
      payload: {
        expectedCurrentSnapshotSha256: null,
        snapshot: {
          ...fixture,
          modelId,
          projectId: project.id,
        },
      },
      url: `/v1/projects/${project.id}/models/existing/snapshots`,
    });
    expect(snapshotResponse.statusCode).toBe(201);
    const snapshot = modelSnapshotRecordSchema.parse(snapshotResponse.json());
    const createResponse = await server.inject({
      headers: {
        ...authorization(ownerToken),
        "idempotency-key": `c10-runner-job-${randomUUID()}`,
      },
      method: "POST",
      payload: {
        configuration: {
          coordinateMapping: "c4-z-up-to-gltf-y-up-v1",
          geometryMode: "parametric-v1",
          materialMode: "status-aware-neutral-v1",
          purpose: "interactive-browser",
          unknownGeometryPolicy: "omit-and-report",
        },
        label: "Production-composed deterministic test scene",
        sourceSnapshot: {
          modelId,
          profile: "existing",
          projectId: project.id,
          schemaVersion: "c4-canonical-home-v1",
          snapshotId: snapshot.id,
          snapshotSha256: snapshot.snapshotSha256,
        },
      },
      url: `/v1/projects/${project.id}/scene-jobs`,
    });
    expect(createResponse.statusCode).toBe(201);
    const queued = sceneJobSchema.parse(createResponse.json());

    const runner = new SceneCompilationRunner({
      heartbeatMilliseconds: 1_000,
      leaseSeconds: 30,
      logger: createJsonLogger(),
      pollMilliseconds: 100,
      worker: new SceneWorkerService({
        repository: new PostgresSceneRepository(sql),
        snapshotVerifier: new PostgresSceneSnapshotVerifier(sql),
        storage,
      }),
      workerId: "c10-live-production-runner",
    });
    await expect(runner.processNext()).resolves.toBe("processed");

    const completedResponse = await server.inject({
      headers: authorization(viewerToken),
      method: "GET",
      url: `/v1/projects/${project.id}/scene-jobs/${queued.id}`,
    });
    const completed = sceneJobSchema.parse(completedResponse.json());
    expect(completed).toMatchObject({ attempt: 1, state: "succeeded" });
    const sceneResponse = await server.inject({
      headers: authorization(viewerToken),
      method: "GET",
      url: `/v1/projects/${project.id}/scene-jobs/${queued.id}/scene`,
    });
    const scene = sceneRecordSchema.parse(sceneResponse.json());
    expect(scene.manifest.sourceSnapshot.snapshotSha256).toBe(snapshot.snapshotSha256);
    expect(scene.manifest.compiler).toMatchObject(compiler);
    expect(scene.manifest.counts).toEqual({
      materials: 6,
      meshes: 9,
      nodes: 14,
      triangles: 281,
      vertices: 561,
    });
    expect(scene.artifact.byteSize).toBe(29_456);
    const accessResponse = await server.inject({
      headers: authorization(viewerToken),
      method: "POST",
      payload: {},
      url: `/v1/projects/${project.id}/scene-jobs/${queued.id}/scene/access`,
    });
    const access = sceneAccessResponseSchema.parse(accessResponse.json());
    const downloaded = await fetch(access.url);
    expect(downloaded.status).toBe(200);
    const bytes = new Uint8Array(await downloaded.arrayBuffer());
    expect(bytes.byteLength).toBe(scene.artifact.byteSize);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(scene.artifact.glbSha256);

    const counts = await sql<
      Array<{
        readonly branches: number;
        readonly operation_commits: number;
        readonly scenes: number;
        readonly snapshots: number;
      }>
    >`
      SELECT
        (SELECT count(*)::int FROM canonical_model_snapshots WHERE project_id = ${project.id}::uuid) AS snapshots,
        (SELECT count(*)::int FROM scenes WHERE project_id = ${project.id}::uuid) AS scenes,
        (SELECT count(*)::int FROM model_branches WHERE project_id = ${project.id}::uuid) AS branches,
        (SELECT count(*)::int FROM model_operation_commits WHERE project_id = ${project.id}::uuid) AS operation_commits
    `;
    expect(counts[0]).toEqual({
      branches: 0,
      operation_commits: 0,
      scenes: 1,
      snapshots: 1,
    });
  }, 60_000);
});
