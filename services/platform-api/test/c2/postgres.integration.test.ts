import type {
  Asset,
  AssetProcessingResult,
  AssetUploadSession,
  LocalPersona,
  Project,
} from "@interior-design/contracts";
import { loadPlatformApiConfig } from "@interior-design/config";
import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createServer } from "../../src/app.js";
import { applyC1Migration, bootstrapC1Fixtures, createC1Sql } from "../../src/c1.js";
import { applyC2Migration } from "../../src/c2.js";
import { PostgresAssetProcessingJobRepository } from "../../src/modules/assets/processing-jobs.js";
import type {
  AbortMultipartUploadInput,
  AssetObjectStorage,
  CompleteMultipartUploadInput,
  CreateMultipartUploadInput,
  SignObjectAccessInput,
  SignUploadPartInput,
  SignedObjectAccess,
  SignedUploadPart,
} from "../../src/storage/object-storage.js";

const integrationDatabaseUrl = process.env.C1_TEST_DATABASE_URL ?? "";
const describeWithPostgres = integrationDatabaseUrl === "" ? describe.skip : describe;
const alphaTenantId = "10000000-0000-4000-8000-000000000001";
const betaTenantId = "10000000-0000-4000-8000-000000000002";
const checksum = `${"A".repeat(43)}=`;
const sourceSha256 = "a".repeat(64);
const activeServers = new Set<ReturnType<typeof createServer>>();

const testConfig = loadPlatformApiConfig({
  NODE_ENV: "test",
  PLATFORM_API_LOG_LEVEL: "silent",
  PLATFORM_API_SHUTDOWN_TIMEOUT_MS: "2000",
});

class FakeObjectStorage implements AssetObjectStorage {
  readonly aborted: AbortMultipartUploadInput[] = [];
  readonly completed: CompleteMultipartUploadInput[] = [];
  readonly created: CreateMultipartUploadInput[] = [];
  readonly signedAccess: SignObjectAccessInput[] = [];
  readonly signedParts: SignUploadPartInput[] = [];

  abortMultipartUpload(input: AbortMultipartUploadInput): Promise<void> {
    this.aborted.push(input);
    return Promise.resolve();
  }

  completeMultipartUpload(input: CompleteMultipartUploadInput): Promise<void> {
    this.completed.push(input);
    return Promise.resolve();
  }

  createMultipartUpload(input: CreateMultipartUploadInput): Promise<string> {
    this.created.push(input);
    return Promise.resolve(`fake-provider-upload-${String(this.created.length)}`);
  }

  readiness(): Promise<void> {
    return Promise.resolve();
  }

  signObjectAccess(input: SignObjectAccessInput): Promise<SignedObjectAccess> {
    this.signedAccess.push(input);
    return Promise.resolve({
      expiresAt: input.expiresAt.toISOString(),
      url: "http://127.0.0.1:8333/signed-access-fixture",
    });
  }

  signUploadPart(input: SignUploadPartInput): Promise<SignedUploadPart> {
    this.signedParts.push(input);
    return Promise.resolve({
      expiresAt: input.expiresAt.toISOString(),
      requiredHeaders: {
        "content-length": String(input.byteSize),
        "x-amz-checksum-sha256": input.checksumSha256,
        "x-amz-sdk-checksum-algorithm": "SHA256",
      },
      url: "http://127.0.0.1:8333/signed-part-fixture",
    });
  }
}

async function clearSyntheticData(sql: Sql): Promise<void> {
  await sql`
    TRUNCATE TABLE
      asset_audit_events,
      derived_asset_artifacts,
      asset_processing_jobs,
      asset_upload_parts,
      asset_upload_sessions,
      asset_rights_assertions,
      assets
  `;
  for (const tenantId of [alphaTenantId, betaTenantId]) {
    await sql`DELETE FROM audit_events WHERE tenant_id = ${tenantId}::uuid`;
    await sql`DELETE FROM project_intakes WHERE tenant_id = ${tenantId}::uuid`;
    await sql`DELETE FROM mutation_idempotency WHERE tenant_id = ${tenantId}::uuid`;
    await sql`DELETE FROM projects WHERE tenant_id = ${tenantId}::uuid`;
  }
}

