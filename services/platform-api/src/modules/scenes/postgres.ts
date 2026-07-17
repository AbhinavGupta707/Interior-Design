import {
  c10ScenePolicy,
  sceneJobSchema,
  sceneRecordSchema,
  type SceneJob,
  type SceneRecord,
} from "@interior-design/contracts";
import { createHash, randomUUID } from "node:crypto";
import type { JSONValue, Sql, TransactionSql } from "postgres";

import { ApiError } from "../../errors.js";
import {
  claimIdempotency,
  completeIdempotency,
  type IdempotencyClaim,
} from "../projects/idempotency.js";
import { sceneConflict } from "./errors.js";
import type {
  AcknowledgeSceneCancellationCommand,
  ClaimSceneAttemptCommand,
  CreateSceneJobCommand,
  FailSceneAttemptCommand,
  HeartbeatSceneAttemptCommand,
  LeasedSceneAttempt,
  PersistScenePublicationCommand,
  RecordSceneAccessCommand,
  SceneClock,
  SceneRepository,
  SceneUuidFactory,
  SceneWorkerStage,
  TransitionSceneJobCommand,
} from "./types.js";

interface JobRow {
  readonly attempt: number;
  readonly cache_key_sha256: string;
  readonly compiler_name: "interior-design-scene-compiler";
  readonly compiler_version: string;
  readonly configuration_sha256: string;
  readonly created_at: Date | string;
  readonly created_by: string;
  readonly id: string;
  readonly project_id: string;
  readonly request_payload: unknown;
  readonly request_sha256: string;
  readonly retryable: boolean;
  readonly safe_code: string | null;
  readonly scene_id: string | null;
  readonly source_model_id: string;
  readonly source_profile: string;
  readonly source_schema_version: string;
  readonly source_snapshot_id: string;
  readonly source_snapshot_sha256: string;
  readonly source_snapshot_version: number;
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

interface SceneRow {
  readonly artifact_byte_size: number;
  readonly artifact_glb_sha256: string;
  readonly artifact_id: string;
  readonly artifact_manifest_sha256: string;
  readonly artifact_mime_type: string;
  readonly artifact_schema_version: string;
  readonly created_at: Date | string;
  readonly created_by: string;
  readonly id: string;
  readonly manifest_payload: unknown;
  readonly project_id: string;
}

const systemClock: SceneClock = { now: () => new Date() };
const systemUuid: SceneUuidFactory = { randomUUID };
const workerPattern = /^[A-Za-z0-9_.:-]{3,100}$/u;
const safeCodePattern = /^[A-Z][A-Z0-9_]{2,79}$/u;

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function json(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function mapJob(row: JobRow): SceneJob {
  return sceneJobSchema.parse({
    attempt: row.attempt,
    createdAt: iso(row.created_at),
    createdBy: row.created_by,
    id: row.id,
    projectId: row.project_id,
    request: row.request_payload,
    ...(row.safe_code === null ? {} : { safeCode: row.safe_code }),
    ...(row.scene_id === null ? {} : { sceneId: row.scene_id }),
    state: row.state,
    updatedAt: iso(row.updated_at),
    version: row.version,
  });
}

function mapScene(row: SceneRow): SceneRecord {
  return sceneRecordSchema.parse({
    artifact: {
      byteSize: row.artifact_byte_size,
      glbSha256: row.artifact_glb_sha256,
      id: row.artifact_id,
      manifestSha256: row.artifact_manifest_sha256,
      mimeType: row.artifact_mime_type,
      schemaVersion: row.artifact_schema_version,
    },
    createdAt: iso(row.created_at),
    createdBy: row.created_by,
    id: row.id,
    manifest: row.manifest_payload,
    projectId: row.project_id,
  });
}

function nextTimestamp(clock: SceneClock, previous?: Date | string): Date {
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

function notFound(): ApiError {
  return new ApiError({
    code: "NOT_FOUND",
    detail: "The requested resource was not found.",
    statusCode: 404,
    title: "Not Found",
  });
}

function versionConflict(job: SceneJob): ApiError {
  return sceneConflict(
    "SCENE_JOB_VERSION_CONFLICT",
    `The scene job changed and is now version ${String(job.version)}. Reload before retrying.`,
  );
}

function validateWorker(workerId: string): void {
  if (!workerPattern.test(workerId)) {
    throw sceneConflict("SCENE_WORKER_INVALID", "The worker identity is outside the safe format.");
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
  uuid: SceneUuidFactory,
  input: {
    readonly action: string;
    readonly actorUserId?: string;
    readonly correlation?: { readonly requestId: string; readonly traceId: string };
    readonly jobId: string;
    readonly metadata: object;
    readonly occurredAt: Date;
    readonly outbox?: boolean;
    readonly projectId: string;
    readonly sceneId?: string;
    readonly tenantId: string;
    readonly workerId?: string;
  },
): Promise<void> {
  const requestId = input.correlation?.requestId ?? `worker:${input.workerId ?? "scene-system"}`;
  const traceId =
    input.correlation?.traceId ??
    workerTraceId(input.workerId ?? "scene-system", input.action, input.jobId, input.occurredAt);
  await transaction`
    INSERT INTO scene_audit_events (
      id, tenant_id, project_id, job_id, scene_id, action, actor_user_id, worker_id,
      request_id, trace_id, metadata, occurred_at
    ) VALUES (
      ${uuid.randomUUID()}::uuid, ${input.tenantId}::uuid, ${input.projectId}::uuid,
      ${input.jobId}::uuid, ${input.sceneId ?? null}::uuid, ${input.action},
      ${input.actorUserId ?? null}::uuid, ${input.workerId ?? null}, ${requestId}, ${traceId},
      ${transaction.json(json(input.metadata))}, ${input.occurredAt}
    )
  `;
  if (input.outbox === false) return;
  await transaction`
    INSERT INTO scene_outbox (
      id, tenant_id, project_id, job_id, event_type, schema_version, payload, occurred_at
    ) VALUES (
      ${uuid.randomUUID()}::uuid, ${input.tenantId}::uuid, ${input.projectId}::uuid,
      ${input.jobId}::uuid, ${input.action}, 'c10-scene-job-v1',
      ${transaction.json(json(input.metadata))}, ${input.occurredAt}
    )
  `;
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
    row?.state === "cancel-requested" &&
    row.attempt === command.attempt &&
    row.project_id === command.projectId &&
    row.tenant_id === command.tenantId &&
    row.lease_owner === command.workerId &&
    row.lease_token === command.leaseToken
  ) {
    throw sceneConflict(
      "SCENE_CANCELLATION_REQUESTED",
      "Cancellation was requested for this leased scene attempt.",
    );
  }
  if (
    row === undefined ||
    row.attempt !== command.attempt ||
    row.project_id !== command.projectId ||
    row.tenant_id !== command.tenantId ||
    row.state !== "leased" ||
    row.lease_owner !== command.workerId ||
    row.lease_token !== command.leaseToken ||
    row.lease_expires_at === null ||
    new Date(row.lease_expires_at).getTime() <= now.getTime()
  ) {
    throw sceneConflict(
      "SCENE_LEASE_FENCED",
      "This scene lease is stale, expired, cancelled, or owned by another worker.",
    );
  }
  return row;
}

async function snapshotStillCommitted(transaction: TransactionSql, job: JobRow): Promise<boolean> {
  const rows = await transaction<{ readonly committed: boolean }[]>`
    SELECT c10_snapshot_is_committed(
      ${job.tenant_id}::uuid, ${job.project_id}::uuid, ${job.source_model_id}::uuid,
      ${job.source_profile}, ${job.source_snapshot_id}::uuid, ${job.source_snapshot_sha256}
    ) AS committed
  `;
  return rows[0]?.committed === true;
}

export class PostgresSceneRepository implements SceneRepository {
  readonly #clock: SceneClock;
  readonly #sql: Sql;
  readonly #uuid: SceneUuidFactory;

  constructor(
    sql: Sql,
    options: { readonly clock?: SceneClock; readonly uuid?: SceneUuidFactory } = {},
  ) {
    this.#sql = sql;
    this.#clock = options.clock ?? systemClock;
    this.#uuid = options.uuid ?? systemUuid;
  }

  async createJob(command: CreateSceneJobCommand) {
    return this.#sql.begin(async (transaction) => {
      const claim = actorClaim(command, "scene.job.create", {
        projectId: command.projectId,
        request: command.request,
      });
      const idempotency = await claimIdempotency(transaction, claim);
      if (idempotency.kind === "replay") {
        return { job: sceneJobSchema.parse(idempotency.body), replayed: true };
      }
      const timestamp = nextTimestamp(this.#clock);
      const jobId = this.#uuid.randomUUID();
      const inserted = await transaction<JobRow[]>`
        INSERT INTO scene_jobs (
          tenant_id, project_id, id, request_payload, request_sha256, cache_key_sha256,
          configuration_sha256, compiler_name, compiler_version, source_model_id,
          source_profile, source_snapshot_id, source_snapshot_sha256, source_schema_version,
          source_snapshot_version, attempt, state, retryable, created_by, created_at,
          updated_at, version
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${command.projectId}::uuid, ${jobId}::uuid,
          ${transaction.json(json(command.request))}, ${command.requestSha256},
          ${command.cacheKeySha256}, ${command.configurationSha256}, ${command.compiler.name},
          ${command.compiler.version}, ${command.request.sourceSnapshot.modelId}::uuid,
          ${command.request.sourceSnapshot.profile}, ${command.request.sourceSnapshot.snapshotId}::uuid,
          ${command.request.sourceSnapshot.snapshotSha256},
          ${command.request.sourceSnapshot.schemaVersion}, ${command.sourceSnapshotVersion},
          1, 'queued', false,
          ${command.actor.userId}::uuid, ${timestamp}, ${timestamp}, 1
        ) ON CONFLICT (tenant_id, project_id, cache_key_sha256) DO NOTHING
        RETURNING *
      `;
      const reused = inserted.length === 0;
      const rows = reused
        ? await transaction<JobRow[]>`
            SELECT * FROM scene_jobs
            WHERE tenant_id = ${command.actor.tenantId}::uuid
              AND project_id = ${command.projectId}::uuid
              AND cache_key_sha256 = ${command.cacheKeySha256}
            LIMIT 1
          `
        : inserted;
      const row = rows[0];
      if (row === undefined) throw new Error("Scene cache claim returned no durable job.");
      if (!reused) {
        await transaction`
          INSERT INTO scene_attempts (
            tenant_id, project_id, job_id, attempt, state, stage, created_at, updated_at
          ) VALUES (
            ${command.actor.tenantId}::uuid, ${command.projectId}::uuid, ${jobId}::uuid,
            1, 'queued', 'leased', ${timestamp}, ${timestamp}
          )
        `;
      }
      const job = mapJob(row);
      await appendEvent(transaction, this.#uuid, {
        action: reused ? "scene.job.reuse" : "scene.job.create",
        actorUserId: command.actor.userId,
        correlation: command.correlation,
        jobId: job.id,
        metadata: {
          attempt: job.attempt,
          cacheKeySha256: command.cacheKeySha256,
          configurationSha256: command.configurationSha256,
          snapshotSha256: command.request.sourceSnapshot.snapshotSha256,
          state: job.state,
        },
        occurredAt: timestamp,
        projectId: command.projectId,
        ...(job.sceneId === undefined ? {} : { sceneId: job.sceneId }),
        tenantId: command.actor.tenantId,
      });
      await completeIdempotency(transaction, claim, 201, job);
      return { job, replayed: reused };
    });
  }

  async listJobs(tenantId: string, projectId: string): Promise<readonly SceneJob[]> {
    const rows = await this.#sql<JobRow[]>`
      SELECT * FROM scene_jobs
      WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
      ORDER BY created_at DESC, id LIMIT 100
    `;
    return rows.map(mapJob);
  }

  async findJob(tenantId: string, projectId: string, sceneJobId: string) {
    const rows = await this.#sql<JobRow[]>`
      SELECT * FROM scene_jobs
      WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
        AND id = ${sceneJobId}::uuid LIMIT 1
    `;
    return rows[0] === undefined ? undefined : mapJob(rows[0]);
  }

  async findScene(tenantId: string, projectId: string, sceneJobId: string) {
    const rows = await this.#sql<SceneRow[]>`
      SELECT s.id, s.project_id, s.manifest_payload, s.created_by, s.created_at,
        a.id AS artifact_id, a.schema_version AS artifact_schema_version,
        a.byte_size AS artifact_byte_size, a.glb_sha256 AS artifact_glb_sha256,
        a.manifest_sha256 AS artifact_manifest_sha256, a.mime_type AS artifact_mime_type
      FROM scene_jobs j
      JOIN scenes s ON s.tenant_id = j.tenant_id AND s.project_id = j.project_id
        AND s.id = j.scene_id
      JOIN scene_artifacts a ON a.tenant_id = s.tenant_id AND a.project_id = s.project_id
        AND a.id = s.artifact_id
      WHERE j.tenant_id = ${tenantId}::uuid AND j.project_id = ${projectId}::uuid
        AND j.id = ${sceneJobId}::uuid AND j.state = 'succeeded'
      LIMIT 1
    `;
    return rows[0] === undefined ? undefined : mapScene(rows[0]);
  }

  cancelJob(command: TransitionSceneJobCommand) {
    return this.#transition(command, "cancel");
  }

  retryJob(command: TransitionSceneJobCommand) {
    return this.#transition(command, "retry");
  }

  async #transition(command: TransitionSceneJobCommand, transition: "cancel" | "retry") {
    return this.#sql.begin(async (transaction) => {
      const claim = actorClaim(command, `scene.job.${transition}`, {
        expectedVersion: command.expectedVersion,
        projectId: command.projectId,
        sceneJobId: command.sceneJobId,
      });
      const idempotency = await claimIdempotency(transaction, claim);
      if (idempotency.kind === "replay") {
        return { job: sceneJobSchema.parse(idempotency.body), replayed: true };
      }
      const rows = await transaction<JobRow[]>`
        SELECT * FROM scene_jobs
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid AND id = ${command.sceneJobId}::uuid
        LIMIT 1 FOR UPDATE
      `;
      const row = rows[0];
      if (row === undefined) throw notFound();
      const current = mapJob(row);
      if (current.version !== command.expectedVersion) throw versionConflict(current);
      const timestamp = nextTimestamp(this.#clock, row.updated_at);
      let updatedRows: JobRow[];
      if (transition === "cancel") {
        if (current.state === "queued") {
          await transaction`
            UPDATE scene_attempts SET state = 'cancelled', updated_at = ${timestamp},
              fence_version = fence_version + 1
            WHERE tenant_id = ${command.actor.tenantId}::uuid
              AND project_id = ${command.projectId}::uuid AND job_id = ${command.sceneJobId}::uuid
              AND attempt = ${current.attempt} AND state = 'queued'
          `;
          updatedRows = await transaction<JobRow[]>`
            UPDATE scene_jobs SET state = 'cancelled', retryable = true,
              updated_at = ${timestamp}, version = version + 1
            WHERE tenant_id = ${command.actor.tenantId}::uuid
              AND project_id = ${command.projectId}::uuid AND id = ${command.sceneJobId}::uuid
            RETURNING *
          `;
        } else if (["leased", "compiling", "publishing"].includes(current.state)) {
          await transaction`
            UPDATE scene_attempts SET state = 'cancel-requested', updated_at = ${timestamp},
              fence_version = fence_version + 1
            WHERE tenant_id = ${command.actor.tenantId}::uuid
              AND project_id = ${command.projectId}::uuid AND job_id = ${command.sceneJobId}::uuid
              AND attempt = ${current.attempt} AND state = 'leased'
          `;
          updatedRows = await transaction<JobRow[]>`
            UPDATE scene_jobs SET state = 'cancel-requested', retryable = false,
              updated_at = ${timestamp}, version = version + 1
            WHERE tenant_id = ${command.actor.tenantId}::uuid
              AND project_id = ${command.projectId}::uuid AND id = ${command.sceneJobId}::uuid
            RETURNING *
          `;
        } else if (current.state === "cancel-requested") {
          updatedRows = [row];
        } else {
          throw sceneConflict(
            "SCENE_JOB_NOT_CANCELLABLE",
            "Only queued or active scene work can be cancelled.",
          );
        }
      } else {
        if (
          !["cancelled", "failed"].includes(current.state) ||
          !row.retryable ||
          current.attempt >= c10ScenePolicy.maximumAttempts
        ) {
          throw sceneConflict(
            "SCENE_JOB_NOT_RETRYABLE",
            "This job is not retryable or reached the attempt limit.",
          );
        }
        if (!(await snapshotStillCommitted(transaction, row))) {
          throw sceneConflict(
            "SCENE_SNAPSHOT_MISMATCH",
            "The exact committed source snapshot is no longer eligible for retry.",
          );
        }
        const nextAttempt = current.attempt + 1;
        updatedRows = await transaction<JobRow[]>`
          UPDATE scene_jobs SET attempt = ${nextAttempt}, state = 'queued', scene_id = NULL,
            safe_code = NULL, retryable = false, updated_at = ${timestamp}, version = version + 1
          WHERE tenant_id = ${command.actor.tenantId}::uuid
            AND project_id = ${command.projectId}::uuid AND id = ${command.sceneJobId}::uuid
          RETURNING *
        `;
        await transaction`
          INSERT INTO scene_attempts (
            tenant_id, project_id, job_id, attempt, state, stage, created_at, updated_at
          ) VALUES (
            ${command.actor.tenantId}::uuid, ${command.projectId}::uuid,
            ${command.sceneJobId}::uuid, ${nextAttempt}, 'queued', 'leased',
            ${timestamp}, ${timestamp}
          )
        `;
      }
      const updated = updatedRows[0];
      if (updated === undefined) throw versionConflict(current);
      const job = mapJob(updated);
      await appendEvent(transaction, this.#uuid, {
        action: `scene.job.${transition}`,
        actorUserId: command.actor.userId,
        correlation: command.correlation,
        jobId: command.sceneJobId,
        metadata: { attempt: job.attempt, state: job.state, version: job.version },
        occurredAt: timestamp,
        projectId: command.projectId,
        tenantId: command.actor.tenantId,
      });
      await completeIdempotency(transaction, claim, 200, job);
      return { job, replayed: false };
    });
  }

  async claimNext(command: ClaimSceneAttemptCommand): Promise<LeasedSceneAttempt | undefined> {
    validateWorker(command.workerId);
    const leaseSeconds = command.leaseSeconds ?? 300;
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 3_600) {
      throw sceneConflict("SCENE_LEASE_INVALID", "Lease duration must be 30 through 3600 seconds.");
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
        SELECT j.*, a.state AS attempt_state, a.stage,
          a.updated_at AS attempt_updated_at
        FROM scene_jobs j
        JOIN scene_attempts a ON a.tenant_id = j.tenant_id AND a.project_id = j.project_id
          AND a.job_id = j.id AND a.attempt = j.attempt
        WHERE j.compiler_name = ${command.compiler.name}
          AND j.compiler_version = ${command.compiler.version}
          AND (
            (j.state = 'queued' AND a.state = 'queued')
            OR (
              j.state IN ('leased', 'compiling', 'publishing', 'cancel-requested')
              AND a.state IN ('leased', 'cancel-requested')
              AND a.lease_expires_at <= ${claimAt}
            )
          )
        ORDER BY j.created_at, j.id
        LIMIT 1 FOR UPDATE OF j, a SKIP LOCKED
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
      if (!(await snapshotStillCommitted(transaction, candidate))) {
        await this.#failWithoutLease(
          transaction,
          candidate,
          "SCENE_SOURCE_SNAPSHOT_UNAVAILABLE",
          timestamp,
          command.workerId,
        );
        return undefined;
      }
      const leaseToken = this.#uuid.randomUUID();
      const stage = (candidate.state === "queued" ? "leased" : candidate.stage) as SceneWorkerStage;
      const attempts = await transaction<AttemptRow[]>`
        UPDATE scene_attempts SET state = 'leased', stage = ${stage},
          lease_owner = ${command.workerId}, lease_token = ${leaseToken}::uuid,
          lease_expires_at = ${timestamp} + (${leaseSeconds} * interval '1 second'),
          lease_seconds = ${leaseSeconds}, updated_at = ${timestamp},
          fence_version = fence_version + 1
        WHERE tenant_id = ${candidate.tenant_id}::uuid
          AND project_id = ${candidate.project_id}::uuid AND job_id = ${candidate.id}::uuid
          AND attempt = ${candidate.attempt}
        RETURNING *
      `;
      const jobs = await transaction<JobRow[]>`
        UPDATE scene_jobs SET state = ${stage}, updated_at = ${timestamp}, version = version + 1
        WHERE tenant_id = ${candidate.tenant_id}::uuid
          AND project_id = ${candidate.project_id}::uuid AND id = ${candidate.id}::uuid
          AND attempt = ${candidate.attempt}
        RETURNING *
      `;
      const attempt = attempts[0];
      const job = jobs[0];
      if (attempt === undefined || attempt.lease_expires_at === null || job === undefined) {
        throw new Error("Scene lease update returned no row.");
      }
      await appendEvent(transaction, this.#uuid, {
        action: "scene.job.lease",
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
        cacheKeySha256: candidate.cache_key_sha256,
        compiler: { name: candidate.compiler_name, version: candidate.compiler_version },
        configurationSha256: candidate.configuration_sha256,
        jobId: candidate.id,
        leaseExpiresAt: iso(attempt.lease_expires_at),
        leaseToken,
        projectId: candidate.project_id,
        request: mapJob(job).request,
        stage,
        tenantId: candidate.tenant_id,
      };
    });
  }

  async assertPublicationLease(
    command: Parameters<SceneRepository["assertPublicationLease"]>[0],
  ): Promise<void> {
    validateWorker(command.workerId);
    const rows = await this.#sql<AttemptRow[]>`
      SELECT * FROM scene_attempts
      WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
        AND job_id = ${command.jobId}::uuid AND attempt = ${command.attempt}
      LIMIT 1
    `;
    assertLease(rows[0], command, this.#clock.now());
  }

  async heartbeat(command: HeartbeatSceneAttemptCommand): Promise<SceneJob> {
    validateWorker(command.workerId);
    return this.#sql.begin(async (transaction) => {
      const jobs = await transaction<JobRow[]>`
        SELECT * FROM scene_jobs
        WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND id = ${command.jobId}::uuid
        LIMIT 1 FOR UPDATE
      `;
      const job = jobs[0];
      if (job === undefined || job.attempt !== command.attempt) {
        throw sceneConflict("SCENE_LEASE_FENCED", "A newer attempt owns this scene job.");
      }
      const attempts = await transaction<AttemptRow[]>`
        SELECT * FROM scene_attempts
        WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND job_id = ${command.jobId}::uuid AND attempt = ${command.attempt}
        LIMIT 1 FOR UPDATE
      `;
      const attempt = assertLease(attempts[0], command, this.#clock.now());
      const allowed: Readonly<Record<SceneWorkerStage, readonly SceneWorkerStage[]>> = {
        leased: ["leased", "compiling"],
        compiling: ["compiling", "publishing"],
        publishing: ["publishing"],
      };
      const currentStage = attempt.stage as SceneWorkerStage;
      if (!allowed[currentStage].includes(command.stage)) {
        throw sceneConflict(
          "SCENE_STAGE_INVALID",
          "The worker attempted to skip or reverse a scene compilation stage.",
        );
      }
      const timestamp = nextTimestamp(this.#clock, attempt.updated_at);
      const leaseSeconds = attempt.lease_seconds ?? 300;
      await transaction`
        UPDATE scene_attempts SET stage = ${command.stage},
          lease_expires_at = ${timestamp} + (${leaseSeconds} * interval '1 second'),
          updated_at = ${timestamp}, fence_version = fence_version + 1
        WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND job_id = ${command.jobId}::uuid AND attempt = ${command.attempt}
      `;
      const updated = await transaction<JobRow[]>`
        UPDATE scene_jobs SET state = ${command.stage}, updated_at = ${timestamp},
          version = version + 1
        WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND id = ${command.jobId}::uuid AND attempt = ${command.attempt}
        RETURNING *
      `;
      const row = updated[0];
      if (row === undefined) {
        throw sceneConflict("SCENE_LEASE_FENCED", "A newer attempt owns this scene job.");
      }
      await appendEvent(transaction, this.#uuid, {
        action: "scene.job.heartbeat",
        jobId: command.jobId,
        metadata: { attempt: command.attempt, stage: command.stage },
        occurredAt: timestamp,
        projectId: command.projectId,
        tenantId: command.tenantId,
        workerId: command.workerId,
      });
      return mapJob(row);
    });
  }

  async publishScene(command: PersistScenePublicationCommand): Promise<SceneJob> {
    validateWorker(command.workerId);
    return this.#sql.begin(async (transaction) => {
      const jobs = await transaction<JobRow[]>`
        SELECT * FROM scene_jobs
        WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND id = ${command.jobId}::uuid
        LIMIT 1 FOR UPDATE
      `;
      const job = jobs[0];
      if (job === undefined || job.attempt !== command.attempt) {
        throw sceneConflict("SCENE_LEASE_FENCED", "A newer attempt owns this scene job.");
      }
      const attempts = await transaction<AttemptRow[]>`
        SELECT * FROM scene_attempts
        WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND job_id = ${command.jobId}::uuid AND attempt = ${command.attempt}
        LIMIT 1 FOR UPDATE
      `;
      const attempt = assertLease(attempts[0], command, this.#clock.now());
      if (job.state !== "publishing" || attempt.stage !== "publishing") {
        throw sceneConflict(
          "SCENE_PUBLICATION_STAGE_INVALID",
          "A scene can publish only from the fenced publishing stage.",
        );
      }
      if (!(await snapshotStillCommitted(transaction, job))) {
        const timestamp = nextTimestamp(this.#clock, attempt.updated_at);
        await this.#failLeased(
          transaction,
          attempt,
          job,
          "SCENE_SOURCE_SNAPSHOT_UNAVAILABLE",
          false,
          timestamp,
          command.workerId,
        );
        const failed = await transaction<JobRow[]>`
          SELECT * FROM scene_jobs
          WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
            AND id = ${command.jobId}::uuid LIMIT 1
        `;
        const failedRow = failed[0];
        if (failedRow === undefined) throw new Error("Scene source failure returned no job.");
        return mapJob(failedRow);
      }
      if (
        command.manifest.sourceSnapshot.modelId !== job.source_model_id ||
        command.manifest.sourceSnapshot.profile !== job.source_profile ||
        command.manifest.sourceSnapshot.snapshotId !== job.source_snapshot_id ||
        command.manifest.sourceSnapshot.snapshotSha256 !== job.source_snapshot_sha256 ||
        command.manifest.compiler.configurationSha256 !== job.configuration_sha256 ||
        command.manifest.compiler.version !== job.compiler_version ||
        command.manifest.determinismKeySha256 !== job.cache_key_sha256
      ) {
        throw sceneConflict(
          "SCENE_PUBLICATION_SCOPE_MISMATCH",
          "The scene publication does not match the exact leased cache identity.",
        );
      }
      const timestamp = nextTimestamp(this.#clock, attempt.updated_at);
      const artifactId = this.#uuid.randomUUID();
      const sceneId = this.#uuid.randomUUID();
      await transaction`
        INSERT INTO scene_artifacts (
          tenant_id, project_id, id, schema_version, byte_size, glb_sha256,
          manifest_sha256, mime_type, created_at
        ) VALUES (
          ${command.tenantId}::uuid, ${command.projectId}::uuid, ${artifactId}::uuid,
          'c10-scene-artifact-v1', ${command.artifact.byteSize},
          ${command.artifact.glbSha256}, ${command.artifact.manifestSha256},
          ${command.artifact.mimeType}, ${timestamp}
        )
      `;
      await transaction`
        INSERT INTO scenes (
          tenant_id, project_id, id, publishing_job_id, publishing_attempt, artifact_id,
          cache_key_sha256, source_model_id, source_profile, source_snapshot_id,
          source_snapshot_sha256, source_snapshot_version, manifest_payload, created_by, created_at
        ) VALUES (
          ${command.tenantId}::uuid, ${command.projectId}::uuid, ${sceneId}::uuid,
          ${command.jobId}::uuid, ${command.attempt}, ${artifactId}::uuid,
          ${job.cache_key_sha256}, ${job.source_model_id}::uuid, ${job.source_profile},
          ${job.source_snapshot_id}::uuid, ${job.source_snapshot_sha256},
          ${job.source_snapshot_version}, ${transaction.json(json(command.manifest))},
          ${job.created_by}::uuid, ${timestamp}
        )
      `;
      await transaction`
        INSERT INTO scene_cache_entries (
          tenant_id, project_id, cache_key_sha256, scene_id, source_snapshot_sha256,
          configuration_sha256, compiler_name, compiler_version, created_at
        ) VALUES (
          ${command.tenantId}::uuid, ${command.projectId}::uuid, ${job.cache_key_sha256},
          ${sceneId}::uuid, ${job.source_snapshot_sha256}, ${job.configuration_sha256},
          ${job.compiler_name}, ${job.compiler_version}, ${timestamp}
        )
      `;
      await transaction`
        UPDATE scene_attempts SET state = 'succeeded', lease_owner = NULL, lease_token = NULL,
          lease_expires_at = NULL, lease_seconds = NULL, updated_at = ${timestamp},
          fence_version = fence_version + 1
        WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND job_id = ${command.jobId}::uuid AND attempt = ${command.attempt}
      `;
      const updated = await transaction<JobRow[]>`
        UPDATE scene_jobs SET state = 'succeeded', scene_id = ${sceneId}::uuid,
          retryable = false, safe_code = NULL, updated_at = ${timestamp}, version = version + 1
        WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND id = ${command.jobId}::uuid AND attempt = ${command.attempt}
        RETURNING *
      `;
      const row = updated[0];
      if (row === undefined) throw new Error("Scene publication returned no job.");
      await appendEvent(transaction, this.#uuid, {
        action: "scene.job.publish",
        jobId: command.jobId,
        metadata: {
          attempt: command.attempt,
          byteSize: command.artifact.byteSize,
          findingCount: command.manifest.findings.length,
          glbSha256: command.artifact.glbSha256,
          manifestSha256: command.artifact.manifestSha256,
          mappedElementCount: command.manifest.elementMappings.filter(
            ({ status }) => status === "mapped",
          ).length,
          sceneId,
          triangleCount: command.manifest.counts.triangles,
          vertexCount: command.manifest.counts.vertices,
        },
        occurredAt: timestamp,
        projectId: command.projectId,
        sceneId,
        tenantId: command.tenantId,
        workerId: command.workerId,
      });
      return mapJob(row);
    });
  }

  async failAttempt(command: FailSceneAttemptCommand): Promise<SceneJob> {
    validateWorker(command.workerId);
    if (!safeCodePattern.test(command.safeCode)) {
      throw sceneConflict("SCENE_SAFE_CODE_INVALID", "The worker safe code is invalid.");
    }
    return this.#sql.begin(async (transaction) => {
      const jobs = await transaction<JobRow[]>`
        SELECT * FROM scene_jobs
        WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND id = ${command.jobId}::uuid
        LIMIT 1 FOR UPDATE
      `;
      const job = jobs[0];
      if (job === undefined || job.attempt !== command.attempt) {
        throw sceneConflict("SCENE_LEASE_FENCED", "A newer attempt owns this scene job.");
      }
      const attempts = await transaction<AttemptRow[]>`
        SELECT * FROM scene_attempts
        WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND job_id = ${command.jobId}::uuid AND attempt = ${command.attempt}
        LIMIT 1 FOR UPDATE
      `;
      const attempt = assertLease(attempts[0], command, this.#clock.now());
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
        SELECT * FROM scene_jobs
        WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND id = ${command.jobId}::uuid LIMIT 1
      `;
      const row = rows[0];
      if (row === undefined) throw new Error("Scene failure returned no job.");
      return mapJob(row);
    });
  }

  async acknowledgeCancellation(command: AcknowledgeSceneCancellationCommand): Promise<void> {
    validateWorker(command.workerId);
    await this.#sql.begin(async (transaction) => {
      const jobs = await transaction<JobRow[]>`
        SELECT * FROM scene_jobs
        WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND id = ${command.jobId}::uuid
        LIMIT 1 FOR UPDATE
      `;
      const job = jobs[0];
      if (job === undefined || job.attempt !== command.attempt) {
        throw sceneConflict("SCENE_LEASE_FENCED", "A newer attempt owns this scene job.");
      }
      const attempts = await transaction<AttemptRow[]>`
        SELECT * FROM scene_attempts
        WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND job_id = ${command.jobId}::uuid AND attempt = ${command.attempt}
        LIMIT 1 FOR UPDATE
      `;
      const attempt = attempts[0];
      const now = this.#clock.now();
      if (
        attempt === undefined ||
        attempt.state !== "cancel-requested" ||
        job.state !== "cancel-requested" ||
        attempt.lease_owner !== command.workerId ||
        attempt.lease_token !== command.leaseToken ||
        attempt.lease_expires_at === null ||
        new Date(attempt.lease_expires_at).getTime() <= now.getTime()
      ) {
        throw sceneConflict(
          "SCENE_LEASE_FENCED",
          "Only the current worker can acknowledge scene cancellation.",
        );
      }
      const timestamp = nextTimestamp(this.#clock, attempt.updated_at);
      await this.#cancelAttempt(transaction, job, command.workerId, timestamp);
    });
  }

  async recordAccess(command: RecordSceneAccessCommand): Promise<void> {
    await this.#sql.begin(async (transaction) => {
      const rows = await transaction<{ readonly id: string }[]>`
        SELECT j.id FROM scene_jobs j
        JOIN scenes s ON s.tenant_id = j.tenant_id AND s.project_id = j.project_id
          AND s.id = j.scene_id
        WHERE j.tenant_id = ${command.actor.tenantId}::uuid
          AND j.project_id = ${command.projectId}::uuid AND j.id = ${command.jobId}::uuid
          AND j.state = 'succeeded' AND s.id = ${command.sceneId}::uuid
        LIMIT 1 FOR SHARE OF j, s
      `;
      if (rows.length !== 1) throw notFound();
      await appendEvent(transaction, this.#uuid, {
        action: "scene.artifact.access",
        actorUserId: command.actor.userId,
        correlation: command.correlation,
        jobId: command.jobId,
        metadata: { accessTtlSeconds: c10ScenePolicy.accessTtlSeconds, sceneId: command.sceneId },
        occurredAt: nextTimestamp(this.#clock),
        outbox: false,
        projectId: command.projectId,
        sceneId: command.sceneId,
        tenantId: command.actor.tenantId,
      });
    });
  }

  async #cancelAttempt(
    transaction: TransactionSql,
    job: JobRow,
    workerId: string,
    timestamp: Date,
  ): Promise<void> {
    await transaction`
      UPDATE scene_attempts SET state = 'cancelled', lease_owner = NULL, lease_token = NULL,
        lease_expires_at = NULL, lease_seconds = NULL, updated_at = ${timestamp},
        fence_version = fence_version + 1
      WHERE tenant_id = ${job.tenant_id}::uuid AND project_id = ${job.project_id}::uuid
        AND job_id = ${job.id}::uuid AND attempt = ${job.attempt}
    `;
    await transaction`
      UPDATE scene_jobs SET state = 'cancelled', retryable = true,
        updated_at = ${timestamp}, version = version + 1
      WHERE tenant_id = ${job.tenant_id}::uuid AND project_id = ${job.project_id}::uuid
        AND id = ${job.id}::uuid AND attempt = ${job.attempt}
    `;
    await appendEvent(transaction, this.#uuid, {
      action: "scene.job.cancelled",
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
      UPDATE scene_attempts SET state = 'failed', updated_at = ${timestamp},
        fence_version = fence_version + 1
      WHERE tenant_id = ${job.tenant_id}::uuid AND project_id = ${job.project_id}::uuid
        AND job_id = ${job.id}::uuid AND attempt = ${job.attempt}
    `;
    await transaction`
      UPDATE scene_jobs SET state = 'failed', retryable = false, safe_code = ${safeCode},
        updated_at = ${timestamp}, version = version + 1
      WHERE tenant_id = ${job.tenant_id}::uuid AND project_id = ${job.project_id}::uuid
        AND id = ${job.id}::uuid AND attempt = ${job.attempt}
    `;
    await appendEvent(transaction, this.#uuid, {
      action: "scene.job.fail",
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
    const retryable = requestedRetryable && attempt.attempt < c10ScenePolicy.maximumAttempts;
    await transaction`
      UPDATE scene_attempts SET state = 'failed', lease_owner = NULL, lease_token = NULL,
        lease_expires_at = NULL, lease_seconds = NULL, updated_at = ${timestamp},
        fence_version = fence_version + 1
      WHERE tenant_id = ${attempt.tenant_id}::uuid AND project_id = ${attempt.project_id}::uuid
        AND job_id = ${job.id}::uuid AND attempt = ${attempt.attempt}
    `;
    await transaction`
      UPDATE scene_jobs SET state = 'failed', retryable = ${retryable}, safe_code = ${safeCode},
        updated_at = ${timestamp}, version = version + 1
      WHERE tenant_id = ${attempt.tenant_id}::uuid AND project_id = ${attempt.project_id}::uuid
        AND id = ${job.id}::uuid AND attempt = ${attempt.attempt}
    `;
    await appendEvent(transaction, this.#uuid, {
      action: "scene.job.fail",
      jobId: job.id,
      metadata: { attempt: attempt.attempt, retryable, safeCode },
      occurredAt: timestamp,
      projectId: attempt.project_id,
      tenantId: attempt.tenant_id,
      workerId,
    });
  }
}
