import { loadPlatformApiConfig } from "@interior-design/config";
import {
  projectPropertySchema,
  projectSchema,
  propertyDossierSchema,
  propertyResolutionResponseSchema,
  propertySourceRecordSchema,
  propertySourceSchema,
  type Actor,
  type LocalPersona,
  type Project,
  type ProjectIntake,
} from "@interior-design/contracts";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { createServer } from "../../src/app.js";
import { LocalFixtureTokenProvider } from "../../src/modules/identity/jwt.js";
import { IdentityService } from "../../src/modules/identity/service.js";
import type { IdentityStore } from "../../src/modules/identity/store.js";
import type { IntakeRepository, UpsertIntakeCommand } from "../../src/modules/intake/repository.js";
import type {
  CreateProjectCommand,
  ProjectRepository,
} from "../../src/modules/projects/repository.js";
import type {
  PropertyBackend,
  RefreshPropertyDossierCommand,
  ResolvePropertyCommand,
  SelectPropertyCommand,
} from "../../src/modules/property/types.js";

const now = "2026-07-17T12:00:00.000Z";
const alphaTenantId = "10000000-0000-4000-8000-000000000001";
const betaTenantId = "10000000-0000-4000-8000-000000000002";
const alphaProjectId = "30000000-0000-4000-8000-000000000001";
const betaProjectId = "30000000-0000-4000-8000-000000000002";
const emptyAlphaProjectId = "30000000-0000-4000-8000-000000000003";
const propertyId = "40000000-0000-4000-8000-000000000001";
const sourceId = "50000000-0000-4000-8000-000000000001";
const workflowSourceId = "50000000-0000-4000-8000-000000000002";
const candidateId = "60000000-0000-4000-8000-000000000001";
const resolutionId = "70000000-0000-4000-8000-000000000001";

const actors: Readonly<Record<LocalPersona, Actor>> = {
  "homeowner-alpha": {
    displayName: "Alpha homeowner",
    role: "owner",
    subject: "fixture|homeowner-alpha",
    tenantId: alphaTenantId,
    userId: "20000000-0000-4000-8000-000000000001",
  },
  "homeowner-beta": {
    displayName: "Beta homeowner",
    role: "owner",
    subject: "fixture|homeowner-beta",
    tenantId: betaTenantId,
    userId: "20000000-0000-4000-8000-000000000003",
  },
  "viewer-alpha": {
    displayName: "Alpha viewer",
    role: "viewer",
    subject: "fixture|viewer-alpha",
    tenantId: alphaTenantId,
    userId: "20000000-0000-4000-8000-000000000002",
  },
};

