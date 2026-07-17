import {
  assetProcessingCommandSchema,
  assetProcessingResultSchema,
  type AssetProcessingCommand,
  type AssetProcessingResult,
} from "@interior-design/contracts";
import { randomUUID } from "node:crypto";
import type { JSONValue, Sql, TransactionSql } from "postgres";

import { requestHash } from "../projects/idempotency.js";
import type {
  AssetProcessingJobRepository,
  CompleteProcessingJobCommand,
  FailProcessingJobCommand,
  LeasedAssetProcessingJob,
} from "./types.js";

interface ClaimableJobRow {
  readonly asset_id: string;
  readonly attempt_count: number;
  readonly command: unknown;
  readonly id: string;
  readonly maximum_attempts: number;
  readonly project_id: string;
  readonly tenant_id: string;
}

interface CompletionJobRow extends ClaimableJobRow {
  readonly lease_expires_at: Date | string | null;
  readonly lease_owner: string | null;
  readonly result: unknown;
  readonly status: string;
}

interface StoredArtifactRow {
  readonly asset_id: string;
  readonly bucket: string;
  readonly byte_size: number;
  readonly kind: string;
  readonly mime_type: string;
  readonly object_key: string;
  readonly project_id: string;
  readonly sha256: string;
  readonly tenant_id: string;
}

const WORKER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,119}$/u;
const SAFE_ERROR_CODE_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/u;

function jsonValue(value: object): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function validateWorkerId(workerId: string): void {
  if (!WORKER_ID_PATTERN.test(workerId)) {
    throw new Error("Worker IDs must be bounded opaque identifiers.");
  }
}

function validateLeaseSeconds(leaseSeconds: number): void {
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 900) {
    throw new Error("Processing job leases must be between 30 and 900 seconds.");
  }
}

function validateFailure(command: FailProcessingJobCommand): void {
  validateWorkerId(command.workerId);
  if (!SAFE_ERROR_CODE_PATTERN.test(command.errorCode)) {
    throw new Error("Processing failures require a bounded safe error code.");
  }
  if (
    !Number.isInteger(command.retryDelaySeconds) ||
    command.retryDelaySeconds < 0 ||
    command.retryDelaySeconds > 86_400
  ) {
    throw new Error("Processing retry delay must be between zero and one day.");
  }
}

async function insertWorkerAudit(
  transaction: TransactionSql,
  row: Pick<ClaimableJobRow, "asset_id" | "id" | "project_id" | "tenant_id">,
  workerId: string,
  action: string,
): Promise<void> {
  await transaction`
    INSERT INTO asset_audit_events (
      id,
      tenant_id,
      project_id,
      asset_id,
      actor_kind,
      actor_identifier,
      action,
      resource_type,
      resource_id
    )
    VALUES (
      ${randomUUID()}::uuid,
      ${row.tenant_id}::uuid,
      ${row.project_id}::uuid,
      ${row.asset_id}::uuid,
      'worker',
      ${workerId},
      ${action},
      'processing-job',
      ${row.id}::uuid
    )
  `;
}

export class PostgresAssetProcessingJobRepository implements AssetProcessingJobRepository {
  readonly #now: () => Date;
  readonly #sql: Sql;

  constructor(sql: Sql, options: { readonly now?: () => Date } = {}) {
    this.#sql = sql;
    this.#now = options.now ?? (() => new Date());
  }

