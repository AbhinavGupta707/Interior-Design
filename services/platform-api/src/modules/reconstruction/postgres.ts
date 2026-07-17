import {
  c8ReconstructionJobSchemaVersion,
  c8ReconstructionPolicy,
  reconstructionJobSchema,
  reconstructionResultSchema,
  type ReconstructionJob,
} from "@interior-design/contracts";
import { createHash, randomUUID } from "node:crypto";
import type { JSONValue, Sql, TransactionSql } from "postgres";

import { ApiError } from "../../errors.js";
import {
  claimIdempotency,
  completeIdempotency,
  type IdempotencyClaim,
} from "../projects/idempotency.js";
import { reconstructionConflict } from "./errors.js";
import type {
  AcknowledgeReconstructionCancellationCommand,
  AdvanceReconstructionAttemptCommand,
  ClaimReconstructionAttemptCommand,
  CreateReconstructionJobCommand,
  EligibleReconstructionSource,
  FailReconstructionAttemptCommand,
  LeasedReconstructionAttempt,
  PublishReconstructionResultCommand,
  ReconstructionClock,
  ReconstructionRepository,
  ReconstructionUuidFactory,
  ReconstructionWorkerStage,
  TransitionReconstructionJobCommand,
  WithdrawReconstructionSourceCommand,
} from "./types.js";

interface JobRow {
  readonly attempt: number;
  readonly created_at: Date | string;
  readonly id: string;
  readonly project_id: string;
  readonly request_payload: unknown;
  readonly request_sha256: string;
  readonly result_id: string | null;
  readonly retryable: boolean;
  readonly safe_code: string | null;
  readonly source_manifest_sha256: string;
  readonly state: string;
  readonly tenant_id: string;
  readonly updated_at: Date | string;
  readonly version: number;
}

