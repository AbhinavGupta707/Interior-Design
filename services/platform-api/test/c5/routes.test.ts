import {
  modelBranchSchema,
  modelCommitSchema,
  modelOperationsPreviewSchema,
  modelSnapshotRecordSchema,
  projectSchema,
  type Actor,
  type LocalPersona,
  type ModelBranch,
  type ModelProfile,
  type Project,
} from "@interior-design/contracts";
import { canonicalizeHomeSnapshot } from "@interior-design/domain-model";
import Fastify, { type FastifyInstance, type FastifyLoggerOptions } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { registerRequestCorrelation } from "../../src/correlation.js";
import { registerErrorHandling } from "../../src/errors.js";
import { LocalFixtureTokenProvider } from "../../src/modules/identity/jwt.js";
import { IdentityService } from "../../src/modules/identity/service.js";
import type { IdentityStore } from "../../src/modules/identity/store.js";
import { BranchRevisionConflictError } from "../../src/modules/models/operations/errors.js";
import { registerModelOperationRoutes } from "../../src/modules/models/operations/routes.js";
import { ModelOperationService } from "../../src/modules/models/operations/service.js";
import type {
  CommitOperationsCommand,
  CreateBranchCommand,
  InitializeModelCommand,
  ModelCommitResponse,
  ModelOperationRepository,
  OperationHistoryPage,
  PreviewOperationsCommand,
  RestoreBranchCommand,
} from "../../src/modules/models/operations/types.js";
import type {
  CreateProjectCommand,
  ProjectRepository,
} from "../../src/modules/projects/repository.js";
import {
  alphaProjectId,
  alphaTenantId,
  betaTenantId,
  canonicalSnapshotFixture,
  editorUserId,
  existingModelId,
  ownerUserId,
  viewerUserId,
} from "../c4/fixtures.js";

const now = "2026-07-17T12:00:00.000Z";
const branchId = "71000000-0000-4000-8000-000000000001";
const targetBranchId = "71000000-0000-4000-8000-000000000002";
const snapshotId = "72000000-0000-4000-8000-000000000001";
const previewId = "73000000-0000-4000-8000-000000000001";
const commitId = "74000000-0000-4000-8000-000000000001";
const operationId = "75000000-0000-4000-8000-000000000001";
const clientOperationId = "76000000-0000-4000-8000-000000000001";
const tokenProvider = new LocalFixtureTokenProvider(
  "c5-route-session-secret-with-at-least-thirty-two-bytes",
);

const actors: Record<string, Actor> = {
  "fixture|editor-alpha": {
    displayName: "Synthetic editor",
    role: "editor",
    subject: "fixture|editor-alpha",
    tenantId: alphaTenantId,
    userId: editorUserId,
  },
  "fixture|owner-alpha": {
    displayName: "Synthetic owner",
    role: "owner",
    subject: "fixture|owner-alpha",
    tenantId: alphaTenantId,
    userId: ownerUserId,
  },
  "fixture|viewer-alpha": {
    displayName: "Synthetic viewer",
    role: "viewer",
    subject: "fixture|viewer-alpha",
    tenantId: alphaTenantId,
    userId: viewerUserId,
  },
  "fixture|owner-beta": {
    displayName: "Synthetic foreign owner",
    role: "owner",
    subject: "fixture|owner-beta",
    tenantId: betaTenantId,
    userId: "20000000-0000-4000-8000-000000000004",
  },
};

class FixtureIdentityStore implements IdentityStore {
  findFixtureActor(persona: LocalPersona): Promise<Actor | undefined> {
    void persona;
    return Promise.resolve(undefined);
  }

  findSessionActor(tenantId: string, subject: string): Promise<Actor | undefined> {
    const actor = actors[subject];
    return Promise.resolve(actor?.tenantId === tenantId ? actor : undefined);
  }
}

const project = projectSchema.parse({
  createdAt: now,
  id: alphaProjectId,
  name: "Synthetic C5 project",
  status: "draft",
  tenantId: alphaTenantId,
  updatedAt: now,
  version: 1,
});

class FixtureProjectRepository implements ProjectRepository {
  create(command: CreateProjectCommand): Promise<Project> {
    void command;
    return Promise.reject(new Error("Project creation is outside the C5 route fixture."));
  }

  findById(tenantId: string, projectId: string): Promise<Project | undefined> {
    return Promise.resolve(
      tenantId === project.tenantId && projectId === project.id ? project : undefined,
    );
  }

