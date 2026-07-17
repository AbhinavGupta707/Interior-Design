import {
  c7CapturePolicy,
  captureArtifactUploadSessionSchema,
  captureBriefSchema,
  capturePackageSchema,
  captureProposalResultSchema,
  captureSessionSchema,
  createCapturePackageRequestSchema,
  signedCaptureArtifactPartSchema,
  type CaptureArtifactUploadSession,
  type CaptureBrief,
  type CaptureProposalResult,
  type CaptureSession,
} from "@interior-design/contracts";
import { randomUUID } from "node:crypto";
import type { JSONValue, Sql, TransactionSql } from "postgres";

import { notFound } from "../identity/http.js";
import {
  claimIdempotency,
  completeIdempotency,
  type IdempotencyClaim,
} from "../projects/idempotency.js";
import type { AssetObjectStorage } from "../../storage/object-storage.js";
import { captureSha256 } from "./canonical.js";
import { captureConflict, captureStorageUnavailable, captureUnprocessable } from "./errors.js";
import {
  reconcileCaptureCompletion,
  validateCapturePartDeclaration,
  type DeclaredCapturePart,
} from "./multipart.js";
import type {
  CaptureBackend,
  CaptureClock,
  CapturePackage,
  CaptureSessionMutationCommand,
  CaptureUuidFactory,
  CompleteArtifactUploadCommand,
  CreateArtifactUploadCommand,
  CreateCaptureSessionCommand,
  FinalizeCapturePackageCommand,
  MutationResult,
  SignArtifactPartCommand,
  SignedCaptureArtifactPart,
  WithdrawCaptureRightsCommand,
} from "./types.js";

const CAPTURE_BRIEF_TTL_MILLISECONDS = 24 * 60 * 60 * 1_000;
const SIGNED_PART_TTL_MILLISECONDS = 15 * 60 * 1_000;
const INSTRUCTIONS_VERSION = "c7-roomplan-instructions-1.0.0";
const MAXIMUM_ATTEMPTS = 3;

interface SessionRow {
  readonly brief_payload: unknown;
  readonly created_at: Date | string;
  readonly expires_at: Date | string;
  readonly id: string;
  readonly mode: string;
  readonly package_id: string | null;
  readonly project_id: string;
  readonly proposal_id: string | null;
  readonly retryable: boolean;
  readonly rights_permitted: boolean;
  readonly safe_code: string | null;
  readonly state: string;
  readonly updated_at: Date | string;
  readonly version: number;
}

interface UploadRow extends SessionRow {
  readonly artifact_id: string;
  readonly artifact_state: string;
  readonly content_type: string;
  readonly maximum_part_count: number;
  readonly minimum_non_final_part_size: number;
  readonly part_size: number;
  readonly provider_upload_id: string;
  readonly room_id: string | null;
  readonly session_expires_at: Date | string;
  readonly session_state: string;
  readonly source_byte_size: number | string;
  readonly source_object_key: string;
  readonly source_sha256: string;
  readonly upload_session_id: string;
}

interface PartRow {
  readonly byte_size: number;
  readonly checksum_sha256: string;
  readonly part_number: number;
  readonly provider_etag: string | null;
}

interface ArtifactRow {
  readonly content_type: string;
  readonly id: string;
  readonly kind: string;
  readonly room_id: string | null;
  readonly source_byte_size: number | string;
  readonly source_sha256: string;
  readonly state: string;
  readonly upload_state: string;
}

interface OpenUploadRow {
  readonly artifact_id: string;
  readonly provider_upload_id: string;
  readonly source_object_key: string;
  readonly upload_session_id: string;
}

