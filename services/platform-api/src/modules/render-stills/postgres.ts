import {
  enhancementResultSchema,
  renderArtifactSchema,
  renderJobSchema,
  renderOutputManifestSchema,
  renderResultSchema,
  renderSourceReferenceSchema,
  type RenderJob,
} from "@interior-design/contracts";
import { createHash, randomUUID } from "node:crypto";
import type { JSONValue, Sql, TransactionSql } from "postgres";

import { notFound } from "../identity/http.js";
import { renderConflict } from "./errors.js";
import type {
  AcknowledgeRenderCancellationCommand,
  ClaimRenderJobCommand,
  CreateRenderJobCommand,
  FailRenderJobCommand,
  HeartbeatRenderJobCommand,
  LeasedRenderJob,
  PublishRenderResultCommand,
  RecordArtifactAccessCommand,
  RenderClock,
  RenderEnhancementRecord,
  RenderRepository,
  RenderUuidFactory,
  RequestEnhancementCommand,
  StoredRenderArtifact,
  TransitionRenderJobCommand,
} from "./types.js";

interface JobRow {
  readonly attempt: number;
  readonly cache_identity_sha256: string;
  readonly created_at: Date | string;
  readonly created_by: string;
  readonly estimated_job_bytes: number | string;
  readonly id: string;
  readonly project_id: string;
  readonly publication_result_id: string;
  readonly request_payload: unknown;
  readonly result_id: string | null;
  readonly retryable: boolean;
  readonly safe_code: string | null;
  readonly source_payload: unknown;
  readonly state: string;
  readonly tenant_id: string;
  readonly updated_at: Date | string;
  readonly version: number;
}