  list(tenantId: string): Promise<readonly Project[]> {
    return Promise.resolve(tenantId === project.tenantId ? [project] : []);
  }
}

function branch(id = branchId, revision = 0, hash = snapshotHash()): ModelBranch {
  return modelBranchSchema.parse({
    createdAt: now,
    createdBy: ownerUserId,
    headSnapshotId: snapshotId,
    headSnapshotSha256: hash,
    id,
    modelId: existingModelId,
    name: id === branchId ? "Main" : "Alternative",
    profile: "existing",
    projectId: alphaProjectId,
    revision,
    schemaVersion: "c5-model-branch-v1",
    sourceSnapshotId: snapshotId,
    updatedAt: now,
  });
}

function snapshotHash(): string {
  return canonicalizeHomeSnapshot(canonicalSnapshotFixture()).snapshotSha256;
}

class FixtureModelOperationRepository implements ModelOperationRepository {
  readonly initializationCommands: InitializeModelCommand[] = [];
  readonly branchCommands: CreateBranchCommand[] = [];
  readonly previewCommands: PreviewOperationsCommand[] = [];
  readonly commitCommands: CommitOperationsCommand[] = [];
  readonly restoreCommands: RestoreBranchCommand[] = [];

  initialize(command: InitializeModelCommand) {
    this.initializationCommands.push(command);
    const canonical = canonicalizeHomeSnapshot(command.snapshot);
    return Promise.resolve({
      record: modelSnapshotRecordSchema.parse({
        canonicalByteLength: canonical.canonicalByteLength,
        createdAt: now,
        createdBy: command.actor.userId,
        id: snapshotId,
        modelId: command.snapshot.modelId,
        profile: command.profile,
        projectId: command.projectId,
        schemaVersion: command.snapshot.schemaVersion,
        snapshot: canonical.snapshot,
        snapshotSha256: canonical.snapshotSha256,
        version: 1,
      }),
      replayed: false,
    });
  }

  createBranch(command: CreateBranchCommand) {
    this.branchCommands.push(command);
    return Promise.resolve({ branch: branch(), replayed: false });
  }

  listBranches(tenantId: string, projectId: string, profile: ModelProfile) {
    return Promise.resolve(
      tenantId === alphaTenantId && projectId === alphaProjectId && profile === "existing"
        ? [branch(), branch(targetBranchId)]
        : [],
    );
  }

  getBranch(tenantId: string, projectId: string, profile: ModelProfile, id: string) {
    return Promise.resolve(
      tenantId === alphaTenantId && projectId === alphaProjectId && profile === "existing"
        ? branch(id)
        : undefined,
    );
  }

  preview(command: PreviewOperationsCommand) {
    this.previewCommands.push(command);
    if (command.expectedRevision !== 0) {
      throw new BranchRevisionConflictError({
        branchId,
        currentHeadSnapshotSha256: snapshotHash(),
        currentRevision: 0,
      });
    }
    return Promise.resolve({
      preview: modelOperationsPreviewSchema.parse({
        baseHeadSnapshotSha256: snapshotHash(),
        baseRevision: 0,
        branchId,
        canonicalByteLength: 100,
        expiresAt: "2026-07-17T12:15:00.000Z",
        findings: [],
        hasBlockingFindings: false,
        id: previewId,
        operations: command.operations,
        projectId: alphaProjectId,
        resultSnapshotSha256: "a".repeat(64),
      }),
      replayed: false,
    });
  }

