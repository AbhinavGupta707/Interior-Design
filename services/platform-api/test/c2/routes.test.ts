import {
  assetSchema,
  assetUploadSessionSchema,
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
import { IdentityService } from "../../src/modules/identity/service.js";
import { LocalFixtureTokenProvider } from "../../src/modules/identity/jwt.js";
import type { IdentityStore } from "../../src/modules/identity/store.js";
import type { IntakeRepository } from "../../src/modules/intake/repository.js";
import type { ProjectRepository } from "../../src/modules/projects/repository.js";
import type {
  AssetAccessResponse,
  AssetBackend,
  CreateUploadSessionCommand,
  IssueAssetAccessCommand,
  ResumableAssetUploadSession,
} from "../../src/modules/assets/types.js";
import { resumableAssetUploadSessionSchema } from "../../src/modules/assets/types.js";

const alphaTenantId = "10000000-0000-4000-8000-000000000001";
const betaTenantId = "10000000-0000-4000-8000-000000000002";
const alphaProjectId = "30000000-0000-4000-8000-000000000001";
const betaProjectId = "30000000-0000-4000-8000-000000000002";
const assetId = "40000000-0000-4000-8000-000000000001";
const sessionId = "50000000-0000-4000-8000-000000000001";
const checksum = `${"A".repeat(43)}=`;
const sourceSha256 = "a".repeat(64);
const now = "2026-07-17T12:00:00.000Z";

const actors: Readonly<Record<LocalPersona, Actor>> = {
  "homeowner-alpha": {
    displayName: "Synthetic alpha owner",
    role: "owner",
    subject: "fixture|homeowner-alpha",
    tenantId: alphaTenantId,
    userId: "20000000-0000-4000-8000-000000000001",
  },
  "homeowner-beta": {
    displayName: "Synthetic beta owner",
    role: "owner",
    subject: "fixture|homeowner-beta",
    tenantId: betaTenantId,
    userId: "20000000-0000-4000-8000-000000000003",
  },
  "viewer-alpha": {
    displayName: "Synthetic alpha viewer",
    role: "viewer",
    subject: "fixture|viewer-alpha",
    tenantId: alphaTenantId,
    userId: "20000000-0000-4000-8000-000000000002",
  },
};

const projects = [
  projectSchema.parse({
    createdAt: now,
    id: alphaProjectId,
    name: "Synthetic alpha project",
    status: "active",
    tenantId: alphaTenantId,
    updatedAt: now,
    version: 1,
  }),
  projectSchema.parse({
    createdAt: now,
    id: betaProjectId,
    name: "Synthetic beta project",
    status: "active",
    tenantId: betaTenantId,
    updatedAt: now,
    version: 1,
  }),
];

const readyAsset = assetSchema.parse({
  createdAt: now,
  declaredMimeType: "application/pdf",
  detectedMimeType: "application/pdf",
  fileName: "synthetic-plan.pdf",
  id: assetId,
  kind: "plan",
  projectId: alphaProjectId,
  rights: {
    basis: "owned-by-user",
    serviceProcessingConsent: true,
    trainingUseConsent: "denied",
  },
  source: { byteSize: 42, sha256: sourceSha256 },
  status: "ready",
  updatedAt: now,
});

class MemoryBoundaries implements IdentityStore, ProjectRepository, IntakeRepository {
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

  create(): Promise<Project> {
    return Promise.reject(new Error("C1 project creation is outside this C2 route fixture."));
  }

  findById(tenantId: string, projectId: string): Promise<Project | undefined> {
    return Promise.resolve(
      projects.find((project) => project.tenantId === tenantId && project.id === projectId),
    );
  }

  list(tenantId: string): Promise<readonly Project[]> {
    return Promise.resolve(projects.filter((project) => project.tenantId === tenantId));
  }

  find(): Promise<ProjectIntake | undefined> {
    return Promise.resolve(undefined);
  }

  upsert(): Promise<ProjectIntake> {
    return Promise.reject(new Error("C1 intake mutation is outside this C2 route fixture."));
  }
}

class MemoryAssetBackend implements AssetBackend {
  lastCreate: CreateUploadSessionCommand | undefined;
  readonly accessRequests: IssueAssetAccessCommand[] = [];
  recordedPartNumbers: number[] = [1];

  abortUpload(): Promise<void> {
    return Promise.resolve();
  }

  cleanupExpiredSessions(): Promise<number> {
    return Promise.resolve(0);
  }

  completeUpload(): Promise<typeof readyAsset> {
    return Promise.resolve(readyAsset);
  }

  createUploadSession(command: CreateUploadSessionCommand) {
    this.lastCreate = command;
    return Promise.resolve(
      assetUploadSessionSchema.parse({
        asset: { ...readyAsset, detectedMimeType: undefined, status: "pending-upload" },
        expiresAt: "2026-07-18T12:00:00.000Z",
        maximumPartCount: 10_000,
        minimumNonFinalPartSize: 5_242_880,
        partSize: 134_217_728,
        sessionId,
        state: "initiated",
      }),
    );
  }

  findAsset(tenantId: string, projectId: string, requestedAssetId: string) {
    return Promise.resolve(
      tenantId === alphaTenantId && projectId === alphaProjectId && requestedAssetId === assetId
        ? readyAsset
        : undefined,
    );
  }

  findUploadSession(
    tenantId: string,
    projectId: string,
    requestedSessionId: string,
  ): Promise<ResumableAssetUploadSession | undefined> {
    if (
      tenantId !== alphaTenantId ||
      projectId !== alphaProjectId ||
      requestedSessionId !== sessionId
    ) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(
      resumableAssetUploadSessionSchema.parse({
        asset: { ...readyAsset, detectedMimeType: undefined, status: "uploading" },
        expiresAt: "2026-07-18T12:00:00.000Z",
        maximumPartCount: 10_000,
        minimumNonFinalPartSize: 5_242_880,
        partSize: 134_217_728,
        recordedPartNumbers: this.recordedPartNumbers,
        sessionId,
        state: "uploading",
      }),
    );
  }

  issueAccess(command: IssueAssetAccessCommand): Promise<AssetAccessResponse> {
    this.accessRequests.push(command);
    return Promise.resolve({
      contentDisposition: command.request.representation === "original" ? "attachment" : "inline",
      expiresAt: "2026-07-17T12:05:00.000Z",
      url: "http://127.0.0.1:8333/safe-signed-test-url",
    });
  }

  listAssets(tenantId: string, projectId: string) {
    return Promise.resolve(
      tenantId === alphaTenantId && projectId === alphaProjectId ? [readyAsset] : [],
    );
  }

  signUploadPart() {
    return Promise.resolve({
      expiresAt: "2026-07-17T12:15:00.000Z",
      partNumber: 1,
      requiredHeaders: {
        "content-length": "42",
        "x-amz-checksum-sha256": checksum,
        "x-amz-sdk-checksum-algorithm": "SHA256",
      },
      url: "http://127.0.0.1:8333/safe-signed-part-test-url",
    });
  }
}

const testConfig = loadPlatformApiConfig({
  NODE_ENV: "test",
  PLATFORM_API_LOG_LEVEL: "silent",
});
const activeServers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(activeServers.splice(0).map(async (server) => server.close()));
});

