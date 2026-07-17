import type {
  Actor,
  CreateCapturePackageRequest,
  CreateCaptureSessionRequest,
} from "@interior-design/contracts";
import { createHash, randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyC1Migration, bootstrapC1Fixtures, createC1Sql } from "../../src/c1.js";
import { applyC2Migration } from "../../src/c2.js";
import { applyC3Migration } from "../../src/c3.js";
import { applyC4Migration } from "../../src/c4.js";
import { applyC5Migration } from "../../src/c5.js";
import { applyC6Migration } from "../../src/c6.js";
import { applyC7Migration } from "../../src/c7.js";
import { ApiError } from "../../src/errors.js";
import { PostgresCaptureBackend } from "../../src/modules/capture/postgres.js";
import type { CaptureBackend } from "../../src/modules/capture/types.js";
import type {
  AbortMultipartUploadInput,
  AssetObjectStorage,
  CompleteMultipartUploadInput,
  CreateMultipartUploadInput,
  SignObjectAccessInput,
  SignUploadPartInput,
} from "../../src/storage/object-storage.js";
import { alphaTenantId } from "../c4/fixtures.js";
import { actors } from "../c6/support.js";

const databaseUrl = process.env.C7_TEST_DATABASE_URL ?? "";
const describeWithPostgres = databaseUrl.length === 0 ? describe.skip : describe;
function syntheticOwner(): Actor {
  const actor = actors["fixture|owner-alpha"];
  if (actor === undefined) throw new Error("The synthetic C7 owner fixture is missing.");
  return actor;
}

const owner = syntheticOwner();

const startedAt = "2026-07-17T12:00:00.000Z";
const now = new Date(Date.now() - 60_000);
const roomId = "88000000-0000-4000-8000-000000000001";
const sourceRoomIdentifier = "88000000-0000-4000-8000-000000000002";
const quality = {
  heuristicName: "c7-roomplan-quality" as const,
  heuristicVersion: "synthetic-1.0",
  instructionCounts: {
    "low-texture": 0,
    "move-away-from-wall": 0,
    "move-close-to-wall": 0,
    normal: 1,
    "slow-down": 0,
    "turn-on-light": 0,
  },
  interruptionCount: 0,
  lowConfidenceObjectCount: 0,
  lowConfidenceSurfaceCount: 0,
  relocalisationAttemptCount: 0,
  relocalisationSuccessCount: 0,
  scanDurationMilliseconds: 60_000,
  worldMappingStatusAtFinish: "mapped" as const,
};

class SyntheticMultipartStorage implements AssetObjectStorage {
  readonly aborted: AbortMultipartUploadInput[] = [];
  readonly completed: CompleteMultipartUploadInput[] = [];
  readonly created: CreateMultipartUploadInput[] = [];
  readonly signed: SignUploadPartInput[] = [];
  failAbort = false;

  createMultipartUpload(input: CreateMultipartUploadInput): Promise<string> {
    this.created.push(input);
    return Promise.resolve(`synthetic-provider-upload-${String(this.created.length)}`);
  }

  signUploadPart(input: SignUploadPartInput) {
    this.signed.push(input);
    return Promise.resolve({
      expiresAt: input.expiresAt.toISOString(),
      requiredHeaders: {
        "content-length": String(input.byteSize),
        "x-amz-checksum-sha256": input.checksumSha256,
      },
      url: `https://storage.invalid/synthetic-part-${String(input.partNumber)}`,
    });
  }

  completeMultipartUpload(input: CompleteMultipartUploadInput): Promise<void> {
    this.completed.push(input);
    return Promise.resolve();
  }

  abortMultipartUpload(input: AbortMultipartUploadInput): Promise<void> {
    this.aborted.push(input);
    return this.failAbort
      ? Promise.reject(new Error("Synthetic provider cleanup unavailable."))
      : Promise.resolve();
  }

  readiness(): Promise<void> {
    return Promise.resolve();
  }

  signObjectAccess(_input: SignObjectAccessInput) {
    void _input;
    return Promise.resolve({
      expiresAt: "2026-07-17T12:05:00.000Z",
      url: "https://storage.invalid/synthetic-object",
    });
  }
}

function correlation(label: string, digit: string) {
  return { requestId: label, traceId: digit.repeat(32) };
}

function sessionRequest(label: string): CreateCaptureSessionRequest {
  return {
    captureLabel: label,
    deviceCapability: "roomplan-lidar",
    expectedRoomCount: 1,
    mode: "single-room",
    rights: {
      basis: "owned-by-user",
      serviceProcessingConsent: true,
      trainingUseConsent: "denied",
    },
  };
}

function hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function base64(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("base64");
}

async function uploadArtifact(
  backend: CaptureBackend,
  projectId: string,
  captureSessionId: string,
  input: {
    readonly bytes: Uint8Array;
    readonly kind: "captured-room-json" | "quality-manifest-json" | "roomplan-normalized-json";
    readonly roomId?: string;
  },
) {
  const created = await backend.createArtifactUpload({
    actor: owner,
    captureSessionId,
    correlation: correlation(`create-${input.kind}`, "2"),
    idempotencyKey: `c7-live-create-${input.kind}-${randomUUID()}`,
    projectId,
    request: {
      byteSize: input.bytes.byteLength,
      contentType: "application/json",
      kind: input.kind,
      ...(input.roomId === undefined ? {} : { roomId: input.roomId }),
      sha256: hex(input.bytes),
    },
  });
  const checksumSha256 = base64(input.bytes);
  const declaration = {
    byteSize: input.bytes.byteLength,
    checksumSha256,
    partNumber: 1,
  };
  const [first, second] = await Promise.all([
    backend.signArtifactPart({
      actor: owner,
      captureSessionId,
      correlation: correlation(`sign-a-${input.kind}`, "3"),
      idempotencyKey: `c7-live-sign-a-${randomUUID()}`,
      projectId,
      request: declaration,
      uploadSessionId: created.value.uploadSessionId,
    }),
    backend.signArtifactPart({
      actor: owner,
      captureSessionId,
      correlation: correlation(`sign-b-${input.kind}`, "4"),
      idempotencyKey: `c7-live-sign-b-${randomUUID()}`,
      projectId,
      request: declaration,
      uploadSessionId: created.value.uploadSessionId,
    }),
  ]);
  expect(first.value.requiredHeaders["x-amz-checksum-sha256"]).toBe(checksumSha256);
  expect(second.value.requiredHeaders["x-amz-checksum-sha256"]).toBe(checksumSha256);
  await expect(
    backend.signArtifactPart({
      actor: owner,
      captureSessionId,
      correlation: correlation(`sign-substitute-${input.kind}`, "5"),
      idempotencyKey: `c7-live-sign-substitute-${randomUUID()}`,
      projectId,
      request: { ...declaration, checksumSha256: Buffer.alloc(32, 9).toString("base64") },
      uploadSessionId: created.value.uploadSessionId,
    }),
  ).rejects.toMatchObject({ code: "CAPTURE_PART_CONFLICT" });
  await backend.completeArtifactUpload({
    actor: owner,
    captureSessionId,
    correlation: correlation(`complete-${input.kind}`, "6"),
    idempotencyKey: `c7-live-complete-${input.kind}-${randomUUID()}`,
    projectId,
    request: {
      parts: [{ checksumSha256, etag: `synthetic-${input.kind}-etag`, partNumber: 1 }],
    },
    uploadSessionId: created.value.uploadSessionId,
  });
  return {
    artifactId: created.value.artifactId,
    byteSize: input.bytes.byteLength,
    contentType: "application/json" as const,
    kind: input.kind,
    ...(input.roomId === undefined ? {} : { roomId: input.roomId }),
    sha256: hex(input.bytes),
  };
}