  #commitResponse(actorUserId: string): ModelCommitResponse {
    return {
      branch: branch(branchId, 1, "a".repeat(64)),
      commit: modelCommitSchema.parse({
        branchId,
        committedAt: now,
        committedBy: actorUserId,
        id: commitId,
        message: "Commit fixture",
        operationIds: [operationId],
        parentSnapshotSha256: snapshotHash(),
        projectId: alphaProjectId,
        revision: 1,
        snapshotId,
        snapshotSha256: "a".repeat(64),
      }),
      findings: [],
    };
  }

  commit(command: CommitOperationsCommand) {
    this.commitCommands.push(command);
    return Promise.resolve({
      replayed: false,
      response: this.#commitResponse(command.actor.userId),
    });
  }

  restore(command: RestoreBranchCommand) {
    this.restoreCommands.push(command);
    return Promise.resolve({
      replayed: false,
      response: this.#commitResponse(command.actor.userId),
    });
  }

  listOperations(
    tenantId: string,
    projectId: string,
    profile: ModelProfile,
    requestedBranchId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<OperationHistoryPage> {
    void cursor;
    void limit;
    if (
      tenantId !== alphaTenantId ||
      projectId !== alphaProjectId ||
      profile !== "existing" ||
      requestedBranchId !== branchId
    ) {
      return Promise.resolve({ operations: [] });
    }
    return Promise.resolve({
      operations: [
        {
          branchId,
          clientOperationId,
          commitId,
          committedAt: now,
          committedBy: ownerUserId,
          id: operationId,
          ordinal: 0,
          projectId: alphaProjectId,
          reason: "Initial canonical snapshot import.",
          revision: 1,
          schemaVersion: "c5-model-operation-v1",
          type: "snapshot.initialize.v1",
        },
      ],
    });
  }

  compareBranches(
    tenantId: string,
    projectId: string,
    profile: ModelProfile,
    baseId: string,
    comparedId: string,
  ) {
    return Promise.resolve(
      tenantId === alphaTenantId && projectId === alphaProjectId && profile === "existing"
        ? {
            baseBranchId: baseId,
            baseHeadSnapshotSha256: snapshotHash(),
            changes: [],
            projectId,
            targetBranchId: comparedId,
            targetHeadSnapshotSha256: snapshotHash(),
            truncated: false,
          }
        : undefined,
    );
  }

  verifyReplay(tenantId: string, projectId: string, profile: ModelProfile, id: string) {
    void tenantId;
    void projectId;
    void profile;
    return Promise.resolve({ branchId: id, commitCount: 1, finalSnapshotSha256: snapshotHash() });
  }
}

const activeServers = new Set<FastifyInstance>();

function createFixtureServer(logger: false | FastifyLoggerOptions = false) {
  const server = Fastify({ logger });
  registerRequestCorrelation(server);
  registerErrorHandling(server);
  const identity = new IdentityService("test", new FixtureIdentityStore(), tokenProvider);
  const repository = new FixtureModelOperationRepository();
  registerModelOperationRoutes(
    server,
    identity,
    new FixtureProjectRepository(),
    new ModelOperationService(repository),
  );
  activeServers.add(server);
  return { repository, server };
}

function token(subject: string, tenantId = alphaTenantId): string {
  return tokenProvider.issueLocal({ subject, tenantId }).accessToken;
}

function auth(subject: string, tenantId = alphaTenantId) {
  return { authorization: `Bearer ${token(subject, tenantId)}` };
}

afterEach(async () => {
  await Promise.all([...activeServers].map((server) => server.close()));
  activeServers.clear();
});

