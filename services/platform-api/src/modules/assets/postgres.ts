import {
  assetAccessResponseSchema,
  assetProcessingCommandSchema,
  assetSchema,
  assetUploadSessionSchema,
  c2IngestionPolicy,
  signedAssetUploadPartSchema,
  type Asset,
  type AssetUploadSession,
} from "@interior-design/contracts";
import { randomUUID } from "node:crypto";
import type { JSONValue, Sql, TransactionSql } from "postgres";

import type { RequestCorrelation } from "../../correlation.js";
import { ApiError } from "../../errors.js";
import type { AssetObjectStorage } from "../../storage/object-storage.js";
import { notFound } from "../identity/http.js";
import {
  claimIdempotency,
  completeIdempotency,
  type IdempotencyClaim,
} from "../projects/idempotency.js";
import {
  C2_PART_SIZE_BYTES,
  C2_UPLOAD_SESSION_TTL_MILLISECONDS,
  reconcileCompletion,
  validatePartRequest,
  type RecordedUploadPart,
} from "./lifecycle.js";
import type {
  AbortUploadCommand,
  AssetAccessResponse,
  AssetBackend,
  CompleteUploadCommand,
  CreateUploadSessionCommand,
  IssueAssetAccessCommand,
  ResumableAssetUploadSession,
  SignUploadPartCommand,
} from "./types.js";
import { resumableAssetUploadSessionSchema } from "./types.js";

interface AssetRow {
  readonly attribution: string | null;
  readonly basis: string;
  readonly created_at: Date | string;
  readonly declared_mime_type: string;
  readonly detected_mime_type: string | null;
  readonly file_name: string;
  readonly id: string;
  readonly kind: string;
  readonly licence_url: string | null;
  readonly project_id: string;
  readonly rejection_code: string | null;
  readonly service_processing_consent: boolean;
  readonly source_bucket: "source";
  readonly source_byte_size: number | string;
  readonly source_object_key: string;
  readonly source_sha256: string;
  readonly status: string;
  readonly training_use_consent: string;
  readonly updated_at: Date | string;
}

interface SessionRow extends AssetRow {
  readonly expires_at: Date | string;
  readonly maximum_part_count: number;
  readonly minimum_non_final_part_size: number;
  readonly part_size: number;
  readonly provider_upload_id: string;
  readonly session_id: string;
  readonly session_state: string;
}

interface PartRow {
  readonly byte_size: number;
  readonly checksum_sha256: string;
  readonly part_number: number;
  readonly provider_etag: string | null;
}

interface ArtifactRow {
  readonly bucket: "derived";
  readonly mime_type: string;
  readonly object_key: string;
}

interface ExpiredSessionRow {
  readonly asset_id: string;
  readonly project_id: string;
  readonly provider_upload_id: string;
  readonly session_id: string;
  readonly source_object_key: string;
  readonly tenant_id: string;
}

type AssetAuditResourceType = "asset" | "processing-job" | "upload-session";

