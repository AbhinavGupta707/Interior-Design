import type { LocalPersona, Project, ProjectIntake } from "@interior-design/contracts";
import { loadPlatformApiConfig } from "@interior-design/config";
import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { applyC1Migration, bootstrapC1Fixtures, createC1Sql } from "../../src/c1.js";
import { createServer } from "../../src/app.js";

const integrationDatabaseUrl = process.env.C1_TEST_DATABASE_URL ?? "";
const describeWithPostgres = integrationDatabaseUrl === "" ? describe.skip : describe;
const alphaTenantId = "10000000-0000-4000-8000-000000000001";
const betaTenantId = "10000000-0000-4000-8000-000000000002";
const activeServers = new Set<ReturnType<typeof createServer>>();

const testConfig = loadPlatformApiConfig({
  NODE_ENV: "test",
  PLATFORM_API_LOG_LEVEL: "silent",
  PLATFORM_API_SHUTDOWN_TIMEOUT_MS: "2000",
});

const sampleIntake = {
  accessibilityNeeds: [],
  dwellingType: "semi-detached-house" as const,
  evidenceAvailable: {
    photographs: true,
    plans: true,
    roomCapture: false,
    video: false,
  },
  goals: ["Improve flow and natural light"],
  household: { adults: 2, children: 1, pets: 1 },
  mustChange: ["Disconnected kitchen"],
  mustKeep: ["Original fireplace"],
  notes: "audit-secret-prose-marker",
  styleWords: ["warm", "practical"],
};

async function clearTenantData(sql: Sql): Promise<void> {
  for (const tenantId of [alphaTenantId, betaTenantId]) {
    await sql`DELETE FROM audit_events WHERE tenant_id = ${tenantId}::uuid`;
    await sql`DELETE FROM project_intakes WHERE tenant_id = ${tenantId}::uuid`;
    await sql`DELETE FROM mutation_idempotency WHERE tenant_id = ${tenantId}::uuid`;
    await sql`DELETE FROM projects WHERE tenant_id = ${tenantId}::uuid`;
  }
}

function postgresServer() {
  const database = createC1Sql(integrationDatabaseUrl);
  const server = createServer({
    c1: { closeDatabase: true, database },
    config: testConfig,
    environment: {
      C1_LOCAL_SESSION_SECRET: "integration-session-secret-with-at-least-thirty-two-bytes",
      NODE_ENV: "test",
    },
    logger: false,
  });
  activeServers.add(server);
  return server;
}

async function closeIntegrationServer(server: ReturnType<typeof createServer>): Promise<void> {
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
  return response.json<{ accessToken: string }>().accessToken;
}