interface AttemptHeadRow {
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

interface ResultRow {
  readonly created_at: Date | string;
  readonly created_by: string;
  readonly id: string;
  readonly job_id: string;
  readonly manifest_payload: unknown;
  readonly manifest_sha256: string;
  readonly project_id: string;
}

interface ArtifactRow {
  readonly byte_length: number | string;
  readonly height_px: number;
  readonly id: string;
  readonly manifest_sha256: string;
  readonly media_type: string;
  readonly object_key: string;
  readonly result_id: string;
  readonly role: string;
  readonly schema_version: string;
  readonly sha256: string;
  readonly width_px: number;
}

interface EffectRow {
  readonly operation: string;
  readonly project_id: string;
  readonly request_sha256: string;
  readonly response_payload: unknown;
}

interface EnhancementRow {
  readonly attempt: number;
  readonly base_artifact_sha256: string;
  readonly created_at: Date | string;
  readonly created_by: string;
  readonly id: string;
  readonly project_id: string;
  readonly render_job_id: string;
  readonly result_payload?: unknown;
  readonly safe_code: string | null;
  readonly state: RenderEnhancementRecord["state"];
  readonly updated_at: Date | string;
  readonly version: number;
}

interface ClaimRow {
  readonly attempt: number;
  readonly cache_identity_sha256: string;
  readonly estimated_job_bytes: number | string;
  readonly job_id: string;
  readonly lease_expires_at: Date | string;
  readonly lease_token: string;
  readonly project_id: string;
  readonly publication_result_id: string;
  readonly request_payload: unknown;
  readonly required_capability: string;
  readonly source_payload: unknown;
  readonly stage: string;
  readonly tenant_id: string;
  readonly volume_id: string;
}

const systemClock: RenderClock = { now: () => new Date() };
const systemUuid: RenderUuidFactory = { randomUUID };
const workerPattern = /^[A-Za-z0-9_.:-]{3,100}$/u;
const volumePattern = /^[A-Za-z0-9_.:-]{3,120}$/u;
const capabilityPattern = /^[A-Za-z0-9_.:+-]{3,120}$/u;
const safeCodePattern = /^[A-Z][A-Z0-9_]{2,79}$/u;

function json(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function later(clock: RenderClock, previous?: Date | string): Date {
  const candidate = clock.now();
  if (previous === undefined) return candidate;
  return new Date(Math.max(candidate.getTime(), new Date(previous).getTime() + 1));
}

function mapJob(row: JobRow): RenderJob {
  return renderJobSchema.parse({
    attempt: row.attempt,
    createdAt: iso(row.created_at),
    createdBy: row.created_by,
    id: row.id,
    projectId: row.project_id,
    request: row.request_payload,
    ...(row.result_id === null ? {} : { resultId: row.result_id }),
    ...(row.safe_code === null ? {} : { safeCode: row.safe_code }),
    state: row.state,
    updatedAt: iso(row.updated_at),
    version: row.version,
  });
}

function mapResult(row: ResultRow) {
  return renderResultSchema.parse({
    createdAt: iso(row.created_at),
    createdBy: row.created_by,
    id: row.id,
    jobId: row.job_id,
    manifest: row.manifest_payload,
    manifestSha256: row.manifest_sha256,
    projectId: row.project_id,
  });
}

function mapArtifact(row: ArtifactRow): StoredRenderArtifact {
  return {
    artifact: renderArtifactSchema.parse({
      byteLength: Number(row.byte_length),
      heightPx: row.height_px,
      id: row.id,
      mediaType: row.media_type,
      role: row.role,
      schemaVersion: row.schema_version,
      sha256: row.sha256,
      widthPx: row.width_px,
    }),
    manifestSha256: row.manifest_sha256,
    objectKey: row.object_key,
    resultId: row.result_id,
  };
}

function mapEnhancement(row: EnhancementRow): RenderEnhancementRecord {
  return {
    attempt: row.attempt,
    baseArtifactSha256: row.base_artifact_sha256,
    createdAt: iso(row.created_at),
    createdBy: row.created_by,
    id: row.id,
    projectId: row.project_id,
    renderJobId: row.render_job_id,
    ...(row.result_payload == null
      ? {}
      : { result: enhancementResultSchema.parse(row.result_payload) }),
    ...(row.safe_code === null ? {} : { safeCode: row.safe_code }),
    state: row.state,
    updatedAt: iso(row.updated_at),
    version: row.version,
  };
}

async function setTenant(transaction: TransactionSql, tenantId: string): Promise<void> {
  await transaction`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
}

function trace(workerId: string, action: string, jobId: string, timestamp: Date): string {
  return createHash("sha256")
    .update(`${workerId}:${action}:${jobId}:${timestamp.toISOString()}`)
    .digest("hex")
    .slice(0, 32);
}

async function appendEvent(
  transaction: TransactionSql,
  uuid: RenderUuidFactory,
  input: {
    readonly action: string;
    readonly actorUserId?: string;
    readonly correlation?: { readonly requestId: string; readonly traceId: string };
    readonly jobId: string;
    readonly metadata: Readonly<Record<string, boolean | number | string>>;
    readonly occurredAt: Date;
    readonly projectId: string;
    readonly resultId?: string;
    readonly tenantId: string;
    readonly workerId?: string;
  },
): Promise<void> {
  const workerId = input.workerId ?? "render-system";
  await transaction`
    INSERT INTO render_audit_events (
      id, tenant_id, project_id, job_id, result_id, action, actor_user_id, worker_id,
      request_id, trace_id, metadata, occurred_at
    ) VALUES (
      ${uuid.randomUUID()}::uuid, ${input.tenantId}::uuid, ${input.projectId}::uuid,
      ${input.jobId}::uuid, ${input.resultId ?? null}::uuid, ${input.action},
      ${input.actorUserId ?? null}::uuid, ${input.workerId ?? null},
      ${input.correlation?.requestId ?? `worker:${workerId}`},
      ${input.correlation?.traceId ?? trace(workerId, input.action, input.jobId, input.occurredAt)},
      ${transaction.json(json(input.metadata))}, ${input.occurredAt}
    )
  `;
  await transaction`
    INSERT INTO render_outbox (
      id, tenant_id, project_id, job_id, event_type, schema_version, payload, occurred_at
    ) VALUES (
      ${uuid.randomUUID()}::uuid, ${input.tenantId}::uuid, ${input.projectId}::uuid,
      ${input.jobId}::uuid, ${input.action}, 'c14-render-job-v1',
      ${transaction.json(json(input.metadata))}, ${input.occurredAt}
    )
  `;
}

function effectRequestSha256(operation: string, body: unknown): string {
  return createHash("sha256").update(JSON.stringify({ body, operation })).digest("hex");
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
    INSERT INTO render_idempotency_effects (
      tenant_id, project_id, idempotency_key, actor_user_id, operation,
      request_sha256, created_at
    ) VALUES (
      ${input.tenantId}::uuid, ${input.projectId}::uuid, ${input.idempotencyKey},
      ${input.actorUserId}::uuid, ${input.operation}, ${input.requestSha256}, clock_timestamp()
    ) ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
  `;
  const rows = await transaction<EffectRow[]>`
    SELECT operation, project_id, request_sha256, response_payload
    FROM render_idempotency_effects
    WHERE tenant_id = ${input.tenantId}::uuid AND idempotency_key = ${input.idempotencyKey}
    FOR UPDATE
  `;
  const row = rows[0];
  if (row === undefined) throw new Error("Render idempotency claim disappeared.");
  if (
    row.operation !== input.operation ||
    row.project_id !== input.projectId ||
    row.request_sha256 !== input.requestSha256
  ) {
    throw renderConflict(
      "RENDER_IDEMPOTENCY_CONFLICT",
      "The idempotency key belongs to a different exact request.",
    );
  }
  return row.response_payload === null ? undefined : row;
}

async function completeEffect(
  transaction: TransactionSql,
  tenantId: string,
  idempotencyKey: string,
  status: 200 | 201,
  response: unknown,
): Promise<void> {
  const rows = await transaction<{ readonly idempotency_key: string }[]>`
    UPDATE render_idempotency_effects SET response_payload = ${transaction.json(json(response))},
      response_status = ${status}, completed_at = clock_timestamp()
    WHERE tenant_id = ${tenantId}::uuid AND idempotency_key = ${idempotencyKey}
      AND completed_at IS NULL RETURNING idempotency_key
  `;
  if (rows.length !== 1) throw new Error("Render idempotency completion lost its fence.");
}

function validateWorker(workerId: string): void {
  if (!workerPattern.test(workerId))
    throw renderConflict("RENDER_WORKER_INVALID", "The render worker identity is invalid.");
}

function validateLease(
  row: AttemptHeadRow | undefined,
  command: {
    readonly attempt: number;
    readonly jobId: string;
    readonly leaseToken: string;
    readonly projectId: string;
    readonly tenantId: string;
    readonly workerId: string;
  },
): AttemptHeadRow {
  const matchingLiveFence =
    row !== undefined &&
    row.tenant_id === command.tenantId &&
    row.project_id === command.projectId &&
    row.attempt === command.attempt &&
    row.lease_owner === command.workerId &&
    row.lease_token === command.leaseToken &&
    row.lease_expires_at !== null;
  if (matchingLiveFence && row.state === "cancel-requested") {
    throw renderConflict(
      "RENDER_CANCELLATION_REQUESTED",
      "The active render lease has been cancelled.",
    );
  }
  if (row === undefined || !matchingLiveFence || row.state !== "leased") {
    throw renderConflict(
      "RENDER_LEASE_FENCED",
      "The render lease is stale, expired, cancelled, or owned by another worker.",
    );
  }
  return row;
}

async function loadLease(
  transaction: TransactionSql,
  command: Parameters<typeof validateLease>[1],
  lock: boolean,
): Promise<AttemptHeadRow> {
  const rows = await transaction<AttemptHeadRow[]>`
    SELECT * FROM render_attempt_heads
    WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
      AND job_id = ${command.jobId}::uuid AND attempt = ${command.attempt}
      AND lease_expires_at > clock_timestamp()
    LIMIT 1 ${lock ? transaction`FOR UPDATE` : transaction``}
  `;
  return validateLease(rows[0], command);
}

async function releaseReservation(
  transaction: TransactionSql,
  command: {
    readonly attempt: number;
    readonly jobId: string;
    readonly projectId: string;
    readonly tenantId: string;
  },
  terminalState: "cancelled" | "failed" | "succeeded",
  timestamp: Date,
): Promise<void> {
  await transaction`
    INSERT INTO render_disk_reservation_releases (
      reservation_id, tenant_id, project_id, job_id, attempt, terminal_state, released_at
    ) SELECT r.id, r.tenant_id, r.project_id, r.job_id, r.attempt, ${terminalState}, ${timestamp}
      FROM render_disk_reservations r
      LEFT JOIN render_disk_reservation_releases released ON released.reservation_id = r.id
      WHERE r.tenant_id = ${command.tenantId}::uuid AND r.project_id = ${command.projectId}::uuid
        AND r.job_id = ${command.jobId}::uuid AND r.attempt = ${command.attempt}
        AND released.reservation_id IS NULL
    ON CONFLICT (reservation_id) DO NOTHING
  `;
}

async function ensureEnhancementChild(
  transaction: TransactionSql,
  uuid: RenderUuidFactory,
  input: { readonly jobId: string; readonly projectId: string; readonly tenantId: string },
  timestamp: Date,
): Promise<void> {
  await transaction`
    INSERT INTO render_enhancement_jobs (
      tenant_id, project_id, id, render_job_id, base_result_id, base_artifact_sha256,
      attempt, state, safe_code, created_by, created_at, updated_at, version
    )
    SELECT j.tenant_id, j.project_id, ${uuid.randomUUID()}::uuid, j.id, r.id, a.sha256,
      1,
      CASE
        WHEN j.enhancement_provider_enabled
          AND j.request_payload ->> 'enhancement' = 'optional-provider' THEN 'queued'
        ELSE 'disabled'
      END,
      CASE
        WHEN j.enhancement_provider_enabled
          AND j.request_payload ->> 'enhancement' = 'optional-provider' THEN NULL
        ELSE 'ENHANCEMENT_DISABLED'
      END,
      j.created_by, ${timestamp}, ${timestamp}, 1
    FROM render_jobs j
    JOIN render_results r ON r.tenant_id = j.tenant_id AND r.project_id = j.project_id
      AND r.id = j.result_id
    JOIN render_artifacts a ON a.tenant_id = r.tenant_id AND a.project_id = r.project_id
      AND a.result_id = r.id AND a.role = 'geometry-safe-png'
    WHERE j.tenant_id = ${input.tenantId}::uuid AND j.project_id = ${input.projectId}::uuid
      AND j.id = ${input.jobId}::uuid AND j.state = 'succeeded'
    ON CONFLICT (tenant_id, project_id, render_job_id) DO NOTHING
  `;
}

export class PostgresRenderRepository implements RenderRepository {
  readonly #clock: RenderClock;
  readonly #sql: Sql;
  readonly #uuid: RenderUuidFactory;

  constructor(
    sql: Sql,
    options: { readonly clock?: RenderClock; readonly uuid?: RenderUuidFactory } = {},
  ) {
    this.#sql = sql;
    this.#clock = options.clock ?? systemClock;
    this.#uuid = options.uuid ?? systemUuid;
  }

  async #withTenant<T>(
    tenantId: string,
    operation: (transaction: TransactionSql) => Promise<T>,
  ): Promise<T> {
    return (await this.#sql.begin(async (transaction) => {
      await setTenant(transaction, tenantId);
      return operation(transaction);
    })) as T;
  }

  createJob(command: CreateRenderJobCommand) {
    return this.#withTenant(command.actor.tenantId, async (transaction) => {
      const effect = await claimEffect(transaction, {
        actorUserId: command.actor.userId,
        idempotencyKey: command.idempotencyKey,
        operation: "render.job.create",
        projectId: command.projectId,
        requestSha256: command.requestSha256,
        tenantId: command.actor.tenantId,
      });
      if (effect !== undefined)
        return { job: renderJobSchema.parse(effect.response_payload), replayed: true };
      const existing = await transaction<JobRow[]>`
        SELECT * FROM render_jobs
        WHERE tenant_id = ${command.actor.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND cache_identity_sha256 = ${command.cacheIdentitySha256}
        LIMIT 1 FOR UPDATE
      `;
      if (existing[0] !== undefined) {
        const job = mapJob(existing[0]);
        await completeEffect(transaction, command.actor.tenantId, command.idempotencyKey, 201, job);
        return { job, replayed: true };
      }
      const timestamp = later(this.#clock);
      const jobId = command.requestedJobId ?? this.#uuid.randomUUID();
      const publicationResultId = this.#uuid.randomUUID();
      const specification = command.resolved.source.specification;
      const rows = await transaction<JobRow[]>`
        INSERT INTO render_jobs (
          tenant_id, project_id, id, request_payload, request_sha256, cache_identity_sha256,
          source_payload, source_scene_job_id, source_scene_id, source_scene_artifact_id,
          source_scene_glb_sha256, source_scene_manifest_sha256, source_snapshot_sha256,
          specification_id, specification_revision, specification_revision_sha256,
          catalog_release_id, catalog_release_sha256, required_capability, estimated_job_bytes,
          enhancement_provider_enabled, publication_result_id, attempt, state, retryable,
          created_by, created_at, updated_at, version
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${command.projectId}::uuid, ${jobId}::uuid,
          ${transaction.json(json(command.request))}, ${command.requestSha256},
          ${command.cacheIdentitySha256}, ${transaction.json(json(command.resolved.source))},
          ${command.resolved.source.sceneJobId}::uuid, ${command.resolved.source.sceneId}::uuid,
          ${command.resolved.source.sceneArtifactId}::uuid, ${command.resolved.source.sceneGlbSha256},
          ${command.resolved.source.sceneManifestSha256}, ${command.resolved.source.sourceSnapshotSha256},
          ${specification?.specificationId ?? null}::uuid,
          ${specification?.specificationRevision ?? null},
          ${specification?.specificationRevisionSha256 ?? null},
          ${specification?.catalogReleaseId ?? null}::uuid,
          ${specification?.catalogReleaseSha256 ?? null}, ${command.resolved.requiredCapability},
          ${command.resolved.estimatedJobBytes}, ${command.enhancementProviderEnabled},
          ${publicationResultId}::uuid, 1, 'queued', false, ${command.actor.userId}::uuid,
          ${timestamp}, ${timestamp}, 1
        ) RETURNING *
      `;
      const row = rows[0];
      if (row === undefined) throw new Error("Render job insert returned no row.");
      await transaction`
        INSERT INTO render_attempts (
          tenant_id, project_id, job_id, attempt, estimated_job_bytes, created_at
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${command.projectId}::uuid, ${jobId}::uuid,
          1, ${command.resolved.estimatedJobBytes}, ${timestamp}
        )
      `;
      await transaction`
        INSERT INTO render_attempt_heads (
          tenant_id, project_id, job_id, attempt, state, stage, created_at, updated_at
        ) VALUES (
          ${command.actor.tenantId}::uuid, ${command.projectId}::uuid, ${jobId}::uuid,
          1, 'queued', 'preparing', ${timestamp}, ${timestamp}
        )
      `;
      await transaction`
        INSERT INTO render_attempt_events (
          id, tenant_id, project_id, job_id, attempt, fence_version, state, stage, occurred_at
        ) VALUES (
          ${this.#uuid.randomUUID()}::uuid, ${command.actor.tenantId}::uuid,
          ${command.projectId}::uuid, ${jobId}::uuid, 1, 0, 'queued', 'preparing', ${timestamp}
        )
      `;
      const job = mapJob(row);
      await appendEvent(transaction, this.#uuid, {
        action: "render.job.created",
        actorUserId: command.actor.userId,
        correlation: command.correlation,
        jobId,
        metadata: { attempt: 1, state: "queued", version: 1 },
        occurredAt: timestamp,
        projectId: command.projectId,
        tenantId: command.actor.tenantId,
      });
      await completeEffect(transaction, command.actor.tenantId, command.idempotencyKey, 201, job);
      return { job, replayed: false };
    });
  }

  listJobs(tenantId: string, projectId: string) {
    return this.#withTenant(tenantId, async (transaction) => {
      const rows = await transaction<JobRow[]>`
        SELECT * FROM render_jobs WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
        ORDER BY created_at DESC, id LIMIT 100
      `;
      return rows.map(mapJob);
    });
  }

  findJob(tenantId: string, projectId: string, jobId: string) {
    return this.#withTenant(tenantId, async (transaction) => {
      const rows = await transaction<JobRow[]>`
        SELECT * FROM render_jobs WHERE tenant_id = ${tenantId}::uuid
          AND project_id = ${projectId}::uuid AND id = ${jobId}::uuid LIMIT 1
      `;
      return rows[0] === undefined ? undefined : mapJob(rows[0]);
    });
  }

  findPinnedSource(tenantId: string, projectId: string, jobId: string) {
    return this.#withTenant(tenantId, async (transaction) => {
      const rows = await transaction<{ readonly source_payload: unknown }[]>`
        SELECT source_payload FROM render_jobs WHERE tenant_id = ${tenantId}::uuid
          AND project_id = ${projectId}::uuid AND id = ${jobId}::uuid LIMIT 1
      `;
      return rows[0] === undefined
        ? undefined
        : renderSourceReferenceSchema.parse(rows[0].source_payload);
    });
  }

  findResult(tenantId: string, projectId: string, jobId: string) {
    return this.#withTenant(tenantId, async (transaction) => {
      const rows = await transaction<ResultRow[]>`
        SELECT r.* FROM render_jobs j JOIN render_results r
          ON r.tenant_id = j.tenant_id AND r.project_id = j.project_id AND r.id = j.result_id
        WHERE j.tenant_id = ${tenantId}::uuid AND j.project_id = ${projectId}::uuid
          AND j.id = ${jobId}::uuid AND j.state = 'succeeded' LIMIT 1
      `;
      return rows[0] === undefined ? undefined : mapResult(rows[0]);
    });
  }

  findArtifact(tenantId: string, projectId: string, jobId: string, artifactId: string) {
    return this.#withTenant(tenantId, async (transaction) => {
      const rows = await transaction<ArtifactRow[]>`
        SELECT a.* FROM render_jobs j JOIN render_artifacts a
          ON a.tenant_id = j.tenant_id AND a.project_id = j.project_id AND a.result_id = j.result_id
        WHERE j.tenant_id = ${tenantId}::uuid AND j.project_id = ${projectId}::uuid
          AND j.id = ${jobId}::uuid AND j.state = 'succeeded' AND a.id = ${artifactId}::uuid LIMIT 1
      `;
      return rows[0] === undefined ? undefined : mapArtifact(rows[0]);
    });
  }

  cancelJob(command: TransitionRenderJobCommand) {
    return this.#transition(command, "cancel");
  }

  retryJob(command: TransitionRenderJobCommand) {
    return this.#transition(command, "retry");
  }

  async #transition(command: TransitionRenderJobCommand, transition: "cancel" | "retry") {
    return this.#withTenant(command.actor.tenantId, async (transaction) => {
      const requestSha256 = effectRequestSha256(`render.job.${transition}`, {
        expectedVersion: command.expectedVersion,
        jobId: command.jobId,
        projectId: command.projectId,
      });
      const effect = await claimEffect(transaction, {
        actorUserId: command.actor.userId,
        idempotencyKey: command.idempotencyKey,
        operation: `render.job.${transition}`,
        projectId: command.projectId,
        requestSha256,
        tenantId: command.actor.tenantId,
      });
      if (effect !== undefined)
        return { job: renderJobSchema.parse(effect.response_payload), replayed: true };
      const rows = await transaction<JobRow[]>`
        SELECT * FROM render_jobs WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid AND id = ${command.jobId}::uuid
        LIMIT 1 FOR UPDATE
      `;
      const row = rows[0];
      if (row === undefined) throw notFound();
      const current = mapJob(row);
      if (current.version !== command.expectedVersion) {
        throw renderConflict(
          "RENDER_JOB_VERSION_CONFLICT",
          `The render job changed and is now version ${String(current.version)}.`,
        );
      }
      const timestamp = later(this.#clock, row.updated_at);
      let updated: JobRow | undefined;
      if (transition === "cancel") {
        if (current.state === "queued") {
          await transaction`
            UPDATE render_attempt_heads SET state = 'cancelled', fence_version = fence_version + 1,
              updated_at = ${timestamp}
            WHERE tenant_id = ${command.actor.tenantId}::uuid AND project_id = ${command.projectId}::uuid
              AND job_id = ${command.jobId}::uuid AND attempt = ${current.attempt} AND state = 'queued'
          `;
          [updated] = await transaction<JobRow[]>`
            UPDATE render_jobs SET state = 'cancelled', retryable = true, updated_at = ${timestamp},
              version = version + 1
            WHERE tenant_id = ${command.actor.tenantId}::uuid AND project_id = ${command.projectId}::uuid
              AND id = ${command.jobId}::uuid RETURNING *
          `;
        } else if (
          ["preparing", "rendering-safe", "validating-safe", "publishing-safe"].includes(
            current.state,
          )
        ) {
          await transaction`
            UPDATE render_attempt_heads SET state = 'cancel-requested', fence_version = fence_version + 1,
              updated_at = ${timestamp}
            WHERE tenant_id = ${command.actor.tenantId}::uuid AND project_id = ${command.projectId}::uuid
              AND job_id = ${command.jobId}::uuid AND attempt = ${current.attempt} AND state = 'leased'
          `;
          [updated] = await transaction<JobRow[]>`
            UPDATE render_jobs SET state = 'cancel-requested', updated_at = ${timestamp}, version = version + 1
            WHERE tenant_id = ${command.actor.tenantId}::uuid AND project_id = ${command.projectId}::uuid
              AND id = ${command.jobId}::uuid RETURNING *
          `;
        } else if (current.state === "cancel-requested") {
          updated = row;
        } else {
          throw renderConflict(
            "RENDER_JOB_NOT_CANCELLABLE",
            "Only queued or active safe rendering can be cancelled.",
          );
        }
      } else {
        if (
          !["cancelled", "failed"].includes(current.state) ||
          !row.retryable ||
          current.attempt >= 3
        ) {
          throw renderConflict(
            "RENDER_JOB_NOT_RETRYABLE",
            "The render job is not retryable or reached its attempt limit.",
          );
        }
        const nextAttempt = current.attempt + 1;
        [updated] = await transaction<JobRow[]>`
          UPDATE render_jobs SET attempt = ${nextAttempt}, state = 'queued', safe_code = NULL,
            retryable = false, updated_at = ${timestamp}, version = version + 1
          WHERE tenant_id = ${command.actor.tenantId}::uuid AND project_id = ${command.projectId}::uuid
            AND id = ${command.jobId}::uuid RETURNING *
        `;
        await transaction`
          INSERT INTO render_attempts (
            tenant_id, project_id, job_id, attempt, estimated_job_bytes, created_at
          ) VALUES (
            ${command.actor.tenantId}::uuid, ${command.projectId}::uuid, ${command.jobId}::uuid,
            ${nextAttempt}, ${row.estimated_job_bytes}, ${timestamp}
          )
        `;
        await transaction`
          INSERT INTO render_attempt_heads (
            tenant_id, project_id, job_id, attempt, state, stage, created_at, updated_at
          ) VALUES (
            ${command.actor.tenantId}::uuid, ${command.projectId}::uuid, ${command.jobId}::uuid,
            ${nextAttempt}, 'queued', 'preparing', ${timestamp}, ${timestamp}
          )
        `;
        await transaction`
          INSERT INTO render_attempt_events (
            id, tenant_id, project_id, job_id, attempt, fence_version, state, stage, occurred_at
          ) VALUES (
            ${this.#uuid.randomUUID()}::uuid, ${command.actor.tenantId}::uuid,
            ${command.projectId}::uuid, ${command.jobId}::uuid, ${nextAttempt}, 0,
            'queued', 'preparing', ${timestamp}
          )
        `;
      }
      if (updated === undefined)
        throw renderConflict(
          "RENDER_JOB_VERSION_CONFLICT",
          "The render transition lost its concurrency fence.",
        );
      const job = mapJob(updated);
      await appendEvent(transaction, this.#uuid, {
        action: `render.job.${transition}ed`,
        actorUserId: command.actor.userId,
        correlation: command.correlation,
        jobId: command.jobId,
        metadata: { attempt: job.attempt, state: job.state, version: job.version },
        occurredAt: timestamp,
        projectId: command.projectId,
        tenantId: command.actor.tenantId,
      });
      await completeEffect(transaction, command.actor.tenantId, command.idempotencyKey, 200, job);
      return { job, replayed: false };
    });
  }

  async claimNext(command: ClaimRenderJobCommand): Promise<LeasedRenderJob | undefined> {
    validateWorker(command.workerId);
    if (
      !volumePattern.test(command.volumeId) ||
      command.capabilities.length < 1 ||
      command.capabilities.length > 32 ||
      command.capabilities.some((capability) => !capabilityPattern.test(capability)) ||
      !Number.isSafeInteger(command.freeBytes) ||
      command.freeBytes < 0 ||
      !Number.isInteger(command.leaseSeconds) ||
      command.leaseSeconds < 30 ||
      command.leaseSeconds > 3_600
    ) {
      throw renderConflict("RENDER_CLAIM_INVALID", "The constrained render claim is invalid.");
    }
    const rows = await this.#sql<ClaimRow[]>`
      SELECT * FROM c14_claim_render_job(
        ${command.workerId}, ${command.capabilities as string[]}, ${command.volumeId},
        ${command.freeBytes}, ${command.leaseSeconds}
      )
    `;
    const row = rows[0];
    if (row === undefined) return undefined;
    return {
      attempt: row.attempt,
      cacheIdentitySha256: row.cache_identity_sha256,
      estimatedJobBytes: Number(row.estimated_job_bytes),
      jobId: row.job_id,
      leaseExpiresAt: iso(row.lease_expires_at),
      leaseToken: row.lease_token,
      projectId: row.project_id,
      request: renderJobSchema.shape.request.parse(row.request_payload),
      requiredCapability: row.required_capability,
      resultId: row.publication_result_id,
      source: renderSourceReferenceSchema.parse(row.source_payload),
      stage: row.stage as LeasedRenderJob["stage"],
      tenantId: row.tenant_id,
      volumeId: row.volume_id,
    };
  }

  assertLease(command: Parameters<RenderRepository["assertLease"]>[0]): Promise<void> {
    validateWorker(command.workerId);
    return this.#withTenant(command.tenantId, async (transaction) => {
      await loadLease(transaction, command, false);
    });
  }

  heartbeat(command: HeartbeatRenderJobCommand): Promise<RenderJob> {
    validateWorker(command.workerId);
    return this.#withTenant(command.tenantId, async (transaction) => {
      const head = await loadLease(transaction, command, true);
      const disk = await transaction<{ readonly admitted: boolean }[]>`
        SELECT c14_recheck_disk_reservation(
          ${command.tenantId}::uuid, ${command.projectId}::uuid, ${command.jobId}::uuid,
          ${command.attempt}, ${command.leaseToken}::uuid, ${command.freeBytes}
        ) AS admitted
      `;
      if (disk[0]?.admitted !== true) {
        throw renderConflict(
          "RENDER_DISK_ADMISSION_LOST",
          "The atomic render disk safety invariant no longer holds.",
        );
      }
      const allowed: Readonly<Record<string, readonly string[]>> = {
        preparing: ["preparing", "rendering-safe"],
        "publishing-safe": ["publishing-safe"],
        "rendering-safe": ["rendering-safe", "validating-safe"],
        "validating-safe": ["validating-safe", "publishing-safe"],
      };
      if (!allowed[head.stage]?.includes(command.stage)) {
        throw renderConflict(
          "RENDER_STAGE_INVALID",
          "The worker attempted to skip or reverse a render stage.",
        );
      }
      const timestamp = later(this.#clock, head.updated_at);
      const leaseSeconds = head.lease_seconds ?? 300;
      const heads = await transaction<AttemptHeadRow[]>`
        UPDATE render_attempt_heads SET stage = ${command.stage},
          lease_expires_at = ${timestamp} + ${leaseSeconds} * interval '1 second',
          fence_version = fence_version + 1, updated_at = ${timestamp}
        WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND job_id = ${command.jobId}::uuid AND attempt = ${command.attempt}
        RETURNING *
      `;
      const updatedHead = heads[0];
      const jobs = await transaction<JobRow[]>`
        UPDATE render_jobs SET state = ${command.stage}, updated_at = ${timestamp}, version = version + 1
        WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND id = ${command.jobId}::uuid AND attempt = ${command.attempt} RETURNING *
      `;
      if (updatedHead === undefined || jobs[0] === undefined) {
        throw renderConflict("RENDER_LEASE_FENCED", "The render heartbeat lost its lease fence.");
      }
      await transaction`
        INSERT INTO render_attempt_events (
          id, tenant_id, project_id, job_id, attempt, fence_version, state, stage, worker_id, occurred_at
        ) VALUES (
          ${this.#uuid.randomUUID()}::uuid, ${command.tenantId}::uuid, ${command.projectId}::uuid,
          ${command.jobId}::uuid, ${command.attempt}, ${updatedHead.fence_version}, 'leased',
          ${command.stage}, ${command.workerId}, ${timestamp}
        )
      `;
      return mapJob(jobs[0]);
    });
  }

  failAttempt(command: FailRenderJobCommand): Promise<RenderJob> {
    validateWorker(command.workerId);
    if (!safeCodePattern.test(command.safeCode)) {
      throw renderConflict("RENDER_SAFE_CODE_INVALID", "The render failure code is invalid.");
    }
    return this.#withTenant(command.tenantId, async (transaction) => {
      const head = await loadLease(transaction, command, true);
      const timestamp = later(this.#clock, head.updated_at);
      const heads = await transaction<AttemptHeadRow[]>`
        UPDATE render_attempt_heads SET state = 'failed', lease_owner = NULL, lease_token = NULL,
          lease_expires_at = NULL, lease_seconds = NULL, fence_version = fence_version + 1,
          updated_at = ${timestamp}
        WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND job_id = ${command.jobId}::uuid AND attempt = ${command.attempt} RETURNING *
      `;
      const jobs = await transaction<JobRow[]>`
        UPDATE render_jobs SET state = 'failed', safe_code = ${command.safeCode},
          retryable = ${command.retryable}, updated_at = ${timestamp}, version = version + 1
        WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND id = ${command.jobId}::uuid AND attempt = ${command.attempt} RETURNING *
      `;
      if (heads[0] === undefined || jobs[0] === undefined) {
        throw renderConflict("RENDER_LEASE_FENCED", "The render failure lost its lease fence.");
      }
      await releaseReservation(transaction, command, "failed", timestamp);
      await transaction`
        INSERT INTO render_attempt_events (
          id, tenant_id, project_id, job_id, attempt, fence_version, state, stage,
          safe_code, worker_id, occurred_at
        ) VALUES (
          ${this.#uuid.randomUUID()}::uuid, ${command.tenantId}::uuid, ${command.projectId}::uuid,
          ${command.jobId}::uuid, ${command.attempt}, ${heads[0].fence_version}, 'failed',
          ${head.stage}, ${command.safeCode}, ${command.workerId}, ${timestamp}
        )
      `;
      await appendEvent(transaction, this.#uuid, {
        action: "render.job.failed",
        jobId: command.jobId,
        metadata: {
          attempt: command.attempt,
          retryable: command.retryable,
          safeCode: command.safeCode,
        },
        occurredAt: timestamp,
        projectId: command.projectId,
        tenantId: command.tenantId,
        workerId: command.workerId,
      });
      return mapJob(jobs[0]);
    });
  }

  acknowledgeCancellation(command: AcknowledgeRenderCancellationCommand): Promise<void> {
    validateWorker(command.workerId);
    return this.#withTenant(command.tenantId, async (transaction) => {
      const rows = await transaction<AttemptHeadRow[]>`
        SELECT * FROM render_attempt_heads WHERE tenant_id = ${command.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid AND job_id = ${command.jobId}::uuid
          AND attempt = ${command.attempt} LIMIT 1 FOR UPDATE
      `;
      const head = rows[0];
      if (
        head === undefined ||
        head.state !== "cancel-requested" ||
        head.lease_owner !== command.workerId ||
        head.lease_token !== command.leaseToken
      ) {
        throw renderConflict(
          "RENDER_LEASE_FENCED",
          "The cancellation acknowledgement lost its fence.",
        );
      }
      const timestamp = later(this.#clock, head.updated_at);
      const heads = await transaction<AttemptHeadRow[]>`
        UPDATE render_attempt_heads SET state = 'cancelled', lease_owner = NULL, lease_token = NULL,
          lease_expires_at = NULL, lease_seconds = NULL, fence_version = fence_version + 1,
          updated_at = ${timestamp}
        WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND job_id = ${command.jobId}::uuid AND attempt = ${command.attempt} RETURNING *
      `;
      await transaction`
        UPDATE render_jobs SET state = 'cancelled', retryable = true, updated_at = ${timestamp},
          version = version + 1
        WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND id = ${command.jobId}::uuid AND attempt = ${command.attempt}
      `;
      await releaseReservation(transaction, command, "cancelled", timestamp);
      await transaction`
        INSERT INTO render_attempt_events (
          id, tenant_id, project_id, job_id, attempt, fence_version, state, stage, worker_id, occurred_at
        ) VALUES (
          ${this.#uuid.randomUUID()}::uuid, ${command.tenantId}::uuid, ${command.projectId}::uuid,
          ${command.jobId}::uuid, ${command.attempt}, ${heads[0]?.fence_version ?? 0}, 'cancelled',
          ${head.stage}, ${command.workerId}, ${timestamp}
        )
      `;
    });
  }

  async publishResult(command: PublishRenderResultCommand): Promise<RenderJob> {
    validateWorker(command.workerId);
    const published = await this.#withTenant(command.tenantId, async (transaction) => {
      const head = await loadLease(transaction, command, true);
      const jobs = await transaction<JobRow[]>`
        SELECT * FROM render_jobs WHERE tenant_id = ${command.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid AND id = ${command.jobId}::uuid
        LIMIT 1 FOR UPDATE
      `;
      const job = jobs[0];
      if (
        job === undefined ||
        job.attempt !== command.attempt ||
        job.state !== "publishing-safe" ||
        head.stage !== "publishing-safe" ||
        job.publication_result_id !== command.resultId ||
        command.manifest.resultId !== command.resultId ||
        requestHash(command.manifest.source) !==
          requestHash(renderSourceReferenceSchema.parse(job.source_payload))
      ) {
        throw renderConflict(
          "RENDER_PUBLICATION_FENCED",
          "The safe publication lost its exact job/source/result fence.",
        );
      }
      const requiredRoles = new Set([
        "geometry-safe-png",
        "multilayer-exr",
        "depth-exr",
        "normal-exr",
        "segmentation-png",
      ]);
      if (
        command.artifacts.length !== 5 ||
        command.artifacts.some(({ artifact }) => !requiredRoles.delete(artifact.role)) ||
        requiredRoles.size !== 0
      ) {
        throw renderConflict(
          "RENDER_BUNDLE_INCOMPLETE",
          "The safe result requires exactly one frozen artifact role.",
        );
      }
      const timestamp = later(this.#clock, head.updated_at);
      await transaction`
        INSERT INTO render_results (
          tenant_id, project_id, id, job_id, publishing_attempt, schema_version,
          manifest_payload, manifest_sha256, created_by, created_at
        ) VALUES (
          ${command.tenantId}::uuid, ${command.projectId}::uuid, ${command.resultId}::uuid,
          ${command.jobId}::uuid, ${command.attempt}, 'c14-render-output-manifest-v1',
          ${transaction.json(json(renderOutputManifestSchema.parse(command.manifest)))},
          ${command.manifestSha256}, ${job.created_by}::uuid, ${timestamp}
        )
      `;
      for (const { artifact, objectKey } of command.artifacts) {
        if (artifact.widthPx === undefined || artifact.heightPx === undefined) {
          throw renderConflict(
            "RENDER_ARTIFACT_DIMENSIONS_MISSING",
            "Every safe render artifact requires exact dimensions.",
          );
        }
        await transaction`
          INSERT INTO render_artifacts (
            tenant_id, project_id, id, result_id, manifest_sha256, schema_version,
            role, media_type, sha256, byte_length, width_px, height_px, object_key, created_at
          ) VALUES (
            ${command.tenantId}::uuid, ${command.projectId}::uuid, ${artifact.id}::uuid,
            ${command.resultId}::uuid, ${command.manifestSha256}, ${artifact.schemaVersion},
            ${artifact.role}, ${artifact.mediaType}, ${artifact.sha256}, ${artifact.byteLength},
            ${artifact.widthPx}, ${artifact.heightPx}, ${objectKey}, ${timestamp}
          )
        `;
      }
      await transaction`
        INSERT INTO render_cache_entries (
          tenant_id, project_id, cache_identity_sha256, result_id, source_scene_glb_sha256,
          source_scene_manifest_sha256, specification_revision_sha256, profile_id, created_at
        ) VALUES (
          ${command.tenantId}::uuid, ${command.projectId}::uuid, ${job.cache_identity_sha256},
          ${command.resultId}::uuid, ${command.manifest.source.sceneGlbSha256},
          ${command.manifest.source.sceneManifestSha256},
          ${command.manifest.source.specification?.specificationRevisionSha256 ?? null},
          ${(job.request_payload as { profileId: string }).profileId}, ${timestamp}
        )
      `;
      const heads = await transaction<AttemptHeadRow[]>`
        UPDATE render_attempt_heads SET state = 'succeeded', lease_owner = NULL, lease_token = NULL,
          lease_expires_at = NULL, lease_seconds = NULL, fence_version = fence_version + 1,
          updated_at = ${timestamp}
        WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND job_id = ${command.jobId}::uuid AND attempt = ${command.attempt} RETURNING *
      `;
      const updated = await transaction<JobRow[]>`
        UPDATE render_jobs SET state = 'succeeded', result_id = ${command.resultId}::uuid,
          retryable = false, safe_code = NULL, updated_at = ${timestamp}, version = version + 1
        WHERE tenant_id = ${command.tenantId}::uuid AND project_id = ${command.projectId}::uuid
          AND id = ${command.jobId}::uuid AND attempt = ${command.attempt} RETURNING *
      `;
      await releaseReservation(transaction, command, "succeeded", timestamp);
      await transaction`
        INSERT INTO render_attempt_events (
          id, tenant_id, project_id, job_id, attempt, fence_version, state, stage, worker_id, occurred_at
        ) VALUES (
          ${this.#uuid.randomUUID()}::uuid, ${command.tenantId}::uuid, ${command.projectId}::uuid,
          ${command.jobId}::uuid, ${command.attempt}, ${heads[0]?.fence_version ?? 0}, 'succeeded',
          'publishing-safe', ${command.workerId}, ${timestamp}
        )
      `;
      if (updated[0] === undefined)
        throw renderConflict("RENDER_PUBLICATION_FENCED", "The safe result lost its winner fence.");
      await appendEvent(transaction, this.#uuid, {
        action: "render.result.published",
        jobId: command.jobId,
        metadata: { artifactCount: 5, attempt: command.attempt, state: "succeeded" },
        occurredAt: timestamp,
        projectId: command.projectId,
        resultId: command.resultId,
        tenantId: command.tenantId,
        workerId: command.workerId,
      });
      return mapJob(updated[0]);
    });
    // The safe result is already committed. A missing optional child is repaired lazily by
    // requestEnhancement; provider/child failure must never roll back or hide the base result.
    await this.#withTenant(command.tenantId, (transaction) =>
      ensureEnhancementChild(transaction, this.#uuid, command, later(this.#clock)),
    ).catch(() => undefined);
    return published;
  }

  findEnhancement(tenantId: string, projectId: string, jobId: string) {
    return this.#withTenant(tenantId, async (transaction) => {
      const rows = await transaction<EnhancementRow[]>`
        SELECT e.*, r.result_payload FROM render_enhancement_jobs e
        LEFT JOIN render_enhancement_results r ON r.tenant_id = e.tenant_id
          AND r.project_id = e.project_id AND r.enhancement_job_id = e.id
        WHERE e.tenant_id = ${tenantId}::uuid AND e.project_id = ${projectId}::uuid
          AND e.render_job_id = ${jobId}::uuid LIMIT 1
      `;
      return rows[0] === undefined ? undefined : mapEnhancement(rows[0]);
    });
  }

  requestEnhancement(command: RequestEnhancementCommand) {
    return this.#withTenant(command.actor.tenantId, async (transaction) => {
      const requestSha256 = effectRequestSha256("render.enhancement.request", {
        expectedVersion: command.expectedVersion,
        jobId: command.jobId,
        projectId: command.projectId,
      });
      const effect = await claimEffect(transaction, {
        actorUserId: command.actor.userId,
        idempotencyKey: command.idempotencyKey,
        operation: "render.enhancement.request",
        projectId: command.projectId,
        requestSha256,
        tenantId: command.actor.tenantId,
      });
      if (effect !== undefined)
        return {
          enhancement: mapEnhancement(effect.response_payload as EnhancementRow),
          replayed: true,
        };
      const jobs = await transaction<JobRow[]>`
        SELECT * FROM render_jobs WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid AND id = ${command.jobId}::uuid LIMIT 1 FOR UPDATE
      `;
      const job = jobs[0];
      if (job === undefined) throw notFound();
      if (job.version !== command.expectedVersion || job.state !== "succeeded") {
        throw renderConflict(
          "RENDER_ENHANCEMENT_NOT_READY",
          "A stable published base result is required before enhancement.",
        );
      }
      await ensureEnhancementChild(
        transaction,
        this.#uuid,
        { jobId: command.jobId, projectId: command.projectId, tenantId: command.actor.tenantId },
        later(this.#clock, job.updated_at),
      );
      const rows = await transaction<EnhancementRow[]>`
        SELECT e.*, NULL::jsonb AS result_payload FROM render_enhancement_jobs e
        WHERE e.tenant_id = ${command.actor.tenantId}::uuid AND e.project_id = ${command.projectId}::uuid
          AND e.render_job_id = ${command.jobId}::uuid LIMIT 1 FOR UPDATE
      `;
      let enhancement = rows[0];
      if (enhancement === undefined)
        throw new Error("Published safe result has no enhancement child.");
      if (enhancement.state === "disabled" && command.providerEnabled) {
        const timestamp = later(this.#clock, enhancement.updated_at);
        [enhancement] = await transaction<EnhancementRow[]>`
          UPDATE render_enhancement_jobs SET state = 'queued', safe_code = NULL,
            updated_at = ${timestamp}, version = version + 1
          WHERE tenant_id = ${command.actor.tenantId}::uuid AND project_id = ${command.projectId}::uuid
            AND id = ${enhancement.id}::uuid AND state = 'disabled' RETURNING *, NULL::jsonb AS result_payload
        `;
      }
      if (enhancement === undefined)
        throw renderConflict(
          "RENDER_ENHANCEMENT_CONFLICT",
          "Enhancement state changed concurrently.",
        );
      const mapped = mapEnhancement(enhancement);
      await completeEffect(
        transaction,
        command.actor.tenantId,
        command.idempotencyKey,
        200,
        enhancement,
      );
      return { enhancement: mapped, replayed: false };
    });
  }

  recordArtifactAccess(command: RecordArtifactAccessCommand): Promise<void> {
    return this.#withTenant(command.actor.tenantId, async (transaction) => {
      const artifact = await transaction<{ readonly id: string }[]>`
        SELECT id FROM render_artifacts WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid AND result_id = ${command.resultId}::uuid
          AND id = ${command.artifactId}::uuid LIMIT 1
      `;
      if (artifact.length !== 1) throw notFound();
      await transaction`
        INSERT INTO render_audit_events (
          id, tenant_id, project_id, job_id, result_id, action, actor_user_id,
          request_id, trace_id, metadata, occurred_at
        ) VALUES (
          ${this.#uuid.randomUUID()}::uuid, ${command.actor.tenantId}::uuid,
          ${command.projectId}::uuid, ${command.jobId}::uuid, ${command.resultId}::uuid,
          'render.artifact.accessed', ${command.actor.userId}::uuid,
          ${command.correlation.requestId}, ${command.correlation.traceId},
          ${transaction.json(json({ artifactId: command.artifactId, resultId: command.resultId }))},
          ${later(this.#clock)}
        )
      `;
    });
  }
}

function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
