import {
  c9FusionPolicy,
  fusionJobSchema,
  fusionProposalSchema,
  type FusionJob,
} from "@interior-design/contracts";
import { createHash, randomUUID } from "node:crypto";
import type { JSONValue, Sql, TransactionSql } from "postgres";

import { canonicalSnapshotSha256 } from "./canonical.js";
import {
  FusionWorkerError,
  type FusionLeaseCommand,
  type FusionProcessingQueue,
  type FusionWorkerStage,
  type LeasedFusionAttempt,
} from "./types.js";

interface JobRow {
  readonly attempt: number;
  readonly created_at: Date | string;
  readonly created_by: string;
  readonly id: string;
  readonly project_id: string;
  readonly proposal_id: string | null;
  readonly request_payload: unknown;
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

function nextTimestamp(previous?: Date | string): Date {
  const candidate = new Date();
  if (previous === undefined) return candidate;
  const minimum = new Date(previous).getTime() + 1;
  return candidate.getTime() >= minimum ? candidate : new Date(minimum);
}

function traceId(workerId: string, action: string, jobId: string, timestamp: Date): string {
  return createHash("sha256")
    .update(`${workerId}:${action}:${jobId}:${timestamp.toISOString()}`)
    .digest("hex")
    .slice(0, 32);
}

async function event(
  transaction: TransactionSql,
  input: {
    readonly action: string;
    readonly jobId: string;
    readonly metadata: object;
    readonly occurredAt: Date;
    readonly projectId: string;
    readonly tenantId: string;
    readonly workerId: string;
  },
): Promise<void> {
  const payload = transaction.json(json(input.metadata));
  await transaction`
    INSERT INTO fusion_audit_events (
      id, tenant_id, project_id, job_id, action, worker_id,
      request_id, trace_id, metadata, occurred_at
    ) VALUES (
      ${randomUUID()}::uuid, ${input.tenantId}::uuid, ${input.projectId}::uuid,
      ${input.jobId}::uuid, ${input.action}, ${input.workerId},
      ${`worker:${input.workerId}`}, ${traceId(input.workerId, input.action, input.jobId, input.occurredAt)},
      ${payload}, ${input.occurredAt}
    )
  `;
  await transaction`
    INSERT INTO fusion_outbox (
      id, tenant_id, project_id, job_id, event_type, schema_version, payload, occurred_at
    ) VALUES (
      ${randomUUID()}::uuid, ${input.tenantId}::uuid, ${input.projectId}::uuid,
      ${input.jobId}::uuid, ${input.action}, 'c9-fusion-job-v1', ${payload}, ${input.occurredAt}
    )
  `;
}

async function rightsActive(
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
    FROM fusion_job_sources s LEFT JOIN fusion_source_rights_withdrawals w
      ON w.tenant_id = s.tenant_id AND w.project_id = s.project_id
      AND w.source_kind = s.source_kind AND w.reference_id = s.reference_id
    WHERE s.tenant_id = ${tenantId}::uuid AND s.project_id = ${projectId}::uuid
      AND s.job_id = ${jobId}::uuid
  `;
  const row = rows[0];
  return row !== undefined && row.source_count >= 2 && row.invalid_count === 0;
}

function assertLease(
  row: AttemptRow | undefined,
  command: FusionLeaseCommand,
  now: Date,
): AttemptRow {
  if (
    row === undefined ||
    row.attempt !== command.attempt ||
    row.state !== "leased" ||
    row.tenant_id !== command.tenantId ||
    row.project_id !== command.projectId ||
    row.lease_owner !== command.workerId ||
    row.lease_token !== command.leaseToken ||
    row.lease_expires_at === null ||
    new Date(row.lease_expires_at).getTime() <= now.getTime()
  ) {
    throw new FusionWorkerError("FUSION_LEASE_FENCED");
  }
  return row;
}

export class PostgresFusionProcessingQueue implements FusionProcessingQueue {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async claim(command: {
    readonly leaseSeconds: number;
    readonly workerId: string;
  }): Promise<LeasedFusionAttempt | undefined> {
    if (!/^[A-Za-z0-9_.:-]{3,100}$/u.test(command.workerId)) {
      throw new FusionWorkerError("FUSION_WORKER_INVALID");
    }
    if (
      !Number.isInteger(command.leaseSeconds) ||
      command.leaseSeconds < 30 ||
      command.leaseSeconds > 3_600
    ) {
      throw new FusionWorkerError("FUSION_LEASE_INVALID");
    }
    const claimAt = new Date();
    return this.#sql.begin(async (transaction) => {
      const rows = await transaction<
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
      const candidate = rows[0];
      if (candidate === undefined) return undefined;
      const timestamp = nextTimestamp(
        new Date(candidate.updated_at).getTime() > new Date(candidate.attempt_updated_at).getTime()
          ? candidate.updated_at
          : candidate.attempt_updated_at,
      );
      if (candidate.state === "cancel-requested") {
        await this.#cancel(transaction, candidate, command.workerId, timestamp);
        return undefined;
      }
      if (
        !(await rightsActive(transaction, candidate.tenant_id, candidate.project_id, candidate.id))
      ) {
        await this.#failUnleased(
          transaction,
          candidate,
          "FUSION_SOURCE_RIGHTS_WITHDRAWN",
          command.workerId,
          timestamp,
        );
        return undefined;
      }
      const token = randomUUID();
      const stage = (
        candidate.state === "queued" ? "registering" : candidate.state
      ) as FusionWorkerStage;
      const attempts = await transaction<AttemptRow[]>`
        UPDATE fusion_attempts SET state = 'leased', stage = ${stage}, lease_owner = ${command.workerId},
          lease_token = ${token}::uuid, lease_expires_at = ${timestamp} + (${command.leaseSeconds} * interval '1 second'),
          lease_seconds = ${command.leaseSeconds}, updated_at = ${timestamp}, fence_version = fence_version + 1
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
      if (attempt === undefined || attempt.lease_expires_at === null || job === undefined) {
        throw new FusionWorkerError("FUSION_LEASE_FENCED");
      }
      await event(transaction, {
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
        leaseToken: token,
        projectId: candidate.project_id,
        request: mapJob(job).request,
        sourceManifestSha256: candidate.source_manifest_sha256,
        stage,
        tenantId: candidate.tenant_id,
      };
    });
  }

  async heartbeat(command: FusionLeaseCommand): Promise<"active" | "cancel-requested"> {
    return this.#sql.begin(async (transaction) => {
      const rows = await transaction<AttemptRow[]>`
        SELECT * FROM fusion_attempts WHERE tenant_id = ${command.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid AND job_id = ${command.jobId}::uuid
          AND attempt = ${command.attempt} LIMIT 1 FOR UPDATE
      `;
      const row = rows[0];
      if (
        row?.state === "cancel-requested" &&
        row.lease_owner === command.workerId &&
        row.lease_token === command.leaseToken &&
        row.lease_expires_at !== null &&
        new Date(row.lease_expires_at).getTime() > Date.now()
      )
        return "cancel-requested";
      const attempt = assertLease(row, command, new Date());
      const timestamp = nextTimestamp(attempt.updated_at);
      const leaseSeconds = attempt.lease_seconds ?? 300;
      await transaction`
        UPDATE fusion_attempts SET lease_expires_at = ${timestamp} + (${leaseSeconds} * interval '1 second'),
          updated_at = ${timestamp}, fence_version = fence_version + 1
        WHERE tenant_id = ${attempt.tenant_id}::uuid AND project_id = ${attempt.project_id}::uuid
          AND job_id = ${command.jobId}::uuid AND attempt = ${command.attempt}
      `;
      return "active";
    });
  }

  async advance(
    command: FusionLeaseCommand & { readonly stage: FusionWorkerStage },
  ): Promise<void> {
    await this.#sql.begin(async (transaction) => {
      const rows = await transaction<AttemptRow[]>`
        SELECT * FROM fusion_attempts WHERE tenant_id = ${command.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid AND job_id = ${command.jobId}::uuid
          AND attempt = ${command.attempt} LIMIT 1 FOR UPDATE
      `;
      const attempt = assertLease(rows[0], command, new Date());
      const current = attempt.stage as FusionWorkerStage;
      const allowed: Readonly<Record<FusionWorkerStage, readonly FusionWorkerStage[]>> = {
        registering: ["registering", "fitting"],
        fitting: ["fitting", "comparing"],
        comparing: ["comparing"],
      };
      if (!allowed[current].includes(command.stage))
        throw new FusionWorkerError("FUSION_STAGE_INVALID");
      const timestamp = nextTimestamp(attempt.updated_at);
      const leaseSeconds = attempt.lease_seconds ?? 300;
      await transaction`
        UPDATE fusion_attempts SET stage = ${command.stage},
          lease_expires_at = ${timestamp} + (${leaseSeconds} * interval '1 second'),
          updated_at = ${timestamp}, fence_version = fence_version + 1
        WHERE tenant_id = ${attempt.tenant_id}::uuid AND project_id = ${attempt.project_id}::uuid
          AND job_id = ${command.jobId}::uuid AND attempt = ${command.attempt}
      `;
      const jobs = await transaction<JobRow[]>`
        UPDATE fusion_jobs SET state = ${command.stage}, updated_at = ${timestamp}, version = version + 1
        WHERE tenant_id = ${attempt.tenant_id}::uuid AND project_id = ${attempt.project_id}::uuid
          AND id = ${command.jobId}::uuid AND attempt = ${command.attempt} RETURNING *
      `;
      if (jobs.length !== 1) throw new FusionWorkerError("FUSION_LEASE_FENCED");
      await event(transaction, {
        action: "fusion.job.advance",
        jobId: command.jobId,
        metadata: { attempt: command.attempt, stage: command.stage },
        occurredAt: timestamp,
        projectId: attempt.project_id,
        tenantId: attempt.tenant_id,
        workerId: command.workerId,
      });
    });
  }

  async publish(
    command: FusionLeaseCommand & {
      readonly proposal: ReturnType<typeof fusionProposalSchema.parse>;
    },
  ): Promise<void> {
    const proposal = fusionProposalSchema.parse(command.proposal);
    if (
      proposal.status !== "abstained" &&
      canonicalSnapshotSha256(proposal.candidateSnapshot) !== proposal.candidateSnapshotSha256
    ) {
      throw new FusionWorkerError("FUSION_CANDIDATE_HASH_MISMATCH");
    }
    const published = await this.#sql.begin(async (transaction) => {
      const attempts = await transaction<AttemptRow[]>`
        SELECT * FROM fusion_attempts WHERE tenant_id = ${command.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid AND job_id = ${command.jobId}::uuid
          AND attempt = ${command.attempt} LIMIT 1 FOR UPDATE
      `;
      const attempt = assertLease(attempts[0], command, new Date());
      const jobs = await transaction<JobRow[]>`
        SELECT * FROM fusion_jobs WHERE tenant_id = ${attempt.tenant_id}::uuid
          AND project_id = ${attempt.project_id}::uuid AND id = ${command.jobId}::uuid LIMIT 1 FOR UPDATE
      `;
      const row = jobs[0];
      if (row === undefined || row.attempt !== command.attempt)
        throw new FusionWorkerError("FUSION_LEASE_FENCED");
      const job = mapJob(row);
      if (
        proposal.projectId !== job.projectId ||
        proposal.sourceManifestSha256 !== row.source_manifest_sha256 ||
        proposal.baseSnapshot.modelId !== job.request.baseSnapshot.modelId ||
        proposal.baseSnapshot.snapshotId !== job.request.baseSnapshot.snapshotId ||
        proposal.baseSnapshot.snapshotSha256 !== job.request.baseSnapshot.snapshotSha256 ||
        proposal.registrations.length !== job.request.sources.length ||
        new Set(proposal.registrations.map(({ sourceId }) => sourceId)).size !==
          proposal.registrations.length ||
        job.request.sources.some(
          ({ id }) => !proposal.registrations.some(({ sourceId }) => sourceId === id),
        )
      )
        throw new FusionWorkerError("FUSION_PROPOSAL_SCOPE_MISMATCH");
      if (proposal.status !== "abstained" && job.state !== "comparing") {
        throw new FusionWorkerError("FUSION_PROPOSAL_STAGE_INVALID");
      }
      if (
        !(await rightsActive(transaction, attempt.tenant_id, attempt.project_id, command.jobId))
      ) {
        await this.#failLeased(
          transaction,
          attempt,
          row,
          "FUSION_SOURCE_RIGHTS_WITHDRAWN",
          false,
          command.workerId,
        );
        return false;
      }
      const immutable = fusionProposalSchema.parse({ ...proposal, version: 1 });
      const timestamp = nextTimestamp(row.updated_at);
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
        INSERT INTO fusion_proposal_review_heads (tenant_id, project_id, proposal_id, version, updated_at)
        VALUES (${attempt.tenant_id}::uuid, ${attempt.project_id}::uuid, ${immutable.id}::uuid, 1, ${timestamp})
      `;
      await transaction`
        UPDATE fusion_attempts SET state = 'succeeded', lease_owner = NULL, lease_token = NULL,
          lease_expires_at = NULL, lease_seconds = NULL, updated_at = ${timestamp},
          fence_version = fence_version + 1
        WHERE tenant_id = ${attempt.tenant_id}::uuid AND project_id = ${attempt.project_id}::uuid
          AND job_id = ${command.jobId}::uuid AND attempt = ${command.attempt}
      `;
      const terminal = immutable.status === "abstained" ? "abstained" : "proposed";
      await transaction`
        UPDATE fusion_jobs SET state = ${terminal},
          proposal_id = ${immutable.status === "abstained" ? null : immutable.id}::uuid,
          safe_code = ${immutable.status === "abstained" ? immutable.safeCode : null},
          retryable = ${immutable.status === "abstained" && command.attempt < c9FusionPolicy.maximumAttempts},
          updated_at = ${timestamp}, version = version + 1
        WHERE tenant_id = ${attempt.tenant_id}::uuid AND project_id = ${attempt.project_id}::uuid
          AND id = ${command.jobId}::uuid AND attempt = ${command.attempt}
      `;
      await event(transaction, {
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
      return true;
    });
    if (!published) throw new FusionWorkerError("FUSION_SOURCE_RIGHTS_WITHDRAWN");
  }

  async fail(
    command: FusionLeaseCommand & { readonly retryable: boolean; readonly safeCode: string },
  ): Promise<void> {
    if (!/^[A-Z][A-Z0-9_]{2,79}$/u.test(command.safeCode)) {
      throw new FusionWorkerError("FUSION_SAFE_CODE_INVALID");
    }
    await this.#sql.begin(async (transaction) => {
      const attempts = await transaction<AttemptRow[]>`
        SELECT * FROM fusion_attempts WHERE tenant_id = ${command.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid AND job_id = ${command.jobId}::uuid
          AND attempt = ${command.attempt} LIMIT 1 FOR UPDATE
      `;
      const attempt = assertLease(attempts[0], command, new Date());
      const jobs = await transaction<JobRow[]>`
        SELECT * FROM fusion_jobs WHERE tenant_id = ${attempt.tenant_id}::uuid
          AND project_id = ${attempt.project_id}::uuid AND id = ${command.jobId}::uuid LIMIT 1 FOR UPDATE
      `;
      const job = jobs[0];
      if (job === undefined || job.attempt !== command.attempt)
        throw new FusionWorkerError("FUSION_LEASE_FENCED");
      await this.#failLeased(
        transaction,
        attempt,
        job,
        command.safeCode,
        command.retryable,
        command.workerId,
      );
    });
  }

  async acknowledgeCancellation(command: FusionLeaseCommand): Promise<void> {
    await this.#sql.begin(async (transaction) => {
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
        new Date(attempt.lease_expires_at).getTime() <= Date.now()
      )
        throw new FusionWorkerError("FUSION_LEASE_FENCED");
      const jobs = await transaction<JobRow[]>`
        SELECT * FROM fusion_jobs WHERE tenant_id = ${attempt.tenant_id}::uuid
          AND project_id = ${attempt.project_id}::uuid AND id = ${command.jobId}::uuid LIMIT 1 FOR UPDATE
      `;
      const job = jobs[0];
      if (job === undefined) throw new FusionWorkerError("FUSION_LEASE_FENCED");
      await this.#cancel(transaction, job, command.workerId, nextTimestamp(attempt.updated_at));
    });
  }

  async #cancel(
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
      WHERE tenant_id = ${job.tenant_id}::uuid AND project_id = ${job.project_id}::uuid AND id = ${job.id}::uuid
    `;
    await event(transaction, {
      action: "fusion.job.cancelled",
      jobId: job.id,
      metadata: { attempt: job.attempt, state: "cancelled" },
      occurredAt: timestamp,
      projectId: job.project_id,
      tenantId: job.tenant_id,
      workerId,
    });
  }

  async #failUnleased(
    transaction: TransactionSql,
    job: JobRow,
    safeCode: string,
    workerId: string,
    timestamp: Date,
  ): Promise<void> {
    await transaction`
      UPDATE fusion_attempts SET state = 'failed', updated_at = ${timestamp}, fence_version = fence_version + 1
      WHERE tenant_id = ${job.tenant_id}::uuid AND project_id = ${job.project_id}::uuid
        AND job_id = ${job.id}::uuid AND attempt = ${job.attempt}
    `;
    await transaction`
      UPDATE fusion_jobs SET state = 'failed', retryable = false, safe_code = ${safeCode},
        updated_at = ${timestamp}, version = version + 1
      WHERE tenant_id = ${job.tenant_id}::uuid AND project_id = ${job.project_id}::uuid AND id = ${job.id}::uuid
    `;
    await event(transaction, {
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
    workerId: string,
  ): Promise<void> {
    const timestamp = nextTimestamp(attempt.updated_at);
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
    await event(transaction, {
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
