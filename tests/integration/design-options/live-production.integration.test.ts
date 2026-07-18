import { creatorOwnedSyntheticAssetCatalog } from "../../../packages/interior-assets/src/index.js";
import { reduceModelOperations } from "../../../packages/model-operations/src/index.js";
import { parseGlb, sceneCompilerVersion } from "../../../packages/scene-compiler/src/index.js";
import { loadPlatformApiConfig } from "../../../packages/config/src/index.js";
import {
  canonicalHomeSnapshotSchema,
  designBriefSchema,
  listDesignOptionsResponseSchema,
  modelSnapshotRecordSchema,
  optionConfirmationSchema,
  optionJobSchema,
  sceneJobSchema,
  sceneRecordSchema,
  sessionSchema,
  type LocalPersona,
  type Project,
} from "../../../packages/contracts/src/index.js";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  GET as c12BffGet,
  POST as c12BffPost,
} from "../../../apps/web/src/app/api/c12/[...segments]/route.js";
import type { C12RouteContext } from "../../../apps/web/src/app/api/c12/_shared/design-options-proxy.js";
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
import { applyC11Migration } from "../../../services/platform-api/src/c11.js";
import { applyC12Migration } from "../../../services/platform-api/src/c12.js";
import { CatalogDesignAssetVerifier } from "../../../services/platform-api/src/modules/design-options/catalog.js";
import { PostgresDesignOptionRepository } from "../../../services/platform-api/src/modules/design-options/postgres.js";
import { DesignOptionWorkerRuntime } from "../../../services/platform-api/src/modules/design-options/worker.js";
import { PostgresSceneRepository } from "../../../services/platform-api/src/modules/scenes/postgres.js";
import { SceneWorkerService } from "../../../services/platform-api/src/modules/scenes/service.js";
import { PostgresSceneSnapshotVerifier } from "../../../services/platform-api/src/modules/scenes/snapshot.js";
import { InMemorySceneObjectStorage } from "../../../services/platform-api/src/modules/scenes/storage.js";
import { DesignOptionProcessingRunner } from "../../../services/spatial-worker/src/design-options/runner.js";
import { createJsonLogger } from "../../../services/spatial-worker/src/logger.js";
import { SceneCompilationRunner } from "../../../services/spatial-worker/src/scene-compile/runner.js";
import { richLease } from "../../../services/spatial-worker/test/design-options/support.js";

const configuredDatabaseUrl = process.env.C12_PRODUCTION_TEST_DATABASE_URL ?? "";
const databaseUrl =
  configuredDatabaseUrl ||
  "postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design";
const describeLive = configuredDatabaseUrl.length === 0 ? describe.skip : describe;
const sessionSecret = "c12-production-runner-test-secret-at-least-thirty-two-bytes";
const compiler = {
  name: "interior-design-scene-compiler" as const,
  version: sceneCompilerVersion,
};
const config = loadPlatformApiConfig({
  NODE_ENV: "test",
  PLATFORM_API_LOG_LEVEL: "silent",
  PLATFORM_API_SHUTDOWN_TIMEOUT_MS: "2000",
});

function authorization(token: string) {
  return { authorization: `Bearer ${token}` };
}

function c12BffContext(segments: readonly string[]): C12RouteContext {
  return { params: Promise.resolve({ segments: [...segments] }) };
}

function c12BffRequest(options: {
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly method: "GET" | "POST";
  readonly segments: readonly string[];
  readonly token: string;
}): Request {
  const headers = new Headers();
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.idempotencyKey) headers.set("idempotency-key", options.idempotencyKey);
  const request = new Request(`http://127.0.0.1/api/c12/${options.segments.join("/")}`, {
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    headers,
    method: options.method,
  });
  Object.defineProperty(request, "cookies", {
    value: {
      get(name: string) {
        return name === "hds_c1_session" ? { value: options.token } : undefined;
      },
    },
  });
  return request;
}

