import {
  canonicalHomeSnapshotSchema,
  modelProfileSummarySchema,
  modelSnapshotRecordSchema,
  type ModelProfile,
  type ModelSnapshotRecord,
} from "@interior-design/contracts";
import { createHash, randomUUID } from "node:crypto";
import type { JSONValue, Sql, TransactionSql } from "postgres";

import { ApiError } from "../../../errors.js";
import { notFound } from "../../identity/http.js";
import type {
  AvailableModelProfileSummary,
  CanonicalModelRepository,
  CanonicalSnapshotCodec,
  CreateCanonicalSnapshotResult,
  PersistCanonicalSnapshotCommand,
} from "./types.js";

export type CanonicalModelClock = () => Date;
export type CanonicalModelUuidFactory = () => string;

interface SnapshotRow {
  readonly canonical_byte_length: number;
  readonly canonical_snapshot: unknown;
  readonly created_at: Date | string;
  readonly created_by: string;
  readonly id: string;
  readonly model_id: string;
  readonly profile: string;
  readonly project_id: string;
  readonly schema_version: string;
  readonly snapshot_sha256: string;
  readonly version: number;
}

interface ProfileRow {
  readonly current_snapshot_id: string | null;
  readonly current_snapshot_sha256: string | null;
  readonly current_snapshot_version: number | null;
  readonly model_id: string;
  readonly profile: string;
  readonly updated_at: Date | string | null;
}

interface IdempotencyRow {
  readonly actor_user_id: string;
  readonly operation: string;
  readonly request_hash: string;
  readonly response_snapshot_id: string | null;
  readonly response_status: number | null;
}

const createSnapshotOperation = "canonical-model.snapshot.create";