function postgresServer(storage: AssetObjectStorage) {
  const c1Database = createC1Sql(integrationDatabaseUrl);
  const c2Database = createC1Sql(integrationDatabaseUrl);
  const server = createServer({
    c1: { closeDatabase: true, database: c1Database },
    c2: { closeDatabase: true, database: c2Database, storage },
    config: testConfig,
    environment: {
      C1_LOCAL_SESSION_SECRET: "c2-integration-secret-with-at-least-thirty-two-bytes",
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
  return response.json<{ accessToken: string }>().accessToken;
}

function authorization(token: string, idempotencyKey?: string) {
  return {
    authorization: `Bearer ${token}`,
    ...(idempotencyKey === undefined ? {} : { "idempotency-key": idempotencyKey }),
  };
}

async function createProject(
  server: ReturnType<typeof createServer>,
  token: string,
  key: string,
  name: string,
): Promise<Project> {
  const response = await server.inject({
    headers: authorization(token, key),
    method: "POST",
    payload: { name },
    url: "/v1/projects",
  });
  expect(response.statusCode).toBe(201);
  return response.json<Project>();
}

function createSessionRequest(token: string, projectId: string, key: string) {
  return {
    headers: authorization(token, key),
    method: "POST" as const,
    payload: {
      byteSize: 42,
      declaredMimeType: "application/pdf",
      fileName: "synthetic-plan.pdf",
      kind: "plan",
      rights: { basis: "owned-by-user", serviceProcessingConsent: true },
      sha256: sourceSha256,
    },
    url: `/v1/projects/${projectId}/assets/upload-sessions`,
  };
}

async function signOnlyPart(
  server: ReturnType<typeof createServer>,
  token: string,
  projectId: string,
  sessionId: string,
  key: string,
): Promise<void> {
  const response = await server.inject({
    headers: authorization(token, key),
    method: "POST",
    payload: { byteSize: 42, checksumSha256: checksum, partNumber: 1 },
    url: `/v1/projects/${projectId}/assets/upload-sessions/${sessionId}/parts`,
  });
  expect(response.statusCode).toBe(200);
}

function completionRequest(token: string, projectId: string, sessionId: string, key: string) {
  return {
    headers: authorization(token, key),
    method: "POST" as const,
    payload: {
      parts: [{ checksumSha256: checksum, etag: "provider-etag-one", partNumber: 1 }],
      sha256: sourceSha256,
    },
    url: `/v1/projects/${projectId}/assets/upload-sessions/${sessionId}/complete`,
  };
}

describeWithPostgres("C2 real Postgres with provider fake", () => {
  let administration: Sql;

  beforeAll(async () => {
    administration = createC1Sql(integrationDatabaseUrl);
    await applyC1Migration(administration);
    await bootstrapC1Fixtures(administration, "test");
    await applyC2Migration(administration);
    await clearSyntheticData(administration);
  });

  afterAll(async () => {
    await clearSyntheticData(administration);
    await administration.end({ timeout: 5 });
  });

  afterEach(async () => {
    await Promise.all([...activeServers].map(async (server) => closeServer(server)));
  });

  it("persists an isolated idempotent upload, durable retry, ready access, and immutable source", async () => {
    const storage = new FakeObjectStorage();
    const server = postgresServer(storage);
    const alphaToken = await signIn(server, "homeowner-alpha");
    const betaToken = await signIn(server, "homeowner-beta");
    const viewerToken = await signIn(server, "viewer-alpha");
    const alphaProject = await createProject(
      server,
      alphaToken,
      "c2-pg-alpha-project",
      "C2 synthetic alpha home",
    );
    const betaProject = await createProject(
      server,
      betaToken,
      "c2-pg-beta-project-1",
      "C2 synthetic beta home",
    );

    const createRequest = createSessionRequest(
      alphaToken,
      alphaProject.id,
      "c2-pg-session-create-1",
    );
    const [created, replay] = await Promise.all([
      server.inject(createRequest),
      server.inject(createRequest),
    ]);
    expect(created.statusCode).toBe(201);
    expect(replay.json()).toEqual(created.json());
    expect(storage.created).toHaveLength(1);
    const session = created.json<AssetUploadSession>();
    expect(session.asset.rights.trainingUseConsent).toBe("denied");
    expect(created.body).not.toMatch(/provider_upload|source_object|fake-provider-upload/iu);

    const idempotencyConflict = await server.inject({
      ...createRequest,
      payload: { ...createRequest.payload, fileName: "changed.pdf" },
    });
    expect(idempotencyConflict.statusCode).toBe(409);
    expect(idempotencyConflict.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const viewerDenied = await server.inject(
      createSessionRequest(viewerToken, alphaProject.id, "c2-pg-viewer-denied"),
    );
    expect(viewerDenied.statusCode).toBe(403);

    const foreign = await server.inject({
      headers: authorization(alphaToken),
      method: "GET",
      url: `/v1/projects/${betaProject.id}/assets`,
    });
    const unknown = await server.inject({
      headers: authorization(alphaToken),
      method: "GET",
      url: `/v1/projects/${randomUUID()}/assets`,
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toMatchObject({
      code: "NOT_FOUND",
      detail: unknown.json<{ detail: string }>().detail,
    });

    const signRequest = {
      headers: authorization(alphaToken, "c2-pg-sign-part-001"),
      method: "POST" as const,
      payload: { byteSize: 42, checksumSha256: checksum, partNumber: 1 },
      url: `/v1/projects/${alphaProject.id}/assets/upload-sessions/${session.sessionId}/parts`,
    };
    const signed = await server.inject(signRequest);
    const signedReplay = await server.inject(signRequest);
    expect(signed.statusCode).toBe(200);
    expect(signedReplay.json()).toEqual(signed.json());
    expect(storage.signedParts).toHaveLength(1);
    expect(signed.json()).toMatchObject({
      requiredHeaders: {
        "content-length": "42",
        "x-amz-checksum-sha256": checksum,
        "x-amz-sdk-checksum-algorithm": "SHA256",
      },
    });

    const resume = await server.inject({
      headers: authorization(alphaToken),
      method: "GET",
      url: `/v1/projects/${alphaProject.id}/assets/upload-sessions/${session.sessionId}`,
    });
    expect(resume.json()).toMatchObject({ recordedPartNumbers: [1], sessionId: session.sessionId });

    const completeRequest = completionRequest(
      alphaToken,
      alphaProject.id,
      session.sessionId,
      "c2-pg-complete-001",
    );
    const completed = await server.inject(completeRequest);
    const completedReplay = await server.inject(completeRequest);
    expect(completed.statusCode).toBe(200);
    expect(completedReplay.json()).toEqual(completed.json());
    expect(completed.json<Asset>()).toMatchObject({ id: session.asset.id, status: "uploaded" });
    expect(storage.completed).toHaveLength(1);

    const jobs = new PostgresAssetProcessingJobRepository(administration);
    const firstLease = await jobs.claimNext("synthetic-worker-1", 60);
    if (firstLease === undefined) {
      throw new Error("Expected the completed upload to enqueue a processing job.");
    }
    expect(firstLease.command).toMatchObject({ assetId: session.asset.id, attempt: 1 });
    expect(firstLease.command.source).toBeDefined();
    expect(
      await jobs.fail({
        errorCode: "synthetic-transient",
        jobId: firstLease.jobId,
        retryDelaySeconds: 0,
        workerId: "synthetic-worker-1",
      }),
    ).toBe("retryable");
    const secondLease = await jobs.claimNext("synthetic-worker-2", 60);
    if (secondLease === undefined) {
      throw new Error("Expected the retryable processing job to be leased again.");
    }
    expect(secondLease.command.attempt).toBe(2);

    const processingResult: AssetProcessingResult = {
      artifacts: [
        {
          byteSize: 12,
          key: `projects/${alphaProject.id}/assets/${session.asset.id}/preview/${"b".repeat(64)}.png`,
          kind: "preview",
          mimeType: "image/png",
          sha256: "b".repeat(64),
        },
      ],
      assetId: session.asset.id,
      detectedMimeType: "application/pdf",
      projectId: alphaProject.id,
      provenance: {
        executedAt: new Date().toISOString(),
        policyVersion: "c2-ingest-v1",
        tools: [{ name: "synthetic-inspector", version: "1.0.0" }],
      },
      status: "ready",
      technicalMetadata: { pageCount: 1 },
      verifiedSource: { byteSize: 42, sha256: sourceSha256 },
      version: "c2-ingest-v1",
    };
    await expect(
      jobs.complete({
        jobId: secondLease.jobId,
        result: {
          ...processingResult,
          artifacts: processingResult.artifacts.map((artifact) => ({
            ...artifact,
            key: `projects/${alphaProject.id}/assets/${session.asset.id}/preview/not-content-addressed.png`,
          })),
        },
        workerId: "synthetic-worker-2",
      }),
    ).rejects.toThrow(/content-addressed/u);
    await jobs.complete({
      jobId: secondLease.jobId,
      result: processingResult,
      workerId: "synthetic-worker-2",
    });
    await expect(
      jobs.complete({
        jobId: secondLease.jobId,
        result: processingResult,
        workerId: "synthetic-worker-2",
      }),
    ).resolves.toBeUndefined();

    const abortCreated = await server.inject(
      createSessionRequest(alphaToken, alphaProject.id, "c2-pg-abort-create-1"),
    );
    const abortSession = abortCreated.json<AssetUploadSession>();
    const abortRequest = {
      headers: authorization(alphaToken, "c2-pg-abort-session-1"),
      method: "DELETE" as const,
      url: `/v1/projects/${alphaProject.id}/assets/upload-sessions/${abortSession.sessionId}`,
    };
    const aborted = await server.inject(abortRequest);
    const abortedReplay = await server.inject(abortRequest);
    expect(aborted.statusCode).toBe(204);
    expect(abortedReplay.statusCode).toBe(204);
    expect(storage.aborted).toHaveLength(1);

    const ready = await server.inject({
      headers: authorization(viewerToken),
      method: "GET",
      url: `/v1/projects/${alphaProject.id}/assets/${session.asset.id}`,
    });
    expect(ready.json()).toMatchObject({ detectedMimeType: "application/pdf", status: "ready" });

    const preview = await server.inject({
      headers: authorization(viewerToken, "c2-pg-viewer-preview"),
      method: "POST",
      payload: { representation: "preview" },
      url: `/v1/projects/${alphaProject.id}/assets/${session.asset.id}/access`,
    });
    const previewReplay = await server.inject({
      headers: authorization(viewerToken, "c2-pg-viewer-preview"),
      method: "POST",
      payload: { representation: "preview" },
      url: `/v1/projects/${alphaProject.id}/assets/${session.asset.id}/access`,
    });
    const viewerOriginal = await server.inject({
      headers: authorization(viewerToken, "c2-pg-viewer-original"),
      method: "POST",
      payload: { representation: "original" },
      url: `/v1/projects/${alphaProject.id}/assets/${session.asset.id}/access`,
    });
    const ownerOriginal = await server.inject({
      headers: authorization(alphaToken, "c2-pg-owner-original"),
      method: "POST",
      payload: { representation: "original" },
      url: `/v1/projects/${alphaProject.id}/assets/${session.asset.id}/access`,
    });
    expect(preview.statusCode).toBe(200);
    expect(previewReplay.json()).toEqual(preview.json());
    expect(preview.json()).toMatchObject({ contentDisposition: "inline" });
    expect(viewerOriginal.statusCode).toBe(403);
    expect(ownerOriginal.json()).toMatchObject({ contentDisposition: "attachment" });
    expect(storage.signedAccess).toHaveLength(2);

    await expect(
      administration`
        UPDATE assets
        SET source_object_key = 'sources/forbidden-replacement'
        WHERE tenant_id = ${alphaTenantId}::uuid
          AND project_id = ${alphaProject.id}::uuid
          AND id = ${session.asset.id}::uuid
      `,
    ).rejects.toThrow(/immutable/u);

    const internal = await administration<
      Array<{
        provider_upload_id: string;
        source_object_key: string;
      }>
    >`
      SELECT s.provider_upload_id, a.source_object_key
      FROM asset_upload_sessions s
      JOIN assets a
        ON a.tenant_id = s.tenant_id
       AND a.project_id = s.project_id
       AND a.id = s.asset_id
      WHERE s.tenant_id = ${alphaTenantId}::uuid
        AND s.project_id = ${alphaProject.id}::uuid
        AND s.id = ${session.sessionId}::uuid
    `;
    const locator = internal[0];
    if (locator === undefined) {
      throw new Error("Expected one internal storage locator row.");
    }
    expect(JSON.stringify([created.json(), resume.json(), ready.json()])).not.toContain(
      locator.provider_upload_id,
    );
    expect(JSON.stringify([created.json(), resume.json(), ready.json()])).not.toContain(
      locator.source_object_key,
    );
  });

  it("serializes complete versus abort so exactly one terminal mutation wins", async () => {
    await clearSyntheticData(administration);
    const storage = new FakeObjectStorage();
    const server = postgresServer(storage);
    const token = await signIn(server, "homeowner-alpha");
    const project = await createProject(
      server,
      token,
      "c2-pg-race-project-1",
      "C2 synthetic race home",
    );
    const created = await server.inject(
      createSessionRequest(token, project.id, "c2-pg-race-session-1"),
    );
    const session = created.json<AssetUploadSession>();
    await signOnlyPart(server, token, project.id, session.sessionId, "c2-pg-race-sign-001");

    const [complete, abort] = await Promise.all([
      server.inject(completionRequest(token, project.id, session.sessionId, "c2-pg-race-complete")),
      server.inject({
        headers: authorization(token, "c2-pg-race-abort-01"),
        method: "DELETE",
        url: `/v1/projects/${project.id}/assets/upload-sessions/${session.sessionId}`,
      }),
    ]);
    const statuses = [complete.statusCode, abort.statusCode];
    expect(statuses).toContain(409);
    expect(statuses.some((status) => status === 200 || status === 204)).toBe(true);
    expect(storage.completed.length + storage.aborted.length).toBe(1);
    const persisted = await server.inject({
      headers: authorization(token),
      method: "GET",
      url: `/v1/projects/${project.id}/assets/upload-sessions/${session.sessionId}`,
    });
    expect(["aborted", "completed"]).toContain(persisted.json<{ state: string }>().state);
  });
});
