import {
  canonicalHomeSnapshotSchema,
  catalogAssetVersionSchema,
  catalogReleaseSchema,
  c12ConfirmationSourceSchema,
  optionOperationBundleSchema,
  specificationLineSchema,
  specificationSchema,
  substitutionConfirmationSchema,
  substitutionPreviewSchema,
  type C12ConfirmationSource,
  type Specification,
  type SpecificationLine,
  type SpecificationRevision,
} from "@interior-design/contracts";
import { validateAndCanonicalizeSnapshot } from "@interior-design/model-operations";
import {
  applySelectionBoard,
  buildSpecificationRevision,
  initialSelectionBoard,
  previewCatalogReplacement,
  specificationSha256,
  substituteSpecificationLine,
  verifySpecificationRevision,
} from "@interior-design/specification";
import { randomUUID } from "node:crypto";
import type { JSONValue, Sql, TransactionSql } from "postgres";
import { z } from "zod";

import { notFound } from "../identity/http.js";
import { specificationConflict } from "./errors.js";
import type {
  ConfirmSubstitutionCommand,
  ConfirmationPersistenceResult,
  CreateSpecificationCommand,
  PersistSubstitutionPreviewCommand,
  SpecificationClock,
  SpecificationRepository,
  SpecificationSceneBinding,
  SpecificationUuidFactory,
  UpdateSelectionBoardCommand,
  VerifiedSpecificationCreationSource,
  VerifiedSubstitutionSource,
} from "./types.js";

interface SpecificationHeadRow {
  readonly current_revision: number;
  readonly id: string;
  readonly project_id: string;
  readonly schema_version: string;
  readonly status: "working";
  readonly updated_at: Date | string;
}

interface RevisionRow {
  readonly branch_id: string;
  readonly branch_revision: number;
  readonly catalog_release_id: string;
  readonly catalog_release_sha256: string;
  readonly created_at: Date | string;
  readonly created_by: string;
  readonly model_snapshot_id: string;
  readonly model_snapshot_sha256: string;
  readonly revision: number;
  readonly revision_sha256: string;
  readonly schema_version: string;
  readonly source_confirmation: unknown;
}

interface EffectRow {
  readonly operation: string;
  readonly project_id: string;
  readonly request_sha256: string;
  readonly response_id: string | null;
  readonly response_kind: "confirmation" | "preview" | "specification" | null;
}

interface PreviewRow {
  readonly operation_payload: unknown;
  readonly operation_sha256: string;
  readonly preview_payload: unknown;
  readonly state: "confirmed" | "expired" | "pending";
}

interface PgError {
  readonly code?: string;
}

type FailureStage = "after-model-write" | "after-specification-write";

function json(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function laterIso(now: Date, previous: Date | number | string): string {
  const previousMs = new Date(previous).getTime();
  return new Date(Math.max(now.getTime(), previousMs + 1)).toISOString();
}

function pgCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null ? (error as PgError).code : undefined;
}

/**
 * Collapse integrity failures at the repository boundary so a caller cannot use a
 * tenant-scoped foreign key as an existence oracle. The original PostgreSQL detail
 * is deliberately never copied into the public error.
 */
export function mapSpecificationDatabaseError(error: unknown): never {
  if (pgCode(error) === "23503") throw notFound();
  if (pgCode(error) === "23505" || pgCode(error) === "40001" || pgCode(error) === "40P01") {
    throw specificationConflict(
      "CONFIRMATION_CONFLICT",
      "The exact C13 transaction lost a concurrency fence.",
    );
  }
  throw error;
}