interface SourceRow {
  readonly asset_id: string;
  readonly basis: string;
  readonly byte_size: number | string;
  readonly detected_mime_type: string | null;
  readonly project_id: string;
  readonly service_processing_consent: boolean;
  readonly sha256: string;
  readonly status: string;
  readonly tenant_id: string;
  readonly training_use_consent: string;
  readonly withdrawn: boolean;
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

type WorkerAction =
  | "reconstruction.job.advance"
  | "reconstruction.job.cancelled"
  | "reconstruction.job.fail"
  | "reconstruction.job.lease"
  | "reconstruction.job.publish"
  | "reconstruction.source.rights-withdrawn";

const systemClock: ReconstructionClock = { now: () => new Date() };
const systemUuid: ReconstructionUuidFactory = { randomUUID };
const workerPattern = /^[A-Za-z0-9_.:-]{3,100}$/u;
const safeCodePattern = /^[A-Z][A-Z0-9_]{2,79}$/u;

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function json(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function mapJob(row: JobRow): ReconstructionJob {
  return reconstructionJobSchema.parse({
    attempt: row.attempt,
    createdAt: iso(row.created_at),
    id: row.id,
    projectId: row.project_id,
    request: row.request_payload,
    resultId: row.result_id ?? undefined,
    retryable: row.retryable,
    safeCode: row.safe_code ?? undefined,
    schemaVersion: c8ReconstructionJobSchemaVersion,
    state: row.state,
    updatedAt: iso(row.updated_at),
    version: row.version,
  });
}

function mapSource(row: SourceRow): EligibleReconstructionSource {
  return {
    assetId: row.asset_id,
    byteSize: Number(row.byte_size),
    ...(row.detected_mime_type === null ? {} : { detectedMimeType: row.detected_mime_type }),
    projectId: row.project_id,
    rights: {
      basis: row.basis,
      serviceProcessingConsent: row.service_processing_consent,
      trainingUseConsent: row.training_use_consent,
    },
    sha256: row.sha256,
    status: row.status,
    tenantId: row.tenant_id,
    withdrawn: row.withdrawn,
  };
}

function nextTimestamp(clock: ReconstructionClock, previous?: Date | string): Date {
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

function versionConflict(job: ReconstructionJob): ApiError {
  return new ApiError({
    code: "RECONSTRUCTION_JOB_VERSION_CONFLICT",
    detail: `The reconstruction job changed and is now version ${String(job.version)}. Reload before trying again.`,
    statusCode: 409,
    title: "Reconstruction Job Version Conflict",
  });
}

function validateWorker(workerId: string): void {
  if (!workerPattern.test(workerId)) {
    throw reconstructionConflict(
      "RECONSTRUCTION_WORKER_INVALID",
      "The worker identity is outside the fixed safe format.",
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
  uuid: ReconstructionUuidFactory,
  input: {
    readonly action:
      | "reconstruction.job.cancel"
      | "reconstruction.job.create"
      | "reconstruction.job.retry"
      | WorkerAction;
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
  const requestId =
    input.correlation?.requestId ?? `worker:${input.workerId ?? "reconstruction-system"}`;
  const traceId =
    input.correlation?.traceId ??
    workerTraceId(
      input.workerId ?? "reconstruction-system",
      input.action,
      input.jobId,
      input.occurredAt,
    );
  await transaction`
    INSERT INTO reconstruction_audit_events (
      id, tenant_id, project_id, job_id, action, actor_user_id, worker_id,
      request_id, trace_id, metadata, occurred_at
    ) VALUES (
      ${uuid.randomUUID()}::uuid, ${input.tenantId}::uuid, ${input.projectId}::uuid,
      ${input.jobId}::uuid, ${input.action},
      ${input.actorUserId ?? null}::uuid, ${input.workerId ?? null},
      ${requestId}, ${traceId}, ${transaction.json(json(input.metadata))}, ${input.occurredAt}
    )
  `;
  await transaction`
    INSERT INTO reconstruction_outbox (
      id, tenant_id, project_id, job_id, event_type, schema_version, payload, occurred_at
    ) VALUES (
      ${uuid.randomUUID()}::uuid, ${input.tenantId}::uuid, ${input.projectId}::uuid,
      ${input.jobId}::uuid, ${input.action}, ${c8ReconstructionJobSchemaVersion},
      ${transaction.json(json(input.metadata))}, ${input.occurredAt}
    )
  `;
}

function sourceMatchesRequest(
  source: EligibleReconstructionSource,
  requested: CreateReconstructionJobCommand["request"]["sources"][number],
  rights: CreateReconstructionJobCommand["request"]["rights"],
): boolean {
  return (
    !source.withdrawn &&
    source.status === "ready" &&
    source.assetId === requested.assetId &&
    source.byteSize === requested.byteSize &&
    source.detectedMimeType === requested.detectedMimeType &&
    source.sha256 === requested.sha256 &&
    source.rights.basis === rights.basis &&
    source.rights.serviceProcessingConsent &&
    source.rights.trainingUseConsent === "denied"
  );
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
    SELECT
      count(*)::int AS source_count,
      count(*) FILTER (WHERE
        a.status <> 'ready'
        OR a.detected_mime_type IS DISTINCT FROM s.detected_mime_type
        OR a.source_byte_size IS DISTINCT FROM s.byte_size
        OR a.source_sha256 IS DISTINCT FROM s.sha256
        OR r.basis IS DISTINCT FROM s.rights_basis
        OR NOT r.service_processing_consent
        OR r.training_use_consent <> 'denied'
        OR w.asset_id IS NOT NULL
      )::int AS invalid_count
    FROM reconstruction_job_sources s
    JOIN assets a ON a.tenant_id = s.tenant_id AND a.project_id = s.project_id AND a.id = s.asset_id
    JOIN asset_rights_assertions r
      ON r.tenant_id = s.tenant_id AND r.project_id = s.project_id AND r.asset_id = s.asset_id
    LEFT JOIN reconstruction_rights_withdrawals w
      ON w.tenant_id = s.tenant_id AND w.project_id = s.project_id AND w.asset_id = s.asset_id
    WHERE s.tenant_id = ${tenantId}::uuid AND s.project_id = ${projectId}::uuid
      AND s.job_id = ${jobId}::uuid
  `;
  const counts = rows[0];
  return counts !== undefined && counts.source_count > 0 && counts.invalid_count === 0;
}

function assertLease(
  row: AttemptRow | undefined,
  command: {
    readonly attempt: number;
    readonly leaseToken: string;
    readonly workerId: string;
  },
  now: Date,
): AttemptRow {
  if (
    row === undefined ||
    row.attempt !== command.attempt ||
    row.state !== "leased" ||
    row.lease_owner !== command.workerId ||
    row.lease_token !== command.leaseToken ||
    row.lease_expires_at === null ||
    new Date(row.lease_expires_at).getTime() <= now.getTime()
  ) {
    throw reconstructionConflict(
      "RECONSTRUCTION_LEASE_FENCED",
      "This reconstruction lease is stale, expired, cancelled, or owned by another worker.",
    );
  }
  return row;
}

export class PostgresReconstructionRepository implements ReconstructionRepository {
  readonly #clock: ReconstructionClock;
  readonly #sql: Sql;
  readonly #uuid: ReconstructionUuidFactory;

  constructor(
    sql: Sql,
    options: {
      readonly clock?: ReconstructionClock;
      readonly uuid?: ReconstructionUuidFactory;
    } = {},
  ) {
    this.#sql = sql;
    this.#clock = options.clock ?? systemClock;
    this.#uuid = options.uuid ?? systemUuid;
  }

  async findSource(
    tenantId: string,
    projectId: string,
    assetId: string,
  ): Promise<EligibleReconstructionSource | undefined> {
    const rows = await this.#sql<SourceRow[]>`
      SELECT a.id AS asset_id, a.tenant_id, a.project_id, a.status,
        a.detected_mime_type, a.source_byte_size AS byte_size, a.source_sha256 AS sha256,
        r.basis, r.service_processing_consent, r.training_use_consent,
        (w.asset_id IS NOT NULL) AS withdrawn
      FROM assets a
      JOIN asset_rights_assertions r
        ON r.tenant_id = a.tenant_id AND r.project_id = a.project_id AND r.asset_id = a.id
      LEFT JOIN reconstruction_rights_withdrawals w
        ON w.tenant_id = a.tenant_id AND w.project_id = a.project_id AND w.asset_id = a.id
      WHERE a.tenant_id = ${tenantId}::uuid AND a.project_id = ${projectId}::uuid
        AND a.id = ${assetId}::uuid
      LIMIT 1
    `;
    return rows[0] === undefined ? undefined : mapSource(rows[0]);
  }

  async createJob(
    command: CreateReconstructionJobCommand,
  ): Promise<{ readonly job: ReconstructionJob; readonly replayed: boolean }> {
    return this.#sql.begin(async (transaction) => {
      const claim = actorClaim(command, "reconstruction.job.create", {
        projectId: command.projectId,
        request: command.request,
      });
      const idempotency = await claimIdempotency(transaction, claim);
      if (idempotency.kind === "replay") {
        return { job: reconstructionJobSchema.parse(idempotency.body), replayed: true };
      }

      const assetIds = command.request.sources.map(({ assetId }) => assetId);
      const sourceRows = await transaction<SourceRow[]>`
        SELECT a.id AS asset_id, a.tenant_id, a.project_id, a.status,
          a.detected_mime_type, a.source_byte_size AS byte_size, a.source_sha256 AS sha256,
          r.basis, r.service_processing_consent, r.training_use_consent,
          (w.asset_id IS NOT NULL) AS withdrawn
        FROM assets a
        JOIN asset_rights_assertions r
          ON r.tenant_id = a.tenant_id AND r.project_id = a.project_id AND r.asset_id = a.id
        LEFT JOIN reconstruction_rights_withdrawals w
          ON w.tenant_id = a.tenant_id AND w.project_id = a.project_id AND w.asset_id = a.id
        WHERE a.tenant_id = ${command.actor.tenantId}::uuid
          AND a.project_id = ${command.projectId}::uuid
          AND a.id = ANY(${transaction.array(assetIds)}::uuid[])
        FOR SHARE OF a, r
      `;
      const byId = new Map(sourceRows.map((row) => [row.asset_id, mapSource(row)]));
      if (
        sourceRows.length !== command.request.sources.length ||
        command.request.sources.some((requested) => {
          const source = byId.get(requested.assetId);
          return (
            source === undefined || !sourceMatchesRequest(source, requested, command.request.rights)
          );
        })
      ) {
        throw reconstructionConflict(
          "RECONSTRUCTION_SOURCE_CHANGED",
          "An exact source fingerprint, readiness state, or processing right changed before creation.",
        );
      }

      const jobId = this.#uuid.randomUUID();
      const timestamp = nextTimestamp(this.#clock);
      const rows = await transaction<JobRow[]>`
        INSERT INTO reconstruction_jobs (
          tenant_id, project_id, id, request_payload, request_sha256,
          source_manifest_sha256, attempt, state, retryable, created_by,
          created_at, updated_at, version
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${command.projectId}::uuid, ${jobId}::uuid,
          ${transaction.json(json(command.request))}, ${command.requestSha256},
          ${command.sourceManifestSha256}, 1, 'created', false,
          ${command.actor.userId}::uuid, ${timestamp}, ${timestamp}, 1
        ) RETURNING *
      `;
      for (const source of command.request.sources) {
        await transaction`
          INSERT INTO reconstruction_job_sources (
            tenant_id, project_id, job_id, asset_id, source_kind, detected_mime_type,
            byte_size, sha256, rights_basis, service_processing_consent,
            training_use_consent, created_at
          ) VALUES (
            ${command.actor.tenantId}::uuid, ${command.projectId}::uuid, ${jobId}::uuid,
            ${source.assetId}::uuid, ${source.kind}, ${source.detectedMimeType},
            ${source.byteSize}, ${source.sha256}, ${command.request.rights.basis}, true,
            'denied', ${timestamp}
          )
        `;
      }
      await transaction`
        INSERT INTO reconstruction_attempts (
          tenant_id, project_id, job_id, attempt, state, stage, created_at, updated_at
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${command.projectId}::uuid, ${jobId}::uuid,
          1, 'queued', 'preparing', ${timestamp}, ${timestamp}
        )
      `;
      const row = rows[0];
      if (row === undefined) throw new Error("Reconstruction job insert returned no row.");
      const job = mapJob(row);
      await appendEvent(transaction, this.#uuid, {
        action: "reconstruction.job.create",
        actorUserId: command.actor.userId,
        correlation: command.correlation,
        jobId,
        metadata: {
          appearanceMode: job.request.appearanceMode,
          attempt: 1,
          mode: job.request.mode,
          sourceCount: job.request.sources.length,
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

  async listJobs(tenantId: string, projectId: string): Promise<readonly ReconstructionJob[]> {
    const rows = await this.#sql<JobRow[]>`
      SELECT * FROM reconstruction_jobs
      WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
      ORDER BY created_at DESC, id ASC LIMIT 100
    `;
    return rows.map(mapJob);
  }

  async findJob(
    tenantId: string,
    projectId: string,
    reconstructionJobId: string,
  ): Promise<ReconstructionJob | undefined> {
    const rows = await this.#sql<JobRow[]>`
      SELECT * FROM reconstruction_jobs
      WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
        AND id = ${reconstructionJobId}::uuid LIMIT 1
    `;
    return rows[0] === undefined ? undefined : mapJob(rows[0]);
  }

  async findResult(tenantId: string, projectId: string, reconstructionJobId: string) {
    const rows = await this.#sql<{ readonly result_payload: unknown }[]>`
      SELECT r.result_payload FROM reconstruction_results r
      JOIN reconstruction_jobs j
        ON j.tenant_id = r.tenant_id AND j.project_id = r.project_id AND j.id = r.job_id
      WHERE r.tenant_id = ${tenantId}::uuid AND r.project_id = ${projectId}::uuid
        AND r.job_id = ${reconstructionJobId}::uuid LIMIT 1
    `;
    return rows[0] === undefined
      ? undefined
      : reconstructionResultSchema.parse(rows[0].result_payload);
  }

  cancelJob(
    command: TransitionReconstructionJobCommand,
  ): Promise<{ readonly job: ReconstructionJob; readonly replayed: boolean }> {
    return this.#transition(command, "cancel");
  }

  retryJob(
    command: TransitionReconstructionJobCommand,
  ): Promise<{ readonly job: ReconstructionJob; readonly replayed: boolean }> {
    return this.#transition(command, "retry");
  }

  async #transition(
    command: TransitionReconstructionJobCommand,
    transition: "cancel" | "retry",
  ): Promise<{ readonly job: ReconstructionJob; readonly replayed: boolean }> {
    return this.#sql.begin(async (transaction) => {
      const operation = `reconstruction.job.${transition}`;
      const claim = actorClaim(command, operation, {
        expectedVersion: command.expectedVersion,
        projectId: command.projectId,
        reconstructionJobId: command.reconstructionJobId,
      });
      const idempotency = await claimIdempotency(transaction, claim);
      if (idempotency.kind === "replay") {
        return { job: reconstructionJobSchema.parse(idempotency.body), replayed: true };
      }
      const rows = await transaction<JobRow[]>`
        SELECT * FROM reconstruction_jobs
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid
          AND id = ${command.reconstructionJobId}::uuid
        LIMIT 1 FOR UPDATE
      `;
      const row = rows[0];
      if (row === undefined) {
        throw new ApiError({
          code: "NOT_FOUND",
          detail: "The requested resource was not found.",
          statusCode: 404,
          title: "Not Found",
        });
      }
      const current = mapJob(row);
      if (current.version !== command.expectedVersion) throw versionConflict(current);
      const timestamp = nextTimestamp(this.#clock, row.updated_at);
      let updatedRows: JobRow[];

      if (transition === "cancel") {
        if (current.state === "cancel-requested") {
          await completeIdempotency(transaction, claim, 200, current);
          return { job: current, replayed: false };
        }
        if (current.state === "created") {
          await transaction`
            UPDATE reconstruction_attempts SET state = 'cancelled', stage = stage,
              updated_at = ${timestamp}, fence_version = fence_version + 1
            WHERE tenant_id = ${command.actor.tenantId}::uuid
              AND project_id = ${command.projectId}::uuid
              AND job_id = ${command.reconstructionJobId}::uuid
              AND attempt = ${current.attempt} AND state = 'queued'
          `;
          updatedRows = await transaction<JobRow[]>`
            UPDATE reconstruction_jobs SET state = 'cancelled', retryable = true,
              updated_at = ${timestamp}, version = version + 1
            WHERE tenant_id = ${command.actor.tenantId}::uuid
              AND project_id = ${command.projectId}::uuid
              AND id = ${command.reconstructionJobId}::uuid AND version = ${current.version}
            RETURNING *
          `;
        } else if (
          [
            "preparing",
            "ready-for-reconstruction",
            "reconstructing-geometry",
            "reconstructing-appearance",
          ].includes(current.state)
        ) {
          await transaction`
            UPDATE reconstruction_attempts SET state = 'cancel-requested',
              updated_at = ${timestamp}, fence_version = fence_version + 1
            WHERE tenant_id = ${command.actor.tenantId}::uuid
              AND project_id = ${command.projectId}::uuid
              AND job_id = ${command.reconstructionJobId}::uuid
              AND attempt = ${current.attempt} AND state = 'leased'
          `;
          updatedRows = await transaction<JobRow[]>`
            UPDATE reconstruction_jobs SET state = 'cancel-requested', retryable = false,
              updated_at = ${timestamp}, version = version + 1
            WHERE tenant_id = ${command.actor.tenantId}::uuid
              AND project_id = ${command.projectId}::uuid
              AND id = ${command.reconstructionJobId}::uuid AND version = ${current.version}
            RETURNING *
          `;
        } else {
          throw reconstructionConflict(
            "RECONSTRUCTION_JOB_NOT_CANCELLABLE",
            "Only created or active reconstruction work can be cancelled.",
          );
        }
      } else {
        if (
          !["cancelled", "failed"].includes(current.state) ||
          !current.retryable ||
          current.attempt >= c8ReconstructionPolicy.maximumAttempts
        ) {
          throw reconstructionConflict(
            "RECONSTRUCTION_JOB_NOT_RETRYABLE",
            "This job is not retryable or has reached the three-attempt limit.",
          );
        }
        if (
          !(await sourcesStillEligible(
            transaction,
            command.actor.tenantId,
            command.projectId,
            command.reconstructionJobId,
          ))
        ) {
          throw reconstructionConflict(
            "RECONSTRUCTION_SOURCE_RIGHTS_WITHDRAWN",
            "An exact source or processing right changed before retry.",
          );
        }
        const nextAttempt = current.attempt + 1;
        updatedRows = await transaction<JobRow[]>`
          UPDATE reconstruction_jobs SET attempt = ${nextAttempt}, state = 'created',
            result_id = NULL, retryable = false, safe_code = NULL,
            updated_at = ${timestamp}, version = version + 1
          WHERE tenant_id = ${command.actor.tenantId}::uuid
            AND project_id = ${command.projectId}::uuid
            AND id = ${command.reconstructionJobId}::uuid AND version = ${current.version}
          RETURNING *
        `;
        await transaction`
          INSERT INTO reconstruction_attempts (
            tenant_id, project_id, job_id, attempt, state, stage, created_at, updated_at
          ) VALUES (
            ${command.actor.tenantId}::uuid, ${command.projectId}::uuid,
            ${command.reconstructionJobId}::uuid, ${nextAttempt}, 'queued', 'preparing',
            ${timestamp}, ${timestamp}
          )
        `;
      }
      const updated = updatedRows[0];
      if (updated === undefined) throw versionConflict(current);
      const job = mapJob(updated);
      await appendEvent(transaction, this.#uuid, {
        action: transition === "cancel" ? "reconstruction.job.cancel" : "reconstruction.job.retry",
        actorUserId: command.actor.userId,
        correlation: command.correlation,
        jobId: job.id,
        metadata: { attempt: job.attempt, state: job.state, version: job.version },
        occurredAt: timestamp,
        projectId: command.projectId,
        tenantId: command.actor.tenantId,
      });
      await completeIdempotency(transaction, claim, 200, job);
      return { job, replayed: false };
    });
  }

  async claimNext(
    command: ClaimReconstructionAttemptCommand,
  ): Promise<LeasedReconstructionAttempt | undefined> {
    validateWorker(command.workerId);
    const leaseSeconds = command.leaseSeconds ?? 300;
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 3_600) {
      throw reconstructionConflict(
        "RECONSTRUCTION_LEASE_INVALID",
        "Lease duration must be an integer from 30 through 3600 seconds.",
      );
    }
    const claimAt = this.#clock.now();
    return this.#sql.begin(async (transaction) => {
      const candidates = await transaction<(JobRow & AttemptRow)[]>`
        SELECT j.*, a.attempt, a.state AS attempt_state, a.stage, a.lease_owner,
          a.lease_token, a.lease_expires_at, a.lease_seconds, a.fence_version,
          a.updated_at AS attempt_updated_at, a.job_id
        FROM reconstruction_jobs j
        JOIN reconstruction_attempts a
          ON a.tenant_id = j.tenant_id AND a.project_id = j.project_id
          AND a.job_id = j.id AND a.attempt = j.attempt
        WHERE (j.state = 'created' AND a.state = 'queued')
          OR (
            j.state IN (
              'preparing', 'ready-for-reconstruction', 'reconstructing-geometry',
              'reconstructing-appearance', 'cancel-requested'
            )
            AND a.state IN ('leased', 'cancel-requested')
            AND a.lease_expires_at <= ${claimAt}
          )
        ORDER BY j.created_at, j.id
        LIMIT 1 FOR UPDATE OF j, a SKIP LOCKED
      `;
      const candidate = candidates[0] as
        | (JobRow & {
            readonly attempt_state: string;
            readonly attempt_updated_at: Date | string;
            readonly stage: string;
          })
        | undefined;
      if (candidate === undefined) return undefined;
      const timestamp = nextTimestamp(
        this.#clock,
        new Date(candidate.updated_at).getTime() > new Date(candidate.attempt_updated_at).getTime()
          ? candidate.updated_at
          : candidate.attempt_updated_at,
      );
      if (candidate.state === "cancel-requested") {
        await transaction`
          UPDATE reconstruction_attempts SET state = 'cancelled', lease_owner = NULL,
            lease_token = NULL, lease_expires_at = NULL, lease_seconds = NULL,
            updated_at = ${timestamp}, fence_version = fence_version + 1
          WHERE tenant_id = ${candidate.tenant_id}::uuid
            AND project_id = ${candidate.project_id}::uuid AND job_id = ${candidate.id}::uuid
            AND attempt = ${candidate.attempt} AND state = 'cancel-requested'
        `;
        await transaction`
          UPDATE reconstruction_jobs SET state = 'cancelled', retryable = true,
            updated_at = ${timestamp}, version = version + 1
          WHERE tenant_id = ${candidate.tenant_id}::uuid
            AND project_id = ${candidate.project_id}::uuid AND id = ${candidate.id}::uuid
        `;
        await appendEvent(transaction, this.#uuid, {
          action: "reconstruction.job.cancelled",
          jobId: candidate.id,
          metadata: { attempt: candidate.attempt, state: "cancelled" },
          occurredAt: timestamp,
          projectId: candidate.project_id,
          tenantId: candidate.tenant_id,
          workerId: command.workerId,
        });
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
        await transaction`
          UPDATE reconstruction_attempts SET state = 'failed', lease_owner = NULL,
            lease_token = NULL, lease_expires_at = NULL, lease_seconds = NULL,
            updated_at = ${timestamp}, fence_version = fence_version + 1
          WHERE tenant_id = ${candidate.tenant_id}::uuid
            AND project_id = ${candidate.project_id}::uuid AND job_id = ${candidate.id}::uuid
            AND attempt = ${candidate.attempt}
        `;
        await transaction`
          UPDATE reconstruction_jobs SET state = 'failed', retryable = false,
            safe_code = 'RECONSTRUCTION_SOURCE_RIGHTS_WITHDRAWN',
            updated_at = ${timestamp}, version = version + 1
          WHERE tenant_id = ${candidate.tenant_id}::uuid
            AND project_id = ${candidate.project_id}::uuid AND id = ${candidate.id}::uuid
        `;
        await appendEvent(transaction, this.#uuid, {
          action: "reconstruction.job.fail",
          jobId: candidate.id,
          metadata: {
            attempt: candidate.attempt,
            safeCode: "RECONSTRUCTION_SOURCE_RIGHTS_WITHDRAWN",
          },
          occurredAt: timestamp,
          projectId: candidate.project_id,
          tenantId: candidate.tenant_id,
          workerId: command.workerId,
        });
        return undefined;
      }
      const leaseToken = this.#uuid.randomUUID();
      const stage = (
        candidate.state === "created" ? "preparing" : candidate.state
      ) as ReconstructionWorkerStage;
      const attempts = await transaction<AttemptRow[]>`
        UPDATE reconstruction_attempts SET state = 'leased', stage = ${stage},
          lease_owner = ${command.workerId}, lease_token = ${leaseToken}::uuid,
          lease_expires_at = ${timestamp} + (${leaseSeconds} * interval '1 second'),
          lease_seconds = ${leaseSeconds}, updated_at = ${timestamp},
          fence_version = fence_version + 1
        WHERE tenant_id = ${candidate.tenant_id}::uuid
          AND project_id = ${candidate.project_id}::uuid AND job_id = ${candidate.id}::uuid
          AND attempt = ${candidate.attempt}
        RETURNING *
      `;
      const updatedJobs = await transaction<JobRow[]>`
        UPDATE reconstruction_jobs SET state = ${stage}, updated_at = ${timestamp},
          version = version + 1
        WHERE tenant_id = ${candidate.tenant_id}::uuid
          AND project_id = ${candidate.project_id}::uuid AND id = ${candidate.id}::uuid
        RETURNING *
      `;
      const attempt = attempts[0];
      const updatedJob = updatedJobs[0];
      if (attempt === undefined || attempt.lease_expires_at === null || updatedJob === undefined) {
        throw new Error("Reconstruction lease update returned no row.");
      }
      await appendEvent(transaction, this.#uuid, {
        action: "reconstruction.job.lease",
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
        request: mapJob(updatedJob).request,
        sourceManifestSha256: candidate.source_manifest_sha256,
        stage,
        tenantId: candidate.tenant_id,
      };
    });
  }

  async advanceAttempt(command: AdvanceReconstructionAttemptCommand): Promise<ReconstructionJob> {
    validateWorker(command.workerId);
    return this.#sql.begin(async (transaction) => {
      const now = this.#clock.now();
      const attempts = await transaction<AttemptRow[]>`
        SELECT * FROM reconstruction_attempts
        WHERE job_id = ${command.jobId}::uuid AND attempt = ${command.attempt}
        LIMIT 1 FOR UPDATE
      `;
      const currentAttempt = assertLease(attempts[0], command, now);
      const jobs = await transaction<JobRow[]>`
        SELECT * FROM reconstruction_jobs
        WHERE tenant_id = ${currentAttempt.tenant_id}::uuid
          AND project_id = ${currentAttempt.project_id}::uuid AND id = ${command.jobId}::uuid
        LIMIT 1 FOR UPDATE
      `;
      const currentJobRow = jobs[0];
      if (currentJobRow === undefined || currentJobRow.attempt !== command.attempt) {
        throw reconstructionConflict(
          "RECONSTRUCTION_LEASE_FENCED",
          "A newer reconstruction attempt owns this job.",
        );
      }
      const progression: Readonly<
        Record<ReconstructionWorkerStage, readonly ReconstructionWorkerStage[]>
      > = {
        preparing: ["preparing", "ready-for-reconstruction"],
        "ready-for-reconstruction": ["ready-for-reconstruction", "reconstructing-geometry"],
        "reconstructing-geometry": ["reconstructing-geometry", "reconstructing-appearance"],
        "reconstructing-appearance": ["reconstructing-appearance"],
      };
      const currentStage = currentAttempt.stage as ReconstructionWorkerStage;
      if (!progression[currentStage].includes(command.stage)) {
        throw reconstructionConflict(
          "RECONSTRUCTION_STAGE_INVALID",
          "The worker attempted to skip or reverse a reconstruction stage.",
        );
      }
      const timestamp = nextTimestamp(this.#clock, currentAttempt.updated_at);
      const leaseSeconds = currentAttempt.lease_seconds ?? 300;
      await transaction`
        UPDATE reconstruction_attempts SET stage = ${command.stage},
          lease_expires_at = ${timestamp} + (${leaseSeconds} * interval '1 second'),
          updated_at = ${timestamp}, fence_version = fence_version + 1
        WHERE tenant_id = ${currentAttempt.tenant_id}::uuid
          AND project_id = ${currentAttempt.project_id}::uuid AND job_id = ${command.jobId}::uuid
          AND attempt = ${command.attempt}
      `;
      const updated = await transaction<JobRow[]>`
        UPDATE reconstruction_jobs SET state = ${command.stage}, updated_at = ${timestamp},
          version = version + 1
        WHERE tenant_id = ${currentAttempt.tenant_id}::uuid
          AND project_id = ${currentAttempt.project_id}::uuid AND id = ${command.jobId}::uuid
        RETURNING *
      `;
      const row = updated[0];
      if (row === undefined) throw new Error("Reconstruction stage update returned no row.");
      await appendEvent(transaction, this.#uuid, {
        action: "reconstruction.job.advance",
        jobId: command.jobId,
        metadata: { attempt: command.attempt, stage: command.stage },
        occurredAt: timestamp,
        projectId: currentAttempt.project_id,
        tenantId: currentAttempt.tenant_id,
        workerId: command.workerId,
      });
      return mapJob(row);
    });
  }

  async publishResult(command: PublishReconstructionResultCommand): Promise<ReconstructionJob> {
    validateWorker(command.workerId);
    if (
      !safeCodePattern.test(
        command.result.status === "abstained" ? command.result.safeCode : "VALID",
      )
    ) {
      throw reconstructionConflict(
        "RECONSTRUCTION_SAFE_CODE_INVALID",
        "The result safe code is invalid.",
      );
    }
    const result = reconstructionResultSchema.parse(command.result);
    return this.#sql.begin(async (transaction) => {
      const now = this.#clock.now();
      const attempts = await transaction<AttemptRow[]>`
        SELECT * FROM reconstruction_attempts
        WHERE job_id = ${command.jobId}::uuid AND attempt = ${command.attempt}
        LIMIT 1 FOR UPDATE
      `;
      const attempt = assertLease(attempts[0], command, now);
      const jobs = await transaction<JobRow[]>`
        SELECT * FROM reconstruction_jobs
        WHERE tenant_id = ${attempt.tenant_id}::uuid AND project_id = ${attempt.project_id}::uuid
          AND id = ${command.jobId}::uuid LIMIT 1 FOR UPDATE
      `;
      const currentRow = jobs[0];
      if (currentRow === undefined || currentRow.attempt !== command.attempt) {
        throw reconstructionConflict(
          "RECONSTRUCTION_LEASE_FENCED",
          "A newer attempt owns this job.",
        );
      }
      const current = mapJob(currentRow);
      if (
        result.jobId !== command.jobId ||
        result.projectId !== attempt.project_id ||
        result.sourceManifestSha256 !== currentRow.source_manifest_sha256
      ) {
        throw reconstructionConflict(
          "RECONSTRUCTION_RESULT_SCOPE_MISMATCH",
          "The result does not match the leased job, project, or exact source manifest.",
        );
      }
      if (
        result.status === "completed" &&
        !["reconstructing-geometry", "reconstructing-appearance"].includes(current.state)
      ) {
        throw reconstructionConflict(
          "RECONSTRUCTION_RESULT_STAGE_INVALID",
          "Completed geometry can only publish from a reconstruction stage.",
        );
      }
      if (
        current.request.appearanceMode === "disabled" &&
        result.status === "completed" &&
        result.appearance
      ) {
        throw reconstructionConflict(
          "RECONSTRUCTION_APPEARANCE_DISABLED",
          "An appearance result cannot publish when appearance processing was disabled.",
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
        await transaction`
          UPDATE reconstruction_attempts SET state = 'failed', lease_owner = NULL,
            lease_token = NULL, lease_expires_at = NULL, lease_seconds = NULL,
            updated_at = ${timestamp}, fence_version = fence_version + 1
          WHERE tenant_id = ${attempt.tenant_id}::uuid AND project_id = ${attempt.project_id}::uuid
            AND job_id = ${command.jobId}::uuid AND attempt = ${command.attempt}
        `;
        const failed = await transaction<JobRow[]>`
          UPDATE reconstruction_jobs SET state = 'failed', retryable = false,
            safe_code = 'RECONSTRUCTION_SOURCE_RIGHTS_WITHDRAWN',
            updated_at = ${timestamp}, version = version + 1
          WHERE tenant_id = ${attempt.tenant_id}::uuid AND project_id = ${attempt.project_id}::uuid
            AND id = ${command.jobId}::uuid RETURNING *
        `;
        await appendEvent(transaction, this.#uuid, {
          action: "reconstruction.job.fail",
          jobId: command.jobId,
          metadata: {
            attempt: command.attempt,
            safeCode: "RECONSTRUCTION_SOURCE_RIGHTS_WITHDRAWN",
          },
          occurredAt: timestamp,
          projectId: attempt.project_id,
          tenantId: attempt.tenant_id,
          workerId: command.workerId,
        });
        const failedRow = failed[0];
        if (failedRow === undefined) throw new Error("Rights failure update returned no row.");
        return mapJob(failedRow);
      }
      await transaction`
        INSERT INTO reconstruction_results (
          tenant_id, project_id, job_id, id, attempt, status,
          source_manifest_sha256, result_payload, created_at
        ) VALUES (
          ${attempt.tenant_id}::uuid, ${attempt.project_id}::uuid, ${command.jobId}::uuid,
          ${result.resultId}::uuid, ${command.attempt}, ${result.status},
          ${result.sourceManifestSha256}, ${transaction.json(json(result))}, ${result.createdAt}
        )
      `;
      await transaction`
        UPDATE reconstruction_attempts SET state = 'succeeded', lease_owner = NULL,
          lease_token = NULL, lease_expires_at = NULL, lease_seconds = NULL,
          updated_at = ${timestamp}, fence_version = fence_version + 1
        WHERE tenant_id = ${attempt.tenant_id}::uuid AND project_id = ${attempt.project_id}::uuid
          AND job_id = ${command.jobId}::uuid AND attempt = ${command.attempt}
      `;
      const updated = await transaction<JobRow[]>`
        UPDATE reconstruction_jobs SET state = ${result.status}, result_id = ${result.resultId}::uuid,
          retryable = false, safe_code = ${result.status === "abstained" ? result.safeCode : null},
          updated_at = ${timestamp}, version = version + 1
        WHERE tenant_id = ${attempt.tenant_id}::uuid AND project_id = ${attempt.project_id}::uuid
          AND id = ${command.jobId}::uuid RETURNING *
      `;
      const row = updated[0];
      if (row === undefined) throw new Error("Reconstruction publication returned no row.");
      await appendEvent(transaction, this.#uuid, {
        action: "reconstruction.job.publish",
        jobId: command.jobId,
        metadata: {
          appearancePresent: result.status === "completed" && result.appearance !== undefined,
          attempt: command.attempt,
          findingCount: result.findings.length,
          status: result.status,
        },
        occurredAt: timestamp,
        projectId: attempt.project_id,
        tenantId: attempt.tenant_id,
        workerId: command.workerId,
      });
      return mapJob(row);
    });
  }

  async failAttempt(command: FailReconstructionAttemptCommand): Promise<ReconstructionJob> {
    validateWorker(command.workerId);
    if (!safeCodePattern.test(command.safeCode)) {
      throw reconstructionConflict(
        "RECONSTRUCTION_SAFE_CODE_INVALID",
        "The worker safe code is invalid.",
      );
    }
    return this.#sql.begin(async (transaction) => {
      const now = this.#clock.now();
      const attempts = await transaction<AttemptRow[]>`
        SELECT * FROM reconstruction_attempts
        WHERE job_id = ${command.jobId}::uuid AND attempt = ${command.attempt}
        LIMIT 1 FOR UPDATE
      `;
      const attempt = assertLease(attempts[0], command, now);
      const timestamp = nextTimestamp(this.#clock, attempt.updated_at);
      const retryable =
        command.retryable && command.attempt < c8ReconstructionPolicy.maximumAttempts;
      await transaction`
        UPDATE reconstruction_attempts SET state = 'failed', lease_owner = NULL,
          lease_token = NULL, lease_expires_at = NULL, lease_seconds = NULL,
          updated_at = ${timestamp}, fence_version = fence_version + 1
        WHERE tenant_id = ${attempt.tenant_id}::uuid AND project_id = ${attempt.project_id}::uuid
          AND job_id = ${command.jobId}::uuid AND attempt = ${command.attempt}
      `;
      const updated = await transaction<JobRow[]>`
        UPDATE reconstruction_jobs SET state = 'failed', retryable = ${retryable},
          safe_code = ${command.safeCode}, updated_at = ${timestamp}, version = version + 1
        WHERE tenant_id = ${attempt.tenant_id}::uuid AND project_id = ${attempt.project_id}::uuid
          AND id = ${command.jobId}::uuid AND attempt = ${command.attempt}
        RETURNING *
      `;
      const row = updated[0];
      if (row === undefined) throw new Error("Reconstruction failure update returned no row.");
      await appendEvent(transaction, this.#uuid, {
        action: "reconstruction.job.fail",
        jobId: command.jobId,
        metadata: { attempt: command.attempt, retryable, safeCode: command.safeCode },
        occurredAt: timestamp,
        projectId: attempt.project_id,
        tenantId: attempt.tenant_id,
        workerId: command.workerId,
      });
      return mapJob(row);
    });
  }

  async acknowledgeCancellation(
    command: AcknowledgeReconstructionCancellationCommand,
  ): Promise<void> {
    validateWorker(command.workerId);
    await this.#sql.begin(async (transaction) => {
      const now = this.#clock.now();
      const attempts = await transaction<AttemptRow[]>`
        SELECT * FROM reconstruction_attempts
        WHERE job_id = ${command.jobId}::uuid AND attempt = ${command.attempt}
        LIMIT 1 FOR UPDATE
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
        throw reconstructionConflict(
          "RECONSTRUCTION_LEASE_FENCED",
          "Only the currently fenced worker can acknowledge cancellation.",
        );
      }
      const timestamp = nextTimestamp(this.#clock, attempt.updated_at);
      await transaction`
        UPDATE reconstruction_attempts SET state = 'cancelled', lease_owner = NULL,
          lease_token = NULL, lease_expires_at = NULL, lease_seconds = NULL,
          updated_at = ${timestamp}, fence_version = fence_version + 1
        WHERE tenant_id = ${attempt.tenant_id}::uuid AND project_id = ${attempt.project_id}::uuid
          AND job_id = ${command.jobId}::uuid AND attempt = ${command.attempt}
      `;
      await transaction`
        UPDATE reconstruction_jobs SET state = 'cancelled', retryable = true,
          updated_at = ${timestamp}, version = version + 1
        WHERE tenant_id = ${attempt.tenant_id}::uuid AND project_id = ${attempt.project_id}::uuid
          AND id = ${command.jobId}::uuid AND state = 'cancel-requested'
      `;
      await appendEvent(transaction, this.#uuid, {
        action: "reconstruction.job.cancelled",
        jobId: command.jobId,
        metadata: { attempt: command.attempt, state: "cancelled" },
        occurredAt: timestamp,
        projectId: attempt.project_id,
        tenantId: attempt.tenant_id,
        workerId: command.workerId,
      });
    });
  }

  async withdrawSource(command: WithdrawReconstructionSourceCommand): Promise<number> {
    return this.#sql.begin(async (transaction) => {
      const assets = await transaction<{ readonly id: string }[]>`
        SELECT id FROM assets
        WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND id = ${command.assetId}::uuid LIMIT 1 FOR UPDATE
      `;
      if (assets.length === 0) return 0;
      const timestamp = nextTimestamp(this.#clock);
      const inserted = await transaction<{ readonly asset_id: string }[]>`
        INSERT INTO reconstruction_rights_withdrawals (
          tenant_id, project_id, asset_id, reason_code, withdrawn_at
        ) VALUES (
          ${command.tenantId}::uuid, ${command.projectId}::uuid, ${command.assetId}::uuid,
          ${command.reasonCode}, ${timestamp}
        ) ON CONFLICT (tenant_id, project_id, asset_id) DO NOTHING
        RETURNING asset_id
      `;
      if (inserted.length === 0) return 0;
      const jobs = await transaction<JobRow[]>`
        SELECT j.* FROM reconstruction_jobs j
        JOIN reconstruction_job_sources s
          ON s.tenant_id = j.tenant_id AND s.project_id = j.project_id AND s.job_id = j.id
        WHERE s.tenant_id = ${command.tenantId}::uuid AND s.project_id = ${command.projectId}::uuid
          AND s.asset_id = ${command.assetId}::uuid
          AND j.state IN (
            'created', 'preparing', 'ready-for-reconstruction', 'reconstructing-geometry',
            'reconstructing-appearance'
          )
        FOR UPDATE OF j
      `;
      for (const row of jobs) {
        if (row.state === "created") {
          await transaction`
            UPDATE reconstruction_attempts SET state = 'failed', updated_at = ${timestamp},
              fence_version = fence_version + 1
            WHERE tenant_id = ${row.tenant_id}::uuid AND project_id = ${row.project_id}::uuid
              AND job_id = ${row.id}::uuid AND attempt = ${row.attempt} AND state = 'queued'
          `;
          await transaction`
            UPDATE reconstruction_jobs SET state = 'failed', retryable = false,
              safe_code = 'RECONSTRUCTION_SOURCE_RIGHTS_WITHDRAWN',
              updated_at = ${timestamp}, version = version + 1
            WHERE tenant_id = ${row.tenant_id}::uuid AND project_id = ${row.project_id}::uuid
              AND id = ${row.id}::uuid
          `;
        } else {
          await transaction`
            UPDATE reconstruction_attempts SET state = 'cancel-requested',
              updated_at = ${timestamp}, fence_version = fence_version + 1
            WHERE tenant_id = ${row.tenant_id}::uuid AND project_id = ${row.project_id}::uuid
              AND job_id = ${row.id}::uuid AND attempt = ${row.attempt} AND state = 'leased'
          `;
          await transaction`
            UPDATE reconstruction_jobs SET state = 'cancel-requested', retryable = false,
              updated_at = ${timestamp}, version = version + 1
            WHERE tenant_id = ${row.tenant_id}::uuid AND project_id = ${row.project_id}::uuid
              AND id = ${row.id}::uuid
          `;
        }
        await appendEvent(transaction, this.#uuid, {
          action: "reconstruction.source.rights-withdrawn",
          jobId: row.id,
          metadata: { attempt: row.attempt, reasonCode: command.reasonCode },
          occurredAt: timestamp,
          projectId: row.project_id,
          tenantId: row.tenant_id,
          workerId: "rights-system",
        });
      }
      return jobs.length;
    });
  }
}
