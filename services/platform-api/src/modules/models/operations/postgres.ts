import {
  canonicalHomeSnapshotSchema,
  geometryFindingSchema,
  modelBranchComparisonSchema,
  modelBranchSchema,
  modelCommitSchema,
  modelOperationHistoryResponseSchema,
  modelOperationRequestSchema,
  modelOperationsPreviewSchema,
  modelSnapshotRecordSchema,
  type CanonicalHomeSnapshot,
  type ModelBranch,
  type ModelCommit,
  type ModelOperationsPreview,
  type ModelProfile,
  type ModelSnapshotRecord,
} from "@interior-design/contracts";
import { canonicalizeIJson } from "@interior-design/domain-model";
import {
  createInternalSnapshotOperation,
  reduceModelOperations,
  replayModelOperationHistory,
  upcastModelOperation,
  validateAndCanonicalizeSnapshot,
  type CanonicalOperationResult,
  type RetainedModelOperation,
  type RetainedOperationCommit,
} from "@interior-design/model-operations";
import { createHash, randomUUID } from "node:crypto";
import type { JSONValue, Sql, TransactionSql } from "postgres";
import { z } from "zod";

import { ApiError } from "../../../errors.js";
import type { ModelAuditAction } from "../../audit/types.js";
import { notFound } from "../../identity/http.js";
import { BranchRevisionConflictError } from "./errors.js";
import type {
  BranchCommandContext,
  BranchComparison,
  CommitOperationsCommand,
  CreateBranchCommand,
  InitializeModelCommand,
  ModelCommitResponse,
  ModelOperationClock,
  ModelOperationRepository,
  ModelOperationUuidFactory,
  OperationHistoryPage,
  PreviewOperationsCommand,
  ReplayVerification,
  RestoreBranchCommand,
} from "./types.js";

interface BranchRow {
  readonly created_at: Date | string;
  readonly created_by: string;
  readonly head_snapshot_id: string;
  readonly head_snapshot_sha256: string;
  readonly head_snapshot_version: number;
  readonly id: string;
  readonly model_id: string;
  readonly name: string;
  readonly profile: string;
  readonly project_id: string;
  readonly revision: number;
  readonly source_snapshot_id: string;
  readonly source_snapshot_sha256: string;
  readonly source_snapshot_version: number;
  readonly updated_at: Date | string;
}

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

interface PreviewRow {
  readonly base_revision: number;
  readonly base_snapshot_sha256: string;
  readonly branch_id: string;
  readonly created_at: Date | string;
  readonly created_by: string;
  readonly expires_at: Date | string;
  readonly findings: unknown;
  readonly has_blocking_findings: boolean;
  readonly id: string;
  readonly operation_payload: unknown;
  readonly operation_payload_sha256: string;
  readonly project_id: string;
  readonly result_canonical_byte_length: number;
  readonly result_snapshot_sha256: string;
}

interface CommitRow {
  readonly branch_id: string;
  readonly committed_at: Date | string;
  readonly committed_by: string;
  readonly id: string;
  readonly message: string;
  readonly parent_snapshot_sha256: string;
  readonly project_id: string;
  readonly revision: number;
  readonly snapshot_id: string;
  readonly snapshot_sha256: string;
  readonly validation_findings: unknown;
}

interface OperationRow {
  readonly branch_id: string;
  readonly client_operation_id: string;
  readonly commit_id: string;
  readonly committed_at: Date | string;
  readonly committed_by: string;
  readonly id: string;
  readonly operation_payload: unknown;
  readonly ordinal: number;
  readonly project_id: string;
  readonly reason: string;
  readonly revision: number;
  readonly schema_version: string;
  readonly type: string;
}

interface IdempotencyRow {
  readonly actor_user_id: string;
  readonly branch_id: string | null;
  readonly operation: string;
  readonly request_hash: string;
  readonly response_id: string | null;
  readonly response_kind: "branch" | "commit" | "preview" | "snapshot" | null;
  readonly response_status: number | null;
}

interface ProfileRow {
  readonly current_snapshot_id: string | null;
  readonly current_snapshot_sha256: string | null;
  readonly current_snapshot_version: number | null;
  readonly model_id: string;
}

type OperationName =
  | "model.branch.create"
  | "model.branch.restore"
  | "model.operation.commit"
  | "model.operation.preview"
  | "snapshot.initialize.v1";
type ResponseKind = NonNullable<IdempotencyRow["response_kind"]>;

interface IdempotencyClaim {
  readonly actorUserId: string;
  readonly branchId: string | undefined;
  readonly enforceBranch: boolean;
  readonly idempotencyKey: string;
  readonly modelId: string;
  readonly operation: OperationName;
  readonly profile: ModelProfile;
  readonly projectId: string;
  readonly requestBody: unknown;
  readonly tenantId: string;
}

type ClaimResult =
  | { readonly kind: "claimed" }
  | {
      readonly id: string;
      readonly kind: "replay";
      readonly responseKind: ResponseKind;
      readonly status: number;
    };

const previewLifetimeMs = 15 * 60 * 1000;
const maximumComparisonChanges = 10_000;
const historyCursorPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.([0-9a-f-]{36})$/u;