async function setTenant(transaction: TransactionSql, tenantId: string): Promise<void> {
  await transaction`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
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

async function claimEffect(
  transaction: TransactionSql,
  input: {
    readonly actorUserId: string;
    readonly idempotencyKey: string;
    readonly operation: string;
    readonly projectId: string;
    readonly requestSha256: string;
    readonly tenantId: string;
  },
): Promise<EffectRow | undefined> {
  await transaction`
    INSERT INTO specification_idempotency_effects (
      tenant_id, project_id, idempotency_key, actor_user_id, operation,
      request_sha256, created_at
    ) VALUES (
      ${input.tenantId}::uuid, ${input.projectId}::uuid, ${input.idempotencyKey},
      ${input.actorUserId}::uuid, ${input.operation}, ${input.requestSha256}, clock_timestamp()
    ) ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
  `;
  const rows = await transaction<EffectRow[]>`
    SELECT operation, project_id, request_sha256, response_id, response_kind
    FROM specification_idempotency_effects
    WHERE tenant_id = ${input.tenantId}::uuid AND idempotency_key = ${input.idempotencyKey}
    FOR UPDATE
  `;
  const row = rows[0];
  if (row === undefined) throw new Error("C13 idempotency claim disappeared.");
  if (
    row.project_id !== input.projectId ||
    row.operation !== input.operation ||
    row.request_sha256 !== input.requestSha256
  ) {
    throw specificationConflict(
      "IDEMPOTENCY_CONFLICT",
      "The C13 idempotency key was already used for a different exact request.",
    );
  }
  return row.response_id === null ? undefined : row;
}

async function completeEffect(
  transaction: TransactionSql,
  input: {
    readonly idempotencyKey: string;
    readonly responseId: string;
    readonly responseKind: "confirmation" | "preview" | "specification";
    readonly responseStatus: 200 | 201;
    readonly tenantId: string;
  },
): Promise<void> {
  const rows = await transaction<{ readonly idempotency_key: string }[]>`
    UPDATE specification_idempotency_effects
    SET response_kind = ${input.responseKind}, response_id = ${input.responseId}::uuid,
        response_status = ${input.responseStatus}, completed_at = clock_timestamp()
    WHERE tenant_id = ${input.tenantId}::uuid AND idempotency_key = ${input.idempotencyKey}
      AND completed_at IS NULL
    RETURNING idempotency_key
  `;
  if (rows.length !== 1) throw new Error("C13 idempotency completion lost its fence.");
}

async function loadLines(
  transaction: TransactionSql,
  tenantId: string,
  projectId: string,
  specificationId: string,
  revision: number,
): Promise<SpecificationLine[]> {
  const rows = await transaction<{ readonly line_payload: unknown }[]>`
    SELECT line_payload FROM specification_lines
    WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
      AND specification_id = ${specificationId}::uuid AND revision = ${revision}
    ORDER BY element_id, line_id
    LIMIT 1024
  `;
  return rows.map(({ line_payload }) => specificationLineSchema.parse(line_payload));
}

async function loadRevision(
  transaction: TransactionSql,
  tenantId: string,
  projectId: string,
  specificationId: string,
  revision: number,
): Promise<SpecificationRevision | undefined> {
  const rows = await transaction<RevisionRow[]>`
    SELECT * FROM specification_revisions
    WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
      AND specification_id = ${specificationId}::uuid AND revision = ${revision}
    LIMIT 1
  `;
  const row = rows[0];
  if (row === undefined) return undefined;
  return verifySpecificationRevision({
    branchId: row.branch_id,
    branchRevision: row.branch_revision,
    catalogReleaseId: row.catalog_release_id,
    catalogReleaseSha256: row.catalog_release_sha256,
    createdAt: iso(row.created_at),
    createdBy: row.created_by,
    lines: await loadLines(transaction, tenantId, projectId, specificationId, revision),
    modelSnapshotId: row.model_snapshot_id,
    modelSnapshotSha256: row.model_snapshot_sha256,
    revision: row.revision,
    revisionSha256: row.revision_sha256,
    schemaVersion: "c13-specification-revision-v1",
    sourceConfirmation: c12ConfirmationSourceSchema.parse(row.source_confirmation),
  });
}

async function loadSpecification(
  transaction: TransactionSql,
  tenantId: string,
  projectId: string,
  specificationId: string,
): Promise<Specification | undefined> {
  const heads = await transaction<SpecificationHeadRow[]>`
    SELECT id, project_id, schema_version, status, current_revision, updated_at
    FROM specifications
    WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
      AND id = ${specificationId}::uuid
    LIMIT 1
  `;
  const head = heads[0];
  if (head === undefined) return undefined;
  const revision = await loadRevision(
    transaction,
    tenantId,
    projectId,
    specificationId,
    head.current_revision,
  );
  if (revision === undefined) throw new Error("C13 specification head revision disappeared.");
  return specificationSchema.parse({
    currentRevision: revision,
    projectId,
    schemaVersion: "c13-specification-v1",
    selectionBoard: initialSelectionBoard(revision.lines, revision.revision),
    specificationId,
    status: "working",
  });
}

async function insertRevision(
  transaction: TransactionSql,
  input: {
    readonly modelId: string;
    readonly modelSnapshotVersion: number;
    readonly projectId: string;
    readonly revision: SpecificationRevision;
    readonly specificationId: string;
    readonly tenantId: string;
  },
): Promise<void> {
  const revision = verifySpecificationRevision(input.revision);
  await transaction`
    INSERT INTO specification_revisions (
      tenant_id, project_id, specification_id, revision, schema_version, revision_sha256,
      branch_id, branch_revision, model_id, model_profile, model_snapshot_id,
      model_snapshot_sha256, model_snapshot_version, catalog_release_id,
      catalog_release_sha256, source_job_id, source_option_id, source_confirmation,
      created_by, created_at
    ) VALUES (
      ${input.tenantId}::uuid, ${input.projectId}::uuid, ${input.specificationId}::uuid,
      ${revision.revision}, ${revision.schemaVersion}, ${revision.revisionSha256},
      ${revision.branchId}::uuid, ${revision.branchRevision}, ${input.modelId}::uuid,
      'proposed', ${revision.modelSnapshotId}::uuid, ${revision.modelSnapshotSha256},
      ${input.modelSnapshotVersion}, ${revision.catalogReleaseId}::uuid,
      ${revision.catalogReleaseSha256}, ${revision.sourceConfirmation.jobId}::uuid,
      ${revision.sourceConfirmation.optionId}::uuid,
      ${transaction.json(json(revision.sourceConfirmation))}, ${revision.createdBy}::uuid,
      ${revision.createdAt}::timestamptz
    )
  `;
  for (const line of revision.lines) {
    await transaction`
      INSERT INTO specification_lines (
        tenant_id, project_id, specification_id, revision, line_id, element_id, kind,
        level_id, catalog_release_id, catalog_release_sha256, asset_version_id,
        asset_version_sha256, asset_content_sha256, asset_metadata_sha256,
        placement_projection_sha256, placement_policy_sha256, rights_record_sha256,
        line_payload
      ) VALUES (
        ${input.tenantId}::uuid, ${input.projectId}::uuid, ${input.specificationId}::uuid,
        ${revision.revision}, ${line.lineId}::uuid, ${line.elementId}::uuid, ${line.kind},
        ${line.levelId}::uuid, ${line.catalogReleaseId}::uuid, ${line.catalogReleaseSha256},
        ${line.assetVersionId}::uuid, ${line.assetVersionSha256}, ${line.assetContentSha256},
        ${line.assetMetadataSha256}, ${line.placementProjectionSha256},
        ${line.placementPolicySha256}, ${line.rightsRecordSha256},
        ${transaction.json(json(line))}
      )
    `;
  }
}

async function appendSpecificationEvent(
  transaction: TransactionSql,
  uuid: SpecificationUuidFactory,
  input: {
    readonly action: string;
    readonly actorUserId?: string;
    readonly correlation?: { readonly requestId: string; readonly traceId: string };
    readonly eventType: string;
    readonly outcome: "accepted" | "replayed" | "retry-required";
    readonly projectId: string;
    readonly revision: number;
    readonly specificationId: string;
    readonly tenantId: string;
    readonly timestamp: string;
  },
): Promise<void> {
  const metadata = { revision: input.revision };
  await transaction`
    INSERT INTO specification_audit_events (
      id, tenant_id, project_id, specification_id, revision, action, outcome,
      actor_user_id, request_id, trace_id, metadata, occurred_at
    ) VALUES (
      ${uuid.randomUUID()}::uuid, ${input.tenantId}::uuid, ${input.projectId}::uuid,
      ${input.specificationId}::uuid, ${input.revision}, ${input.action}, ${input.outcome},
      ${input.actorUserId ?? null}::uuid, ${input.correlation?.requestId ?? "c13-system-scene"},
      ${input.correlation?.traceId ?? "0".repeat(32)},
      ${transaction.json(json(metadata))}, ${input.timestamp}::timestamptz
    )
  `;
  await transaction`
    INSERT INTO specification_outbox (
      id, tenant_id, project_id, specification_id, revision, event_type,
      schema_version, payload, occurred_at
    ) VALUES (
      ${uuid.randomUUID()}::uuid, ${input.tenantId}::uuid, ${input.projectId}::uuid,
      ${input.specificationId}::uuid, ${input.revision}, ${input.eventType},
      'c13-specification-revision-v1',
      ${transaction.json(json({ revision: input.revision, specificationId: input.specificationId }))},
      ${input.timestamp}::timestamptz
    )
  `;
}

export class PostgresSpecificationRepository implements SpecificationRepository {
  readonly #clock: SpecificationClock;
  readonly #failureInjector: ((stage: FailureStage) => void) | undefined;
  readonly #sql: Sql;
  readonly #uuid: SpecificationUuidFactory;

  constructor(
    sql: Sql,
    options?: {
      readonly clock?: SpecificationClock;
      readonly failureInjector?: (stage: FailureStage) => void;
      readonly uuid?: SpecificationUuidFactory;
    },
  ) {
    this.#sql = sql;
    this.#clock = options?.clock ?? { now: () => new Date() };
    this.#failureInjector = options?.failureInjector;
    this.#uuid = options?.uuid ?? { randomUUID };
  }

  async #withTenant<T>(tenantId: string, callback: (transaction: TransactionSql) => Promise<T>) {
    try {
      return await this.#sql.begin(async (transaction) => {
        await setTenant(transaction, tenantId);
        return callback(transaction);
      });
    } catch (error) {
      mapSpecificationDatabaseError(error);
    }
  }

  resolveCreationSource(
    tenantId: string,
    projectId: string,
    request: CreateSpecificationCommand["request"],
  ): Promise<VerifiedSpecificationCreationSource | undefined> {
    return this.#withTenant(tenantId, async (transaction) => {
      const rows = await transaction<
        Array<{
          readonly asset_manifest_sha256: string;
          readonly branch_id: string;
          readonly branch_revision: number;
          readonly brief_content_sha256: string;
          readonly brief_id: string;
          readonly brief_revision: number;
          readonly bundle_payload: unknown;
          readonly commit_id: string;
          readonly confirmation_id: string;
          readonly job_id: string;
          readonly job_version: number;
          readonly option_id: string;
          readonly result_snapshot_id: string;
          readonly result_snapshot_sha256: string;
          readonly result_snapshot_version: number;
          readonly set_sha256: string;
          readonly snapshot_payload: unknown;
          readonly model_id: string;
        }>
      >`
        SELECT c.id AS confirmation_id, c.job_id, c.option_id, c.branch_id,
          c.branch_revision, c.commit_id, c.result_snapshot_id, c.result_snapshot_sha256,
          j.version AS job_version, j.brief_id, j.brief_revision, j.brief_content_sha256,
          j.asset_manifest_sha256, j.working_model_id AS model_id,
          s.set_sha256, b.bundle_payload, snap.version AS result_snapshot_version,
          snap.canonical_snapshot AS snapshot_payload
        FROM design_option_confirmations c
        JOIN design_option_jobs j
          ON j.tenant_id = c.tenant_id AND j.project_id = c.project_id AND j.id = c.job_id
        JOIN design_option_heads oh
          ON oh.tenant_id = c.tenant_id AND oh.project_id = c.project_id
          AND oh.job_id = c.job_id AND oh.option_id = c.option_id AND oh.status = 'confirmed'
        JOIN design_options o
          ON o.tenant_id = c.tenant_id AND o.project_id = c.project_id
          AND o.job_id = c.job_id AND o.id = c.option_id
        JOIN design_option_bundles b
          ON b.tenant_id = o.tenant_id AND b.project_id = o.project_id
          AND b.job_id = o.job_id AND b.id = o.bundle_id
        JOIN design_option_sets s
          ON s.tenant_id = b.tenant_id AND s.project_id = b.project_id AND s.job_id = b.job_id
        JOIN model_branches mb
          ON mb.tenant_id = c.tenant_id AND mb.project_id = c.project_id
          AND mb.profile = 'proposed' AND mb.id = c.branch_id
          AND mb.revision = c.branch_revision
          AND mb.head_snapshot_id = c.result_snapshot_id
          AND mb.head_snapshot_sha256 = c.result_snapshot_sha256
        JOIN model_operation_commits mc
          ON mc.tenant_id = c.tenant_id AND mc.project_id = c.project_id
          AND mc.profile = 'proposed' AND mc.branch_id = c.branch_id AND mc.id = c.commit_id
          AND mc.snapshot_id = c.result_snapshot_id
          AND mc.snapshot_sha256 = c.result_snapshot_sha256
        JOIN canonical_model_snapshots snap
          ON snap.tenant_id = c.tenant_id AND snap.project_id = c.project_id
          AND snap.profile = 'proposed' AND snap.id = c.result_snapshot_id
          AND snap.snapshot_sha256 = c.result_snapshot_sha256
        JOIN design_briefs db
          ON db.tenant_id = j.tenant_id AND db.project_id = j.project_id
          AND db.id = j.brief_id AND db.current_revision = j.brief_revision
          AND db.current_status = 'accepted'
        JOIN design_brief_revisions dbr
          ON dbr.tenant_id = db.tenant_id AND dbr.project_id = db.project_id
          AND dbr.brief_id = db.id AND dbr.revision = db.current_revision
          AND dbr.content_sha256 = j.brief_content_sha256
        WHERE c.tenant_id = ${tenantId}::uuid AND c.project_id = ${projectId}::uuid
          AND c.id = ${request.confirmationId}::uuid
        LIMIT 1
      `;
      const row = rows[0];
      if (row === undefined) return undefined;
      const bundle = optionOperationBundleSchema.parse(row.bundle_payload);
      const releases = await transaction<{ readonly release_payload: unknown }[]>`
        SELECT release_payload FROM catalog_releases
        WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
          AND id = ${request.catalogReleaseId}::uuid
          AND manifest_sha256 = ${request.catalogReleaseSha256} AND status = 'published'
        LIMIT 1
      `;
      const releaseRow = releases[0];
      if (releaseRow === undefined) return undefined;
      const catalogRelease = catalogReleaseSchema.parse(releaseRow.release_payload);
      const assetRows = await transaction<{ readonly asset_payload: unknown }[]>`
        SELECT av.asset_payload FROM catalog_release_assets ra
        JOIN catalog_asset_versions av
          ON av.tenant_id = ra.tenant_id AND av.project_id = ra.project_id
          AND av.id = ra.asset_version_id AND av.version_sha256 = ra.asset_version_sha256
        WHERE ra.tenant_id = ${tenantId}::uuid AND ra.project_id = ${projectId}::uuid
          AND ra.release_id = ${request.catalogReleaseId}::uuid
          AND ra.release_sha256 = ${request.catalogReleaseSha256}
        ORDER BY ra.ordinal
        LIMIT 512
      `;
      const source: C12ConfirmationSource = c12ConfirmationSourceSchema.parse({
        acceptedBrief: {
          briefId: row.brief_id,
          contentSha256: row.brief_content_sha256,
          revision: row.brief_revision,
        },
        assetManifestSha256: row.asset_manifest_sha256,
        branchId: row.branch_id,
        branchRevision: row.branch_revision,
        bundleId: bundle.id,
        bundleSha256: bundle.bundleSha256,
        candidateSnapshotSha256: bundle.candidateSnapshotSha256,
        commitId: row.commit_id,
        confirmationId: row.confirmation_id,
        jobId: row.job_id,
        jobVersion: row.job_version,
        modelId: row.model_id,
        optionId: row.option_id,
        optionSetSha256: row.set_sha256,
        profile: "proposed",
        resultSnapshotId: row.result_snapshot_id,
        resultSnapshotSha256: row.result_snapshot_sha256,
        resultSnapshotVersion: row.result_snapshot_version,
      });
      const snapshot = canonicalHomeSnapshotSchema.parse(row.snapshot_payload);
      const canonical = validateAndCanonicalizeSnapshot(snapshot);
      if (
        canonical.hasBlockingFindings ||
        canonical.snapshotSha256 !== row.result_snapshot_sha256
      ) {
        return undefined;
      }
      return {
        assets: assetRows.map(({ asset_payload }) =>
          catalogAssetVersionSchema.parse(asset_payload),
        ),
        bundle,
        catalogRelease,
        catalogReleaseSha256: request.catalogReleaseSha256,
        snapshot: canonical.snapshot,
        source,
      };
    });
  }

  createSpecification(command: CreateSpecificationCommand) {
    return this.#withTenant(command.actor.tenantId, async (transaction) => {
      await lockProject(transaction, command.actor.tenantId, command.projectId);
      const replay = await claimEffect(transaction, {
        actorUserId: command.actor.userId,
        idempotencyKey: command.idempotencyKey,
        operation: "specification.create",
        projectId: command.projectId,
        requestSha256: command.requestSha256,
        tenantId: command.actor.tenantId,
      });
      if (replay !== undefined) {
        if (replay.response_kind !== "specification" || replay.response_id === null) {
          throw new Error("C13 creation replay has the wrong response kind.");
        }
        const specification = await loadSpecification(
          transaction,
          command.actor.tenantId,
          command.projectId,
          replay.response_id,
        );
        if (specification === undefined) throw new Error("C13 creation replay disappeared.");
        return { replayed: true, specification };
      }
      const sourceRows = await transaction<{ readonly ok: boolean }[]>`
        SELECT true AS ok FROM design_option_confirmations c
        JOIN design_option_jobs j
          ON j.tenant_id = c.tenant_id AND j.project_id = c.project_id AND j.id = c.job_id
          AND j.version = ${command.verified.source.jobVersion} AND j.state = 'succeeded'
          AND j.brief_id = ${command.verified.source.acceptedBrief.briefId}::uuid
          AND j.brief_revision = ${command.verified.source.acceptedBrief.revision}
          AND j.brief_content_sha256 = ${command.verified.source.acceptedBrief.contentSha256}
          AND j.asset_manifest_sha256 = ${command.verified.source.assetManifestSha256}
        JOIN design_option_heads oh
          ON oh.tenant_id = c.tenant_id AND oh.project_id = c.project_id
          AND oh.job_id = c.job_id AND oh.option_id = c.option_id AND oh.status = 'confirmed'
        JOIN design_options o
          ON o.tenant_id = c.tenant_id AND o.project_id = c.project_id
          AND o.job_id = c.job_id AND o.id = c.option_id
        JOIN design_option_bundles ob
          ON ob.tenant_id = o.tenant_id AND ob.project_id = o.project_id
          AND ob.job_id = o.job_id AND ob.id = o.bundle_id
          AND ob.id = ${command.verified.source.bundleId}::uuid
          AND ob.bundle_sha256 = ${command.verified.source.bundleSha256}
          AND ob.candidate_snapshot_sha256 = ${command.verified.source.candidateSnapshotSha256}
        JOIN design_option_sets os
          ON os.tenant_id = ob.tenant_id AND os.project_id = ob.project_id
          AND os.job_id = ob.job_id
          AND os.set_sha256 = ${command.verified.source.optionSetSha256}
        JOIN design_briefs db
          ON db.tenant_id = j.tenant_id AND db.project_id = j.project_id
          AND db.id = j.brief_id AND db.current_revision = j.brief_revision
          AND db.current_status = 'accepted'
        JOIN design_brief_revisions dbr
          ON dbr.tenant_id = db.tenant_id AND dbr.project_id = db.project_id
          AND dbr.brief_id = db.id AND dbr.revision = db.current_revision
          AND dbr.status = 'accepted' AND dbr.content_sha256 = j.brief_content_sha256
        JOIN model_branches b
          ON b.tenant_id = c.tenant_id AND b.project_id = c.project_id
          AND b.profile = 'proposed' AND b.id = c.branch_id
          AND b.revision = c.branch_revision AND b.head_snapshot_id = c.result_snapshot_id
          AND b.head_snapshot_sha256 = c.result_snapshot_sha256
        JOIN model_operation_commits mc
          ON mc.tenant_id = c.tenant_id AND mc.project_id = c.project_id
          AND mc.profile = 'proposed' AND mc.branch_id = c.branch_id
          AND mc.id = c.commit_id AND mc.id = ${command.verified.source.commitId}::uuid
          AND mc.snapshot_id = c.result_snapshot_id
          AND mc.snapshot_sha256 = c.result_snapshot_sha256
        JOIN canonical_model_snapshots snap
          ON snap.tenant_id = c.tenant_id AND snap.project_id = c.project_id
          AND snap.profile = 'proposed' AND snap.id = c.result_snapshot_id
          AND snap.snapshot_sha256 = c.result_snapshot_sha256
          AND snap.version = ${command.verified.source.resultSnapshotVersion}
        JOIN catalog_releases r
          ON r.tenant_id = c.tenant_id AND r.project_id = c.project_id
          AND r.id = ${command.request.catalogReleaseId}::uuid
          AND r.manifest_sha256 = ${command.request.catalogReleaseSha256}
          AND r.status = 'published'
        WHERE c.tenant_id = ${command.actor.tenantId}::uuid
          AND c.project_id = ${command.projectId}::uuid
          AND c.id = ${command.request.confirmationId}::uuid
          AND c.option_id = ${command.verified.source.optionId}::uuid
          AND c.result_snapshot_sha256 = ${command.verified.source.resultSnapshotSha256}
        FOR SHARE OF c, j, oh, o, ob, os, db, dbr, b, mc, snap, r
      `;
      if (sourceRows.length !== 1) {
        throw specificationConflict(
          "SOURCE_CHANGED",
          "The exact creation source changed before commit.",
        );
      }
      const revision = command.specification.currentRevision;
      await transaction`
        INSERT INTO specifications (
          tenant_id, project_id, id, schema_version, status, current_revision,
          source_job_id, source_option_id, source_confirmation_id,
          created_by, created_at, updated_by, updated_at
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${command.projectId}::uuid,
          ${command.specification.specificationId}::uuid, ${command.specification.schemaVersion},
          'working', 1, ${revision.sourceConfirmation.jobId}::uuid,
          ${revision.sourceConfirmation.optionId}::uuid,
          ${revision.sourceConfirmation.confirmationId}::uuid,
          ${command.actor.userId}::uuid, ${revision.createdAt}::timestamptz,
          ${command.actor.userId}::uuid, ${revision.createdAt}::timestamptz
        )
      `;
      await insertRevision(transaction, {
        modelId: revision.sourceConfirmation.modelId,
        modelSnapshotVersion: revision.sourceConfirmation.resultSnapshotVersion,
        projectId: command.projectId,
        revision,
        specificationId: command.specification.specificationId,
        tenantId: command.actor.tenantId,
      });
      await appendSpecificationEvent(transaction, this.#uuid, {
        action: "specification.create",
        actorUserId: command.actor.userId,
        correlation: command.correlation,
        eventType: "specification.created.v1",
        outcome: "accepted",
        projectId: command.projectId,
        revision: 1,
        specificationId: command.specification.specificationId,
        tenantId: command.actor.tenantId,
        timestamp: revision.createdAt,
      });
      await completeEffect(transaction, {
        idempotencyKey: command.idempotencyKey,
        responseId: command.specification.specificationId,
        responseKind: "specification",
        responseStatus: 201,
        tenantId: command.actor.tenantId,
      });
      return { replayed: false, specification: command.specification };
    });
  }

  findSpecification(tenantId: string, projectId: string, specificationId: string) {
    return this.#withTenant(tenantId, (transaction) =>
      loadSpecification(transaction, tenantId, projectId, specificationId),
    );
  }

  listSpecifications(tenantId: string, projectId: string) {
    return this.#withTenant(tenantId, async (transaction) => {
      const rows = await transaction<{ readonly id: string }[]>`
        SELECT id FROM specifications
        WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
        ORDER BY updated_at DESC, id
        LIMIT 100
      `;
      const values = await Promise.all(
        rows.map(({ id }) => loadSpecification(transaction, tenantId, projectId, id)),
      );
      return values.filter((value): value is Specification => value !== undefined);
    });
  }

  listRevisions(tenantId: string, projectId: string, specificationId: string) {
    return this.#withTenant(tenantId, async (transaction) => {
      const rows = await transaction<{ readonly revision: number }[]>`
        SELECT revision FROM specification_revisions
        WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
          AND specification_id = ${specificationId}::uuid
        ORDER BY revision
        LIMIT 1000
      `;
      const revisions = await Promise.all(
        rows.map(({ revision }) =>
          loadRevision(transaction, tenantId, projectId, specificationId, revision),
        ),
      );
      return revisions.filter((value): value is SpecificationRevision => value !== undefined);
    });
  }

  updateSelectionBoard(command: UpdateSelectionBoardCommand) {
    return this.#withTenant(command.actor.tenantId, async (transaction) => {
      await lockProject(transaction, command.actor.tenantId, command.projectId);
      const replay = await claimEffect(transaction, {
        actorUserId: command.actor.userId,
        idempotencyKey: command.idempotencyKey,
        operation: "specification.update",
        projectId: command.projectId,
        requestSha256: command.requestSha256,
        tenantId: command.actor.tenantId,
      });
      if (replay !== undefined) {
        const specification =
          replay.response_id === null
            ? undefined
            : await loadSpecification(
                transaction,
                command.actor.tenantId,
                command.projectId,
                replay.response_id,
              );
        if (specification === undefined) throw new Error("C13 update replay disappeared.");
        return { replayed: true, specification };
      }
      const heads = await transaction<SpecificationHeadRow[]>`
        SELECT id, project_id, schema_version, status, current_revision, updated_at
        FROM specifications
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid
          AND id = ${command.specificationId}::uuid
        FOR UPDATE
      `;
      const head = heads[0];
      if (head === undefined) throw notFound();
      if (head.current_revision !== command.request.expectedRevision) {
        throw specificationConflict(
          "SPECIFICATION_REVISION_CONFLICT",
          "The specification revision changed before update.",
        );
      }
      const current = await loadRevision(
        transaction,
        command.actor.tenantId,
        command.projectId,
        command.specificationId,
        head.current_revision,
      );
      if (current === undefined) throw new Error("C13 current revision disappeared.");
      const snapshotRows = await transaction<{ readonly version: number }[]>`
        SELECT version FROM canonical_model_snapshots
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid
          AND model_id = ${current.sourceConfirmation.modelId}::uuid
          AND profile = 'proposed' AND id = ${current.modelSnapshotId}::uuid
          AND snapshot_sha256 = ${current.modelSnapshotSha256}
        LIMIT 1
      `;
      const snapshotVersion = snapshotRows[0]?.version;
      if (snapshotVersion === undefined) {
        throw specificationConflict(
          "SOURCE_CHANGED",
          "The exact C5 snapshot changed before the selection-board update.",
        );
      }
      const createdAt = laterIso(this.#clock.now(), head.updated_at);
      const next = applySelectionBoard(current, command.request.entries, {
        branchId: current.branchId,
        branchRevision: current.branchRevision,
        catalogReleaseId: current.catalogReleaseId,
        catalogReleaseSha256: current.catalogReleaseSha256,
        createdAt,
        createdBy: command.actor.userId,
        modelSnapshotId: current.modelSnapshotId,
        modelSnapshotSha256: current.modelSnapshotSha256,
        revision: current.revision + 1,
      });
      await insertRevision(transaction, {
        modelId: current.sourceConfirmation.modelId,
        modelSnapshotVersion: snapshotVersion,
        projectId: command.projectId,
        revision: next,
        specificationId: command.specificationId,
        tenantId: command.actor.tenantId,
      });
      const updated = await transaction<{ readonly id: string }[]>`
        UPDATE specifications SET current_revision = current_revision + 1,
          updated_by = ${command.actor.userId}::uuid, updated_at = ${createdAt}::timestamptz
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid
          AND id = ${command.specificationId}::uuid
          AND current_revision = ${current.revision}
        RETURNING id
      `;
      if (updated.length !== 1) {
        throw specificationConflict(
          "SPECIFICATION_REVISION_CONFLICT",
          "The head advancement lost its fence.",
        );
      }
      await appendSpecificationEvent(transaction, this.#uuid, {
        action: "specification.update",
        actorUserId: command.actor.userId,
        correlation: command.correlation,
        eventType: "specification.updated.v1",
        outcome: "accepted",
        projectId: command.projectId,
        revision: next.revision,
        specificationId: command.specificationId,
        tenantId: command.actor.tenantId,
        timestamp: createdAt,
      });
      await completeEffect(transaction, {
        idempotencyKey: command.idempotencyKey,
        responseId: command.specificationId,
        responseKind: "specification",
        responseStatus: 200,
        tenantId: command.actor.tenantId,
      });
      const specification = await loadSpecification(
        transaction,
        command.actor.tenantId,
        command.projectId,
        command.specificationId,
      );
      if (specification === undefined) throw new Error("Updated C13 specification disappeared.");
      return { replayed: false, specification };
    });
  }

  resolveSubstitutionSource(
    tenantId: string,
    projectId: string,
    specificationId: string,
    request: PersistSubstitutionPreviewCommand["request"],
  ): Promise<VerifiedSubstitutionSource | undefined> {
    return this.#withTenant(tenantId, async (transaction) => {
      const specification = await loadSpecification(
        transaction,
        tenantId,
        projectId,
        specificationId,
      );
      if (
        specification === undefined ||
        specification.currentRevision.revision !== request.expectedSpecificationRevision ||
        specification.currentRevision.branchRevision !== request.expectedBranchRevision
      ) {
        return undefined;
      }
      const line = specification.currentRevision.lines.find(
        ({ elementId }) => elementId === request.elementId,
      );
      if (line === undefined) return undefined;
      const branches = await transaction<
        Array<{
          readonly head_snapshot_id: string;
          readonly head_snapshot_sha256: string;
          readonly head_snapshot_version: number;
          readonly revision: number;
          readonly snapshot_payload: unknown;
        }>
      >`
        SELECT b.revision, b.head_snapshot_id, b.head_snapshot_sha256,
          b.head_snapshot_version, s.canonical_snapshot AS snapshot_payload
        FROM model_branches b
        JOIN canonical_model_snapshots s
          ON s.tenant_id = b.tenant_id AND s.project_id = b.project_id
          AND s.model_id = b.model_id AND s.profile = b.profile
          AND s.id = b.head_snapshot_id AND s.snapshot_sha256 = b.head_snapshot_sha256
          AND s.version = b.head_snapshot_version
        WHERE b.tenant_id = ${tenantId}::uuid AND b.project_id = ${projectId}::uuid
          AND b.profile = 'proposed' AND b.id = ${specification.currentRevision.branchId}::uuid
          AND b.revision = ${request.expectedBranchRevision}
          AND b.head_snapshot_id = ${specification.currentRevision.modelSnapshotId}::uuid
          AND b.head_snapshot_sha256 = ${specification.currentRevision.modelSnapshotSha256}
        LIMIT 1
      `;
      const branch = branches[0];
      if (branch === undefined) return undefined;
      const assets = await transaction<{ readonly asset_payload: unknown }[]>`
        SELECT av.asset_payload FROM catalog_release_assets ra
        JOIN catalog_asset_versions av
          ON av.tenant_id = ra.tenant_id AND av.project_id = ra.project_id
          AND av.id = ra.asset_version_id AND av.version_sha256 = ra.asset_version_sha256
        JOIN catalog_releases r
          ON r.tenant_id = ra.tenant_id AND r.project_id = ra.project_id
          AND r.id = ra.release_id AND r.manifest_sha256 = ra.release_sha256
        WHERE ra.tenant_id = ${tenantId}::uuid AND ra.project_id = ${projectId}::uuid
          AND ra.release_id = ${specification.currentRevision.catalogReleaseId}::uuid
          AND ra.release_sha256 = ${specification.currentRevision.catalogReleaseSha256}
          AND ra.asset_version_id = ${request.replacementAssetVersionId}::uuid
          AND r.status = 'published' AND av.lifecycle = 'approved'
          AND av.rights_review_state = 'approved'
        LIMIT 1
      `;
      const assetRow = assets[0];
      if (assetRow === undefined) return undefined;
      const snapshot = canonicalHomeSnapshotSchema.parse(branch.snapshot_payload);
      const canonical = validateAndCanonicalizeSnapshot(snapshot);
      if (
        canonical.hasBlockingFindings ||
        canonical.snapshotSha256 !== branch.head_snapshot_sha256
      ) {
        return undefined;
      }
      return {
        asset: catalogAssetVersionSchema.parse(assetRow.asset_payload),
        branchRevision: branch.revision,
        branchSnapshotId: branch.head_snapshot_id,
        branchSnapshotSha256: branch.head_snapshot_sha256,
        branchSnapshotVersion: branch.head_snapshot_version,
        currentRevision: specification.currentRevision,
        line,
        snapshot: canonical.snapshot,
        specificationId,
      };
    });
  }

  persistSubstitutionPreview(command: PersistSubstitutionPreviewCommand) {
    return this.#withTenant(command.actor.tenantId, async (transaction) => {
      await lockProject(transaction, command.actor.tenantId, command.projectId);
      const replay = await claimEffect(transaction, {
        actorUserId: command.actor.userId,
        idempotencyKey: command.idempotencyKey,
        operation: "specification.substitution.preview",
        projectId: command.projectId,
        requestSha256: command.requestSha256,
        tenantId: command.actor.tenantId,
      });
      if (replay !== undefined) {
        if (replay.response_id === null) throw new Error("C13 preview replay disappeared.");
        const rows = await transaction<PreviewRow[]>`
          SELECT p.preview_payload, p.operation_payload, p.operation_sha256, h.state
          FROM specification_substitution_previews p
          JOIN specification_substitution_heads h
            ON h.tenant_id = p.tenant_id AND h.project_id = p.project_id
            AND h.specification_id = p.specification_id AND h.preview_id = p.id
          WHERE p.tenant_id = ${command.actor.tenantId}::uuid
            AND p.project_id = ${command.projectId}::uuid AND p.id = ${replay.response_id}::uuid
          LIMIT 1
        `;
        const row = rows[0];
        if (row === undefined) throw new Error("C13 preview replay row disappeared.");
        return { preview: substitutionPreviewSchema.parse(row.preview_payload), replayed: true };
      }
      const heads = await transaction<SpecificationHeadRow[]>`
        SELECT id, project_id, schema_version, status, current_revision, updated_at
        FROM specifications
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid
          AND id = ${command.preview.specificationId}::uuid
        FOR SHARE
      `;
      const head = heads[0];
      if (
        head === undefined ||
        head.current_revision !== command.request.expectedSpecificationRevision
      ) {
        throw specificationConflict(
          "SOURCE_CHANGED",
          "The specification changed before preview publication.",
        );
      }
      const branches = await transaction<
        Array<{
          readonly model_id: string;
          readonly revision: number;
          readonly head_snapshot_id: string;
          readonly head_snapshot_sha256: string;
          readonly head_snapshot_version: number;
        }>
      >`
        SELECT model_id, revision, head_snapshot_id, head_snapshot_sha256, head_snapshot_version
        FROM model_branches
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid AND profile = 'proposed'
          AND id = ${command.verified.currentRevision.branchId}::uuid
        FOR SHARE
      `;
      const branch = branches[0];
      if (
        branch === undefined ||
        branch.revision !== command.request.expectedBranchRevision ||
        branch.head_snapshot_id !== command.preview.baseSnapshotId ||
        branch.head_snapshot_sha256 !== command.preview.baseSnapshotSha256 ||
        branch.head_snapshot_version !== command.verified.branchSnapshotVersion
      ) {
        throw specificationConflict(
          "SOURCE_CHANGED",
          "The exact C5 branch changed before preview publication.",
        );
      }
      const catalogRows = await transaction<{ readonly ok: boolean }[]>`
        SELECT true AS ok FROM catalog_release_assets ra
        JOIN catalog_asset_versions av
          ON av.tenant_id = ra.tenant_id AND av.project_id = ra.project_id
          AND av.id = ra.asset_version_id AND av.version_sha256 = ra.asset_version_sha256
        JOIN catalog_releases r
          ON r.tenant_id = ra.tenant_id AND r.project_id = ra.project_id
          AND r.id = ra.release_id AND r.manifest_sha256 = ra.release_sha256
        WHERE ra.tenant_id = ${command.actor.tenantId}::uuid
          AND ra.project_id = ${command.projectId}::uuid
          AND ra.release_id = ${command.verified.currentRevision.catalogReleaseId}::uuid
          AND ra.release_sha256 = ${command.verified.currentRevision.catalogReleaseSha256}
          AND av.id = ${command.verified.asset.versionId}::uuid
          AND av.version_sha256 = ${command.verified.asset.versionSha256}
          AND av.lifecycle = 'approved' AND av.rights_review_state = 'approved'
          AND r.status = 'published'
        FOR SHARE OF av, r
      `;
      if (catalogRows.length !== 1) {
        throw specificationConflict(
          "CATALOG_BINDING_CHANGED",
          "The exact catalog release/version/rights pin changed before preview publication.",
        );
      }
      const recalculated = previewCatalogReplacement({
        currentLine: command.verified.line,
        replacementAsset: command.verified.asset,
        snapshot: command.verified.snapshot,
      });
      if (
        recalculated.result.snapshotSha256 !== command.preview.candidateSnapshotSha256 ||
        specificationSha256(recalculated.operation) !== specificationSha256(command.operation)
      ) {
        throw specificationConflict(
          "CONFIRMATION_CONFLICT",
          "The exact preview declaration does not replay.",
        );
      }
      const createdAt = this.#clock.now().toISOString();
      await transaction`
        INSERT INTO model_operation_previews (
          tenant_id, project_id, model_id, profile, branch_id, id, created_by,
          created_at, expires_at, base_revision, base_snapshot_id, base_snapshot_sha256,
          base_snapshot_version, operation_payload, operation_payload_sha256,
          result_snapshot_sha256, result_canonical_byte_length, findings, has_blocking_findings
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${command.projectId}::uuid, ${branch.model_id}::uuid,
          'proposed', ${command.verified.currentRevision.branchId}::uuid,
          ${command.preview.modelPreviewId}::uuid, ${command.actor.userId}::uuid,
          ${createdAt}::timestamptz, ${command.preview.expiresAt}::timestamptz,
          ${branch.revision}, ${branch.head_snapshot_id}::uuid, ${branch.head_snapshot_sha256},
          ${branch.head_snapshot_version}, ${transaction.json(json([command.operation]))},
          ${specificationSha256([command.operation])}, ${recalculated.result.snapshotSha256},
          ${recalculated.result.canonicalByteLength},
          ${transaction.json(json(recalculated.result.findings))}, false
        )
      `;
      await transaction`
        INSERT INTO specification_substitution_previews (
          tenant_id, project_id, specification_id, id, schema_version,
          specification_revision, element_id, replacement_asset_version_id,
          replacement_asset_version_sha256, model_id, model_profile, branch_id,
          branch_revision, model_preview_id, base_snapshot_id, base_snapshot_sha256,
          candidate_snapshot_sha256, operation_payload, operation_sha256, preview_payload,
          created_by, created_at, expires_at
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${command.projectId}::uuid,
          ${command.preview.specificationId}::uuid, ${command.preview.previewId}::uuid,
          ${command.preview.schemaVersion}, ${command.preview.specificationRevision},
          ${command.preview.elementId}::uuid, ${command.preview.replacementAssetVersionId}::uuid,
          ${command.preview.replacementAssetVersionSha256}, ${branch.model_id}::uuid, 'proposed',
          ${command.verified.currentRevision.branchId}::uuid, ${branch.revision},
          ${command.preview.modelPreviewId}::uuid, ${command.preview.baseSnapshotId}::uuid,
          ${command.preview.baseSnapshotSha256}, ${command.preview.candidateSnapshotSha256},
          ${transaction.json(json(command.operation))}, ${specificationSha256(command.operation)},
          ${transaction.json(json(command.preview))}, ${command.actor.userId}::uuid,
          ${createdAt}::timestamptz, ${command.preview.expiresAt}::timestamptz
        )
      `;
      await transaction`
        INSERT INTO specification_substitution_heads (
          tenant_id, project_id, specification_id, preview_id, version, state, updated_at
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${command.projectId}::uuid,
          ${command.preview.specificationId}::uuid, ${command.preview.previewId}::uuid,
          1, 'pending', ${createdAt}::timestamptz
        )
      `;
      await appendSpecificationEvent(transaction, this.#uuid, {
        action: "specification.substitution.preview",
        actorUserId: command.actor.userId,
        correlation: command.correlation,
        eventType: "specification.substitution.previewed.v1",
        outcome: "accepted",
        projectId: command.projectId,
        revision: command.preview.specificationRevision,
        specificationId: command.preview.specificationId,
        tenantId: command.actor.tenantId,
        timestamp: createdAt,
      });
      await completeEffect(transaction, {
        idempotencyKey: command.idempotencyKey,
        responseId: command.preview.previewId,
        responseKind: "preview",
        responseStatus: 201,
        tenantId: command.actor.tenantId,
      });
      return { preview: command.preview, replayed: false };
    });
  }

  findSubstitutionPreview(
    tenantId: string,
    projectId: string,
    specificationId: string,
    previewId: string,
  ) {
    return this.#withTenant(tenantId, async (transaction) => {
      const rows = await transaction<{ readonly preview_payload: unknown }[]>`
        SELECT preview_payload FROM specification_substitution_previews
        WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
          AND specification_id = ${specificationId}::uuid AND id = ${previewId}::uuid
        LIMIT 1
      `;
      return rows[0] === undefined
        ? undefined
        : substitutionPreviewSchema.parse(rows[0].preview_payload);
    });
  }

  confirmSubstitution(command: ConfirmSubstitutionCommand): Promise<ConfirmationPersistenceResult> {
    return this.#withTenant(command.actor.tenantId, async (transaction) => {
      // Frozen lock order: project -> specification head -> substitution head -> C5 branch/profile.
      await lockProject(transaction, command.actor.tenantId, command.projectId);
      const replay = await claimEffect(transaction, {
        actorUserId: command.actor.userId,
        idempotencyKey: command.idempotencyKey,
        operation: "specification.substitution.confirm",
        projectId: command.projectId,
        requestSha256: command.requestSha256,
        tenantId: command.actor.tenantId,
      });
      if (replay !== undefined) {
        if (replay.response_id === null) throw new Error("C13 confirmation replay disappeared.");
        const rows = await transaction<
          Array<{
            readonly branch_id: string;
            readonly branch_revision: number;
            readonly confirmation_payload: unknown;
            readonly model_snapshot_id: string;
            readonly model_snapshot_sha256: string;
            readonly scene_job_id: string;
            readonly specification_revision: number;
          }>
        >`
          SELECT c.confirmation_payload, c.scene_job_id, c.branch_id, c.branch_revision,
            c.result_snapshot_id AS model_snapshot_id,
            c.result_snapshot_sha256 AS model_snapshot_sha256,
            c.specification_revision
          FROM specification_substitution_confirmations c
          WHERE c.tenant_id = ${command.actor.tenantId}::uuid
            AND c.project_id = ${command.projectId}::uuid
            AND c.specification_id = ${command.specificationId}::uuid
            AND c.id = ${replay.response_id}::uuid
          LIMIT 1
        `;
        const row = rows[0];
        if (row === undefined) throw new Error("C13 confirmation replay row disappeared.");
        return {
          confirmation: substitutionConfirmationSchema.parse(row.confirmation_payload),
          replayed: true,
          sceneRequest: {
            branchId: row.branch_id,
            branchRevision: row.branch_revision,
            modelSnapshotId: row.model_snapshot_id,
            modelSnapshotSha256: row.model_snapshot_sha256,
            projectId: command.projectId,
            sceneJobId: row.scene_job_id,
            specificationId: command.specificationId,
            specificationRevision: row.specification_revision,
          },
        };
      }
      const heads = await transaction<SpecificationHeadRow[]>`
        SELECT id, project_id, schema_version, status, current_revision, updated_at
        FROM specifications
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid
          AND id = ${command.specificationId}::uuid
        FOR UPDATE
      `;
      const head = heads[0];
      if (head === undefined) throw notFound();
      const substitutionHeads = await transaction<
        Array<{
          readonly state: "confirmed" | "expired" | "pending";
          readonly updated_at: Date | string;
        }>
      >`
        SELECT state, updated_at FROM specification_substitution_heads
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid
          AND specification_id = ${command.specificationId}::uuid
          AND preview_id = ${command.request.previewId}::uuid
        FOR UPDATE
      `;
      const substitutionHead = substitutionHeads[0];
      if (substitutionHead === undefined) throw notFound();
      if (substitutionHead.state !== "pending") {
        throw specificationConflict(
          "PREVIEW_NOT_PENDING",
          "The substitution preview is no longer pending.",
        );
      }
      const previewRows = await transaction<
        Array<{
          readonly base_snapshot_id: string;
          readonly base_snapshot_sha256: string;
          readonly branch_id: string;
          readonly branch_revision: number;
          readonly candidate_snapshot_sha256: string;
          readonly element_id: string;
          readonly expires_at: Date | string;
          readonly model_id: string;
          readonly model_preview_id: string;
          readonly operation_payload: unknown;
          readonly operation_sha256: string;
          readonly replacement_asset_version_id: string;
          readonly replacement_asset_version_sha256: string;
          readonly specification_revision: number;
        }>
      >`
        SELECT * FROM specification_substitution_previews
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid
          AND specification_id = ${command.specificationId}::uuid
          AND id = ${command.request.previewId}::uuid
        LIMIT 1
      `;
      const preview = previewRows[0];
      if (preview === undefined) throw notFound();
      if (Date.parse(iso(preview.expires_at)) <= this.#clock.now().getTime()) {
        throw specificationConflict("PREVIEW_EXPIRED", "The substitution preview expired.", 410);
      }
      if (
        head.current_revision !== command.request.expectedSpecificationRevision ||
        preview.specification_revision !== command.request.expectedSpecificationRevision ||
        preview.candidate_snapshot_sha256 !== command.request.expectedCandidateSnapshotSha256
      ) {
        throw specificationConflict(
          "CONFIRMATION_CONFLICT",
          "The candidate snapshot or specification revision is stale or forged.",
        );
      }
      const branchRows = await transaction<
        Array<{
          readonly head_snapshot_id: string;
          readonly head_snapshot_sha256: string;
          readonly head_snapshot_version: number;
          readonly model_id: string;
          readonly revision: number;
          readonly updated_at: Date | string;
        }>
      >`
        SELECT model_id, revision, head_snapshot_id, head_snapshot_sha256,
          head_snapshot_version, updated_at
        FROM model_branches
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid AND profile = 'proposed'
          AND id = ${preview.branch_id}::uuid
        FOR UPDATE
      `;
      const branch = branchRows[0];
      if (
        branch === undefined ||
        branch.model_id !== preview.model_id ||
        branch.revision !== preview.branch_revision ||
        branch.head_snapshot_id !== preview.base_snapshot_id ||
        branch.head_snapshot_sha256 !== preview.base_snapshot_sha256
      ) {
        throw specificationConflict("SOURCE_CHANGED", "The exact C5 branch changed after preview.");
      }
      const profileRows = await transaction<
        Array<{
          readonly current_snapshot_id: string | null;
          readonly current_snapshot_sha256: string | null;
          readonly current_snapshot_version: number | null;
          readonly updated_at: Date | string | null;
        }>
      >`
        SELECT current_snapshot_id, current_snapshot_sha256, current_snapshot_version, updated_at
        FROM canonical_model_profiles
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid
          AND model_id = ${branch.model_id}::uuid AND profile = 'proposed'
        FOR UPDATE
      `;
      const profile = profileRows[0];
      if (profile === undefined || profile.current_snapshot_version === null) {
        throw specificationConflict("SOURCE_CHANGED", "The proposed model profile is unavailable.");
      }
      const currentRevision = await loadRevision(
        transaction,
        command.actor.tenantId,
        command.projectId,
        command.specificationId,
        head.current_revision,
      );
      if (currentRevision === undefined) throw new Error("C13 current revision disappeared.");
      if (
        currentRevision.branchId !== preview.branch_id ||
        currentRevision.branchRevision !== preview.branch_revision ||
        currentRevision.modelSnapshotId !== preview.base_snapshot_id ||
        currentRevision.modelSnapshotSha256 !== preview.base_snapshot_sha256
      ) {
        throw specificationConflict(
          "SOURCE_CHANGED",
          "The specification no longer pins the preview branch head.",
        );
      }
      const line = currentRevision.lines.find(({ elementId }) => elementId === preview.element_id);
      if (line === undefined)
        throw specificationConflict("SOURCE_CHANGED", "The preview line disappeared.");
      const snapshotRows = await transaction<
        Array<{
          readonly canonical_snapshot: unknown;
          readonly snapshot_sha256: string;
          readonly version: number;
        }>
      >`
        SELECT canonical_snapshot, snapshot_sha256, version FROM canonical_model_snapshots
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid AND model_id = ${branch.model_id}::uuid
          AND profile = 'proposed' AND id = ${branch.head_snapshot_id}::uuid
          AND snapshot_sha256 = ${branch.head_snapshot_sha256}
          AND version = ${branch.head_snapshot_version}
        FOR SHARE
      `;
      const snapshotRow = snapshotRows[0];
      if (snapshotRow === undefined)
        throw specificationConflict("SOURCE_CHANGED", "The branch snapshot disappeared.");
      const snapshot = canonicalHomeSnapshotSchema.parse(snapshotRow.canonical_snapshot);
      const canonical = validateAndCanonicalizeSnapshot(snapshot);
      if (
        canonical.hasBlockingFindings ||
        canonical.snapshotSha256 !== branch.head_snapshot_sha256
      ) {
        throw specificationConflict(
          "SOURCE_CHANGED",
          "The exact branch snapshot failed integrity verification.",
        );
      }
      const assetRows = await transaction<{ readonly asset_payload: unknown }[]>`
        SELECT av.asset_payload FROM catalog_release_assets ra
        JOIN catalog_asset_versions av
          ON av.tenant_id = ra.tenant_id AND av.project_id = ra.project_id
          AND av.id = ra.asset_version_id AND av.version_sha256 = ra.asset_version_sha256
        JOIN catalog_releases r
          ON r.tenant_id = ra.tenant_id AND r.project_id = ra.project_id
          AND r.id = ra.release_id AND r.manifest_sha256 = ra.release_sha256
        WHERE ra.tenant_id = ${command.actor.tenantId}::uuid
          AND ra.project_id = ${command.projectId}::uuid
          AND ra.release_id = ${currentRevision.catalogReleaseId}::uuid
          AND ra.release_sha256 = ${currentRevision.catalogReleaseSha256}
          AND av.id = ${preview.replacement_asset_version_id}::uuid
          AND av.version_sha256 = ${preview.replacement_asset_version_sha256}
          AND av.lifecycle = 'approved' AND av.rights_review_state = 'approved'
          AND r.status = 'published'
        FOR SHARE OF av, r
      `;
      const assetRow = assetRows[0];
      if (assetRow === undefined) {
        throw specificationConflict(
          "CATALOG_BINDING_CHANGED",
          "The catalog release/version/rights pin was withdrawn or changed after preview.",
        );
      }
      const asset = catalogAssetVersionSchema.parse(assetRow.asset_payload);
      const recalculated = previewCatalogReplacement({
        currentLine: line,
        replacementAsset: asset,
        snapshot,
      });
      const retainedOperation = z
        .object({ type: z.literal("design.element.replace.v1") })
        .loose()
        .parse(preview.operation_payload);
      if (
        recalculated.result.snapshotSha256 !== preview.candidate_snapshot_sha256 ||
        specificationSha256(recalculated.operation) !== preview.operation_sha256 ||
        specificationSha256(retainedOperation) !== preview.operation_sha256
      ) {
        throw specificationConflict(
          "CONFIRMATION_CONFLICT",
          "The retained C5 preview no longer replays exactly.",
        );
      }
      const c5PreviewRows = await transaction<
        Array<{
          readonly result_snapshot_sha256: string;
          readonly operation_payload_sha256: string;
        }>
      >`
        SELECT result_snapshot_sha256, operation_payload_sha256 FROM model_operation_previews
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid AND profile = 'proposed'
          AND branch_id = ${preview.branch_id}::uuid AND id = ${preview.model_preview_id}::uuid
          AND base_revision = ${preview.branch_revision}
          AND base_snapshot_sha256 = ${preview.base_snapshot_sha256}
        FOR SHARE
      `;
      const c5Preview = c5PreviewRows[0];
      if (
        c5Preview === undefined ||
        c5Preview.result_snapshot_sha256 !== preview.candidate_snapshot_sha256 ||
        c5Preview.operation_payload_sha256 !== specificationSha256([recalculated.operation])
      ) {
        throw specificationConflict("CONFIRMATION_CONFLICT", "The exact C5 preview pin changed.");
      }
      const committedAt = laterIso(
        this.#clock.now(),
        [
          head.updated_at,
          substitutionHead.updated_at,
          branch.updated_at,
          profile.updated_at ?? branch.updated_at,
        ]
          .map((value) => new Date(value).getTime())
          .reduce((left, right) => (left > right ? left : right)),
      );
      const resultSnapshotId = this.#uuid.randomUUID();
      const commitId = this.#uuid.randomUUID();
      const resultVersion = profile.current_snapshot_version + 1;
      const nextBranchRevision = branch.revision + 1;
      await transaction`
        INSERT INTO canonical_model_snapshots (
          id, tenant_id, project_id, model_id, profile, property_id,
          derived_from_snapshot_sha256, version, schema_version, canonical_snapshot,
          snapshot_sha256, canonical_byte_length, validation_findings, created_by, created_at
        ) VALUES (
          ${resultSnapshotId}::uuid, ${command.actor.tenantId}::uuid, ${command.projectId}::uuid,
          ${branch.model_id}::uuid, 'proposed', ${recalculated.result.snapshot.propertyId ?? null}::uuid,
          ${recalculated.result.snapshot.derivedFromSnapshotSha256 ?? null}, ${resultVersion},
          ${recalculated.result.snapshot.schemaVersion},
          ${transaction.json(json(recalculated.result.snapshot))}, ${recalculated.result.snapshotSha256},
          ${recalculated.result.canonicalByteLength},
          ${transaction.json(json(recalculated.result.findings))}, ${command.actor.userId}::uuid,
          ${committedAt}::timestamptz
        )
      `;
      await transaction`
        INSERT INTO model_operation_commits (
          tenant_id, project_id, model_id, profile, branch_id, id, revision, message,
          preview_id, operation_count, parent_snapshot_id, parent_snapshot_sha256,
          parent_snapshot_version, snapshot_id, snapshot_sha256, snapshot_version,
          validation_findings, committed_by, committed_at, request_id, trace_id
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${command.projectId}::uuid, ${branch.model_id}::uuid,
          'proposed', ${preview.branch_id}::uuid, ${commitId}::uuid, ${nextBranchRevision},
          'Confirm exact C13 catalog substitution.', ${preview.model_preview_id}::uuid, 1,
          ${branch.head_snapshot_id}::uuid, ${branch.head_snapshot_sha256},
          ${branch.head_snapshot_version}, ${resultSnapshotId}::uuid,
          ${recalculated.result.snapshotSha256}, ${resultVersion},
          ${transaction.json(json(recalculated.result.findings))}, ${command.actor.userId}::uuid,
          ${committedAt}::timestamptz, ${command.correlation.requestId}, ${command.correlation.traceId}
        )
      `;
      await transaction`
        INSERT INTO model_operation_envelopes (
          tenant_id, project_id, model_id, profile, branch_id, commit_id, id,
          revision, ordinal, schema_version, type, client_operation_id, reason,
          operation_payload, committed_by, committed_at
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${command.projectId}::uuid, ${branch.model_id}::uuid,
          'proposed', ${preview.branch_id}::uuid, ${commitId}::uuid, ${this.#uuid.randomUUID()}::uuid,
          ${nextBranchRevision}, 0, ${recalculated.operation.schemaVersion},
          ${recalculated.operation.type}, ${recalculated.operation.clientOperationId}::uuid,
          ${recalculated.operation.reason}, ${transaction.json(json(recalculated.operation))},
          ${command.actor.userId}::uuid, ${committedAt}::timestamptz
        )
      `;
      await transaction`
        UPDATE canonical_model_profiles SET current_snapshot_id = ${resultSnapshotId}::uuid,
          current_snapshot_sha256 = ${recalculated.result.snapshotSha256},
          current_snapshot_version = ${resultVersion}, updated_by = ${command.actor.userId}::uuid,
          updated_at = ${committedAt}::timestamptz
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid AND model_id = ${branch.model_id}::uuid
          AND profile = 'proposed'
      `;
      const branchUpdates = await transaction<{ readonly id: string }[]>`
        UPDATE model_branches SET head_snapshot_id = ${resultSnapshotId}::uuid,
          head_snapshot_sha256 = ${recalculated.result.snapshotSha256},
          head_snapshot_version = ${resultVersion}, revision = revision + 1,
          updated_by = ${command.actor.userId}::uuid, updated_at = ${committedAt}::timestamptz
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid AND model_id = ${branch.model_id}::uuid
          AND profile = 'proposed' AND id = ${preview.branch_id}::uuid
          AND revision = ${branch.revision} AND head_snapshot_sha256 = ${branch.head_snapshot_sha256}
        RETURNING id
      `;
      if (branchUpdates.length !== 1) {
        throw specificationConflict(
          "CONFIRMATION_CONFLICT",
          "The C5 branch commit lost its fence.",
        );
      }
      await transaction`
        INSERT INTO model_domain_audit_events (
          id, tenant_id, project_id, model_id, profile, branch_id, commit_id, revision,
          action, event_type, operation_types, outcome, snapshot_id, snapshot_sha256,
          actor_user_id, request_id, trace_id, occurred_at
        ) VALUES (
          ${this.#uuid.randomUUID()}::uuid, ${command.actor.tenantId}::uuid,
          ${command.projectId}::uuid, ${branch.model_id}::uuid, 'proposed',
          ${preview.branch_id}::uuid, ${commitId}::uuid, ${nextBranchRevision},
          'model:operation:commit', 'model.operations.committed.v1',
          ${transaction.json(json([recalculated.operation.type]))}, 'accepted',
          ${resultSnapshotId}::uuid, ${recalculated.result.snapshotSha256},
          ${command.actor.userId}::uuid, ${command.correlation.requestId},
          ${command.correlation.traceId}, ${committedAt}::timestamptz
        )
      `;
      await transaction`
        INSERT INTO model_transactional_outbox (
          id, tenant_id, project_id, model_id, profile, branch_id, commit_id,
          revision, event_type, schema_version, payload, occurred_at
        ) VALUES (
          ${this.#uuid.randomUUID()}::uuid, ${command.actor.tenantId}::uuid,
          ${command.projectId}::uuid, ${branch.model_id}::uuid, 'proposed',
          ${preview.branch_id}::uuid, ${commitId}::uuid, ${nextBranchRevision},
          'model.operations.committed.v1', 'c5-model-operation-v1',
          ${transaction.json(
            json({
              branchId: preview.branch_id,
              commitId,
              operationCount: 1,
              revision: nextBranchRevision,
              snapshotSha256: recalculated.result.snapshotSha256,
            }),
          )}, ${committedAt}::timestamptz
        )
      `;
      this.#failureInjector?.("after-model-write");

      const nextLine = substituteSpecificationLine({
        confirmationId: command.confirmationId,
        current: line,
        replacementAsset: asset,
      });
      const nextLines = currentRevision.lines.map((candidate) =>
        candidate.elementId === nextLine.elementId ? nextLine : candidate,
      );
      const nextRevision = buildSpecificationRevision({
        branchId: currentRevision.branchId,
        branchRevision: nextBranchRevision,
        catalogReleaseId: currentRevision.catalogReleaseId,
        catalogReleaseSha256: currentRevision.catalogReleaseSha256,
        createdAt: committedAt,
        createdBy: command.actor.userId,
        lines: nextLines,
        modelSnapshotId: resultSnapshotId,
        modelSnapshotSha256: recalculated.result.snapshotSha256,
        revision: currentRevision.revision + 1,
        sourceConfirmation: currentRevision.sourceConfirmation,
      });
      await insertRevision(transaction, {
        modelId: branch.model_id,
        modelSnapshotVersion: resultVersion,
        projectId: command.projectId,
        revision: nextRevision,
        specificationId: command.specificationId,
        tenantId: command.actor.tenantId,
      });
      const specificationUpdates = await transaction<{ readonly id: string }[]>`
        UPDATE specifications SET current_revision = current_revision + 1,
          updated_by = ${command.actor.userId}::uuid, updated_at = ${committedAt}::timestamptz
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid AND id = ${command.specificationId}::uuid
          AND current_revision = ${currentRevision.revision}
        RETURNING id
      `;
      if (specificationUpdates.length !== 1) {
        throw specificationConflict(
          "SPECIFICATION_REVISION_CONFLICT",
          "The specification head lost its fence.",
        );
      }
      await transaction`
        UPDATE specification_substitution_heads SET state = 'confirmed', version = version + 1,
          updated_at = ${committedAt}::timestamptz
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid
          AND specification_id = ${command.specificationId}::uuid
          AND preview_id = ${command.request.previewId}::uuid AND state = 'pending'
      `;
      const confirmation = substitutionConfirmationSchema.parse({
        commitId,
        confirmationId: command.confirmationId,
        elementId: preview.element_id,
        resultSnapshotId,
        resultSnapshotSha256: recalculated.result.snapshotSha256,
        sceneJobId: command.sceneJobId,
        schemaVersion: "c13-substitution-confirmation-v1",
        specificationId: command.specificationId,
        specificationRevision: nextRevision.revision,
      });
      await transaction`
        INSERT INTO specification_substitution_confirmations (
          tenant_id, project_id, specification_id, id, schema_version, preview_id,
          specification_revision, element_id, model_id, model_profile, branch_id,
          branch_revision, commit_id, result_snapshot_id, result_snapshot_sha256,
          scene_job_id, confirmation_payload, confirmed_by, confirmed_at, request_id, trace_id
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${command.projectId}::uuid,
          ${command.specificationId}::uuid, ${command.confirmationId}::uuid,
          ${confirmation.schemaVersion}, ${command.request.previewId}::uuid,
          ${nextRevision.revision}, ${preview.element_id}::uuid, ${branch.model_id}::uuid,
          'proposed', ${preview.branch_id}::uuid, ${nextBranchRevision}, ${commitId}::uuid,
          ${resultSnapshotId}::uuid, ${recalculated.result.snapshotSha256},
          ${command.sceneJobId}::uuid, ${transaction.json(json(confirmation))},
          ${command.actor.userId}::uuid, ${committedAt}::timestamptz,
          ${command.correlation.requestId}, ${command.correlation.traceId}
        )
      `;
      await transaction`
        INSERT INTO specification_scene_links (
          tenant_id, project_id, specification_id, specification_revision,
          confirmation_id, scene_job_id, version, state, safe_code, updated_at
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${command.projectId}::uuid,
          ${command.specificationId}::uuid, ${nextRevision.revision},
          ${command.confirmationId}::uuid, ${command.sceneJobId}::uuid,
          1, 'pending', NULL, ${committedAt}::timestamptz
        )
      `;
      await transaction`
        INSERT INTO specification_scene_events (
          id, tenant_id, project_id, scene_job_id, version,
          previous_state, state, safe_code, occurred_at
        ) VALUES (
          ${this.#uuid.randomUUID()}::uuid, ${command.actor.tenantId}::uuid,
          ${command.projectId}::uuid, ${command.sceneJobId}::uuid, 1,
          NULL, 'pending', NULL, ${committedAt}::timestamptz
        )
      `;
      await appendSpecificationEvent(transaction, this.#uuid, {
        action: "specification.substitution.confirm",
        actorUserId: command.actor.userId,
        correlation: command.correlation,
        eventType: "specification.substitution.confirmed.v1",
        outcome: "accepted",
        projectId: command.projectId,
        revision: nextRevision.revision,
        specificationId: command.specificationId,
        tenantId: command.actor.tenantId,
        timestamp: committedAt,
      });
      this.#failureInjector?.("after-specification-write");
      await completeEffect(transaction, {
        idempotencyKey: command.idempotencyKey,
        responseId: command.confirmationId,
        responseKind: "confirmation",
        responseStatus: 201,
        tenantId: command.actor.tenantId,
      });
      return {
        confirmation,
        replayed: false,
        sceneRequest: {
          branchId: preview.branch_id,
          branchRevision: nextBranchRevision,
          modelSnapshotId: resultSnapshotId,
          modelSnapshotSha256: recalculated.result.snapshotSha256,
          projectId: command.projectId,
          sceneJobId: command.sceneJobId,
          specificationId: command.specificationId,
          specificationRevision: nextRevision.revision,
        },
      };
    });
  }

  resolveConfirmedSceneBinding(tenantId: string, projectId: string, sceneJobId: string) {
    return this.#withTenant(tenantId, async (transaction) => {
      const rows = await transaction<
        Array<{
          readonly branch_id: string;
          readonly branch_revision: number;
          readonly catalog_release_id: string;
          readonly catalog_release_sha256: string;
          readonly model_snapshot_id: string;
          readonly model_snapshot_sha256: string;
          readonly revision_sha256: string;
          readonly scene_job_id: string;
          readonly specification_id: string;
          readonly specification_revision: number;
        }>
      >`
        SELECT l.scene_job_id, l.specification_id, l.specification_revision,
          r.branch_id, r.branch_revision,
          r.revision_sha256, r.catalog_release_id, r.catalog_release_sha256,
          r.model_snapshot_id, r.model_snapshot_sha256
        FROM specification_scene_links l
        JOIN specification_substitution_confirmations c
          ON c.tenant_id = l.tenant_id AND c.project_id = l.project_id
          AND c.specification_id = l.specification_id AND c.id = l.confirmation_id
        JOIN specification_revisions r
          ON r.tenant_id = l.tenant_id AND r.project_id = l.project_id
          AND r.specification_id = l.specification_id AND r.revision = l.specification_revision
        WHERE l.tenant_id = ${tenantId}::uuid AND l.project_id = ${projectId}::uuid
          AND l.scene_job_id = ${sceneJobId}::uuid
        LIMIT 1
      `;
      const row = rows[0];
      if (row === undefined) return undefined;
      return {
        branchId: row.branch_id,
        branchRevision: row.branch_revision,
        catalogReleaseId: row.catalog_release_id,
        catalogReleaseSha256: row.catalog_release_sha256,
        lines: await loadLines(
          transaction,
          tenantId,
          projectId,
          row.specification_id,
          row.specification_revision,
        ),
        modelSnapshotId: row.model_snapshot_id,
        modelSnapshotSha256: row.model_snapshot_sha256,
        projectId,
        revisionSha256: row.revision_sha256,
        sceneJobId: row.scene_job_id,
        specificationId: row.specification_id,
        specificationRevision: row.specification_revision,
      } satisfies SpecificationSceneBinding;
    });
  }

  recordSceneRequest(
    tenantId: string,
    projectId: string,
    sceneJobId: string,
    outcome: "requested" | "retry-required",
    safeCode?: "SCENE_REQUEST_FAILED",
  ) {
    return this.#withTenant(tenantId, async (transaction) => {
      await lockProject(transaction, tenantId, projectId);
      const rows = await transaction<
        Array<{
          readonly specification_id: string;
          readonly specification_revision: number;
          readonly state: "pending" | "requested" | "retry-required";
          readonly updated_at: Date | string;
          readonly version: number;
        }>
      >`
        SELECT specification_id, specification_revision, state, version, updated_at
        FROM specification_scene_links
        WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
          AND scene_job_id = ${sceneJobId}::uuid
        FOR UPDATE
      `;
      const row = rows[0];
      if (row === undefined) throw notFound();
      const timestamp = laterIso(this.#clock.now(), row.updated_at);
      await transaction`
        UPDATE specification_scene_links SET state = ${outcome},
          safe_code = ${safeCode ?? null}, version = version + 1,
          updated_at = ${timestamp}::timestamptz
        WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
          AND scene_job_id = ${sceneJobId}::uuid AND version = ${row.version}
      `;
      await transaction`
        INSERT INTO specification_scene_events (
          id, tenant_id, project_id, scene_job_id, version,
          previous_state, state, safe_code, occurred_at
        ) VALUES (
          ${this.#uuid.randomUUID()}::uuid, ${tenantId}::uuid, ${projectId}::uuid,
          ${sceneJobId}::uuid, ${row.version + 1}, ${row.state}, ${outcome},
          ${safeCode ?? null}, ${timestamp}::timestamptz
        )
      `;
      await appendSpecificationEvent(transaction, this.#uuid, {
        action: "specification.scene.request",
        eventType: "specification.scene.requested.v1",
        outcome: outcome === "retry-required" ? "retry-required" : "accepted",
        projectId,
        revision: row.specification_revision,
        specificationId: row.specification_id,
        tenantId,
        timestamp,
      });
    });
  }
}
