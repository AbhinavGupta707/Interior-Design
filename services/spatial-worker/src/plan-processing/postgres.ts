import {
  c6PlanJobSchemaVersion,
  c6SupportedPlanMimeTypeSchema,
  planParserResultSchema,
  type PlanParserResult,
} from "@interior-design/contracts";
import { createHash, randomUUID } from "node:crypto";
import type { JSONValue, Sql, TransactionSql } from "postgres";

import type {
  LeasedPlanProcessingJob,
  PlanNormalizationFailureCode,
  PlanProcessingQueue,
} from "./types.js";

interface ClaimRow {
  readonly asset_id: string;
  readonly attempt: number;
  readonly basis: string;
  readonly detected_mime_type: string | null;
  readonly id: string;
  readonly kind: string;
  readonly page_index: number;
  readonly parser_preference: string;
  readonly project_id: string;
  readonly service_processing_consent: boolean;
  readonly source_byte_size: number | string;
  readonly source_object_key: string;
  readonly source_sha256: string;
  readonly state: string;
  readonly stored_source_sha256: string;
  readonly tenant_id: string;
  readonly training_use_consent: string;
}

interface LeaseStateRow {
  readonly lease_is_current: boolean;
  readonly lease_expires_at: Date | string | null;
  readonly lease_owner: string | null;
  readonly lease_token: string | null;
  readonly project_id: string;
  readonly state: string;
  readonly tenant_id: string;
}

function json(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  )
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  throw new Error("Unsupported terminal plan result value.");
}

function resultSha256(value: PlanParserResult): string {
  return createHash("sha256")
    .update(canonicalJson({ ...value, createdAt: undefined }))
    .digest("hex");
}

function workerTraceId(): string {
  return randomUUID().replaceAll("-", "").slice(0, 32);
}

async function appendWorkerEvent(
  transaction: TransactionSql,
  input: {
    readonly action: "plan.job.cancel" | "plan.job.fail" | "plan.job.lease" | "plan.job.publish";
    readonly jobId: string;
    readonly metadata: object;
    readonly projectId: string;
    readonly tenantId: string;
    readonly workerId: string;
  },
): Promise<void> {
  const occurredAt = new Date();
  const traceId = workerTraceId();
  await transaction`
    INSERT INTO plan_processing_audit_events (
      id, tenant_id, project_id, job_id, action, worker_id,
      request_id, trace_id, metadata, occurred_at
    ) VALUES (
      ${randomUUID()}::uuid, ${input.tenantId}::uuid, ${input.projectId}::uuid,
      ${input.jobId}::uuid, ${input.action}, ${input.workerId},
      ${`worker:${input.workerId}`}, ${traceId}, ${transaction.json(json(input.metadata))}, ${occurredAt}
    )
  `;
  await transaction`
    INSERT INTO plan_processing_outbox (
      id, tenant_id, project_id, job_id, event_type, schema_version, payload, occurred_at
    ) VALUES (
      ${randomUUID()}::uuid, ${input.tenantId}::uuid, ${input.projectId}::uuid,
      ${input.jobId}::uuid, ${input.action}, ${c6PlanJobSchemaVersion},
      ${transaction.json(json(input.metadata))}, ${occurredAt}
    )
  `;
}

function invalidSourceCode(row: ClaimRow): "rights-not-permitted" | "source-mismatch" | undefined {
  if (
    !row.service_processing_consent ||
    row.training_use_consent !== "denied" ||
    !["owned-by-user", "permission-granted", "public-domain", "licensed"].includes(row.basis)
  ) {
    return "rights-not-permitted";
  }
  if (
    row.kind !== "plan" ||
    row.state === "queued-invalid-source" ||
    row.source_sha256 !== row.stored_source_sha256 ||
    Number(row.source_byte_size) > 26_214_400 ||
    !["application/pdf", "image/svg+xml", "image/png", "image/jpeg"].includes(
      row.detected_mime_type ?? "",
    )
  ) {
    return "source-mismatch";
  }
  return undefined;
}