describeWithPostgres("C7 live Postgres capture backend", () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = createC1Sql(databaseUrl);
    await applyC1Migration(sql);
    await bootstrapC1Fixtures(sql, "test");
    await applyC2Migration(sql);
    await applyC3Migration(sql);
    await applyC4Migration(sql);
    await applyC5Migration(sql);
    await applyC6Migration(sql);
    await applyC7Migration(sql);
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it("persists exact replay, checksum-bound uploads, package binding, tenant isolation, and immutable evidence", async () => {
    const projectId = randomUUID();
    await sql`
      INSERT INTO projects (id, tenant_id, name)
      VALUES (${projectId}::uuid, ${alphaTenantId}::uuid, 'Visibly synthetic C7 live project')
    `;
    const storage = new SyntheticMultipartStorage();
    const backend = new PostgresCaptureBackend(sql, storage, { clock: { now: () => now } });
    const createCommand = {
      actor: owner,
      correlation: correlation("c7-live-session-create", "1"),
      idempotencyKey: `c7-live-session-${randomUUID()}`,
      projectId,
      request: sessionRequest("Visibly synthetic live capture"),
    };
    const created = await backend.createSession(createCommand);
    const replayed = await backend.createSession({
      ...createCommand,
      correlation: correlation("c7-live-session-replay", "2"),
    });
    expect(replayed).toEqual({ replayed: true, value: created.value });
    await expect(
      backend.createSession({
        ...createCommand,
        correlation: correlation("c7-live-session-conflict", "3"),
        request: sessionRequest("Substituted synthetic capture"),
      }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(await backend.findSession(randomUUID(), projectId, created.value.id)).toBeUndefined();

    const capturedRoomBytes = Buffer.from('{"fixture":"synthetic-room"}', "utf8");
    const normalizedBytes = Buffer.from('{"fixture":"synthetic-normalized"}', "utf8");
    const qualityBytes = Buffer.from(JSON.stringify(quality), "utf8");
    const artifacts = await Promise.all([
      uploadArtifact(backend, projectId, created.value.id, {
        bytes: capturedRoomBytes,
        kind: "captured-room-json",
        roomId,
      }),
      uploadArtifact(backend, projectId, created.value.id, {
        bytes: normalizedBytes,
        kind: "roomplan-normalized-json",
      }),
      uploadArtifact(backend, projectId, created.value.id, {
        bytes: qualityBytes,
        kind: "quality-manifest-json",
      }),
    ]);
    const manifest: CreateCapturePackageRequest = {
      artifacts,
      captureSessionId: created.value.id,
      device: {
        appBuild: "synthetic.1",
        appVersion: "1.0-test",
        deviceModelIdentifier: "SyntheticDevice1,1",
        operatingSystemVersion: "synthetic-1.0",
        roomPlanSupported: true,
      },
      endedAt: "2026-07-17T12:01:00.000Z",
      mode: "single-room",
      projectId,
      quality,
      referenceMeasurements: [],
      rights: createCommand.request.rights,
      rooms: [
        {
          capturedRoomVersion: 1,
          roomId,
          sequence: 1,
          sourceRoomIdentifier,
          story: 0,
          userLabel: "Synthetic live room",
        },
      ],
      schemaVersion: "c7-capture-package-v1",
      sharedWorldOrigin: false,
      startedAt,
    };
    const finalizeCommand = {
      actor: owner,
      captureSessionId: created.value.id,
      correlation: correlation("c7-live-finalize", "7"),
      idempotencyKey: `c7-live-finalize-${randomUUID()}`,
      projectId,
      request: manifest,
    };
    const capturePackage = await backend.finalizePackage(finalizeCommand);
    expect((await backend.finalizePackage(finalizeCommand)).value).toEqual(capturePackage.value);
    expect(await backend.findSession(alphaTenantId, projectId, created.value.id)).toMatchObject({
      packageId: capturePackage.value.id,
      state: "uploaded",
    });
    expect(storage.created).toHaveLength(3);
    expect(storage.completed).toHaveLength(3);

    const counts = await sql<
      Array<{
        readonly artifact_count: number;
        readonly attempt_count: number;
        readonly package_count: number;
      }>
    >`
      SELECT
        (SELECT count(*)::int FROM capture_artifacts WHERE project_id = ${projectId}::uuid) AS artifact_count,
        (SELECT count(*)::int FROM capture_packages WHERE project_id = ${projectId}::uuid) AS package_count,
        (SELECT count(*)::int FROM capture_processing_attempts WHERE project_id = ${projectId}::uuid) AS attempt_count
    `;
    expect(counts[0]).toEqual({ artifact_count: 3, attempt_count: 1, package_count: 1 });
    await sql.begin(async (transaction) => {
      await transaction`
        UPDATE capture_processing_attempts
        SET state = 'failed', retryable = true,
            safe_code = 'CAPTURE_STORAGE_UNAVAILABLE',
            updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 microsecond'),
            version = version + 1
        WHERE tenant_id = ${alphaTenantId}::uuid AND project_id = ${projectId}::uuid
          AND capture_session_id = ${created.value.id}::uuid AND state = 'queued'
      `;
      await transaction`
        UPDATE capture_sessions
        SET state = 'failed', retryable = true,
            safe_code = 'CAPTURE_STORAGE_UNAVAILABLE',
            updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 microsecond'),
            version = version + 1
        WHERE tenant_id = ${alphaTenantId}::uuid AND project_id = ${projectId}::uuid
          AND id = ${created.value.id}::uuid AND state = 'uploaded'
      `;
    });
    const retryCommand = {
      actor: owner,
      captureSessionId: created.value.id,
      correlation: correlation("c7-live-retry", "8"),
      idempotencyKey: `c7-live-retry-${randomUUID()}`,
      projectId,
    };
    const retried = await backend.retrySession(retryCommand);
    expect(retried.value).toMatchObject({ retryable: false, state: "uploaded" });
    expect(await backend.retrySession(retryCommand)).toEqual({
      replayed: true,
      value: retried.value,
    });
    const attempts = await sql<Array<{ readonly attempt_number: number; readonly state: string }>>`
      SELECT attempt_number, state FROM capture_processing_attempts
      WHERE tenant_id = ${alphaTenantId}::uuid AND project_id = ${projectId}::uuid
        AND capture_session_id = ${created.value.id}::uuid
      ORDER BY attempt_number
    `;
    expect(attempts).toEqual([
      { attempt_number: 1, state: "failed" },
      { attempt_number: 2, state: "queued" },
    ]);
    await expect(
      sql`
        UPDATE capture_artifacts SET source_sha256 = ${"0".repeat(64)}
        WHERE tenant_id = ${alphaTenantId}::uuid AND project_id = ${projectId}::uuid
      `,
    ).rejects.toThrow(/source identity is immutable/u);
    await expect(
      sql`
        UPDATE capture_packages SET created_at = clock_timestamp()
        WHERE tenant_id = ${alphaTenantId}::uuid AND project_id = ${projectId}::uuid
      `,
    ).rejects.toThrow(/append-only/u);
    const audit = await sql<Array<{ readonly metadata: unknown }>>`
      SELECT metadata FROM capture_audit_events WHERE project_id = ${projectId}::uuid
    `;
    expect(JSON.stringify(audit)).not.toMatch(
      /providerUploadId|sourceObjectKey|signedUrl|credential/u,
    );
  });

  it("cancels or expires open work and makes rights withdrawal monotonic", async () => {
    const projectId = randomUUID();
    await sql`
      INSERT INTO projects (id, tenant_id, name)
      VALUES (${projectId}::uuid, ${alphaTenantId}::uuid, 'Synthetic C7 lifecycle project')
    `;
    const storage = new SyntheticMultipartStorage();
    const backend = new PostgresCaptureBackend(sql, storage, { clock: { now: () => now } });
    const rightsSession = await backend.createSession({
      actor: owner,
      correlation: correlation("c7-live-rights-session", "8"),
      idempotencyKey: `c7-live-rights-${randomUUID()}`,
      projectId,
      request: sessionRequest("Synthetic rights capture"),
    });
    await backend.createArtifactUpload({
      actor: owner,
      captureSessionId: rightsSession.value.id,
      correlation: correlation("c7-live-rights-upload", "9"),
      idempotencyKey: `c7-live-rights-upload-${randomUUID()}`,
      projectId,
      request: {
        byteSize: 1,
        contentType: "application/json",
        kind: "quality-manifest-json",
        sha256: "a".repeat(64),
      },
    });
    storage.failAbort = true;
    const withdrawn = await backend.withdrawRights({
      actorUserId: owner.userId,
      captureSessionId: rightsSession.value.id,
      correlation: correlation("c7-live-rights-withdraw", "a"),
      projectId,
      reasonCode: "RIGHTS_WITHDRAWN",
      tenantId: alphaTenantId,
    });
    expect(withdrawn?.state).toBe("cancelled");
    expect(storage.aborted).toHaveLength(1);
    expect(
      await backend.withdrawRights({
        actorUserId: owner.userId,
        captureSessionId: rightsSession.value.id,
        correlation: correlation("c7-live-rights-replay", "b"),
        projectId,
        reasonCode: "RIGHTS_WITHDRAWN",
        tenantId: alphaTenantId,
      }),
    ).toEqual(withdrawn);

    const expiring = await backend.createSession({
      actor: owner,
      correlation: correlation("c7-live-expiring", "c"),
      idempotencyKey: `c7-live-expiring-${randomUUID()}`,
      projectId,
      request: sessionRequest("Synthetic expiring capture"),
    });
    const later = new PostgresCaptureBackend(sql, storage, {
      clock: { now: () => new Date(now.getTime() + 25 * 60 * 60 * 1_000) },
    });
    expect(await later.expireOpenSessions()).toBeGreaterThanOrEqual(1);
    expect(await later.findSession(alphaTenantId, projectId, expiring.value.id)).toMatchObject({
      retryable: false,
      safeCode: "CAPTURE_BRIEF_EXPIRED",
      state: "failed",
    });
    await expect(later.expireOpenSessions(0)).rejects.toThrow(/between 1 and 500/u);
  });
});
