import {
  projectIntakeSchema,
  projectSchema,
  type Actor,
  type LocalPersona,
  type Project,
  type ProjectIntake,
} from "@interior-design/contracts";
import { loadPlatformApiConfig } from "@interior-design/config";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { createServer } from "../../src/app.js";
import { ApiError } from "../../src/errors.js";
import type { IdentityStore } from "../../src/modules/identity/store.js";
import { LocalFixtureTokenProvider } from "../../src/modules/identity/jwt.js";
import type { IntakeRepository, UpsertIntakeCommand } from "../../src/modules/intake/repository.js";
import type {
  CreateProjectCommand,
  ProjectRepository,
} from "../../src/modules/projects/repository.js";

const actors: Readonly<Record<LocalPersona, Actor>> = {
  "editor-alpha": {
    displayName: "Alpha editor",
    role: "editor",
    subject: "fixture|editor-alpha",
    tenantId: "10000000-0000-4000-8000-000000000001",
    userId: "20000000-0000-4000-8000-000000000005",
  },
  "homeowner-alpha": {
    displayName: "Alpha homeowner",
    role: "owner",
    subject: "fixture|homeowner-alpha",
    tenantId: "10000000-0000-4000-8000-000000000001",
    userId: "20000000-0000-4000-8000-000000000001",
  },
  "homeowner-beta": {
    displayName: "Beta homeowner",
    role: "owner",
    subject: "fixture|homeowner-beta",
    tenantId: "10000000-0000-4000-8000-000000000002",
    userId: "20000000-0000-4000-8000-000000000003",
  },
  "viewer-alpha": {
    displayName: "Alpha viewer",
    role: "viewer",
    subject: "fixture|viewer-alpha",
    tenantId: "10000000-0000-4000-8000-000000000001",
    userId: "20000000-0000-4000-8000-000000000002",
  },
};

const sampleIntake = {
  accessibilityNeeds: [],
  dwellingType: "terraced-house" as const,
  evidenceAvailable: {
    photographs: true,
    plans: false,
    roomCapture: false,
    video: false,
  },
  goals: ["Create a coherent whole-home direction"],
  household: { adults: 2, children: 0, pets: 0 },
  mustChange: ["Dark hallway"],
  mustKeep: [],
  notes: "Sensitive prose must not enter the audit event.",
  styleWords: ["warm", "calm"],
};

class MemoryC1Store implements IdentityStore, ProjectRepository, IntakeRepository {
  readonly auditEvents: Array<Record<string, string>> = [];
  readonly #idempotency = new Map<string, { body: string; operation: string; response: unknown }>();
  readonly #intakes = new Map<string, ProjectIntake>();
  readonly #projects = new Map<string, Project>();

  findFixtureActor(persona: LocalPersona): Promise<Actor> {
    return Promise.resolve(actors[persona]);
  }

  findSessionActor(tenantId: string, subject: string): Promise<Actor | undefined> {
    return Promise.resolve(
      Object.values(actors).find(
        (candidate) => candidate.tenantId === tenantId && candidate.subject === subject,
      ),
    );
  }

  create(command: CreateProjectCommand): Promise<Project> {
    const key = `${command.actor.tenantId}:${command.idempotencyKey}`;
    const operation = "project.create";
    const body = JSON.stringify(command.request);
    const replay = this.#idempotency.get(key);
    if (replay !== undefined) {
      if (replay.body !== body || replay.operation !== operation) {
        throw this.#idempotencyConflict();
      }
      return Promise.resolve(projectSchema.parse(replay.response));
    }
    const timestamp = new Date().toISOString();
    const project = projectSchema.parse({
      createdAt: timestamp,
      id: randomUUID(),
      name: command.request.name,
      status: "draft",
      tenantId: command.actor.tenantId,
      updatedAt: timestamp,
      version: 1,
    });
    this.#projects.set(project.id, project);
    this.#idempotency.set(key, { body, operation, response: project });
    this.auditEvents.push({
      action: operation,
      actorUserId: command.actor.userId,
      requestId: command.correlation.requestId,
      resourceId: project.id,
      tenantId: command.actor.tenantId,
      traceId: command.correlation.traceId,
    });
    return Promise.resolve(project);
  }

  findById(tenantId: string, projectId: string): Promise<Project | undefined> {
    const project = this.#projects.get(projectId);
    return Promise.resolve(project?.tenantId === tenantId ? project : undefined);
  }

