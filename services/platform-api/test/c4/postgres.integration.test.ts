import { loadPlatformApiConfig } from "@interior-design/config";
import {
  canonicalHomeSnapshotSchema,
  modelProfilesResponseSchema,
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
import { LocalCanonicalSnapshotCodec } from "../../src/modules/models/core/canonical.js";
import { alphaTenantId, canonicalSnapshotFixture } from "./fixtures.js";

const integrationDatabaseUrl = process.env.C4_TEST_DATABASE_URL ?? "";
const describeWithPostgres = integrationDatabaseUrl === "" ? describe.skip : describe;
const sessionSecret = "c4-postgres-session-secret-with-at-least-thirty-two-bytes";
const codec = new LocalCanonicalSnapshotCodec();
const activeServers = new Set<ReturnType<typeof createServer>>();
const testConfig = loadPlatformApiConfig({
  NODE_ENV: "test",
  PLATFORM_API_LOG_LEVEL: "silent",
  PLATFORM_API_SHUTDOWN_TIMEOUT_MS: "2000",
});

function postgresServer() {
  const c1Database = createC1Sql(integrationDatabaseUrl);
  const c4Database = createC1Sql(integrationDatabaseUrl);
  const server = createServer({
    c1: { closeDatabase: true, database: c1Database },
    c4: {
      closeDatabase: true,
      codec,
      database: c4Database,
      geometryValidator: (snapshot) => [
        {
          affectedElementIds: [snapshot.elements.levels[0]?.id ?? snapshot.modelId],
          code: "UNKNOWN_STOREY_HEIGHT",
          message: "Storey height remains explicitly unknown in the synthetic fixture.",
          severity: "warning",
        },
      ],
    },
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

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  await server.close();
  activeServers.delete(server);
}

async function signIn(
  server: ReturnType<typeof createServer>,
  persona: LocalPersona,
): Promise<string> {
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
  name: string,
): Promise<Project> {
  const response = await server.inject({
    headers: {
      ...authorization(token),
      "idempotency-key": `c4-project-${randomUUID()}`,
    },
    method: "POST",
    payload: { name },
    url: "/v1/projects",
  });
  expect(response.statusCode).toBe(201);
  return response.json<Project>();
}

function createSnapshotRequest(
  token: string,
  projectId: string,
  profile: "as-built" | "existing" | "proposed",
  idempotencyKey: string,
  expectedCurrentSnapshotSha256: string | null,
  snapshot: ReturnType<typeof canonicalSnapshotFixture>,
) {
  return {
    headers: { ...authorization(token), "idempotency-key": idempotencyKey },
    method: "POST" as const,
    payload: { expectedCurrentSnapshotSha256, snapshot },
    url: `/v1/projects/${projectId}/models/${profile}/snapshots`,
  };
}

describeWithPostgres("C4 real Postgres integration", () => {
  let administration: Sql;

  beforeAll(async () => {
    administration = createC1Sql(integrationDatabaseUrl);
    await applyC1Migration(administration);
    await bootstrapC1Fixtures(administration, "test");
    await applyC2Migration(administration);
    await applyC3Migration(administration);
    await applyC4Migration(administration);
  });

  afterAll(async () => {
    await administration.end({ timeout: 5 });
  });

  afterEach(async () => {
    await Promise.all([...activeServers].map(async (server) => closeServer(server)));
  });

  it("proves replay, optimistic concurrency, immutable history, profiles, roles, and isolation", async () => {
    const server = postgresServer();
    const ownerToken = await signIn(server, "homeowner-alpha");
    const betaToken = await signIn(server, "homeowner-beta");
    const viewerToken = await signIn(server, "viewer-alpha");
    const project = await createProject(server, ownerToken, `Synthetic C4 ${randomUUID()}`);
    const betaProject = await createProject(server, betaToken, `Synthetic beta C4 ${randomUUID()}`);
    const modelId = randomUUID();
    const initialSnapshot = canonicalSnapshotFixture({ modelId, projectId: project.id });
    const foreignProperty = await server.inject(
      createSnapshotRequest(
        ownerToken,
        project.id,
        "existing",
        "c4-pg-property-bound",
        null,
        canonicalHomeSnapshotSchema.parse({ ...initialSnapshot, propertyId: randomUUID() }),
      ),
    );
    expect(foreignProperty.statusCode).toBe(400);
    expect(foreignProperty.json()).toMatchObject({ code: "INVALID_MODEL_BOUNDARY" });
    const initialRequest = createSnapshotRequest(
      ownerToken,
      project.id,
      "existing",
      "c4-pg-replay-0001",
      null,
      initialSnapshot,
    );

    const [createdLeft, createdRight] = await Promise.all([
      server.inject(initialRequest),
      server.inject(initialRequest),
    ]);
    expect(createdLeft.statusCode).toBe(201);
    expect(createdRight.statusCode).toBe(201);
    expect(createdRight.json()).toEqual(createdLeft.json());
    const first = modelSnapshotRecordSchema.parse(createdLeft.json());
    expect(first.version).toBe(1);

    const sameKeyDifferentBody = await server.inject({
      ...initialRequest,
      payload: {
        ...initialRequest.payload,
        snapshot: canonicalSnapshotFixture({
          limitationDetail: "Different synthetic body; still not survey or as-built truth.",
          modelId,
          projectId: project.id,
        }),
      },
    });
    expect(sameKeyDifferentBody.statusCode).toBe(409);
    expect(sameKeyDifferentBody.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const stale = await server.inject(
      createSnapshotRequest(
        ownerToken,
        project.id,
        "existing",
        "c4-pg-stale-00001",
        null,
        canonicalSnapshotFixture({
          limitationDetail: "Stale synthetic body; still not survey or as-built truth.",
          modelId,
          projectId: project.id,
        }),
      ),
    );
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: "REVISION_CONFLICT" });

    const leftSnapshot = canonicalSnapshotFixture({
      limitationDetail: "Synthetic concurrent left; not survey or as-built truth.",
      modelId,
      projectId: project.id,
    });
    const rightSnapshot = canonicalSnapshotFixture({
      limitationDetail: "Synthetic concurrent right; not survey or as-built truth.",
      modelId,
      projectId: project.id,
    });
    const [raceLeft, raceRight] = await Promise.all([
      server.inject(
        createSnapshotRequest(
          ownerToken,
          project.id,
          "existing",
          "c4-pg-race-left01",
          first.snapshotSha256,
          leftSnapshot,
        ),
      ),
      server.inject(
        createSnapshotRequest(
          ownerToken,
          project.id,
          "existing",
          "c4-pg-race-right1",
          first.snapshotSha256,
          rightSnapshot,
        ),
      ),
    ]);
    expect([raceLeft.statusCode, raceRight.statusCode].sort()).toEqual([201, 409]);
    const winner = modelSnapshotRecordSchema.parse(
      raceLeft.statusCode === 201 ? raceLeft.json() : raceRight.json(),
    );
    expect(winner.version).toBe(2);

    const historical = await server.inject({
      headers: authorization(viewerToken),
      method: "GET",
      url: `/v1/projects/${project.id}/models/existing/snapshots/${first.id}`,
    });
    const current = await server.inject({
      headers: authorization(viewerToken),
      method: "GET",
      url: `/v1/projects/${project.id}/models/existing`,
    });
    expect(historical.json()).toEqual(first);
    expect(current.json()).toEqual(winner);

    const proposedModelId = randomUUID();
    const proposed = await server.inject(
      createSnapshotRequest(
        ownerToken,
        project.id,
        "proposed",
        "c4-pg-proposed-001",
        null,
        canonicalSnapshotFixture({
          derivedFromSnapshotSha256: winner.snapshotSha256,
          modelId: proposedModelId,
          profile: "proposed",
          projectId: project.id,
        }),
      ),
    );
    expect(proposed.statusCode).toBe(201);
    const proposedRecord = modelSnapshotRecordSchema.parse(proposed.json());
    expect(proposedRecord.version).toBe(1);

    const profiles = await server.inject({
      headers: authorization(viewerToken),
      method: "GET",
      url: `/v1/projects/${project.id}/models`,
    });
    expect(modelProfilesResponseSchema.parse(profiles.json()).profiles).toEqual([
      expect.objectContaining({ profile: "existing", status: "available", version: 2 }),
      expect.objectContaining({ profile: "proposed", status: "available", version: 1 }),
      { profile: "as-built", status: "empty" },
    ]);

    const wrongProfile = await server.inject({
      headers: authorization(viewerToken),
      method: "GET",
      url: `/v1/projects/${project.id}/models/existing/snapshots/${proposedRecord.id}`,
    });
    expect(wrongProfile.statusCode).toBe(404);

    const viewerWrite = await server.inject(
      createSnapshotRequest(
        viewerToken,
        project.id,
        "existing",
        "c4-pg-viewer-denied",
        winner.snapshotSha256,
        leftSnapshot,
      ),
    );
    expect(viewerWrite.statusCode).toBe(403);

    const foreign = await server.inject({
      headers: authorization(ownerToken),
      method: "GET",
      url: `/v1/projects/${betaProject.id}/models/existing`,
    });
    const unknown = await server.inject({
      headers: authorization(ownerToken),
      method: "GET",
      url: `/v1/projects/${randomUUID()}/models/existing`,
    });
    expect([foreign.statusCode, unknown.statusCode]).toEqual([404, 404]);
    expect(foreign.json()).toMatchObject({
      code: "NOT_FOUND",
      detail: unknown.json<{ readonly detail: string }>().detail,
    });

    const counts = await administration<
      Array<{ readonly audits: number; readonly idempotency: number; readonly snapshots: number }>
    >`
      SELECT
        (
          SELECT count(*)::integer
          FROM canonical_model_snapshots
          WHERE tenant_id = ${alphaTenantId}::uuid
            AND project_id = ${project.id}::uuid
        ) AS snapshots,
        (
          SELECT count(*)::integer
          FROM canonical_model_audit_events
          WHERE tenant_id = ${alphaTenantId}::uuid
            AND project_id = ${project.id}::uuid
        ) AS audits,
        (
          SELECT count(*)::integer
          FROM canonical_model_idempotency
          WHERE tenant_id = ${alphaTenantId}::uuid
            AND project_id = ${project.id}::uuid
        ) AS idempotency
    `;
    expect(counts[0]).toEqual({ audits: 3, idempotency: 3, snapshots: 3 });
  });

  it("recomputes JSONB through the codec and enforces immutable same-boundary pointers", async () => {
    const server = postgresServer();
    const ownerToken = await signIn(server, "homeowner-alpha");
    const project = await createProject(
      server,
      ownerToken,
      `Synthetic C4 integrity ${randomUUID()}`,
    );
    const existing = await server.inject(
      createSnapshotRequest(
        ownerToken,
        project.id,
        "existing",
        "c4-pg-integrity-001",
        null,
        canonicalSnapshotFixture({ modelId: randomUUID(), projectId: project.id }),
      ),
    );
    const existingRecord = modelSnapshotRecordSchema.parse(existing.json());
    const proposed = await server.inject(
      createSnapshotRequest(
        ownerToken,
        project.id,
        "proposed",
        "c4-pg-integrity-002",
        null,
        canonicalSnapshotFixture({
          derivedFromSnapshotSha256: existingRecord.snapshotSha256,
          modelId: randomUUID(),
          profile: "proposed",
          projectId: project.id,
        }),
      ),
    );
    const proposedRecord = modelSnapshotRecordSchema.parse(proposed.json());

    const rows = await administration<
      Array<{
        readonly canonical_byte_length: number;
        readonly canonical_snapshot: unknown;
        readonly snapshot_sha256: string;
        readonly validation_findings: unknown;
      }>
    >`
      SELECT canonical_snapshot, snapshot_sha256, canonical_byte_length, validation_findings
      FROM canonical_model_snapshots
      WHERE tenant_id = ${alphaTenantId}::uuid
        AND project_id = ${project.id}::uuid
        AND id = ${existingRecord.id}::uuid
      LIMIT 1
    `;
    const row = rows[0];
    expect(row).toBeDefined();
    if (row === undefined) {
      throw new Error("Expected persisted canonical snapshot row.");
    }
    // JSONB object order is deliberately ignored. Reparse the value and run
    // the exact codec port used by API reads; never hash jsonb::text.
    const roundTripped = canonicalHomeSnapshotSchema.parse(row.canonical_snapshot);
    const recomputed = codec.encode(roundTripped);
    expect(recomputed.snapshotSha256).toBe(row.snapshot_sha256);
    expect(recomputed.canonicalByteLength).toBe(row.canonical_byte_length);
    expect(row.validation_findings).toEqual([
      expect.objectContaining({ code: "UNKNOWN_STOREY_HEIGHT", severity: "warning" }),
    ]);

    await expect(
      administration`
        UPDATE canonical_model_snapshots
        SET canonical_byte_length = canonical_byte_length + 1
        WHERE tenant_id = ${alphaTenantId}::uuid
          AND project_id = ${project.id}::uuid
          AND id = ${existingRecord.id}::uuid
      `,
    ).rejects.toThrow(/append-only/u);
    await expect(
      administration`
        DELETE FROM canonical_model_snapshots
        WHERE tenant_id = ${alphaTenantId}::uuid
          AND project_id = ${project.id}::uuid
          AND id = ${existingRecord.id}::uuid
      `,
    ).rejects.toThrow(/append-only/u);
    await expect(
      administration`
        UPDATE canonical_model_profiles
        SET current_snapshot_id = ${proposedRecord.id}::uuid,
            current_snapshot_sha256 = ${proposedRecord.snapshotSha256},
            current_snapshot_version = current_snapshot_version + 1,
            updated_at = clock_timestamp()
        WHERE tenant_id = ${alphaTenantId}::uuid
          AND project_id = ${project.id}::uuid
          AND profile = 'existing'
      `,
    ).rejects.toThrow();

    const stillCurrent = await server.inject({
      headers: authorization(ownerToken),
      method: "GET",
      url: `/v1/projects/${project.id}/models/existing`,
    });
    expect(stillCurrent.json()).toEqual(existingRecord);

    const storedText = JSON.stringify({
      audit: await administration`
        SELECT action, request_id, trace_id
        FROM canonical_model_audit_events
        WHERE tenant_id = ${alphaTenantId}::uuid
          AND project_id = ${project.id}::uuid
      `,
      idempotency: await administration`
        SELECT operation, request_hash, response_snapshot_id
        FROM canonical_model_idempotency
        WHERE tenant_id = ${alphaTenantId}::uuid
          AND project_id = ${project.id}::uuid
      `,
    });
    expect(storedText).not.toMatch(/canonical_snapshot|validation_findings|source_object_key/iu);
  });
});