const source = propertySourceSchema.parse({
  coverage: "fixture-complete",
  dataset: "Synthetic property identities and context",
  datasetVersion: "c3-fixture-v1",
  licence: { id: "synthetic-fixture", title: "Repository synthetic fixture" },
  modelTrainingAllowed: false,
  participantSharingAllowed: true,
  providerId: "fixture-property",
  retrievedAt: now,
  serviceProcessingAllowed: true,
});
const address = {
  countryCode: "GB" as const,
  line1: "14 Example Mews",
  locality: "Testford",
  postcode: "ZZ1 1ZZ",
};
const property = projectPropertySchema.parse({
  address,
  displayAddress: "14 Example Mews, Testford, ZZ1 1ZZ",
  identifiers: [{ scheme: "UPRN", value: "000000000014" }],
  interiorKnowledgeStatus: "unknown-without-evidence",
  jurisdiction: "england",
  location: { coordinates: [530000, 180000], crs: "EPSG:27700" },
  mode: "candidate",
  projectId: alphaProjectId,
  propertyId,
  selectedAt: now,
  source,
  updatedAt: now,
  version: 1,
});
const sources = [
  propertySourceRecordSchema.parse({
    fields: ["property-identity"],
    id: sourceId,
    normalizedPayloadSha256: "a".repeat(64),
    projectId: alphaProjectId,
    propertyId,
    source,
  }),
  propertySourceRecordSchema.parse({
    fields: ["selection-mode"],
    id: workflowSourceId,
    normalizedPayloadSha256: "b".repeat(64),
    projectId: alphaProjectId,
    propertyId,
    source: { ...source, providerId: "property-workflow" },
  }),
];
const dossier = propertyDossierSchema.parse({
  coverageWarnings: ["Synthetic context is incomplete and does not establish the interior."],
  generatedAt: now,
  interiorKnowledgeStatus: "unknown-without-evidence",
  items: [
    {
      classification: "source-observation",
      interiorClaim: "none",
      key: "property-identity",
      label: "Property identity",
      sourceRecordIds: [sourceId],
      value: { kind: "text", value: property.displayAddress },
    },
    {
      classification: "user-assertion",
      interiorClaim: "none",
      key: "selected-for-project",
      label: "Selected for project",
      sourceRecordIds: [workflowSourceId],
      value: { kind: "boolean", value: true },
    },
    {
      classification: "estimate",
      confidencePercent: 60,
      interiorClaim: "none",
      key: "context-coverage",
      label: "Context coverage",
      sourceRecordIds: [workflowSourceId],
      value: { kind: "number", unit: "percent", value: 60 },
    },
    {
      classification: "inference",
      confidencePercent: 99,
      interiorClaim: "none",
      key: "evidence-needed",
      label: "Evidence needed",
      sourceRecordIds: [workflowSourceId],
      value: { kind: "boolean", value: true },
    },
    {
      classification: "unknown",
      interiorClaim: "none",
      key: "current-room-layout",
      label: "Current room layout",
      sourceRecordIds: [],
      value: { kind: "unknown" },
    },
  ],
  planningStatus: "not-reviewed",
  property,
  sources,
  version: 1,
});

class MemoryBoundaries implements IdentityStore, ProjectRepository, IntakeRepository {
  readonly #projects = new Map<string, Project>([
    [
      alphaProjectId,
      projectSchema.parse({
        createdAt: now,
        id: alphaProjectId,
        name: "Alpha synthetic home",
        status: "draft",
        tenantId: alphaTenantId,
        updatedAt: now,
        version: 1,
      }),
    ],
    [
      betaProjectId,
      projectSchema.parse({
        createdAt: now,
        id: betaProjectId,
        name: "Beta synthetic home",
        status: "draft",
        tenantId: betaTenantId,
        updatedAt: now,
        version: 1,
      }),
    ],
    [
      emptyAlphaProjectId,
      projectSchema.parse({
        createdAt: now,
        id: emptyAlphaProjectId,
        name: "Alpha synthetic home without property selection",
        status: "draft",
        tenantId: alphaTenantId,
        updatedAt: now,
        version: 1,
      }),
    ],
  ]);

  findFixtureActor(persona: LocalPersona): Promise<Actor | undefined> {
    return Promise.resolve(actors[persona]);
  }

  findSessionActor(tenantId: string, subject: string): Promise<Actor | undefined> {
    return Promise.resolve(
      Object.values(actors).find(
        (actor) => actor.tenantId === tenantId && actor.subject === subject,
      ),
    );
  }

  create(_command: CreateProjectCommand): Promise<Project> {
    void _command;
    return Promise.reject(new Error("Project creation is outside this route test."));
  }

  findById(tenantId: string, projectIdToFind: string): Promise<Project | undefined> {
    const result = this.#projects.get(projectIdToFind);
    return Promise.resolve(result?.tenantId === tenantId ? result : undefined);
  }

  list(tenantId: string): Promise<readonly Project[]> {
    return Promise.resolve(
      [...this.#projects.values()].filter((candidate) => candidate.tenantId === tenantId),
    );
  }

  find(_tenantId: string, _projectIdToFind: string): Promise<ProjectIntake | undefined> {
    void _tenantId;
    void _projectIdToFind;
    return Promise.resolve(undefined);
  }

  upsert(_command: UpsertIntakeCommand): Promise<ProjectIntake> {
    void _command;
    return Promise.reject(new Error("Intake mutation is outside this route test."));
  }
}