  list(tenantId: string): Promise<readonly Project[]> {
    return Promise.resolve(
      [...this.#projects.values()].filter((project) => project.tenantId === tenantId),
    );
  }

  find(tenantId: string, projectId: string): Promise<ProjectIntake | undefined> {
    return Promise.resolve(this.#intakes.get(`${tenantId}:${projectId}`));
  }

  async upsert(command: UpsertIntakeCommand): Promise<ProjectIntake> {
    const idempotencyKey = `${command.actor.tenantId}:${command.idempotencyKey}`;
    const operation = `intake.upsert:${command.projectId}`;
    const body = JSON.stringify(command.request);
    const replay = this.#idempotency.get(idempotencyKey);
    if (replay !== undefined) {
      if (replay.body !== body || replay.operation !== operation) {
        throw this.#idempotencyConflict();
      }
      return projectIntakeSchema.parse(replay.response);
    }
    if ((await this.findById(command.actor.tenantId, command.projectId)) === undefined) {
      throw new ApiError({
        code: "NOT_FOUND",
        detail: "The requested resource was not found.",
        statusCode: 404,
        title: "Not Found",
      });
    }
    const key = `${command.actor.tenantId}:${command.projectId}`;
    const existing = this.#intakes.get(key);
    if ((existing?.version ?? 0) !== command.request.expectedVersion) {
      throw new ApiError({
        code: "REVISION_CONFLICT",
        detail: "The intake changed; reload it and retry with the current version.",
        statusCode: 409,
        title: "Revision Conflict",
      });
    }
    const intake = projectIntakeSchema.parse({
      intake: command.request.intake,
      projectId: command.projectId,
      updatedAt: new Date().toISOString(),
      updatedBy: command.actor.userId,
      version: (existing?.version ?? 0) + 1,
    });
    this.#intakes.set(key, intake);
    this.#idempotency.set(idempotencyKey, { body, operation, response: intake });
    this.auditEvents.push({
      action: existing === undefined ? "intake.create" : "intake.update",
      actorUserId: command.actor.userId,
      requestId: command.correlation.requestId,
      resourceId: command.projectId,
      tenantId: command.actor.tenantId,
      traceId: command.correlation.traceId,
    });
    return intake;
  }

  #idempotencyConflict(): ApiError {
    return new ApiError({
      code: "IDEMPOTENCY_CONFLICT",
      detail: "The Idempotency-Key was already used for a different mutation.",
      statusCode: 409,
      title: "Idempotency Conflict",
    });
  }
}

const testConfig = loadPlatformApiConfig({
  NODE_ENV: "test",
  PLATFORM_API_LOG_LEVEL: "silent",
});
const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
});

