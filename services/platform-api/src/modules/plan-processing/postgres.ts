import {
  c6PlanPolicy,
  c6PlanOperationDraftSchemaVersion,
  c6PlanJobSchemaVersion,
  modelBranchSchema,
  planCalibrationSchema,
  planOperationDraftSchema,
  planParserResultSchema,
  planProcessingJobSchema,
  type ModelBranch,
  type PlanCalibration,
  type PlanOperationDraft,
  type PlanParserResult,
  type PlanProcessingJob,
} from "@interior-design/contracts";
import { randomUUID } from "node:crypto";
import type { JSONValue, Sql, TransactionSql } from "postgres";

import { ApiError } from "../../errors.js";
import {
  claimIdempotency,
  completeIdempotency,
  type IdempotencyClaim,
} from "../projects/idempotency.js";
import { planConflict } from "./errors.js";
import type {
  BranchTarget,
  CreateCalibrationCommand,
  CreateOperationDraftCommand,
  CreatePlanJobCommand,
  EligiblePlanSource,
  PlanProcessingClock,
  PlanProcessingRepository,
  PlanProcessingUuidFactory,
  TransitionPlanJobCommand,
} from "./types.js";

interface JobRow {
  readonly asset_id: string;
  readonly attempt: number;
  readonly created_at: Date | string;
  readonly id: string;
  readonly page_index: number;
  readonly parser_preference: string;
  readonly project_id: string;
  readonly result_id: string | null;
  readonly retryable: boolean;
  readonly root_job_id: string;
  readonly safe_code: string | null;
  readonly source_sha256: string;
  readonly state: string;
  readonly updated_at: Date | string;
  readonly version: number;
}

interface SourceRow {
  readonly asset_id: string;
  readonly basis: string;
  readonly byte_size: number | string;
  readonly detected_mime_type: string | null;
  readonly kind: string;
  readonly project_id: string;
  readonly service_processing_consent: boolean;
  readonly sha256: string;
  readonly status: string;
  readonly tenant_id: string;
  readonly training_use_consent: string;
}

interface BranchRow {
  readonly canonical_snapshot: unknown;
  readonly created_at: Date | string;
  readonly created_by: string;
  readonly head_snapshot_id: string;
  readonly head_snapshot_sha256: string;
  readonly id: string;
  readonly model_id: string;
  readonly name: string;
  readonly profile: string;
  readonly project_id: string;
  readonly revision: number;
  readonly source_snapshot_id: string;
  readonly updated_at: Date | string;
}