  async claimNext(
    workerId: string,
    leaseSeconds = 300,
  ): Promise<LeasedAssetProcessingJob | undefined> {
    validateWorkerId(workerId);
    validateLeaseSeconds(leaseSeconds);
    return this.#sql.begin(async (transaction) => {
      const exhaustedRows = await transaction<ClaimableJobRow[]>`
        SELECT id, tenant_id, project_id, asset_id, command, attempt_count, maximum_attempts
        FROM asset_processing_jobs
        WHERE status = 'leased'
          AND lease_expires_at <= ${this.#now()}
          AND attempt_count >= maximum_attempts
        ORDER BY lease_expires_at ASC, id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
      const exhausted = exhaustedRows[0];
      if (exhausted !== undefined) {
        await transaction`
          UPDATE asset_processing_jobs
          SET status = 'failed',
              lease_owner = NULL,
              lease_expires_at = NULL,
              last_error_code = 'lease-attempts-exhausted',
              updated_at = clock_timestamp(),
              completed_at = clock_timestamp()
          WHERE tenant_id = ${exhausted.tenant_id}::uuid
            AND project_id = ${exhausted.project_id}::uuid
            AND id = ${exhausted.id}::uuid
            AND status = 'leased'
        `;
        await transaction`
          UPDATE assets
          SET status = 'rejected',
              rejection_code = 'processing-failed'
          WHERE tenant_id = ${exhausted.tenant_id}::uuid
            AND project_id = ${exhausted.project_id}::uuid
            AND id = ${exhausted.asset_id}::uuid
            AND status = 'processing'
        `;
        await insertWorkerAudit(
          transaction,
          exhausted,
          workerId,
          "asset.processing.lease-exhausted",
        );
      }

      const rows = await transaction<ClaimableJobRow[]>`
        SELECT id, tenant_id, project_id, asset_id, command, attempt_count, maximum_attempts
        FROM asset_processing_jobs
        WHERE attempt_count < maximum_attempts
          AND (
            (status IN ('queued', 'retryable') AND available_at <= ${this.#now()})
            OR (status = 'leased' AND lease_expires_at <= ${this.#now()})
          )
        ORDER BY available_at ASC, created_at ASC, id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
      const row = rows[0];
      if (row === undefined) {
        return undefined;
      }

      const attempt = row.attempt_count + 1;
      const stored = assetProcessingCommandSchema.parse(row.command);
      const command: AssetProcessingCommand = assetProcessingCommandSchema.parse({
        ...stored,
        attempt,
      });
      const leaseExpiresAt = new Date(this.#now().getTime() + leaseSeconds * 1_000);
      const updated = await transaction<{ readonly id: string }[]>`
        UPDATE asset_processing_jobs
        SET status = 'leased',
            command = ${transaction.json(jsonValue(command))},
            attempt_count = ${attempt},
            lease_owner = ${workerId},
            lease_expires_at = ${leaseExpiresAt},
            updated_at = clock_timestamp()
        WHERE tenant_id = ${row.tenant_id}::uuid
          AND project_id = ${row.project_id}::uuid
          AND id = ${row.id}::uuid
        RETURNING id
      `;
      if (updated.length !== 1) {
        throw new Error("Processing job claim did not update exactly one row.");
      }
      const asset = await transaction<{ readonly id: string }[]>`
        UPDATE assets
        SET status = 'processing'
        WHERE tenant_id = ${row.tenant_id}::uuid
          AND project_id = ${row.project_id}::uuid
          AND id = ${row.asset_id}::uuid
          AND status = 'uploaded'
        RETURNING id
      `;
      if (asset.length === 0) {
        const current = await transaction<{ readonly status: string }[]>`
          SELECT status
          FROM assets
          WHERE tenant_id = ${row.tenant_id}::uuid
            AND project_id = ${row.project_id}::uuid
            AND id = ${row.asset_id}::uuid
          LIMIT 1
        `;
        if (current[0]?.status !== "processing") {
          throw new Error("Claimed processing job does not have a processable asset.");
        }
      }
      await insertWorkerAudit(transaction, row, workerId, "asset.processing.claim");
      return {
        command,
        jobId: row.id,
        leaseExpiresAt: leaseExpiresAt.toISOString(),
      };
    });
  }

  async complete(command: CompleteProcessingJobCommand): Promise<void> {
    validateWorkerId(command.workerId);
    const result = assetProcessingResultSchema.parse(command.result);
    await this.#sql.begin(async (transaction) => {
      const rows = await transaction<CompletionJobRow[]>`
        SELECT
          id,
          tenant_id,
          project_id,
          asset_id,
          command,
          result,
          status,
          attempt_count,
          maximum_attempts,
          lease_owner,
          lease_expires_at
        FROM asset_processing_jobs
        WHERE id = ${command.jobId}::uuid
          AND project_id = ${result.projectId}::uuid
          AND asset_id = ${result.assetId}::uuid
        LIMIT 1
        FOR UPDATE
      `;
      const row = rows[0];
      if (row === undefined) {
        throw new Error("Processing job was not found.");
      }
      const storedCommand = assetProcessingCommandSchema.parse(row.command);
      if (
        storedCommand.projectId !== result.projectId ||
        storedCommand.assetId !== result.assetId ||
        storedCommand.expected.byteSize !== result.verifiedSource.byteSize ||
        storedCommand.expected.sha256 !== result.verifiedSource.sha256
      ) {
        throw new Error("Processing result does not match its immutable source command.");
      }
      for (const artifact of result.artifacts) {
        if (
          !artifact.key.startsWith(`${storedCommand.destinations.prefix}/`) ||
          !artifact.key.includes(artifact.sha256)
        ) {
          throw new Error("Derived artifacts must be content-addressed under the assigned prefix.");
        }
      }
      if (row.status === "succeeded") {
        if (requestHash(row.result) !== requestHash(result)) {
          throw new Error("Processing job result conflicts with its committed result.");
        }
        return;
      }
      if (
        row.status !== "leased" ||
        row.lease_owner !== command.workerId ||
        row.lease_expires_at === null ||
        new Date(row.lease_expires_at).getTime() <= this.#now().getTime()
      ) {
        throw new Error("Processing job lease is not active for this worker.");
      }

      const artifactBucket = result.status === "ready" ? "derived" : "quarantine";
      for (const artifact of result.artifacts) {
        await transaction`
          INSERT INTO derived_asset_artifacts (
            id,
            tenant_id,
            project_id,
            asset_id,
            bucket,
            object_key,
            kind,
            mime_type,
            byte_size,
            sha256
          )
          VALUES (
            ${randomUUID()}::uuid,
            ${row.tenant_id}::uuid,
            ${row.project_id}::uuid,
            ${row.asset_id}::uuid,
            ${artifactBucket},
            ${artifact.key},
            ${artifact.kind},
            ${artifact.mimeType},
            ${artifact.byteSize},
            ${artifact.sha256}
          )
          ON CONFLICT DO NOTHING
        `;
        const storedRows = await transaction<StoredArtifactRow[]>`
          SELECT
            tenant_id,
            project_id,
            asset_id,
            bucket,
            object_key,
            kind,
            mime_type,
            byte_size,
            sha256
          FROM derived_asset_artifacts
          WHERE tenant_id = ${row.tenant_id}::uuid
            AND project_id = ${row.project_id}::uuid
            AND asset_id = ${row.asset_id}::uuid
            AND object_key = ${artifact.key}
          LIMIT 1
        `;
        const stored = storedRows[0];
        if (
          stored === undefined ||
          stored.tenant_id !== row.tenant_id ||
          stored.project_id !== row.project_id ||
          stored.asset_id !== row.asset_id ||
          stored.bucket !== artifactBucket ||
          stored.kind !== artifact.kind ||
          stored.mime_type !== artifact.mimeType ||
          stored.byte_size !== artifact.byteSize ||
          stored.sha256 !== artifact.sha256
        ) {
          throw new Error("Derived artifact key conflicts with immutable stored content.");
        }
      }

      const asset = await transaction<{ readonly id: string }[]>`
        UPDATE assets
        SET status = ${result.status},
            detected_mime_type = ${result.detectedMimeType},
            rejection_code = ${"rejectionCode" in result ? result.rejectionCode : null}
        WHERE tenant_id = ${row.tenant_id}::uuid
          AND project_id = ${row.project_id}::uuid
          AND id = ${row.asset_id}::uuid
          AND status = 'processing'
        RETURNING id
      `;
      if (asset.length !== 1) {
        throw new Error("Processing result could not transition exactly one asset.");
      }
      const job = await transaction<{ readonly id: string }[]>`
        UPDATE asset_processing_jobs
        SET status = 'succeeded',
            result = ${transaction.json(jsonValue(result))},
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = clock_timestamp(),
            completed_at = clock_timestamp()
        WHERE tenant_id = ${row.tenant_id}::uuid
          AND project_id = ${row.project_id}::uuid
          AND id = ${row.id}::uuid
          AND status = 'leased'
        RETURNING id
      `;
      if (job.length !== 1) {
        throw new Error("Processing result could not complete exactly one job.");
      }
      await insertWorkerAudit(transaction, row, command.workerId, "asset.processing.complete");
    });
  }

  async fail(command: FailProcessingJobCommand): Promise<"failed" | "retryable"> {
    validateFailure(command);
    return this.#sql.begin(async (transaction) => {
      const rows = await transaction<CompletionJobRow[]>`
        SELECT
          id,
          tenant_id,
          project_id,
          asset_id,
          command,
          result,
          status,
          attempt_count,
          maximum_attempts,
          lease_owner,
          lease_expires_at
        FROM asset_processing_jobs
        WHERE id = ${command.jobId}::uuid
        LIMIT 1
        FOR UPDATE
      `;
      const row = rows[0];
      if (row === undefined) {
        throw new Error("Processing job was not found.");
      }
      if (row.status === "failed") {
        return "failed";
      }
      if (row.status === "retryable") {
        return "retryable";
      }
      if (
        row.status !== "leased" ||
        row.lease_owner !== command.workerId ||
        row.lease_expires_at === null ||
        new Date(row.lease_expires_at).getTime() <= this.#now().getTime()
      ) {
        throw new Error("Processing job lease is not active for this worker.");
      }

      if (row.attempt_count >= row.maximum_attempts) {
        await transaction`
          UPDATE asset_processing_jobs
          SET status = 'failed',
              lease_owner = NULL,
              lease_expires_at = NULL,
              last_error_code = ${command.errorCode},
              updated_at = clock_timestamp(),
              completed_at = clock_timestamp()
          WHERE tenant_id = ${row.tenant_id}::uuid
            AND project_id = ${row.project_id}::uuid
            AND id = ${row.id}::uuid
            AND status = 'leased'
        `;
        await transaction`
          UPDATE assets
          SET status = 'rejected',
              rejection_code = 'processing-failed'
          WHERE tenant_id = ${row.tenant_id}::uuid
            AND project_id = ${row.project_id}::uuid
            AND id = ${row.asset_id}::uuid
            AND status = 'processing'
        `;
        await insertWorkerAudit(transaction, row, command.workerId, "asset.processing.fail");
        return "failed";
      }

      await transaction`
        UPDATE asset_processing_jobs
        SET status = 'retryable',
            lease_owner = NULL,
            lease_expires_at = NULL,
            last_error_code = ${command.errorCode},
            available_at = clock_timestamp() + (${command.retryDelaySeconds} * interval '1 second'),
            updated_at = clock_timestamp()
        WHERE tenant_id = ${row.tenant_id}::uuid
          AND project_id = ${row.project_id}::uuid
          AND id = ${row.id}::uuid
          AND status = 'leased'
      `;
      await insertWorkerAudit(transaction, row, command.workerId, "asset.processing.retry");
      return "retryable";
    });
  }
}

export function parseProcessingCommand(value: unknown): AssetProcessingCommand {
  return assetProcessingCommandSchema.parse(value);
}

export function parseProcessingResult(value: unknown): AssetProcessingResult {
  return assetProcessingResultSchema.parse(value);
}
