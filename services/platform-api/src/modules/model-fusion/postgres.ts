import {
  c9FusionPolicy,
  fusionDiscrepancyDecisionSchema,
  fusionJobSchema,
  fusionOperationDraftSchema,
  fusionProposalSchema,
  modelBranchSchema,
  type FusionJob,
  type FusionOperationDraft,
  type FusionProposal,
  type ModelBranch,
  type ModelOperationRequest,
} from "@interior-design/contracts";
import { canonicalizeHomeSnapshot } from "@interior-design/domain-model";
import { createHash, randomUUID } from "node:crypto";
import type { JSONValue, Sql, TransactionSql } from "postgres";

import { ApiError } from "../../errors.js";
import {
  claimIdempotency,
  completeIdempotency,
  type IdempotencyClaim,
} from "../projects/idempotency.js";
import { fusionConflict, fusionInvalid } from "./errors.js";
import type {
  AcknowledgeFusionCancellationCommand,
  AdvanceFusionAttemptCommand,
  ClaimFusionAttemptCommand,
  CreateFusionJobCommand,
  CreateFusionOperationDraftCommand,
  FailFusionAttemptCommand,
  FusionClock,
  FusionDiscrepancyDecision,
  FusionDraftResult,
  FusionRepository,
  FusionReviewResult,
  FusionUuidFactory,
  FusionWorkerStage,
  LeasedFusionAttempt,
  PublishFusionProposalCommand,
  ReviewFusionDiscrepanciesCommand,
  TransitionFusionJobCommand,
  WithdrawFusionSourceCommand,
} from "./types.js";

interface JobRow {
  readonly attempt: number;
  readonly created_at: Date | string;
  readonly created_by: string;
  readonly id: string;
  readonly project_id: string;
  readonly proposal_id: string | null;
  readonly request_payload: unknown;
  readonly request_sha256: string;
  readonly retryable: boolean;
  readonly safe_code: string | null;
  readonly source_manifest_sha256: string;
  readonly state: string;
  readonly tenant_id: string;
  readonly updated_at: Date | string;
  readonly version: number;
}

interface AttemptRow {
  readonly attempt: number;
  readonly fence_version: number;
  readonly job_id: string;
  readonly lease_expires_at: Date | string | null;
  readonly lease_owner: string | null;
  readonly lease_seconds: number | null;
  readonly lease_token: string | null;
  readonly project_id: string;
  readonly stage: string;
  readonly state: string;
  readonly tenant_id: string;
  readonly updated_at: Date | string;
}

interface ProposalRow {
  readonly attempt: number;
  readonly id: string;
  readonly proposal_payload: unknown;
  readonly review_updated_at: Date | string;
  readonly review_version: number;
}

interface DecisionRow {
  readonly choice: string;
  readonly decided_at: Date | string;
  readonly decided_by: string;
  readonly decision_payload: unknown;
  readonly discrepancy_id: string;
  readonly id: string;
  readonly proposal_id: string;
  readonly reason: string;
  readonly version: number;
}