const systemClock: PlanProcessingClock = { now: () => new Date() };
const systemUuid: PlanProcessingUuidFactory = { randomUUID };

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function json(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function mapJob(row: JobRow): PlanProcessingJob {
  return planProcessingJobSchema.parse({
    assetId: row.asset_id,
    attempt: row.attempt,
    createdAt: iso(row.created_at),
    id: row.id,
    pageIndex: row.page_index,
    parserPreference: row.parser_preference,
    projectId: row.project_id,
    resultId: row.result_id ?? undefined,
    retryable: row.retryable,
    safeCode: row.safe_code ?? undefined,
    schemaVersion: c6PlanJobSchemaVersion,
    sourceSha256: row.source_sha256,
    state: row.state,
    updatedAt: iso(row.updated_at),
    version: row.version,
  });
}

function mapSource(row: SourceRow): EligiblePlanSource {
  return {
    assetId: row.asset_id,
    byteSize: Number(row.byte_size),
    ...(row.detected_mime_type === null ? {} : { detectedMimeType: row.detected_mime_type }),
    kind: row.kind,
    projectId: row.project_id,
    rights: {
      basis: row.basis,
      serviceProcessingConsent: row.service_processing_consent,
      trainingUseConsent: row.training_use_consent,
    },
    sha256: row.sha256,
    status: row.status,
    tenantId: row.tenant_id,
  };
}

function mapBranch(row: BranchRow): ModelBranch {
  return modelBranchSchema.parse({
    createdAt: iso(row.created_at),
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
    updatedAt: iso(row.updated_at),
  });
}

function mutationClaim(
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

function nextTimestamp(clock: PlanProcessingClock, previous?: Date | string): Date {
  const candidate = clock.now();
  if (previous === undefined) return candidate;
  const minimum = new Date(previous).getTime() + 1;
  return candidate.getTime() >= minimum ? candidate : new Date(minimum);
}

async function appendEvent(
  transaction: TransactionSql,
  uuid: PlanProcessingUuidFactory,
  input: {
    readonly action: string;
    readonly actorUserId: string;
    readonly correlation: { readonly requestId: string; readonly traceId: string };
    readonly jobId: string;
    readonly metadata: object;
    readonly occurredAt: Date;
    readonly projectId: string;
    readonly tenantId: string;
  },
): Promise<void> {
  await transaction`
    INSERT INTO plan_processing_audit_events (
      id, tenant_id, project_id, job_id, action, actor_user_id,
      request_id, trace_id, metadata, occurred_at
    ) VALUES (
      ${uuid.randomUUID()}::uuid, ${input.tenantId}::uuid, ${input.projectId}::uuid,
      ${input.jobId}::uuid, ${input.action}, ${input.actorUserId}::uuid,
      ${input.correlation.requestId}, ${input.correlation.traceId},
      ${transaction.json(json(input.metadata))}, ${input.occurredAt}
    )
  `;
  await transaction`
    INSERT INTO plan_processing_outbox (
      id, tenant_id, project_id, job_id, event_type, schema_version, payload, occurred_at
    ) VALUES (
      ${uuid.randomUUID()}::uuid, ${input.tenantId}::uuid, ${input.projectId}::uuid,
      ${input.jobId}::uuid, ${input.action.replaceAll("_", ".")},
      ${c6PlanJobSchemaVersion}, ${transaction.json(json(input.metadata))}, ${input.occurredAt}
    )
  `;
}

function versionConflict(job: PlanProcessingJob): ApiError {
  return new ApiError({
    code: "PLAN_JOB_VERSION_CONFLICT",
    detail: `The plan job changed and is now version ${String(job.version)}. Reload before retrying the transition.`,
    statusCode: 409,
    title: "Plan Job Version Conflict",
  });
}

export class PostgresPlanProcessingRepository implements PlanProcessingRepository {
  readonly #clock: PlanProcessingClock;
  readonly #sql: Sql;
  readonly #uuid: PlanProcessingUuidFactory;

  constructor(
    sql: Sql,
    options: {
      readonly clock?: PlanProcessingClock;
      readonly uuid?: PlanProcessingUuidFactory;
    } = {},
  ) {
    this.#sql = sql;
    this.#clock = options.clock ?? systemClock;
    this.#uuid = options.uuid ?? systemUuid;
  }

  async findPlanSource(
    tenantId: string,
    projectId: string,
    assetId: string,
  ): Promise<EligiblePlanSource | undefined> {
    const rows = await this.#sql<SourceRow[]>`
      SELECT a.id AS asset_id, a.tenant_id, a.project_id, a.kind, a.status,
        a.detected_mime_type, a.source_byte_size AS byte_size, a.source_sha256 AS sha256,
        r.basis, r.service_processing_consent, r.training_use_consent
      FROM assets a
      JOIN asset_rights_assertions r
        ON r.tenant_id = a.tenant_id AND r.project_id = a.project_id AND r.asset_id = a.id
      WHERE a.tenant_id = ${tenantId}::uuid
        AND a.project_id = ${projectId}::uuid
        AND a.id = ${assetId}::uuid
      LIMIT 1
    `;
    return rows[0] === undefined ? undefined : mapSource(rows[0]);
  }

  async createJob(
    command: CreatePlanJobCommand,
  ): Promise<{ readonly job: PlanProcessingJob; readonly replayed: boolean }> {
    return this.#sql.begin(async (transaction) => {
      const claim = mutationClaim(command, "plan.job.create", {
        assetId: command.assetId,
        pageIndex: command.pageIndex,
        parserPreference: command.parserPreference,
        projectId: command.projectId,
        sourceSha256: command.sourceSha256,
      });
      const idempotency = await claimIdempotency(transaction, claim);
      if (idempotency.kind === "replay") {
        return { job: planProcessingJobSchema.parse(idempotency.body), replayed: true };
      }
      const sourceRows = await transaction<SourceRow[]>`
        SELECT a.id AS asset_id, a.tenant_id, a.project_id, a.kind, a.status,
          a.detected_mime_type, a.source_byte_size AS byte_size, a.source_sha256 AS sha256,
          r.basis, r.service_processing_consent, r.training_use_consent
        FROM assets a JOIN asset_rights_assertions r
          ON r.tenant_id = a.tenant_id AND r.project_id = a.project_id AND r.asset_id = a.id
        WHERE a.tenant_id = ${command.actor.tenantId}::uuid
          AND a.project_id = ${command.projectId}::uuid AND a.id = ${command.assetId}::uuid
        LIMIT 1 FOR SHARE OF a, r
      `;
      const source = sourceRows[0];
      if (
        source === undefined ||
        source.kind !== "plan" ||
        source.status !== "ready" ||
        source.sha256 !== command.sourceSha256 ||
        Number(source.byte_size) > c6PlanPolicy.maximumAssetBytes ||
        !source.service_processing_consent ||
        source.training_use_consent !== "denied" ||
        !["owned-by-user", "permission-granted", "public-domain", "licensed"].includes(
          source.basis,
        ) ||
        !["application/pdf", "image/svg+xml", "image/png", "image/jpeg"].includes(
          source.detected_mime_type ?? "",
        )
      ) {
        throw planConflict(
          "PLAN_SOURCE_CHANGED",
          "The exact C2 source, readiness, fingerprint, MIME type, or rights state changed.",
        );
      }
      const id = this.#uuid.randomUUID();
      const timestamp = nextTimestamp(this.#clock);
      const rows = await transaction<JobRow[]>`
        INSERT INTO plan_processing_jobs (
          tenant_id, project_id, id, root_job_id, asset_id, page_index, parser_preference,
          source_sha256, attempt, state, retryable, created_by, created_at, updated_at, version
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${command.projectId}::uuid, ${id}::uuid, ${id}::uuid,
          ${command.assetId}::uuid, ${command.pageIndex}, ${command.parserPreference},
          ${command.sourceSha256}, 1, 'queued', false, ${command.actor.userId}::uuid,
          ${timestamp}, ${timestamp}, 1
        ) RETURNING *
      `;
      const row = rows[0];
      if (row === undefined) throw new Error("Plan job insert returned no row.");
      const job = mapJob(row);
      await appendEvent(transaction, this.#uuid, {
        action: "plan.job.create",
        actorUserId: command.actor.userId,
        correlation: command.correlation,
        jobId: job.id,
        metadata: {
          assetId: job.assetId,
          attempt: job.attempt,
          jobId: job.id,
          pageIndex: job.pageIndex,
          sourceSha256: job.sourceSha256,
          state: job.state,
        },
        occurredAt: timestamp,
        projectId: command.projectId,
        tenantId: command.actor.tenantId,
      });
      await completeIdempotency(transaction, claim, 201, job);
      return { job, replayed: false };
    });
  }

  async listJobs(tenantId: string, projectId: string): Promise<readonly PlanProcessingJob[]> {
    const rows = await this.#sql<JobRow[]>`
      SELECT * FROM plan_processing_jobs
      WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
      ORDER BY created_at ASC, id ASC LIMIT 100
    `;
    return rows.map(mapJob);
  }

  async findJob(
    tenantId: string,
    projectId: string,
    jobId: string,
  ): Promise<PlanProcessingJob | undefined> {
    const rows = await this.#sql<JobRow[]>`
      SELECT * FROM plan_processing_jobs
      WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid AND id = ${jobId}::uuid
      LIMIT 1
    `;
    return rows[0] === undefined ? undefined : mapJob(rows[0]);
  }

  async findResult(
    tenantId: string,
    projectId: string,
    jobId: string,
  ): Promise<PlanParserResult | undefined> {
    const rows = await this.#sql<{ readonly result_payload: unknown }[]>`
      SELECT r.result_payload
      FROM plan_processing_results r
      JOIN plan_processing_jobs j
        ON j.tenant_id = r.tenant_id AND j.project_id = r.project_id AND j.id = r.job_id
      WHERE r.tenant_id = ${tenantId}::uuid AND r.project_id = ${projectId}::uuid
        AND r.job_id = ${jobId}::uuid
      LIMIT 1
    `;
    return rows[0] === undefined ? undefined : planParserResultSchema.parse(rows[0].result_payload);
  }

  async cancelJob(
    command: TransitionPlanJobCommand,
  ): Promise<{ readonly job: PlanProcessingJob; readonly replayed: boolean }> {
    return this.#transition(command, "cancel");
  }

  async retryJob(
    command: TransitionPlanJobCommand,
  ): Promise<{ readonly job: PlanProcessingJob; readonly replayed: boolean }> {
    return this.#transition(command, "retry");
  }

  async #transition(
    command: TransitionPlanJobCommand,
    transition: "cancel" | "retry",
  ): Promise<{ readonly job: PlanProcessingJob; readonly replayed: boolean }> {
    return this.#sql.begin(async (transaction) => {
      const operation = `plan.job.${transition}`;
      const claim = mutationClaim(command, operation, {
        expectedVersion: command.expectedVersion,
        jobId: command.jobId,
        projectId: command.projectId,
      });
      const idempotency = await claimIdempotency(transaction, claim);
      if (idempotency.kind === "replay")
        return { job: planProcessingJobSchema.parse(idempotency.body), replayed: true };
      const rows = await transaction<JobRow[]>`
        SELECT * FROM plan_processing_jobs
        WHERE tenant_id = ${command.actor.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND id = ${command.jobId}::uuid LIMIT 1 FOR UPDATE
      `;
      const row = rows[0];
      if (row === undefined)
        throw new ApiError({
          code: "NOT_FOUND",
          detail: "The requested resource was not found.",
          statusCode: 404,
          title: "Not Found",
        });
      const current = mapJob(row);
      if (current.version !== command.expectedVersion) throw versionConflict(current);
      let job: PlanProcessingJob;
      const timestamp = nextTimestamp(this.#clock, row.updated_at);
      if (transition === "cancel") {
        if (current.state === "cancel-requested") {
          job = current;
        } else {
          if (current.state !== "queued" && current.state !== "processing")
            throw planConflict(
              "PLAN_JOB_NOT_CANCELLABLE",
              "Only queued or processing plan work can be cancelled.",
            );
          const targetState = current.state === "queued" ? "cancelled" : "cancel-requested";
          const updated = await transaction<JobRow[]>`
            UPDATE plan_processing_jobs SET state = ${targetState}, updated_at = ${timestamp}, version = version + 1
            WHERE tenant_id = ${command.actor.tenantId}::uuid AND project_id = ${command.projectId}::uuid
              AND id = ${command.jobId}::uuid AND version = ${current.version}
            RETURNING *
          `;
          if (updated[0] === undefined) throw versionConflict(current);
          job = mapJob(updated[0]);
        }
      } else {
        if (
          (current.state !== "abstained" && current.state !== "failed") ||
          !current.retryable ||
          current.attempt >= c6PlanPolicy.maximumAttempts
        ) {
          throw planConflict(
            "PLAN_JOB_NOT_RETRYABLE",
            "Only a retryable failed or abstained attempt can create the next bounded attempt.",
          );
        }
        const existing = await transaction<{ readonly id: string }[]>`
          SELECT id FROM plan_processing_jobs
          WHERE tenant_id = ${command.actor.tenantId}::uuid AND project_id = ${command.projectId}::uuid
            AND root_job_id = ${row.root_job_id}::uuid AND attempt = ${current.attempt + 1}
          LIMIT 1
        `;
        if (existing.length > 0)
          throw planConflict(
            "PLAN_RETRY_ALREADY_CREATED",
            "The next attempt already exists; reload the job list.",
          );
        const sourceRows = await transaction<SourceRow[]>`
          SELECT a.id AS asset_id, a.tenant_id, a.project_id, a.kind, a.status,
            a.detected_mime_type, a.source_byte_size AS byte_size, a.source_sha256 AS sha256,
            r.basis, r.service_processing_consent, r.training_use_consent
          FROM assets a JOIN asset_rights_assertions r
            ON r.tenant_id = a.tenant_id AND r.project_id = a.project_id AND r.asset_id = a.id
          WHERE a.tenant_id = ${command.actor.tenantId}::uuid AND a.project_id = ${command.projectId}::uuid
            AND a.id = ${current.assetId}::uuid LIMIT 1 FOR SHARE OF a, r
        `;
        const source = sourceRows[0];
        if (
          source === undefined ||
          source.status !== "ready" ||
          source.kind !== "plan" ||
          source.sha256 !== current.sourceSha256 ||
          Number(source.byte_size) > c6PlanPolicy.maximumAssetBytes ||
          !source.service_processing_consent ||
          source.training_use_consent !== "denied" ||
          !["application/pdf", "image/svg+xml", "image/png", "image/jpeg"].includes(
            source.detected_mime_type ?? "",
          ) ||
          !["owned-by-user", "permission-granted", "public-domain", "licensed"].includes(
            source.basis,
          )
        ) {
          throw planConflict(
            "PLAN_SOURCE_CHANGED",
            "The pinned source or rights state changed and cannot be retried.",
          );
        }
        const id = this.#uuid.randomUUID();
        const inserted = await transaction<JobRow[]>`
          INSERT INTO plan_processing_jobs (
            tenant_id, project_id, id, root_job_id, retry_of_job_id, asset_id, page_index,
            parser_preference, source_sha256, attempt, state, retryable, created_by,
            created_at, updated_at, version
          ) VALUES (
            ${command.actor.tenantId}::uuid, ${command.projectId}::uuid, ${id}::uuid,
            ${row.root_job_id}::uuid, ${current.id}::uuid, ${current.assetId}::uuid,
            ${current.pageIndex}, ${current.parserPreference}, ${current.sourceSha256},
            ${current.attempt + 1}, 'queued', false, ${command.actor.userId}::uuid,
            ${timestamp}, ${timestamp}, 1
          ) RETURNING *
        `;
        if (inserted[0] === undefined) throw new Error("Plan retry insert returned no row.");
        job = mapJob(inserted[0]);
      }
      await appendEvent(transaction, this.#uuid, {
        action: operation,
        actorUserId: command.actor.userId,
        correlation: command.correlation,
        jobId: job.id,
        metadata: {
          attempt: job.attempt,
          jobId: job.id,
          previousJobId: transition === "retry" ? current.id : undefined,
          state: job.state,
          version: job.version,
        },
        occurredAt: timestamp,
        projectId: command.projectId,
        tenantId: command.actor.tenantId,
      });
      await completeIdempotency(transaction, claim, 200, job);
      return { job, replayed: false };
    });
  }

  async createCalibration(
    command: CreateCalibrationCommand,
  ): Promise<{ readonly calibration: PlanCalibration; readonly replayed: boolean }> {
    return this.#sql.begin(async (transaction) => {
      const claim = mutationClaim(command, "plan.proposal.calibrate", {
        jobId: command.jobId,
        projectId: command.projectId,
        request: command.request,
      });
      const idempotency = await claimIdempotency(transaction, claim);
      if (idempotency.kind === "replay")
        return { calibration: planCalibrationSchema.parse(idempotency.body), replayed: true };
      const resultRows = await transaction<{ readonly result_payload: unknown }[]>`
        SELECT r.result_payload FROM plan_processing_results r
        WHERE r.tenant_id = ${command.actor.tenantId}::uuid AND r.project_id = ${command.projectId}::uuid
          AND r.job_id = ${command.jobId}::uuid AND r.status = 'proposal' LIMIT 1 FOR SHARE
      `;
      const proposal =
        resultRows[0] === undefined
          ? undefined
          : planParserResultSchema.parse(resultRows[0].result_payload);
      if (proposal?.status !== "proposal")
        throw planConflict(
          "PLAN_PROPOSAL_REQUIRED",
          "A current immutable proposal is required for calibration.",
        );
      const id = this.#uuid.randomUUID();
      const timestamp = nextTimestamp(this.#clock);
      const calibration = planCalibrationSchema.parse({
        createdAt: timestamp.toISOString(),
        createdBy: command.actor.userId,
        evidence: command.request.evidence,
        id,
        jobId: command.jobId,
        projectId: command.projectId,
        proposalId: proposal.proposalId,
        residualMillimetres: command.residualMillimetres,
        sourceToModel: command.request.sourceToModel,
      });
      await transaction`
        INSERT INTO plan_calibrations (
          tenant_id, project_id, job_id, proposal_id, id, created_by,
          residual_millimetres, calibration_payload, created_at
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${command.projectId}::uuid, ${command.jobId}::uuid,
          ${proposal.proposalId}::uuid, ${id}::uuid, ${command.actor.userId}::uuid,
          ${command.residualMillimetres}, ${transaction.json(json(calibration))}, ${timestamp}
        )
      `;
      await appendEvent(transaction, this.#uuid, {
        action: "plan.proposal.calibrate",
        actorUserId: command.actor.userId,
        correlation: command.correlation,
        jobId: command.jobId,
        metadata: {
          calibrationId: id,
          jobId: command.jobId,
          proposalId: proposal.proposalId,
          residualMillimetres: command.residualMillimetres,
        },
        occurredAt: timestamp,
        projectId: command.projectId,
        tenantId: command.actor.tenantId,
      });
      await completeIdempotency(transaction, claim, 201, calibration);
      return { calibration, replayed: false };
    });
  }

  async findCalibration(
    tenantId: string,
    projectId: string,
    jobId: string,
    calibrationId: string,
  ): Promise<PlanCalibration | undefined> {
    const rows = await this.#sql<{ readonly calibration_payload: unknown }[]>`
      SELECT calibration_payload FROM plan_calibrations
      WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
        AND job_id = ${jobId}::uuid AND id = ${calibrationId}::uuid LIMIT 1
    `;
    return rows[0] === undefined
      ? undefined
      : planCalibrationSchema.parse(rows[0].calibration_payload);
  }

  async findBranchTarget(
    tenantId: string,
    projectId: string,
    profile: "as-built" | "existing" | "proposed",
    branchId: string,
  ): Promise<BranchTarget | undefined> {
    const rows = await this.#sql<BranchRow[]>`
      SELECT b.id, b.project_id, b.model_id, b.profile, b.name, b.source_snapshot_id,
        b.head_snapshot_id, b.head_snapshot_sha256, b.revision, b.created_by,
        b.created_at, b.updated_at, s.canonical_snapshot
      FROM model_branches b
      JOIN canonical_model_snapshots s
        ON s.tenant_id = b.tenant_id AND s.project_id = b.project_id
       AND s.model_id = b.model_id AND s.profile = b.profile AND s.id = b.head_snapshot_id
       AND s.snapshot_sha256 = b.head_snapshot_sha256
      WHERE b.tenant_id = ${tenantId}::uuid AND b.project_id = ${projectId}::uuid
        AND b.profile = ${profile} AND b.id = ${branchId}::uuid LIMIT 1
    `;
    const row = rows[0];
    return row === undefined
      ? undefined
      : { branch: mapBranch(row), snapshot: row.canonical_snapshot };
  }

  async createOperationDraft(
    command: CreateOperationDraftCommand,
  ): Promise<{ readonly draft: PlanOperationDraft; readonly replayed: boolean }> {
    return this.#sql.begin(async (transaction) => {
      const claim = mutationClaim(command, "plan.proposal.draft", {
        jobId: command.jobId,
        projectId: command.projectId,
        request: command.request,
      });
      const idempotency = await claimIdempotency(transaction, claim);
      if (idempotency.kind === "replay")
        return { draft: planOperationDraftSchema.parse(idempotency.body), replayed: true };
      const resultRows = await transaction<{ readonly result_payload: unknown }[]>`
        SELECT result_payload FROM plan_processing_results
        WHERE tenant_id = ${command.actor.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND job_id = ${command.jobId}::uuid AND status = 'proposal' LIMIT 1 FOR SHARE
      `;
      const proposal =
        resultRows[0] === undefined
          ? undefined
          : planParserResultSchema.parse(resultRows[0].result_payload);
      if (proposal?.status !== "proposal")
        throw planConflict(
          "PLAN_PROPOSAL_REQUIRED",
          "A current immutable proposal is required for a draft.",
        );
      const calibrationRows = await transaction<{ readonly calibration_payload: unknown }[]>`
        SELECT calibration_payload FROM plan_calibrations
        WHERE tenant_id = ${command.actor.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND job_id = ${command.jobId}::uuid AND id = ${command.request.calibrationId}::uuid
        LIMIT 1 FOR SHARE
      `;
      if (calibrationRows[0] === undefined)
        throw planConflict(
          "PLAN_CALIBRATION_REQUIRED",
          "The exact immutable calibration is required.",
        );
      const targetRows = await transaction<
        { readonly head_snapshot_sha256: string; readonly revision: number }[]
      >`
        SELECT revision, head_snapshot_sha256 FROM model_branches
        WHERE tenant_id = ${command.actor.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND profile = ${command.request.target.profile}
          AND id = ${command.request.target.branchId}::uuid
        LIMIT 1 FOR SHARE
      `;
      const target = targetRows[0];
      if (
        target === undefined ||
        target.revision !== command.request.target.expectedRevision ||
        target.head_snapshot_sha256 !== command.request.target.expectedHeadSnapshotSha256
      ) {
        throw planConflict(
          "PLAN_DRAFT_TARGET_STALE",
          "The C5 branch head changed before the immutable draft could be stored.",
        );
      }
      const id = this.#uuid.randomUUID();
      const timestamp = nextTimestamp(this.#clock);
      const counts = { accepted: 0, corrected: 0, excluded: 0, unresolved: 0 };
      for (const decision of command.request.decisions) counts[decision.decision] += 1;
      const draft = planOperationDraftSchema.parse({
        acknowledgedFindingCodes: command.request.acknowledgedFindingCodes,
        calibrationId: command.request.calibrationId,
        createdAt: timestamp.toISOString(),
        createdBy: command.actor.userId,
        decisions: command.request.decisions,
        id,
        jobId: command.jobId,
        metrics: {
          acceptedCount: counts.accepted,
          correctedCount: counts.corrected,
          excludedCount: counts.excluded,
          reviewDurationMilliseconds: command.request.reviewDurationMilliseconds,
          unresolvedCount: counts.unresolved,
        },
        operations: command.request.operations,
        projectId: command.projectId,
        proposalId: proposal.proposalId,
        schemaVersion: c6PlanOperationDraftSchemaVersion,
        target: command.request.target,
      });
      await transaction`
        INSERT INTO plan_operation_drafts (
          tenant_id, project_id, job_id, proposal_id, calibration_id, id, branch_id,
          profile, expected_revision, expected_head_snapshot_sha256, operation_count,
          draft_payload, created_by, created_at
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${command.projectId}::uuid, ${command.jobId}::uuid,
          ${proposal.proposalId}::uuid, ${command.request.calibrationId}::uuid, ${id}::uuid,
          ${command.request.target.branchId}::uuid, ${command.request.target.profile},
          ${command.request.target.expectedRevision}, ${command.request.target.expectedHeadSnapshotSha256},
          ${command.request.operations.length}, ${transaction.json(json(draft))},
          ${command.actor.userId}::uuid, ${timestamp}
        )
      `;
      await appendEvent(transaction, this.#uuid, {
        action: "plan.proposal.draft",
        actorUserId: command.actor.userId,
        correlation: command.correlation,
        jobId: command.jobId,
        metadata: {
          branchId: draft.target.branchId,
          calibrationId: draft.calibrationId,
          draftId: draft.id,
          jobId: command.jobId,
          operationCount: draft.operations.length,
          proposalId: draft.proposalId,
        },
        occurredAt: timestamp,
        projectId: command.projectId,
        tenantId: command.actor.tenantId,
      });
      await completeIdempotency(transaction, claim, 201, draft);
      return { draft, replayed: false };
    });
  }
}