function createTestServer(store: MemoryC1Store = new MemoryC1Store()) {
  const server = createServer({
    c1: {
      identityStore: store,
      intakeRepository: store,
      projectRepository: store,
      tokenProvider: new LocalFixtureTokenProvider(
        "test-session-secret-with-at-least-thirty-two-bytes",
      ),
    },
    config: testConfig,
    logger: false,
  });
  servers.push(server);
  return { server, store };
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

function bearer(accessToken: string): { authorization: string } {
  return { authorization: `Bearer ${accessToken}` };
}

describe("C1 project routes", () => {
  it("is idempotent, tenant-isolated, non-disclosing, and deny-by-role", async () => {
    const { server } = createTestServer();
    const alphaToken = await signIn(server, "homeowner-alpha");
    const betaToken = await signIn(server, "homeowner-beta");
    const viewerToken = await signIn(server, "viewer-alpha");
    const createAlpha = {
      headers: { ...bearer(alphaToken), "idempotency-key": "create-alpha-001" },
      method: "POST" as const,
      payload: { name: "Alpha home" },
      url: "/v1/projects",
    };

    const first = await server.inject(createAlpha);
    const replay = await server.inject(createAlpha);
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    const alphaProject = first.json<Project>();

    const conflict = await server.inject({
      ...createAlpha,
      payload: { name: "Changed body" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const betaProjectResponse = await server.inject({
      headers: { ...bearer(betaToken), "idempotency-key": "create-beta-0001" },
      method: "POST",
      payload: { name: "Beta home" },
      url: "/v1/projects",
    });
    const betaProject = betaProjectResponse.json<Project>();
    const alphaList = await server.inject({
      headers: bearer(alphaToken),
      method: "GET",
      url: "/v1/projects",
    });
    expect(alphaList.json<Project[]>()).toEqual([alphaProject]);

    const foreign = await server.inject({
      headers: bearer(alphaToken),
      method: "GET",
      url: `/v1/projects/${betaProject.id}`,
    });
    const unknown = await server.inject({
      headers: bearer(alphaToken),
      method: "GET",
      url: `/v1/projects/${randomUUID()}`,
    });
    expect(foreign.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
    const unknownProblem = unknown.json<{ detail: string }>();
    expect(foreign.json()).toMatchObject({ code: "NOT_FOUND", detail: unknownProblem.detail });

    const viewerWrite = await server.inject({
      headers: { ...bearer(viewerToken), "idempotency-key": "viewer-create-01" },
      method: "POST",
      payload: { name: "Denied" },
      url: "/v1/projects",
    });
    expect(viewerWrite.statusCode).toBe(403);

    const forgedAuthority = await server.inject({
      headers: { ...bearer(alphaToken), "idempotency-key": "forged-create-01" },
      method: "POST",
      payload: { name: "No", role: "owner", tenantId: actors["homeowner-beta"].tenantId },
      url: "/v1/projects",
    });
    expect(forgedAuthority.statusCode).toBe(400);
  });
});

describe("C1 intake routes", () => {
  it("exposes an empty state and enforces idempotency plus optimistic concurrency", async () => {
    const { server, store } = createTestServer();
    const ownerToken = await signIn(server, "homeowner-alpha");
    const viewerToken = await signIn(server, "viewer-alpha");
    const projectResponse = await server.inject({
      headers: { ...bearer(ownerToken), "idempotency-key": "intake-project-1" },
      method: "POST",
      payload: { name: "Intake home" },
      url: "/v1/projects",
    });
    const project = projectResponse.json<Project>();
    const url = `/v1/projects/${project.id}/intake`;

    const empty = await server.inject({ headers: bearer(ownerToken), method: "GET", url });
    expect(empty.statusCode).toBe(204);

    const createRequest = {
      headers: { ...bearer(ownerToken), "idempotency-key": "intake-create-001" },
      method: "PUT" as const,
      payload: { expectedVersion: 0, intake: sampleIntake },
      url,
    };
    const created = await server.inject(createRequest);
    const replay = await server.inject(createRequest);
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ projectId: project.id, version: 1 });
    expect(replay.json()).toEqual(created.json());

    const keyConflict = await server.inject({
      ...createRequest,
      payload: { expectedVersion: 0, intake: { ...sampleIntake, goals: ["Changed"] } },
    });
    expect(keyConflict.statusCode).toBe(409);
    expect(keyConflict.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const stale = await server.inject({
      ...createRequest,
      headers: { ...bearer(ownerToken), "idempotency-key": "intake-stale-001" },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: "REVISION_CONFLICT" });

    const updated = await server.inject({
      headers: { ...bearer(ownerToken), "idempotency-key": "intake-update-001" },
      method: "PUT",
      payload: { expectedVersion: 1, intake: { ...sampleIntake, styleWords: ["bright"] } },
      url,
    });
    expect(updated.json()).toMatchObject({ version: 2 });

    const viewerRead = await server.inject({ headers: bearer(viewerToken), method: "GET", url });
    expect(viewerRead.statusCode).toBe(200);
    const viewerWrite = await server.inject({
      headers: { ...bearer(viewerToken), "idempotency-key": "viewer-intake-01" },
      method: "PUT",
      payload: { expectedVersion: 2, intake: sampleIntake },
      url,
    });
    expect(viewerWrite.statusCode).toBe(403);
    expect(JSON.stringify(store.auditEvents)).not.toContain(sampleIntake.notes);
    expect(store.auditEvents).toHaveLength(3);
  });
});

describe("C1 authentication HTTP behavior", () => {
  it("rejects malformed bearer tokens without disclosure", async () => {
    const { server } = createTestServer();
    const response = await server.inject({
      headers: { authorization: "Bearer malformed" },
      method: "GET",
      url: "/v1/session",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(response.body).not.toContain("malformed");
  });

  it("denies fixture sign-in and reports unconfigured production OIDC honestly", async () => {
    const store = new MemoryC1Store();
    const productionConfig = loadPlatformApiConfig({
      NODE_ENV: "production",
      PLATFORM_API_LOG_LEVEL: "silent",
    });
    const server = createServer({
      c1: {
        identityStore: store,
        intakeRepository: store,
        projectRepository: store,
      },
      config: productionConfig,
      environment: { NODE_ENV: "production" },
      logger: false,
    });
    servers.push(server);

    const localSignIn = await server.inject({
      method: "POST",
      payload: { persona: "homeowner-alpha" },
      url: "/v1/auth/local/session",
    });
    const providerAttempt = await server.inject({
      headers: { authorization: "Bearer provider-token" },
      method: "GET",
      url: "/v1/session",
    });
    const readiness = await server.inject({ method: "GET", url: "/health/ready" });

    expect(localSignIn.statusCode).toBe(503);
    expect(localSignIn.json()).toMatchObject({ code: "LOCAL_AUTH_UNAVAILABLE" });
    expect(providerAttempt.statusCode).toBe(503);
    expect(providerAttempt.json()).toMatchObject({ code: "IDENTITY_PROVIDER_UNAVAILABLE" });
    expect(readiness.statusCode).toBe(503);
    const readinessBody = readiness.json<{
      checks: Array<{ name: string; required: boolean; status: string }>;
      status: string;
    }>();
    expect(readinessBody.status).toBe("not_ready");
    expect(readinessBody.checks).toContainEqual({
      name: "identity-provider",
      required: true,
      status: "unavailable",
    });
  });
});
