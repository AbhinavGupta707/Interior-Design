import { loadPlatformApiConfig } from "@interior-design/config";
import {
  modelSnapshotRecordSchema,
  projectSchema,
  type Actor,
  type LocalPersona,
  type ModelProfile,
  type ModelSnapshotRecord,
  type Project,
  type ProjectIntake,
} from "@interior-design/contracts";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { createServer, defaultLogger } from "../../src/app.js";
import { ApiError } from "../../src/errors.js";
import { LocalFixtureTokenProvider } from "../../src/modules/identity/jwt.js";
import { IdentityService } from "../../src/modules/identity/service.js";
import type { IdentityStore } from "../../src/modules/identity/store.js";
import type { IntakeRepository, UpsertIntakeCommand } from "../../src/modules/intake/repository.js";
import { LocalCanonicalSnapshotCodec } from "../../src/modules/models/core/canonical.js";
import type {
  AvailableModelProfileSummary,
  CanonicalModelRepository,
  CreateCanonicalSnapshotResult,
  PersistCanonicalSnapshotCommand,
} from "../../src/modules/models/core/types.js";
import type {
  CreateProjectCommand,
  ProjectRepository,
} from "../../src/modules/projects/repository.js";
import {
  alphaProjectId,
  alphaTenantId,
  betaProjectId,
  betaTenantId,
  betaUserId,
  canonicalSnapshotFixture,
  editorUserId,
  ownerUserId,
  viewerUserId,
} from "./fixtures.js";

const now = "2026-07-17T12:00:00.000Z";
const codec = new LocalCanonicalSnapshotCodec();
const testConfig = loadPlatformApiConfig({
  NODE_ENV: "test",
  PLATFORM_API_LOG_LEVEL: "silent",
  PLATFORM_API_SHUTDOWN_TIMEOUT_MS: "2000",
});

const actors: Record<string, Actor> = {
  "fixture|editor-alpha": {
    displayName: "Synthetic editor",
    role: "editor",
    subject: "fixture|editor-alpha",
    tenantId: alphaTenantId,
    userId: editorUserId,
  },
  "fixture|homeowner-alpha": {
    displayName: "Synthetic owner",
    role: "owner",
    subject: "fixture|homeowner-alpha",
    tenantId: alphaTenantId,
    userId: ownerUserId,
  },
  "fixture|homeowner-beta": {
    displayName: "Synthetic beta owner",
    role: "owner",
    subject: "fixture|homeowner-beta",
    tenantId: betaTenantId,
    userId: betaUserId,
  },
  "fixture|viewer-alpha": {
    displayName: "Synthetic viewer",
    role: "viewer",
    subject: "fixture|viewer-alpha",
    tenantId: alphaTenantId,
    userId: viewerUserId,
  },
};

const personaSubjects: Record<LocalPersona, string> = {
  "homeowner-alpha": "fixture|homeowner-alpha",
  "homeowner-beta": "fixture|homeowner-beta",
  "viewer-alpha": "fixture|viewer-alpha",
};

class FixtureIdentityStore implements IdentityStore {
  findFixtureActor(persona: LocalPersona): Promise<Actor | undefined> {
    return Promise.resolve(actors[personaSubjects[persona]]);
  }

  findSessionActor(tenantId: string, subject: string): Promise<Actor | undefined> {
    const actor = actors[subject];
    return Promise.resolve(actor?.tenantId === tenantId ? actor : undefined);
  }
}

const projects = [
  projectSchema.parse({
    createdAt: now,
    id: alphaProjectId,
    name: "Synthetic alpha project",
    status: "draft",
    tenantId: alphaTenantId,
    updatedAt: now,
    version: 1,
  }),
  projectSchema.parse({
    createdAt: now,
    id: betaProjectId,
    name: "Synthetic beta project",
    status: "draft",
    tenantId: betaTenantId,
    updatedAt: now,
    version: 1,
  }),
];

class FixtureProjectRepository implements ProjectRepository {
  create(command: CreateProjectCommand): Promise<Project> {
    void command;
    return Promise.reject(new Error("Project creation is outside this C4 route fixture."));
  }

