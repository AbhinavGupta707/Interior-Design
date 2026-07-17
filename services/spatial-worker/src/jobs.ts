import {
  assetProcessingCommandSchema,
  assetProcessingResultSchema,
  type AssetProcessingCommand,
  type AssetProcessingResult,
} from "@interior-design/contracts";
import { randomUUID } from "node:crypto";
import type { JSONValue, Sql } from "postgres";

export interface LeasedProcessingJob {
  readonly command: AssetProcessingCommand;
  readonly executionStartedAt: string;
  readonly jobId: string;
  readonly leaseExpiresAt: string;
  readonly leaseToken: string;
  readonly tenantId: string;
  readonly workerId: string;
}

export type RetryOutcome = "exhausted" | "lost" | "retrying";

export interface ProcessingJobRepository {
  claim(workerId: string, leaseMs: number): Promise<LeasedProcessingJob | undefined>;
  complete(job: LeasedProcessingJob, result: AssetProcessingResult): Promise<boolean>;
  renew(job: LeasedProcessingJob, leaseMs: number): Promise<boolean>;
  retry(
    job: LeasedProcessingJob,
    safeErrorCode: string,
    retryDelayMs: number,
  ): Promise<RetryOutcome>;
}

interface CandidateRow {
  readonly asset_id: string;
  readonly attempt_count: number;
  readonly command: unknown;
  readonly id: string;
  readonly maximum_attempts: number;
  readonly project_id: string;
  readonly tenant_id: string;
}

interface ClaimedRow {
  readonly lease_expires_at: Date | string;
  readonly processing_started_at: Date | string;
}

interface LockRow {
  readonly attempt_count: number;
  readonly maximum_attempts: number;
}

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function jsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

export class PostgresProcessingJobRepository implements ProcessingJobRepository {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async claim(workerId: string, leaseMs: number): Promise<LeasedProcessingJob | undefined> {
    return this.#sql.begin(async (transaction) => {
      const candidates = await transaction<CandidateRow[]>`
        SELECT id, tenant_id, project_id, asset_id, command, attempt_count, maximum_attempts
        FROM asset_processing_jobs
        WHERE attempt_count < LEAST(maximum_attempts, 10)
          AND (
            (status IN ('queued', 'retryable') AND available_at <= clock_timestamp())
            OR
            (status = 'processing' AND lease_expires_at <= clock_timestamp())
          )
        ORDER BY available_at ASC, created_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `;
      const candidate = candidates[0];
      if (candidate === undefined) return undefined;