function json(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function isoTimestamp(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function hashRequest(operation: OperationName, body: unknown): string {
  return createHash("sha256").update(canonicalizeIJson({ body, operation }), "utf8").digest("hex");
}

function idempotencyConflict(): ApiError {
  return new ApiError({
    code: "IDEMPOTENCY_CONFLICT",
    detail: "The Idempotency-Key was already used for a different model operation.",
    statusCode: 409,
    title: "Idempotency Conflict",
  });
}

function invalidSourceSnapshot(): ApiError {
  return new ApiError({
    code: "INVALID_SOURCE_SNAPSHOT",
    detail: "The named source snapshot is not available in this project, model, and profile.",
    statusCode: 400,
    title: "Invalid Source Snapshot",
  });
}

function previewUnavailable(
  code: "PREVIEW_ALREADY_COMMITTED" | "PREVIEW_EXPIRED" | "PREVIEW_NOT_FOUND",
) {
  const detail =
    code === "PREVIEW_ALREADY_COMMITTED"
      ? "This preview has already been committed; create a new preview for another commit."
      : code === "PREVIEW_EXPIRED"
        ? "The preview expired; rebuild it against the current branch head."
        : "The preview is not available to this actor and branch.";
  return new ApiError({
    code,
    detail,
    statusCode: code === "PREVIEW_NOT_FOUND" ? 404 : 409,
    title:
      code === "PREVIEW_ALREADY_COMMITTED"
        ? "Preview Already Committed"
        : code === "PREVIEW_EXPIRED"
          ? "Preview Expired"
          : "Preview Not Found",
  });
}

function previewBlocked(): ApiError {
  return new ApiError({
    code: "PREVIEW_HAS_BLOCKING_FINDINGS",
    detail: "A preview with blocking geometry findings cannot be committed.",
    statusCode: 422,
    title: "Preview Has Blocking Findings",
  });
}

function alreadyInitialized(): ApiError {
  return new ApiError({
    code: "TYPED_OPERATION_REQUIRED",
    detail:
      "This model profile is initialized; further amendments require a typed branch operation.",
    statusCode: 409,
    title: "Typed Operation Required",
  });
}

function mapBranch(row: BranchRow, overrides: Partial<ModelBranch> = {}): ModelBranch {
  return modelBranchSchema.parse({
    createdAt: isoTimestamp(row.created_at),
    createdBy: row.created_by,
    headSnapshotId: row.head_snapshot_id,
    headSnapshotSha256: row.head_snapshot_sha256,
    id: row.id,
    modelId: row.model_id,
    name: row.name,
    profile: row.profile,
    projectId: row.project_id,
    revision: row.revision,
    schemaVersion: "c5-model-branch-v1",
    sourceSnapshotId: row.source_snapshot_id,
    updatedAt: isoTimestamp(row.updated_at),
    ...overrides,
  });
}

function mapSnapshot(row: SnapshotRow): ModelSnapshotRecord {
  const snapshot = canonicalHomeSnapshotSchema.parse(row.canonical_snapshot);
  const canonical = validateAndCanonicalizeSnapshot(snapshot);
  if (
    canonical.hasBlockingFindings ||
    canonical.snapshotSha256 !== row.snapshot_sha256 ||
    canonical.canonicalByteLength !== row.canonical_byte_length ||
    canonical.snapshot.projectId !== row.project_id ||
    canonical.snapshot.modelId !== row.model_id ||
    canonical.snapshot.profile !== row.profile ||
    canonical.snapshot.schemaVersion !== row.schema_version
  ) {
    throw new Error("Stored canonical model snapshot failed C5 integrity verification.");
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
    snapshot: canonical.snapshot,
    snapshotSha256: row.snapshot_sha256,
    version: row.version,
  });
}

function mapPreview(row: PreviewRow): ModelOperationsPreview {
  return modelOperationsPreviewSchema.parse({
    baseHeadSnapshotSha256: row.base_snapshot_sha256,
    baseRevision: row.base_revision,
    branchId: row.branch_id,
    canonicalByteLength: row.result_canonical_byte_length,
    expiresAt: isoTimestamp(row.expires_at),
    findings: row.findings,
    hasBlockingFindings: row.has_blocking_findings,
    id: row.id,
    operations: row.operation_payload,
    projectId: row.project_id,
    resultSnapshotSha256: row.result_snapshot_sha256,
  });
}

function mapCommit(row: CommitRow, operationIds: readonly string[]): ModelCommit {
  return modelCommitSchema.parse({
    branchId: row.branch_id,
    committedAt: isoTimestamp(row.committed_at),
    committedBy: row.committed_by,
    id: row.id,
    message: row.message,
    operationIds,
    parentSnapshotSha256: row.parent_snapshot_sha256,
    projectId: row.project_id,
    revision: row.revision,
    snapshotId: row.snapshot_id,
    snapshotSha256: row.snapshot_sha256,
  });
}

async function lockProject(
  transaction: TransactionSql,
  tenantId: string,
  projectId: string,
): Promise<void> {
  const rows = await transaction<{ readonly id: string }[]>`
    SELECT id FROM projects
    WHERE tenant_id = ${tenantId}::uuid AND id = ${projectId}::uuid
    FOR UPDATE
  `;
  if (rows.length !== 1) throw notFound();
}

async function claimIdempotency(
  transaction: TransactionSql,
  claim: IdempotencyClaim,
): Promise<ClaimResult> {
  const requestHash = hashRequest(claim.operation, claim.requestBody);
  const inserted = await transaction<{ readonly idempotency_key: string }[]>`
    INSERT INTO model_operation_idempotency (
      tenant_id, project_id, model_id, profile, branch_id, idempotency_key,
      actor_user_id, operation, request_hash
    ) VALUES (
      ${claim.tenantId}::uuid, ${claim.projectId}::uuid, ${claim.modelId}::uuid,
      ${claim.profile}, ${claim.branchId ?? null}::uuid, ${claim.idempotencyKey},
      ${claim.actorUserId}::uuid, ${claim.operation}, ${requestHash}
    )
    ON CONFLICT (tenant_id, project_id, model_id, profile, idempotency_key) DO NOTHING
    RETURNING idempotency_key
  `;
  if (inserted.length === 1) return { kind: "claimed" };
  const rows = await transaction<IdempotencyRow[]>`
    SELECT actor_user_id, branch_id, operation, request_hash,
           response_kind, response_id, response_status
    FROM model_operation_idempotency
    WHERE tenant_id = ${claim.tenantId}::uuid
      AND project_id = ${claim.projectId}::uuid
      AND model_id = ${claim.modelId}::uuid
      AND profile = ${claim.profile}
      AND idempotency_key = ${claim.idempotencyKey}
    LIMIT 1
  `;
  const stored = rows[0];
  if (
    stored === undefined ||
    stored.actor_user_id !== claim.actorUserId ||
    stored.operation !== claim.operation ||
    stored.request_hash !== requestHash ||
    (claim.enforceBranch && stored.branch_id !== claim.branchId)
  ) {
    throw idempotencyConflict();
  }
  if (
    stored.response_kind === null ||
    stored.response_id === null ||
    stored.response_status === null
  ) {
    throw new Error("Committed model operation idempotency record is incomplete.");
  }
  return {
    id: stored.response_id,
    kind: "replay",
    responseKind: stored.response_kind,
    status: stored.response_status,
  };
}

async function completeIdempotency(
  transaction: TransactionSql,
  claim: IdempotencyClaim,
  responseKind: ResponseKind,
  responseId: string,
  status: 200 | 201,
): Promise<void> {
  const rows = await transaction<{ readonly idempotency_key: string }[]>`
    UPDATE model_operation_idempotency
    SET response_kind = ${responseKind}, response_id = ${responseId}::uuid,
        response_status = ${status}, completed_at = clock_timestamp()
    WHERE tenant_id = ${claim.tenantId}::uuid
      AND project_id = ${claim.projectId}::uuid
      AND model_id = ${claim.modelId}::uuid
      AND profile = ${claim.profile}
      AND idempotency_key = ${claim.idempotencyKey}
      AND actor_user_id = ${claim.actorUserId}::uuid
      AND completed_at IS NULL
    RETURNING idempotency_key
  `;
  if (rows.length !== 1) {
    throw new Error("Model operation idempotency completion did not update exactly one row.");
  }
}

async function loadSnapshot(
  transaction: TransactionSql,
  scope: {
    readonly modelId?: string;
    readonly profile: ModelProfile;
    readonly projectId: string;
    readonly snapshotId: string;
    readonly snapshotSha256?: string;
    readonly tenantId: string;
  },
): Promise<ModelSnapshotRecord | undefined> {
  const rows =
    scope.modelId === undefined
      ? await transaction<SnapshotRow[]>`
        SELECT id, project_id, model_id, profile, version, schema_version,
               canonical_snapshot, snapshot_sha256, canonical_byte_length,
               created_by, created_at
        FROM canonical_model_snapshots
        WHERE tenant_id = ${scope.tenantId}::uuid
          AND project_id = ${scope.projectId}::uuid
          AND profile = ${scope.profile}
          AND id = ${scope.snapshotId}::uuid
          AND (${scope.snapshotSha256 ?? null}::text IS NULL
               OR snapshot_sha256 = ${scope.snapshotSha256 ?? null})
        LIMIT 1
      `
      : await transaction<SnapshotRow[]>`
        SELECT id, project_id, model_id, profile, version, schema_version,
               canonical_snapshot, snapshot_sha256, canonical_byte_length,
               created_by, created_at
        FROM canonical_model_snapshots
        WHERE tenant_id = ${scope.tenantId}::uuid
          AND project_id = ${scope.projectId}::uuid
          AND model_id = ${scope.modelId}::uuid
          AND profile = ${scope.profile}
          AND id = ${scope.snapshotId}::uuid
          AND (${scope.snapshotSha256 ?? null}::text IS NULL
               OR snapshot_sha256 = ${scope.snapshotSha256 ?? null})
        LIMIT 1
      `;
  return rows[0] === undefined ? undefined : mapSnapshot(rows[0]);
}

async function loadBranch(
  transaction: TransactionSql,
  scope: {
    readonly branchId: string;
    readonly profile: ModelProfile;
    readonly projectId: string;
    readonly tenantId: string;
  },
  lock: boolean,
): Promise<BranchRow | undefined> {
  const rows = lock
    ? await transaction<BranchRow[]>`
        SELECT * FROM model_branches
        WHERE tenant_id = ${scope.tenantId}::uuid
          AND project_id = ${scope.projectId}::uuid
          AND profile = ${scope.profile}
          AND id = ${scope.branchId}::uuid
        FOR UPDATE
      `
    : await transaction<BranchRow[]>`
        SELECT * FROM model_branches
        WHERE tenant_id = ${scope.tenantId}::uuid
          AND project_id = ${scope.projectId}::uuid
          AND profile = ${scope.profile}
          AND id = ${scope.branchId}::uuid
        LIMIT 1
      `;
  return rows[0];
}

function assertExpectedBranch(
  branch: BranchRow,
  expectedRevision: number,
  expectedHeadSnapshotSha256: string,
): void {
  if (
    branch.revision !== expectedRevision ||
    branch.head_snapshot_sha256 !== expectedHeadSnapshotSha256
  ) {
    throw new BranchRevisionConflictError({
      branchId: branch.id,
      currentHeadSnapshotSha256: branch.head_snapshot_sha256,
      currentRevision: branch.revision,
    });
  }
}

async function assertSnapshotBoundaryReferences(
  transaction: TransactionSql,
  tenantId: string,
  snapshot: CanonicalHomeSnapshot,
): Promise<void> {
  if (snapshot.propertyId !== undefined) {
    const properties = await transaction<{ readonly id: string }[]>`
      SELECT id FROM property_identities
      WHERE tenant_id = ${tenantId}::uuid
        AND project_id = ${snapshot.projectId}::uuid
        AND id = ${snapshot.propertyId}::uuid
      LIMIT 1
    `;
    if (properties.length !== 1) throw invalidSourceSnapshot();
  }
  if (snapshot.derivedFromSnapshotSha256 !== undefined) {
    const sources = await transaction<{ readonly id: string }[]>`
      SELECT id FROM canonical_model_snapshots
      WHERE tenant_id = ${tenantId}::uuid
        AND project_id = ${snapshot.projectId}::uuid
        AND snapshot_sha256 = ${snapshot.derivedFromSnapshotSha256}
      LIMIT 1
    `;
    if (sources.length !== 1) throw invalidSourceSnapshot();
  }
}

async function insertSnapshot(
  transaction: TransactionSql,
  input: {
    readonly actorUserId: string;
    readonly canonical: CanonicalOperationResult;
    readonly clock: ModelOperationClock;
    readonly tenantId: string;
    readonly uuid: ModelOperationUuidFactory;
  },
): Promise<ModelSnapshotRecord> {
  const { snapshot } = input.canonical;
  const profiles = await transaction<ProfileRow[]>`
    SELECT model_id, current_snapshot_id, current_snapshot_sha256, current_snapshot_version
    FROM canonical_model_profiles
    WHERE tenant_id = ${input.tenantId}::uuid
      AND project_id = ${snapshot.projectId}::uuid
      AND model_id = ${snapshot.modelId}::uuid
      AND profile = ${snapshot.profile}
    FOR UPDATE
  `;
  const profile = profiles[0];
  if (profile === undefined || profile.model_id !== snapshot.modelId) {
    throw invalidSourceSnapshot();
  }
  await assertSnapshotBoundaryReferences(transaction, input.tenantId, snapshot);
  const version = (profile.current_snapshot_version ?? 0) + 1;
  const createdAt = input.clock().toISOString();
  const record = modelSnapshotRecordSchema.parse({
    canonicalByteLength: input.canonical.canonicalByteLength,
    createdAt,
    createdBy: input.actorUserId,
    id: input.uuid(),
    modelId: snapshot.modelId,
    profile: snapshot.profile,
    projectId: snapshot.projectId,
    schemaVersion: snapshot.schemaVersion,
    snapshot: input.canonical.snapshot,
    snapshotSha256: input.canonical.snapshotSha256,
    version,
  });
  const retainedFindings = input.canonical.findings.filter(({ severity }) => severity !== "error");
  await transaction`
    INSERT INTO canonical_model_snapshots (
      id, tenant_id, project_id, model_id, profile, property_id,
      derived_from_snapshot_sha256, version, schema_version, canonical_snapshot,
      snapshot_sha256, canonical_byte_length, validation_findings, created_by, created_at
    ) VALUES (
      ${record.id}::uuid, ${input.tenantId}::uuid, ${record.projectId}::uuid,
      ${record.modelId}::uuid, ${record.profile}, ${record.snapshot.propertyId ?? null}::uuid,
      ${record.snapshot.derivedFromSnapshotSha256 ?? null}, ${record.version},
      ${record.schemaVersion}, ${transaction.json(json(record.snapshot))},
      ${record.snapshotSha256}, ${record.canonicalByteLength},
      ${transaction.json(json(retainedFindings))}, ${record.createdBy}::uuid,
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
    WHERE tenant_id = ${input.tenantId}::uuid
      AND project_id = ${record.projectId}::uuid
      AND model_id = ${record.modelId}::uuid
      AND profile = ${record.profile}
      AND current_snapshot_version IS NOT DISTINCT FROM ${profile.current_snapshot_version}
    RETURNING project_id
  `;
  if (advanced.length !== 1) throw new Error("Canonical profile pointer did not advance once.");
  return record;
}

async function appendAuditAndOutbox(
  transaction: TransactionSql,
  input: {
    readonly action: ModelAuditAction;
    readonly actorUserId: string;
    readonly branch: BranchRow;
    readonly commitId?: string;
    readonly correlation: { readonly requestId: string; readonly traceId: string };
    readonly eventType: string;
    readonly occurredAt: string;
    readonly operationTypes: readonly string[];
    readonly revision: number;
    readonly snapshotId: string;
    readonly snapshotSha256: string;
    readonly tenantId: string;
    readonly uuid: ModelOperationUuidFactory;
  },
): Promise<void> {
  await transaction`
    INSERT INTO model_domain_audit_events (
      id, tenant_id, project_id, model_id, profile, branch_id, commit_id,
      revision, action, event_type, operation_types, outcome, snapshot_id,
      snapshot_sha256, actor_user_id, request_id, trace_id, occurred_at
    ) VALUES (
      ${input.uuid()}::uuid, ${input.tenantId}::uuid, ${input.branch.project_id}::uuid,
      ${input.branch.model_id}::uuid, ${input.branch.profile}, ${input.branch.id}::uuid,
      ${input.commitId ?? null}::uuid, ${input.revision}, ${input.action}, ${input.eventType},
      ${transaction.json(json(input.operationTypes))}, 'accepted', ${input.snapshotId}::uuid,
      ${input.snapshotSha256}, ${input.actorUserId}::uuid,
      ${input.correlation.requestId}, ${input.correlation.traceId},
      ${input.occurredAt}::timestamptz
    )
  `;
  await transaction`
    INSERT INTO model_transactional_outbox (
      id, tenant_id, project_id, model_id, profile, branch_id, commit_id,
      revision, event_type, schema_version, payload, occurred_at
    ) VALUES (
      ${input.uuid()}::uuid, ${input.tenantId}::uuid, ${input.branch.project_id}::uuid,
      ${input.branch.model_id}::uuid, ${input.branch.profile}, ${input.branch.id}::uuid,
      ${input.commitId ?? null}::uuid, ${input.revision}, ${input.eventType},
      'c5-model-operation-v1',
      ${transaction.json(
        json({
          branchId: input.branch.id,
          commitId: input.commitId,
          eventType: input.eventType,
          operationTypes: input.operationTypes,
          revision: input.revision,
          snapshotId: input.snapshotId,
          snapshotSha256: input.snapshotSha256,
        }),
      )},
      ${input.occurredAt}::timestamptz
    )
  `;
}

function idempotencyClaim(
  command: InitializeModelCommand | CreateBranchCommand | BranchCommandContext,
  input: {
    readonly branchId?: string;
    readonly enforceBranch: boolean;
    readonly modelId: string;
    readonly operation: OperationName;
    readonly requestBody: unknown;
  },
): IdempotencyClaim {
  return {
    actorUserId: command.actor.userId,
    branchId: input.branchId,
    enforceBranch: input.enforceBranch,
    idempotencyKey: command.idempotencyKey,
    modelId: input.modelId,
    operation: input.operation,
    profile: command.profile,
    projectId: command.projectId,
    requestBody: input.requestBody,
    tenantId: command.actor.tenantId,
  };
}

function cursorFor(row: Pick<OperationRow, "id" | "ordinal" | "revision">): string {
  return `${String(row.revision)}.${String(row.ordinal)}.${row.id}`;
}

function parseCursor(cursor: string): {
  readonly id: string;
  readonly ordinal: number;
  readonly revision: number;
} {
  const match = historyCursorPattern.exec(cursor);
  const revision = Number(match?.[1]);
  const ordinal = Number(match?.[2]);
  const id = match?.[3];
  if (
    match === null ||
    id === undefined ||
    !Number.isSafeInteger(revision) ||
    !Number.isSafeInteger(ordinal) ||
    revision < 1 ||
    ordinal < 0 ||
    ordinal > 49
  ) {
    throw new ApiError({
      code: "INVALID_HISTORY_CURSOR",
      detail: "The operation history cursor is invalid.",
      statusCode: 400,
      title: "Invalid History Cursor",
    });
  }
  return { id, ordinal, revision };
}

export class PostgresModelOperationRepository implements ModelOperationRepository {
  readonly #clock: ModelOperationClock;
  readonly #sql: Sql;
  readonly #uuid: ModelOperationUuidFactory;

  constructor(
    sql: Sql,
    options: {
      readonly clock?: ModelOperationClock;
      readonly uuid?: ModelOperationUuidFactory;
    } = {},
  ) {
    this.#clock = options.clock ?? (() => new Date());
    this.#sql = sql;
    this.#uuid = options.uuid ?? randomUUID;
  }

  initialize(command: InitializeModelCommand) {
    return this.#sql.begin(async (transaction) => {
      await lockProject(transaction, command.actor.tenantId, command.projectId);
      const branchId = this.#uuid();
      const claim = idempotencyClaim(command, {
        branchId,
        enforceBranch: false,
        modelId: command.snapshot.modelId,
        operation: "snapshot.initialize.v1",
        requestBody: {
          expectedCurrentSnapshotSha256: command.expectedCurrentSnapshotSha256,
          snapshot: command.snapshot,
        },
      });
      const idempotency = await claimIdempotency(transaction, claim);
      if (idempotency.kind === "replay") {
        if (idempotency.responseKind !== "snapshot")
          throw new Error("Invalid initialize replay kind.");
        const replay = await loadSnapshot(transaction, {
          modelId: command.snapshot.modelId,
          profile: command.profile,
          projectId: command.projectId,
          snapshotId: idempotency.id,
          tenantId: command.actor.tenantId,
        });
        if (replay === undefined) throw new Error("Initialization replay snapshot is missing.");
        return { record: replay, replayed: true };
      }

      const existing = await transaction<ProfileRow[]>`
        SELECT model_id, current_snapshot_id, current_snapshot_sha256, current_snapshot_version
        FROM canonical_model_profiles
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid
          AND profile = ${command.profile}
        FOR UPDATE
      `;
      if (existing.length > 0) throw alreadyInitialized();
      await transaction`
        INSERT INTO canonical_model_profiles (tenant_id, project_id, model_id, profile)
        VALUES (
          ${command.actor.tenantId}::uuid, ${command.projectId}::uuid,
          ${command.snapshot.modelId}::uuid, ${command.profile}
        )
      `;
      const canonical = validateAndCanonicalizeSnapshot(command.snapshot);
      if (canonical.hasBlockingFindings)
        throw new Error("Validated initialization became blocking.");
      const record = await insertSnapshot(transaction, {
        actorUserId: command.actor.userId,
        canonical,
        clock: this.#clock,
        tenantId: command.actor.tenantId,
        uuid: this.#uuid,
      });
      const createdAt = record.createdAt;
      await transaction`
        INSERT INTO model_branches (
          tenant_id, project_id, model_id, profile, id, name,
          source_snapshot_id, source_snapshot_sha256, source_snapshot_version,
          head_snapshot_id, head_snapshot_sha256, head_snapshot_version,
          revision, created_by, created_at, updated_by, updated_at
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${record.projectId}::uuid, ${record.modelId}::uuid,
          ${record.profile}, ${branchId}::uuid, 'Main', ${record.id}::uuid,
          ${record.snapshotSha256}, ${record.version}, ${record.id}::uuid,
          ${record.snapshotSha256}, ${record.version}, 0, ${record.createdBy}::uuid,
          ${createdAt}::timestamptz, ${record.createdBy}::uuid, ${createdAt}::timestamptz
        )
      `;
      const branch = (await loadBranch(
        transaction,
        {
          branchId,
          profile: command.profile,
          projectId: command.projectId,
          tenantId: command.actor.tenantId,
        },
        true,
      )) as BranchRow;
      const commitId = this.#uuid();
      const operationId = this.#uuid();
      const operation = createInternalSnapshotOperation({
        clientOperationId: this.#uuid(),
        reason: "Initial canonical snapshot import.",
        sourceSnapshotId: record.id,
        sourceSnapshotSha256: record.snapshotSha256,
        type: "snapshot.initialize.v1",
      });
      await transaction`
        INSERT INTO model_operation_commits (
          tenant_id, project_id, model_id, profile, branch_id, id, revision, message,
          operation_count, parent_snapshot_id, parent_snapshot_sha256, parent_snapshot_version,
          snapshot_id, snapshot_sha256, snapshot_version, validation_findings,
          committed_by, committed_at, request_id, trace_id
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${record.projectId}::uuid, ${record.modelId}::uuid,
          ${record.profile}, ${branchId}::uuid, ${commitId}::uuid, 1,
          'Initial canonical snapshot import.', 1, ${record.id}::uuid,
          ${record.snapshotSha256}, ${record.version}, ${record.id}::uuid,
          ${record.snapshotSha256}, ${record.version}, ${transaction.json(json(canonical.findings))},
          ${command.actor.userId}::uuid, ${createdAt}::timestamptz,
          ${command.correlation.requestId}, ${command.correlation.traceId}
        )
      `;
      await transaction`
        INSERT INTO model_operation_envelopes (
          tenant_id, project_id, model_id, profile, branch_id, commit_id, id,
          revision, ordinal, schema_version, type, client_operation_id, reason,
          operation_payload, committed_by, committed_at
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${record.projectId}::uuid, ${record.modelId}::uuid,
          ${record.profile}, ${branchId}::uuid, ${commitId}::uuid, ${operationId}::uuid,
          1, 0, ${operation.schemaVersion}, ${operation.type},
          ${operation.clientOperationId}::uuid, ${operation.reason},
          ${transaction.json(json(operation))}, ${command.actor.userId}::uuid,
          ${createdAt}::timestamptz
        )
      `;
      const advanced = await transaction<{ readonly id: string }[]>`
        UPDATE model_branches
        SET revision = 1, updated_by = ${command.actor.userId}::uuid,
            updated_at = ${new Date(new Date(createdAt).getTime() + 1).toISOString()}::timestamptz
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${record.projectId}::uuid AND model_id = ${record.modelId}::uuid
          AND profile = ${record.profile} AND id = ${branchId}::uuid AND revision = 0
        RETURNING id
      `;
      if (advanced.length !== 1) throw new Error("Initialization branch did not advance once.");
      await appendAuditAndOutbox(transaction, {
        action: "model:snapshot:create",
        actorUserId: command.actor.userId,
        branch,
        commitId,
        correlation: command.correlation,
        eventType: "snapshot.initialize.v1",
        occurredAt: createdAt,
        operationTypes: [operation.type],
        revision: 1,
        snapshotId: record.id,
        snapshotSha256: record.snapshotSha256,
        tenantId: command.actor.tenantId,
        uuid: this.#uuid,
      });
      await completeIdempotency(transaction, claim, "snapshot", record.id, 201);
      return { record, replayed: false };
    });
  }

  createBranch(command: CreateBranchCommand) {
    return this.#sql.begin(async (transaction) => {
      await lockProject(transaction, command.actor.tenantId, command.projectId);
      const source = await loadSnapshot(transaction, {
        profile: command.profile,
        projectId: command.projectId,
        snapshotId: command.sourceSnapshotId,
        snapshotSha256: command.sourceSnapshotSha256,
        tenantId: command.actor.tenantId,
      });
      if (source === undefined) throw invalidSourceSnapshot();
      const branchId = this.#uuid();
      const claim = idempotencyClaim(command, {
        branchId,
        enforceBranch: false,
        modelId: source.modelId,
        operation: "model.branch.create",
        requestBody: {
          name: command.name,
          sourceSnapshotId: command.sourceSnapshotId,
          sourceSnapshotSha256: command.sourceSnapshotSha256,
        },
      });
      const idempotency = await claimIdempotency(transaction, claim);
      if (idempotency.kind === "replay") {
        if (idempotency.responseKind !== "branch") throw new Error("Invalid branch replay kind.");
        const replay = await loadBranch(
          transaction,
          {
            branchId: idempotency.id,
            profile: command.profile,
            projectId: command.projectId,
            tenantId: command.actor.tenantId,
          },
          false,
        );
        if (replay === undefined) throw new Error("Branch replay record is missing.");
        return { branch: mapBranch(replay), replayed: true };
      }
      const createdAt = this.#clock().toISOString();
      await transaction`
        INSERT INTO model_branches (
          tenant_id, project_id, model_id, profile, id, name,
          source_snapshot_id, source_snapshot_sha256, source_snapshot_version,
          head_snapshot_id, head_snapshot_sha256, head_snapshot_version,
          revision, created_by, created_at, updated_by, updated_at
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${source.projectId}::uuid, ${source.modelId}::uuid,
          ${source.profile}, ${branchId}::uuid, ${command.name}, ${source.id}::uuid,
          ${source.snapshotSha256}, ${source.version}, ${source.id}::uuid,
          ${source.snapshotSha256}, ${source.version}, 0, ${command.actor.userId}::uuid,
          ${createdAt}::timestamptz, ${command.actor.userId}::uuid, ${createdAt}::timestamptz
        )
      `;
      const stored = await loadBranch(
        transaction,
        {
          branchId,
          profile: command.profile,
          projectId: command.projectId,
          tenantId: command.actor.tenantId,
        },
        false,
      );
      if (stored === undefined) throw new Error("Created model branch is missing.");
      await appendAuditAndOutbox(transaction, {
        action: "model:branch:create",
        actorUserId: command.actor.userId,
        branch: stored,
        correlation: command.correlation,
        eventType: "model.branch.created.v1",
        occurredAt: createdAt,
        operationTypes: [],
        revision: 0,
        snapshotId: source.id,
        snapshotSha256: source.snapshotSha256,
        tenantId: command.actor.tenantId,
        uuid: this.#uuid,
      });
      await completeIdempotency(transaction, claim, "branch", branchId, 201);
      return { branch: mapBranch(stored), replayed: false };
    });
  }

  async listBranches(tenantId: string, projectId: string, profile: ModelProfile) {
    const rows = await this.#sql<BranchRow[]>`
      SELECT * FROM model_branches
      WHERE tenant_id = ${tenantId}::uuid
        AND project_id = ${projectId}::uuid
        AND profile = ${profile}
      ORDER BY created_at, id
      LIMIT 100
    `;
    return rows.map((row) => mapBranch(row));
  }

  async getBranch(tenantId: string, projectId: string, profile: ModelProfile, branchId: string) {
    const rows = await this.#sql<BranchRow[]>`
      SELECT * FROM model_branches
      WHERE tenant_id = ${tenantId}::uuid
        AND project_id = ${projectId}::uuid
        AND profile = ${profile}
        AND id = ${branchId}::uuid
      LIMIT 1
    `;
    return rows[0] === undefined ? undefined : mapBranch(rows[0]);
  }

  preview(command: PreviewOperationsCommand) {
    return this.#sql.begin(async (transaction) => {
      await lockProject(transaction, command.actor.tenantId, command.projectId);
      const branch = await loadBranch(
        transaction,
        {
          branchId: command.branchId,
          profile: command.profile,
          projectId: command.projectId,
          tenantId: command.actor.tenantId,
        },
        true,
      );
      if (branch === undefined) throw notFound();
      const claim = idempotencyClaim(command, {
        branchId: branch.id,
        enforceBranch: true,
        modelId: branch.model_id,
        operation: "model.operation.preview",
        requestBody: {
          expectedHeadSnapshotSha256: command.expectedHeadSnapshotSha256,
          expectedRevision: command.expectedRevision,
          operations: command.operations,
        },
      });
      const idempotency = await claimIdempotency(transaction, claim);
      if (idempotency.kind === "replay") {
        if (idempotency.responseKind !== "preview") throw new Error("Invalid preview replay kind.");
        const rows = await transaction<PreviewRow[]>`
          SELECT * FROM model_operation_previews
          WHERE tenant_id = ${command.actor.tenantId}::uuid
            AND project_id = ${command.projectId}::uuid
            AND model_id = ${branch.model_id}::uuid
            AND profile = ${command.profile}
            AND branch_id = ${branch.id}::uuid
            AND id = ${idempotency.id}::uuid
          LIMIT 1
        `;
        if (rows[0] === undefined) throw new Error("Preview replay record is missing.");
        return { preview: mapPreview(rows[0]), replayed: true };
      }
      assertExpectedBranch(branch, command.expectedRevision, command.expectedHeadSnapshotSha256);
      const base = await loadSnapshot(transaction, {
        modelId: branch.model_id,
        profile: command.profile,
        projectId: command.projectId,
        snapshotId: branch.head_snapshot_id,
        snapshotSha256: branch.head_snapshot_sha256,
        tenantId: command.actor.tenantId,
      });
      if (base === undefined || base.version !== branch.head_snapshot_version) {
        throw new Error("Branch head snapshot integrity could not be established.");
      }
      const result = reduceModelOperations(base.snapshot, command.operations);
      const createdAt = this.#clock();
      const previewId = this.#uuid();
      const expiresAt = new Date(createdAt.getTime() + previewLifetimeMs);
      const operationHash = createHash("sha256")
        .update(canonicalizeIJson(command.operations), "utf8")
        .digest("hex");
      await transaction`
        INSERT INTO model_operation_previews (
          tenant_id, project_id, model_id, profile, branch_id, id, created_by,
          created_at, expires_at, base_revision, base_snapshot_id,
          base_snapshot_sha256, base_snapshot_version, operation_payload,
          operation_payload_sha256, result_snapshot_sha256,
          result_canonical_byte_length, findings, has_blocking_findings
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${command.projectId}::uuid,
          ${branch.model_id}::uuid, ${command.profile}, ${branch.id}::uuid,
          ${previewId}::uuid, ${command.actor.userId}::uuid,
          ${createdAt.toISOString()}::timestamptz, ${expiresAt.toISOString()}::timestamptz,
          ${branch.revision}, ${base.id}::uuid, ${base.snapshotSha256}, ${base.version},
          ${transaction.json(json(command.operations))}, ${operationHash},
          ${result.snapshotSha256}, ${result.canonicalByteLength},
          ${transaction.json(json(result.findings))}, ${result.hasBlockingFindings}
        )
      `;
      const preview = modelOperationsPreviewSchema.parse({
        baseHeadSnapshotSha256: base.snapshotSha256,
        baseRevision: branch.revision,
        branchId: branch.id,
        canonicalByteLength: result.canonicalByteLength,
        expiresAt: expiresAt.toISOString(),
        findings: result.findings,
        hasBlockingFindings: result.hasBlockingFindings,
        id: previewId,
        operations: command.operations,
        projectId: command.projectId,
        resultSnapshotSha256: result.snapshotSha256,
      });
      await completeIdempotency(transaction, claim, "preview", previewId, 201);
      return { preview, replayed: false };
    });
  }

  async #loadCommitResponse(
    transaction: TransactionSql,
    input: {
      readonly branchId: string;
      readonly commitId: string;
      readonly modelId: string;
      readonly profile: ModelProfile;
      readonly projectId: string;
      readonly tenantId: string;
    },
  ): Promise<ModelCommitResponse> {
    const branches = await transaction<BranchRow[]>`
      SELECT * FROM model_branches
      WHERE tenant_id = ${input.tenantId}::uuid
        AND project_id = ${input.projectId}::uuid
        AND model_id = ${input.modelId}::uuid
        AND profile = ${input.profile}
        AND id = ${input.branchId}::uuid
      LIMIT 1
    `;
    const commits = await transaction<CommitRow[]>`
      SELECT * FROM model_operation_commits
      WHERE tenant_id = ${input.tenantId}::uuid
        AND project_id = ${input.projectId}::uuid
        AND model_id = ${input.modelId}::uuid
        AND profile = ${input.profile}
        AND branch_id = ${input.branchId}::uuid
        AND id = ${input.commitId}::uuid
      LIMIT 1
    `;
    const branch = branches[0];
    const commit = commits[0];
    if (branch === undefined || commit === undefined) {
      throw new Error("Committed model operation response is incomplete.");
    }
    const operations = await transaction<{ readonly id: string }[]>`
      SELECT id FROM model_operation_envelopes
      WHERE tenant_id = ${input.tenantId}::uuid
        AND project_id = ${input.projectId}::uuid
        AND model_id = ${input.modelId}::uuid
        AND profile = ${input.profile}
        AND branch_id = ${input.branchId}::uuid
        AND commit_id = ${input.commitId}::uuid
      ORDER BY ordinal
    `;
    const findings = z
      .array(geometryFindingSchema)
      .max(10_000)
      .parse(commit.validation_findings)
      .map(({ location, ...finding }) => ({
        ...finding,
        ...(location === undefined ? {} : { location }),
      }));
    return {
      branch: mapBranch(branch, {
        headSnapshotId: commit.snapshot_id,
        headSnapshotSha256: commit.snapshot_sha256,
        revision: commit.revision,
        updatedAt: isoTimestamp(commit.committed_at),
      }),
      commit: mapCommit(
        commit,
        operations.map(({ id }) => id),
      ),
      findings,
    };
  }

  async #persistCommit(
    transaction: TransactionSql,
    input: {
      readonly branch: BranchRow;
      readonly canonical: CanonicalOperationResult;
      readonly auditAction: ModelAuditAction;
      readonly command: CommitOperationsCommand | RestoreBranchCommand;
      readonly eventType: string;
      readonly message: string;
      readonly operations: readonly RetainedModelOperation[];
      readonly parent: ModelSnapshotRecord;
      readonly previewId?: string;
    },
  ): Promise<{ readonly commitId: string; readonly response: ModelCommitResponse }> {
    const wallClock = this.#clock();
    const afterBranch = new Date(new Date(input.branch.updated_at).getTime() + 1);
    const committedAt = wallClock > afterBranch ? wallClock : afterBranch;
    const snapshot = await insertSnapshot(transaction, {
      actorUserId: input.command.actor.userId,
      canonical: input.canonical,
      clock: () => committedAt,
      tenantId: input.command.actor.tenantId,
      uuid: this.#uuid,
    });
    const revision = input.branch.revision + 1;
    const commitId = this.#uuid();
    const operationIds = input.operations.map(() => this.#uuid());
    await transaction`
      INSERT INTO model_operation_commits (
        tenant_id, project_id, model_id, profile, branch_id, id, revision, message,
        preview_id, operation_count, parent_snapshot_id, parent_snapshot_sha256,
        parent_snapshot_version, snapshot_id, snapshot_sha256, snapshot_version,
        validation_findings, committed_by, committed_at, request_id, trace_id
      ) VALUES (
        ${input.command.actor.tenantId}::uuid, ${input.command.projectId}::uuid,
        ${input.branch.model_id}::uuid, ${input.command.profile}, ${input.branch.id}::uuid,
        ${commitId}::uuid, ${revision}, ${input.message}, ${input.previewId ?? null}::uuid,
        ${input.operations.length}, ${input.parent.id}::uuid, ${input.parent.snapshotSha256},
        ${input.parent.version}, ${snapshot.id}::uuid, ${snapshot.snapshotSha256},
        ${snapshot.version}, ${transaction.json(json(input.canonical.findings))},
        ${input.command.actor.userId}::uuid, ${committedAt.toISOString()}::timestamptz,
        ${input.command.correlation.requestId}, ${input.command.correlation.traceId}
      )
    `;
    for (let ordinal = 0; ordinal < input.operations.length; ordinal += 1) {
      const operation = input.operations[ordinal];
      const operationId = operationIds[ordinal];
      if (operation === undefined || operationId === undefined) {
        throw new Error("Operation commit allocation contains an ordinal gap.");
      }
      await transaction`
        INSERT INTO model_operation_envelopes (
          tenant_id, project_id, model_id, profile, branch_id, commit_id, id,
          revision, ordinal, schema_version, type, client_operation_id, reason,
          operation_payload, committed_by, committed_at
        ) VALUES (
          ${input.command.actor.tenantId}::uuid, ${input.command.projectId}::uuid,
          ${input.branch.model_id}::uuid, ${input.command.profile}, ${input.branch.id}::uuid,
          ${commitId}::uuid, ${operationId}::uuid, ${revision}, ${ordinal},
          ${operation.schemaVersion}, ${operation.type}, ${operation.clientOperationId}::uuid,
          ${operation.reason}, ${transaction.json(json(operation))},
          ${input.command.actor.userId}::uuid, ${committedAt.toISOString()}::timestamptz
        )
      `;
    }
    const advanced = await transaction<{ readonly id: string }[]>`
      UPDATE model_branches
      SET head_snapshot_id = ${snapshot.id}::uuid,
          head_snapshot_sha256 = ${snapshot.snapshotSha256},
          head_snapshot_version = ${snapshot.version},
          revision = ${revision}, updated_by = ${input.command.actor.userId}::uuid,
          updated_at = ${committedAt.toISOString()}::timestamptz
      WHERE tenant_id = ${input.command.actor.tenantId}::uuid
        AND project_id = ${input.command.projectId}::uuid
        AND model_id = ${input.branch.model_id}::uuid
        AND profile = ${input.command.profile}
        AND id = ${input.branch.id}::uuid
        AND revision = ${input.branch.revision}
        AND head_snapshot_id = ${input.branch.head_snapshot_id}::uuid
        AND head_snapshot_sha256 = ${input.branch.head_snapshot_sha256}
        AND head_snapshot_version = ${input.branch.head_snapshot_version}
      RETURNING id
    `;
    if (advanced.length !== 1) {
      throw new BranchRevisionConflictError({
        branchId: input.branch.id,
        currentHeadSnapshotSha256: input.branch.head_snapshot_sha256,
        currentRevision: input.branch.revision,
      });
    }
    await appendAuditAndOutbox(transaction, {
      action: input.auditAction,
      actorUserId: input.command.actor.userId,
      branch: input.branch,
      commitId,
      correlation: input.command.correlation,
      eventType: input.eventType,
      occurredAt: committedAt.toISOString(),
      operationTypes: input.operations.map(({ type }) => type),
      revision,
      snapshotId: snapshot.id,
      snapshotSha256: snapshot.snapshotSha256,
      tenantId: input.command.actor.tenantId,
      uuid: this.#uuid,
    });
    const response = await this.#loadCommitResponse(transaction, {
      branchId: input.branch.id,
      commitId,
      modelId: input.branch.model_id,
      profile: input.command.profile,
      projectId: input.command.projectId,
      tenantId: input.command.actor.tenantId,
    });
    return { commitId, response };
  }

  commit(command: CommitOperationsCommand) {
    return this.#sql.begin(async (transaction) => {
      await lockProject(transaction, command.actor.tenantId, command.projectId);
      const branch = await loadBranch(
        transaction,
        {
          branchId: command.branchId,
          profile: command.profile,
          projectId: command.projectId,
          tenantId: command.actor.tenantId,
        },
        true,
      );
      if (branch === undefined) throw notFound();
      const claim = idempotencyClaim(command, {
        branchId: branch.id,
        enforceBranch: true,
        modelId: branch.model_id,
        operation: "model.operation.commit",
        requestBody: {
          commitMessage: command.commitMessage,
          expectedHeadSnapshotSha256: command.expectedHeadSnapshotSha256,
          expectedRevision: command.expectedRevision,
          previewId: command.previewId,
        },
      });
      const idempotency = await claimIdempotency(transaction, claim);
      if (idempotency.kind === "replay") {
        if (idempotency.responseKind !== "commit") throw new Error("Invalid commit replay kind.");
        return {
          replayed: true,
          response: await this.#loadCommitResponse(transaction, {
            branchId: branch.id,
            commitId: idempotency.id,
            modelId: branch.model_id,
            profile: command.profile,
            projectId: command.projectId,
            tenantId: command.actor.tenantId,
          }),
        };
      }
      assertExpectedBranch(branch, command.expectedRevision, command.expectedHeadSnapshotSha256);
      const committed = await transaction<{ readonly id: string }[]>`
        SELECT id FROM model_operation_commits
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid
          AND model_id = ${branch.model_id}::uuid
          AND profile = ${command.profile}
          AND branch_id = ${branch.id}::uuid
          AND preview_id = ${command.previewId}::uuid
        LIMIT 1
      `;
      if (committed.length > 0) throw previewUnavailable("PREVIEW_ALREADY_COMMITTED");
      const previewRows = await transaction<PreviewRow[]>`
        SELECT * FROM model_operation_previews
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid
          AND model_id = ${branch.model_id}::uuid
          AND profile = ${command.profile}
          AND branch_id = ${branch.id}::uuid
          AND id = ${command.previewId}::uuid
          AND created_by = ${command.actor.userId}::uuid
        LIMIT 1
      `;
      const previewRow = previewRows[0];
      if (previewRow === undefined) throw previewUnavailable("PREVIEW_NOT_FOUND");
      if (new Date(previewRow.expires_at).getTime() <= this.#clock().getTime()) {
        throw previewUnavailable("PREVIEW_EXPIRED");
      }
      if (
        previewRow.base_revision !== branch.revision ||
        previewRow.base_snapshot_sha256 !== branch.head_snapshot_sha256
      ) {
        throw new BranchRevisionConflictError({
          branchId: branch.id,
          currentHeadSnapshotSha256: branch.head_snapshot_sha256,
          currentRevision: branch.revision,
        });
      }
      if (previewRow.has_blocking_findings) throw previewBlocked();
      const operations = z
        .array(modelOperationRequestSchema)
        .min(1)
        .max(50)
        .parse(previewRow.operation_payload);
      const payloadHash = createHash("sha256")
        .update(canonicalizeIJson(operations), "utf8")
        .digest("hex");
      if (payloadHash !== previewRow.operation_payload_sha256) {
        throw new Error("Stored model operation preview payload integrity failed.");
      }
      const parent = await loadSnapshot(transaction, {
        modelId: branch.model_id,
        profile: command.profile,
        projectId: command.projectId,
        snapshotId: branch.head_snapshot_id,
        snapshotSha256: branch.head_snapshot_sha256,
        tenantId: command.actor.tenantId,
      });
      if (parent === undefined || parent.version !== branch.head_snapshot_version) {
        throw new Error("Branch parent snapshot integrity could not be established.");
      }
      const result = reduceModelOperations(parent.snapshot, operations);
      if (
        result.hasBlockingFindings ||
        result.snapshotSha256 !== previewRow.result_snapshot_sha256 ||
        result.canonicalByteLength !== previewRow.result_canonical_byte_length ||
        canonicalizeIJson(result.findings) !== canonicalizeIJson(previewRow.findings)
      ) {
        throw new Error("Exact preview confirmation failed deterministic recomputation.");
      }
      const persisted = await this.#persistCommit(transaction, {
        auditAction: "model:operation:commit",
        branch,
        canonical: result,
        command,
        eventType: "model.operations.committed.v1",
        message: command.commitMessage,
        operations,
        parent,
        previewId: command.previewId,
      });
      await completeIdempotency(transaction, claim, "commit", persisted.commitId, 201);
      return { replayed: false, response: persisted.response };
    });
  }

  restore(command: RestoreBranchCommand) {
    return this.#sql.begin(async (transaction) => {
      await lockProject(transaction, command.actor.tenantId, command.projectId);
      const branch = await loadBranch(
        transaction,
        {
          branchId: command.branchId,
          profile: command.profile,
          projectId: command.projectId,
          tenantId: command.actor.tenantId,
        },
        true,
      );
      if (branch === undefined) throw notFound();
      const claim = idempotencyClaim(command, {
        branchId: branch.id,
        enforceBranch: true,
        modelId: branch.model_id,
        operation: "model.branch.restore",
        requestBody: {
          expectedHeadSnapshotSha256: command.expectedHeadSnapshotSha256,
          expectedRevision: command.expectedRevision,
          reason: command.reason,
          sourceSnapshotId: command.sourceSnapshotId,
          sourceSnapshotSha256: command.sourceSnapshotSha256,
        },
      });
      const idempotency = await claimIdempotency(transaction, claim);
      if (idempotency.kind === "replay") {
        if (idempotency.responseKind !== "commit") throw new Error("Invalid restore replay kind.");
        return {
          replayed: true,
          response: await this.#loadCommitResponse(transaction, {
            branchId: branch.id,
            commitId: idempotency.id,
            modelId: branch.model_id,
            profile: command.profile,
            projectId: command.projectId,
            tenantId: command.actor.tenantId,
          }),
        };
      }
      assertExpectedBranch(branch, command.expectedRevision, command.expectedHeadSnapshotSha256);
      const [parent, source] = await Promise.all([
        loadSnapshot(transaction, {
          modelId: branch.model_id,
          profile: command.profile,
          projectId: command.projectId,
          snapshotId: branch.head_snapshot_id,
          snapshotSha256: branch.head_snapshot_sha256,
          tenantId: command.actor.tenantId,
        }),
        loadSnapshot(transaction, {
          modelId: branch.model_id,
          profile: command.profile,
          projectId: command.projectId,
          snapshotId: command.sourceSnapshotId,
          snapshotSha256: command.sourceSnapshotSha256,
          tenantId: command.actor.tenantId,
        }),
      ]);
      if (parent === undefined || parent.version !== branch.head_snapshot_version) {
        throw new Error("Branch parent snapshot integrity could not be established.");
      }
      if (source === undefined) throw invalidSourceSnapshot();
      const canonical = validateAndCanonicalizeSnapshot(source.snapshot);
      if (canonical.hasBlockingFindings || canonical.snapshotSha256 !== source.snapshotSha256) {
        throw invalidSourceSnapshot();
      }
      const operation = createInternalSnapshotOperation({
        clientOperationId: this.#uuid(),
        reason: command.reason,
        sourceSnapshotId: source.id,
        sourceSnapshotSha256: source.snapshotSha256,
        type: "snapshot.restore.v1",
      });
      const persisted = await this.#persistCommit(transaction, {
        auditAction: "model:branch:restore",
        branch,
        canonical,
        command,
        eventType: "snapshot.restore.v1",
        message: command.reason,
        operations: [operation],
        parent,
      });
      await completeIdempotency(transaction, claim, "commit", persisted.commitId, 201);
      return { replayed: false, response: persisted.response };
    });
  }

  async listOperations(
    tenantId: string,
    projectId: string,
    profile: ModelProfile,
    branchId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<OperationHistoryPage> {
    const branch = await this.getBranch(tenantId, projectId, profile, branchId);
    if (branch === undefined) throw notFound();
    const pageSize = Math.max(1, Math.min(100, limit));
    const after = cursor === undefined ? undefined : parseCursor(cursor);
    const rows =
      after === undefined
        ? await this.#sql<OperationRow[]>`
          SELECT * FROM model_operation_envelopes
          WHERE tenant_id = ${tenantId}::uuid
            AND project_id = ${projectId}::uuid
            AND model_id = ${branch.modelId}::uuid
            AND profile = ${profile}
            AND branch_id = ${branchId}::uuid
          ORDER BY revision DESC, ordinal DESC, id DESC
          LIMIT ${pageSize + 1}
        `
        : await this.#sql<OperationRow[]>`
          SELECT * FROM model_operation_envelopes
          WHERE tenant_id = ${tenantId}::uuid
            AND project_id = ${projectId}::uuid
            AND model_id = ${branch.modelId}::uuid
            AND profile = ${profile}
            AND branch_id = ${branchId}::uuid
            AND (revision, ordinal, id) < (${after.revision}, ${after.ordinal}, ${after.id}::uuid)
          ORDER BY revision DESC, ordinal DESC, id DESC
          LIMIT ${pageSize + 1}
        `;
    const visible = rows.slice(0, pageSize);
    const lastVisible = visible.at(-1);
    const response = modelOperationHistoryResponseSchema.parse({
      ...(rows.length > pageSize && lastVisible !== undefined
        ? { nextCursor: cursorFor(lastVisible) }
        : {}),
      operations: visible.map((row) => ({
        branchId: row.branch_id,
        clientOperationId: row.client_operation_id,
        commitId: row.commit_id,
        committedAt: isoTimestamp(row.committed_at),
        committedBy: row.committed_by,
        id: row.id,
        ordinal: row.ordinal,
        projectId: row.project_id,
        reason: row.reason,
        revision: row.revision,
        schemaVersion: row.schema_version,
        type: row.type,
      })),
    });
    return response.nextCursor === undefined
      ? { operations: response.operations }
      : { nextCursor: response.nextCursor, operations: response.operations };
  }

  async compareBranches(
    tenantId: string,
    projectId: string,
    profile: ModelProfile,
    branchId: string,
    targetBranchId: string,
  ): Promise<BranchComparison | undefined> {
    const branches = await this.#sql<BranchRow[]>`
      SELECT * FROM model_branches
      WHERE tenant_id = ${tenantId}::uuid
        AND project_id = ${projectId}::uuid
        AND profile = ${profile}
        AND id IN (${branchId}::uuid, ${targetBranchId}::uuid)
      ORDER BY id
    `;
    const base = branches.find(({ id }) => id === branchId);
    const target = branches.find(({ id }) => id === targetBranchId);
    if (base === undefined || target === undefined || base.model_id !== target.model_id) {
      return undefined;
    }
    const [baseRows, targetRows] = await Promise.all([
      this.#sql<SnapshotRow[]>`
        SELECT id, project_id, model_id, profile, version, schema_version,
               canonical_snapshot, snapshot_sha256, canonical_byte_length, created_by, created_at
        FROM canonical_model_snapshots
        WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
          AND model_id = ${base.model_id}::uuid AND profile = ${profile}
          AND id = ${base.head_snapshot_id}::uuid
          AND snapshot_sha256 = ${base.head_snapshot_sha256}
        LIMIT 1
      `,
      this.#sql<SnapshotRow[]>`
        SELECT id, project_id, model_id, profile, version, schema_version,
               canonical_snapshot, snapshot_sha256, canonical_byte_length, created_by, created_at
        FROM canonical_model_snapshots
        WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
          AND model_id = ${target.model_id}::uuid AND profile = ${profile}
          AND id = ${target.head_snapshot_id}::uuid
          AND snapshot_sha256 = ${target.head_snapshot_sha256}
        LIMIT 1
      `,
    ]);
    if (baseRows[0] === undefined || targetRows[0] === undefined) {
      throw new Error("Branch comparison head snapshot is missing.");
    }
    const baseSnapshot = mapSnapshot(baseRows[0]).snapshot;
    const targetSnapshot = mapSnapshot(targetRows[0]).snapshot;
    const elementMap = (snapshot: CanonicalHomeSnapshot) =>
      new Map(
        Object.values(snapshot.elements)
          .flat()
          .map((element) => [element.id, canonicalizeIJson(element)] as const),
      );
    const left = elementMap(baseSnapshot);
    const right = elementMap(targetSnapshot);
    const ids = [...new Set([...left.keys(), ...right.keys()])].sort();
    const allChanges = ids.flatMap((elementId) => {
      const before = left.get(elementId);
      const after = right.get(elementId);
      if (before === after) return [];
      return [
        {
          elementId,
          kind: before === undefined ? "added" : after === undefined ? "removed" : "modified",
        } as const,
      ];
    });
    return modelBranchComparisonSchema.parse({
      baseBranchId: base.id,
      baseHeadSnapshotSha256: base.head_snapshot_sha256,
      changes: allChanges.slice(0, maximumComparisonChanges),
      projectId,
      targetBranchId: target.id,
      targetHeadSnapshotSha256: target.head_snapshot_sha256,
      truncated: allChanges.length > maximumComparisonChanges,
    });
  }

  verifyReplay(
    tenantId: string,
    projectId: string,
    profile: ModelProfile,
    branchId: string,
  ): Promise<ReplayVerification | undefined> {
    return this.#sql.begin(async (transaction) => {
      const branch = await loadBranch(
        transaction,
        { branchId, profile, projectId, tenantId },
        false,
      );
      if (branch === undefined) return undefined;
      const source = await loadSnapshot(transaction, {
        modelId: branch.model_id,
        profile,
        projectId,
        snapshotId: branch.source_snapshot_id,
        snapshotSha256: branch.source_snapshot_sha256,
        tenantId,
      });
      if (source === undefined || source.version !== branch.source_snapshot_version) {
        throw new Error("Branch replay source snapshot is missing.");
      }
      const commitRows = await transaction<CommitRow[]>`
        SELECT * FROM model_operation_commits
        WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
          AND model_id = ${branch.model_id}::uuid AND profile = ${profile}
          AND branch_id = ${branchId}::uuid
        ORDER BY revision
      `;
      const operationRows = await transaction<OperationRow[]>`
        SELECT * FROM model_operation_envelopes
        WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
          AND model_id = ${branch.model_id}::uuid AND profile = ${profile}
          AND branch_id = ${branchId}::uuid
        ORDER BY revision, ordinal
      `;
      const commits: RetainedOperationCommit[] = commitRows.map((commit) => ({
        operations: operationRows
          .filter(({ commit_id }) => commit_id === commit.id)
          .map((operation) => ({
            operation: upcastModelOperation(operation.operation_payload),
            ordinal: operation.ordinal,
            revision: operation.revision,
          })),
        revision: commit.revision,
        snapshotSha256: commit.snapshot_sha256,
      }));
      const replay = await replayModelOperationHistory(
        { id: source.id, snapshot: source.snapshot, snapshotSha256: source.snapshotSha256 },
        commits,
        async (snapshotId, snapshotSha256) => {
          const resolved = await loadSnapshot(transaction, {
            modelId: branch.model_id,
            profile,
            projectId,
            snapshotId,
            snapshotSha256,
            tenantId,
          });
          return resolved === undefined
            ? undefined
            : {
                id: resolved.id,
                snapshot: resolved.snapshot,
                snapshotSha256: resolved.snapshotSha256,
              };
        },
      );
      if (
        replay.finalSnapshotSha256 !== branch.head_snapshot_sha256 ||
        commits.length !== branch.revision
      ) {
        throw new Error("Branch replay does not reproduce the exact branch head.");
      }
      return {
        branchId,
        commitCount: commits.length,
        finalSnapshotSha256: replay.finalSnapshotSha256,
      };
    });
  }

  async cleanupExpiredPreviews(): Promise<number> {
    const rows = await this.#sql<{ readonly id: string }[]>`
      DELETE FROM model_operation_previews
      WHERE expires_at <= statement_timestamp()
      RETURNING id
    `;
    return rows.length;
  }

  async verifyEveryBranch(): Promise<readonly ReplayVerification[]> {
    const rows = await this.#sql<
      {
        readonly branch_id: string;
        readonly profile: ModelProfile;
        readonly project_id: string;
        readonly tenant_id: string;
      }[]
    >`
      SELECT tenant_id, project_id, profile, id AS branch_id
      FROM model_branches
      ORDER BY tenant_id, project_id, profile, id
    `;
    const verified: ReplayVerification[] = [];
    for (const row of rows) {
      const result = await this.verifyReplay(
        row.tenant_id,
        row.project_id,
        row.profile,
        row.branch_id,
      );
      if (result === undefined) throw new Error("Branch disappeared during replay verification.");
      verified.push(result);
    }
    return verified;
  }
}