  findById(tenantId: string, projectId: string): Promise<Project | undefined> {
    return Promise.resolve(
      projects.find((project) => project.tenantId === tenantId && project.id === projectId),
    );
  }

  list(tenantId: string): Promise<readonly Project[]> {
    return Promise.resolve(projects.filter((project) => project.tenantId === tenantId));
  }
}

class FixtureIntakeRepository implements IntakeRepository {
  find(tenantId: string, projectId: string): Promise<ProjectIntake | undefined> {
    void tenantId;
    void projectId;
    return Promise.resolve(undefined);
  }

  upsert(command: UpsertIntakeCommand): Promise<ProjectIntake> {
    void command;
    return Promise.reject(new Error("Intake mutation is outside this C4 route fixture."));
  }
}

class FixtureCanonicalModelRepository implements CanonicalModelRepository {
  readonly commands: PersistCanonicalSnapshotCommand[] = [];
  readonly #current = new Map<string, ModelSnapshotRecord>();
  readonly #idempotency = new Map<
    string,
    {
      readonly actorUserId: string;
      readonly requestHash: string;
      readonly record: ModelSnapshotRecord;
    }
  >();
  readonly #snapshots = new Map<string, ModelSnapshotRecord>();

  createSnapshot(command: PersistCanonicalSnapshotCommand): Promise<CreateCanonicalSnapshotResult> {
    const boundary = `${command.actor.tenantId}:${command.projectId}:${command.profile}`;
    const idempotencyBoundary = `${boundary}:${command.idempotencyKey}`;
    const requestHash = `${command.expectedCurrentSnapshotSha256 ?? "null"}:${command.canonical.snapshotSha256}`;
    const replay = this.#idempotency.get(idempotencyBoundary);
    if (replay !== undefined) {
      if (replay.actorUserId !== command.actor.userId || replay.requestHash !== requestHash) {
        throw new ApiError({
          code: "IDEMPOTENCY_CONFLICT",
          detail: "The Idempotency-Key was already used for a different mutation.",
          statusCode: 409,
          title: "Idempotency Conflict",
        });
      }
      return Promise.resolve({ record: replay.record, replayed: true });
    }
    const current = this.#current.get(boundary);
    if ((current?.snapshotSha256 ?? null) !== command.expectedCurrentSnapshotSha256) {
      throw new ApiError({
        code: "REVISION_CONFLICT",
        detail: "The current model snapshot changed.",
        statusCode: 409,
        title: "Revision Conflict",
      });
    }
    if (current !== undefined && current.modelId !== command.snapshot.modelId) {
      throw new ApiError({
        code: "REVISION_CONFLICT",
        detail: "The current model snapshot changed.",
        statusCode: 409,
        title: "Revision Conflict",
      });
    }
    this.commands.push(command);
    const record = modelSnapshotRecordSchema.parse({
      canonicalByteLength: command.canonical.canonicalByteLength,
      createdAt: now,
      createdBy: command.actor.userId,
      id: randomUUID(),
      modelId: command.snapshot.modelId,
      profile: command.profile,
      projectId: command.projectId,
      schemaVersion: command.snapshot.schemaVersion,
      snapshot: command.canonical.snapshot,
      snapshotSha256: command.canonical.snapshotSha256,
      version: (current?.version ?? 0) + 1,
    });
    this.#current.set(boundary, record);
    this.#snapshots.set(`${boundary}:${record.id}`, record);
    this.#idempotency.set(idempotencyBoundary, {
      actorUserId: command.actor.userId,
      record,
      requestHash,
    });
    return Promise.resolve({ record, replayed: false });
  }

  getCurrentSnapshot(
    tenantId: string,
    projectId: string,
    profile: ModelProfile,
  ): Promise<ModelSnapshotRecord | undefined> {
    return Promise.resolve(this.#current.get(`${tenantId}:${projectId}:${profile}`));
  }

  getSnapshot(
    tenantId: string,
    projectId: string,
    profile: ModelProfile,
    snapshotId: string,
  ): Promise<ModelSnapshotRecord | undefined> {
    return Promise.resolve(
      this.#snapshots.get(`${tenantId}:${projectId}:${profile}:${snapshotId}`),
    );
  }

  listAvailableProfiles(
    tenantId: string,
    projectId: string,
  ): Promise<readonly AvailableModelProfileSummary[]> {
    const summaries: AvailableModelProfileSummary[] = [];
    for (const profile of ["existing", "proposed", "as-built"] as const) {
      const record = this.#current.get(`${tenantId}:${projectId}:${profile}`);
      if (record !== undefined) {
        summaries.push({
          currentSnapshotId: record.id,
          currentSnapshotSha256: record.snapshotSha256,
          modelId: record.modelId,
          profile,
          status: "available",
          updatedAt: record.createdAt,
          version: record.version,
        });
      }
    }
    return Promise.resolve(summaries);
  }
}

