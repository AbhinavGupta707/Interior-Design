import {
  canonicalHomeSnapshotSchema,
  designBriefSchema,
  designConstraintSchema,
  designOptionSchema,
  designOptionSetSchema,
  optionConfirmationSchema,
  optionJobSchema,
  modelSnapshotRecordSchema,
  type DesignBrief,
  type DesignOption,
  type ModelSnapshotRecord,
  type OptionConfirmation,
  type OptionJob,
} from "@interior-design/contracts";
import { canonicalBriefSnapshot } from "@interior-design/design-brief";
import {
  reduceModelOperations,
  validateAndCanonicalizeSnapshot,
} from "@interior-design/model-operations";
import { randomUUID } from "node:crypto";
import type { JSONValue, Sql, TransactionSql } from "postgres";
import { z } from "zod";

import { notFound } from "../identity/http.js";
import { designOptionConflict } from "./errors.js";
import { c12Sha256, constraintsSha256 } from "./hashes.js";
import type {
  AbstainOptionAttemptCommand,
  AcknowledgeOptionCancellationCommand,
  AdvanceOptionAttemptCommand,
  ClaimOptionAttemptCommand,
  ConfirmOptionCommand,
  CreateOptionJobCommand,
  DesignAssetVerificationPort,
  DesignOptionClock,
  DesignOptionRepository,
  DesignOptionUuidFactory,
  FailOptionAttemptCommand,
  HeartbeatOptionAttemptCommand,
  LeasedOptionAttempt,
  PublishOptionSetCommand,
  TransitionOptionJobCommand,
} from "./types.js";
import { validateOptionPublication } from "./validation.js";

interface JobRow {
  readonly asset_manifest_sha256: string;
  readonly attempt: number;
  readonly brief_content_sha256: string;
  readonly brief_id: string;
  readonly brief_revision: number;
  readonly cancelled_at: Date | string | null;
  readonly completed_at: Date | string | null;
  readonly constraints_payload: unknown;
  readonly constraints_sha256: string;
  readonly created_at: Date | string;
  readonly created_by: string;
  readonly id: string;
  readonly option_count: number;
  readonly project_id: string;
  readonly requested_directions: unknown;
  readonly requested_option_count: number;
  readonly retryable: boolean;
  readonly safe_code: string | null;
  readonly schema_version: string;
  readonly source_model_id: string;
  readonly source_profile: "existing" | "proposed";
  readonly source_snapshot_id: string;
  readonly source_snapshot_sha256: string;
  readonly source_snapshot_version: number;
  readonly stage: OptionJob["stage"];
  readonly state: OptionJob["state"];
  readonly updated_at: Date | string;
  readonly version: number;
  readonly working_model_id: string;
  readonly working_snapshot_id: string;
  readonly working_snapshot_payload: unknown;
  readonly working_snapshot_sha256: string;
  readonly working_snapshot_version: number;
}

interface AttemptRow {
  readonly attempt: number;
  readonly job_id: string;
  readonly job_version: number;
  readonly lease_expires_at: Date | string | null;
  readonly lease_owner: string | null;
  readonly lease_token: string | null;
  readonly stage: OptionJob["stage"];
  readonly state: string;
  readonly project_id: string;
  readonly tenant_id: string;
}

interface EffectRow {
  readonly actor_user_id: string;
  readonly operation: string;
  readonly project_id: string;
  readonly request_sha256: string;
  readonly response_payload: unknown;
  readonly response_status: number | null;
}

interface OptionRow {
  readonly option_payload: unknown;
  readonly status: DesignOption["status"];
}

interface SetRow {
  readonly set_payload: unknown;
}

interface ConfirmationRow {
  readonly branch_id: string;
  readonly branch_revision: number;
  readonly commit_id: string;
  readonly confirmed_at: Date | string;
  readonly confirmed_by: string;
  readonly id: string;
  readonly idempotency_key: string;
  readonly option_id: string;
  readonly preview_id: string;
  readonly project_id: string;
  readonly result_snapshot_sha256: string;
}

type EffectOperation =
  | "design-option.job.cancel"
  | "design-option.job.create"
  | "design-option.job.retry"
  | "design-option.option.confirm";