describe("C5 model operation routes", () => {
  it("exposes the exact frozen route inventory plus the typed initialization bridge", () => {
    const { server } = createFixtureServer();
    const route = (method: "GET" | "POST", url: string) => server.hasRoute({ method, url });
    expect(route("POST", "/v1/projects/:projectId/models/:profile/snapshots")).toBe(true);
    expect(route("GET", "/v1/projects/:projectId/models/:profile/branches")).toBe(true);
    expect(route("POST", "/v1/projects/:projectId/models/:profile/branches")).toBe(true);
    expect(route("GET", "/v1/projects/:projectId/models/:profile/branches/:branchId")).toBe(true);
    expect(
      route("POST", "/v1/projects/:projectId/models/:profile/branches/:branchId/previews"),
    ).toBe(true);
    expect(
      route("POST", "/v1/projects/:projectId/models/:profile/branches/:branchId/commits"),
    ).toBe(true);
    expect(
      route("GET", "/v1/projects/:projectId/models/:profile/branches/:branchId/operations"),
    ).toBe(true);
    expect(
      route("POST", "/v1/projects/:projectId/models/:profile/branches/:branchId/restores"),
    ).toBe(true);
    expect(
      route(
        "GET",
        "/v1/projects/:projectId/models/:profile/branches/:branchId/compare/:targetBranchId",
      ),
    ).toBe(true);
  });

  it("routes first import through initialization and rejects raw amendments", async () => {
    const { repository, server } = createFixtureServer();
    const url = `/v1/projects/${alphaProjectId}/models/existing/snapshots`;
    const initialized = await server.inject({
      headers: { ...auth("fixture|owner-alpha"), "idempotency-key": "c5-initialize-0001" },
      method: "POST",
      payload: { expectedCurrentSnapshotSha256: null, snapshot: canonicalSnapshotFixture() },
      url,
    });
    expect(initialized.statusCode).toBe(201);
    expect(repository.initializationCommands).toHaveLength(1);

    const rawAmendment = await server.inject({
      headers: { ...auth("fixture|owner-alpha"), "idempotency-key": "c5-raw-amendment-1" },
      method: "POST",
      payload: {
        expectedCurrentSnapshotSha256: snapshotHash(),
        snapshot: canonicalSnapshotFixture(),
      },
      url,
    });
    expect(rawAmendment.statusCode).toBe(409);
    expect(rawAmendment.json()).toMatchObject({ code: "TYPED_OPERATION_REQUIRED" });
    expect(repository.initializationCommands).toHaveLength(1);
  });

  it("lets viewers read/history/compare while denying every mutation", async () => {
    const { repository, server } = createFixtureServer();
    const base = `/v1/projects/${alphaProjectId}/models/existing/branches`;
    const viewerHeaders = auth("fixture|viewer-alpha");
    expect(
      (await server.inject({ headers: viewerHeaders, method: "GET", url: base })).statusCode,
    ).toBe(200);
    expect(
      (
        await server.inject({
          headers: viewerHeaders,
          method: "GET",
          url: `${base}/${branchId}/operations`,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await server.inject({
          headers: viewerHeaders,
          method: "GET",
          url: `${base}/${branchId}/compare/${targetBranchId}`,
        })
      ).statusCode,
    ).toBe(200);
    const denied = await server.inject({
      headers: { ...viewerHeaders, "idempotency-key": "c5-viewer-denied1" },
      method: "POST",
      payload: {
        name: "Denied",
        sourceSnapshotId: snapshotId,
        sourceSnapshotSha256: snapshotHash(),
      },
      url: base,
    });
    expect(denied.statusCode).toBe(403);
    expect(repository.branchCommands).toHaveLength(0);
  });

  it("returns bounded recovery details on stale dual preconditions", async () => {
    const { server } = createFixtureServer();
    const fixtureSpace = canonicalSnapshotFixture().elements.spaces[0];
    if (fixtureSpace === undefined) throw new Error("Fixture space is missing.");
    const response = await server.inject({
      headers: { ...auth("fixture|editor-alpha"), "idempotency-key": "c5-stale-preview1" },
      method: "POST",
      payload: {
        expectedHeadSnapshotSha256: snapshotHash(),
        expectedRevision: 7,
        operations: [
          {
            clientOperationId,
            name: {
              attribution: fixtureSpace.name.attribution,
              knowledge: "known",
              value: "Renamed fixture",
            },
            reason: "Rename fixture",
            schemaVersion: "c5-model-operation-v1",
            spaceId: fixtureSpace.id,
            type: "space.rename.v1",
          },
        ],
      },
      url: `/v1/projects/${alphaProjectId}/models/existing/branches/${branchId}/previews`,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "BRANCH_REVISION_CONFLICT",
      currentHeadSnapshotSha256: snapshotHash(),
      currentRevision: 0,
      recoveryActions: ["reload", "compare", "discard-local", "rebuild-preview"],
    });
  });

  it("handles an expected stale-write response without a reply-already-sent server error", async () => {
    const logLines: string[] = [];
    const { server } = createFixtureServer({
      level: "error",
      stream: {
        write(line: string) {
          logLines.push(line);
        },
      },
    });
    const fixtureSpace = canonicalSnapshotFixture().elements.spaces[0];
    if (fixtureSpace === undefined) throw new Error("Fixture space is missing.");

    const response = await server.inject({
      headers: { ...auth("fixture|editor-alpha"), "idempotency-key": "c5-stale-log-001" },
      method: "POST",
      payload: {
        expectedHeadSnapshotSha256: snapshotHash(),
        expectedRevision: 7,
        operations: [
          {
            clientOperationId,
            name: {
              attribution: fixtureSpace.name.attribution,
              knowledge: "known",
              value: "Renamed fixture",
            },
            reason: "Rename fixture",
            schemaVersion: "c5-model-operation-v1",
            spaceId: fixtureSpace.id,
            type: "space.rename.v1",
          },
        ],
      },
      url: `/v1/projects/${alphaProjectId}/models/existing/branches/${branchId}/previews`,
    });

    expect(response.statusCode).toBe(409);
    expect(logLines.join("\n")).not.toContain("Promise errored, but reply.sent = true was set");
  });

  it("denies cross-tenant requests before branch disclosure", async () => {
    const { server } = createFixtureServer();
    const response = await server.inject({
      headers: auth("fixture|owner-beta", betaTenantId),
      method: "GET",
      url: `/v1/projects/${alphaProjectId}/models/existing/branches/${branchId}`,
    });
    expect(response.statusCode).toBe(404);
  });
});