const activeServers = new Set<ReturnType<typeof createServer>>();

function testServer(logger: NonNullable<Parameters<typeof createServer>[0]>["logger"] = false) {
  const tokenProvider = new LocalFixtureTokenProvider(
    "c4-route-session-secret-with-at-least-thirty-two-bytes",
  );
  const identityStore = new FixtureIdentityStore();
  const identity = new IdentityService("test", identityStore, tokenProvider);
  const projectRepository = new FixtureProjectRepository();
  const repository = new FixtureCanonicalModelRepository();
  const server = createServer({
    c1: {
      identityStore,
      intakeRepository: new FixtureIntakeRepository(),
      projectRepository,
      tokenProvider,
    },
    c4: {
      codec,
      geometryValidator: (snapshot) =>
        snapshot.knownLimitations.some(({ code }) => code === "GEOMETRY_ERROR_FIXTURE")
          ? [
              {
                affectedElementIds: [snapshot.elements.spaces[0]?.id ?? snapshot.modelId],
                code: "SPACE_SELF_INTERSECTION",
                location: {
                  levelId: snapshot.elements.levels[0]?.id ?? snapshot.modelId,
                  xMm: 1_000,
                  yMm: 1_000,
                },
                message: "Synthetic invalid geometry fixture.",
                severity: "error",
              },
            ]
          : [
              {
                affectedElementIds: [snapshot.elements.levels[0]?.id ?? snapshot.modelId],
                code: "UNKNOWN_STOREY_HEIGHT",
                message: "Storey height remains explicitly unknown.",
                severity: "warning",
              },
            ],
      identity,
      projects: projectRepository,
      repository,
    },
    config: testConfig,
    logger,
  });
  activeServers.add(server);
  const editorToken = tokenProvider.issueLocal({
    subject: "fixture|editor-alpha",
    tenantId: alphaTenantId,
  }).accessToken;
  return { editorToken, repository, server };
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

afterEach(async () => {
  await Promise.all(
    [...activeServers].map(async (server) => {
      await server.close();
      activeServers.delete(server);
    }),
  );
});

describe("C4 canonical model routes", () => {
  it("lists exact empty states and supports owner/editor creation plus viewer reads", async () => {
    const { editorToken, repository, server } = testServer();
    const ownerToken = await signIn(server, "homeowner-alpha");
    const viewerToken = await signIn(server, "viewer-alpha");
    const base = `/v1/projects/${alphaProjectId}/models`;

    const empty = await server.inject({
      headers: authorization(ownerToken),
      method: "GET",
      url: base,
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({
      profiles: [
        { profile: "existing", status: "empty" },
        { profile: "proposed", status: "empty" },
        { profile: "as-built", status: "empty" },
      ],
      projectId: alphaProjectId,
    });

    const createRequest = {
      headers: { ...authorization(ownerToken), "idempotency-key": "c4-route-create-0001" },
      method: "POST" as const,
      payload: {
        expectedCurrentSnapshotSha256: null,
        snapshot: canonicalSnapshotFixture(),
      },
      url: `${base}/existing/snapshots`,
    };
    const created = await server.inject(createRequest);
    expect(created.statusCode).toBe(201);
    const record = modelSnapshotRecordSchema.parse(created.json());
    expect(repository.commands[0]?.retainedGeometryFindings).toEqual([
      expect.objectContaining({ code: "UNKNOWN_STOREY_HEIGHT", severity: "warning" }),
    ]);

    const replay = await server.inject(createRequest);
    expect(replay.statusCode).toBe(201);
    expect(replay.headers["idempotent-replay"]).toBe("true");
    expect(replay.json()).toEqual(created.json());
    expect(repository.commands).toHaveLength(1);

    const current = await server.inject({
      headers: authorization(viewerToken),
      method: "GET",
      url: `${base}/existing`,
    });
    const historical = await server.inject({
      headers: authorization(viewerToken),
      method: "GET",
      url: `${base}/existing/snapshots/${record.id}`,
    });
    expect(current.statusCode).toBe(200);
    expect(historical.json()).toEqual(current.json());

    const changedSnapshot = canonicalSnapshotFixture({
      limitationDetail: "Synthetic editor revision; still not surveyed or as-built truth.",
    });
    const edited = await server.inject({
      headers: { ...authorization(editorToken), "idempotency-key": "c4-route-editor-0001" },
      method: "POST",
      payload: {
        expectedCurrentSnapshotSha256: record.snapshotSha256,
        snapshot: changedSnapshot,
      },
      url: `${base}/existing/snapshots`,
    });
    expect(edited.statusCode).toBe(201);
    expect(edited.json<ModelSnapshotRecord>().version).toBe(2);

    const viewerDenied = await server.inject({
      headers: { ...authorization(viewerToken), "idempotency-key": "c4-viewer-denied-001" },
      method: "POST",
      payload: {
        expectedCurrentSnapshotSha256: edited.json<ModelSnapshotRecord>().snapshotSha256,
        snapshot: changedSnapshot,
      },
      url: `${base}/existing/snapshots`,
    });
    expect(viewerDenied.statusCode).toBe(403);
  });

  it("keeps foreign, unknown, and empty reads non-disclosing", async () => {
    const { server } = testServer();
    const ownerToken = await signIn(server, "homeowner-alpha");
    const foreign = await server.inject({
      headers: authorization(ownerToken),
      method: "GET",
      url: `/v1/projects/${betaProjectId}/models/existing`,
    });
    const unknown = await server.inject({
      headers: authorization(ownerToken),
      method: "GET",
      url: `/v1/projects/${randomUUID()}/models/existing`,
    });
    const empty = await server.inject({
      headers: authorization(ownerToken),
      method: "GET",
      url: `/v1/projects/${alphaProjectId}/models/existing`,
    });
    expect([foreign.statusCode, unknown.statusCode, empty.statusCode]).toEqual([404, 404, 404]);
    expect(foreign.json()).toMatchObject({
      code: "NOT_FOUND",
      detail: unknown.json<{ readonly detail: string }>().detail,
    });
    expect(empty.json<{ readonly detail: string }>().detail).toBe(
      unknown.json<{ readonly detail: string }>().detail,
    );
  });

  it("rejects boundary/schema violations and returns only located geometry findings", async () => {
    const { repository, server } = testServer();
    const ownerToken = await signIn(server, "homeowner-alpha");
    const url = `/v1/projects/${alphaProjectId}/models/existing/snapshots`;
    const mismatch = await server.inject({
      headers: { ...authorization(ownerToken), "idempotency-key": "c4-mismatch-body-001" },
      method: "POST",
      payload: {
        expectedCurrentSnapshotSha256: null,
        snapshot: canonicalSnapshotFixture({ projectId: betaProjectId }),
      },
      url,
    });
    expect(mismatch.statusCode).toBe(400);

    const profileMismatch = await server.inject({
      headers: { ...authorization(ownerToken), "idempotency-key": "c4-profile-mismatch1" },
      method: "POST",
      payload: {
        expectedCurrentSnapshotSha256: null,
        snapshot: canonicalSnapshotFixture({
          derivedFromSnapshotSha256: "a".repeat(64),
          profile: "proposed",
        }),
      },
      url,
    });
    expect(profileMismatch.statusCode).toBe(400);

    const invalidWithMarker = await server.inject({
      headers: { ...authorization(ownerToken), "idempotency-key": "c4-invalid-body-0001" },
      method: "POST",
      payload: {
        expectedCurrentSnapshotSha256: null,
        snapshot: { privateMarker: "snapshot-body-must-not-be-echoed" },
      },
      url,
    });
    expect(invalidWithMarker.statusCode).toBe(400);
    expect(invalidWithMarker.body).not.toContain("snapshot-body-must-not-be-echoed");

    const invalidGeometry = canonicalSnapshotFixture();
    invalidGeometry.knownLimitations[0] = {
      code: "GEOMETRY_ERROR_FIXTURE",
      detail: "Synthetic blocking geometry fixture; not surveyed or as-built truth.",
    };
    const geometry = await server.inject({
      headers: { ...authorization(ownerToken), "idempotency-key": "c4-geometry-error-001" },
      method: "POST",
      payload: { expectedCurrentSnapshotSha256: null, snapshot: invalidGeometry },
      url,
    });
    expect(geometry.statusCode).toBe(422);
    const problem = geometry.json<{
      readonly code: string;
      readonly findings: ReadonlyArray<{
        readonly code: string;
        readonly location?: { readonly levelId: string };
        readonly severity: string;
      }>;
    }>();
    expect(problem).toMatchObject({
      code: "CANONICAL_GEOMETRY_INVALID",
      findings: [
        {
          code: "SPACE_SELF_INTERSECTION",
          severity: "error",
        },
      ],
    });
    expect(problem.findings[0]?.location?.levelId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(geometry.body).not.toContain(JSON.stringify(invalidGeometry));
    expect(repository.commands).toHaveLength(0);
  });

  it("raises only the C4 create transport bound while preserving the global 1 MiB limit", async () => {
    const { server } = testServer();
    const ownerToken = await signIn(server, "homeowner-alpha");
    const padding = "x".repeat(1_100_000);
    const c4Response = await server.inject({
      headers: { ...authorization(ownerToken), "idempotency-key": "c4-large-invalid-001" },
      method: "POST",
      payload: {
        expectedCurrentSnapshotSha256: null,
        snapshot: { padding },
      },
      url: `/v1/projects/${alphaProjectId}/models/existing/snapshots`,
    });
    expect(c4Response.statusCode).toBe(400);
    expect(c4Response.json()).toMatchObject({ code: "INVALID_REQUEST" });

    const unrelated = await server.inject({
      headers: { ...authorization(ownerToken), "idempotency-key": "c4-unrelated-large-1" },
      method: "POST",
      payload: { name: "Synthetic", padding },
      url: "/v1/projects",
    });
    // The shared error normalizer intentionally presents Fastify's transport
    // 413 as a generic 400, but its code distinguishes it from route parsing.
    expect(unrelated.statusCode).toBe(400);
    expect(unrelated.json()).toMatchObject({ code: "BAD_REQUEST" });
  });

  it("redacts request URLs and never logs canonical snapshot bodies", async () => {
    const logLines: string[] = [];
    const loggingConfig = loadPlatformApiConfig({
      NODE_ENV: "test",
      PLATFORM_API_LOG_LEVEL: "info",
      PLATFORM_API_SHUTDOWN_TIMEOUT_MS: "2000",
    });
    const loggerOptions = defaultLogger(loggingConfig);
    if (loggerOptions === false || loggerOptions === true) {
      throw new Error("Expected structured platform logger options.");
    }
    const { server } = testServer({
      ...loggerOptions,
      stream: {
        write(line: string) {
          logLines.push(line);
        },
      },
    });
    const ownerToken = await signIn(server, "homeowner-alpha");
    const marker = "C4_SNAPSHOT_BODY_LOG_MARKER";
    const response = await server.inject({
      headers: { ...authorization(ownerToken), "idempotency-key": "c4-log-redaction-001" },
      method: "POST",
      payload: {
        expectedCurrentSnapshotSha256: null,
        snapshot: canonicalSnapshotFixture({
          limitationDetail: `${marker}: synthetic and not survey or as-built truth.`,
        }),
      },
      url: `/v1/projects/${alphaProjectId}/models/existing/snapshots`,
    });
    expect(response.statusCode).toBe(201);
    const logs = logLines.join("\n");
    expect(logs).not.toContain(marker);
    expect(logs).not.toContain(alphaProjectId);
    expect(logs).toContain("[REDACTED]");
  });
});
