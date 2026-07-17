import { loadPlatformApiConfig } from "@interior-design/config";
import {
  modelBranchSchema,
  modelCommitSchema,
  modelOperationHistoryResponseSchema,
  modelOperationsPreviewSchema,
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
import { PostgresModelOperationRepository } from "../../src/modules/models/operations/postgres.js";
import { alphaTenantId, canonicalSnapshotFixture, spaceId } from "../c4/fixtures.js";

const integrationDatabaseUrl = process.env.C5_TEST_DATABASE_URL ?? "";
const describeWithPostgres = integrationDatabaseUrl === "" ? describe.skip : describe;
const sessionSecret = "c5-postgres-session-secret-with-at-least-thirty-two-bytes";
const activeServers = new Set<ReturnType<typeof createServer>>();
const testConfig = loadPlatformApiConfig({
  NODE_ENV: "test",
  PLATFORM_API_LOG_LEVEL: "silent",
  PLATFORM_API_SHUTDOWN_TIMEOUT_MS: "2000",
});

function postgresServer() {
  const c1Database = createC1Sql(integrationDatabaseUrl);
  const c4Database = createC1Sql(integrationDatabaseUrl);
  const c5Database = createC1Sql(integrationDatabaseUrl);
  const server = createServer({
    c1: { closeDatabase: true, database: c1Database },
    c4: { closeDatabase: true, database: c4Database },
    c5: { closeDatabase: true, database: c5Database },
    config: testConfig,
    environment: {
      C1_LOCAL_SESSION_SECRET: sessionSecret,
      NODE_ENV: "test",
    },
    logger: false,
  });
  activeServers.add(server);
  return server;
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

function authorization(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createProject(
  server: ReturnType<typeof createServer>,
  token: string,
): Promise<Project> {
  const response = await server.inject({
    headers: { ...authorization(token), "idempotency-key": `c5-project-${randomUUID()}` },
    method: "POST",
    payload: { name: `Synthetic C5 ${randomUUID()}` },
    url: "/v1/projects",
  });
  expect(response.statusCode).toBe(201);
  return response.json<Project>();
}

describeWithPostgres("C5 real Postgres integration", () => {
  let administration: Sql;

  beforeAll(async () => {
    administration = createC1Sql(integrationDatabaseUrl);
    await applyC1Migration(administration);
    await bootstrapC1Fixtures(administration, "test");
    await applyC2Migration(administration);
    await applyC3Migration(administration);
    await applyC4Migration(administration);
    await applyC5Migration(administration);
  });

  afterAll(async () => {
    await administration.end({ timeout: 5 });
  });

  afterEach(async () => {
    await Promise.all([...activeServers].map((server) => server.close()));
    activeServers.clear();
  });

  it("proves typed initialization, preview isolation, atomic commit, replay, restore and immutability", async () => {
    const server = postgresServer();
    const ownerToken = await signIn(server, "homeowner-alpha");
    const viewerToken = await signIn(server, "viewer-alpha");
    const project = await createProject(server, ownerToken);
    const modelId = randomUUID();
    const initialSnapshot = canonicalSnapshotFixture({ modelId, projectId: project.id });
    const initializationRequest = {
      headers: { ...authorization(ownerToken), "idempotency-key": `c5-init-${randomUUID()}` },
      method: "POST" as const,
      payload: { expectedCurrentSnapshotSha256: null, snapshot: initialSnapshot },
      url: `/v1/projects/${project.id}/models/existing/snapshots`,
    };
    const [initializedLeft, initializedRight] = await Promise.all([
      server.inject(initializationRequest),
      server.inject(initializationRequest),
    ]);
    expect(initializedLeft.statusCode).toBe(201);
    expect(initializedRight.statusCode).toBe(201);
    expect(initializedRight.json()).toEqual(initializedLeft.json());
    const initialized = modelSnapshotRecordSchema.parse(initializedLeft.json());
    expect(initialized.version).toBe(1);

    const rawAmendment = await server.inject({
      ...initializationRequest,
      headers: { ...authorization(ownerToken), "idempotency-key": `c5-raw-${randomUUID()}` },
      payload: {
        expectedCurrentSnapshotSha256: initialized.snapshotSha256,
        snapshot: initialSnapshot,
      },
    });
    expect(rawAmendment.statusCode).toBe(409);
    expect(rawAmendment.json()).toMatchObject({ code: "TYPED_OPERATION_REQUIRED" });

    const branchesResponse = await server.inject({
      headers: authorization(viewerToken),
      method: "GET",
      url: `/v1/projects/${project.id}/models/existing/branches`,
    });
    expect(branchesResponse.statusCode).toBe(200);
    const main = modelBranchSchema.parse(
      branchesResponse.json<{ readonly branches: unknown[] }>().branches[0],
    );
    expect(main).toMatchObject({ revision: 1, sourceSnapshotId: initialized.id });

    const beforePreview = await administration<
      {
        readonly audit_count: number;
        readonly commit_count: number;
        readonly operation_count: number;
        readonly outbox_count: number;
        readonly snapshot_count: number;
      }[]
    >`
      SELECT
        (SELECT count(*)::int FROM canonical_model_snapshots
          WHERE project_id = ${project.id}::uuid AND model_id = ${modelId}::uuid) AS snapshot_count,
        (SELECT count(*)::int FROM model_operation_commits
          WHERE project_id = ${project.id}::uuid AND model_id = ${modelId}::uuid) AS commit_count,
        (SELECT count(*)::int FROM model_operation_envelopes
          WHERE project_id = ${project.id}::uuid AND model_id = ${modelId}::uuid) AS operation_count,
        (SELECT count(*)::int FROM model_domain_audit_events
          WHERE project_id = ${project.id}::uuid AND model_id = ${modelId}::uuid) AS audit_count,
        (SELECT count(*)::int FROM model_transactional_outbox
          WHERE project_id = ${project.id}::uuid AND model_id = ${modelId}::uuid) AS outbox_count
    `;
    const initialSpace = initialSnapshot.elements.spaces[0];
    if (initialSpace === undefined) throw new Error("Fixture space is missing.");
    const renameOperation = {
      clientOperationId: randomUUID(),
      name: {
        attribution: initialSpace.name.attribution,
        knowledge: "known" as const,
        value: "Restored drawing room",
      },
      reason: "Correct the room label from the homeowner's explicit confirmation.",
      schemaVersion: "c5-model-operation-v1" as const,
      spaceId,
      type: "space.rename.v1" as const,
    };
    const previewResponse = await server.inject({
      headers: { ...authorization(ownerToken), "idempotency-key": `c5-preview-${randomUUID()}` },
      method: "POST",
      payload: {
        expectedHeadSnapshotSha256: main.headSnapshotSha256,
        expectedRevision: main.revision,
        operations: [renameOperation],
      },
      url: `/v1/projects/${project.id}/models/existing/branches/${main.id}/previews`,
    });
    expect(previewResponse.statusCode).toBe(201);
    const preview = modelOperationsPreviewSchema.parse(previewResponse.json());
    expect(preview.hasBlockingFindings).toBe(false);
    const afterPreview = await administration<
      {
        readonly audit_count: number;
        readonly commit_count: number;
        readonly operation_count: number;
        readonly outbox_count: number;
        readonly snapshot_count: number;
      }[]
    >`
      SELECT
        (SELECT count(*)::int FROM canonical_model_snapshots
          WHERE project_id = ${project.id}::uuid AND model_id = ${modelId}::uuid) AS snapshot_count,
        (SELECT count(*)::int FROM model_operation_commits
          WHERE project_id = ${project.id}::uuid AND model_id = ${modelId}::uuid) AS commit_count,
        (SELECT count(*)::int FROM model_operation_envelopes
          WHERE project_id = ${project.id}::uuid AND model_id = ${modelId}::uuid) AS operation_count,
        (SELECT count(*)::int FROM model_domain_audit_events
          WHERE project_id = ${project.id}::uuid AND model_id = ${modelId}::uuid) AS audit_count,
        (SELECT count(*)::int FROM model_transactional_outbox
          WHERE project_id = ${project.id}::uuid AND model_id = ${modelId}::uuid) AS outbox_count
    `;
    expect(afterPreview[0]).toEqual(beforePreview[0]);

    const commitRequest = {
      headers: { ...authorization(ownerToken), "idempotency-key": `c5-commit-${randomUUID()}` },
      method: "POST" as const,
      payload: {
        commitMessage: "Rename the synthetic room.",
        expectedHeadSnapshotSha256: main.headSnapshotSha256,
        expectedRevision: main.revision,
        previewId: preview.id,
      },
      url: `/v1/projects/${project.id}/models/existing/branches/${main.id}/commits`,
    };
    const [committedLeft, committedRight] = await Promise.all([
      server.inject(commitRequest),
      server.inject(commitRequest),
    ]);
    expect(committedLeft.statusCode).toBe(201);
    expect(committedRight.statusCode).toBe(201);
    expect(committedRight.json()).toEqual(committedLeft.json());
    const committed = committedLeft.json<{
      readonly branch: unknown;
      readonly commit: unknown;
    }>();
    const committedBranch = modelBranchSchema.parse(committed.branch);
    const commit = modelCommitSchema.parse(committed.commit);
    expect(committedBranch.revision).toBe(2);
    expect(commit.operationIds).toHaveLength(1);

    const stale = await server.inject({
      ...commitRequest,
      headers: { ...authorization(ownerToken), "idempotency-key": `c5-stale-${randomUUID()}` },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      code: "BRANCH_REVISION_CONFLICT",
      currentRevision: 2,
    });

    const restoreResponse = await server.inject({
      headers: { ...authorization(ownerToken), "idempotency-key": `c5-restore-${randomUUID()}` },
      method: "POST",
      payload: {
        expectedHeadSnapshotSha256: committedBranch.headSnapshotSha256,
        expectedRevision: committedBranch.revision,
        reason: "Restore the exact initialized fixture as a new revision.",
        sourceSnapshotId: initialized.id,
        sourceSnapshotSha256: initialized.snapshotSha256,
      },
      url: `/v1/projects/${project.id}/models/existing/branches/${main.id}/restores`,
    });
    expect(restoreResponse.statusCode).toBe(201);
    expect(restoreResponse.json()).toMatchObject({ branch: { revision: 3 } });

    const historyResponse = await server.inject({
      headers: authorization(viewerToken),
      method: "GET",
      url: `/v1/projects/${project.id}/models/existing/branches/${main.id}/operations?limit=2`,
    });
    expect(historyResponse.statusCode).toBe(200);
    const firstHistory = modelOperationHistoryResponseSchema.parse(historyResponse.json());
    expect(firstHistory.operations).toHaveLength(2);
    expect(firstHistory.nextCursor).toBeDefined();
    expect(firstHistory.operations.map(({ type }) => type)).toEqual([
      "snapshot.restore.v1",
      "space.rename.v1",
    ]);
    if (firstHistory.nextCursor === undefined)
      throw new Error("Expected a bounded history cursor.");
    const secondHistory = modelOperationHistoryResponseSchema.parse(
      (
        await server.inject({
          headers: authorization(viewerToken),
          method: "GET",
          url: `/v1/projects/${project.id}/models/existing/branches/${main.id}/operations?limit=2&cursor=${encodeURIComponent(firstHistory.nextCursor)}`,
        })
      ).json(),
    );
    expect(secondHistory.operations.map(({ type }) => type)).toEqual(["snapshot.initialize.v1"]);

    const repository = new PostgresModelOperationRepository(administration);
    const replay = await repository.verifyReplay(alphaTenantId, project.id, "existing", main.id);
    expect(replay).toMatchObject({ commitCount: 3 });

    const counts = await administration<
      {
        readonly audit_count: number;
        readonly commit_count: number;
        readonly operation_count: number;
        readonly outbox_count: number;
        readonly snapshot_count: number;
      }[]
    >`
      SELECT
        (SELECT count(*)::int FROM canonical_model_snapshots
          WHERE project_id = ${project.id}::uuid AND model_id = ${modelId}::uuid) AS snapshot_count,
        (SELECT count(*)::int FROM model_operation_commits
          WHERE project_id = ${project.id}::uuid AND model_id = ${modelId}::uuid) AS commit_count,
        (SELECT count(*)::int FROM model_operation_envelopes
          WHERE project_id = ${project.id}::uuid AND model_id = ${modelId}::uuid) AS operation_count,
        (SELECT count(*)::int FROM model_domain_audit_events
          WHERE project_id = ${project.id}::uuid AND model_id = ${modelId}::uuid) AS audit_count,
        (SELECT count(*)::int FROM model_transactional_outbox
          WHERE project_id = ${project.id}::uuid AND model_id = ${modelId}::uuid) AS outbox_count
    `;
    expect(counts[0]).toEqual({
      audit_count: 3,
      commit_count: 3,
      operation_count: 3,
      outbox_count: 3,
      snapshot_count: 3,
    });

    await expect(
      administration`
        UPDATE model_operation_envelopes SET reason = 'tamper'
        WHERE project_id = ${project.id}::uuid AND model_id = ${modelId}::uuid
      `,
    ).rejects.toThrow(/append-only/u);
    await expect(
      administration`
        DELETE FROM model_domain_audit_events
        WHERE project_id = ${project.id}::uuid AND model_id = ${modelId}::uuid
      `,
    ).rejects.toThrow(/append-only/u);
  });
});