function testServer() {
  const boundaries = new MemoryBoundaries();
  const backend = new MemoryAssetBackend();
  const tokens = new LocalFixtureTokenProvider(
    "c2-route-test-secret-with-at-least-thirty-two-bytes",
  );
  const identity = new IdentityService("test", boundaries, tokens);
  const server = createServer({
    c1: {
      identityStore: boundaries,
      intakeRepository: boundaries,
      projectRepository: boundaries,
      tokenProvider: tokens,
    },
    c2: { backend, identity, projects: boundaries },
    config: testConfig,
    logger: false,
  });
  activeServers.push(server);
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

function headers(token: string, idempotencyKey?: string) {
  return {
    authorization: `Bearer ${token}`,
    ...(idempotencyKey === undefined ? {} : { "idempotency-key": idempotencyKey }),
  };
}

describe("C2 evidence HTTP contract", () => {
  it("creates a rights-aware session with default-denied training and no internal locator", async () => {
    const { backend, server } = testServer();
    const token = await signIn(server, "homeowner-alpha");
    const response = await server.inject({
      headers: headers(token, "c2-create-session-001"),
      method: "POST",
      payload: {
        byteSize: 42,
        declaredMimeType: "application/pdf",
        fileName: "synthetic-plan.pdf",
        kind: "plan",
        rights: { basis: "owned-by-user", serviceProcessingConsent: true },
        sha256: sourceSha256,
      },
      url: `/v1/projects/${alphaProjectId}/assets/upload-sessions`,
    });
    expect(response.statusCode).toBe(201);
    expect(backend.lastCreate?.request.rights.trainingUseConsent).toBe("denied");
    expect(response.json()).toMatchObject({ asset: { status: "pending-upload" }, sessionId });
    expect(response.body).not.toMatch(/provider|objectKey|bucket|uploadId/iu);
  });

  it("returns sorted unique recorded parts and an explicit empty resume state", async () => {
    const { backend, server } = testServer();
    const token = await signIn(server, "homeowner-alpha");
    const response = await server.inject({
      headers: headers(token),
      method: "GET",
      url: `/v1/projects/${alphaProjectId}/assets/upload-sessions/${sessionId}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      recordedPartNumbers: [1],
      sessionId,
      state: "uploading",
    });
    const resumed = response.json<ResumableAssetUploadSession>();

    backend.recordedPartNumbers = [];
    const empty = await server.inject({
      headers: headers(token),
      method: "GET",
      url: `/v1/projects/${alphaProjectId}/assets/upload-sessions/${sessionId}`,
    });
    expect(empty.json()).toMatchObject({ recordedPartNumbers: [], sessionId });
    expect(() =>
      resumableAssetUploadSessionSchema.parse({ ...resumed, recordedPartNumbers: [2, 1] }),
    ).toThrow(/sorted and unique/u);
    expect(() =>
      resumableAssetUploadSessionSchema.parse({ ...resumed, recordedPartNumbers: [1, 1] }),
    ).toThrow(/sorted and unique/u);
  });

  it("makes foreign and unknown project lookups non-disclosing", async () => {
    const { server } = testServer();
    const token = await signIn(server, "homeowner-alpha");
    const foreign = await server.inject({
      headers: headers(token),
      method: "GET",
      url: `/v1/projects/${betaProjectId}/assets`,
    });
    const unknown = await server.inject({
      headers: headers(token),
      method: "GET",
      url: `/v1/projects/${randomUUID()}/assets`,
    });
    expect(foreign.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
    expect(foreign.json()).toMatchObject({
      code: "NOT_FOUND",
      detail: unknown.json<{ detail: string }>().detail,
    });
  });

  it("allows viewer inventory and derived access but denies upload mutations and originals", async () => {
    const { backend, server } = testServer();
    const token = await signIn(server, "viewer-alpha");
    const base = `/v1/projects/${alphaProjectId}/assets`;
    const list = await server.inject({ headers: headers(token), method: "GET", url: base });
    const preview = await server.inject({
      headers: headers(token, "viewer-preview-access-1"),
      method: "POST",
      payload: { representation: "preview" },
      url: `${base}/${assetId}/access`,
    });
    expect(list.statusCode).toBe(200);
    expect(preview.statusCode).toBe(200);
    expect(backend.accessRequests).toHaveLength(1);

    const denied = await Promise.all([
      server.inject({
        headers: headers(token, "viewer-create-denied-1"),
        method: "POST",
        payload: {
          byteSize: 42,
          declaredMimeType: "application/pdf",
          fileName: "synthetic.pdf",
          kind: "plan",
          rights: { basis: "owned-by-user", serviceProcessingConsent: true },
          sha256: sourceSha256,
        },
        url: `${base}/upload-sessions`,
      }),
      server.inject({
        headers: headers(token, "viewer-sign-denied-01"),
        method: "POST",
        payload: { byteSize: 42, checksumSha256: checksum, partNumber: 1 },
        url: `${base}/upload-sessions/${sessionId}/parts`,
      }),
      server.inject({
        headers: headers(token, "viewer-complete-denied"),
        method: "POST",
        payload: {
          parts: [{ checksumSha256: checksum, etag: "etag-one", partNumber: 1 }],
          sha256: sourceSha256,
        },
        url: `${base}/upload-sessions/${sessionId}/complete`,
      }),
      server.inject({
        headers: headers(token, "viewer-abort-denied-01"),
        method: "DELETE",
        url: `${base}/upload-sessions/${sessionId}`,
      }),
      server.inject({
        headers: headers(token, "viewer-original-denied"),
        method: "POST",
        payload: { representation: "original" },
        url: `${base}/${assetId}/access`,
      }),
    ]);
    expect(denied.map((response) => response.statusCode)).toEqual([403, 403, 403, 403, 403]);
  });
});