function isoTimestamp(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function mapAsset(row: AssetRow): Asset {
  return assetSchema.parse({
    createdAt: isoTimestamp(row.created_at),
    declaredMimeType: row.declared_mime_type,
    detectedMimeType: row.detected_mime_type ?? undefined,
    fileName: row.file_name,
    id: row.id,
    kind: row.kind,
    projectId: row.project_id,
    rejectionCode: row.rejection_code ?? undefined,
    rights: {
      attribution: row.attribution ?? undefined,
      basis: row.basis,
      licenceUrl: row.licence_url ?? undefined,
      serviceProcessingConsent: row.service_processing_consent,
      trainingUseConsent: row.training_use_consent,
    },
    source: {
      byteSize: Number(row.source_byte_size),
      sha256: row.source_sha256,
    },
    status: row.status,
    updatedAt: isoTimestamp(row.updated_at),
  });
}

function mapSession(row: SessionRow, now: Date): AssetUploadSession {
  const storedState = row.session_state;
  const effectiveState =
    (storedState === "initiated" || storedState === "uploading") &&
    new Date(row.expires_at).getTime() <= now.getTime()
      ? "expired"
      : storedState;
  return assetUploadSessionSchema.parse({
    asset: mapAsset(row),
    expiresAt: isoTimestamp(row.expires_at),
    maximumPartCount: row.maximum_part_count,
    minimumNonFinalPartSize: row.minimum_non_final_part_size,
    partSize: row.part_size,
    recordedPartNumbers: [],
    sessionId: row.session_id,
    state: effectiveState,
  });
}

function jsonValue(value: object): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function uploadConflict(code: string, detail: string): ApiError {
  return new ApiError({ code, detail, statusCode: 409, title: "Upload Conflict" });
}

function storageUnavailable(): ApiError {
  return new ApiError({
    code: "OBJECT_STORAGE_UNAVAILABLE",
    detail: "Object storage is temporarily unavailable; retry safely.",
    statusCode: 503,
    title: "Object Storage Unavailable",
  });
}

function representationUnavailable(): ApiError {
  return new ApiError({
    code: "ASSET_REPRESENTATION_UNAVAILABLE",
    detail: "The requested safe asset representation is not available.",
    statusCode: 409,
    title: "Asset Representation Unavailable",
  });
}

async function insertUserAudit(
  transaction: TransactionSql,
  command: {
    readonly actor: { readonly tenantId: string; readonly userId: string };
    readonly correlation: RequestCorrelation;
    readonly projectId: string;
  },
  assetId: string,
  action: string,
  resourceType: AssetAuditResourceType,
  resourceId: string,
): Promise<void> {
  await transaction`
    INSERT INTO asset_audit_events (
      id,
      tenant_id,
      project_id,
      asset_id,
      actor_kind,
      actor_user_id,
      action,
      resource_type,
      resource_id,
      request_id,
      trace_id
    )
    VALUES (
      ${randomUUID()}::uuid,
      ${command.actor.tenantId}::uuid,
      ${command.projectId}::uuid,
      ${assetId}::uuid,
      'user',
      ${command.actor.userId}::uuid,
      ${action},
      ${resourceType},
      ${resourceId}::uuid,
      ${command.correlation.requestId},
      ${command.correlation.traceId}
    )
  `;
}

async function insertSystemAudit(
  transaction: TransactionSql,
  row: ExpiredSessionRow,
): Promise<void> {
  await transaction`
    INSERT INTO asset_audit_events (
      id,
      tenant_id,
      project_id,
      asset_id,
      actor_kind,
      actor_identifier,
      action,
      resource_type,
      resource_id
    )
    VALUES (
      ${randomUUID()}::uuid,
      ${row.tenant_id}::uuid,
      ${row.project_id}::uuid,
      ${row.asset_id}::uuid,
      'system',
      'c2-expiry-cleanup',
      'asset.upload.expire',
      'upload-session',
      ${row.session_id}::uuid
    )
  `;
}

// Postgres.js intentionally does not interpolate SQL identifiers/fragments. The repeated selects
// below keep every predicate visible and auditable instead of introducing an unsafe raw fragment.

export interface PostgresAssetBackendOptions {
  readonly now?: () => Date;
}

export class PostgresAssetBackend implements AssetBackend {
  readonly #now: () => Date;
  readonly #sql: Sql;
  readonly #storage: AssetObjectStorage;

  constructor(sql: Sql, storage: AssetObjectStorage, options: PostgresAssetBackendOptions = {}) {
    this.#sql = sql;
    this.#storage = storage;
    this.#now = options.now ?? (() => new Date());
  }

  async createUploadSession(command: CreateUploadSessionCommand): Promise<AssetUploadSession> {
    let createdProviderUpload:
      { readonly key: string; readonly providerUploadId: string } | undefined;
    try {
      return await this.#sql.begin(async (transaction) => {
        const claim: IdempotencyClaim = {
          actorUserId: command.actor.userId,
          idempotencyKey: command.idempotencyKey,
          operation: `asset.upload.create:${command.projectId}`,
          requestBody: command.request,
          tenantId: command.actor.tenantId,
        };
        const idempotency = await claimIdempotency(transaction, claim);
        if (idempotency.kind === "replay") {
          return assetUploadSessionSchema.parse(idempotency.body);
        }

        const projectRows = await transaction<{ readonly id: string }[]>`
          SELECT id
          FROM projects
          WHERE tenant_id = ${command.actor.tenantId}::uuid
            AND id = ${command.projectId}::uuid
          FOR SHARE
        `;
        if (projectRows.length !== 1) {
          throw notFound();
        }

        const assetId = randomUUID();
        const sessionId = randomUUID();
        const sourceObjectKey = `sources/${randomUUID()}`;
        let providerUploadId: string;
        try {
          providerUploadId = await this.#storage.createMultipartUpload({
            bucket: "source",
            contentType: command.request.declaredMimeType,
            key: sourceObjectKey,
          });
        } catch {
          throw storageUnavailable();
        }
        createdProviderUpload = { key: sourceObjectKey, providerUploadId };

        const inserted = await transaction<
          Array<{
            readonly created_at: Date | string;
            readonly updated_at: Date | string;
          }>
        >`
          INSERT INTO assets (
            id,
            tenant_id,
            project_id,
            kind,
            file_name,
            declared_mime_type,
            source_byte_size,
            source_sha256,
            source_bucket,
            source_object_key
          )
          VALUES (
            ${assetId}::uuid,
            ${command.actor.tenantId}::uuid,
            ${command.projectId}::uuid,
            ${command.request.kind},
            ${command.request.fileName},
            ${command.request.declaredMimeType},
            ${command.request.byteSize},
            ${command.request.sha256},
            'source',
            ${sourceObjectKey}
          )
          RETURNING created_at, updated_at
        `;
        const timestamps = inserted[0];
        if (timestamps === undefined) {
          throw new Error("Asset insert returned no row.");
        }

        await transaction`
          INSERT INTO asset_rights_assertions (
            tenant_id,
            project_id,
            asset_id,
            basis,
            attribution,
            licence_url,
            service_processing_consent,
            training_use_consent
          )
          VALUES (
            ${command.actor.tenantId}::uuid,
            ${command.projectId}::uuid,
            ${assetId}::uuid,
            ${command.request.rights.basis},
            ${command.request.rights.attribution ?? null},
            ${command.request.rights.licenceUrl ?? null},
            ${command.request.rights.serviceProcessingConsent},
            ${command.request.rights.trainingUseConsent}
          )
        `;

        const expiresAt = new Date(this.#now().getTime() + C2_UPLOAD_SESSION_TTL_MILLISECONDS);
        await transaction`
          INSERT INTO asset_upload_sessions (
            id,
            tenant_id,
            project_id,
            asset_id,
            provider_upload_id,
            part_size,
            expires_at
          )
          VALUES (
            ${sessionId}::uuid,
            ${command.actor.tenantId}::uuid,
            ${command.projectId}::uuid,
            ${assetId}::uuid,
            ${providerUploadId},
            ${C2_PART_SIZE_BYTES},
            ${expiresAt}
          )
        `;

        const asset = assetSchema.parse({
          createdAt: isoTimestamp(timestamps.created_at),
          declaredMimeType: command.request.declaredMimeType,
          fileName: command.request.fileName,
          id: assetId,
          kind: command.request.kind,
          projectId: command.projectId,
          rights: command.request.rights,
          source: { byteSize: command.request.byteSize, sha256: command.request.sha256 },
          status: "pending-upload",
          updatedAt: isoTimestamp(timestamps.updated_at),
        });
        const session = assetUploadSessionSchema.parse({
          asset,
          expiresAt: expiresAt.toISOString(),
          maximumPartCount: c2IngestionPolicy.maximumUploadParts,
          minimumNonFinalPartSize: c2IngestionPolicy.minimumNonFinalPartBytes,
          partSize: C2_PART_SIZE_BYTES,
          recordedPartNumbers: [],
          sessionId,
          state: "initiated",
        });
        await insertUserAudit(
          transaction,
          command,
          assetId,
          "asset.upload.create",
          "upload-session",
          sessionId,
        );
        await completeIdempotency(transaction, claim, 201, session);
        return session;
      });
    } catch (error: unknown) {
      if (createdProviderUpload !== undefined) {
        await this.#storage
          .abortMultipartUpload({
            bucket: "source",
            key: createdProviderUpload.key,
            providerUploadId: createdProviderUpload.providerUploadId,
          })
          .catch(() => undefined);
      }
      throw error;
    }
  }

  async findUploadSession(
    tenantId: string,
    projectId: string,
    sessionId: string,
  ): Promise<ResumableAssetUploadSession | undefined> {
    const rows = await this.#sql<SessionRow[]>`
      SELECT
        a.id,
        a.project_id,
        a.kind,
        a.file_name,
        a.declared_mime_type,
        a.detected_mime_type,
        a.source_byte_size,
        a.source_sha256,
        a.source_bucket,
        a.source_object_key,
        a.status,
        a.rejection_code,
        a.created_at,
        a.updated_at,
        r.basis,
        r.attribution,
        r.licence_url,
        r.service_processing_consent,
        r.training_use_consent,
        s.id AS session_id,
        s.provider_upload_id,
        s.state AS session_state,
        s.part_size,
        s.minimum_non_final_part_size,
        s.maximum_part_count,
        s.expires_at
      FROM asset_upload_sessions s
      JOIN assets a
        ON a.tenant_id = s.tenant_id
       AND a.project_id = s.project_id
       AND a.id = s.asset_id
      JOIN asset_rights_assertions r
        ON r.tenant_id = a.tenant_id
       AND r.project_id = a.project_id
       AND r.asset_id = a.id
      WHERE s.tenant_id = ${tenantId}::uuid
        AND s.project_id = ${projectId}::uuid
        AND s.id = ${sessionId}::uuid
      LIMIT 1
    `;
    const row = rows[0];
    if (row === undefined) {
      return undefined;
    }
    const parts = await this.#sql<Array<{ readonly part_number: number }>>`
      SELECT part_number
      FROM asset_upload_parts
      WHERE tenant_id = ${tenantId}::uuid
        AND project_id = ${projectId}::uuid
        AND session_id = ${sessionId}::uuid
      ORDER BY part_number ASC
    `;
    return resumableAssetUploadSessionSchema.parse({
      ...mapSession(row, this.#now()),
      recordedPartNumbers: parts.map((part) => part.part_number),
    });
  }

  async signUploadPart(command: SignUploadPartCommand) {
    return this.#sql.begin(async (transaction) => {
      const claim: IdempotencyClaim = {
        actorUserId: command.actor.userId,
        idempotencyKey: command.idempotencyKey,
        operation: `asset.upload.sign:${command.projectId}:${command.sessionId}`,
        requestBody: command.request,
        tenantId: command.actor.tenantId,
      };
      const idempotency = await claimIdempotency(transaction, claim);
      if (idempotency.kind === "replay") {
        return signedAssetUploadPartSchema.parse(idempotency.body);
      }

      const session = await this.#lockedSession(
        transaction,
        command.actor.tenantId,
        command.projectId,
        command.sessionId,
      );
      if (session === undefined) {
        throw notFound();
      }
      this.#requireOpenSession(session);
      validatePartRequest(Number(session.source_byte_size), session.part_size, command.request);

      const existingRows = await transaction<PartRow[]>`
        SELECT part_number, byte_size, checksum_sha256, provider_etag
        FROM asset_upload_parts
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid
          AND session_id = ${command.sessionId}::uuid
          AND part_number = ${command.request.partNumber}
        FOR UPDATE
      `;
      const existing = existingRows[0];
      if (
        existing !== undefined &&
        (existing.byte_size !== command.request.byteSize ||
          existing.checksum_sha256 !== command.request.checksumSha256)
      ) {
        throw uploadConflict(
          "UPLOAD_PART_CONFLICT",
          "This part number was already bound to different immutable content.",
        );
      }
      if (existing?.provider_etag !== null && existing?.provider_etag !== undefined) {
        throw uploadConflict(
          "UPLOAD_PART_COMPLETED",
          "A completed upload part cannot be signed again.",
        );
      }

      const expiresAt = new Date(
        this.#now().getTime() + c2IngestionPolicy.signedUploadPartTtlSeconds * 1_000,
      );
      let providerResult;
      try {
        providerResult = await this.#storage.signUploadPart({
          bucket: "source",
          byteSize: command.request.byteSize,
          checksumSha256: command.request.checksumSha256,
          expiresAt,
          key: session.source_object_key,
          partNumber: command.request.partNumber,
          providerUploadId: session.provider_upload_id,
        });
      } catch {
        throw storageUnavailable();
      }
      const result = signedAssetUploadPartSchema.parse({
        ...providerResult,
        partNumber: command.request.partNumber,
      });

      if (existing === undefined) {
        await transaction`
          INSERT INTO asset_upload_parts (
            tenant_id,
            project_id,
            asset_id,
            session_id,
            part_number,
            byte_size,
            checksum_sha256
          )
          VALUES (
            ${command.actor.tenantId}::uuid,
            ${command.projectId}::uuid,
            ${session.id}::uuid,
            ${command.sessionId}::uuid,
            ${command.request.partNumber},
            ${command.request.byteSize},
            ${command.request.checksumSha256}
          )
        `;
      }
      if (session.session_state === "initiated") {
        await transaction`
          UPDATE asset_upload_sessions
          SET state = 'uploading'
          WHERE tenant_id = ${command.actor.tenantId}::uuid
            AND project_id = ${command.projectId}::uuid
            AND id = ${command.sessionId}::uuid
            AND state = 'initiated'
        `;
        await transaction`
          UPDATE assets
          SET status = 'uploading'
          WHERE tenant_id = ${command.actor.tenantId}::uuid
            AND project_id = ${command.projectId}::uuid
            AND id = ${session.id}::uuid
            AND status = 'pending-upload'
        `;
      }
      await insertUserAudit(
        transaction,
        command,
        session.id,
        "asset.upload.part-sign",
        "upload-session",
        command.sessionId,
      );
      await completeIdempotency(transaction, claim, 200, result);
      return result;
    });
  }

  async completeUpload(command: CompleteUploadCommand): Promise<Asset> {
    return this.#sql.begin(async (transaction) => {
      const claim: IdempotencyClaim = {
        actorUserId: command.actor.userId,
        idempotencyKey: command.idempotencyKey,
        operation: `asset.upload.complete:${command.projectId}:${command.sessionId}`,
        requestBody: command.request,
        tenantId: command.actor.tenantId,
      };
      const idempotency = await claimIdempotency(transaction, claim);
      if (idempotency.kind === "replay") {
        return assetSchema.parse(idempotency.body);
      }

      const session = await this.#lockedSession(
        transaction,
        command.actor.tenantId,
        command.projectId,
        command.sessionId,
      );
      if (session === undefined) {
        throw notFound();
      }

      const partRows = await transaction<PartRow[]>`
        SELECT part_number, byte_size, checksum_sha256, provider_etag
        FROM asset_upload_parts
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid
          AND session_id = ${command.sessionId}::uuid
        ORDER BY part_number ASC
        FOR UPDATE
      `;
      const recordedParts: RecordedUploadPart[] = partRows.map((part) => ({
        byteSize: part.byte_size,
        checksumSha256: part.checksum_sha256,
        ...(part.provider_etag === null ? {} : { etag: part.provider_etag }),
        partNumber: part.part_number,
      }));
      const providerParts = reconcileCompletion(
        Number(session.source_byte_size),
        session.source_sha256,
        session.part_size,
        recordedParts,
        command.request,
      );

      if (session.session_state === "completed") {
        if (recordedParts.some((part, index) => part.etag !== command.request.parts[index]?.etag)) {
          throw uploadConflict(
            "UPLOAD_COMPLETION_CONFLICT",
            "The upload was already completed with different provider tokens.",
          );
        }
        const completed = mapAsset(session);
        await completeIdempotency(transaction, claim, 200, completed);
        return completed;
      }
      this.#requireOpenSession(session);

      try {
        await this.#storage.completeMultipartUpload({
          bucket: "source",
          expectedByteSize: Number(session.source_byte_size),
          key: session.source_object_key,
          parts: providerParts,
          providerUploadId: session.provider_upload_id,
        });
      } catch {
        throw storageUnavailable();
      }

      for (const part of providerParts) {
        await transaction`
          UPDATE asset_upload_parts
          SET provider_etag = ${part.etag},
              completed_at = clock_timestamp()
          WHERE tenant_id = ${command.actor.tenantId}::uuid
            AND project_id = ${command.projectId}::uuid
            AND session_id = ${command.sessionId}::uuid
            AND part_number = ${part.partNumber}
            AND provider_etag IS NULL
        `;
      }
      await transaction`
        UPDATE asset_upload_sessions
        SET state = 'completed',
            completed_at = clock_timestamp()
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid
          AND id = ${command.sessionId}::uuid
          AND state IN ('initiated', 'uploading')
      `;
      await transaction`
        UPDATE assets
        SET status = 'uploaded'
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid
          AND id = ${session.id}::uuid
          AND status = 'uploading'
      `;

      const processingCommand = assetProcessingCommandSchema.parse({
        assetId: session.id,
        attempt: 1,
        destinations: {
          derivedBucket: "derived",
          prefix: `projects/${command.projectId}/assets/${session.id}`,
          quarantineBucket: "quarantine",
        },
        expected: {
          byteSize: Number(session.source_byte_size),
          declaredMimeType: session.declared_mime_type,
          kind: session.kind,
          sha256: session.source_sha256,
        },
        projectId: command.projectId,
        source: { bucket: "source", key: session.source_object_key },
        version: "c2-ingest-v1",
      });
      const jobId = randomUUID();
      await transaction`
        INSERT INTO asset_processing_jobs (
          id,
          tenant_id,
          project_id,
          asset_id,
          command
        )
        VALUES (
          ${jobId}::uuid,
          ${command.actor.tenantId}::uuid,
          ${command.projectId}::uuid,
          ${session.id}::uuid,
          ${transaction.json(jsonValue(processingCommand))}
        )
      `;
      await insertUserAudit(
        transaction,
        command,
        session.id,
        "asset.upload.complete",
        "upload-session",
        command.sessionId,
      );
      const completed = await this.#assetInTransaction(
        transaction,
        command.actor.tenantId,
        command.projectId,
        session.id,
      );
      if (completed === undefined) {
        throw new Error("Completed asset disappeared from its transaction.");
      }
      await completeIdempotency(transaction, claim, 200, completed);
      return completed;
    });
  }

  async abortUpload(command: AbortUploadCommand): Promise<void> {
    await this.#sql.begin(async (transaction) => {
      const claim: IdempotencyClaim = {
        actorUserId: command.actor.userId,
        idempotencyKey: command.idempotencyKey,
        operation: `asset.upload.abort:${command.projectId}:${command.sessionId}`,
        requestBody: {},
        tenantId: command.actor.tenantId,
      };
      const idempotency = await claimIdempotency(transaction, claim);
      if (idempotency.kind === "replay") {
        return;
      }

      const session = await this.#lockedSession(
        transaction,
        command.actor.tenantId,
        command.projectId,
        command.sessionId,
      );
      if (session === undefined) {
        throw notFound();
      }
      if (session.session_state === "completed") {
        throw uploadConflict("UPLOAD_ALREADY_COMPLETED", "A completed upload cannot be aborted.");
      }
      if (session.session_state === "aborted" || session.session_state === "expired") {
        await completeIdempotency(transaction, claim, 204, { aborted: true });
        return;
      }

      try {
        await this.#storage.abortMultipartUpload({
          bucket: "source",
          key: session.source_object_key,
          providerUploadId: session.provider_upload_id,
        });
      } catch {
        throw storageUnavailable();
      }

      const expired = new Date(session.expires_at).getTime() <= this.#now().getTime();
      await transaction`
        UPDATE asset_upload_sessions
        SET state = ${expired ? "expired" : "aborted"},
            aborted_at = ${expired ? null : this.#now()},
            expired_at = ${expired ? this.#now() : null}
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid
          AND id = ${command.sessionId}::uuid
          AND state IN ('initiated', 'uploading')
      `;
      await transaction`
        UPDATE assets
        SET status = 'aborted'
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid
          AND id = ${session.id}::uuid
          AND status IN ('pending-upload', 'uploading')
      `;
      await insertUserAudit(
        transaction,
        command,
        session.id,
        expired ? "asset.upload.expire" : "asset.upload.abort",
        "upload-session",
        command.sessionId,
      );
      await completeIdempotency(transaction, claim, 204, { aborted: true });
    });
  }

  async listAssets(tenantId: string, projectId: string): Promise<readonly Asset[]> {
    const rows = await this.#sql<AssetRow[]>`
      SELECT
        a.id,
        a.project_id,
        a.kind,
        a.file_name,
        a.declared_mime_type,
        a.detected_mime_type,
        a.source_byte_size,
        a.source_sha256,
        a.source_bucket,
        a.source_object_key,
        a.status,
        a.rejection_code,
        a.created_at,
        a.updated_at,
        r.basis,
        r.attribution,
        r.licence_url,
        r.service_processing_consent,
        r.training_use_consent
      FROM assets a
      JOIN asset_rights_assertions r
        ON r.tenant_id = a.tenant_id
       AND r.project_id = a.project_id
       AND r.asset_id = a.id
      WHERE a.tenant_id = ${tenantId}::uuid
        AND a.project_id = ${projectId}::uuid
      ORDER BY a.created_at ASC, a.id ASC
    `;
    return rows.map(mapAsset);
  }

  async findAsset(
    tenantId: string,
    projectId: string,
    assetId: string,
  ): Promise<Asset | undefined> {
    const rows = await this.#sql<AssetRow[]>`
      SELECT
        a.id,
        a.project_id,
        a.kind,
        a.file_name,
        a.declared_mime_type,
        a.detected_mime_type,
        a.source_byte_size,
        a.source_sha256,
        a.source_bucket,
        a.source_object_key,
        a.status,
        a.rejection_code,
        a.created_at,
        a.updated_at,
        r.basis,
        r.attribution,
        r.licence_url,
        r.service_processing_consent,
        r.training_use_consent
      FROM assets a
      JOIN asset_rights_assertions r
        ON r.tenant_id = a.tenant_id
       AND r.project_id = a.project_id
       AND r.asset_id = a.id
      WHERE a.tenant_id = ${tenantId}::uuid
        AND a.project_id = ${projectId}::uuid
        AND a.id = ${assetId}::uuid
      LIMIT 1
    `;
    return rows[0] === undefined ? undefined : mapAsset(rows[0]);
  }

  async issueAccess(command: IssueAssetAccessCommand): Promise<AssetAccessResponse> {
    return this.#sql.begin(async (transaction) => {
      const claim: IdempotencyClaim = {
        actorUserId: command.actor.userId,
        idempotencyKey: command.idempotencyKey,
        operation: `asset.access:${command.projectId}:${command.assetId}`,
        requestBody: command.request,
        tenantId: command.actor.tenantId,
      };
      const idempotency = await claimIdempotency(transaction, claim);
      if (idempotency.kind === "replay") {
        return assetAccessResponseSchema.parse(idempotency.body);
      }

      const assetRows = await transaction<AssetRow[]>`
        SELECT
          a.id,
          a.project_id,
          a.kind,
          a.file_name,
          a.declared_mime_type,
          a.detected_mime_type,
          a.source_byte_size,
          a.source_sha256,
          a.source_bucket,
          a.source_object_key,
          a.status,
          a.rejection_code,
          a.created_at,
          a.updated_at,
          r.basis,
          r.attribution,
          r.licence_url,
          r.service_processing_consent,
          r.training_use_consent
        FROM assets a
        JOIN asset_rights_assertions r
          ON r.tenant_id = a.tenant_id
         AND r.project_id = a.project_id
         AND r.asset_id = a.id
        WHERE a.tenant_id = ${command.actor.tenantId}::uuid
          AND a.project_id = ${command.projectId}::uuid
          AND a.id = ${command.assetId}::uuid
        LIMIT 1
        FOR SHARE OF a
      `;
      const asset = assetRows[0];
      if (asset === undefined) {
        throw notFound();
      }
      if (asset.status !== "ready") {
        throw representationUnavailable();
      }

      let bucket: "derived" | "source";
      let contentDisposition: "attachment" | "inline";
      let contentType: string;
      let objectKey: string;
      if (command.request.representation === "original") {
        if (
          asset.declared_mime_type === "image/svg+xml" ||
          asset.detected_mime_type === "image/svg+xml"
        ) {
          throw representationUnavailable();
        }
        bucket = "source";
        contentDisposition = "attachment";
        contentType = asset.detected_mime_type ?? asset.declared_mime_type;
        objectKey = asset.source_object_key;
      } else {
        const artifactRows = await transaction<ArtifactRow[]>`
          SELECT bucket, object_key, mime_type
          FROM derived_asset_artifacts
          WHERE tenant_id = ${command.actor.tenantId}::uuid
            AND project_id = ${command.projectId}::uuid
            AND asset_id = ${command.assetId}::uuid
            AND kind = ${command.request.representation}
            AND bucket = 'derived'
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `;
        const artifact = artifactRows[0];
        if (artifact === undefined) {
          throw representationUnavailable();
        }
        if (
          !new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]).has(artifact.mime_type)
        ) {
          throw representationUnavailable();
        }
        bucket = artifact.bucket;
        contentDisposition = "inline";
        contentType = artifact.mime_type;
        objectKey = artifact.object_key;
      }

      const expiresAt = new Date(
        this.#now().getTime() + c2IngestionPolicy.signedAccessTtlSeconds * 1_000,
      );
      let signed;
      try {
        signed = await this.#storage.signObjectAccess({
          bucket,
          contentDisposition,
          contentType,
          expiresAt,
          key: objectKey,
        });
      } catch {
        throw storageUnavailable();
      }
      const response = assetAccessResponseSchema.parse({
        contentDisposition,
        expiresAt: signed.expiresAt,
        url: signed.url,
      });
      await insertUserAudit(
        transaction,
        command,
        command.assetId,
        command.request.representation === "original"
          ? "asset.access.original"
          : "asset.access.derived",
        "asset",
        command.assetId,
      );
      await completeIdempotency(transaction, claim, 200, response);
      return response;
    });
  }

  async cleanupExpiredSessions(limit = 100): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("C2 cleanup limit must be an integer between 1 and 500.");
    }
    return this.#sql.begin(async (transaction) => {
      const rows = await transaction<ExpiredSessionRow[]>`
        SELECT
          s.tenant_id,
          s.project_id,
          s.asset_id,
          s.id AS session_id,
          s.provider_upload_id,
          a.source_object_key
        FROM asset_upload_sessions s
        JOIN assets a
          ON a.tenant_id = s.tenant_id
         AND a.project_id = s.project_id
         AND a.id = s.asset_id
        WHERE s.state IN ('initiated', 'uploading')
          AND s.expires_at <= ${this.#now()}
        ORDER BY s.expires_at ASC, s.id ASC
        LIMIT ${limit}
        FOR UPDATE OF s SKIP LOCKED
      `;
      for (const row of rows) {
        try {
          await this.#storage.abortMultipartUpload({
            bucket: "source",
            key: row.source_object_key,
            providerUploadId: row.provider_upload_id,
          });
        } catch {
          throw storageUnavailable();
        }
        await transaction`
          UPDATE asset_upload_sessions
          SET state = 'expired',
              expired_at = clock_timestamp()
          WHERE tenant_id = ${row.tenant_id}::uuid
            AND project_id = ${row.project_id}::uuid
            AND id = ${row.session_id}::uuid
            AND state IN ('initiated', 'uploading')
        `;
        await transaction`
          UPDATE assets
          SET status = 'aborted'
          WHERE tenant_id = ${row.tenant_id}::uuid
            AND project_id = ${row.project_id}::uuid
            AND id = ${row.asset_id}::uuid
            AND status IN ('pending-upload', 'uploading')
        `;
        await insertSystemAudit(transaction, row);
      }
      return rows.length;
    });
  }

  async #lockedSession(
    transaction: TransactionSql,
    tenantId: string,
    projectId: string,
    sessionId: string,
  ): Promise<SessionRow | undefined> {
    const rows = await transaction<SessionRow[]>`
      SELECT
        a.id,
        a.project_id,
        a.kind,
        a.file_name,
        a.declared_mime_type,
        a.detected_mime_type,
        a.source_byte_size,
        a.source_sha256,
        a.source_bucket,
        a.source_object_key,
        a.status,
        a.rejection_code,
        a.created_at,
        a.updated_at,
        r.basis,
        r.attribution,
        r.licence_url,
        r.service_processing_consent,
        r.training_use_consent,
        s.id AS session_id,
        s.provider_upload_id,
        s.state AS session_state,
        s.part_size,
        s.minimum_non_final_part_size,
        s.maximum_part_count,
        s.expires_at
      FROM asset_upload_sessions s
      JOIN assets a
        ON a.tenant_id = s.tenant_id
       AND a.project_id = s.project_id
       AND a.id = s.asset_id
      JOIN asset_rights_assertions r
        ON r.tenant_id = a.tenant_id
       AND r.project_id = a.project_id
       AND r.asset_id = a.id
      WHERE s.tenant_id = ${tenantId}::uuid
        AND s.project_id = ${projectId}::uuid
        AND s.id = ${sessionId}::uuid
      LIMIT 1
      FOR UPDATE OF s, a
    `;
    return rows[0];
  }

  async #assetInTransaction(
    transaction: TransactionSql,
    tenantId: string,
    projectId: string,
    assetId: string,
  ): Promise<Asset | undefined> {
    const rows = await transaction<AssetRow[]>`
      SELECT
        a.id,
        a.project_id,
        a.kind,
        a.file_name,
        a.declared_mime_type,
        a.detected_mime_type,
        a.source_byte_size,
        a.source_sha256,
        a.source_bucket,
        a.source_object_key,
        a.status,
        a.rejection_code,
        a.created_at,
        a.updated_at,
        r.basis,
        r.attribution,
        r.licence_url,
        r.service_processing_consent,
        r.training_use_consent
      FROM assets a
      JOIN asset_rights_assertions r
        ON r.tenant_id = a.tenant_id
       AND r.project_id = a.project_id
       AND r.asset_id = a.id
      WHERE a.tenant_id = ${tenantId}::uuid
        AND a.project_id = ${projectId}::uuid
        AND a.id = ${assetId}::uuid
      LIMIT 1
    `;
    return rows[0] === undefined ? undefined : mapAsset(rows[0]);
  }

  #requireOpenSession(session: SessionRow): void {
    if (new Date(session.expires_at).getTime() <= this.#now().getTime()) {
      throw uploadConflict(
        "UPLOAD_SESSION_EXPIRED",
        "The upload session has expired and cannot be changed.",
      );
    }
    if (session.session_state !== "initiated" && session.session_state !== "uploading") {
      throw uploadConflict(
        "UPLOAD_SESSION_CLOSED",
        "The upload session is terminal and cannot be changed.",
      );
    }
  }
}