function isoTimestamp(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function json(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function revisionConflict(): ApiError {
  return new ApiError({
    code: "REVISION_CONFLICT",
    detail: "The current model snapshot changed; reload it and retry with its current hash.",
    statusCode: 409,
    title: "Revision Conflict",
  });
}

function idempotencyConflict(): ApiError {
  return new ApiError({
    code: "IDEMPOTENCY_CONFLICT",
    detail: "The Idempotency-Key was already used for a different canonical model mutation.",
    statusCode: 409,
    title: "Idempotency Conflict",
  });
}

function invalidModelBoundary(): ApiError {
  return new ApiError({
    code: "INVALID_MODEL_BOUNDARY",
    detail: "The canonical snapshot references data outside its authorised project boundary.",
    statusCode: 400,
    title: "Invalid Model Boundary",
  });
}

function requestHash(command: PersistCanonicalSnapshotCommand): string {
  return createHash("sha256")
    .update(
      JSON.stringify([command.expectedCurrentSnapshotSha256, command.canonical.snapshotSha256]),
      "utf8",
    )
    .digest("hex");
}

function mapSnapshot(row: SnapshotRow, codec: CanonicalSnapshotCodec): ModelSnapshotRecord {
  const storedSnapshot = canonicalHomeSnapshotSchema.parse(row.canonical_snapshot);
  const recomputed = codec.encode(storedSnapshot);
  if (
    recomputed.snapshotSha256 !== row.snapshot_sha256 ||
    recomputed.canonicalByteLength !== row.canonical_byte_length ||
    recomputed.snapshot.schemaVersion !== row.schema_version ||
    recomputed.snapshot.modelId !== row.model_id ||
    recomputed.snapshot.projectId !== row.project_id ||
    recomputed.snapshot.profile !== row.profile
  ) {
    throw new Error("Stored canonical snapshot integrity verification failed.");
  }
  return modelSnapshotRecordSchema.parse({
    canonicalByteLength: row.canonical_byte_length,
    createdAt: isoTimestamp(row.created_at),
    createdBy: row.created_by,
    id: row.id,
    modelId: row.model_id,
    profile: row.profile,
    projectId: row.project_id,
    schemaVersion: row.schema_version,
    snapshot: recomputed.snapshot,
    snapshotSha256: row.snapshot_sha256,
    version: row.version,
  });
}

async function lockProject(
  transaction: TransactionSql,
  tenantId: string,
  projectId: string,
): Promise<void> {
  const rows = await transaction<{ readonly id: string }[]>`
    SELECT id
    FROM projects
    WHERE tenant_id = ${tenantId}::uuid
      AND id = ${projectId}::uuid
    FOR UPDATE
  `;
  if (rows.length !== 1) {
    throw notFound();
  }
}

async function claimIdempotency(
  transaction: TransactionSql,
  command: PersistCanonicalSnapshotCommand,
): Promise<{ readonly replaySnapshotId?: string }> {
  const hash = requestHash(command);
  const inserted = await transaction<{ readonly idempotency_key: string }[]>`
    INSERT INTO canonical_model_idempotency (
      tenant_id,
      project_id,
      profile,
      idempotency_key,
      actor_user_id,
      operation,
      request_hash
    )
    VALUES (
      ${command.actor.tenantId}::uuid,
      ${command.projectId}::uuid,
      ${command.profile},
      ${command.idempotencyKey},
      ${command.actor.userId}::uuid,
      ${createSnapshotOperation},
      ${hash}
    )
    ON CONFLICT (tenant_id, project_id, profile, idempotency_key) DO NOTHING
    RETURNING idempotency_key
  `;
  if (inserted.length === 1) {
    return {};
  }
  const rows = await transaction<IdempotencyRow[]>`
    SELECT actor_user_id, operation, request_hash, response_snapshot_id, response_status
    FROM canonical_model_idempotency
    WHERE tenant_id = ${command.actor.tenantId}::uuid
      AND project_id = ${command.projectId}::uuid
      AND profile = ${command.profile}
      AND idempotency_key = ${command.idempotencyKey}
    LIMIT 1
  `;
  const stored = rows[0];
  if (stored === undefined) {
    throw new Error("Canonical model idempotency claim disappeared.");
  }
  if (
    stored.actor_user_id !== command.actor.userId ||
    stored.operation !== createSnapshotOperation ||
    stored.request_hash !== hash
  ) {
    throw idempotencyConflict();
  }
  if (stored.response_snapshot_id === null || stored.response_status !== 201) {
    throw new Error("Committed canonical model idempotency record is incomplete.");
  }
  return { replaySnapshotId: stored.response_snapshot_id };
}

async function completeIdempotency(
  transaction: TransactionSql,
  command: PersistCanonicalSnapshotCommand,
  snapshotId: string,
): Promise<void> {
  const rows = await transaction<{ readonly idempotency_key: string }[]>`
    UPDATE canonical_model_idempotency
    SET response_status = 201,
        response_snapshot_id = ${snapshotId}::uuid,
        completed_at = clock_timestamp()
    WHERE tenant_id = ${command.actor.tenantId}::uuid
      AND project_id = ${command.projectId}::uuid
      AND profile = ${command.profile}
      AND idempotency_key = ${command.idempotencyKey}
      AND actor_user_id = ${command.actor.userId}::uuid
      AND completed_at IS NULL
    RETURNING idempotency_key
  `;
  if (rows.length !== 1) {
    throw new Error("Canonical model idempotency completion did not update one row.");
  }
}

async function assertBoundaryReferences(
  transaction: TransactionSql,
  command: PersistCanonicalSnapshotCommand,
): Promise<void> {
  if (command.snapshot.propertyId !== undefined) {
    const properties = await transaction<{ readonly id: string }[]>`
      SELECT id
      FROM property_identities
      WHERE tenant_id = ${command.actor.tenantId}::uuid
        AND project_id = ${command.projectId}::uuid
        AND id = ${command.snapshot.propertyId}::uuid
      LIMIT 1
    `;
    if (properties.length !== 1) {
      throw invalidModelBoundary();
    }
  }
  if (command.snapshot.derivedFromSnapshotSha256 !== undefined) {
    const sources = await transaction<{ readonly id: string }[]>`
      SELECT id
      FROM canonical_model_snapshots
      WHERE tenant_id = ${command.actor.tenantId}::uuid
        AND project_id = ${command.projectId}::uuid
        AND snapshot_sha256 = ${command.snapshot.derivedFromSnapshotSha256}
      LIMIT 1
    `;
    if (sources.length !== 1) {
      throw invalidModelBoundary();
    }
  }
}

export class PostgresCanonicalModelRepository implements CanonicalModelRepository {
  readonly #clock: CanonicalModelClock;
  readonly #codec: CanonicalSnapshotCodec;
  readonly #sql: Sql;
  readonly #uuid: CanonicalModelUuidFactory;

  constructor(
    sql: Sql,
    codec: CanonicalSnapshotCodec,
    options: {
      readonly clock?: CanonicalModelClock;
      readonly uuid?: CanonicalModelUuidFactory;
    } = {},
  ) {
    this.#clock = options.clock ?? (() => new Date());
    this.#codec = codec;
    this.#sql = sql;
    this.#uuid = options.uuid ?? randomUUID;
  }

  async createSnapshot(
    command: PersistCanonicalSnapshotCommand,
  ): Promise<CreateCanonicalSnapshotResult> {
    return this.#sql.begin(async (transaction) => {
      await lockProject(transaction, command.actor.tenantId, command.projectId);
      const idempotency = await claimIdempotency(transaction, command);
      if (idempotency.replaySnapshotId !== undefined) {
        const replayRows = await transaction<SnapshotRow[]>`
          SELECT
            id,
            project_id,
            model_id,
            profile,
            version,
            schema_version,
            canonical_snapshot,
            snapshot_sha256,
            canonical_byte_length,
            created_by,
            created_at
          FROM canonical_model_snapshots
          WHERE tenant_id = ${command.actor.tenantId}::uuid
            AND project_id = ${command.projectId}::uuid
            AND profile = ${command.profile}
            AND id = ${idempotency.replaySnapshotId}::uuid
          LIMIT 1
        `;
        const replay = replayRows[0];
        if (replay === undefined) {
          throw new Error("Canonical model replay snapshot is missing.");
        }
        return { record: mapSnapshot(replay, this.#codec), replayed: true };
      }

      const profileRows = await transaction<ProfileRow[]>`
        SELECT
          model_id,
          profile,
          current_snapshot_id,
          current_snapshot_sha256,
          current_snapshot_version,
          updated_at
        FROM canonical_model_profiles
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid
          AND profile = ${command.profile}
        FOR UPDATE
      `;
      let profile = profileRows[0];
      if (profile === undefined) {
        if (command.expectedCurrentSnapshotSha256 !== null) {
          throw revisionConflict();
        }
        const inserted = await transaction<ProfileRow[]>`
          INSERT INTO canonical_model_profiles (
            tenant_id,
            project_id,
            model_id,
            profile
          )
          VALUES (
            ${command.actor.tenantId}::uuid,
            ${command.projectId}::uuid,
            ${command.snapshot.modelId}::uuid,
            ${command.profile}
          )
          RETURNING
            model_id,
            profile,
            current_snapshot_id,
            current_snapshot_sha256,
            current_snapshot_version,
            updated_at
        `;
        profile = inserted[0];
      }
      if (profile === undefined) {
        throw new Error("Canonical model profile creation returned no row.");
      }
      if (
        profile.model_id !== command.snapshot.modelId ||
        profile.current_snapshot_sha256 !== command.expectedCurrentSnapshotSha256
      ) {
        throw revisionConflict();
      }

      await assertBoundaryReferences(transaction, command);
      const nextVersion = (profile.current_snapshot_version ?? 0) + 1;
      const snapshotId = this.#uuid();
      const createdAt = this.#clock().toISOString();
      const record = modelSnapshotRecordSchema.parse({
        canonicalByteLength: command.canonical.canonicalByteLength,
        createdAt,
        createdBy: command.actor.userId,
        id: snapshotId,
        modelId: command.snapshot.modelId,
        profile: command.profile,
        projectId: command.projectId,
        schemaVersion: command.snapshot.schemaVersion,
        snapshot: command.canonical.snapshot,
        snapshotSha256: command.canonical.snapshotSha256,
        version: nextVersion,
      });

      await transaction`
        INSERT INTO canonical_model_snapshots (
          id,
          tenant_id,
          project_id,
          model_id,
          profile,
          property_id,
          derived_from_snapshot_sha256,
          version,
          schema_version,
          canonical_snapshot,
          snapshot_sha256,
          canonical_byte_length,
          validation_findings,
          created_by,
          created_at
        )
        VALUES (
          ${record.id}::uuid,
          ${command.actor.tenantId}::uuid,
          ${command.projectId}::uuid,
          ${record.modelId}::uuid,
          ${record.profile},
          ${record.snapshot.propertyId ?? null}::uuid,
          ${record.snapshot.derivedFromSnapshotSha256 ?? null},
          ${record.version},
          ${record.schemaVersion},
          ${transaction.json(json(record.snapshot))},
          ${record.snapshotSha256},
          ${record.canonicalByteLength},
          ${transaction.json(json(command.retainedGeometryFindings))},
          ${record.createdBy}::uuid,
          ${record.createdAt}::timestamptz
        )
      `;

      const advanced = await transaction<{ readonly project_id: string }[]>`
        UPDATE canonical_model_profiles
        SET current_snapshot_id = ${record.id}::uuid,
            current_snapshot_sha256 = ${record.snapshotSha256},
            current_snapshot_version = ${record.version},
            updated_at = ${record.createdAt}::timestamptz,
            updated_by = ${record.createdBy}::uuid
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid
          AND model_id = ${record.modelId}::uuid
          AND profile = ${record.profile}
          AND current_snapshot_sha256 IS NOT DISTINCT FROM ${command.expectedCurrentSnapshotSha256}
        RETURNING project_id
      `;
      if (advanced.length !== 1) {
        throw revisionConflict();
      }

      await transaction`
        INSERT INTO canonical_model_audit_events (
          id,
          tenant_id,
          project_id,
          model_id,
          profile,
          snapshot_id,
          snapshot_sha256,
          actor_user_id,
          action,
          request_id,
          trace_id,
          occurred_at
        )
        VALUES (
          ${this.#uuid()}::uuid,
          ${command.actor.tenantId}::uuid,
          ${command.projectId}::uuid,
          ${record.modelId}::uuid,
          ${record.profile},
          ${record.id}::uuid,
          ${record.snapshotSha256},
          ${command.actor.userId}::uuid,
          ${createSnapshotOperation},
          ${command.correlation.requestId},
          ${command.correlation.traceId},
          ${record.createdAt}::timestamptz
        )
      `;
      await completeIdempotency(transaction, command, record.id);
      return { record, replayed: false };
    });
  }

  async getCurrentSnapshot(
    tenantId: string,
    projectId: string,
    profile: ModelProfile,
  ): Promise<ModelSnapshotRecord | undefined> {
    const rows = await this.#sql<SnapshotRow[]>`
      SELECT
        s.id,
        s.project_id,
        s.model_id,
        s.profile,
        s.version,
        s.schema_version,
        s.canonical_snapshot,
        s.snapshot_sha256,
        s.canonical_byte_length,
        s.created_by,
        s.created_at
      FROM canonical_model_profiles p
      JOIN canonical_model_snapshots s
        ON s.tenant_id = p.tenant_id
       AND s.project_id = p.project_id
       AND s.model_id = p.model_id
       AND s.profile = p.profile
       AND s.id = p.current_snapshot_id
       AND s.snapshot_sha256 = p.current_snapshot_sha256
       AND s.version = p.current_snapshot_version
      WHERE p.tenant_id = ${tenantId}::uuid
        AND p.project_id = ${projectId}::uuid
        AND p.profile = ${profile}
      LIMIT 1
    `;
    return rows[0] === undefined ? undefined : mapSnapshot(rows[0], this.#codec);
  }

  async getSnapshot(
    tenantId: string,
    projectId: string,
    profile: ModelProfile,
    snapshotId: string,
  ): Promise<ModelSnapshotRecord | undefined> {
    const rows = await this.#sql<SnapshotRow[]>`
      SELECT
        id,
        project_id,
        model_id,
        profile,
        version,
        schema_version,
        canonical_snapshot,
        snapshot_sha256,
        canonical_byte_length,
        created_by,
        created_at
      FROM canonical_model_snapshots
      WHERE tenant_id = ${tenantId}::uuid
        AND project_id = ${projectId}::uuid
        AND profile = ${profile}
        AND id = ${snapshotId}::uuid
      LIMIT 1
    `;
    return rows[0] === undefined ? undefined : mapSnapshot(rows[0], this.#codec);
  }

  async listAvailableProfiles(
    tenantId: string,
    projectId: string,
  ): Promise<readonly AvailableModelProfileSummary[]> {
    const rows = await this.#sql<ProfileRow[]>`
      SELECT
        model_id,
        profile,
        current_snapshot_id,
        current_snapshot_sha256,
        current_snapshot_version,
        updated_at
      FROM canonical_model_profiles
      WHERE tenant_id = ${tenantId}::uuid
        AND project_id = ${projectId}::uuid
        AND current_snapshot_id IS NOT NULL
      ORDER BY CASE profile
        WHEN 'existing' THEN 1
        WHEN 'proposed' THEN 2
        WHEN 'as-built' THEN 3
      END
    `;
    return rows.map((row) => {
      if (
        row.current_snapshot_id === null ||
        row.current_snapshot_sha256 === null ||
        row.current_snapshot_version === null ||
        row.updated_at === null
      ) {
        throw new Error("Available canonical model profile has an incomplete current pointer.");
      }
      const summary = modelProfileSummarySchema.parse({
        currentSnapshotId: row.current_snapshot_id,
        currentSnapshotSha256: row.current_snapshot_sha256,
        modelId: row.model_id,
        profile: row.profile,
        status: "available",
        updatedAt: isoTimestamp(row.updated_at),
        version: row.current_snapshot_version,
      });
      if (summary.status !== "available") {
        throw new Error("Stored canonical model profile unexpectedly mapped to empty.");
      }
      return summary;
    });
  }
}