      const parsedCommand = assetProcessingCommandSchema.safeParse(candidate.command);
      if (
        !parsedCommand.success ||
        parsedCommand.data.assetId !== candidate.asset_id ||
        parsedCommand.data.projectId !== candidate.project_id ||
        candidate.maximum_attempts < 1 ||
        candidate.maximum_attempts > 10
      ) {
        await transaction`
          UPDATE asset_processing_jobs
          SET status = 'failed',
              last_error_code = 'invalid-command',
              completed_at = clock_timestamp(),
              updated_at = clock_timestamp()
          WHERE id = ${candidate.id}::uuid
            AND tenant_id = ${candidate.tenant_id}::uuid
        `;
        await transaction`
          UPDATE assets
          SET status = 'rejected',
              rejection_code = 'processing-failed',
              updated_at = clock_timestamp()
          WHERE tenant_id = ${candidate.tenant_id}::uuid
            AND project_id = ${candidate.project_id}::uuid
            AND id = ${candidate.asset_id}::uuid
            AND status IN ('uploaded', 'processing')
        `;
        await transaction`
          INSERT INTO asset_audit_events (
            id, tenant_id, project_id, asset_id, event_type, details
          )
          VALUES (
            ${randomUUID()}::uuid,
            ${candidate.tenant_id}::uuid,
            ${candidate.project_id}::uuid,
            ${candidate.asset_id}::uuid,
            'asset.processing-command-invalid',
            ${transaction.json(jsonValue({ jobId: candidate.id, status: "rejected" }))}
          )
        `;
        return undefined;
      }
      const storedCommand = parsedCommand.data;
      const attempt = candidate.attempt_count + 1;
      const command = assetProcessingCommandSchema.parse({ ...storedCommand, attempt });
      const leaseToken = randomUUID();
      const claimed = await transaction<ClaimedRow[]>`
        UPDATE asset_processing_jobs
        SET attempt_count = ${attempt},
            command = ${transaction.json(jsonValue(command))},
            lease_expires_at = clock_timestamp() + (${leaseMs} * interval '1 millisecond'),
            lease_owner = ${workerId},
            lease_token = ${leaseToken}::uuid,
            processing_started_at = COALESCE(processing_started_at, clock_timestamp()),
            status = 'processing',
            updated_at = clock_timestamp()
        WHERE id = ${candidate.id}::uuid
          AND tenant_id = ${candidate.tenant_id}::uuid
          AND project_id = ${candidate.project_id}::uuid
          AND asset_id = ${candidate.asset_id}::uuid
        RETURNING lease_expires_at, processing_started_at
      `;
      const claim = claimed[0];
      if (claim === undefined) {
        throw new Error("Locked processing job could not be claimed.");
      }
      const assets = await transaction<{ readonly id: string }[]>`
        UPDATE assets
        SET status = 'processing', updated_at = clock_timestamp()
        WHERE tenant_id = ${candidate.tenant_id}::uuid
          AND project_id = ${candidate.project_id}::uuid
          AND id = ${candidate.asset_id}::uuid
          AND status IN ('uploaded', 'processing')
        RETURNING id
      `;
      if (assets.length !== 1) {
        throw new Error("Processing job asset is not in a processable state.");
      }
      return {
        command,
        executionStartedAt: iso(claim.processing_started_at),
        jobId: candidate.id,
        leaseExpiresAt: iso(claim.lease_expires_at),
        leaseToken,
        tenantId: candidate.tenant_id,
        workerId,
      };
    });
  }

  async renew(job: LeasedProcessingJob, leaseMs: number): Promise<boolean> {
    const rows = await this.#sql<{ readonly id: string }[]>`
      UPDATE asset_processing_jobs
      SET lease_expires_at = clock_timestamp() + (${leaseMs} * interval '1 millisecond'),
          updated_at = clock_timestamp()
      WHERE id = ${job.jobId}::uuid
        AND tenant_id = ${job.tenantId}::uuid
        AND project_id = ${job.command.projectId}::uuid
        AND asset_id = ${job.command.assetId}::uuid
        AND status = 'processing'
        AND lease_owner = ${job.workerId}
        AND lease_token = ${job.leaseToken}::uuid
        AND lease_expires_at > clock_timestamp()
      RETURNING id
    `;
    return rows.length === 1;
  }

  async complete(
    job: LeasedProcessingJob,
    untrustedResult: AssetProcessingResult,
  ): Promise<boolean> {
    const result = assetProcessingResultSchema.parse(untrustedResult);
    if (result.assetId !== job.command.assetId || result.projectId !== job.command.projectId) {
      throw new Error("Processing result does not match its leased command.");
    }
    return this.#sql.begin(async (transaction) => {
      const locks = await transaction<{ readonly id: string }[]>`
        SELECT id
        FROM asset_processing_jobs
        WHERE id = ${job.jobId}::uuid
          AND tenant_id = ${job.tenantId}::uuid
          AND project_id = ${job.command.projectId}::uuid
          AND asset_id = ${job.command.assetId}::uuid
          AND status = 'processing'
          AND lease_owner = ${job.workerId}
          AND lease_token = ${job.leaseToken}::uuid
          AND lease_expires_at > clock_timestamp()
        FOR UPDATE
      `;
      if (locks.length !== 1) return false;

      for (const artifact of result.artifacts) {
        await transaction`
          INSERT INTO derived_asset_artifacts (
            id, tenant_id, project_id, asset_id, bucket, object_key,
            kind, mime_type, byte_size, sha256
          )
          VALUES (
            ${randomUUID()}::uuid,
            ${job.tenantId}::uuid,
            ${result.projectId}::uuid,
            ${result.assetId}::uuid,
            ${result.status === "quarantined" ? "quarantine" : "derived"},
            ${artifact.key},
            ${artifact.kind},
            ${artifact.mimeType},
            ${artifact.byteSize},
            ${artifact.sha256}
          )
          ON CONFLICT (tenant_id, project_id, asset_id, kind, sha256) DO NOTHING
        `;
      }
      const assets = await transaction<{ readonly id: string }[]>`
        UPDATE assets
        SET status = ${result.status},
            detected_mime_type = ${result.detectedMimeType},
            rejection_code = ${result.status === "ready" ? null : result.rejectionCode},
            technical_metadata = ${transaction.json(jsonValue(result.technicalMetadata))},
            updated_at = clock_timestamp()
        WHERE tenant_id = ${job.tenantId}::uuid
          AND project_id = ${result.projectId}::uuid
          AND id = ${result.assetId}::uuid
          AND status = 'processing'
        RETURNING id
      `;
      if (assets.length !== 1) {
        throw new Error("Leased asset could not transition to its processing result.");
      }
      await transaction`
        UPDATE asset_processing_jobs
        SET status = 'completed',
            result = ${transaction.json(jsonValue(result))},
            completed_at = clock_timestamp(),
            lease_owner = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            updated_at = clock_timestamp()
        WHERE id = ${job.jobId}::uuid
          AND tenant_id = ${job.tenantId}::uuid
      `;
      await transaction`
        INSERT INTO asset_audit_events (
          id, tenant_id, project_id, asset_id, event_type, details
        )
        VALUES (
          ${randomUUID()}::uuid,
          ${job.tenantId}::uuid,
          ${result.projectId}::uuid,
          ${result.assetId}::uuid,
          'asset.processing-completed',
          ${transaction.json(
            jsonValue({
              jobId: job.jobId,
              rejectionCode: result.status === "ready" ? undefined : result.rejectionCode,
              status: result.status,
              version: result.version,
            }),
          )}
        )
      `;
      return true;
    });
  }

  async retry(
    job: LeasedProcessingJob,
    safeErrorCode: string,
    retryDelayMs: number,
  ): Promise<RetryOutcome> {
    if (!/^[a-z][a-z0-9-]{1,99}$/u.test(safeErrorCode)) {
      throw new Error("Retry error codes must be bounded and non-sensitive.");
    }
    return this.#sql.begin(async (transaction) => {
      const rows = await transaction<LockRow[]>`
        SELECT attempt_count, maximum_attempts
        FROM asset_processing_jobs
        WHERE id = ${job.jobId}::uuid
          AND tenant_id = ${job.tenantId}::uuid
          AND project_id = ${job.command.projectId}::uuid
          AND asset_id = ${job.command.assetId}::uuid
          AND status = 'processing'
          AND lease_owner = ${job.workerId}
          AND lease_token = ${job.leaseToken}::uuid
          AND lease_expires_at > clock_timestamp()
        FOR UPDATE
      `;
      const row = rows[0];
      if (row === undefined) return "lost";
      if (row.attempt_count < Math.min(row.maximum_attempts, 10)) {
        await transaction`
          UPDATE asset_processing_jobs
          SET status = 'retryable',
              available_at = clock_timestamp() + (${retryDelayMs} * interval '1 millisecond'),
              last_error_code = ${safeErrorCode},
              lease_owner = NULL,
              lease_token = NULL,
              lease_expires_at = NULL,
              updated_at = clock_timestamp()
          WHERE id = ${job.jobId}::uuid
            AND tenant_id = ${job.tenantId}::uuid
        `;
        return "retrying";
      }
      await transaction`
        UPDATE asset_processing_jobs
        SET status = 'failed',
            last_error_code = ${safeErrorCode},
            completed_at = clock_timestamp(),
            lease_owner = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            updated_at = clock_timestamp()
        WHERE id = ${job.jobId}::uuid
          AND tenant_id = ${job.tenantId}::uuid
      `;
      await transaction`
        UPDATE assets
        SET status = 'rejected',
            rejection_code = 'processing-failed',
            updated_at = clock_timestamp()
        WHERE tenant_id = ${job.tenantId}::uuid
          AND project_id = ${job.command.projectId}::uuid
          AND id = ${job.command.assetId}::uuid
          AND status = 'processing'
      `;
      await transaction`
        INSERT INTO asset_audit_events (
          id, tenant_id, project_id, asset_id, event_type, details
        )
        VALUES (
          ${randomUUID()}::uuid,
          ${job.tenantId}::uuid,
          ${job.command.projectId}::uuid,
          ${job.command.assetId}::uuid,
          'asset.processing-exhausted',
          ${transaction.json(
            jsonValue({ errorCode: safeErrorCode, jobId: job.jobId, status: "rejected" }),
          )}
        )
      `;
      return "exhausted";
    });
  }
}