interface BranchRow {
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

const systemClock: FusionClock = { now: () => new Date() };
const systemUuid: FusionUuidFactory = { randomUUID };
const workerPattern = /^[A-Za-z0-9_.:-]{3,100}$/u;
const safeCodePattern = /^[A-Z][A-Z0-9_]{2,79}$/u;

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function json(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function mapJob(row: JobRow): FusionJob {
  return fusionJobSchema.parse({
    attempt: row.attempt,
    createdAt: iso(row.created_at),
    createdBy: row.created_by,
    id: row.id,
    projectId: row.project_id,
    ...(row.proposal_id === null ? {} : { proposalId: row.proposal_id }),
    request: row.request_payload,
    ...(row.safe_code === null ? {} : { safeCode: row.safe_code }),
    state: row.state,
    updatedAt: iso(row.updated_at),
    version: row.version,
  });
}

function mapProposal(row: ProposalRow): FusionProposal {
  const payload = row.proposal_payload as Record<string, unknown>;
  return fusionProposalSchema.parse({ ...payload, version: row.review_version });
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

function nextTimestamp(clock: FusionClock, previous?: Date | string): Date {
  const candidate = clock.now();
  if (previous === undefined) return candidate;
  const minimum = new Date(previous).getTime() + 1;
  return candidate.getTime() >= minimum ? candidate : new Date(minimum);
}

function actorClaim(
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

function versionConflict(job: FusionJob): ApiError {
  return fusionConflict(
    "FUSION_JOB_VERSION_CONFLICT",
    `The fusion job changed and is now version ${String(job.version)}. Reload before retrying.`,
  );
}

function validateWorker(workerId: string): void {
  if (!workerPattern.test(workerId)) {
    throw fusionConflict(
      "FUSION_WORKER_INVALID",
      "The worker identity is outside the safe format.",
    );
  }
}

function workerTraceId(workerId: string, action: string, jobId: string, timestamp: Date): string {
  return createHash("sha256")
    .update(`${workerId}:${action}:${jobId}:${timestamp.toISOString()}`)
    .digest("hex")
    .slice(0, 32);
}

async function appendEvent(
  transaction: TransactionSql,
  uuid: FusionUuidFactory,
  input: {
    readonly action: string;
    readonly actorUserId?: string;
    readonly correlation?: { readonly requestId: string; readonly traceId: string };
    readonly jobId: string;
    readonly metadata: object;
    readonly occurredAt: Date;
    readonly projectId: string;
    readonly tenantId: string;
    readonly workerId?: string;
  },
): Promise<void> {
  const requestId = input.correlation?.requestId ?? `worker:${input.workerId ?? "fusion-system"}`;
  const traceId =
    input.correlation?.traceId ??
    workerTraceId(input.workerId ?? "fusion-system", input.action, input.jobId, input.occurredAt);
  await transaction`
    INSERT INTO fusion_audit_events (
      id, tenant_id, project_id, job_id, action, actor_user_id, worker_id,
      request_id, trace_id, metadata, occurred_at
    ) VALUES (
      ${uuid.randomUUID()}::uuid, ${input.tenantId}::uuid, ${input.projectId}::uuid,
      ${input.jobId}::uuid, ${input.action}, ${input.actorUserId ?? null}::uuid,
      ${input.workerId ?? null}, ${requestId}, ${traceId},
      ${transaction.json(json(input.metadata))}, ${input.occurredAt}
    )
  `;
  await transaction`
    INSERT INTO fusion_outbox (
      id, tenant_id, project_id, job_id, event_type, schema_version, payload, occurred_at
    ) VALUES (
      ${uuid.randomUUID()}::uuid, ${input.tenantId}::uuid, ${input.projectId}::uuid,
      ${input.jobId}::uuid, ${input.action}, 'c9-fusion-job-v1',
      ${transaction.json(json(input.metadata))}, ${input.occurredAt}
    )
  `;
}

async function sourcesStillEligible(
  transaction: TransactionSql,
  tenantId: string,
  projectId: string,
  jobId: string,
): Promise<boolean> {
  const rows = await transaction<
    { readonly invalid_count: number; readonly source_count: number }[]
  >`
    SELECT count(*)::int AS source_count,
      count(*) FILTER (WHERE w.reference_id IS NOT NULL OR NOT c9_source_rights_active(
        s.tenant_id, s.project_id, s.source_kind, s.reference_id
      ))::int AS invalid_count
    FROM fusion_job_sources s
    LEFT JOIN fusion_source_rights_withdrawals w
      ON w.tenant_id = s.tenant_id AND w.project_id = s.project_id
      AND w.source_kind = s.source_kind AND w.reference_id = s.reference_id
    WHERE s.tenant_id = ${tenantId}::uuid AND s.project_id = ${projectId}::uuid
      AND s.job_id = ${jobId}::uuid
  `;
  const counts = rows[0];
  return counts !== undefined && counts.source_count >= 2 && counts.invalid_count === 0;
}

function assertLease(
  row: AttemptRow | undefined,
  command: {
    readonly attempt: number;
    readonly leaseToken: string;
    readonly projectId: string;
    readonly tenantId: string;
    readonly workerId: string;
  },
  now: Date,
): AttemptRow {
  if (
    row === undefined ||
    row.attempt !== command.attempt ||
    row.project_id !== command.projectId ||
    row.state !== "leased" ||
    row.tenant_id !== command.tenantId ||
    row.lease_owner !== command.workerId ||
    row.lease_token !== command.leaseToken ||
    row.lease_expires_at === null ||
    new Date(row.lease_expires_at).getTime() <= now.getTime()
  ) {
    throw fusionConflict(
      "FUSION_LEASE_FENCED",
      "This fusion lease is stale, expired, cancelled, or owned by another worker.",
    );
  }
  return row;
}

export class PostgresModelFusionRepository implements FusionRepository {
  readonly #clock: FusionClock;
  readonly #sql: Sql;
  readonly #uuid: FusionUuidFactory;

  constructor(
    sql: Sql,
    options: { readonly clock?: FusionClock; readonly uuid?: FusionUuidFactory } = {},
  ) {
    this.#sql = sql;
    this.#clock = options.clock ?? systemClock;
    this.#uuid = options.uuid ?? systemUuid;
  }

  async createJob(command: CreateFusionJobCommand) {
    return this.#sql.begin(async (transaction) => {
      const claim = actorClaim(command, "fusion.job.create", {
        projectId: command.projectId,
        request: command.request,
      });
      const idempotency = await claimIdempotency(transaction, claim);
      if (idempotency.kind === "replay") {
        return { job: fusionJobSchema.parse(idempotency.body), replayed: true };
      }
      const timestamp = nextTimestamp(this.#clock);
      const jobId = this.#uuid.randomUUID();
      const rows = await transaction<JobRow[]>`
        INSERT INTO fusion_jobs (
          tenant_id, project_id, id, request_payload, request_sha256,
          source_manifest_sha256, attempt, state, retryable, created_by,
          created_at, updated_at, version
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${command.projectId}::uuid, ${jobId}::uuid,
          ${transaction.json(json(command.request))}, ${command.requestSha256},
          ${command.sourceManifestSha256}, 1, 'queued', false, ${command.actor.userId}::uuid,
          ${timestamp}, ${timestamp}, 1
        ) RETURNING *
      `;
      for (const source of command.request.sources) {
        await transaction`
          INSERT INTO fusion_job_sources (
            tenant_id, project_id, job_id, source_id, source_kind, reference_id,
            schema_version, sha256, element_count, evidence_state, coordinate_frame,
            scale_status, service_processing_consent, training_use_consent, created_at
          ) VALUES (
            ${command.actor.tenantId}::uuid, ${command.projectId}::uuid, ${jobId}::uuid,
            ${source.id}::uuid, ${source.kind}, ${source.referenceId}::uuid,
            ${source.schemaVersion}, ${source.sha256}, ${source.elementCount},
            ${source.evidenceState}, ${source.coordinateFrame}, ${source.scaleStatus}, true,
            'denied', ${timestamp}
          )
        `;
      }
      await transaction`
        INSERT INTO fusion_attempts (
          tenant_id, project_id, job_id, attempt, state, stage, created_at, updated_at
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${command.projectId}::uuid, ${jobId}::uuid,
          1, 'queued', 'registering', ${timestamp}, ${timestamp}
        )
      `;
      const row = rows[0];
      if (row === undefined) throw new Error("Fusion job insert returned no row.");
      const job = mapJob(row);
      await appendEvent(transaction, this.#uuid, {
        action: "fusion.job.create",
        actorUserId: command.actor.userId,
        correlation: command.correlation,
        jobId,
        metadata: {
          attempt: 1,
          baseSnapshotSha256: command.request.baseSnapshot.snapshotSha256,
          sourceCount: command.request.sources.length,
          sourceManifestSha256: command.sourceManifestSha256,
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

  async listJobs(tenantId: string, projectId: string): Promise<readonly FusionJob[]> {
    const rows = await this.#sql<JobRow[]>`
      SELECT * FROM fusion_jobs WHERE tenant_id = ${tenantId}::uuid
        AND project_id = ${projectId}::uuid ORDER BY created_at DESC, id LIMIT 100
    `;
    return rows.map(mapJob);
  }

  async findJob(tenantId: string, projectId: string, fusionJobId: string) {
    const rows = await this.#sql<JobRow[]>`
      SELECT * FROM fusion_jobs WHERE tenant_id = ${tenantId}::uuid
        AND project_id = ${projectId}::uuid AND id = ${fusionJobId}::uuid LIMIT 1
    `;
    return rows[0] === undefined ? undefined : mapJob(rows[0]);
  }

  async findProposal(tenantId: string, projectId: string, fusionJobId: string) {
    const rows = await this.#sql<ProposalRow[]>`
      SELECT p.attempt, p.id, p.proposal_payload, h.updated_at AS review_updated_at,
        h.version AS review_version
      FROM fusion_proposals p JOIN fusion_proposal_review_heads h
        ON h.tenant_id = p.tenant_id AND h.project_id = p.project_id AND h.proposal_id = p.id
      WHERE p.tenant_id = ${tenantId}::uuid AND p.project_id = ${projectId}::uuid
        AND p.job_id = ${fusionJobId}::uuid ORDER BY p.attempt DESC LIMIT 1
    `;
    return rows[0] === undefined ? undefined : mapProposal(rows[0]);
  }

  cancelJob(command: TransitionFusionJobCommand) {
    return this.#transition(command, "cancel");
  }

  retryJob(command: TransitionFusionJobCommand) {
    return this.#transition(command, "retry");
  }

  async #transition(command: TransitionFusionJobCommand, transition: "cancel" | "retry") {
    return this.#sql.begin(async (transaction) => {
      const claim = actorClaim(command, `fusion.job.${transition}`, {
        expectedVersion: command.expectedVersion,
        fusionJobId: command.fusionJobId,
        projectId: command.projectId,
      });
      const idempotency = await claimIdempotency(transaction, claim);
      if (idempotency.kind === "replay") {
        return { job: fusionJobSchema.parse(idempotency.body), replayed: true };
      }
      const rows = await transaction<JobRow[]>`
        SELECT * FROM fusion_jobs WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid AND id = ${command.fusionJobId}::uuid
        LIMIT 1 FOR UPDATE
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
      const timestamp = nextTimestamp(this.#clock, row.updated_at);
      let updatedRows: JobRow[];
      if (transition === "cancel") {
        if (current.state === "queued") {
          await transaction`
            UPDATE fusion_attempts SET state = 'cancelled', updated_at = ${timestamp},
              fence_version = fence_version + 1
            WHERE tenant_id = ${command.actor.tenantId}::uuid AND project_id = ${command.projectId}::uuid
              AND job_id = ${command.fusionJobId}::uuid AND attempt = ${current.attempt}
              AND state = 'queued'
          `;
          updatedRows = await transaction<JobRow[]>`
            UPDATE fusion_jobs SET state = 'cancelled', retryable = true,
              updated_at = ${timestamp}, version = version + 1
            WHERE tenant_id = ${command.actor.tenantId}::uuid AND project_id = ${command.projectId}::uuid
              AND id = ${command.fusionJobId}::uuid RETURNING *
          `;
        } else if (["registering", "fitting", "comparing"].includes(current.state)) {
          await transaction`
            UPDATE fusion_attempts SET state = 'cancel-requested', updated_at = ${timestamp},
              fence_version = fence_version + 1
            WHERE tenant_id = ${command.actor.tenantId}::uuid AND project_id = ${command.projectId}::uuid
              AND job_id = ${command.fusionJobId}::uuid AND attempt = ${current.attempt}
              AND state = 'leased'
          `;
          updatedRows = await transaction<JobRow[]>`
            UPDATE fusion_jobs SET state = 'cancel-requested', retryable = false,
              updated_at = ${timestamp}, version = version + 1
            WHERE tenant_id = ${command.actor.tenantId}::uuid AND project_id = ${command.projectId}::uuid
              AND id = ${command.fusionJobId}::uuid RETURNING *
          `;
        } else if (current.state === "cancel-requested") {
          updatedRows = [row];
        } else {
          throw fusionConflict(
            "FUSION_JOB_NOT_CANCELLABLE",
            "Only queued or active fusion work can be cancelled.",
          );
        }
      } else {
        if (
          !["cancelled", "failed", "abstained"].includes(current.state) ||
          !row.retryable ||
          current.attempt >= c9FusionPolicy.maximumAttempts
        ) {
          throw fusionConflict(
            "FUSION_JOB_NOT_RETRYABLE",
            "This job is not retryable or reached the attempt limit.",
          );
        }
        if (
          !(await sourcesStillEligible(
            transaction,
            command.actor.tenantId,
            command.projectId,
            command.fusionJobId,
          ))
        ) {
          throw fusionConflict(
            "FUSION_SOURCE_RIGHTS_WITHDRAWN",
            "An exact source right changed before retry.",
          );
        }
        const nextAttempt = current.attempt + 1;
        updatedRows = await transaction<JobRow[]>`
          UPDATE fusion_jobs SET attempt = ${nextAttempt}, state = 'queued', proposal_id = NULL,
            safe_code = NULL, retryable = false, updated_at = ${timestamp}, version = version + 1
          WHERE tenant_id = ${command.actor.tenantId}::uuid AND project_id = ${command.projectId}::uuid
            AND id = ${command.fusionJobId}::uuid RETURNING *
        `;
        await transaction`
          INSERT INTO fusion_attempts (
            tenant_id, project_id, job_id, attempt, state, stage, created_at, updated_at
          ) VALUES (
            ${command.actor.tenantId}::uuid, ${command.projectId}::uuid,
            ${command.fusionJobId}::uuid, ${nextAttempt}, 'queued', 'registering',
            ${timestamp}, ${timestamp}
          )
        `;
      }
      const updated = updatedRows[0];
      if (updated === undefined) throw versionConflict(current);
      const job = mapJob(updated);
      await appendEvent(transaction, this.#uuid, {
        action: `fusion.job.${transition}`,
        actorUserId: command.actor.userId,
        correlation: command.correlation,
        jobId: command.fusionJobId,
        metadata: { attempt: job.attempt, state: job.state, version: job.version },
        occurredAt: timestamp,
        projectId: command.projectId,
        tenantId: command.actor.tenantId,
      });
      await completeIdempotency(transaction, claim, 200, job);
      return { job, replayed: false };
    });
  }

  async claimNext(command: ClaimFusionAttemptCommand): Promise<LeasedFusionAttempt | undefined> {
    validateWorker(command.workerId);
    const leaseSeconds = command.leaseSeconds ?? 300;
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 3_600) {
      throw fusionConflict(
        "FUSION_LEASE_INVALID",
        "Lease duration must be 30 through 3600 seconds.",
      );
    }
    const claimAt = this.#clock.now();
    return this.#sql.begin(async (transaction) => {
      const candidates = await transaction<
        (JobRow & {
          readonly attempt_state: string;
          readonly attempt_updated_at: Date | string;
          readonly stage: string;
        })[]
      >`
        SELECT j.*, a.state AS attempt_state, a.stage, a.updated_at AS attempt_updated_at
        FROM fusion_jobs j JOIN fusion_attempts a
          ON a.tenant_id = j.tenant_id AND a.project_id = j.project_id
          AND a.job_id = j.id AND a.attempt = j.attempt
        WHERE (j.state = 'queued' AND a.state = 'queued') OR (
          j.state IN ('registering', 'fitting', 'comparing', 'cancel-requested')
          AND a.state IN ('leased', 'cancel-requested') AND a.lease_expires_at <= ${claimAt}
        ) ORDER BY j.created_at, j.id LIMIT 1 FOR UPDATE OF j, a SKIP LOCKED
      `;
      const candidate = candidates[0];
      if (candidate === undefined) return undefined;
      const timestamp = nextTimestamp(
        this.#clock,
        new Date(candidate.updated_at).getTime() > new Date(candidate.attempt_updated_at).getTime()
          ? candidate.updated_at
          : candidate.attempt_updated_at,
      );
      if (candidate.state === "cancel-requested") {
        await this.#cancelAttempt(transaction, candidate, command.workerId, timestamp);
        return undefined;
      }
      if (
        !(await sourcesStillEligible(
          transaction,
          candidate.tenant_id,
          candidate.project_id,
          candidate.id,
        ))
      ) {
        await this.#failWithoutLease(
          transaction,
          candidate,
          "FUSION_SOURCE_RIGHTS_WITHDRAWN",
          timestamp,
          command.workerId,
        );
        return undefined;
      }
      const leaseToken = this.#uuid.randomUUID();
      const stage = (
        candidate.state === "queued" ? "registering" : candidate.state
      ) as FusionWorkerStage;
      const attempts = await transaction<AttemptRow[]>`
        UPDATE fusion_attempts SET state = 'leased', stage = ${stage}, lease_owner = ${command.workerId},
          lease_token = ${leaseToken}::uuid, lease_expires_at = ${timestamp} + (${leaseSeconds} * interval '1 second'),
          lease_seconds = ${leaseSeconds}, updated_at = ${timestamp}, fence_version = fence_version + 1
        WHERE tenant_id = ${candidate.tenant_id}::uuid AND project_id = ${candidate.project_id}::uuid
          AND job_id = ${candidate.id}::uuid AND attempt = ${candidate.attempt} RETURNING *
      `;
      const jobs = await transaction<JobRow[]>`
        UPDATE fusion_jobs SET state = ${stage}, updated_at = ${timestamp}, version = version + 1
        WHERE tenant_id = ${candidate.tenant_id}::uuid AND project_id = ${candidate.project_id}::uuid
          AND id = ${candidate.id}::uuid RETURNING *
      `;
      const attempt = attempts[0];
      const job = jobs[0];
      if (attempt?.lease_expires_at === null || attempt === undefined || job === undefined) {
        throw new Error("Fusion lease update returned no row.");
      }
      await appendEvent(transaction, this.#uuid, {
        action: "fusion.job.lease",
        jobId: candidate.id,
        metadata: {
          attempt: candidate.attempt,
          reclaimed: candidate.attempt_state === "leased",
          stage,
        },
        occurredAt: timestamp,
        projectId: candidate.project_id,
        tenantId: candidate.tenant_id,
        workerId: command.workerId,
      });
      return {
        attempt: candidate.attempt,
        jobId: candidate.id,
        leaseExpiresAt: iso(attempt.lease_expires_at),
        leaseToken,
        projectId: candidate.project_id,
        request: mapJob(job).request,
        sourceManifestSha256: candidate.source_manifest_sha256,
        stage,
        tenantId: candidate.tenant_id,
      };
    });
  }

  async advanceAttempt(command: AdvanceFusionAttemptCommand): Promise<FusionJob> {
    validateWorker(command.workerId);
    return this.#sql.begin(async (transaction) => {
      const now = this.#clock.now();
      const attempts = await transaction<AttemptRow[]>`
        SELECT * FROM fusion_attempts WHERE tenant_id = ${command.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid AND job_id = ${command.jobId}::uuid
          AND attempt = ${command.attempt} LIMIT 1 FOR UPDATE
      `;
      const attempt = assertLease(attempts[0], command, now);
      const allowed: Readonly<Record<FusionWorkerStage, readonly FusionWorkerStage[]>> = {
        registering: ["registering", "fitting"],
        fitting: ["fitting", "comparing"],
        comparing: ["comparing"],
      };
      const currentStage = attempt.stage as FusionWorkerStage;
      if (!allowed[currentStage].includes(command.stage)) {
        throw fusionConflict(
          "FUSION_STAGE_INVALID",
          "The worker attempted to skip or reverse a stage.",
        );
      }
      const timestamp = nextTimestamp(this.#clock, attempt.updated_at);
      const leaseSeconds = attempt.lease_seconds ?? 300;
      await transaction`
        UPDATE fusion_attempts SET stage = ${command.stage},
          lease_expires_at = ${timestamp} + (${leaseSeconds} * interval '1 second'),
          updated_at = ${timestamp}, fence_version = fence_version + 1
        WHERE tenant_id = ${attempt.tenant_id}::uuid AND project_id = ${attempt.project_id}::uuid
          AND job_id = ${command.jobId}::uuid AND attempt = ${command.attempt}
      `;
      const rows = await transaction<JobRow[]>`
        UPDATE fusion_jobs SET state = ${command.stage}, updated_at = ${timestamp}, version = version + 1
        WHERE tenant_id = ${attempt.tenant_id}::uuid AND project_id = ${attempt.project_id}::uuid
          AND id = ${command.jobId}::uuid AND attempt = ${command.attempt} RETURNING *
      `;
      const row = rows[0];
      if (row === undefined)
        throw fusionConflict("FUSION_LEASE_FENCED", "A newer attempt owns this job.");
      await appendEvent(transaction, this.#uuid, {
        action: "fusion.job.advance",
        jobId: command.jobId,
        metadata: { attempt: command.attempt, stage: command.stage },
        occurredAt: timestamp,
        projectId: attempt.project_id,
        tenantId: attempt.tenant_id,
        workerId: command.workerId,
      });
      return mapJob(row);
    });
  }

  async publishProposal(command: PublishFusionProposalCommand): Promise<FusionJob> {
    validateWorker(command.workerId);
    const proposal = fusionProposalSchema.parse(command.proposal);
    if (proposal.status !== "abstained") {
      const encoded = canonicalizeHomeSnapshot(proposal.candidateSnapshot);
      if (encoded.snapshotSha256 !== proposal.candidateSnapshotSha256) {
        throw fusionInvalid(
          "FUSION_CANDIDATE_HASH_MISMATCH",
          "The candidate snapshot hash is not canonical.",
        );
      }
    }
    return this.#sql.begin(async (transaction) => {
      const now = this.#clock.now();
      const attempts = await transaction<AttemptRow[]>`
        SELECT * FROM fusion_attempts WHERE tenant_id = ${command.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid AND job_id = ${command.jobId}::uuid
          AND attempt = ${command.attempt} LIMIT 1 FOR UPDATE
      `;
      const attempt = assertLease(attempts[0], command, now);
      const jobs = await transaction<JobRow[]>`
        SELECT * FROM fusion_jobs WHERE tenant_id = ${attempt.tenant_id}::uuid
          AND project_id = ${attempt.project_id}::uuid AND id = ${command.jobId}::uuid
        LIMIT 1 FOR UPDATE
      `;
      const currentRow = jobs[0];
      if (currentRow === undefined || currentRow.attempt !== command.attempt) {
        throw fusionConflict("FUSION_LEASE_FENCED", "A newer attempt owns this fusion job.");
      }
      const current = mapJob(currentRow);
      if (
        proposal.projectId !== attempt.project_id ||
        proposal.baseSnapshot.modelId !== current.request.baseSnapshot.modelId ||
        proposal.baseSnapshot.snapshotId !== current.request.baseSnapshot.snapshotId ||
        proposal.baseSnapshot.snapshotSha256 !== current.request.baseSnapshot.snapshotSha256 ||
        proposal.sourceManifestSha256 !== currentRow.source_manifest_sha256 ||
        proposal.registrations.length !== current.request.sources.length ||
        new Set(proposal.registrations.map(({ sourceId }) => sourceId)).size !==
          proposal.registrations.length ||
        current.request.sources.some(
          ({ id }) => !proposal.registrations.some(({ sourceId }) => sourceId === id),
        )
      ) {
        throw fusionInvalid(
          "FUSION_PROPOSAL_SCOPE_MISMATCH",
          "The proposal does not match the leased job, base, or exact source manifest.",
        );
      }
      if (proposal.status !== "abstained" && current.state !== "comparing") {
        throw fusionConflict(
          "FUSION_PROPOSAL_STAGE_INVALID",
          "A geometry proposal can publish only after comparison.",
        );
      }
      const timestamp = nextTimestamp(this.#clock, currentRow.updated_at);
      if (
        !(await sourcesStillEligible(
          transaction,
          attempt.tenant_id,
          attempt.project_id,
          command.jobId,
        ))
      ) {
        await this.#failLeased(
          transaction,
          attempt,
          currentRow,
          "FUSION_SOURCE_RIGHTS_WITHDRAWN",
          false,
          timestamp,
          command.workerId,
        );
        const failed = await transaction<JobRow[]>`
          SELECT * FROM fusion_jobs WHERE tenant_id = ${attempt.tenant_id}::uuid
            AND project_id = ${attempt.project_id}::uuid AND id = ${command.jobId}::uuid LIMIT 1
        `;
        const failedRow = failed[0];
        if (failedRow === undefined) throw new Error("Fusion rights failure returned no row.");
        return mapJob(failedRow);
      }
      const immutable = fusionProposalSchema.parse({ ...proposal, version: 1 });
      await transaction`
        INSERT INTO fusion_proposals (
          tenant_id, project_id, job_id, attempt, id, status, base_profile, base_snapshot_id,
          base_snapshot_sha256, source_manifest_sha256, proposal_payload, created_at
        ) VALUES (
          ${attempt.tenant_id}::uuid, ${attempt.project_id}::uuid, ${command.jobId}::uuid,
          ${command.attempt}, ${immutable.id}::uuid, ${immutable.status}, 'existing',
          ${immutable.baseSnapshot.snapshotId}::uuid, ${immutable.baseSnapshot.snapshotSha256},
          ${immutable.sourceManifestSha256}, ${transaction.json(json(immutable))}, ${immutable.createdAt}
        )
      `;
      await transaction`
        INSERT INTO fusion_proposal_review_heads (
          tenant_id, project_id, proposal_id, version, updated_at
        ) VALUES (
          ${attempt.tenant_id}::uuid, ${attempt.project_id}::uuid, ${immutable.id}::uuid, 1, ${timestamp}
        )
      `;
      await transaction`
        UPDATE fusion_attempts SET state = 'succeeded', lease_owner = NULL, lease_token = NULL,
          lease_expires_at = NULL, lease_seconds = NULL, updated_at = ${timestamp},
          fence_version = fence_version + 1
        WHERE tenant_id = ${attempt.tenant_id}::uuid AND project_id = ${attempt.project_id}::uuid
          AND job_id = ${command.jobId}::uuid AND attempt = ${command.attempt}
      `;
      const terminalState = immutable.status === "abstained" ? "abstained" : "proposed";
      const rows = await transaction<JobRow[]>`
        UPDATE fusion_jobs SET state = ${terminalState},
          proposal_id = ${immutable.status === "abstained" ? null : immutable.id}::uuid,
          safe_code = ${immutable.status === "abstained" ? immutable.safeCode : null},
          retryable = ${immutable.status === "abstained" && command.attempt < c9FusionPolicy.maximumAttempts},
          updated_at = ${timestamp}, version = version + 1
        WHERE tenant_id = ${attempt.tenant_id}::uuid AND project_id = ${attempt.project_id}::uuid
          AND id = ${command.jobId}::uuid AND attempt = ${command.attempt} RETURNING *
      `;
      const row = rows[0];
      if (row === undefined) throw new Error("Fusion publication returned no row.");
      await appendEvent(transaction, this.#uuid, {
        action: "fusion.job.publish",
        jobId: command.jobId,
        metadata: {
          attempt: command.attempt,
          discrepancyCount: immutable.discrepancies.length,
          proposalId: immutable.id,
          registeredSourceCount: immutable.coverage.registeredSourceCount,
          status: immutable.status,
        },
        occurredAt: timestamp,
        projectId: attempt.project_id,
        tenantId: attempt.tenant_id,
        workerId: command.workerId,
      });
      return mapJob(row);
    });
  }

  async failAttempt(command: FailFusionAttemptCommand): Promise<FusionJob> {
    validateWorker(command.workerId);
    if (!safeCodePattern.test(command.safeCode)) {
      throw fusionConflict("FUSION_SAFE_CODE_INVALID", "The worker safe code is invalid.");
    }
    return this.#sql.begin(async (transaction) => {
      const now = this.#clock.now();
      const attempts = await transaction<AttemptRow[]>`
        SELECT * FROM fusion_attempts WHERE tenant_id = ${command.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid AND job_id = ${command.jobId}::uuid
          AND attempt = ${command.attempt} LIMIT 1 FOR UPDATE
      `;
      const attempt = assertLease(attempts[0], command, now);
      const jobs = await transaction<JobRow[]>`
        SELECT * FROM fusion_jobs WHERE tenant_id = ${attempt.tenant_id}::uuid
          AND project_id = ${attempt.project_id}::uuid AND id = ${command.jobId}::uuid
        LIMIT 1 FOR UPDATE
      `;
      const job = jobs[0];
      if (job === undefined || job.attempt !== command.attempt) {
        throw fusionConflict("FUSION_LEASE_FENCED", "A newer attempt owns this fusion job.");
      }
      const timestamp = nextTimestamp(this.#clock, attempt.updated_at);
      await this.#failLeased(
        transaction,
        attempt,
        job,
        command.safeCode,
        command.retryable,
        timestamp,
        command.workerId,
      );
      const rows = await transaction<JobRow[]>`
        SELECT * FROM fusion_jobs WHERE tenant_id = ${attempt.tenant_id}::uuid
          AND project_id = ${attempt.project_id}::uuid AND id = ${command.jobId}::uuid LIMIT 1
      `;
      const row = rows[0];
      if (row === undefined) throw new Error("Fusion failure returned no row.");
      return mapJob(row);
    });
  }

  async acknowledgeCancellation(command: AcknowledgeFusionCancellationCommand): Promise<void> {
    validateWorker(command.workerId);
    await this.#sql.begin(async (transaction) => {
      const now = this.#clock.now();
      const attempts = await transaction<AttemptRow[]>`
        SELECT * FROM fusion_attempts WHERE tenant_id = ${command.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid AND job_id = ${command.jobId}::uuid
          AND attempt = ${command.attempt} LIMIT 1 FOR UPDATE
      `;
      const attempt = attempts[0];
      if (
        attempt === undefined ||
        attempt.state !== "cancel-requested" ||
        attempt.lease_owner !== command.workerId ||
        attempt.lease_token !== command.leaseToken ||
        attempt.lease_expires_at === null ||
        new Date(attempt.lease_expires_at).getTime() <= now.getTime()
      ) {
        throw fusionConflict(
          "FUSION_LEASE_FENCED",
          "Only the current worker can acknowledge cancellation.",
        );
      }
      const timestamp = nextTimestamp(this.#clock, attempt.updated_at);
      const jobs = await transaction<JobRow[]>`
        SELECT * FROM fusion_jobs WHERE tenant_id = ${attempt.tenant_id}::uuid
          AND project_id = ${attempt.project_id}::uuid AND id = ${command.jobId}::uuid LIMIT 1 FOR UPDATE
      `;
      const job = jobs[0];
      if (job === undefined) throw new Error("Fusion cancellation job disappeared.");
      await this.#cancelAttempt(transaction, job, command.workerId, timestamp);
    });
  }

  async reviewDiscrepancies(
    command: ReviewFusionDiscrepanciesCommand,
  ): Promise<FusionReviewResult> {
    return this.#sql.begin(async (transaction) => {
      const claim = actorClaim(command, "fusion.proposal.review", {
        fusionJobId: command.fusionJobId,
        projectId: command.projectId,
        request: command.request,
      });
      const idempotency = await claimIdempotency(transaction, claim);
      if (idempotency.kind === "replay") {
        const replay = idempotency.body as {
          readonly decisions: unknown;
          readonly proposal: unknown;
        };
        return {
          decisions: Array.isArray(replay.decisions)
            ? replay.decisions.map((entry) => fusionDiscrepancyDecisionSchema.parse(entry))
            : [],
          proposal: fusionProposalSchema.parse(replay.proposal),
          replayed: true,
        };
      }
      const proposals = await transaction<ProposalRow[]>`
        SELECT p.attempt, p.id, p.proposal_payload, h.updated_at AS review_updated_at,
          h.version AS review_version
        FROM fusion_jobs j JOIN fusion_proposals p
          ON p.tenant_id = j.tenant_id AND p.project_id = j.project_id AND p.id = j.proposal_id
        JOIN fusion_proposal_review_heads h
          ON h.tenant_id = p.tenant_id AND h.project_id = p.project_id AND h.proposal_id = p.id
        WHERE j.tenant_id = ${command.actor.tenantId}::uuid AND j.project_id = ${command.projectId}::uuid
          AND j.id = ${command.fusionJobId}::uuid AND j.state = 'proposed' LIMIT 1
        FOR UPDATE OF h
      `;
      const proposalRow = proposals[0];
      if (proposalRow === undefined)
        throw fusionConflict(
          "FUSION_PROPOSAL_UNAVAILABLE",
          "Only a published geometry proposal can be reviewed.",
        );
      const proposal = mapProposal(proposalRow);
      if (proposal.version !== command.request.expectedProposalVersion) {
        throw fusionConflict(
          "FUSION_PROPOSAL_VERSION_CONFLICT",
          `The proposal review changed and is now version ${String(proposal.version)}.`,
        );
      }
      const discrepancyById = new Map(proposal.discrepancies.map((item) => [item.id, item]));
      for (const input of command.request.decisions) {
        if (!discrepancyById.has(input.discrepancyId)) {
          throw fusionInvalid(
            "FUSION_DISCREPANCY_MISMATCH",
            "A decision references a discrepancy outside this proposal.",
          );
        }
      }
      const timestamp = nextTimestamp(this.#clock, proposalRow.review_updated_at);
      const nextVersion = proposal.version + 1;
      const decisions: FusionDiscrepancyDecision[] = [];
      for (const input of command.request.decisions) {
        const id = this.#uuid.randomUUID();
        const decision = fusionDiscrepancyDecisionSchema.parse({
          choice: input.choice,
          decidedAt: timestamp.toISOString(),
          decidedBy: command.actor.userId,
          discrepancyId: input.discrepancyId,
          id,
          proposalId: proposal.id,
          reason: input.reason,
          version: nextVersion,
        });
        const rows = await transaction<DecisionRow[]>`
          INSERT INTO fusion_discrepancy_decisions (
            tenant_id, project_id, proposal_id, id, discrepancy_id, choice, reason,
            decision_payload, decided_by, decided_at, version
          ) VALUES (
            ${command.actor.tenantId}::uuid, ${command.projectId}::uuid, ${proposal.id}::uuid,
            ${id}::uuid, ${input.discrepancyId}::uuid, ${input.choice}, ${input.reason},
            ${transaction.json(json(input))}, ${command.actor.userId}::uuid, ${timestamp}, ${nextVersion}
          ) RETURNING *
        `;
        const row = rows[0];
        if (row === undefined) throw new Error("Fusion decision insert returned no row.");
        decisions.push(decision);
      }
      await transaction`
        UPDATE fusion_proposal_review_heads SET version = ${nextVersion}, updated_at = ${timestamp}
        WHERE tenant_id = ${command.actor.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND proposal_id = ${proposal.id}::uuid AND version = ${proposal.version}
      `;
      const updatedProposal = fusionProposalSchema.parse({ ...proposal, version: nextVersion });
      const response = { decisions, proposal: updatedProposal };
      await appendEvent(transaction, this.#uuid, {
        action: "fusion.proposal.review",
        actorUserId: command.actor.userId,
        correlation: command.correlation,
        jobId: command.fusionJobId,
        metadata: {
          choiceCounts: command.request.decisions.reduce<Record<string, number>>((counts, item) => {
            counts[item.choice] = (counts[item.choice] ?? 0) + 1;
            return counts;
          }, {}),
          decisionCount: decisions.length,
          proposalId: proposal.id,
          proposalVersion: nextVersion,
        },
        occurredAt: timestamp,
        projectId: command.projectId,
        tenantId: command.actor.tenantId,
      });
      await completeIdempotency(transaction, claim, 200, response);
      return { ...response, replayed: false };
    });
  }

  async createOperationDraft(
    command: CreateFusionOperationDraftCommand,
  ): Promise<FusionDraftResult> {
    return this.#sql.begin(async (transaction) => {
      const claim = actorClaim(command, "fusion.proposal.draft", {
        fusionJobId: command.fusionJobId,
        projectId: command.projectId,
        request: command.request,
      });
      const idempotency = await claimIdempotency(transaction, claim);
      if (idempotency.kind === "replay") {
        return { draft: fusionOperationDraftSchema.parse(idempotency.body), replayed: true };
      }
      const proposals = await transaction<ProposalRow[]>`
        SELECT p.attempt, p.id, p.proposal_payload, h.updated_at AS review_updated_at,
          h.version AS review_version
        FROM fusion_jobs j JOIN fusion_proposals p
          ON p.tenant_id = j.tenant_id AND p.project_id = j.project_id AND p.id = j.proposal_id
        JOIN fusion_proposal_review_heads h
          ON h.tenant_id = p.tenant_id AND h.project_id = p.project_id AND h.proposal_id = p.id
        WHERE j.tenant_id = ${command.actor.tenantId}::uuid AND j.project_id = ${command.projectId}::uuid
          AND j.id = ${command.fusionJobId}::uuid AND j.state = 'proposed' LIMIT 1 FOR SHARE OF p, h
      `;
      const proposalRow = proposals[0];
      if (proposalRow === undefined)
        throw fusionConflict(
          "FUSION_PROPOSAL_UNAVAILABLE",
          "Only a published proposal can emit an operation draft.",
        );
      const proposal = mapProposal(proposalRow);
      if (proposal.version !== command.request.expectedProposalVersion) {
        throw fusionConflict(
          "FUSION_PROPOSAL_VERSION_CONFLICT",
          `The proposal review changed and is now version ${String(proposal.version)}.`,
        );
      }
      const branches = await transaction<BranchRow[]>`
        SELECT created_at, created_by, head_snapshot_id, head_snapshot_sha256, id, model_id,
          name, profile, project_id, revision, source_snapshot_id, updated_at
        FROM model_branches WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid AND model_id = ${proposal.baseSnapshot.modelId}::uuid
          AND profile = 'existing' AND id = ${command.request.branchId}::uuid LIMIT 1 FOR SHARE
      `;
      const branch = branches[0] === undefined ? undefined : mapBranch(branches[0]);
      if (
        branch === undefined ||
        branch.revision !== command.request.expectedBranchRevision ||
        branch.headSnapshotSha256 !== command.request.expectedHeadSnapshotSha256
      ) {
        throw fusionConflict(
          "FUSION_BRANCH_HEAD_CONFLICT",
          "The exact existing branch revision or head hash changed.",
        );
      }
      const decisionIds = command.request.decisionIds;
      const decisions = await transaction<DecisionRow[]>`
        SELECT d.* FROM fusion_discrepancy_decisions d
        WHERE d.tenant_id = ${command.actor.tenantId}::uuid AND d.project_id = ${command.projectId}::uuid
          AND d.proposal_id = ${proposal.id}::uuid AND d.id = ANY(${transaction.array(decisionIds)}::uuid[])
      `;
      if (decisions.length !== decisionIds.length) {
        throw fusionInvalid(
          "FUSION_DECISION_MISMATCH",
          "Every draft decision must belong to this exact proposal.",
        );
      }
      const latest = await transaction<{ readonly discrepancy_id: string; readonly id: string }[]>`
        SELECT DISTINCT ON (discrepancy_id) discrepancy_id, id
        FROM fusion_discrepancy_decisions
        WHERE tenant_id = ${command.actor.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND proposal_id = ${proposal.id}::uuid ORDER BY discrepancy_id, version DESC, decided_at DESC, id DESC
      `;
      const latestIds = new Map(latest.map((row) => [row.discrepancy_id, row.id]));
      if (decisions.some((row) => latestIds.get(row.discrepancy_id) !== row.id)) {
        throw fusionConflict(
          "FUSION_DECISION_STALE",
          "A selected discrepancy decision has been superseded.",
        );
      }
      const discrepancyById = new Map(proposal.discrepancies.map((item) => [item.id, item]));
      const operations: ModelOperationRequest[] = [];
      for (const row of decisions.sort(
        (left, right) => decisionIds.indexOf(left.id) - decisionIds.indexOf(right.id),
      )) {
        const discrepancy = discrepancyById.get(row.discrepancy_id);
        if (discrepancy === undefined)
          throw fusionInvalid(
            "FUSION_DISCREPANCY_MISMATCH",
            "A decided discrepancy is absent from the immutable proposal.",
          );
        const payload = row.decision_payload as {
          readonly correctedOperations?: readonly ModelOperationRequest[];
        };
        if (row.choice === "accept-candidate") operations.push(...discrepancy.suggestedOperations);
        if (row.choice === "correct") operations.push(...(payload.correctedOperations ?? []));
        if (row.choice === "mark-unknown") {
          operations.push(...discrepancy.suggestedOperations.filter(isUnknownProvenanceCorrection));
        }
      }
      if (operations.length === 0) {
        throw fusionInvalid(
          "FUSION_DRAFT_EMPTY",
          "These decisions do not produce any exact typed C5 operations.",
        );
      }
      if (operations.length > c9FusionPolicy.maximumOperationDraftSize) {
        throw fusionInvalid(
          "FUSION_DRAFT_TOO_LARGE",
          "The exact operation draft exceeds the 50-operation limit.",
        );
      }
      const operationIds = operations.map(({ clientOperationId }) => clientOperationId);
      if (new Set(operationIds).size !== operationIds.length) {
        throw fusionInvalid(
          "FUSION_DRAFT_DUPLICATE_OPERATION",
          "The exact operation draft contains duplicate client operation IDs.",
        );
      }
      const draft: FusionOperationDraft = fusionOperationDraftSchema.parse({
        baseSnapshot: proposal.baseSnapshot,
        branchId: branch.id,
        decisionIds,
        expectedBranchRevision: branch.revision,
        expectedHeadSnapshotSha256: branch.headSnapshotSha256,
        operations,
        projectId: command.projectId,
        proposalId: proposal.id,
        schemaVersion: "c9-operation-draft-v1",
      });
      const timestamp = nextTimestamp(this.#clock);
      await transaction`
        INSERT INTO fusion_operation_drafts (
          tenant_id, project_id, proposal_id, id, branch_id, expected_branch_revision,
          expected_head_snapshot_sha256, decision_ids, operation_count, draft_payload,
          created_by, created_at
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${command.projectId}::uuid, ${proposal.id}::uuid,
          ${this.#uuid.randomUUID()}::uuid, ${branch.id}::uuid, ${branch.revision},
          ${branch.headSnapshotSha256}, ${transaction.array(decisionIds)}::uuid[], ${operations.length},
          ${transaction.json(json(draft))}, ${command.actor.userId}::uuid, ${timestamp}
        )
      `;
      await appendEvent(transaction, this.#uuid, {
        action: "fusion.proposal.draft",
        actorUserId: command.actor.userId,
        correlation: command.correlation,
        jobId: command.fusionJobId,
        metadata: {
          branchId: branch.id,
          decisionCount: decisionIds.length,
          expectedBranchRevision: branch.revision,
          expectedHeadSnapshotSha256: branch.headSnapshotSha256,
          operationCount: operations.length,
          proposalId: proposal.id,
        },
        occurredAt: timestamp,
        projectId: command.projectId,
        tenantId: command.actor.tenantId,
      });
      await completeIdempotency(transaction, claim, 201, draft);
      return { draft, replayed: false };
    });
  }

  async findBranch(tenantId: string, projectId: string, branchId: string) {
    const rows = await this.#sql<BranchRow[]>`
      SELECT created_at, created_by, head_snapshot_id, head_snapshot_sha256, id, model_id,
        name, profile, project_id, revision, source_snapshot_id, updated_at
      FROM model_branches WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
        AND profile = 'existing' AND id = ${branchId}::uuid LIMIT 1
    `;
    return rows[0] === undefined ? undefined : mapBranch(rows[0]);
  }

  async withdrawSource(command: WithdrawFusionSourceCommand): Promise<number> {
    return this.#sql.begin(async (transaction) => {
      const timestamp = nextTimestamp(this.#clock);
      const inserted = await transaction<{ readonly reference_id: string }[]>`
        INSERT INTO fusion_source_rights_withdrawals (
          tenant_id, project_id, source_kind, reference_id, reason_code, withdrawn_at
        ) VALUES (
          ${command.tenantId}::uuid, ${command.projectId}::uuid, ${command.kind},
          ${command.referenceId}::uuid, ${command.reasonCode}, ${timestamp}
        ) ON CONFLICT DO NOTHING RETURNING reference_id
      `;
      if (inserted.length === 0) return 0;
      const jobs = await transaction<JobRow[]>`
        SELECT j.* FROM fusion_jobs j JOIN fusion_job_sources s
          ON s.tenant_id = j.tenant_id AND s.project_id = j.project_id AND s.job_id = j.id
        WHERE s.tenant_id = ${command.tenantId}::uuid AND s.project_id = ${command.projectId}::uuid
          AND s.source_kind = ${command.kind} AND s.reference_id = ${command.referenceId}::uuid
          AND j.state IN ('queued', 'registering', 'fitting', 'comparing') FOR UPDATE OF j
      `;
      for (const job of jobs) {
        if (job.state === "queued") {
          await this.#failWithoutLease(
            transaction,
            job,
            "FUSION_SOURCE_RIGHTS_WITHDRAWN",
            timestamp,
            "rights-system",
          );
        } else {
          await transaction`
            UPDATE fusion_attempts SET state = 'cancel-requested', updated_at = ${timestamp},
              fence_version = fence_version + 1
            WHERE tenant_id = ${job.tenant_id}::uuid AND project_id = ${job.project_id}::uuid
              AND job_id = ${job.id}::uuid AND attempt = ${job.attempt} AND state = 'leased'
          `;
          await transaction`
            UPDATE fusion_jobs SET state = 'cancel-requested', retryable = false,
              updated_at = ${timestamp}, version = version + 1
            WHERE tenant_id = ${job.tenant_id}::uuid AND project_id = ${job.project_id}::uuid
              AND id = ${job.id}::uuid
          `;
        }
        await appendEvent(transaction, this.#uuid, {
          action: "fusion.source.rights-withdrawn",
          jobId: job.id,
          metadata: {
            attempt: job.attempt,
            reasonCode: command.reasonCode,
            sourceKind: command.kind,
          },
          occurredAt: timestamp,
          projectId: job.project_id,
          tenantId: job.tenant_id,
          workerId: "rights-system",
        });
      }
      return jobs.length;
    });
  }

  async #cancelAttempt(
    transaction: TransactionSql,
    job: JobRow,
    workerId: string,
    timestamp: Date,
  ): Promise<void> {
    await transaction`
      UPDATE fusion_attempts SET state = 'cancelled', lease_owner = NULL, lease_token = NULL,
        lease_expires_at = NULL, lease_seconds = NULL, updated_at = ${timestamp},
        fence_version = fence_version + 1
      WHERE tenant_id = ${job.tenant_id}::uuid AND project_id = ${job.project_id}::uuid
        AND job_id = ${job.id}::uuid AND attempt = ${job.attempt}
    `;
    await transaction`
      UPDATE fusion_jobs SET state = 'cancelled', retryable = true,
        updated_at = ${timestamp}, version = version + 1
      WHERE tenant_id = ${job.tenant_id}::uuid AND project_id = ${job.project_id}::uuid
        AND id = ${job.id}::uuid
    `;
    await appendEvent(transaction, this.#uuid, {
      action: "fusion.job.cancelled",
      jobId: job.id,
      metadata: { attempt: job.attempt, state: "cancelled" },
      occurredAt: timestamp,
      projectId: job.project_id,
      tenantId: job.tenant_id,
      workerId,
    });
  }

  async #failWithoutLease(
    transaction: TransactionSql,
    job: JobRow,
    safeCode: string,
    timestamp: Date,
    workerId: string,
  ): Promise<void> {
    await transaction`
      UPDATE fusion_attempts SET state = 'failed', updated_at = ${timestamp},
        fence_version = fence_version + 1
      WHERE tenant_id = ${job.tenant_id}::uuid AND project_id = ${job.project_id}::uuid
        AND job_id = ${job.id}::uuid AND attempt = ${job.attempt}
    `;
    await transaction`
      UPDATE fusion_jobs SET state = 'failed', retryable = false, safe_code = ${safeCode},
        updated_at = ${timestamp}, version = version + 1
      WHERE tenant_id = ${job.tenant_id}::uuid AND project_id = ${job.project_id}::uuid
        AND id = ${job.id}::uuid
    `;
    await appendEvent(transaction, this.#uuid, {
      action: "fusion.job.fail",
      jobId: job.id,
      metadata: { attempt: job.attempt, retryable: false, safeCode },
      occurredAt: timestamp,
      projectId: job.project_id,
      tenantId: job.tenant_id,
      workerId,
    });
  }

  async #failLeased(
    transaction: TransactionSql,
    attempt: AttemptRow,
    job: JobRow,
    safeCode: string,
    requestedRetryable: boolean,
    timestamp: Date,
    workerId: string,
  ): Promise<void> {
    const retryable = requestedRetryable && attempt.attempt < c9FusionPolicy.maximumAttempts;
    await transaction`
      UPDATE fusion_attempts SET state = 'failed', lease_owner = NULL, lease_token = NULL,
        lease_expires_at = NULL, lease_seconds = NULL, updated_at = ${timestamp},
        fence_version = fence_version + 1
      WHERE tenant_id = ${attempt.tenant_id}::uuid AND project_id = ${attempt.project_id}::uuid
        AND job_id = ${job.id}::uuid AND attempt = ${attempt.attempt}
    `;
    await transaction`
      UPDATE fusion_jobs SET state = 'failed', retryable = ${retryable}, safe_code = ${safeCode},
        updated_at = ${timestamp}, version = version + 1
      WHERE tenant_id = ${attempt.tenant_id}::uuid AND project_id = ${attempt.project_id}::uuid
        AND id = ${job.id}::uuid AND attempt = ${attempt.attempt}
    `;
    await appendEvent(transaction, this.#uuid, {
      action: "fusion.job.fail",
      jobId: job.id,
      metadata: { attempt: attempt.attempt, retryable, safeCode },
      occurredAt: timestamp,
      projectId: attempt.project_id,
      tenantId: attempt.tenant_id,
      workerId,
    });
  }
}

function isUnknownProvenanceCorrection(operation: ModelOperationRequest): boolean {
  return (
    operation.type === "element.provenance.correct.v1" && operation.attribution.state === "unknown"
  );
}