function authorization(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

describeWithPostgres("C1 real Postgres integration", () => {
  let administration: Sql;

  beforeAll(async () => {
    administration = createC1Sql(integrationDatabaseUrl);
    await applyC1Migration(administration);
    await bootstrapC1Fixtures(administration, "test");
    await clearTenantData(administration);
  });

  afterAll(async () => {
    await clearTenantData(administration);
    await administration.end({ timeout: 5 });
  });

  afterEach(async () => {
    await Promise.all([...activeServers].map(async (server) => closeIntegrationServer(server)));
  });

  it("persists across restart with isolation, idempotency, concurrency, and safe audit", async () => {
    const firstServer = postgresServer();
    const readiness = await firstServer.inject({ method: "GET", url: "/health/ready" });
    expect(readiness.statusCode).toBe(200);
    expect(readiness.json()).toMatchObject({ status: "ready" });
    const alphaToken = await signIn(firstServer, "homeowner-alpha");
    const betaToken = await signIn(firstServer, "homeowner-beta");
    const viewerToken = await signIn(firstServer, "viewer-alpha");

    const createAlpha = {
      headers: { ...authorization(alphaToken), "idempotency-key": "pg-create-alpha-01" },
      method: "POST" as const,
      payload: { name: "Persistent alpha home" },
      url: "/v1/projects",
    };
    const [alphaCreated, alphaReplay] = await Promise.all([
      firstServer.inject(createAlpha),
      firstServer.inject(createAlpha),
    ]);
    expect(alphaCreated.statusCode).toBe(201);
    expect(alphaReplay.json()).toEqual(alphaCreated.json());
    const alphaProject = alphaCreated.json<Project>();

    const createConflict = await firstServer.inject({
      ...createAlpha,
      payload: { name: "Changed name" },
    });
    expect(createConflict.statusCode).toBe(409);
    expect(createConflict.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const betaCreated = await firstServer.inject({
      headers: { ...authorization(betaToken), "idempotency-key": "pg-create-beta-001" },
      method: "POST",
      payload: { name: "Beta home" },
      url: "/v1/projects",
    });
    const betaProject = betaCreated.json<Project>();

    const foreign = await firstServer.inject({
      headers: authorization(alphaToken),
      method: "GET",
      url: `/v1/projects/${betaProject.id}`,
    });
    const unknown = await firstServer.inject({
      headers: authorization(alphaToken),
      method: "GET",
      url: `/v1/projects/${randomUUID()}`,
    });
    expect(foreign.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
    const unknownProblem = unknown.json<{ detail: string }>();
    expect(foreign.json()).toMatchObject({ code: "NOT_FOUND", detail: unknownProblem.detail });

    const foreignIntake = await firstServer.inject({
      headers: authorization(alphaToken),
      method: "GET",
      url: `/v1/projects/${betaProject.id}/intake`,
    });
    const unknownIntake = await firstServer.inject({
      headers: authorization(alphaToken),
      method: "GET",
      url: `/v1/projects/${randomUUID()}/intake`,
    });
    expect(foreignIntake.statusCode).toBe(404);
    expect(unknownIntake.statusCode).toBe(404);
    expect(foreignIntake.json()).toMatchObject({
      code: "NOT_FOUND",
      detail: unknownIntake.json<{ detail: string }>().detail,
    });

    const viewerDenied = await firstServer.inject({
      headers: { ...authorization(viewerToken), "idempotency-key": "pg-viewer-create-1" },
      method: "POST",
      payload: { name: "Denied" },
      url: "/v1/projects",
    });
    expect(viewerDenied.statusCode).toBe(403);

    const intakeUrl = `/v1/projects/${alphaProject.id}/intake`;
    const createIntake = {
      headers: { ...authorization(alphaToken), "idempotency-key": "pg-intake-create-1" },
      method: "PUT" as const,
      payload: { expectedVersion: 0, intake: sampleIntake },
      url: intakeUrl,
    };
    const [intakeCreated, intakeReplay] = await Promise.all([
      firstServer.inject(createIntake),
      firstServer.inject(createIntake),
    ]);
    expect(intakeCreated.json()).toMatchObject({ version: 1 });
    expect(intakeReplay.json()).toEqual(intakeCreated.json());

    const intakeKeyConflict = await firstServer.inject({
      ...createIntake,
      payload: { expectedVersion: 0, intake: { ...sampleIntake, goals: ["Changed"] } },
    });
    expect(intakeKeyConflict.statusCode).toBe(409);
    expect(intakeKeyConflict.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const stale = await firstServer.inject({
      ...createIntake,
      headers: { ...authorization(alphaToken), "idempotency-key": "pg-intake-stale-01" },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: "REVISION_CONFLICT" });

    const updateRequest = {
      headers: { ...authorization(alphaToken), "idempotency-key": "pg-intake-update-1" },
      method: "PUT" as const,
      payload: {
        expectedVersion: 1,
        intake: { ...sampleIntake, styleWords: ["light", "calm"] },
      },
      url: intakeUrl,
    };
    const update = await firstServer.inject(updateRequest);
    const updateReplay = await firstServer.inject(updateRequest);
    expect(update.json()).toMatchObject({ version: 2 });
    expect(updateReplay.json()).toEqual(update.json());

    await closeIntegrationServer(firstServer);

    const restartedServer = postgresServer();
    const persistedProject = await restartedServer.inject({
      headers: authorization(alphaToken),
      method: "GET",
      url: `/v1/projects/${alphaProject.id}`,
    });
    const persistedIntake = await restartedServer.inject({
      headers: authorization(alphaToken),
      method: "GET",
      url: intakeUrl,
    });
    expect(persistedProject.json<Project>()).toEqual(alphaProject);
    expect(persistedIntake.json<ProjectIntake>()).toMatchObject({
      intake: { styleWords: ["light", "calm"] },
      projectId: alphaProject.id,
      version: 2,
    });

    const malformed = await restartedServer.inject({
      headers: { authorization: "Bearer malformed" },
      method: "GET",
      url: "/v1/session",
    });
    expect(malformed.statusCode).toBe(401);
    expect(malformed.body).not.toContain("malformed");
    await closeIntegrationServer(restartedServer);

    const audit = await administration<
      Array<{
        action: string;
        actor_user_id: string;
        request_id: string;
        resource_id: string;
        tenant_id: string;
        trace_id: string;
      }>
    >`
      SELECT action, actor_user_id, request_id, resource_id, tenant_id, trace_id
      FROM audit_events
      WHERE tenant_id = ${alphaTenantId}::uuid
      ORDER BY occurred_at ASC
    `;
    expect(audit.map((event) => event.action)).toEqual([
      "project.create",
      "intake.create",
      "intake.update",
    ]);
    expect(JSON.stringify(audit)).not.toContain(sampleIntake.notes);
    expect(audit.every((event) => event.tenant_id === alphaTenantId)).toBe(true);
    expect(audit.every((event) => /^[0-9a-f]{32}$/.test(event.trace_id))).toBe(true);
  });

  it("serializes simultaneous first-intake writes so one becomes stale", async () => {
    const server = postgresServer();
    const token = await signIn(server, "homeowner-alpha");
    const created = await server.inject({
      headers: { ...authorization(token), "idempotency-key": "pg-race-project-01" },
      method: "POST",
      payload: { name: "Concurrency home" },
      url: "/v1/projects",
    });
    const project = created.json<Project>();
    const url = `/v1/projects/${project.id}/intake`;
    const [left, right] = await Promise.all([
      server.inject({
        headers: { ...authorization(token), "idempotency-key": "pg-race-intake-left" },
        method: "PUT",
        payload: { expectedVersion: 0, intake: { ...sampleIntake, goals: ["Left"] } },
        url,
      }),
      server.inject({
        headers: { ...authorization(token), "idempotency-key": "pg-race-intake-right" },
        method: "PUT",
        payload: { expectedVersion: 0, intake: { ...sampleIntake, goals: ["Right"] } },
        url,
      }),
    ]);
    expect([left.statusCode, right.statusCode].sort()).toEqual([200, 409]);
    const conflict = left.statusCode === 409 ? left : right;
    expect(conflict.json()).toMatchObject({ code: "REVISION_CONFLICT" });

    const persisted = await server.inject({ headers: authorization(token), method: "GET", url });
    expect(persisted.statusCode).toBe(200);
    expect(persisted.json<ProjectIntake>()).toMatchObject({ projectId: project.id, version: 1 });
  });
});