export class PostgresPlanProcessingQueue implements PlanProcessingQueue {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async claimNext(
    workerId: string,
    leaseMilliseconds: number,
  ): Promise<LeasedPlanProcessingJob | undefined> {
    return this.#sql.begin(async (transaction) => {
      const abandonedCancellations = await transaction<
        {
          readonly attempt: number;
          readonly id: string;
          readonly project_id: string;
          readonly tenant_id: string;
        }[]
      >`
        SELECT tenant_id, project_id, id, attempt FROM plan_processing_jobs
        WHERE state = 'cancel-requested' AND lease_expires_at <= clock_timestamp()
        ORDER BY updated_at, id LIMIT 20 FOR UPDATE SKIP LOCKED
      `;
      for (const cancelled of abandonedCancellations) {
        await transaction`
          UPDATE plan_processing_jobs
          SET state = 'cancelled', lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
              updated_at = clock_timestamp(), version = version + 1
          WHERE tenant_id = ${cancelled.tenant_id}::uuid AND project_id = ${cancelled.project_id}::uuid
            AND id = ${cancelled.id}::uuid AND state = 'cancel-requested'
        `;
        await appendWorkerEvent(transaction, {
          action: "plan.job.cancel",
          jobId: cancelled.id,
          metadata: { attempt: cancelled.attempt, jobId: cancelled.id, state: "cancelled" },
          projectId: cancelled.project_id,
          tenantId: cancelled.tenant_id,
          workerId,
        });
      }
      for (let inspected = 0; inspected < 20; inspected += 1) {
        const rows = await transaction<ClaimRow[]>`
          SELECT j.tenant_id, j.project_id, j.id, j.asset_id, j.page_index,
            j.parser_preference, j.source_sha256 AS stored_source_sha256, j.attempt,
            a.kind, CASE WHEN a.status = 'ready' THEN j.state ELSE 'queued-invalid-source' END AS state,
            a.detected_mime_type, a.source_byte_size, a.source_sha256, a.source_object_key,
            r.basis, r.service_processing_consent, r.training_use_consent
          FROM plan_processing_jobs j
          JOIN assets a
            ON a.tenant_id = j.tenant_id AND a.project_id = j.project_id AND a.id = j.asset_id
          JOIN asset_rights_assertions r
            ON r.tenant_id = a.tenant_id AND r.project_id = a.project_id AND r.asset_id = a.id
          WHERE j.state = 'queued'
             OR (j.state = 'processing' AND j.lease_expires_at <= clock_timestamp())
          ORDER BY j.created_at ASC, j.id ASC
          LIMIT 1 FOR UPDATE OF j SKIP LOCKED
        `;
        const row = rows[0];
        if (row === undefined) return undefined;
        const invalidCode = invalidSourceCode(row);
        if (invalidCode !== undefined) {
          await transaction`
            UPDATE plan_processing_jobs
            SET state = 'failed', safe_code = ${invalidCode}, retryable = false,
                lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
                updated_at = clock_timestamp(), version = version + 1
            WHERE tenant_id = ${row.tenant_id}::uuid AND project_id = ${row.project_id}::uuid
              AND id = ${row.id}::uuid
          `;
          await appendWorkerEvent(transaction, {
            action: "plan.job.fail",
            jobId: row.id,
            metadata: {
              attempt: row.attempt,
              jobId: row.id,
              safeCode: invalidCode,
              state: "failed",
            },
            projectId: row.project_id,
            tenantId: row.tenant_id,
            workerId,
          });
          continue;
        }
        const detectedMimeType = c6SupportedPlanMimeTypeSchema.parse(row.detected_mime_type);
        const leaseToken = randomUUID();
        const updated = await transaction<{ readonly lease_expires_at: Date | string }[]>`
          UPDATE plan_processing_jobs
          SET state = 'processing', lease_owner = ${workerId}, lease_token = ${leaseToken}::uuid,
              lease_expires_at = clock_timestamp() + (${leaseMilliseconds} * interval '1 millisecond'),
              retryable = false, safe_code = NULL, result_id = NULL,
              updated_at = clock_timestamp(), version = version + 1
          WHERE tenant_id = ${row.tenant_id}::uuid AND project_id = ${row.project_id}::uuid
            AND id = ${row.id}::uuid
          RETURNING lease_expires_at
        `;
        const lease = updated[0];
        if (lease === undefined) continue;
        await appendWorkerEvent(transaction, {
          action: "plan.job.lease",
          jobId: row.id,
          metadata: { attempt: row.attempt, jobId: row.id, state: "processing" },
          projectId: row.project_id,
          tenantId: row.tenant_id,
          workerId,
        });
        return {
          assetId: row.asset_id,
          attempt: row.attempt,
          detectedMimeType,
          jobId: row.id,
          leaseExpiresAt: new Date(lease.lease_expires_at).toISOString(),
          leaseToken,
          pageIndex: row.page_index,
          parserPreference: row.parser_preference as LeasedPlanProcessingJob["parserPreference"],
          projectId: row.project_id,
          rights: {
            basis: row.basis as LeasedPlanProcessingJob["rights"]["basis"],
            serviceProcessingConsent: true,
            trainingUseConsent: "denied",
          },
          sourceByteSize: Number(row.source_byte_size),
          sourceObjectKey: row.source_object_key,
          sourceSha256: row.source_sha256,
          tenantId: row.tenant_id,
        };
      }
      return undefined;
    });
  }

  async heartbeat(
    job: LeasedPlanProcessingJob,
    workerId: string,
    leaseMilliseconds: number,
  ): Promise<"cancel-requested" | "leased" | "lost"> {
    return this.#sql.begin(async (transaction) => {
      const rows = await transaction<LeaseStateRow[]>`
        SELECT tenant_id, project_id, state, lease_owner, lease_token, lease_expires_at,
          COALESCE(lease_expires_at > clock_timestamp(), false) AS lease_is_current
        FROM plan_processing_jobs
        WHERE tenant_id = ${job.tenantId}::uuid AND project_id = ${job.projectId}::uuid
          AND id = ${job.jobId}::uuid LIMIT 1 FOR UPDATE
      `;
      const row = rows[0];
      if (row === undefined || row.lease_owner !== workerId || row.lease_token !== job.leaseToken)
        return "lost";
      if (row.state === "cancel-requested") return "cancel-requested";
      if (row.state !== "processing" || row.lease_expires_at === null || !row.lease_is_current)
        return "lost";
      const updated = await transaction<{ readonly id: string }[]>`
        UPDATE plan_processing_jobs
        SET lease_expires_at = clock_timestamp() + (${leaseMilliseconds} * interval '1 millisecond'),
            updated_at = clock_timestamp(), version = version + 1
        WHERE tenant_id = ${job.tenantId}::uuid AND project_id = ${job.projectId}::uuid
          AND id = ${job.jobId}::uuid AND state = 'processing'
          AND lease_owner = ${workerId} AND lease_token = ${job.leaseToken}::uuid
          AND lease_expires_at > clock_timestamp()
        RETURNING id
      `;
      return updated.length === 1 ? "leased" : "lost";
    });
  }

  async acknowledgeCancellation(job: LeasedPlanProcessingJob, workerId: string): Promise<boolean> {
    return this.#sql.begin(async (transaction) => {
      const rows = await transaction<{ readonly id: string }[]>`
        UPDATE plan_processing_jobs
        SET state = 'cancelled', lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
            updated_at = clock_timestamp(), version = version + 1
        WHERE tenant_id = ${job.tenantId}::uuid AND project_id = ${job.projectId}::uuid
          AND id = ${job.jobId}::uuid AND state = 'cancel-requested'
          AND lease_owner = ${workerId} AND lease_token = ${job.leaseToken}::uuid
        RETURNING id
      `;
      if (rows.length !== 1) return false;
      await appendWorkerEvent(transaction, {
        action: "plan.job.cancel",
        jobId: job.jobId,
        metadata: { attempt: job.attempt, jobId: job.jobId, state: "cancelled" },
        projectId: job.projectId,
        tenantId: job.tenantId,
        workerId,
      });
      return true;
    });
  }

  async publish(
    job: LeasedPlanProcessingJob,
    workerId: string,
    input: PlanParserResult,
  ): Promise<boolean> {
    const result = planParserResultSchema.parse(input);
    if (
      result.jobId !== job.jobId ||
      result.projectId !== job.projectId ||
      result.source.assetId !== job.assetId ||
      result.source.projectId !== job.projectId ||
      result.source.byteSize !== job.sourceByteSize ||
      result.source.sha256 !== job.sourceSha256 ||
      result.source.pageIndex !== job.pageIndex ||
      result.source.detectedMimeType !== job.detectedMimeType ||
      result.source.rights.basis !== job.rights.basis
    ) {
      return false;
    }
    return this.#sql.begin(async (transaction) => {
      const terminalResultSha256 = resultSha256(result);
      const rows = await transaction<LeaseStateRow[]>`
        SELECT tenant_id, project_id, state, lease_owner, lease_token, lease_expires_at,
          COALESCE(lease_expires_at > clock_timestamp(), false) AS lease_is_current
        FROM plan_processing_jobs
        WHERE tenant_id = ${job.tenantId}::uuid AND project_id = ${job.projectId}::uuid
          AND id = ${job.jobId}::uuid LIMIT 1 FOR UPDATE
      `;
      const current = rows[0];
      if (
        current === undefined ||
        current.state !== "processing" ||
        current.lease_owner !== workerId ||
        current.lease_token !== job.leaseToken ||
        current.lease_expires_at === null ||
        !current.lease_is_current
      )
        return false;
      const state = result.status === "proposal" ? "proposed" : "abstained";
      const safeCode = result.status === "abstained" ? result.code : null;
      const retryable = result.status === "abstained" && result.retryable && job.attempt < 3;
      const updated = await transaction<{ readonly id: string }[]>`
        UPDATE plan_processing_jobs
        SET state = ${state}, result_id = ${result.proposalId}::uuid,
            safe_code = ${safeCode}, retryable = ${retryable},
            normalized_input_sha256 = ${result.normalizedInputSha256 ?? null},
            lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
            updated_at = clock_timestamp(), version = version + 1
        WHERE tenant_id = ${job.tenantId}::uuid AND project_id = ${job.projectId}::uuid
          AND id = ${job.jobId}::uuid AND state = 'processing'
          AND lease_owner = ${workerId} AND lease_token = ${job.leaseToken}::uuid
          AND lease_expires_at > clock_timestamp()
        RETURNING id
      `;
      if (updated.length !== 1) return false;
      await transaction`
        INSERT INTO plan_processing_results (
          tenant_id, project_id, job_id, id, status, source_sha256,
          normalized_input_sha256, parser_manifest_sha256, result_sha256, result_payload, created_at
        ) VALUES (
          ${job.tenantId}::uuid, ${job.projectId}::uuid, ${job.jobId}::uuid,
          ${result.proposalId}::uuid, ${result.status}, ${result.source.sha256},
          ${result.normalizedInputSha256 ?? null}, ${result.parser.manifestSha256},
          ${terminalResultSha256}, ${transaction.json(json(result))}, ${new Date(result.createdAt)}
        )
      `;
      await appendWorkerEvent(transaction, {
        action: "plan.job.publish",
        jobId: job.jobId,
        metadata: {
          attempt: job.attempt,
          jobId: job.jobId,
          resultId: result.proposalId,
          resultSha256: terminalResultSha256,
          safeCode: safeCode ?? undefined,
          state,
        },
        projectId: job.projectId,
        tenantId: job.tenantId,
        workerId,
      });
      return true;
    });
  }

  async fail(
    job: LeasedPlanProcessingJob,
    workerId: string,
    code: PlanNormalizationFailureCode | "rights-not-permitted",
    retryable: boolean,
  ): Promise<boolean> {
    return this.#sql.begin(async (transaction) => {
      const rows = await transaction<LeaseStateRow[]>`
        SELECT tenant_id, project_id, state, lease_owner, lease_token, lease_expires_at,
          COALESCE(lease_expires_at > clock_timestamp(), false) AS lease_is_current
        FROM plan_processing_jobs
        WHERE tenant_id = ${job.tenantId}::uuid AND project_id = ${job.projectId}::uuid
          AND id = ${job.jobId}::uuid LIMIT 1 FOR UPDATE
      `;
      const current = rows[0];
      if (
        current === undefined ||
        current.lease_owner !== workerId ||
        current.lease_token !== job.leaseToken
      )
        return false;
      if (current.state === "cancel-requested") {
        const cancelled = await transaction<{ readonly id: string }[]>`
          UPDATE plan_processing_jobs
          SET state = 'cancelled', lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
              updated_at = clock_timestamp(), version = version + 1
          WHERE tenant_id = ${job.tenantId}::uuid AND project_id = ${job.projectId}::uuid
            AND id = ${job.jobId}::uuid AND state = 'cancel-requested'
          RETURNING id
        `;
        if (cancelled.length !== 1) return false;
        await appendWorkerEvent(transaction, {
          action: "plan.job.cancel",
          jobId: job.jobId,
          metadata: { attempt: job.attempt, jobId: job.jobId, state: "cancelled" },
          projectId: job.projectId,
          tenantId: job.tenantId,
          workerId,
        });
        return true;
      }
      if (
        current.state !== "processing" ||
        current.lease_expires_at === null ||
        !current.lease_is_current
      )
        return false;
      const canRetry = retryable && job.attempt < 3;
      const updated = await transaction<{ readonly id: string }[]>`
        UPDATE plan_processing_jobs
        SET state = 'failed', safe_code = ${code}, retryable = ${canRetry},
            lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
            updated_at = clock_timestamp(), version = version + 1
        WHERE tenant_id = ${job.tenantId}::uuid AND project_id = ${job.projectId}::uuid
          AND id = ${job.jobId}::uuid AND state = 'processing'
          AND lease_owner = ${workerId} AND lease_token = ${job.leaseToken}::uuid
          AND lease_expires_at > clock_timestamp()
        RETURNING id
      `;
      if (updated.length !== 1) return false;
      await appendWorkerEvent(transaction, {
        action: "plan.job.fail",
        jobId: job.jobId,
        metadata: {
          attempt: job.attempt,
          jobId: job.jobId,
          retryable: canRetry,
          safeCode: code,
          state: "failed",
        },
        projectId: job.projectId,
        tenantId: job.tenantId,
        workerId,
      });
      return true;
    });
  }
}