class RecordingPropertyBackend implements PropertyBackend {
  readonly commands: Array<
    RefreshPropertyDossierCommand | ResolvePropertyCommand | SelectPropertyCommand
  > = [];

  getDossier(tenantId: string, projectIdToFind: string) {
    return Promise.resolve(
      tenantId === alphaTenantId && projectIdToFind === alphaProjectId ? dossier : undefined,
    );
  }

  listSourceRecords(tenantId: string, projectIdToFind: string) {
    if (tenantId === alphaTenantId && projectIdToFind === emptyAlphaProjectId) {
      return Promise.resolve([]);
    }
    return Promise.resolve(
      tenantId === alphaTenantId && projectIdToFind === alphaProjectId ? sources : undefined,
    );
  }

  refreshDossier(command: RefreshPropertyDossierCommand) {
    this.commands.push(command);
    return Promise.resolve(dossier);
  }

  resolve(command: ResolvePropertyCommand) {
    this.commands.push(command);
    return Promise.resolve(
      propertyResolutionResponseSchema.parse({
        candidates: [
          {
            address,
            candidateId,
            displayAddress: property.displayAddress,
            identifiers: property.identifiers,
            jurisdiction: property.jurisdiction,
            location: property.location,
            source,
          },
        ],
        expiresAt: "2026-07-17T12:15:00.000Z",
        manualEntryAllowed: true,
        providerState: "fixture",
        resolutionId,
        status: "matched",
      }),
    );
  }