describeLive("C12 production API, deterministic worker, atomic branches and C10 GLB", () => {
  const previousApiBaseUrl = process.env.HOME_DESIGN_API_BASE_URL;
  const sql = createC1Sql(databaseUrl);
  const storage = new InMemorySceneObjectStorage();
  const server = createServer({
    c1: { database: sql },
    c4: { database: sql },
    c10: { compiler, database: sql, storage },
    c11: { database: sql },
    c12: { database: sql },
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
    await applyC11Migration(sql);
    await applyC12Migration(sql);
    await storage.readiness();
    const address = await server.listen({ host: "127.0.0.1", port: 0 });
    process.env.HOME_DESIGN_API_BASE_URL = address;
  });

  afterAll(async () => {
    if (previousApiBaseUrl === undefined) delete process.env.HOME_DESIGN_API_BASE_URL;
    else process.env.HOME_DESIGN_API_BASE_URL = previousApiBaseUrl;
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

  async function createProject(token: string): Promise<Project> {
    const response = await server.inject({
      headers: { ...authorization(token), "idempotency-key": randomUUID() },
      method: "POST",
      payload: { name: `Synthetic C12 production ${randomUUID()}` },
      url: "/v1/projects",
    });
    expect(response.statusCode).toBe(201);
    return response.json<Project>();
  }

  it("generates two replayable options, confirms isolated siblings, preserves existing and compiles one branch", async () => {
    const ownerToken = await signIn("homeowner-alpha");
    const project = await createProject(ownerToken);
    const sessionResponse = await server.inject({
      headers: authorization(ownerToken),
      method: "GET",
      url: "/v1/session",
    });
    const session = sessionSchema.parse(sessionResponse.json());
    const modelId = randomUUID();
    const sourceFixture = richLease().sourceSnapshot.snapshot;
    const sourceSnapshot = canonicalHomeSnapshotSchema.parse({
      ...structuredClone(sourceFixture),
      modelId,
      projectId: project.id,
      profile: "existing",
    });
    const space = sourceSnapshot.elements.spaces[0];
    if (space === undefined) throw new Error("The rich C12 fixture requires one target space.");

    const snapshotResponse = await server.inject({
      headers: { ...authorization(ownerToken), "idempotency-key": randomUUID() },
      method: "POST",
      payload: { expectedCurrentSnapshotSha256: null, snapshot: sourceSnapshot },
      url: `/v1/projects/${project.id}/models/existing/snapshots`,
    });
    expect(snapshotResponse.statusCode).toBe(201);
    const existing = modelSnapshotRecordSchema.parse(snapshotResponse.json());

    const briefKey = randomUUID();
    const briefResponse = await server.inject({
      headers: { ...authorization(ownerToken), "idempotency-key": briefKey },
      method: "PUT",
      payload: {
        expectedRevision: 0,
        idempotencyKey: briefKey,
        operations: [
          {
            entry: {
              category: "spatial-need",
              classification: "preference",
              id: randomUUID(),
              priority: 5,
              provenance: {
                capturedAt: new Date().toISOString(),
                method: "user-stated",
                statedByUserId: session.actor.userId,
              },
              roomOrLevelElementIds: [space.id],
              statement: "Create two distinct, usable living-room arrangements.",
              status: "active",
            },
            kind: "entry.add",
          },
        ],
      },
      url: `/v1/projects/${project.id}/design-brief`,
    });
    expect(briefResponse.statusCode).toBe(200);
    const draft = designBriefSchema.parse(briefResponse.json());
    const acceptanceKey = randomUUID();
    const acceptanceResponse = await server.inject({
      headers: { ...authorization(ownerToken), "idempotency-key": acceptanceKey },
      method: "POST",
      payload: { expectedRevision: draft.revision, idempotencyKey: acceptanceKey },
      url: `/v1/projects/${project.id}/design-brief/accept`,
    });
    expect(acceptanceResponse.statusCode).toBe(200);
    const accepted = designBriefSchema.parse(acceptanceResponse.json());
    const briefContentSha256 = acceptanceResponse.headers["x-interior-design-brief-content-sha256"];
    expect(accepted.status).toBe("accepted");
    expect(briefContentSha256).toMatch(/^[a-f0-9]{64}$/u);
    if (briefContentSha256 === undefined) throw new Error("Accepted brief hash is missing.");

    const beforeJob = await sql<
      Array<{ readonly branches: number; readonly commits: number; readonly proposed: number }>
    >`
      SELECT
        (SELECT count(*)::int FROM canonical_model_snapshots
          WHERE project_id = ${project.id}::uuid AND profile = 'proposed') AS proposed,
        (SELECT count(*)::int FROM model_branches
          WHERE project_id = ${project.id}::uuid AND profile = 'proposed') AS branches,
        (SELECT count(*)::int FROM model_operation_commits
          WHERE project_id = ${project.id}::uuid AND profile = 'proposed') AS commits
    `;
    expect(beforeJob[0]).toEqual({ branches: 0, commits: 0, proposed: 0 });

    const createJobKey = randomUUID();
    const createJobSegments = ["projects", project.id, "design-option-jobs"] as const;
    const jobResponse = await c12BffPost(
      c12BffRequest({
        body: {
          baseBrief: {
            briefId: accepted.id,
            contentSha256: briefContentSha256,
            revision: accepted.revision,
          },
          requestedDirections: ["circulation-first", "conversation-first"],
          requestedOptionCount: 2,
          sourceModel: {
            modelId,
            profile: "existing",
            snapshotId: existing.id,
            snapshotSha256: existing.snapshotSha256,
            snapshotVersion: existing.version,
          },
        },
        idempotencyKey: createJobKey,
        method: "POST",
        segments: createJobSegments,
        token: ownerToken,
      }),
      c12BffContext(createJobSegments),
    );
    expect(jobResponse.status).toBe(201);
    const queued = optionJobSchema.parse(await jobResponse.json());
    expect(queued).toMatchObject({ optionCount: 0, state: "queued" });
    expect(beforeJob[0]).toEqual({ branches: 0, commits: 0, proposed: 0 });

    const assetVerifier = new CatalogDesignAssetVerifier({
      catalog: creatorOwnedSyntheticAssetCatalog,
    });
    const optionRunner = new DesignOptionProcessingRunner({
      logger: createJsonLogger(),
      pollMilliseconds: 100,
      worker: new DesignOptionWorkerRuntime(
        new PostgresDesignOptionRepository(sql, { assetVerifier }),
      ),
      workerId: "c12-live-production-runner",
    });
    await expect(optionRunner.processNext()).resolves.toBe("processed");

    const completedSegments = [...createJobSegments, queued.id] as const;
    const completedResponse = await c12BffGet(
      c12BffRequest({ method: "GET", segments: completedSegments, token: ownerToken }),
      c12BffContext(completedSegments),
    );
    expect(completedResponse.status).toBe(200);
    const completed = optionJobSchema.parse(await completedResponse.json());
    expect(completed).toMatchObject({
      attempt: 1,
      optionCount: 2,
      stage: "complete",
      state: "succeeded",
    });
    const optionsSegments = [...completedSegments, "options"] as const;
    const optionsResponse = await c12BffGet(
      c12BffRequest({ method: "GET", segments: optionsSegments, token: ownerToken }),
      c12BffContext(optionsSegments),
    );
    expect(optionsResponse.status).toBe(200);
    const proposals = listDesignOptionsResponseSchema.parse(await optionsResponse.json());
    expect(proposals.options).toHaveLength(2);
    expect(proposals.optionSet?.pairwiseDiversity).toHaveLength(1);
    expect(proposals.optionSet?.pairwiseDiversity[0]?.spatiallyOrMateriallyDistinct).toBe(true);
    expect(new Set(proposals.options.map(({ direction }) => direction))).toEqual(
      new Set(["circulation-first", "conversation-first"]),
    );

    const workingSnapshot = canonicalHomeSnapshotSchema.parse({
      ...structuredClone(existing.snapshot),
      derivedFromSnapshotSha256: existing.snapshotSha256,
      profile: "proposed",
    });
    for (const option of proposals.options) {
      const elementKinds = new Set(
        option.operationBundle.operations.flatMap((operation) =>
          "element" in operation ? [operation.element.elementType] : [],
        ),
      );
      expect(elementKinds).toEqual(new Set(["finish", "furnishing", "light"]));
      expect(option.operationBundle.constraintResults.every(({ passed }) => passed)).toBe(true);
      const replay = reduceModelOperations(workingSnapshot, option.operationBundle.operations);
      expect(replay.hasBlockingFindings).toBe(false);
      expect(replay.snapshotSha256).toBe(option.operationBundle.candidateSnapshotSha256);
    }

    const afterGeneration = await sql<
      Array<{ readonly branches: number; readonly commits: number; readonly proposed: number }>
    >`
      SELECT
        (SELECT count(*)::int FROM canonical_model_snapshots
          WHERE project_id = ${project.id}::uuid AND profile = 'proposed') AS proposed,
        (SELECT count(*)::int FROM model_branches
          WHERE project_id = ${project.id}::uuid AND profile = 'proposed') AS branches,
        (SELECT count(*)::int FROM model_operation_commits
          WHERE project_id = ${project.id}::uuid AND profile = 'proposed') AS commits
    `;
    expect(afterGeneration[0]).toEqual({ branches: 0, commits: 0, proposed: 0 });

    const optionSet = proposals.optionSet;
    const first = proposals.options[0];
    const second = proposals.options[1];
    if (optionSet === undefined || first === undefined || second === undefined) {
      throw new Error("The deterministic C12 worker did not publish two complete options.");
    }
    const confirmationPayload = (idempotencyKey: string) => ({
      expectedBriefContentSha256: completed.baseBrief.contentSha256,
      expectedBriefRevision: completed.baseBrief.revision,
      expectedJobVersion: completed.version,
      expectedOptionSetSha256: optionSet.setSha256,
      expectedOptionStatus: "pending" as const,
      expectedSourceSnapshotSha256: completed.sourceModel.snapshotSha256,
      idempotencyKey,
    });
    const firstKey = randomUUID();
    const firstPayload = confirmationPayload(firstKey);
    const firstSegments = [...completedSegments, "options", first.id, "confirm"] as const;
    const firstConfirmationResponse = await c12BffPost(
      c12BffRequest({
        body: firstPayload,
        idempotencyKey: firstKey,
        method: "POST",
        segments: firstSegments,
        token: ownerToken,
      }),
      c12BffContext(firstSegments),
    );
    const firstUrl = `/v1/projects/${project.id}/design-option-jobs/${completed.id}/options/${first.id}/confirm`;
    const firstReplayResponse = await server.inject({
      headers: { ...authorization(ownerToken), "idempotency-key": firstKey },
      method: "POST",
      payload: firstPayload,
      url: firstUrl,
    });
    expect(firstConfirmationResponse.status).toBe(201);
    expect(firstReplayResponse.statusCode).toBe(201);
    expect(firstReplayResponse.headers["idempotent-replay"]).toBe("true");
    const firstConfirmationPayload = await firstConfirmationResponse.json();
    expect(firstReplayResponse.json()).toEqual(firstConfirmationPayload);
    const firstConfirmation = optionConfirmationSchema.parse(firstConfirmationPayload);

    const secondKey = randomUUID();
    const secondSegments = [...completedSegments, "options", second.id, "confirm"] as const;
    const secondConfirmationResponse = await c12BffPost(
      c12BffRequest({
        body: confirmationPayload(secondKey),
        idempotencyKey: secondKey,
        method: "POST",
        segments: secondSegments,
        token: ownerToken,
      }),
      c12BffContext(secondSegments),
    );
    expect(secondConfirmationResponse.status).toBe(201);
    const secondConfirmation = optionConfirmationSchema.parse(
      await secondConfirmationResponse.json(),
    );
    expect(firstConfirmation.branchId).not.toBe(secondConfirmation.branchId);
    expect(firstConfirmation.commitId).not.toBe(secondConfirmation.commitId);
    expect(firstConfirmation.resultSnapshotSha256).not.toBe(
      secondConfirmation.resultSnapshotSha256,
    );

    const topology = await sql<
      Array<{
        readonly branch_id: string;
        readonly branch_revision: number;
        readonly commit_id: string;
        readonly head_snapshot_id: string;
        readonly head_snapshot_sha256: string;
        readonly option_id: string;
        readonly parent_snapshot_id: string;
        readonly parent_snapshot_sha256: string;
        readonly result_snapshot_id: string;
        readonly result_snapshot_sha256: string;
        readonly source_snapshot_id: string;
        readonly source_snapshot_sha256: string;
      }>
    >`
      SELECT c.option_id, c.branch_id, c.commit_id, c.result_snapshot_id,
        c.result_snapshot_sha256, b.revision AS branch_revision,
        b.source_snapshot_id, b.source_snapshot_sha256,
        b.head_snapshot_id, b.head_snapshot_sha256,
        m.parent_snapshot_id, m.parent_snapshot_sha256
      FROM design_option_confirmations c
      JOIN model_branches b
        ON b.tenant_id = c.tenant_id AND b.project_id = c.project_id
        AND b.profile = c.profile AND b.id = c.branch_id
      JOIN model_operation_commits m
        ON m.tenant_id = c.tenant_id AND m.project_id = c.project_id
        AND m.profile = c.profile AND m.branch_id = c.branch_id AND m.id = c.commit_id
      WHERE c.project_id = ${project.id}::uuid AND c.job_id = ${completed.id}::uuid
      ORDER BY c.option_id
    `;
    expect(topology).toHaveLength(2);
    const candidateByOption = new Map(
      proposals.options.map((option) => [
        option.id,
        option.operationBundle.candidateSnapshotSha256,
      ]),
    );
    for (const row of topology) {
      expect(row.branch_revision).toBe(1);
      expect(row.source_snapshot_id).toBe(completed.workingModel.snapshotId);
      expect(row.source_snapshot_sha256).toBe(completed.workingModel.snapshotSha256);
      expect(row.parent_snapshot_id).toBe(completed.workingModel.snapshotId);
      expect(row.parent_snapshot_sha256).toBe(completed.workingModel.snapshotSha256);
      expect(row.head_snapshot_id).toBe(row.result_snapshot_id);
      expect(row.head_snapshot_sha256).toBe(row.result_snapshot_sha256);
      expect(row.result_snapshot_sha256).toBe(candidateByOption.get(row.option_id));
    }
    expect(new Set(topology.map(({ branch_id }) => branch_id)).size).toBe(2);
    expect(new Set(topology.map(({ commit_id }) => commit_id)).size).toBe(2);
    expect(new Set(topology.map(({ result_snapshot_id }) => result_snapshot_id)).size).toBe(2);

    const counts = await sql<
      Array<{
        readonly branches: number;
        readonly commits: number;
        readonly confirmations: number;
        readonly proposed: number;
      }>
    >`
      SELECT
        (SELECT count(*)::int FROM canonical_model_snapshots
          WHERE project_id = ${project.id}::uuid AND profile = 'proposed') AS proposed,
        (SELECT count(*)::int FROM model_branches
          WHERE project_id = ${project.id}::uuid AND profile = 'proposed') AS branches,
        (SELECT count(*)::int FROM model_operation_commits
          WHERE project_id = ${project.id}::uuid AND profile = 'proposed') AS commits,
        (SELECT count(*)::int FROM design_option_confirmations
          WHERE project_id = ${project.id}::uuid AND job_id = ${completed.id}::uuid) AS confirmations
    `;
    expect(counts[0]).toEqual({ branches: 2, commits: 2, confirmations: 2, proposed: 3 });

    const existingAfterResponse = await server.inject({
      headers: authorization(ownerToken),
      method: "GET",
      url: `/v1/projects/${project.id}/models/existing`,
    });
    expect(existingAfterResponse.statusCode).toBe(200);
    const existingAfter = modelSnapshotRecordSchema.parse(existingAfterResponse.json());
    expect(existingAfter).toEqual(existing);

    const firstTopology = topology.find(({ option_id }) => option_id === first.id);
    if (firstTopology === undefined) throw new Error("First confirmed branch topology is missing.");
    const sceneResponse = await server.inject({
      headers: { ...authorization(ownerToken), "idempotency-key": randomUUID() },
      method: "POST",
      payload: {
        configuration: {
          coordinateMapping: "c4-z-up-to-gltf-y-up-v1",
          geometryMode: "parametric-v1",
          materialMode: "status-aware-neutral-v1",
          purpose: "interactive-browser",
          unknownGeometryPolicy: "omit-and-report",
        },
        label: "C12 confirmed isolated branch",
        sourceSnapshot: {
          modelId,
          profile: "proposed",
          projectId: project.id,
          schemaVersion: "c4-canonical-home-v1",
          snapshotId: firstTopology.result_snapshot_id,
          snapshotSha256: firstTopology.result_snapshot_sha256,
        },
      },
      url: `/v1/projects/${project.id}/scene-jobs`,
    });
    expect(sceneResponse.statusCode).toBe(201);
    const sceneJob = sceneJobSchema.parse(sceneResponse.json());
    const sceneRunner = new SceneCompilationRunner({
      heartbeatMilliseconds: 1_000,
      leaseSeconds: 30,
      logger: createJsonLogger(),
      pollMilliseconds: 100,
      worker: new SceneWorkerService({
        repository: new PostgresSceneRepository(sql),
        snapshotVerifier: new PostgresSceneSnapshotVerifier(sql),
        storage,
      }),
      workerId: "c12-confirmed-scene-runner",
    });
    await expect(sceneRunner.processNext()).resolves.toBe("processed");
    const completedSceneJobResponse = await server.inject({
      headers: authorization(ownerToken),
      method: "GET",
      url: `/v1/projects/${project.id}/scene-jobs/${sceneJob.id}`,
    });
    expect(sceneJobSchema.parse(completedSceneJobResponse.json()).state).toBe("succeeded");
    const publishedSceneResponse = await server.inject({
      headers: authorization(ownerToken),
      method: "GET",
      url: `/v1/projects/${project.id}/scene-jobs/${sceneJob.id}/scene`,
    });
    const published = sceneRecordSchema.parse(publishedSceneResponse.json());
    expect(published.manifest.sourceSnapshot.snapshotId).toBe(firstTopology.result_snapshot_id);
    expect(published.manifest.sourceSnapshot.snapshotSha256).toBe(
      firstTopology.result_snapshot_sha256,
    );
    const bytes = storage.readForTest(published.artifact.glbSha256);
    if (bytes === undefined) throw new Error("The immutable C12-derived GLB is missing.");
    expect(bytes.byteLength).toBe(published.artifact.byteSize);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(published.artifact.glbSha256);
    const parsed = parseGlb(bytes);
    expect(parsed.counts).toMatchObject(published.manifest.counts);
    expect((parsed.json.asset as { readonly version?: unknown }).version).toBe("2.0");
    expect(parsed.json.extensionsRequired ?? []).toEqual([]);
    expect(JSON.stringify(parsed.json)).not.toMatch(/"uri"/u);
  }, 120_000);
});