function json(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function systemTraceId(): string {
  return randomUUID().replaceAll("-", "").slice(0, 32);
}

function publicSession(row: SessionRow): CaptureSession {
  const packageVisible = ["uploaded", "processing", "proposed", "abstained"].includes(row.state);
  return captureSessionSchema.parse({
    brief: captureBriefSchema.parse(row.brief_payload),
    createdAt: iso(row.created_at),
    id: row.id,
    ...(packageVisible && row.package_id !== null ? { packageId: row.package_id } : {}),
    projectId: row.project_id,
    ...(row.state === "proposed" && row.proposal_id !== null
      ? { proposalId: row.proposal_id }
      : {}),
    retryable: row.retryable,
    ...(row.safe_code === null ? {} : { safeCode: row.safe_code }),
    schemaVersion: "c7-capture-session-v1",
    state: row.state,
    updatedAt: iso(row.updated_at),
    version: row.version,
  });
}

function publicUpload(
  row: UploadRow,
  partNumbers: readonly number[],
): CaptureArtifactUploadSession {
  return captureArtifactUploadSessionSchema.parse({
    artifactId: row.artifact_id,
    captureSessionId: row.id,
    expiresAt: iso(row.session_expires_at),
    maximumPartCount: row.maximum_part_count,
    minimumNonFinalPartSize: row.minimum_non_final_part_size,
    partSize: row.part_size,
    recordedPartNumbers: partNumbers,
    state: row.session_state,
    uploadSessionId: row.upload_session_id,
  });
}

function captureClaim(
  command: {
    readonly actor: { readonly tenantId: string; readonly userId: string };
    readonly idempotencyKey: string;
  },
  operation: string,
  requestBody: unknown,
): IdempotencyClaim {
  return {
    actorUserId: command.actor.userId,
    idempotencyKey: command.idempotencyKey,
    operation,
    requestBody,
    tenantId: command.actor.tenantId,
  };
}

function assertCurrentRights(row: SessionRow): void {
  if (!row.rights_permitted) {
    throw captureConflict(
      "CAPTURE_RIGHTS_WITHDRAWN",
      "Service-processing rights for this capture are no longer permitted.",
    );
  }
}

function assertUnexpired(row: SessionRow, now: Date): void {
  if (new Date(row.expires_at).getTime() <= now.getTime()) {
    throw captureConflict("CAPTURE_BRIEF_EXPIRED", "The server-issued capture brief has expired.");
  }
}

function exactRights(left: CaptureBrief["rights"], right: CaptureBrief["rights"]): boolean {
  return left.basis === right.basis;
}

async function appendUserEvent(
  transaction: TransactionSql,
  input: {
    readonly action: string;
    readonly actorUserId: string;
    readonly captureSessionId: string;
    readonly metadata: object;
    readonly projectId: string;
    readonly requestId: string;
    readonly tenantId: string;
    readonly traceId: string;
  },
): Promise<void> {
  const occurredAt = new Date();
  await transaction`
    INSERT INTO capture_audit_events (
      id, tenant_id, project_id, capture_session_id, action, actor_user_id,
      request_id, trace_id, metadata, occurred_at
    ) VALUES (
      ${randomUUID()}::uuid, ${input.tenantId}::uuid, ${input.projectId}::uuid,
      ${input.captureSessionId}::uuid, ${input.action}, ${input.actorUserId}::uuid,
      ${input.requestId}, ${input.traceId}, ${transaction.json(json(input.metadata))}, ${occurredAt}
    )
  `;
}

async function appendSystemEvent(
  transaction: TransactionSql,
  input: {
    readonly action: string;
    readonly captureSessionId: string;
    readonly metadata: object;
    readonly projectId: string;
    readonly tenantId: string;
    readonly workerId: string;
  },
): Promise<void> {
  const occurredAt = new Date();
  await transaction`
    INSERT INTO capture_audit_events (
      id, tenant_id, project_id, capture_session_id, action, worker_id,
      request_id, trace_id, metadata, occurred_at
    ) VALUES (
      ${randomUUID()}::uuid, ${input.tenantId}::uuid, ${input.projectId}::uuid,
      ${input.captureSessionId}::uuid, ${input.action}, ${input.workerId},
      ${`worker:${input.workerId}`}, ${systemTraceId()},
      ${transaction.json(json(input.metadata))}, ${occurredAt}
    )
  `;
}

async function appendOutbox(
  transaction: TransactionSql,
  input: {
    readonly captureSessionId: string;
    readonly eventType: string;
    readonly payload: object;
    readonly projectId: string;
    readonly tenantId: string;
  },
): Promise<void> {
  await transaction`
    INSERT INTO capture_outbox (
      id, tenant_id, project_id, capture_session_id, event_type,
      schema_version, payload, occurred_at
    ) VALUES (
      ${randomUUID()}::uuid, ${input.tenantId}::uuid, ${input.projectId}::uuid,
      ${input.captureSessionId}::uuid, ${input.eventType}, 'c7-capture-session-v1',
      ${transaction.json(json(input.payload))}, clock_timestamp()
    )
  `;
}

export interface PostgresCaptureBackendOptions {
  readonly clock?: CaptureClock;
  readonly uuid?: CaptureUuidFactory;
}

export class PostgresCaptureBackend implements CaptureBackend {
  readonly #clock: CaptureClock;
  readonly #sql: Sql;
  readonly #storage: AssetObjectStorage;
  readonly #uuid: CaptureUuidFactory;

  constructor(sql: Sql, storage: AssetObjectStorage, options: PostgresCaptureBackendOptions = {}) {
    this.#sql = sql;
    this.#storage = storage;
    this.#clock = options.clock ?? { now: () => new Date() };
    this.#uuid = options.uuid ?? { create: () => randomUUID() };
  }

  async createSession(
    command: CreateCaptureSessionCommand,
  ): Promise<MutationResult<CaptureSession>> {
    return this.#sql.begin(async (transaction) => {
      const claim = captureClaim(
        command,
        `capture.session.create:${command.projectId}`,
        command.request,
      );
      const idempotency = await claimIdempotency(transaction, claim);
      if (idempotency.kind === "replay") {
        return { replayed: true, value: captureSessionSchema.parse(idempotency.body) };
      }
      const projects = await transaction<{ readonly id: string }[]>`
        SELECT id FROM projects
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND id = ${command.projectId}::uuid
        LIMIT 1 FOR SHARE
      `;
      if (projects.length !== 1) throw notFound();
      const now = this.#clock.now();
      const captureSessionId = this.#uuid.create();
      const brief = captureBriefSchema.parse({
        captureLabel: command.request.captureLabel,
        captureSessionId,
        expiresAt: new Date(now.getTime() + CAPTURE_BRIEF_TTL_MILLISECONDS).toISOString(),
        ...(command.request.expectedRoomCount === undefined
          ? {}
          : { expectedRoomCount: command.request.expectedRoomCount }),
        instructionsVersion: INSTRUCTIONS_VERSION,
        mode: command.request.mode,
        projectId: command.projectId,
        rights: command.request.rights,
        schemaVersion: "c7-capture-session-v1",
      });
      await transaction`
        INSERT INTO capture_sessions (
          tenant_id, project_id, id, mode, state, created_by, created_at, updated_at
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${command.projectId}::uuid,
          ${captureSessionId}::uuid, ${command.request.mode}, 'created',
          ${command.actor.userId}::uuid, ${now}, ${now}
        )
      `;
      await transaction`
        INSERT INTO capture_briefs (
          tenant_id, project_id, capture_session_id, schema_version, expires_at,
          instructions_version, brief_payload, created_at
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${command.projectId}::uuid,
          ${captureSessionId}::uuid, 'c7-capture-session-v1', ${new Date(brief.expiresAt)},
          ${brief.instructionsVersion}, ${transaction.json(json(brief))}, ${now}
        )
      `;
      await transaction`
        INSERT INTO capture_rights_events (
          id, tenant_id, project_id, capture_session_id, permitted, basis,
          service_processing_consent, training_use_consent, reason_code,
          actor_user_id, occurred_at
        ) VALUES (
          ${this.#uuid.create()}::uuid, ${command.actor.tenantId}::uuid,
          ${command.projectId}::uuid, ${captureSessionId}::uuid, true,
          ${brief.rights.basis}, true, 'denied', 'RIGHTS_ASSERTED',
          ${command.actor.userId}::uuid, ${now}
        )
      `;
      const session = captureSessionSchema.parse({
        brief,
        createdAt: now.toISOString(),
        id: captureSessionId,
        projectId: command.projectId,
        retryable: false,
        schemaVersion: "c7-capture-session-v1",
        state: "created",
        updatedAt: now.toISOString(),
        version: 1,
      });
      await appendUserEvent(transaction, {
        action: "capture.session.create",
        actorUserId: command.actor.userId,
        captureSessionId,
        metadata: { mode: brief.mode, state: "created" },
        projectId: command.projectId,
        requestId: command.correlation.requestId,
        tenantId: command.actor.tenantId,
        traceId: command.correlation.traceId,
      });
      await completeIdempotency(transaction, claim, 201, session);
      return { replayed: false, value: session };
    });
  }

  async listSessions(tenantId: string, projectId: string): Promise<readonly CaptureSession[]> {
    const rows = await this.#sql<SessionRow[]>`
      SELECT s.id, s.project_id, s.mode, s.state, s.package_id, s.proposal_id,
        s.retryable, s.safe_code, s.created_at, s.updated_at, s.version,
        b.expires_at, b.brief_payload,
        NOT EXISTS (
          SELECT 1 FROM capture_rights_events denied
          WHERE denied.tenant_id = s.tenant_id
            AND denied.project_id = s.project_id
            AND denied.capture_session_id = s.id
            AND NOT denied.permitted
        ) AS rights_permitted
      FROM capture_sessions s
      JOIN capture_briefs b
        ON b.tenant_id = s.tenant_id
       AND b.project_id = s.project_id
       AND b.capture_session_id = s.id
      WHERE s.tenant_id = ${tenantId}::uuid
        AND s.project_id = ${projectId}::uuid
      ORDER BY s.created_at ASC, s.id ASC
    `;
    return rows.map(publicSession);
  }

  async findSession(
    tenantId: string,
    projectId: string,
    captureSessionId: string,
  ): Promise<CaptureSession | undefined> {
    const rows = await this.#sql<SessionRow[]>`
      SELECT s.id, s.project_id, s.mode, s.state, s.package_id, s.proposal_id,
        s.retryable, s.safe_code, s.created_at, s.updated_at, s.version,
        b.expires_at, b.brief_payload,
        NOT EXISTS (
          SELECT 1 FROM capture_rights_events denied
          WHERE denied.tenant_id = s.tenant_id
            AND denied.project_id = s.project_id
            AND denied.capture_session_id = s.id
            AND NOT denied.permitted
        ) AS rights_permitted
      FROM capture_sessions s
      JOIN capture_briefs b
        ON b.tenant_id = s.tenant_id
       AND b.project_id = s.project_id
       AND b.capture_session_id = s.id
      WHERE s.tenant_id = ${tenantId}::uuid
        AND s.project_id = ${projectId}::uuid
        AND s.id = ${captureSessionId}::uuid
      LIMIT 1
    `;
    return rows[0] === undefined ? undefined : publicSession(rows[0]);
  }

  async createArtifactUpload(
    command: CreateArtifactUploadCommand,
  ): Promise<MutationResult<CaptureArtifactUploadSession>> {
    let createdProvider: { readonly key: string; readonly providerUploadId: string } | undefined;
    try {
      return await this.#sql.begin(async (transaction) => {
        const claim = captureClaim(
          command,
          `capture.artifact.create:${command.captureSessionId}`,
          command.request,
        );
        const idempotency = await claimIdempotency(transaction, claim);
        if (idempotency.kind === "replay") {
          return {
            replayed: true,
            value: captureArtifactUploadSessionSchema.parse(idempotency.body),
          };
        }
        const session = await this.#lockedSession(
          transaction,
          command.actor.tenantId,
          command.projectId,
          command.captureSessionId,
        );
        if (session === undefined) throw notFound();
        assertCurrentRights(session);
        assertUnexpired(session, this.#clock.now());
        if (session.state !== "created" && session.state !== "uploading") {
          throw captureConflict(
            "CAPTURE_UPLOAD_CLOSED",
            "Artifacts cannot be added after package finalization or cancellation.",
          );
        }
        const existingCount = await transaction<{ readonly count: number | string }[]>`
          SELECT count(*)::integer AS count FROM capture_artifacts
          WHERE tenant_id = ${command.actor.tenantId}::uuid
            AND project_id = ${command.projectId}::uuid
            AND capture_session_id = ${command.captureSessionId}::uuid
        `;
        if (Number(existingCount[0]?.count ?? 0) >= c7CapturePolicy.maximumArtifactCount) {
          throw captureConflict(
            "CAPTURE_ARTIFACT_LIMIT",
            "The capture session has reached its immutable artifact-count limit.",
          );
        }
        const artifactId = this.#uuid.create();
        const uploadSessionId = this.#uuid.create();
        const sourceObjectKey = `capture-sources/${this.#uuid.create()}`;
        let providerUploadId: string;
        try {
          providerUploadId = await this.#storage.createMultipartUpload({
            bucket: "source",
            contentType: command.request.contentType,
            key: sourceObjectKey,
          });
        } catch {
          throw captureStorageUnavailable();
        }
        createdProvider = { key: sourceObjectKey, providerUploadId };
        const now = this.#clock.now();
        const expiresAt = new Date(
          Math.min(
            new Date(session.expires_at).getTime(),
            now.getTime() + CAPTURE_BRIEF_TTL_MILLISECONDS,
          ),
        );
        await transaction`
          INSERT INTO capture_artifacts (
            tenant_id, project_id, capture_session_id, id, kind, content_type,
            room_id, source_byte_size, source_sha256, source_object_key, state, created_at
          ) VALUES (
            ${command.actor.tenantId}::uuid, ${command.projectId}::uuid,
            ${command.captureSessionId}::uuid, ${artifactId}::uuid,
            ${command.request.kind}, ${command.request.contentType},
            ${command.request.roomId ?? null}::uuid, ${command.request.byteSize},
            ${command.request.sha256}, ${sourceObjectKey}, 'pending', ${now}
          )
        `;
        await transaction`
          INSERT INTO capture_artifact_upload_sessions (
            tenant_id, project_id, capture_session_id, artifact_id, id,
            provider_upload_id, state, part_size, minimum_non_final_part_size,
            maximum_part_count, expires_at, created_at
          ) VALUES (
            ${command.actor.tenantId}::uuid, ${command.projectId}::uuid,
            ${command.captureSessionId}::uuid, ${artifactId}::uuid,
            ${uploadSessionId}::uuid, ${providerUploadId}, 'initiated',
            ${c7CapturePolicy.uploadPartSizeBytes}, 5242880,
            ${c7CapturePolicy.maximumUploadPartCount}, ${expiresAt}, ${now}
          )
        `;
        const upload = captureArtifactUploadSessionSchema.parse({
          artifactId,
          captureSessionId: command.captureSessionId,
          expiresAt: expiresAt.toISOString(),
          maximumPartCount: c7CapturePolicy.maximumUploadPartCount,
          minimumNonFinalPartSize: 5_242_880,
          partSize: c7CapturePolicy.uploadPartSizeBytes,
          recordedPartNumbers: [],
          state: "initiated",
          uploadSessionId,
        });
        await appendUserEvent(transaction, {
          action: "capture.artifact.create",
          actorUserId: command.actor.userId,
          captureSessionId: command.captureSessionId,
          metadata: {
            artifactId,
            byteSize: command.request.byteSize,
            kind: command.request.kind,
          },
          projectId: command.projectId,
          requestId: command.correlation.requestId,
          tenantId: command.actor.tenantId,
          traceId: command.correlation.traceId,
        });
        await completeIdempotency(transaction, claim, 201, upload);
        return { replayed: false, value: upload };
      });
    } catch (error: unknown) {
      if (createdProvider !== undefined) {
        await this.#storage
          .abortMultipartUpload({
            bucket: "source",
            key: createdProvider.key,
            providerUploadId: createdProvider.providerUploadId,
          })
          .catch(() => undefined);
      }
      throw error;
    }
  }

  async findArtifactUpload(
    tenantId: string,
    projectId: string,
    captureSessionId: string,
    uploadSessionId: string,
  ): Promise<CaptureArtifactUploadSession | undefined> {
    const rows = await this.#sql<UploadRow[]>`
      SELECT s.id, s.project_id, s.mode, s.state, s.package_id, s.proposal_id,
        s.retryable, s.safe_code, s.created_at, s.updated_at, s.version,
        b.expires_at, b.brief_payload,
        NOT EXISTS (
          SELECT 1 FROM capture_rights_events denied
          WHERE denied.tenant_id = s.tenant_id
            AND denied.project_id = s.project_id
            AND denied.capture_session_id = s.id
            AND NOT denied.permitted
        ) AS rights_permitted,
        a.id AS artifact_id, a.state AS artifact_state, a.content_type, a.room_id,
        a.source_byte_size, a.source_sha256, a.source_object_key,
        u.id AS upload_session_id, u.provider_upload_id, u.state AS session_state,
        u.part_size, u.minimum_non_final_part_size, u.maximum_part_count,
        u.expires_at AS session_expires_at
      FROM capture_artifact_upload_sessions u
      JOIN capture_artifacts a
        ON a.tenant_id = u.tenant_id
       AND a.project_id = u.project_id
       AND a.capture_session_id = u.capture_session_id
       AND a.id = u.artifact_id
      JOIN capture_sessions s
        ON s.tenant_id = u.tenant_id
       AND s.project_id = u.project_id
       AND s.id = u.capture_session_id
      JOIN capture_briefs b
        ON b.tenant_id = s.tenant_id
       AND b.project_id = s.project_id
       AND b.capture_session_id = s.id
      WHERE u.tenant_id = ${tenantId}::uuid
        AND u.project_id = ${projectId}::uuid
        AND u.capture_session_id = ${captureSessionId}::uuid
        AND u.id = ${uploadSessionId}::uuid
      LIMIT 1
    `;
    const row = rows[0];
    if (row === undefined) return undefined;
    const parts = await this.#partNumbers(
      this.#sql,
      tenantId,
      projectId,
      captureSessionId,
      uploadSessionId,
    );
    return publicUpload(row, parts);
  }

  async signArtifactPart(
    command: SignArtifactPartCommand,
  ): Promise<MutationResult<SignedCaptureArtifactPart>> {
    return this.#sql.begin(async (transaction) => {
      const claim = captureClaim(
        command,
        `capture.artifact.sign:${command.uploadSessionId}`,
        command.request,
      );
      const idempotency = await claimIdempotency(transaction, claim);
      if (idempotency.kind === "replay") {
        return { replayed: true, value: signedCaptureArtifactPartSchema.parse(idempotency.body) };
      }
      const upload = await this.#lockedUpload(
        transaction,
        command.actor.tenantId,
        command.projectId,
        command.captureSessionId,
        command.uploadSessionId,
      );
      if (upload === undefined) throw notFound();
      this.#assertOpenUpload(upload);
      assertCurrentRights(upload);
      assertUnexpired(upload, this.#clock.now());
      validateCapturePartDeclaration(
        Number(upload.source_byte_size),
        command.request.partNumber,
        command.request.byteSize,
      );
      const existingRows = await transaction<PartRow[]>`
        SELECT part_number, byte_size, checksum_sha256, provider_etag
        FROM capture_artifact_upload_parts
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid
          AND capture_session_id = ${command.captureSessionId}::uuid
          AND upload_session_id = ${command.uploadSessionId}::uuid
          AND part_number = ${command.request.partNumber}
        FOR UPDATE
      `;
      const existing = existingRows[0];
      if (
        existing !== undefined &&
        (existing.byte_size !== command.request.byteSize ||
          existing.checksum_sha256 !== command.request.checksumSha256)
      ) {
        throw captureConflict(
          "CAPTURE_PART_CONFLICT",
          "This artifact part is already bound to different immutable bytes.",
        );
      }
      if (existing?.provider_etag !== null && existing?.provider_etag !== undefined) {
        throw captureConflict(
          "CAPTURE_PART_COMPLETED",
          "A completed artifact part cannot be signed again.",
        );
      }
      const now = this.#clock.now();
      const expiresAt = new Date(
        Math.min(
          now.getTime() + SIGNED_PART_TTL_MILLISECONDS,
          new Date(upload.session_expires_at).getTime(),
          new Date(upload.expires_at).getTime(),
        ),
      );
      if (expiresAt.getTime() <= now.getTime()) {
        throw captureConflict("CAPTURE_UPLOAD_EXPIRED", "The artifact upload has expired.");
      }
      let signed;
      try {
        signed = await this.#storage.signUploadPart({
          bucket: "source",
          byteSize: command.request.byteSize,
          checksumSha256: command.request.checksumSha256,
          expiresAt,
          key: upload.source_object_key,
          partNumber: command.request.partNumber,
          providerUploadId: upload.provider_upload_id,
        });
      } catch {
        throw captureStorageUnavailable();
      }
      const result = signedCaptureArtifactPartSchema.parse({
        ...signed,
        partNumber: command.request.partNumber,
      });
      if (existing === undefined) {
        await transaction`
          INSERT INTO capture_artifact_upload_parts (
            tenant_id, project_id, capture_session_id, artifact_id, upload_session_id,
            part_number, byte_size, checksum_sha256, signed_at
          ) VALUES (
            ${command.actor.tenantId}::uuid, ${command.projectId}::uuid,
            ${command.captureSessionId}::uuid, ${upload.artifact_id}::uuid,
            ${command.uploadSessionId}::uuid, ${command.request.partNumber},
            ${command.request.byteSize}, ${command.request.checksumSha256}, ${now}
          )
        `;
      }
      if (upload.session_state === "initiated") {
        await transaction`
          UPDATE capture_artifact_upload_sessions
          SET state = 'uploading'
          WHERE tenant_id = ${command.actor.tenantId}::uuid
            AND project_id = ${command.projectId}::uuid
            AND capture_session_id = ${command.captureSessionId}::uuid
            AND id = ${command.uploadSessionId}::uuid
            AND state = 'initiated'
        `;
      }
      if (upload.state === "created") {
        await transaction`
          UPDATE capture_sessions
          SET state = 'uploading', updated_at = clock_timestamp(), version = version + 1
          WHERE tenant_id = ${command.actor.tenantId}::uuid
            AND project_id = ${command.projectId}::uuid
            AND id = ${command.captureSessionId}::uuid
            AND state = 'created'
        `;
      }
      await appendUserEvent(transaction, {
        action: "capture.artifact.part-sign",
        actorUserId: command.actor.userId,
        captureSessionId: command.captureSessionId,
        metadata: {
          artifactId: upload.artifact_id,
          byteSize: command.request.byteSize,
          partNumber: command.request.partNumber,
        },
        projectId: command.projectId,
        requestId: command.correlation.requestId,
        tenantId: command.actor.tenantId,
        traceId: command.correlation.traceId,
      });
      await completeIdempotency(transaction, claim, 200, result);
      return { replayed: false, value: result };
    });
  }

  async completeArtifactUpload(
    command: CompleteArtifactUploadCommand,
  ): Promise<MutationResult<CaptureArtifactUploadSession>> {
    return this.#sql.begin(async (transaction) => {
      const claim = captureClaim(
        command,
        `capture.artifact.complete:${command.uploadSessionId}`,
        command.request,
      );
      const idempotency = await claimIdempotency(transaction, claim);
      if (idempotency.kind === "replay") {
        return {
          replayed: true,
          value: captureArtifactUploadSessionSchema.parse(idempotency.body),
        };
      }
      const upload = await this.#lockedUpload(
        transaction,
        command.actor.tenantId,
        command.projectId,
        command.captureSessionId,
        command.uploadSessionId,
      );
      if (upload === undefined) throw notFound();
      assertCurrentRights(upload);
      assertUnexpired(upload, this.#clock.now());
      const partRows = await transaction<PartRow[]>`
        SELECT part_number, byte_size, checksum_sha256, provider_etag
        FROM capture_artifact_upload_parts
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid
          AND capture_session_id = ${command.captureSessionId}::uuid
          AND upload_session_id = ${command.uploadSessionId}::uuid
        ORDER BY part_number ASC
        FOR UPDATE
      `;
      const declared: DeclaredCapturePart[] = partRows.map((part) => ({
        byteSize: part.byte_size,
        checksumSha256: part.checksum_sha256,
        ...(part.provider_etag === null ? {} : { etag: part.provider_etag }),
        partNumber: part.part_number,
      }));
      const completed = reconcileCaptureCompletion(
        Number(upload.source_byte_size),
        declared,
        command.request,
      );
      if (upload.session_state !== "completed") {
        this.#assertOpenUpload(upload);
        try {
          await this.#storage.completeMultipartUpload({
            bucket: "source",
            expectedByteSize: Number(upload.source_byte_size),
            key: upload.source_object_key,
            parts: completed,
            providerUploadId: upload.provider_upload_id,
          });
        } catch {
          throw captureStorageUnavailable();
        }
        for (const part of completed) {
          await transaction`
            UPDATE capture_artifact_upload_parts
            SET provider_etag = ${part.etag}, completed_at = clock_timestamp()
            WHERE tenant_id = ${command.actor.tenantId}::uuid
              AND project_id = ${command.projectId}::uuid
              AND capture_session_id = ${command.captureSessionId}::uuid
              AND upload_session_id = ${command.uploadSessionId}::uuid
              AND part_number = ${part.partNumber}
              AND provider_etag IS NULL
          `;
        }
        await transaction`
          UPDATE capture_artifact_upload_sessions
          SET state = 'completed', completed_at = clock_timestamp()
          WHERE tenant_id = ${command.actor.tenantId}::uuid
            AND project_id = ${command.projectId}::uuid
            AND capture_session_id = ${command.captureSessionId}::uuid
            AND id = ${command.uploadSessionId}::uuid
            AND state IN ('initiated', 'uploading')
        `;
        await transaction`
          UPDATE capture_artifacts
          SET state = 'uploaded', uploaded_at = clock_timestamp()
          WHERE tenant_id = ${command.actor.tenantId}::uuid
            AND project_id = ${command.projectId}::uuid
            AND capture_session_id = ${command.captureSessionId}::uuid
            AND id = ${upload.artifact_id}::uuid
            AND state = 'pending'
        `;
      }
      const result = captureArtifactUploadSessionSchema.parse({
        artifactId: upload.artifact_id,
        captureSessionId: command.captureSessionId,
        expiresAt: iso(upload.session_expires_at),
        maximumPartCount: upload.maximum_part_count,
        minimumNonFinalPartSize: upload.minimum_non_final_part_size,
        partSize: upload.part_size,
        recordedPartNumbers: completed.map(({ partNumber }) => partNumber),
        state: "completed",
        uploadSessionId: command.uploadSessionId,
      });
      await appendUserEvent(transaction, {
        action: "capture.artifact.complete",
        actorUserId: command.actor.userId,
        captureSessionId: command.captureSessionId,
        metadata: { artifactId: upload.artifact_id, partCount: completed.length },
        projectId: command.projectId,
        requestId: command.correlation.requestId,
        tenantId: command.actor.tenantId,
        traceId: command.correlation.traceId,
      });
      await completeIdempotency(transaction, claim, 200, result);
      return { replayed: false, value: result };
    });
  }

  async finalizePackage(
    command: FinalizeCapturePackageCommand,
  ): Promise<MutationResult<CapturePackage>> {
    const manifest = createCapturePackageRequestSchema.parse(command.request);
    return this.#sql.begin(async (transaction) => {
      const claim = captureClaim(
        command,
        `capture.package.finalize:${command.captureSessionId}`,
        manifest,
      );
      const idempotency = await claimIdempotency(transaction, claim);
      if (idempotency.kind === "replay") {
        return { replayed: true, value: capturePackageSchema.parse(idempotency.body) };
      }
      const session = await this.#lockedSession(
        transaction,
        command.actor.tenantId,
        command.projectId,
        command.captureSessionId,
      );
      if (session === undefined) throw notFound();
      assertCurrentRights(session);
      assertUnexpired(session, this.#clock.now());
      if (session.state !== "uploading") {
        throw captureConflict(
          "CAPTURE_PACKAGE_STATE_CONFLICT",
          "A capture package can be finalized only after all declared artifacts upload.",
        );
      }
      const brief = captureBriefSchema.parse(session.brief_payload);
      if (
        manifest.projectId !== command.projectId ||
        manifest.captureSessionId !== command.captureSessionId ||
        manifest.mode !== session.mode ||
        !exactRights(manifest.rights, brief.rights)
      ) {
        throw captureUnprocessable(
          "CAPTURE_PACKAGE_SCOPE_MISMATCH",
          "The package identity, mode, or rights do not match the server-issued brief.",
        );
      }
      const captureDuration = Date.parse(manifest.endedAt) - Date.parse(manifest.startedAt);
      if (
        captureDuration <= 0 ||
        captureDuration > c7CapturePolicy.maximumScanDurationMilliseconds
      ) {
        throw captureUnprocessable(
          "CAPTURE_INTERVAL_INVALID",
          "The capture interval must be strictly increasing and no longer than six hours.",
        );
      }
      const sequences = [...manifest.rooms.map(({ sequence }) => sequence)].sort((a, b) => a - b);
      if (!sequences.every((sequence, index) => sequence === index + 1)) {
        throw captureUnprocessable(
          "CAPTURE_ROOM_ORDER_INVALID",
          "Capture room sequence numbers must be unique and consecutive from one.",
        );
      }
      const artifactRows = await transaction<ArtifactRow[]>`
        SELECT a.id, a.kind, a.content_type, a.room_id, a.source_byte_size,
          a.source_sha256, a.state, u.state AS upload_state
        FROM capture_artifacts a
        JOIN capture_artifact_upload_sessions u
          ON u.tenant_id = a.tenant_id
         AND u.project_id = a.project_id
         AND u.capture_session_id = a.capture_session_id
         AND u.artifact_id = a.id
        WHERE a.tenant_id = ${command.actor.tenantId}::uuid
          AND a.project_id = ${command.projectId}::uuid
          AND a.capture_session_id = ${command.captureSessionId}::uuid
        ORDER BY a.id ASC
        FOR UPDATE OF a, u
      `;
      const storedById = new Map(artifactRows.map((row) => [row.id, row]));
      if (
        storedById.size !== manifest.artifacts.length ||
        artifactRows.length !== manifest.artifacts.length
      ) {
        throw captureUnprocessable(
          "CAPTURE_ARTIFACT_SET_MISMATCH",
          "The package must contain exactly the artifacts registered to this capture session.",
        );
      }
      for (const declared of manifest.artifacts) {
        const stored = storedById.get(declared.artifactId);
        if (
          stored === undefined ||
          stored.state !== "uploaded" ||
          stored.upload_state !== "completed" ||
          stored.kind !== declared.kind ||
          stored.content_type !== declared.contentType ||
          stored.room_id !== (declared.roomId ?? null) ||
          Number(stored.source_byte_size) !== declared.byteSize ||
          stored.source_sha256 !== declared.sha256
        ) {
          throw captureUnprocessable(
            "CAPTURE_ARTIFACT_BINDING_MISMATCH",
            "A package artifact does not match its completed immutable upload declaration.",
          );
        }
      }
      const totalSourceBytes = manifest.artifacts.reduce(
        (total, artifact) => total + artifact.byteSize,
        0,
      );
      const packageId = this.#uuid.create();
      const attemptId = this.#uuid.create();
      const manifestSha256 = captureSha256(manifest);
      const now = this.#clock.now();
      await transaction`
        INSERT INTO capture_packages (
          tenant_id, project_id, capture_session_id, id, schema_version,
          manifest_sha256, manifest_payload, total_source_bytes, artifact_count,
          created_by, created_at
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${command.projectId}::uuid,
          ${command.captureSessionId}::uuid, ${packageId}::uuid,
          'c7-capture-package-v1', ${manifestSha256},
          ${transaction.json(json(manifest))}, ${totalSourceBytes},
          ${manifest.artifacts.length}, ${command.actor.userId}::uuid, ${now}
        )
      `;
      await transaction`
        INSERT INTO capture_processing_attempts (
          tenant_id, project_id, capture_session_id, package_id, id,
          attempt_number, state, available_at, created_at, updated_at
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${command.projectId}::uuid,
          ${command.captureSessionId}::uuid, ${packageId}::uuid, ${attemptId}::uuid,
          1, 'queued', ${now}, ${now}, ${now}
        )
      `;
      await transaction`
        UPDATE capture_sessions
        SET state = 'uploaded', package_id = ${packageId}::uuid,
            retryable = false, safe_code = NULL,
            updated_at = clock_timestamp(), version = version + 1
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid
          AND id = ${command.captureSessionId}::uuid
          AND state = 'uploading'
      `;
      const capturePackage = capturePackageSchema.parse({
        createdAt: now.toISOString(),
        id: packageId,
        manifest,
        manifestSha256,
        projectId: command.projectId,
        schemaVersion: "c7-capture-package-v1",
      });
      await appendUserEvent(transaction, {
        action: "capture.package.finalize",
        actorUserId: command.actor.userId,
        captureSessionId: command.captureSessionId,
        metadata: {
          artifactCount: manifest.artifacts.length,
          attempt: 1,
          packageId,
          totalSourceBytes,
        },
        projectId: command.projectId,
        requestId: command.correlation.requestId,
        tenantId: command.actor.tenantId,
        traceId: command.correlation.traceId,
      });
      await appendOutbox(transaction, {
        captureSessionId: command.captureSessionId,
        eventType: "capture.package.ready",
        payload: { attempt: 1, packageId, state: "uploaded" },
        projectId: command.projectId,
        tenantId: command.actor.tenantId,
      });
      await completeIdempotency(transaction, claim, 201, capturePackage);
      return { replayed: false, value: capturePackage };
    });
  }

  async findProposal(
    tenantId: string,
    projectId: string,
    captureSessionId: string,
  ): Promise<CaptureProposalResult | undefined> {
    const rows = await this.#sql<Array<{ readonly result_payload: unknown }>>`
      SELECT result_payload FROM capture_results
      WHERE tenant_id = ${tenantId}::uuid
        AND project_id = ${projectId}::uuid
        AND capture_session_id = ${captureSessionId}::uuid
      LIMIT 1
    `;
    return rows[0] === undefined
      ? undefined
      : captureProposalResultSchema.parse(rows[0].result_payload);
  }

  async cancelSession(
    command: CaptureSessionMutationCommand,
  ): Promise<MutationResult<CaptureSession>> {
    return this.#sql.begin(async (transaction) => {
      const claim = captureClaim(command, `capture.session.cancel:${command.captureSessionId}`, {});
      const idempotency = await claimIdempotency(transaction, claim);
      if (idempotency.kind === "replay") {
        return { replayed: true, value: captureSessionSchema.parse(idempotency.body) };
      }
      const session = await this.#lockedSession(
        transaction,
        command.actor.tenantId,
        command.projectId,
        command.captureSessionId,
      );
      if (session === undefined) throw notFound();
      if (session.state === "cancelled") {
        const current = publicSession(session);
        await completeIdempotency(transaction, claim, 200, current);
        return { replayed: false, value: current };
      }
      if (session.state === "proposed" || session.state === "abstained") {
        throw captureConflict(
          "CAPTURE_RESULT_IMMUTABLE",
          "A terminal capture result cannot be cancelled or replaced.",
        );
      }
      const processing = session.state === "processing" || session.state === "cancel-requested";
      if (processing) {
        if (session.state === "processing") {
          await transaction`
            UPDATE capture_sessions
            SET state = 'cancel-requested', retryable = false, safe_code = NULL,
                updated_at = clock_timestamp(), version = version + 1
            WHERE tenant_id = ${command.actor.tenantId}::uuid
              AND project_id = ${command.projectId}::uuid
              AND id = ${command.captureSessionId}::uuid
              AND state = 'processing'
          `;
          await transaction`
            UPDATE capture_processing_attempts
            SET state = 'cancel-requested', updated_at = clock_timestamp(), version = version + 1
            WHERE tenant_id = ${command.actor.tenantId}::uuid
              AND project_id = ${command.projectId}::uuid
              AND capture_session_id = ${command.captureSessionId}::uuid
              AND state = 'leased'
          `;
        }
      } else {
        await this.#abortOpenUploads(
          transaction,
          command.actor.tenantId,
          command.projectId,
          command.captureSessionId,
        );
        await transaction`
          UPDATE capture_processing_attempts
          SET state = 'cancelled', updated_at = clock_timestamp(), version = version + 1
          WHERE tenant_id = ${command.actor.tenantId}::uuid
            AND project_id = ${command.projectId}::uuid
            AND capture_session_id = ${command.captureSessionId}::uuid
            AND state = 'queued'
        `;
        await transaction`
          UPDATE capture_sessions
          SET state = 'cancelled', retryable = false, safe_code = NULL,
              updated_at = clock_timestamp(), version = version + 1
          WHERE tenant_id = ${command.actor.tenantId}::uuid
            AND project_id = ${command.projectId}::uuid
            AND id = ${command.captureSessionId}::uuid
            AND state IN ('created', 'uploading', 'uploaded', 'failed')
        `;
      }
      await appendUserEvent(transaction, {
        action: processing ? "capture.session.cancel-request" : "capture.session.cancel",
        actorUserId: command.actor.userId,
        captureSessionId: command.captureSessionId,
        metadata: { state: processing ? "cancel-requested" : "cancelled" },
        projectId: command.projectId,
        requestId: command.correlation.requestId,
        tenantId: command.actor.tenantId,
        traceId: command.correlation.traceId,
      });
      const updated = await this.#sessionInTransaction(
        transaction,
        command.actor.tenantId,
        command.projectId,
        command.captureSessionId,
      );
      if (updated === undefined) throw new Error("Cancelled capture session disappeared.");
      const result = publicSession(updated);
      await completeIdempotency(transaction, claim, 200, result);
      return { replayed: false, value: result };
    });
  }

  async retrySession(
    command: CaptureSessionMutationCommand,
  ): Promise<MutationResult<CaptureSession>> {
    return this.#sql.begin(async (transaction) => {
      const claim = captureClaim(command, `capture.session.retry:${command.captureSessionId}`, {});
      const idempotency = await claimIdempotency(transaction, claim);
      if (idempotency.kind === "replay") {
        return { replayed: true, value: captureSessionSchema.parse(idempotency.body) };
      }
      const session = await this.#lockedSession(
        transaction,
        command.actor.tenantId,
        command.projectId,
        command.captureSessionId,
      );
      if (session === undefined) throw notFound();
      assertCurrentRights(session);
      assertUnexpired(session, this.#clock.now());
      if (session.state !== "failed" || !session.retryable || session.package_id === null) {
        throw captureConflict(
          "CAPTURE_NOT_RETRYABLE",
          "Only a retryable pre-publication processing failure can be retried.",
        );
      }
      const attempts = await transaction<Array<{ readonly attempt_number: number }>>`
        SELECT attempt_number FROM capture_processing_attempts
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid
          AND capture_session_id = ${command.captureSessionId}::uuid
        ORDER BY attempt_number DESC LIMIT 1 FOR UPDATE
      `;
      const nextAttempt = (attempts[0]?.attempt_number ?? 0) + 1;
      if (nextAttempt > MAXIMUM_ATTEMPTS) {
        throw captureConflict(
          "CAPTURE_ATTEMPT_LIMIT",
          "The capture processing attempt limit has been reached.",
        );
      }
      const now = this.#clock.now();
      await transaction`
        INSERT INTO capture_processing_attempts (
          tenant_id, project_id, capture_session_id, package_id, id,
          attempt_number, state, available_at, created_at, updated_at
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${command.projectId}::uuid,
          ${command.captureSessionId}::uuid, ${session.package_id}::uuid,
          ${this.#uuid.create()}::uuid, ${nextAttempt}, 'queued', ${now}, ${now}, ${now}
        )
      `;
      await transaction`
        UPDATE capture_sessions
        SET state = 'uploaded', retryable = false, safe_code = NULL,
            result_id = NULL, proposal_id = NULL,
            updated_at = clock_timestamp(), version = version + 1
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid
          AND id = ${command.captureSessionId}::uuid
          AND state = 'failed'
      `;
      await appendUserEvent(transaction, {
        action: "capture.session.retry",
        actorUserId: command.actor.userId,
        captureSessionId: command.captureSessionId,
        metadata: { attempt: nextAttempt, state: "uploaded" },
        projectId: command.projectId,
        requestId: command.correlation.requestId,
        tenantId: command.actor.tenantId,
        traceId: command.correlation.traceId,
      });
      await appendOutbox(transaction, {
        captureSessionId: command.captureSessionId,
        eventType: "capture.package.retry",
        payload: { attempt: nextAttempt, state: "uploaded" },
        projectId: command.projectId,
        tenantId: command.actor.tenantId,
      });
      const updated = await this.#sessionInTransaction(
        transaction,
        command.actor.tenantId,
        command.projectId,
        command.captureSessionId,
      );
      if (updated === undefined) throw new Error("Retried capture session disappeared.");
      const result = publicSession(updated);
      await completeIdempotency(transaction, claim, 200, result);
      return { replayed: false, value: result };
    });
  }

  async withdrawRights(command: WithdrawCaptureRightsCommand): Promise<CaptureSession | undefined> {
    return this.#sql.begin(async (transaction) => {
      const session = await this.#lockedSession(
        transaction,
        command.tenantId,
        command.projectId,
        command.captureSessionId,
      );
      if (session === undefined) return undefined;
      if (!session.rights_permitted) return publicSession(session);
      const brief = captureBriefSchema.parse(session.brief_payload);
      await transaction`
        INSERT INTO capture_rights_events (
          id, tenant_id, project_id, capture_session_id, permitted, basis,
          service_processing_consent, training_use_consent, reason_code,
          actor_user_id, occurred_at
        ) VALUES (
          ${this.#uuid.create()}::uuid, ${command.tenantId}::uuid,
          ${command.projectId}::uuid, ${command.captureSessionId}::uuid, false,
          ${brief.rights.basis}, false, 'denied', ${command.reasonCode},
          ${command.actorUserId ?? null}::uuid, ${this.#clock.now()}
        )
      `;
      if (session.state === "processing") {
        await transaction`
          UPDATE capture_sessions
          SET state = 'cancel-requested', retryable = false, safe_code = NULL,
              updated_at = clock_timestamp(), version = version + 1
          WHERE tenant_id = ${command.tenantId}::uuid
            AND project_id = ${command.projectId}::uuid
            AND id = ${command.captureSessionId}::uuid
            AND state = 'processing'
        `;
        await transaction`
          UPDATE capture_processing_attempts
          SET state = 'cancel-requested', updated_at = clock_timestamp(), version = version + 1
          WHERE tenant_id = ${command.tenantId}::uuid
            AND project_id = ${command.projectId}::uuid
            AND capture_session_id = ${command.captureSessionId}::uuid
            AND state = 'leased'
        `;
      } else if (
        !["proposed", "abstained", "cancelled", "cancel-requested"].includes(session.state)
      ) {
        await this.#abortOpenUploads(
          transaction,
          command.tenantId,
          command.projectId,
          command.captureSessionId,
        );
        await transaction`
          UPDATE capture_processing_attempts
          SET state = 'cancelled', updated_at = clock_timestamp(), version = version + 1
          WHERE tenant_id = ${command.tenantId}::uuid
            AND project_id = ${command.projectId}::uuid
            AND capture_session_id = ${command.captureSessionId}::uuid
            AND state = 'queued'
        `;
        await transaction`
          UPDATE capture_sessions
          SET state = 'cancelled', retryable = false, safe_code = NULL,
              updated_at = clock_timestamp(), version = version + 1
          WHERE tenant_id = ${command.tenantId}::uuid
            AND project_id = ${command.projectId}::uuid
            AND id = ${command.captureSessionId}::uuid
            AND state IN ('created', 'uploading', 'uploaded', 'failed')
        `;
      }
      const event = {
        action: "capture.rights.withdraw",
        captureSessionId: command.captureSessionId,
        metadata: { reasonCode: command.reasonCode },
        projectId: command.projectId,
        requestId: command.correlation.requestId,
        tenantId: command.tenantId,
        traceId: command.correlation.traceId,
      };
      if (command.actorUserId === undefined) {
        await appendSystemEvent(transaction, {
          action: event.action,
          captureSessionId: event.captureSessionId,
          metadata: event.metadata,
          projectId: event.projectId,
          tenantId: event.tenantId,
          workerId: "rights-system",
        });
      } else {
        await appendUserEvent(transaction, { ...event, actorUserId: command.actorUserId });
      }
      return publicSession(
        (await this.#sessionInTransaction(
          transaction,
          command.tenantId,
          command.projectId,
          command.captureSessionId,
        )) ?? session,
      );
    });
  }

  async expireOpenSessions(limit = 100): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("C7 expiry limit must be an integer between 1 and 500.");
    }
    return this.#sql.begin(async (transaction) => {
      const rows = await transaction<
        Array<{
          readonly id: string;
          readonly project_id: string;
          readonly state: string;
          readonly tenant_id: string;
        }>
      >`
        SELECT s.tenant_id, s.project_id, s.id, s.state
        FROM capture_sessions s
        JOIN capture_briefs b
          ON b.tenant_id = s.tenant_id
         AND b.project_id = s.project_id
         AND b.capture_session_id = s.id
        WHERE b.expires_at <= ${this.#clock.now()}
          AND s.state IN ('created', 'uploading', 'uploaded', 'processing')
        ORDER BY b.expires_at ASC, s.id ASC
        LIMIT ${limit}
        FOR UPDATE OF s SKIP LOCKED
      `;
      for (const row of rows) {
        if (row.state === "processing") {
          await transaction`
            UPDATE capture_sessions
            SET state = 'cancel-requested', retryable = false, safe_code = NULL,
                updated_at = clock_timestamp(), version = version + 1
            WHERE tenant_id = ${row.tenant_id}::uuid
              AND project_id = ${row.project_id}::uuid
              AND id = ${row.id}::uuid
              AND state = 'processing'
          `;
          await transaction`
            UPDATE capture_processing_attempts
            SET state = 'cancel-requested', updated_at = clock_timestamp(), version = version + 1
            WHERE tenant_id = ${row.tenant_id}::uuid
              AND project_id = ${row.project_id}::uuid
              AND capture_session_id = ${row.id}::uuid
              AND state = 'leased'
          `;
        } else {
          await this.#abortOpenUploads(transaction, row.tenant_id, row.project_id, row.id);
          await transaction`
            UPDATE capture_processing_attempts
            SET state = 'failed', retryable = false, safe_code = 'CAPTURE_BRIEF_EXPIRED',
                updated_at = clock_timestamp(), version = version + 1
            WHERE tenant_id = ${row.tenant_id}::uuid
              AND project_id = ${row.project_id}::uuid
              AND capture_session_id = ${row.id}::uuid
              AND state = 'queued'
          `;
          await transaction`
            UPDATE capture_sessions
            SET state = 'failed', retryable = false, safe_code = 'CAPTURE_BRIEF_EXPIRED',
                updated_at = clock_timestamp(), version = version + 1
            WHERE tenant_id = ${row.tenant_id}::uuid
              AND project_id = ${row.project_id}::uuid
              AND id = ${row.id}::uuid
              AND state IN ('created', 'uploading', 'uploaded')
          `;
        }
        await appendSystemEvent(transaction, {
          action: "capture.session.expire",
          captureSessionId: row.id,
          metadata: {
            safeCode: "CAPTURE_BRIEF_EXPIRED",
            state: row.state === "processing" ? "cancel-requested" : "failed",
          },
          projectId: row.project_id,
          tenantId: row.tenant_id,
          workerId: "capture-expiry",
        });
      }
      return rows.length;
    });
  }

  async #abortOpenUploads(
    transaction: TransactionSql,
    tenantId: string,
    projectId: string,
    captureSessionId: string,
  ): Promise<void> {
    const uploads = await transaction<OpenUploadRow[]>`
      SELECT u.id AS upload_session_id, u.artifact_id, u.provider_upload_id,
        a.source_object_key
      FROM capture_artifact_upload_sessions u
      JOIN capture_artifacts a
        ON a.tenant_id = u.tenant_id
       AND a.project_id = u.project_id
       AND a.capture_session_id = u.capture_session_id
       AND a.id = u.artifact_id
      WHERE u.tenant_id = ${tenantId}::uuid
        AND u.project_id = ${projectId}::uuid
        AND u.capture_session_id = ${captureSessionId}::uuid
        AND u.state IN ('initiated', 'uploading')
      ORDER BY u.id ASC
      FOR UPDATE OF u, a
    `;
    for (const upload of uploads) {
      try {
        await this.#storage.abortMultipartUpload({
          bucket: "source",
          key: upload.source_object_key,
          providerUploadId: upload.provider_upload_id,
        });
      } catch {
        // Rights withdrawal, expiry, and cancellation must remain fail-closed even when provider
        // cleanup is unavailable. The immutable provider upload ID remains retained for bucket
        // lifecycle cleanup, while the database fence below prevents further signing/finalization.
      }
      await transaction`
        UPDATE capture_artifact_upload_sessions
        SET state = 'aborted', aborted_at = clock_timestamp()
        WHERE tenant_id = ${tenantId}::uuid
          AND project_id = ${projectId}::uuid
          AND capture_session_id = ${captureSessionId}::uuid
          AND id = ${upload.upload_session_id}::uuid
          AND state IN ('initiated', 'uploading')
      `;
      await transaction`
        UPDATE capture_artifacts
        SET state = 'aborted'
        WHERE tenant_id = ${tenantId}::uuid
          AND project_id = ${projectId}::uuid
          AND capture_session_id = ${captureSessionId}::uuid
          AND id = ${upload.artifact_id}::uuid
          AND state = 'pending'
      `;
    }
  }

  async #partNumbers(
    sql: Sql | TransactionSql,
    tenantId: string,
    projectId: string,
    captureSessionId: string,
    uploadSessionId: string,
  ): Promise<readonly number[]> {
    const parts = await sql<Array<{ readonly part_number: number }>>`
      SELECT part_number FROM capture_artifact_upload_parts
      WHERE tenant_id = ${tenantId}::uuid
        AND project_id = ${projectId}::uuid
        AND capture_session_id = ${captureSessionId}::uuid
        AND upload_session_id = ${uploadSessionId}::uuid
      ORDER BY part_number ASC
    `;
    return parts.map(({ part_number }) => part_number);
  }

  async #lockedSession(
    transaction: TransactionSql,
    tenantId: string,
    projectId: string,
    captureSessionId: string,
  ): Promise<SessionRow | undefined> {
    const rows = await transaction<SessionRow[]>`
      SELECT s.id, s.project_id, s.mode, s.state, s.package_id, s.proposal_id,
        s.retryable, s.safe_code, s.created_at, s.updated_at, s.version,
        b.expires_at, b.brief_payload,
        NOT EXISTS (
          SELECT 1 FROM capture_rights_events denied
          WHERE denied.tenant_id = s.tenant_id
            AND denied.project_id = s.project_id
            AND denied.capture_session_id = s.id
            AND NOT denied.permitted
        ) AS rights_permitted
      FROM capture_sessions s
      JOIN capture_briefs b
        ON b.tenant_id = s.tenant_id
       AND b.project_id = s.project_id
       AND b.capture_session_id = s.id
      WHERE s.tenant_id = ${tenantId}::uuid
        AND s.project_id = ${projectId}::uuid
        AND s.id = ${captureSessionId}::uuid
      LIMIT 1 FOR UPDATE OF s
    `;
    return rows[0];
  }

  async #sessionInTransaction(
    transaction: TransactionSql,
    tenantId: string,
    projectId: string,
    captureSessionId: string,
  ): Promise<SessionRow | undefined> {
    const rows = await transaction<SessionRow[]>`
      SELECT s.id, s.project_id, s.mode, s.state, s.package_id, s.proposal_id,
        s.retryable, s.safe_code, s.created_at, s.updated_at, s.version,
        b.expires_at, b.brief_payload,
        NOT EXISTS (
          SELECT 1 FROM capture_rights_events denied
          WHERE denied.tenant_id = s.tenant_id
            AND denied.project_id = s.project_id
            AND denied.capture_session_id = s.id
            AND NOT denied.permitted
        ) AS rights_permitted
      FROM capture_sessions s
      JOIN capture_briefs b
        ON b.tenant_id = s.tenant_id
       AND b.project_id = s.project_id
       AND b.capture_session_id = s.id
      WHERE s.tenant_id = ${tenantId}::uuid
        AND s.project_id = ${projectId}::uuid
        AND s.id = ${captureSessionId}::uuid
      LIMIT 1
    `;
    return rows[0];
  }

  async #lockedUpload(
    transaction: TransactionSql,
    tenantId: string,
    projectId: string,
    captureSessionId: string,
    uploadSessionId: string,
  ): Promise<UploadRow | undefined> {
    const rows = await transaction<UploadRow[]>`
      SELECT s.id, s.project_id, s.mode, s.state, s.package_id, s.proposal_id,
        s.retryable, s.safe_code, s.created_at, s.updated_at, s.version,
        b.expires_at, b.brief_payload,
        NOT EXISTS (
          SELECT 1 FROM capture_rights_events denied
          WHERE denied.tenant_id = s.tenant_id
            AND denied.project_id = s.project_id
            AND denied.capture_session_id = s.id
            AND NOT denied.permitted
        ) AS rights_permitted,
        a.id AS artifact_id, a.state AS artifact_state, a.content_type, a.room_id,
        a.source_byte_size, a.source_sha256, a.source_object_key,
        u.id AS upload_session_id, u.provider_upload_id, u.state AS session_state,
        u.part_size, u.minimum_non_final_part_size, u.maximum_part_count,
        u.expires_at AS session_expires_at
      FROM capture_artifact_upload_sessions u
      JOIN capture_artifacts a
        ON a.tenant_id = u.tenant_id
       AND a.project_id = u.project_id
       AND a.capture_session_id = u.capture_session_id
       AND a.id = u.artifact_id
      JOIN capture_sessions s
        ON s.tenant_id = u.tenant_id
       AND s.project_id = u.project_id
       AND s.id = u.capture_session_id
      JOIN capture_briefs b
        ON b.tenant_id = s.tenant_id
       AND b.project_id = s.project_id
       AND b.capture_session_id = s.id
      WHERE u.tenant_id = ${tenantId}::uuid
        AND u.project_id = ${projectId}::uuid
        AND u.capture_session_id = ${captureSessionId}::uuid
        AND u.id = ${uploadSessionId}::uuid
      LIMIT 1 FOR UPDATE OF s, u, a
    `;
    return rows[0];
  }

  #assertOpenUpload(upload: UploadRow): void {
    if (new Date(upload.session_expires_at).getTime() <= this.#clock.now().getTime()) {
      throw captureConflict("CAPTURE_UPLOAD_EXPIRED", "The artifact upload has expired.");
    }
    if (upload.session_state !== "initiated" && upload.session_state !== "uploading") {
      throw captureConflict(
        "CAPTURE_UPLOAD_CLOSED",
        "The artifact upload is terminal and cannot be changed.",
      );
    }
    if (upload.state !== "created" && upload.state !== "uploading") {
      throw captureConflict(
        "CAPTURE_SESSION_CLOSED",
        "The capture session no longer accepts artifact mutations.",
      );
    }
  }
}