  select(command: SelectPropertyCommand) {
    this.commands.push(command);
    return Promise.resolve(property);
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

function testServer() {
  const boundaries = new MemoryBoundaries();
  const backend = new RecordingPropertyBackend();
  const tokens = new LocalFixtureTokenProvider(
    "c3-route-test-session-secret-with-at-least-thirty-two-bytes",
  );
  const identity = new IdentityService("test", boundaries, tokens);
  const server = createServer({
    c1: {
      identityStore: boundaries,
      intakeRepository: boundaries,
      projectRepository: boundaries,
      tokenProvider: tokens,
    },
    c3: { backend, identity, projects: boundaries },
    config: testConfig,
    logger: false,
  });
  servers.push(server);
  return { backend, server };
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

function authorization(token: string): { readonly authorization: string } {
  return { authorization: `Bearer ${token}` };
}

describe("C3 property routes", () => {
  it("returns an empty source collection for an authorised project before property selection", async () => {
    const { server } = testServer();
    const owner = await signIn(server, "homeowner-alpha");
    const response = await server.inject({
      headers: authorization(owner),
      method: "GET",
      url: `/v1/projects/${emptyAlphaProjectId}/property/source-records`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ sources: [] });
  });

  it("serves all five frozen routes with role authority and validated mutation headers", async () => {
    const { backend, server } = testServer();
    const owner = await signIn(server, "homeowner-alpha");
    const viewer = await signIn(server, "viewer-alpha");
    const base = `/v1/projects/${alphaProjectId}/property`;

    const resolution = await server.inject({
      headers: { ...authorization(owner), "idempotency-key": "resolve-route-001" },
      method: "POST",
      payload: { countryCode: "GB", query: "14 Example Mews" },
      url: `${base}/resolutions`,
    });
    expect(resolution.statusCode).toBe(201);
    expect(resolution.json()).toMatchObject({ providerState: "fixture", status: "matched" });

    const selection = await server.inject({
      headers: { ...authorization(owner), "idempotency-key": "select-route-0001" },
      method: "PUT",
      payload: { candidateId, expectedVersion: 0, mode: "candidate", resolutionId },
      url: base,
    });
    expect(selection.statusCode).toBe(200);
    expect(selection.json()).toMatchObject({ propertyId, version: 1 });

    const read = await server.inject({
      headers: authorization(viewer),
      method: "GET",
      url: `${base}/dossier`,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ planningStatus: "not-reviewed", version: 1 });
    const sourceList = await server.inject({
      headers: authorization(viewer),
      method: "GET",
      url: `${base}/source-records`,
    });
    expect(sourceList.statusCode).toBe(200);
    expect(sourceList.json<{ sources: unknown[] }>().sources).toHaveLength(2);

    const viewerRefresh = await server.inject({
      headers: { ...authorization(viewer), "idempotency-key": "viewer-refresh-01" },
      method: "POST",
      payload: { expectedVersion: 1 },
      url: `${base}/dossier/refresh`,
    });
    expect(viewerRefresh.statusCode).toBe(403);
    const ownerRefresh = await server.inject({
      headers: { ...authorization(owner), "idempotency-key": "owner-refresh-001" },
      method: "POST",
      payload: { expectedVersion: 1 },
      url: `${base}/dossier/refresh`,
    });
    expect(ownerRefresh.statusCode).toBe(200);
    expect(backend.commands).toHaveLength(3);

    const missingIdempotency = await server.inject({
      headers: authorization(owner),
      method: "PUT",
      payload: {
        address,
        expectedVersion: 1,
        jurisdiction: "england",
        mode: "manual",
      },
      url: base,
    });
    expect(missingIdempotency.statusCode).toBe(400);
    expect(missingIdempotency.json()).toMatchObject({ code: "INVALID_IDEMPOTENCY_KEY" });
  });

  it("returns indistinguishable correlated 404s for foreign and unknown projects", async () => {
    const { server } = testServer();
    const owner = await signIn(server, "homeowner-alpha");
    const requestId = "c3-nondisclosure-request";
    const foreign = await server.inject({
      headers: { ...authorization(owner), "x-request-id": requestId },
      method: "GET",
      url: `/v1/projects/${betaProjectId}/property/dossier`,
    });
    const unknown = await server.inject({
      headers: { ...authorization(owner), "x-request-id": requestId },
      method: "GET",
      url: `/v1/projects/${randomUUID()}/property/dossier`,
    });

    expect(foreign.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
    expect(foreign.json()).toMatchObject({
      code: "NOT_FOUND",
      detail: unknown.json<{ detail: string }>().detail,
      requestId,
    });
    expect(foreign.json<{ traceId: string }>().traceId).toMatch(/^[0-9a-f]{32}$/u);
  });

  it("rejects client-supplied candidate authority and does not echo address-query prose", async () => {
    const { server } = testServer();
    const owner = await signIn(server, "homeowner-alpha");
    const base = `/v1/projects/${alphaProjectId}/property`;
    const injectedAuthority = await server.inject({
      headers: { ...authorization(owner), "idempotency-key": "reject-authority-1" },
      method: "PUT",
      payload: {
        candidateId,
        expectedVersion: 0,
        mode: "candidate",
        providerPayload: { address: "Sensitive client prose" },
        resolutionId,
      },
      url: base,
    });
    expect(injectedAuthority.statusCode).toBe(400);
    expect(injectedAuthority.body).not.toContain("Sensitive client prose");

    const invalidQuery = await server.inject({
      headers: { ...authorization(owner), "idempotency-key": "reject-query-0001" },
      method: "POST",
      payload: { countryCode: "GB", query: "Sensitive client address prose", extra: true },
      url: `${base}/resolutions`,
    });
    expect(invalidQuery.statusCode).toBe(400);
    expect(invalidQuery.body).not.toContain("Sensitive client address prose");
    expect(invalidQuery.json()).toMatchObject({ code: "INVALID_REQUEST" });
  });
});