function json(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function mapJob(row: JobRow): OptionJob {
  return optionJobSchema.parse({
    assetManifestSha256: row.asset_manifest_sha256,
    attempt: row.attempt,
    baseBrief: {
      briefId: row.brief_id,
      contentSha256: row.brief_content_sha256,
      revision: row.brief_revision,
    },
    ...(row.cancelled_at === null ? {} : { cancelledAt: iso(row.cancelled_at) }),
    ...(row.completed_at === null ? {} : { completedAt: iso(row.completed_at) }),
    constraints: row.constraints_payload,
    constraintsSha256: row.constraints_sha256,
    createdAt: iso(row.created_at),
    createdBy: row.created_by,
    id: row.id,
    optionCount: row.option_count,
    projectId: row.project_id,
    requestedDirections: row.requested_directions,
    requestedOptionCount: row.requested_option_count,
    retryable: row.retryable,
    ...(row.safe_code === null ? {} : { safeCode: row.safe_code }),
    schemaVersion: row.schema_version,
    sourceModel: {
      modelId: row.source_model_id,
      profile: row.source_profile,
      snapshotId: row.source_snapshot_id,
      snapshotSha256: row.source_snapshot_sha256,
      snapshotVersion: row.source_snapshot_version,
    },
    stage: row.stage,
    state: row.state,
    updatedAt: iso(row.updated_at),
    version: row.version,
    workingModel: {
      modelId: row.working_model_id,
      profile: "proposed",
      snapshotId: row.working_snapshot_id,
      snapshotSha256: row.working_snapshot_sha256,
      snapshotVersion: row.working_snapshot_version,
    },
  });
}

function mapOption(row: OptionRow, now: Date): DesignOption {
  const option = designOptionSchema.parse(row.option_payload);
  const status =
    row.status === "pending" && Date.parse(option.expiresAt) <= now.getTime()
      ? "expired"
      : row.status;
  return designOptionSchema.parse({ ...option, status });
}

function mapConfirmation(row: ConfirmationRow): OptionConfirmation {
  return optionConfirmationSchema.parse({
    branchId: row.branch_id,
    branchRevision: row.branch_revision,
    commitId: row.commit_id,
    confirmedAt: iso(row.confirmed_at),
    confirmedBy: row.confirmed_by,
    id: row.id,
    idempotencyKey: row.idempotency_key,
    optionId: row.option_id,
    previewId: row.preview_id,
    projectId: row.project_id,
    resultSnapshotSha256: row.result_snapshot_sha256,
    schemaVersion: "c12-option-confirmation-v1",
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

async function claimEffect(
  transaction: TransactionSql,
  input: {
    readonly actorUserId: string;
    readonly idempotencyKey: string;
    readonly operation: EffectOperation;
    readonly projectId: string;
    readonly requestSha256: string;
    readonly tenantId: string;
  },
): Promise<{ readonly replay?: unknown }> {
  const inserted = await transaction<{ readonly idempotency_key: string }[]>`
    INSERT INTO design_option_idempotency_effects (
      tenant_id, project_id, idempotency_key, actor_user_id, operation,
      request_sha256, created_at
    ) VALUES (
      ${input.tenantId}::uuid, ${input.projectId}::uuid, ${input.idempotencyKey},
      ${input.actorUserId}::uuid, ${input.operation}, ${input.requestSha256}, clock_timestamp()
    )
    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
    RETURNING idempotency_key
  `;
  if (inserted.length === 1) return {};
  const rows = await transaction<EffectRow[]>`
    SELECT project_id, actor_user_id, operation, request_sha256, response_payload, response_status
    FROM design_option_idempotency_effects
    WHERE tenant_id = ${input.tenantId}::uuid AND idempotency_key = ${input.idempotencyKey}
    LIMIT 1
  `;
  const stored = rows[0];
  if (
    stored === undefined ||
    stored.project_id !== input.projectId ||
    stored.actor_user_id !== input.actorUserId ||
    stored.operation !== input.operation ||
    stored.request_sha256 !== input.requestSha256
  ) {
    throw designOptionConflict(
      "IDEMPOTENCY_CONFLICT",
      "The idempotency key was already used for a different C12 mutation.",
    );
  }
  if (stored.response_payload === null || stored.response_status === null) {
    throw new Error("A committed C12 idempotency effect is incomplete.");
  }
  return { replay: stored.response_payload };
}

async function completeEffect(
  transaction: TransactionSql,
  input: {
    readonly actorUserId: string;
    readonly idempotencyKey: string;
    readonly response: object;
    readonly status: 200 | 201;
    readonly tenantId: string;
  },
): Promise<void> {
  const rows = await transaction<{ readonly idempotency_key: string }[]>`
    UPDATE design_option_idempotency_effects
    SET response_status = ${input.status}, response_payload = ${transaction.json(json(input.response))},
        completed_at = clock_timestamp()
    WHERE tenant_id = ${input.tenantId}::uuid AND idempotency_key = ${input.idempotencyKey}
      AND actor_user_id = ${input.actorUserId}::uuid AND completed_at IS NULL
    RETURNING idempotency_key
  `;
  if (rows.length !== 1) throw new Error("C12 idempotency completion failed.");
}

async function appendJobEvent(
  transaction: TransactionSql,
  input: {
    readonly actorUserId?: string;
    readonly job: JobRow;
    readonly previousState?: OptionJob["state"];
    readonly tenantId: string;
    readonly uuid: DesignOptionUuidFactory;
  },
): Promise<void> {
  await transaction`
    INSERT INTO design_option_job_state_events (
      id, tenant_id, project_id, job_id, version, attempt, previous_state,
      state, stage, safe_code, occurred_at, actor_user_id
    ) VALUES (
      ${input.uuid.randomUUID()}::uuid, ${input.tenantId}::uuid,
      ${input.job.project_id}::uuid, ${input.job.id}::uuid, ${input.job.version},
      ${input.job.attempt}, ${input.previousState ?? null}, ${input.job.state},
      ${input.job.stage}, ${input.job.safe_code}, ${iso(input.job.updated_at)}::timestamptz,
      ${input.actorUserId ?? null}::uuid
    )
  `;
}

async function appendAuditOutbox(
  transaction: TransactionSql,
  input: {
    readonly action: string;
    readonly actorUserId?: string;
    readonly job: JobRow;
    readonly metadata: Record<string, boolean | number | string>;
    readonly occurredAt?: string;
    readonly optionId?: string;
    readonly outcome: "abstained" | "accepted" | "failed";
    readonly requestId: string;
    readonly traceId: string;
    readonly tenantId: string;
    readonly uuid: DesignOptionUuidFactory;
  },
): Promise<void> {
  const occurredAt = input.occurredAt ?? iso(input.job.updated_at);
  await transaction`
    INSERT INTO design_option_audit_events (
      id, tenant_id, project_id, job_id, option_id, action, outcome,
      actor_user_id, request_id, trace_id, metadata, occurred_at
    ) VALUES (
      ${input.uuid.randomUUID()}::uuid, ${input.tenantId}::uuid,
      ${input.job.project_id}::uuid, ${input.job.id}::uuid,
      ${input.optionId ?? null}::uuid, ${input.action}, ${input.outcome},
      ${input.actorUserId ?? null}::uuid, ${input.requestId}, ${input.traceId},
      ${transaction.json(json(input.metadata))}, ${occurredAt}::timestamptz
    )
  `;
  await transaction`
    INSERT INTO design_option_outbox (
      id, tenant_id, project_id, job_id, option_id, event_type,
      schema_version, payload, occurred_at
    ) VALUES (
      ${input.uuid.randomUUID()}::uuid, ${input.tenantId}::uuid,
      ${input.job.project_id}::uuid, ${input.job.id}::uuid,
      ${input.optionId ?? null}::uuid, ${input.action.replaceAll(":", ".") + ".v1"},
      'c12-option-job-v1', ${transaction.json(json(input.metadata))},
      ${occurredAt}::timestamptz
    )
  `;
}

async function loadJob(
  transaction: TransactionSql,
  tenantId: string,
  projectId: string,
  jobId: string,
  lock = false,
): Promise<JobRow | undefined> {
  const rows = lock
    ? await transaction<JobRow[]>`
        SELECT * FROM design_option_jobs
        WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
          AND id = ${jobId}::uuid
        FOR UPDATE
      `
    : await transaction<JobRow[]>`
        SELECT * FROM design_option_jobs
        WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
          AND id = ${jobId}::uuid
        LIMIT 1
      `;
  return rows[0];
}

async function loadExactWorkerInputs(
  transaction: TransactionSql,
  tenantId: string,
  job: JobRow,
): Promise<
  { readonly acceptedBrief: DesignBrief; readonly sourceSnapshot: ModelSnapshotRecord } | undefined
> {
  const briefRows = await transaction<
    Array<{
      readonly brief_payload: unknown;
      readonly canonical_byte_length: number;
      readonly content_sha256: string;
      readonly snapshot_sha256: string;
    }>
  >`
    SELECT r.brief_payload, r.canonical_byte_length, r.content_sha256, r.snapshot_sha256
    FROM design_briefs b
    JOIN design_brief_revisions r
      ON r.tenant_id = b.tenant_id AND r.project_id = b.project_id
      AND r.brief_id = b.id AND r.revision = b.current_revision
    JOIN design_brief_acceptance_events a
      ON a.tenant_id = r.tenant_id AND a.project_id = r.project_id
      AND a.brief_id = r.brief_id AND a.accepted_revision = r.revision
    WHERE b.tenant_id = ${tenantId}::uuid AND b.project_id = ${job.project_id}::uuid
      AND b.id = ${job.brief_id}::uuid AND b.current_status = 'accepted'
      AND r.revision = ${job.brief_revision} AND r.content_sha256 = ${job.brief_content_sha256}
    FOR SHARE OF b, r
  `;
  const sourceRows = await transaction<
    Array<{
      readonly canonical_byte_length: number;
      readonly canonical_snapshot: unknown;
      readonly created_at: Date | string;
      readonly created_by: string;
      readonly id: string;
      readonly model_id: string;
      readonly profile: "existing" | "proposed";
      readonly schema_version: string;
      readonly snapshot_sha256: string;
      readonly version: number;
    }>
  >`
    SELECT id, model_id, profile, version, schema_version, canonical_snapshot,
      snapshot_sha256, canonical_byte_length, created_by, created_at
    FROM canonical_model_snapshots
    WHERE tenant_id = ${tenantId}::uuid AND project_id = ${job.project_id}::uuid
      AND model_id = ${job.source_model_id}::uuid AND profile = ${job.source_profile}
      AND id = ${job.source_snapshot_id}::uuid
      AND snapshot_sha256 = ${job.source_snapshot_sha256}
      AND version = ${job.source_snapshot_version}
    FOR SHARE
  `;
  const briefRow = briefRows[0];
  const sourceRow = sourceRows[0];
  if (briefRow === undefined || sourceRow === undefined) return undefined;
  try {
    const accepted = canonicalBriefSnapshot(designBriefSchema.parse(briefRow.brief_payload));
    const sourceCanonical = validateAndCanonicalizeSnapshot(
      canonicalHomeSnapshotSchema.parse(sourceRow.canonical_snapshot),
    );
    if (
      accepted.brief.status !== "accepted" ||
      accepted.brief.id !== job.brief_id ||
      accepted.brief.projectId !== job.project_id ||
      accepted.brief.revision !== job.brief_revision ||
      accepted.contentSha256 !== briefRow.content_sha256 ||
      accepted.contentSha256 !== job.brief_content_sha256 ||
      accepted.snapshotSha256 !== briefRow.snapshot_sha256 ||
      accepted.canonicalByteLength !== briefRow.canonical_byte_length ||
      sourceCanonical.hasBlockingFindings ||
      sourceCanonical.snapshotSha256 !== sourceRow.snapshot_sha256 ||
      sourceCanonical.canonicalByteLength !== sourceRow.canonical_byte_length
    ) {
      return undefined;
    }
    return {
      acceptedBrief: accepted.brief,
      sourceSnapshot: modelSnapshotRecordSchema.parse({
        canonicalByteLength: sourceRow.canonical_byte_length,
        createdAt: iso(sourceRow.created_at),
        createdBy: sourceRow.created_by,
        id: sourceRow.id,
        modelId: sourceRow.model_id,
        profile: sourceRow.profile,
        projectId: job.project_id,
        schemaVersion: sourceRow.schema_version,
        snapshot: sourceCanonical.snapshot,
        snapshotSha256: sourceRow.snapshot_sha256,
        version: sourceRow.version,
      }),
    };
  } catch {
    return undefined;
  }
}

export class PostgresDesignOptionRepository implements DesignOptionRepository {
  readonly #assetVerifier: DesignAssetVerificationPort;
  readonly #clock: DesignOptionClock;
  readonly #sql: Sql;
  readonly #uuid: DesignOptionUuidFactory;

  constructor(
    sql: Sql,
    options: {
      readonly assetVerifier: DesignAssetVerificationPort;
      readonly clock?: DesignOptionClock;
      readonly uuid?: DesignOptionUuidFactory;
    },
  ) {
    this.#sql = sql;
    this.#assetVerifier = options.assetVerifier;
    this.#clock = options.clock ?? { now: () => new Date() };
    this.#uuid = options.uuid ?? { randomUUID };
  }

  createJob(command: CreateOptionJobCommand) {
    return this.#sql.begin(async (transaction) => {
      await lockProject(transaction, command.actor.tenantId, command.projectId);
      const effect = await claimEffect(transaction, {
        actorUserId: command.actor.userId,
        idempotencyKey: command.idempotencyKey,
        operation: "design-option.job.create",
        projectId: command.projectId,
        requestSha256: command.requestSha256,
        tenantId: command.actor.tenantId,
      });
      if (effect.replay !== undefined) {
        const response = z.object({ jobId: z.uuid() }).parse(effect.replay);
        const row = await loadJob(
          transaction,
          command.actor.tenantId,
          command.projectId,
          response.jobId,
        );
        if (row === undefined) throw new Error("C12 create replay job is missing.");
        return { job: mapJob(row), replayed: true };
      }
      const now = this.#clock.now().toISOString();
      const inserted = await transaction<JobRow[]>`
        INSERT INTO design_option_jobs (
          tenant_id, project_id, id, schema_version, version, attempt, state, stage,
          brief_id, brief_revision, brief_content_sha256, source_model_id, source_profile,
          source_snapshot_id, source_snapshot_version, source_snapshot_sha256,
          working_model_id, working_snapshot_id, working_snapshot_version,
          working_snapshot_sha256, working_snapshot_payload, constraints_payload,
          constraints_sha256, asset_manifest_sha256, requested_option_count,
          requested_directions, option_count, retryable, created_by, created_at, updated_at
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${command.projectId}::uuid, ${command.jobId}::uuid,
          'c12-option-job-v1', 1, 1, 'queued', 'queued',
          ${command.request.baseBrief.briefId}::uuid, ${command.request.baseBrief.revision},
          ${command.request.baseBrief.contentSha256}, ${command.request.sourceModel.modelId}::uuid,
          ${command.request.sourceModel.profile}, ${command.request.sourceModel.snapshotId}::uuid,
          ${command.request.sourceModel.snapshotVersion}, ${command.request.sourceModel.snapshotSha256},
          ${command.workingModel.modelId}::uuid, ${command.workingModel.snapshotId}::uuid,
          ${command.workingModel.snapshotVersion}, ${command.workingModel.snapshotSha256},
          ${transaction.json(json(command.workingSnapshot))},
          ${transaction.json(json(command.constraints))}, ${command.constraintsSha256},
          ${command.assetManifestSha256}, ${command.request.requestedOptionCount},
          ${transaction.json(json(command.request.requestedDirections))}, 0, false,
          ${command.actor.userId}::uuid, ${now}::timestamptz, ${now}::timestamptz
        ) RETURNING *
      `;
      const row = inserted[0];
      if (row === undefined) throw new Error("C12 job insertion failed.");
      await transaction`
        INSERT INTO design_option_attempts (
          tenant_id, project_id, job_id, attempt, job_version, state, stage, created_at, updated_at
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${command.projectId}::uuid, ${command.jobId}::uuid,
          1, 1, 'queued', 'queued', ${now}::timestamptz, ${now}::timestamptz
        )
      `;
      await appendJobEvent(transaction, {
        actorUserId: command.actor.userId,
        job: row,
        tenantId: command.actor.tenantId,
        uuid: this.#uuid,
      });
      await appendAuditOutbox(transaction, {
        action: "design-option.job.create",
        actorUserId: command.actor.userId,
        job: row,
        metadata: {
          attempt: 1,
          constraintsSha256: command.constraintsSha256,
          requestedOptionCount: command.request.requestedOptionCount,
          sourceSnapshotSha256: command.request.sourceModel.snapshotSha256,
          version: 1,
        },
        outcome: "accepted",
        requestId: command.correlation.requestId,
        tenantId: command.actor.tenantId,
        traceId: command.correlation.traceId,
        uuid: this.#uuid,
      });
      await completeEffect(transaction, {
        actorUserId: command.actor.userId,
        idempotencyKey: command.idempotencyKey,
        response: { jobId: command.jobId },
        status: 201,
        tenantId: command.actor.tenantId,
      });
      return { job: mapJob(row), replayed: false };
    });
  }

  async listJobs(tenantId: string, projectId: string): Promise<readonly OptionJob[]> {
    const rows = await this.#sql<JobRow[]>`
      SELECT * FROM design_option_jobs
      WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
      ORDER BY created_at, id LIMIT 100
    `;
    return rows.map(mapJob);
  }

  async findJob(tenantId: string, projectId: string, jobId: string) {
    const rows = await this.#sql<JobRow[]>`
      SELECT * FROM design_option_jobs
      WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
        AND id = ${jobId}::uuid LIMIT 1
    `;
    return rows[0] === undefined ? undefined : mapJob(rows[0]);
  }

  async #transition(command: TransitionOptionJobCommand, operation: "cancel" | "retry") {
    return this.#sql.begin(async (transaction) => {
      await lockProject(transaction, command.actor.tenantId, command.projectId);
      const requestSha256 = c12Sha256({
        expectedVersion: command.expectedVersion,
        jobId: command.jobId,
        projectId: command.projectId,
      });
      const effect = await claimEffect(transaction, {
        actorUserId: command.actor.userId,
        idempotencyKey: command.idempotencyKey,
        operation: operation === "cancel" ? "design-option.job.cancel" : "design-option.job.retry",
        projectId: command.projectId,
        requestSha256,
        tenantId: command.actor.tenantId,
      });
      if (effect.replay !== undefined) {
        const response = z.object({ jobId: z.uuid() }).parse(effect.replay);
        const replay = await loadJob(
          transaction,
          command.actor.tenantId,
          command.projectId,
          response.jobId,
        );
        if (replay === undefined) throw new Error("C12 transition replay job is missing.");
        return { job: mapJob(replay), replayed: true };
      }
      const current = await loadJob(
        transaction,
        command.actor.tenantId,
        command.projectId,
        command.jobId,
        true,
      );
      if (current === undefined) throw notFound();
      if (current.version !== command.expectedVersion) {
        throw designOptionConflict("JOB_VERSION_CONFLICT", "The C12 job version changed.");
      }
      const now = this.#clock.now().toISOString();
      let updated: JobRow[];
      if (operation === "cancel") {
        if (current.state !== "queued" && current.state !== "running") {
          throw designOptionConflict(
            "JOB_VERSION_CONFLICT",
            "Only queued or running C12 jobs can be cancelled.",
          );
        }
        const nextState = current.state === "queued" ? "cancelled" : "cancel-requested";
        const nextStage = current.state === "queued" ? "complete" : current.stage;
        if (current.state === "queued") {
          await transaction`
            UPDATE design_option_attempts SET state = 'cancelled', stage = 'complete',
              updated_at = ${now}::timestamptz
            WHERE tenant_id = ${command.actor.tenantId}::uuid AND project_id = ${command.projectId}::uuid
              AND job_id = ${command.jobId}::uuid AND attempt = ${current.attempt} AND state = 'queued'
          `;
        } else {
          await transaction`
            UPDATE design_option_attempts SET state = 'cancel-requested',
              updated_at = ${now}::timestamptz
            WHERE tenant_id = ${command.actor.tenantId}::uuid AND project_id = ${command.projectId}::uuid
              AND job_id = ${command.jobId}::uuid AND attempt = ${current.attempt} AND state = 'leased'
          `;
        }
        updated = await transaction<JobRow[]>`
          UPDATE design_option_jobs SET state = ${nextState}, stage = ${nextStage},
            version = version + 1, retryable = ${current.state === "queued"},
            cancelled_at = ${current.state === "queued" ? now : null}::timestamptz,
            updated_at = ${now}::timestamptz
          WHERE tenant_id = ${command.actor.tenantId}::uuid AND project_id = ${command.projectId}::uuid
            AND id = ${command.jobId}::uuid AND version = ${command.expectedVersion}
          RETURNING *
        `;
      } else {
        if (!current.retryable || !["failed", "cancelled", "abstained"].includes(current.state)) {
          throw designOptionConflict("JOB_NOT_RETRYABLE", "This C12 job cannot be retried.");
        }
        updated = await transaction<JobRow[]>`
          UPDATE design_option_jobs SET state = 'queued', stage = 'queued', version = version + 1,
            attempt = attempt + 1, option_count = 0, safe_code = NULL, retryable = false,
            cancelled_at = NULL, completed_at = NULL, updated_at = ${now}::timestamptz
          WHERE tenant_id = ${command.actor.tenantId}::uuid AND project_id = ${command.projectId}::uuid
            AND id = ${command.jobId}::uuid AND version = ${command.expectedVersion}
          RETURNING *
        `;
        const row = updated[0];
        if (row !== undefined) {
          await transaction`
            INSERT INTO design_option_attempts (
              tenant_id, project_id, job_id, attempt, job_version, state, stage, created_at, updated_at
            ) VALUES (
              ${command.actor.tenantId}::uuid, ${command.projectId}::uuid, ${command.jobId}::uuid,
              ${row.attempt}, ${row.version}, 'queued', 'queued', ${now}::timestamptz, ${now}::timestamptz
            )
          `;
        }
      }
      const row = updated[0];
      if (row === undefined)
        throw designOptionConflict("JOB_VERSION_CONFLICT", "The C12 job changed concurrently.");
      await appendJobEvent(transaction, {
        actorUserId: command.actor.userId,
        job: row,
        previousState: current.state,
        tenantId: command.actor.tenantId,
        uuid: this.#uuid,
      });
      await appendAuditOutbox(transaction, {
        action: `design-option.job.${operation}`,
        actorUserId: command.actor.userId,
        job: row,
        metadata: { attempt: row.attempt, state: row.state, version: row.version },
        outcome: "accepted",
        requestId: command.correlation.requestId,
        tenantId: command.actor.tenantId,
        traceId: command.correlation.traceId,
        uuid: this.#uuid,
      });
      await completeEffect(transaction, {
        actorUserId: command.actor.userId,
        idempotencyKey: command.idempotencyKey,
        response: { jobId: command.jobId },
        status: 200,
        tenantId: command.actor.tenantId,
      });
      return { job: mapJob(row), replayed: false };
    });
  }

  cancelJob(command: TransitionOptionJobCommand) {
    return this.#transition(command, "cancel");
  }

  retryJob(command: TransitionOptionJobCommand) {
    return this.#transition(command, "retry");
  }

  claimNext(command: ClaimOptionAttemptCommand): Promise<LeasedOptionAttempt | undefined> {
    const leaseSeconds = command.leaseSeconds ?? 60;
    if (leaseSeconds < 30 || leaseSeconds > 3_600) {
      throw designOptionConflict("LEASE_LOST", "C12 leases must be between 30 and 3600 seconds.");
    }
    return this.#sql.begin(async (transaction) => {
      const candidates = await transaction<AttemptRow[]>`
        SELECT a.* FROM design_option_attempts a
        JOIN design_option_jobs j
          ON j.tenant_id = a.tenant_id AND j.project_id = a.project_id AND j.id = a.job_id
        WHERE a.attempt = j.attempt AND (
          (a.state = 'queued' AND j.state = 'queued')
          OR (a.state = 'leased' AND a.lease_expires_at <= clock_timestamp() AND j.state = 'running')
        )
        ORDER BY a.created_at, a.job_id
        FOR UPDATE OF a SKIP LOCKED LIMIT 1
      `;
      const attempt = candidates[0];
      if (attempt === undefined) return undefined;
      const current = await loadJob(
        transaction,
        attempt.tenant_id,
        attempt.project_id,
        attempt.job_id,
        true,
      );
      if (current === undefined) return undefined;
      const now = this.#clock.now();
      const workerInputs = await loadExactWorkerInputs(transaction, attempt.tenant_id, current);
      if (workerInputs === undefined) {
        const failedRows = await transaction<JobRow[]>`
          UPDATE design_option_jobs SET state = 'failed', stage = 'complete',
            safe_code = 'SOURCE_CHANGED', retryable = true, option_count = 0,
            version = version + 1, updated_at = ${now.toISOString()}::timestamptz
          WHERE tenant_id = ${attempt.tenant_id}::uuid AND project_id = ${attempt.project_id}::uuid
            AND id = ${attempt.job_id}::uuid AND version = ${current.version}
          RETURNING *
        `;
        const failed = failedRows[0];
        if (failed === undefined) return undefined;
        await transaction`
          UPDATE design_option_attempts SET state = 'failed', stage = 'complete',
            job_version = ${failed.version}, lease_owner = NULL, lease_token = NULL,
            lease_expires_at = NULL, heartbeat_at = NULL, lease_seconds = NULL,
            updated_at = ${now.toISOString()}::timestamptz
          WHERE tenant_id = ${attempt.tenant_id}::uuid AND project_id = ${attempt.project_id}::uuid
            AND job_id = ${attempt.job_id}::uuid AND attempt = ${attempt.attempt}
        `;
        await appendJobEvent(transaction, {
          job: failed,
          previousState: current.state,
          tenantId: attempt.tenant_id,
          uuid: this.#uuid,
        });
        await appendAuditOutbox(transaction, {
          action: "design-option.job.fail",
          job: failed,
          metadata: {
            attempt: failed.attempt,
            safeCode: "SOURCE_CHANGED",
            state: failed.state,
            version: failed.version,
          },
          outcome: "failed",
          requestId: "worker-input-verification",
          tenantId: attempt.tenant_id,
          traceId: "00000000000000000000000000000000",
          uuid: this.#uuid,
        });
        return undefined;
      }
      const leaseToken = this.#uuid.randomUUID();
      const expiresAt = new Date(now.getTime() + leaseSeconds * 1_000).toISOString();
      let currentRow = current;
      if (attempt.state === "queued") {
        const rows = await transaction<JobRow[]>`
          UPDATE design_option_jobs SET state = 'running', stage = 'deriving-constraints',
            version = version + 1, updated_at = ${now.toISOString()}::timestamptz
          WHERE tenant_id = ${attempt.tenant_id}::uuid AND project_id = ${attempt.project_id}::uuid
            AND id = ${attempt.job_id}::uuid AND state = 'queued'
          RETURNING *
        `;
        currentRow = rows[0] as JobRow;
        await appendJobEvent(transaction, {
          job: currentRow,
          previousState: "queued",
          tenantId: attempt.tenant_id,
          uuid: this.#uuid,
        });
      }
      await transaction`
        UPDATE design_option_attempts SET state = 'leased', stage = ${currentRow.stage},
          job_version = ${currentRow.version}, lease_owner = ${command.workerId},
          lease_token = ${leaseToken}::uuid, lease_expires_at = ${expiresAt}::timestamptz,
          heartbeat_at = ${now.toISOString()}::timestamptz, lease_seconds = ${leaseSeconds},
          updated_at = ${now.toISOString()}::timestamptz
        WHERE tenant_id = ${attempt.tenant_id}::uuid AND project_id = ${attempt.project_id}::uuid
          AND job_id = ${attempt.job_id}::uuid AND attempt = ${attempt.attempt}
      `;
      return {
        acceptedBrief: workerInputs.acceptedBrief,
        attempt: attempt.attempt,
        constraints: z.array(designConstraintSchema).parse(currentRow.constraints_payload),
        job: mapJob(currentRow),
        leaseExpiresAt: expiresAt,
        leaseToken,
        sourceSnapshot: workerInputs.sourceSnapshot,
        tenantId: attempt.tenant_id,
        workingSnapshot: canonicalHomeSnapshotSchema.parse(currentRow.working_snapshot_payload),
      };
    });
  }

  async #lockedLease(
    transaction: TransactionSql,
    command: {
      readonly attempt: number;
      readonly expectedJobVersion: number;
      readonly jobId: string;
      readonly leaseToken: string;
      readonly projectId: string;
      readonly tenantId: string;
      readonly workerId: string;
    },
    allowCancellation = false,
  ): Promise<{ readonly attempt: AttemptRow; readonly job: JobRow }> {
    const rows = await transaction<AttemptRow[]>`
      SELECT * FROM design_option_attempts
      WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
        AND job_id = ${command.jobId}::uuid AND attempt = ${command.attempt}
      FOR UPDATE
    `;
    const attempt = rows[0];
    if (
      attempt === undefined ||
      attempt.job_version !== command.expectedJobVersion ||
      attempt.lease_owner !== command.workerId ||
      attempt.lease_token !== command.leaseToken ||
      attempt.lease_expires_at === null ||
      Date.parse(iso(attempt.lease_expires_at)) <= this.#clock.now().getTime() ||
      (attempt.state !== "leased" && !(allowCancellation && attempt.state === "cancel-requested"))
    ) {
      throw designOptionConflict(
        "LEASE_LOST",
        "The C12 worker lease or publication fence was lost.",
      );
    }
    const job = await loadJob(
      transaction,
      command.tenantId,
      command.projectId,
      command.jobId,
      true,
    );
    if (job === undefined)
      throw designOptionConflict("LEASE_LOST", "The fenced C12 job is unavailable.");
    return { attempt, job };
  }

  heartbeatAttempt(command: HeartbeatOptionAttemptCommand): Promise<LeasedOptionAttempt> {
    const leaseSeconds = command.leaseSeconds ?? 60;
    if (leaseSeconds < 30 || leaseSeconds > 3_600) {
      throw designOptionConflict("LEASE_LOST", "C12 leases must be between 30 and 3600 seconds.");
    }
    return this.#sql.begin(async (transaction) => {
      const leased = await this.#lockedLease(transaction, command);
      const workerInputs = await loadExactWorkerInputs(transaction, command.tenantId, leased.job);
      if (workerInputs === undefined) {
        throw designOptionConflict("SOURCE_CHANGED", "The exact C12 worker inputs changed.");
      }
      const now = this.#clock.now();
      const expiresAt = new Date(now.getTime() + leaseSeconds * 1_000).toISOString();
      await transaction`
        UPDATE design_option_attempts SET heartbeat_at = ${now.toISOString()}::timestamptz,
          lease_expires_at = ${expiresAt}::timestamptz, lease_seconds = ${leaseSeconds},
          updated_at = ${now.toISOString()}::timestamptz
        WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND job_id = ${command.jobId}::uuid AND attempt = ${command.attempt}
      `;
      return {
        acceptedBrief: workerInputs.acceptedBrief,
        attempt: command.attempt,
        constraints: z.array(designConstraintSchema).parse(leased.job.constraints_payload),
        job: mapJob(leased.job),
        leaseExpiresAt: expiresAt,
        leaseToken: command.leaseToken,
        sourceSnapshot: workerInputs.sourceSnapshot,
        tenantId: command.tenantId,
        workingSnapshot: canonicalHomeSnapshotSchema.parse(leased.job.working_snapshot_payload),
      };
    });
  }

  advanceAttempt(command: AdvanceOptionAttemptCommand): Promise<OptionJob> {
    return this.#sql.begin(async (transaction) => {
      const leased = await this.#lockedLease(transaction, command);
      const stages = ["deriving-constraints", "generating", "validating", "publishing"] as const;
      if (
        stages.indexOf(command.stage) !==
        stages.indexOf(leased.job.stage as typeof command.stage) + 1
      ) {
        throw designOptionConflict("LEASE_LOST", "C12 worker stages must advance exactly once.");
      }
      const now = this.#clock.now().toISOString();
      const rows = await transaction<JobRow[]>`
        UPDATE design_option_jobs SET stage = ${command.stage}, version = version + 1,
          updated_at = ${now}::timestamptz
        WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND id = ${command.jobId}::uuid AND version = ${leased.job.version} AND state = 'running'
        RETURNING *
      `;
      const row = rows[0];
      if (row === undefined)
        throw designOptionConflict("LEASE_LOST", "The C12 job changed during stage advance.");
      await transaction`
        UPDATE design_option_attempts SET stage = ${command.stage}, job_version = ${row.version},
          updated_at = ${now}::timestamptz
        WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND job_id = ${command.jobId}::uuid AND attempt = ${command.attempt}
      `;
      await appendJobEvent(transaction, {
        job: row,
        previousState: leased.job.state,
        tenantId: command.tenantId,
        uuid: this.#uuid,
      });
      return mapJob(row);
    });
  }

  publishOptions(command: PublishOptionSetCommand): Promise<OptionJob> {
    return this.#sql.begin(async (transaction) => {
      const leased = await this.#lockedLease(transaction, command);
      if ((await loadExactWorkerInputs(transaction, command.tenantId, leased.job)) === undefined) {
        throw designOptionConflict("SOURCE_CHANGED", "The exact C12 worker inputs changed.");
      }
      if (leased.job.stage !== "publishing" || leased.job.state !== "running") {
        throw designOptionConflict(
          "LEASE_LOST",
          "Only the fenced publishing stage may publish options.",
        );
      }
      const validated = validateOptionPublication({
        constraints: z.array(designConstraintSchema).parse(leased.job.constraints_payload),
        job: mapJob(leased.job),
        optionSet: command.optionSet,
        options: command.options,
        workingSnapshot: canonicalHomeSnapshotSchema.parse(leased.job.working_snapshot_payload),
      });
      for (const option of validated.options) {
        for (const placement of option.operationBundle.assetPlacements) {
          if (!(await this.#assetVerifier.verifyExact(placement.asset))) {
            throw designOptionConflict(
              "ASSET_BINDING_CHANGED",
              "A published C12 asset binding is unavailable or changed.",
            );
          }
        }
      }
      await transaction`
        INSERT INTO design_option_sets (
          tenant_id, project_id, job_id, set_sha256, option_count, set_payload, created_at
        ) VALUES (
          ${command.tenantId}::uuid, ${command.projectId}::uuid, ${command.jobId}::uuid,
          ${validated.optionSet.setSha256}, ${validated.options.length},
          ${transaction.json(json(validated.optionSet))}, ${validated.optionSet.createdAt}::timestamptz
        )
      `;
      for (const option of validated.options) {
        const bundle = option.operationBundle;
        await transaction`
          INSERT INTO design_option_bundles (
            tenant_id, project_id, job_id, id, bundle_sha256, candidate_snapshot_sha256,
            operation_count, asset_count, bundle_payload, created_at
          ) VALUES (
            ${command.tenantId}::uuid, ${command.projectId}::uuid, ${command.jobId}::uuid,
            ${bundle.id}::uuid, ${bundle.bundleSha256}, ${bundle.candidateSnapshotSha256},
            ${bundle.operations.length}, ${bundle.assetPlacements.length},
            ${transaction.json(json(bundle))}, ${option.createdAt}::timestamptz
          )
        `;
        await transaction`
          INSERT INTO design_options (
            tenant_id, project_id, job_id, id, bundle_id, direction, expires_at,
            option_payload, created_at
          ) VALUES (
            ${command.tenantId}::uuid, ${command.projectId}::uuid, ${command.jobId}::uuid,
            ${option.id}::uuid, ${bundle.id}::uuid, ${option.direction},
            ${option.expiresAt}::timestamptz, ${transaction.json(json(option))},
            ${option.createdAt}::timestamptz
          )
        `;
        await transaction`
          INSERT INTO design_option_heads (
            tenant_id, project_id, job_id, option_id, version, status, updated_at
          ) VALUES (
            ${command.tenantId}::uuid, ${command.projectId}::uuid, ${command.jobId}::uuid,
            ${option.id}::uuid, 1, 'pending', ${option.createdAt}::timestamptz
          )
        `;
        await transaction`
          INSERT INTO design_option_state_events (
            id, tenant_id, project_id, job_id, option_id, version, previous_status,
            status, reason_code, occurred_at
          ) VALUES (
            ${this.#uuid.randomUUID()}::uuid, ${command.tenantId}::uuid,
            ${command.projectId}::uuid, ${command.jobId}::uuid, ${option.id}::uuid,
            1, NULL, 'pending', 'published', ${option.createdAt}::timestamptz
          )
        `;
      }
      const now = this.#clock.now().toISOString();
      const rows = await transaction<JobRow[]>`
        UPDATE design_option_jobs SET state = 'succeeded', stage = 'complete',
          option_count = ${validated.options.length}, retryable = false, completed_at = ${now}::timestamptz,
          version = version + 1, updated_at = ${now}::timestamptz
        WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND id = ${command.jobId}::uuid AND version = ${leased.job.version} AND state = 'running'
        RETURNING *
      `;
      const row = rows[0];
      if (row === undefined)
        throw designOptionConflict("LEASE_LOST", "The publication fence was lost.");
      await transaction`
        UPDATE design_option_attempts SET state = 'succeeded', stage = 'complete',
          job_version = ${row.version}, lease_owner = NULL, lease_token = NULL,
          lease_expires_at = NULL, heartbeat_at = NULL, lease_seconds = NULL,
          updated_at = ${now}::timestamptz
        WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND job_id = ${command.jobId}::uuid AND attempt = ${command.attempt}
      `;
      await appendJobEvent(transaction, {
        job: row,
        previousState: "running",
        tenantId: command.tenantId,
        uuid: this.#uuid,
      });
      await appendAuditOutbox(transaction, {
        action: "design-option.job.publish",
        job: row,
        metadata: {
          attempt: row.attempt,
          optionCount: row.option_count,
          setSha256: validated.optionSet.setSha256,
          version: row.version,
        },
        outcome: "accepted",
        requestId: "worker-publication",
        tenantId: command.tenantId,
        traceId: "00000000000000000000000000000000",
        uuid: this.#uuid,
      });
      return mapJob(row);
    });
  }

  async #finishAttempt(
    command: AbstainOptionAttemptCommand | FailOptionAttemptCommand,
    state: "abstained" | "failed",
  ): Promise<OptionJob> {
    return this.#sql.begin(async (transaction) => {
      const leased = await this.#lockedLease(transaction, command);
      const now = this.#clock.now().toISOString();
      const safeCode = command.safeCode;
      const retryable = state === "abstained" ? true : "retryable" in command && command.retryable;
      const rows = await transaction<JobRow[]>`
        UPDATE design_option_jobs SET state = ${state}, stage = 'complete', safe_code = ${safeCode},
          retryable = ${retryable}, option_count = 0,
          completed_at = ${state === "abstained" ? now : null}::timestamptz,
          version = version + 1, updated_at = ${now}::timestamptz
        WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND id = ${command.jobId}::uuid AND version = ${leased.job.version} AND state = 'running'
        RETURNING *
      `;
      const row = rows[0];
      if (row === undefined)
        throw designOptionConflict("LEASE_LOST", "The C12 failure fence was lost.");
      await transaction`
        UPDATE design_option_attempts SET state = 'failed', stage = 'complete',
          job_version = ${row.version}, lease_owner = NULL, lease_token = NULL,
          lease_expires_at = NULL, heartbeat_at = NULL, lease_seconds = NULL,
          updated_at = ${now}::timestamptz
        WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND job_id = ${command.jobId}::uuid AND attempt = ${command.attempt}
      `;
      await appendJobEvent(transaction, {
        job: row,
        previousState: "running",
        tenantId: command.tenantId,
        uuid: this.#uuid,
      });
      await appendAuditOutbox(transaction, {
        action: state === "abstained" ? "design-option.job.abstain" : "design-option.job.fail",
        job: row,
        metadata: {
          attempt: row.attempt,
          safeCode,
          state: row.state,
          version: row.version,
        },
        outcome: state === "abstained" ? "abstained" : "failed",
        requestId: "worker-terminal-state",
        tenantId: command.tenantId,
        traceId: "00000000000000000000000000000000",
        uuid: this.#uuid,
      });
      return mapJob(row);
    });
  }

  abstainAttempt(command: AbstainOptionAttemptCommand) {
    return this.#finishAttempt(command, "abstained");
  }

  failAttempt(command: FailOptionAttemptCommand) {
    return this.#finishAttempt(command, "failed");
  }

  acknowledgeCancellation(command: AcknowledgeOptionCancellationCommand): Promise<OptionJob> {
    return this.#sql.begin(async (transaction) => {
      const leased = await this.#lockedLease(transaction, command, true);
      if (leased.attempt.state !== "cancel-requested" || leased.job.state !== "cancel-requested") {
        throw designOptionConflict(
          "LEASE_LOST",
          "The fenced C12 attempt has no cancellation request.",
        );
      }
      const now = this.#clock.now().toISOString();
      const rows = await transaction<JobRow[]>`
        UPDATE design_option_jobs SET state = 'cancelled', stage = 'complete', retryable = true,
          cancelled_at = ${now}::timestamptz, version = version + 1, updated_at = ${now}::timestamptz
        WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND id = ${command.jobId}::uuid AND state = 'cancel-requested'
        RETURNING *
      `;
      const row = rows[0];
      if (row === undefined)
        throw designOptionConflict("LEASE_LOST", "Cancellation acknowledgement lost its fence.");
      await transaction`
        UPDATE design_option_attempts SET state = 'cancelled', stage = 'complete',
          job_version = ${row.version}, lease_owner = NULL, lease_token = NULL,
          lease_expires_at = NULL, heartbeat_at = NULL, lease_seconds = NULL,
          updated_at = ${now}::timestamptz
        WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND job_id = ${command.jobId}::uuid AND attempt = ${command.attempt}
      `;
      await appendJobEvent(transaction, {
        job: row,
        previousState: "cancel-requested",
        tenantId: command.tenantId,
        uuid: this.#uuid,
      });
      await appendAuditOutbox(transaction, {
        action: "design-option.job.cancel",
        job: row,
        metadata: { attempt: row.attempt, state: row.state, version: row.version },
        outcome: "accepted",
        requestId: "worker-cancellation-acknowledgement",
        tenantId: command.tenantId,
        traceId: "00000000000000000000000000000000",
        uuid: this.#uuid,
      });
      return mapJob(row);
    });
  }

  async listOptions(tenantId: string, projectId: string, jobId: string) {
    const sets = await this.#sql<SetRow[]>`
      SELECT set_payload FROM design_option_sets
      WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
        AND job_id = ${jobId}::uuid LIMIT 1
    `;
    const rows = await this.#sql<OptionRow[]>`
      SELECT o.option_payload, h.status FROM design_options o
      JOIN design_option_heads h
        ON h.tenant_id = o.tenant_id AND h.project_id = o.project_id
        AND h.job_id = o.job_id AND h.option_id = o.id
      WHERE o.tenant_id = ${tenantId}::uuid AND o.project_id = ${projectId}::uuid
        AND o.job_id = ${jobId}::uuid ORDER BY o.direction, o.id LIMIT 8
    `;
    return {
      ...(sets[0] === undefined
        ? {}
        : { optionSet: designOptionSetSchema.parse(sets[0].set_payload) }),
      options: rows.map((row) => mapOption(row, this.#clock.now())),
    };
  }

  async findOption(tenantId: string, projectId: string, jobId: string, optionId: string) {
    const rows = await this.#sql<OptionRow[]>`
      SELECT o.option_payload, h.status FROM design_options o
      JOIN design_option_heads h
        ON h.tenant_id = o.tenant_id AND h.project_id = o.project_id
        AND h.job_id = o.job_id AND h.option_id = o.id
      WHERE o.tenant_id = ${tenantId}::uuid AND o.project_id = ${projectId}::uuid
        AND o.job_id = ${jobId}::uuid AND o.id = ${optionId}::uuid LIMIT 1
    `;
    return rows[0] === undefined ? undefined : mapOption(rows[0], this.#clock.now());
  }

  confirmOption(command: ConfirmOptionCommand) {
    return this.#sql.begin(async (transaction) => {
      await lockProject(transaction, command.actor.tenantId, command.projectId);
      const effect = await claimEffect(transaction, {
        actorUserId: command.actor.userId,
        idempotencyKey: command.request.idempotencyKey,
        operation: "design-option.option.confirm",
        projectId: command.projectId,
        requestSha256: command.requestSha256,
        tenantId: command.actor.tenantId,
      });
      if (effect.replay !== undefined) {
        const response = z.object({ confirmationId: z.uuid() }).parse(effect.replay);
        const rows = await transaction<ConfirmationRow[]>`
          SELECT * FROM design_option_confirmations
          WHERE tenant_id = ${command.actor.tenantId}::uuid AND project_id = ${command.projectId}::uuid
            AND id = ${response.confirmationId}::uuid LIMIT 1
        `;
        if (rows[0] === undefined) throw new Error("C12 confirmation replay is missing.");
        return { confirmation: mapConfirmation(rows[0]), replayed: true };
      }
      const jobRow = await loadJob(
        transaction,
        command.actor.tenantId,
        command.projectId,
        command.jobId,
        true,
      );
      if (jobRow === undefined) throw notFound();
      const setRows = await transaction<SetRow[]>`
        SELECT set_payload FROM design_option_sets
        WHERE tenant_id = ${command.actor.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND job_id = ${command.jobId}::uuid FOR SHARE
      `;
      const optionRows = await transaction<OptionRow[]>`
        SELECT o.option_payload, h.status FROM design_options o
        JOIN design_option_heads h
          ON h.tenant_id = o.tenant_id AND h.project_id = o.project_id
          AND h.job_id = o.job_id AND h.option_id = o.id
        WHERE o.tenant_id = ${command.actor.tenantId}::uuid AND o.project_id = ${command.projectId}::uuid
          AND o.job_id = ${command.jobId}::uuid AND o.id = ${command.optionId}::uuid
        FOR UPDATE OF h
      `;
      const setRow = setRows[0];
      const optionRow = optionRows[0];
      if (setRow === undefined || optionRow === undefined || jobRow.state !== "succeeded") {
        throw designOptionConflict("OPTION_NOT_PENDING", "The exact C12 option is unavailable.");
      }
      const job = mapJob(jobRow);
      const optionSet = designOptionSetSchema.parse(setRow.set_payload);
      const option = designOptionSchema.parse(optionRow.option_payload);
      if (optionRow.status !== "pending") {
        throw designOptionConflict("OPTION_NOT_PENDING", "The C12 option is no longer pending.");
      }
      if (Date.parse(option.expiresAt) <= this.#clock.now().getTime()) {
        throw designOptionConflict(
          "OPTION_EXPIRED",
          "The C12 option expired before confirmation.",
          410,
        );
      }
      if (
        command.request.expectedJobVersion !== job.version ||
        command.request.expectedBriefRevision !== job.baseBrief.revision ||
        command.request.expectedBriefContentSha256 !== job.baseBrief.contentSha256 ||
        command.request.expectedSourceSnapshotSha256 !== job.sourceModel.snapshotSha256 ||
        command.request.expectedOptionSetSha256 !== optionSet.setSha256
      ) {
        throw designOptionConflict(
          "CONFIRMATION_CONFLICT",
          "A C12 confirmation pin is stale or forged.",
        );
      }
      const briefs = await transaction<
        { readonly content_sha256: string; readonly revision: number }[]
      >`
        SELECT r.content_sha256, r.revision FROM design_briefs b
        JOIN design_brief_revisions r
          ON r.tenant_id = b.tenant_id AND r.project_id = b.project_id
          AND r.brief_id = b.id AND r.revision = b.current_revision
        JOIN design_brief_acceptance_events a
          ON a.tenant_id = r.tenant_id AND a.project_id = r.project_id
          AND a.brief_id = r.brief_id AND a.accepted_revision = r.revision
        WHERE b.tenant_id = ${command.actor.tenantId}::uuid AND b.project_id = ${command.projectId}::uuid
          AND b.id = ${job.baseBrief.briefId}::uuid AND b.current_status = 'accepted'
        FOR SHARE OF b, r
      `;
      const brief = briefs[0];
      if (
        brief === undefined ||
        brief.revision !== job.baseBrief.revision ||
        brief.content_sha256 !== job.baseBrief.contentSha256
      ) {
        throw designOptionConflict(
          "SOURCE_CHANGED",
          "The accepted C11 brief changed before confirmation.",
        );
      }
      const sources = await transaction<{ readonly id: string }[]>`
        SELECT id FROM canonical_model_snapshots
        WHERE tenant_id = ${command.actor.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND model_id = ${job.sourceModel.modelId}::uuid AND profile = ${job.sourceModel.profile}
          AND id = ${job.sourceModel.snapshotId}::uuid
          AND snapshot_sha256 = ${job.sourceModel.snapshotSha256}
          AND version = ${job.sourceModel.snapshotVersion}
        FOR SHARE
      `;
      if (sources.length !== 1) {
        throw designOptionConflict(
          "SOURCE_CHANGED",
          "The exact committed source snapshot changed.",
        );
      }
      const workingSnapshot = canonicalHomeSnapshotSchema.parse(jobRow.working_snapshot_payload);
      const workingCanonical = validateAndCanonicalizeSnapshot(workingSnapshot);
      if (
        workingCanonical.hasBlockingFindings ||
        workingCanonical.snapshotSha256 !== job.workingModel.snapshotSha256 ||
        constraintsSha256(job.constraints) !== job.constraintsSha256
      ) {
        throw designOptionConflict(
          "CONFIRMATION_CONFLICT",
          "The retained working model or constraints failed integrity verification.",
        );
      }
      const validated = validateOptionPublication({
        constraints: job.constraints,
        job,
        optionSet,
        options: [
          option,
          ...(
            await transaction<OptionRow[]>`
            SELECT o.option_payload, h.status FROM design_options o
            JOIN design_option_heads h ON h.tenant_id = o.tenant_id AND h.project_id = o.project_id
              AND h.job_id = o.job_id AND h.option_id = o.id
            WHERE o.tenant_id = ${command.actor.tenantId}::uuid AND o.project_id = ${command.projectId}::uuid
              AND o.job_id = ${command.jobId}::uuid AND o.id <> ${command.optionId}::uuid
            ORDER BY o.id
          `
          ).map((row) => designOptionSchema.parse(row.option_payload)),
        ],
        workingSnapshot: workingCanonical.snapshot,
      });
      const retained = validated.options.find(({ id }) => id === command.optionId);
      if (retained === undefined)
        throw designOptionConflict("CONFIRMATION_CONFLICT", "The option set is incomplete.");
      for (const placement of retained.operationBundle.assetPlacements) {
        if (!(await this.#assetVerifier.verifyExact(placement.asset))) {
          throw designOptionConflict(
            "ASSET_BINDING_CHANGED",
            "An exact synthetic asset binding changed before confirmation.",
          );
        }
      }
      const candidate = reduceModelOperations(
        workingCanonical.snapshot,
        retained.operationBundle.operations,
      );
      if (
        candidate.hasBlockingFindings ||
        candidate.snapshotSha256 !== retained.operationBundle.candidateSnapshotSha256
      ) {
        throw designOptionConflict(
          "CONSTRAINTS_FAILED",
          "The exact retained operations failed replay or geometry validation.",
          422,
        );
      }

      const profileRows = await transaction<
        Array<{
          readonly current_snapshot_id: string | null;
          readonly current_snapshot_sha256: string | null;
          readonly current_snapshot_version: number | null;
        }>
      >`
        SELECT current_snapshot_id, current_snapshot_sha256, current_snapshot_version
        FROM canonical_model_profiles
        WHERE tenant_id = ${command.actor.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND model_id = ${job.workingModel.modelId}::uuid AND profile = 'proposed'
        FOR UPDATE
      `;
      if (profileRows[0] === undefined) {
        await transaction`
          INSERT INTO canonical_model_profiles (tenant_id, project_id, model_id, profile)
          VALUES (${command.actor.tenantId}::uuid, ${command.projectId}::uuid,
            ${job.workingModel.modelId}::uuid, 'proposed')
        `;
      }
      const baseRows = await transaction<{ readonly id: string; readonly version: number }[]>`
        SELECT id, version FROM canonical_model_snapshots
        WHERE tenant_id = ${command.actor.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND model_id = ${job.workingModel.modelId}::uuid AND profile = 'proposed'
          AND id = ${job.workingModel.snapshotId}::uuid
          AND snapshot_sha256 = ${job.workingModel.snapshotSha256}
          AND version = ${job.workingModel.snapshotVersion}
        LIMIT 1
      `;
      const now = this.#clock.now().toISOString();
      const committedAt = new Date(Date.parse(now) + 1).toISOString();
      if (baseRows[0] === undefined) {
        const currentProfile = profileRows[0];
        if (currentProfile !== undefined && currentProfile.current_snapshot_id !== null) {
          throw designOptionConflict(
            "PROPOSED_BASE_CONFLICT",
            "The exact proposed working base cannot be seeded over another profile head.",
          );
        }
        await transaction`
          INSERT INTO canonical_model_snapshots (
            id, tenant_id, project_id, model_id, profile, property_id,
            derived_from_snapshot_sha256, version, schema_version, canonical_snapshot,
            snapshot_sha256, canonical_byte_length, validation_findings, created_by, created_at
          ) VALUES (
            ${job.workingModel.snapshotId}::uuid, ${command.actor.tenantId}::uuid,
            ${command.projectId}::uuid, ${job.workingModel.modelId}::uuid, 'proposed',
            ${workingCanonical.snapshot.propertyId ?? null}::uuid,
            ${workingCanonical.snapshot.derivedFromSnapshotSha256 ?? null},
            ${job.workingModel.snapshotVersion}, ${workingCanonical.snapshot.schemaVersion},
            ${transaction.json(json(workingCanonical.snapshot))}, ${workingCanonical.snapshotSha256},
            ${workingCanonical.canonicalByteLength}, ${transaction.json(json(workingCanonical.findings))},
          ${command.actor.userId}::uuid, ${committedAt}::timestamptz
          )
        `;
        await transaction`
          UPDATE canonical_model_profiles SET current_snapshot_id = ${job.workingModel.snapshotId}::uuid,
            current_snapshot_sha256 = ${job.workingModel.snapshotSha256},
            current_snapshot_version = ${job.workingModel.snapshotVersion},
            updated_by = ${command.actor.userId}::uuid, updated_at = ${now}::timestamptz
          WHERE tenant_id = ${command.actor.tenantId}::uuid AND project_id = ${command.projectId}::uuid
            AND model_id = ${job.workingModel.modelId}::uuid AND profile = 'proposed'
            AND current_snapshot_id IS NULL
        `;
      }

      const branchId = this.#uuid.randomUUID();
      const previewId = this.#uuid.randomUUID();
      const commitId = this.#uuid.randomUUID();
      const resultSnapshotId = this.#uuid.randomUUID();
      const confirmationId = this.#uuid.randomUUID();
      await transaction`
        INSERT INTO model_branches (
          tenant_id, project_id, model_id, profile, id, name, source_snapshot_id,
          source_snapshot_sha256, source_snapshot_version, head_snapshot_id,
          head_snapshot_sha256, head_snapshot_version, revision, created_by,
          created_at, updated_by, updated_at
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${command.projectId}::uuid,
          ${job.workingModel.modelId}::uuid, 'proposed', ${branchId}::uuid,
          ${`Design option ${retained.id.slice(0, 8)}`}, ${job.workingModel.snapshotId}::uuid,
          ${job.workingModel.snapshotSha256}, ${job.workingModel.snapshotVersion},
          ${job.workingModel.snapshotId}::uuid, ${job.workingModel.snapshotSha256},
          ${job.workingModel.snapshotVersion}, 0, ${command.actor.userId}::uuid,
          ${now}::timestamptz, ${command.actor.userId}::uuid, ${now}::timestamptz
        )
      `;
      await transaction`
        INSERT INTO model_operation_previews (
          tenant_id, project_id, model_id, profile, branch_id, id, created_by,
          created_at, expires_at, base_revision, base_snapshot_id, base_snapshot_sha256,
          base_snapshot_version, operation_payload, operation_payload_sha256,
          result_snapshot_sha256, result_canonical_byte_length, findings, has_blocking_findings
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${command.projectId}::uuid,
          ${job.workingModel.modelId}::uuid, 'proposed', ${branchId}::uuid, ${previewId}::uuid,
          ${command.actor.userId}::uuid, ${now}::timestamptz,
          ${new Date(this.#clock.now().getTime() + 15 * 60_000).toISOString()}::timestamptz,
          0, ${job.workingModel.snapshotId}::uuid, ${job.workingModel.snapshotSha256},
          ${job.workingModel.snapshotVersion}, ${transaction.json(json(retained.operationBundle.operations))},
          ${c12Sha256(retained.operationBundle.operations)}, ${candidate.snapshotSha256},
          ${candidate.canonicalByteLength}, ${transaction.json(json(candidate.findings))}, false
        )
      `;
      const profile = await transaction<
        Array<{ readonly current_snapshot_version: number | null }>
      >`
        SELECT current_snapshot_version FROM canonical_model_profiles
        WHERE tenant_id = ${command.actor.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND model_id = ${job.workingModel.modelId}::uuid AND profile = 'proposed'
        FOR UPDATE
      `;
      const resultVersion = (profile[0]?.current_snapshot_version ?? 0) + 1;
      await transaction`
        INSERT INTO canonical_model_snapshots (
          id, tenant_id, project_id, model_id, profile, property_id,
          derived_from_snapshot_sha256, version, schema_version, canonical_snapshot,
          snapshot_sha256, canonical_byte_length, validation_findings, created_by, created_at
        ) VALUES (
          ${resultSnapshotId}::uuid, ${command.actor.tenantId}::uuid, ${command.projectId}::uuid,
          ${job.workingModel.modelId}::uuid, 'proposed', ${candidate.snapshot.propertyId ?? null}::uuid,
          ${candidate.snapshot.derivedFromSnapshotSha256 ?? null}, ${resultVersion},
          ${candidate.snapshot.schemaVersion}, ${transaction.json(json(candidate.snapshot))},
          ${candidate.snapshotSha256}, ${candidate.canonicalByteLength},
          ${transaction.json(json(candidate.findings))}, ${command.actor.userId}::uuid,
          ${now}::timestamptz
        )
      `;
      await transaction`
        INSERT INTO model_operation_commits (
          tenant_id, project_id, model_id, profile, branch_id, id, revision, message,
          preview_id, operation_count, parent_snapshot_id, parent_snapshot_sha256,
          parent_snapshot_version, snapshot_id, snapshot_sha256, snapshot_version,
          validation_findings, committed_by, committed_at, request_id, trace_id
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${command.projectId}::uuid,
          ${job.workingModel.modelId}::uuid, 'proposed', ${branchId}::uuid, ${commitId}::uuid,
          1, 'Confirm exact C12 design option.', ${previewId}::uuid,
          ${retained.operationBundle.operations.length}, ${job.workingModel.snapshotId}::uuid,
          ${job.workingModel.snapshotSha256}, ${job.workingModel.snapshotVersion},
          ${resultSnapshotId}::uuid, ${candidate.snapshotSha256}, ${resultVersion},
          ${transaction.json(json(candidate.findings))}, ${command.actor.userId}::uuid,
          ${committedAt}::timestamptz, ${command.correlation.requestId}, ${command.correlation.traceId}
        )
      `;
      for (const [ordinal, operation] of retained.operationBundle.operations.entries()) {
        await transaction`
          INSERT INTO model_operation_envelopes (
            tenant_id, project_id, model_id, profile, branch_id, commit_id, id,
            revision, ordinal, schema_version, type, client_operation_id, reason,
            operation_payload, committed_by, committed_at
          ) VALUES (
            ${command.actor.tenantId}::uuid, ${command.projectId}::uuid,
            ${job.workingModel.modelId}::uuid, 'proposed', ${branchId}::uuid, ${commitId}::uuid,
            ${this.#uuid.randomUUID()}::uuid, 1, ${ordinal}, ${operation.schemaVersion},
            ${operation.type}, ${operation.clientOperationId}::uuid, ${operation.reason},
            ${transaction.json(json(operation))}, ${command.actor.userId}::uuid, ${committedAt}::timestamptz
          )
        `;
      }
      await transaction`
        UPDATE canonical_model_profiles SET current_snapshot_id = ${resultSnapshotId}::uuid,
          current_snapshot_sha256 = ${candidate.snapshotSha256}, current_snapshot_version = ${resultVersion},
          updated_by = ${command.actor.userId}::uuid, updated_at = ${committedAt}::timestamptz
        WHERE tenant_id = ${command.actor.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND model_id = ${job.workingModel.modelId}::uuid AND profile = 'proposed'
      `;
      await transaction`
        UPDATE model_branches SET head_snapshot_id = ${resultSnapshotId}::uuid,
          head_snapshot_sha256 = ${candidate.snapshotSha256}, head_snapshot_version = ${resultVersion},
          revision = 1, updated_by = ${command.actor.userId}::uuid, updated_at = ${committedAt}::timestamptz
        WHERE tenant_id = ${command.actor.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND model_id = ${job.workingModel.modelId}::uuid AND profile = 'proposed'
          AND id = ${branchId}::uuid AND revision = 0
      `;
      await transaction`
        INSERT INTO model_domain_audit_events (
          id, tenant_id, project_id, model_id, profile, branch_id, commit_id, revision,
          action, event_type, operation_types, outcome, snapshot_id, snapshot_sha256,
          actor_user_id, request_id, trace_id, occurred_at
        ) VALUES (
          ${this.#uuid.randomUUID()}::uuid, ${command.actor.tenantId}::uuid,
          ${command.projectId}::uuid, ${job.workingModel.modelId}::uuid, 'proposed',
          ${branchId}::uuid, ${commitId}::uuid, 1, 'model:operation:commit',
          'model.operations.committed.v1',
          ${transaction.json(json(retained.operationBundle.operations.map(({ type }) => type)))},
          'accepted', ${resultSnapshotId}::uuid, ${candidate.snapshotSha256},
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
          ${command.projectId}::uuid, ${job.workingModel.modelId}::uuid, 'proposed',
          ${branchId}::uuid, ${commitId}::uuid, 1, 'model.operations.committed.v1',
          'c5-model-operation-v1', ${transaction.json(
            json({
              branchId,
              commitId,
              operationCount: retained.operationBundle.operations.length,
              revision: 1,
              snapshotSha256: candidate.snapshotSha256,
            }),
          )}, ${committedAt}::timestamptz
        )
      `;
      await transaction`
        UPDATE design_option_heads SET status = 'confirmed', version = version + 1,
          updated_at = ${committedAt}::timestamptz
        WHERE tenant_id = ${command.actor.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND job_id = ${command.jobId}::uuid AND option_id = ${command.optionId}::uuid
          AND status = 'pending' AND version = 1
      `;
      await transaction`
        INSERT INTO design_option_state_events (
          id, tenant_id, project_id, job_id, option_id, version, previous_status,
          status, reason_code, actor_user_id, occurred_at
        ) VALUES (
          ${this.#uuid.randomUUID()}::uuid, ${command.actor.tenantId}::uuid,
          ${command.projectId}::uuid, ${command.jobId}::uuid, ${command.optionId}::uuid,
          2, 'pending', 'confirmed', 'confirmed', ${command.actor.userId}::uuid,
          ${committedAt}::timestamptz
        )
      `;
      const confirmations = await transaction<ConfirmationRow[]>`
        INSERT INTO design_option_confirmations (
          id, tenant_id, project_id, job_id, option_id, schema_version, idempotency_key,
          branch_id, branch_revision, preview_id, commit_id, profile, result_snapshot_id,
          result_snapshot_sha256, confirmed_by, confirmed_at, request_id, trace_id
        ) VALUES (
          ${confirmationId}::uuid, ${command.actor.tenantId}::uuid, ${command.projectId}::uuid,
          ${command.jobId}::uuid, ${command.optionId}::uuid, 'c12-option-confirmation-v1',
          ${command.request.idempotencyKey}, ${branchId}::uuid, 1, ${previewId}::uuid,
          ${commitId}::uuid, 'proposed', ${resultSnapshotId}::uuid, ${candidate.snapshotSha256},
          ${command.actor.userId}::uuid, ${committedAt}::timestamptz,
          ${command.correlation.requestId}, ${command.correlation.traceId}
        ) RETURNING *
      `;
      await appendAuditOutbox(transaction, {
        action: "design-option.option.confirm",
        actorUserId: command.actor.userId,
        job: jobRow,
        metadata: {
          branchRevision: 1,
          resultSnapshotSha256: candidate.snapshotSha256,
          version: job.version,
        },
        occurredAt: committedAt,
        optionId: command.optionId,
        outcome: "accepted",
        requestId: command.correlation.requestId,
        tenantId: command.actor.tenantId,
        traceId: command.correlation.traceId,
        uuid: this.#uuid,
      });
      await completeEffect(transaction, {
        actorUserId: command.actor.userId,
        idempotencyKey: command.request.idempotencyKey,
        response: { confirmationId },
        status: 201,
        tenantId: command.actor.tenantId,
      });
      const confirmation = confirmations[0];
      if (confirmation === undefined) throw new Error("C12 confirmation insertion failed.");
      return { confirmation: mapConfirmation(confirmation), replayed: false };
    });
  }
}
