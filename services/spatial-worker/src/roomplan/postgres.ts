import {
  captureProposalResultSchema,
  createCapturePackageRequestSchema,
  type CaptureProposalResult,
  type CreateCapturePackageRequest,
} from "@interior-design/contracts";
import { randomUUID } from "node:crypto";
import type { JSONValue, Sql, TransactionSql } from "postgres";

import { canonicalJson, sha256 } from "./canonical.js";
import type {
  LeasedCaptureArtifact,
  LeasedRoomPlanCapture,
  RoomPlanProcessingFailureCode,
  RoomPlanProcessingQueue,
} from "./types.js";

interface ClaimRow {
  readonly attempt_id: string;
  readonly attempt_number: number;
  readonly attempt_state: string;
  readonly brief_expired: boolean;
  readonly capture_session_id: string;
  readonly manifest_payload: unknown;
  readonly manifest_sha256: string;
  readonly package_id: string;
  readonly project_id: string;
  readonly rights_permitted: boolean;
  readonly session_state: string;
  readonly tenant_id: string;
}

interface ArtifactRow {
  readonly content_type: "application/json" | "model/vnd.usdz+zip";
  readonly id: string;
  readonly kind: LeasedCaptureArtifact["kind"];
  readonly room_id: string | null;
  readonly source_byte_size: number | string;
  readonly source_object_key: string;
  readonly source_sha256: string;
  readonly state: string;
}

interface LeaseRow {
  readonly brief_expired: boolean;
  readonly lease_current: boolean;
  readonly lease_owner: string | null;
  readonly lease_token: string | null;
  readonly rights_permitted: boolean;
  readonly session_state: string;
  readonly state: string;
}

function json(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function safeCode(code: string): string {
  return `CAPTURE_${code.replaceAll("-", "_").toUpperCase()}`.slice(0, 80);
}

function traceId(): string {
  return randomUUID().replaceAll("-", "").slice(0, 32);
}

function artifactSetMatches(
  artifacts: readonly LeasedCaptureArtifact[],
  manifest: CreateCapturePackageRequest,
): boolean {
  const stored = artifacts.map((artifact) => ({
    artifactId: artifact.artifactId,
    byteSize: artifact.byteSize,
    contentType: artifact.contentType,
    kind: artifact.kind,
    ...(artifact.roomId === undefined ? {} : { roomId: artifact.roomId }),
    sha256: artifact.sha256,
  }));
  const expected = manifest.artifacts.map((artifact) => ({
    artifactId: artifact.artifactId,
    byteSize: artifact.byteSize,
    contentType: artifact.contentType,
    kind: artifact.kind,
    ...(artifact.roomId === undefined ? {} : { roomId: artifact.roomId }),
    sha256: artifact.sha256,
  }));
  return (
    canonicalJson(stored.sort(compareArtifact)) === canonicalJson(expected.sort(compareArtifact))
  );
}

function compareArtifact(
  left: { readonly artifactId: string },
  right: { readonly artifactId: string },
): number {
  return left.artifactId.localeCompare(right.artifactId);
}

async function appendWorkerEvent(
  transaction: TransactionSql,
  input: {
    readonly action: string;
    readonly captureSessionId: string;
    readonly metadata: object;
    readonly projectId: string;
    readonly tenantId: string;
    readonly workerId: string;
  },
): Promise<void> {
  const occurredAt = new Date();
  await transaction`
    INSERT INTO capture_audit_events (
      id, tenant_id, project_id, capture_session_id, action, worker_id,
      request_id, trace_id, metadata, occurred_at
    ) VALUES (
      ${randomUUID()}::uuid, ${input.tenantId}::uuid, ${input.projectId}::uuid,
      ${input.captureSessionId}::uuid, ${input.action}, ${input.workerId},
      ${`worker:${input.workerId}`}, ${traceId()},
      ${transaction.json(json(input.metadata))}, ${occurredAt}
    )
  `;
  await transaction`
    INSERT INTO capture_outbox (
      id, tenant_id, project_id, capture_session_id, event_type,
      schema_version, payload, occurred_at
    ) VALUES (
      ${randomUUID()}::uuid, ${input.tenantId}::uuid, ${input.projectId}::uuid,
      ${input.captureSessionId}::uuid, ${input.action}, 'c7-capture-session-v1',
      ${transaction.json(json(input.metadata))}, ${occurredAt}
    )
  `;
}

export class PostgresRoomPlanProcessingQueue implements RoomPlanProcessingQueue {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async claimNext(
    workerId: string,
    leaseMilliseconds: number,
  ): Promise<LeasedRoomPlanCapture | undefined> {
    return this.#sql.begin(async (transaction) => {
      const abandoned = await transaction<
        Array<{
          readonly capture_session_id: string;
          readonly id: string;
          readonly project_id: string;
          readonly tenant_id: string;
        }>
      >`
        SELECT tenant_id, project_id, capture_session_id, id
        FROM capture_processing_attempts
        WHERE state = 'cancel-requested' AND lease_expires_at <= clock_timestamp()
        ORDER BY updated_at ASC, id ASC
        LIMIT 20 FOR UPDATE SKIP LOCKED
      `;
      for (const attempt of abandoned) {
        await transaction`
          UPDATE capture_processing_attempts
          SET state = 'cancelled', lease_owner = NULL, lease_token = NULL,
              lease_expires_at = NULL, updated_at = clock_timestamp(), version = version + 1
          WHERE tenant_id = ${attempt.tenant_id}::uuid
            AND project_id = ${attempt.project_id}::uuid
            AND capture_session_id = ${attempt.capture_session_id}::uuid
            AND id = ${attempt.id}::uuid
            AND state = 'cancel-requested'
        `;
        await transaction`
          UPDATE capture_sessions
          SET state = 'cancelled', updated_at = clock_timestamp(), version = version + 1
          WHERE tenant_id = ${attempt.tenant_id}::uuid
            AND project_id = ${attempt.project_id}::uuid
            AND id = ${attempt.capture_session_id}::uuid
            AND state = 'cancel-requested'
        `;
        await appendWorkerEvent(transaction, {
          action: "capture.process.cancel",
          captureSessionId: attempt.capture_session_id,
          metadata: { state: "cancelled" },
          projectId: attempt.project_id,
          tenantId: attempt.tenant_id,
          workerId,
        });
      }

      for (let inspected = 0; inspected < 20; inspected += 1) {
        const rows = await transaction<ClaimRow[]>`
          SELECT a.tenant_id, a.project_id, a.capture_session_id,
            a.id AS attempt_id, a.attempt_number, a.state AS attempt_state,
            a.package_id, p.manifest_sha256, p.manifest_payload,
            s.state AS session_state,
            (b.expires_at <= clock_timestamp()) AS brief_expired,
            NOT EXISTS (
              SELECT 1 FROM capture_rights_events denied
              WHERE denied.tenant_id = s.tenant_id
                AND denied.project_id = s.project_id
                AND denied.capture_session_id = s.id
                AND NOT denied.permitted
            ) AS rights_permitted
          FROM capture_processing_attempts a
          JOIN capture_sessions s
            ON s.tenant_id = a.tenant_id
           AND s.project_id = a.project_id
           AND s.id = a.capture_session_id
          JOIN capture_briefs b
            ON b.tenant_id = s.tenant_id
           AND b.project_id = s.project_id
           AND b.capture_session_id = s.id
          JOIN capture_packages p
            ON p.tenant_id = a.tenant_id
           AND p.project_id = a.project_id
           AND p.capture_session_id = a.capture_session_id
           AND p.id = a.package_id
          WHERE (a.state = 'queued' AND a.available_at <= clock_timestamp())
             OR (a.state = 'leased' AND a.lease_expires_at <= clock_timestamp())
          ORDER BY a.available_at ASC, a.created_at ASC, a.id ASC
          LIMIT 1 FOR UPDATE OF a, s SKIP LOCKED
        `;
        const row = rows[0];
        if (row === undefined) return undefined;
        if (row.session_state === "cancel-requested" || row.session_state === "cancelled") {
          await this.#cancelLocked(transaction, row, workerId);
          continue;
        }
        if (!row.rights_permitted || row.brief_expired) {
          await this.#failLocked(
            transaction,
            row,
            workerId,
            row.rights_permitted ? "CAPTURE_BRIEF_EXPIRED" : "CAPTURE_RIGHTS_NOT_PERMITTED",
            false,
          );
          continue;
        }
        if (
          !(["uploaded", "processing"] as const).includes(
            row.session_state as "processing" | "uploaded",
          )
        ) {
          await this.#failLocked(
            transaction,
            row,
            workerId,
            "CAPTURE_SESSION_STATE_INVALID",
            false,
          );
          continue;
        }
        const parsedManifest = createCapturePackageRequestSchema.safeParse(row.manifest_payload);
        if (
          !parsedManifest.success ||
          sha256(parsedManifest.data) !== row.manifest_sha256 ||
          parsedManifest.data.captureSessionId !== row.capture_session_id ||
          parsedManifest.data.projectId !== row.project_id
        ) {
          await this.#failLocked(transaction, row, workerId, "CAPTURE_SOURCE_MISMATCH", false);
          continue;
        }
        const artifactRows = await transaction<ArtifactRow[]>`
          SELECT id, kind, content_type, room_id, source_byte_size, source_sha256,
            source_object_key, state
          FROM capture_artifacts
          WHERE tenant_id = ${row.tenant_id}::uuid
            AND project_id = ${row.project_id}::uuid
            AND capture_session_id = ${row.capture_session_id}::uuid
          ORDER BY id ASC
          FOR SHARE
        `;
        const artifacts: LeasedCaptureArtifact[] = artifactRows.map((artifact) => ({
          artifactId: artifact.id,
          byteSize: Number(artifact.source_byte_size),
          contentType: artifact.content_type,
          kind: artifact.kind,
          objectKey: artifact.source_object_key,
          ...(artifact.room_id === null ? {} : { roomId: artifact.room_id }),
          sha256: artifact.source_sha256,
        }));
        if (
          artifactRows.some(({ state }) => state !== "uploaded") ||
          !artifactSetMatches(artifacts, parsedManifest.data)
        ) {
          await this.#failLocked(transaction, row, workerId, "CAPTURE_SOURCE_MISMATCH", false);
          continue;
        }
        const leaseToken = randomUUID();
        const updated = await transaction<Array<{ readonly lease_expires_at: Date | string }>>`
          UPDATE capture_processing_attempts
          SET state = 'leased', lease_owner = ${workerId}, lease_token = ${leaseToken}::uuid,
              lease_expires_at = clock_timestamp() + (${leaseMilliseconds} * interval '1 millisecond'),
              retryable = false, safe_code = NULL,
              updated_at = clock_timestamp(), version = version + 1
          WHERE tenant_id = ${row.tenant_id}::uuid
            AND project_id = ${row.project_id}::uuid
            AND capture_session_id = ${row.capture_session_id}::uuid
            AND id = ${row.attempt_id}::uuid
            AND (state = 'queued' OR (state = 'leased' AND lease_expires_at <= clock_timestamp()))
          RETURNING lease_expires_at
        `;
        const lease = updated[0];
        if (lease === undefined) continue;
        if (row.session_state === "uploaded") {
          await transaction`
            UPDATE capture_sessions
            SET state = 'processing', updated_at = clock_timestamp(), version = version + 1
            WHERE tenant_id = ${row.tenant_id}::uuid
              AND project_id = ${row.project_id}::uuid
              AND id = ${row.capture_session_id}::uuid
              AND state = 'uploaded'
          `;
        }
        await appendWorkerEvent(transaction, {
          action: "capture.process.lease",
          captureSessionId: row.capture_session_id,
          metadata: { attempt: row.attempt_number, state: "processing" },
          projectId: row.project_id,
          tenantId: row.tenant_id,
          workerId,
        });
        return {
          artifacts,
          attempt: row.attempt_number,
          attemptId: row.attempt_id,
          captureSessionId: row.capture_session_id,
          leaseExpiresAt: new Date(lease.lease_expires_at).toISOString(),
          leaseToken,
          manifest: parsedManifest.data,
          packageId: row.package_id,
          packageManifestSha256: row.manifest_sha256,
          projectId: row.project_id,
          tenantId: row.tenant_id,
        };
      }
      return undefined;
    });
  }

  async heartbeat(
    job: LeasedRoomPlanCapture,
    workerId: string,
    leaseMilliseconds: number,
  ): Promise<"cancel-requested" | "leased" | "lost"> {
    return this.#sql.begin(async (transaction) => {
      const row = await this.#lockedLease(transaction, job);
      if (row === undefined || row.lease_owner !== workerId || row.lease_token !== job.leaseToken) {
        return "lost";
      }
      if (row.state === "cancel-requested" || row.session_state === "cancel-requested") {
        return "cancel-requested";
      }
      if (
        row.state !== "leased" ||
        row.session_state !== "processing" ||
        !row.lease_current ||
        row.brief_expired ||
        !row.rights_permitted
      ) {
        return "lost";
      }
      const updated = await transaction<{ readonly id: string }[]>`
        UPDATE capture_processing_attempts
        SET lease_expires_at = clock_timestamp() + (${leaseMilliseconds} * interval '1 millisecond'),
            updated_at = clock_timestamp(), version = version + 1
        WHERE tenant_id = ${job.tenantId}::uuid
          AND project_id = ${job.projectId}::uuid
          AND capture_session_id = ${job.captureSessionId}::uuid
          AND id = ${job.attemptId}::uuid
          AND state = 'leased' AND lease_owner = ${workerId}
          AND lease_token = ${job.leaseToken}::uuid
          AND lease_expires_at > clock_timestamp()
        RETURNING id
      `;
      return updated.length === 1 ? "leased" : "lost";
    });
  }

  async acknowledgeCancellation(job: LeasedRoomPlanCapture, workerId: string): Promise<boolean> {
    return this.#sql.begin(async (transaction) => {
      const attempts = await transaction<{ readonly id: string }[]>`
        UPDATE capture_processing_attempts
        SET state = 'cancelled', lease_owner = NULL, lease_token = NULL,
            lease_expires_at = NULL, updated_at = clock_timestamp(), version = version + 1
        WHERE tenant_id = ${job.tenantId}::uuid
          AND project_id = ${job.projectId}::uuid
          AND capture_session_id = ${job.captureSessionId}::uuid
          AND id = ${job.attemptId}::uuid
          AND state = 'cancel-requested' AND lease_owner = ${workerId}
          AND lease_token = ${job.leaseToken}::uuid
        RETURNING id
      `;
      if (attempts.length !== 1) return false;
      await transaction`
        UPDATE capture_sessions
        SET state = 'cancelled', updated_at = clock_timestamp(), version = version + 1
        WHERE tenant_id = ${job.tenantId}::uuid
          AND project_id = ${job.projectId}::uuid
          AND id = ${job.captureSessionId}::uuid
          AND state = 'cancel-requested'
      `;
      await appendWorkerEvent(transaction, {
        action: "capture.process.cancel",
        captureSessionId: job.captureSessionId,
        metadata: { attempt: job.attempt, state: "cancelled" },
        projectId: job.projectId,
        tenantId: job.tenantId,
        workerId,
      });
      return true;
    });
  }

  async publish(
    job: LeasedRoomPlanCapture,
    workerId: string,
    input: CaptureProposalResult,
  ): Promise<boolean> {
    const result = captureProposalResultSchema.parse(input);
    const normalized = job.artifacts.find(({ kind }) => kind === "roomplan-normalized-json");
    if (
      normalized === undefined ||
      result.captureSessionId !== job.captureSessionId ||
      result.projectId !== job.projectId ||
      result.packageId !== job.packageId ||
      result.packageManifestSha256 !== job.packageManifestSha256 ||
      result.converter.normalizedInputSha256 !== normalized.sha256
    ) {
      return false;
    }
    return this.#sql.begin(async (transaction) => {
      const lease = await this.#lockedLease(transaction, job);
      if (
        lease === undefined ||
        lease.state !== "leased" ||
        lease.session_state !== "processing" ||
        lease.lease_owner !== workerId ||
        lease.lease_token !== job.leaseToken ||
        !lease.lease_current ||
        lease.brief_expired ||
        !lease.rights_permitted
      ) {
        return false;
      }
      const existing = await transaction<{ readonly id: string }[]>`
        SELECT id FROM capture_results
        WHERE tenant_id = ${job.tenantId}::uuid
          AND project_id = ${job.projectId}::uuid
          AND capture_session_id = ${job.captureSessionId}::uuid
        LIMIT 1
      `;
      if (existing.length !== 0) return false;
      const resultSha256 = sha256(result);
      await transaction`
        INSERT INTO capture_results (
          tenant_id, project_id, capture_session_id, package_id, attempt_id, id,
          status, normalized_input_sha256, package_manifest_sha256,
          converter_manifest_sha256, result_sha256, result_payload, created_at
        ) VALUES (
          ${job.tenantId}::uuid, ${job.projectId}::uuid, ${job.captureSessionId}::uuid,
          ${job.packageId}::uuid, ${job.attemptId}::uuid, ${result.proposalId}::uuid,
          ${result.status}, ${result.converter.normalizedInputSha256},
          ${result.packageManifestSha256}, ${result.converter.manifestSha256},
          ${resultSha256}, ${transaction.json(json(result))}, ${new Date(result.createdAt)}
        )
      `;
      await transaction`
        UPDATE capture_processing_attempts
        SET state = 'succeeded', lease_owner = NULL, lease_token = NULL,
            lease_expires_at = NULL, updated_at = clock_timestamp(), version = version + 1
        WHERE tenant_id = ${job.tenantId}::uuid
          AND project_id = ${job.projectId}::uuid
          AND capture_session_id = ${job.captureSessionId}::uuid
          AND id = ${job.attemptId}::uuid
          AND state = 'leased' AND lease_owner = ${workerId}
          AND lease_token = ${job.leaseToken}::uuid
          AND lease_expires_at > clock_timestamp()
      `;
      const state = result.status === "proposal" ? "proposed" : "abstained";
      await transaction`
        UPDATE capture_sessions
        SET state = ${state}, result_id = ${result.proposalId}::uuid,
            proposal_id = ${result.status === "proposal" ? result.proposalId : null}::uuid,
            safe_code = ${result.status === "abstained" ? safeCode(result.code) : null},
            retryable = false, updated_at = clock_timestamp(), version = version + 1
        WHERE tenant_id = ${job.tenantId}::uuid
          AND project_id = ${job.projectId}::uuid
          AND id = ${job.captureSessionId}::uuid
          AND state = 'processing'
      `;
      await appendWorkerEvent(transaction, {
        action: "capture.process.publish",
        captureSessionId: job.captureSessionId,
        metadata: {
          attempt: job.attempt,
          resultId: result.proposalId,
          resultSha256,
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
    job: LeasedRoomPlanCapture,
    workerId: string,
    code: RoomPlanProcessingFailureCode,
    retryable: boolean,
  ): Promise<boolean> {
    return this.#sql.begin(async (transaction) => {
      const current = await this.#lockedLease(transaction, job);
      if (
        current === undefined ||
        current.lease_owner !== workerId ||
        current.lease_token !== job.leaseToken
      ) {
        return false;
      }
      if (current.state === "cancel-requested" || current.session_state === "cancel-requested") {
        const cancelled = await transaction<{ readonly id: string }[]>`
          UPDATE capture_processing_attempts
          SET state = 'cancelled', lease_owner = NULL, lease_token = NULL,
              lease_expires_at = NULL, updated_at = clock_timestamp(), version = version + 1
          WHERE tenant_id = ${job.tenantId}::uuid
            AND project_id = ${job.projectId}::uuid
            AND capture_session_id = ${job.captureSessionId}::uuid
            AND id = ${job.attemptId}::uuid
            AND state IN ('leased', 'cancel-requested')
          RETURNING id
        `;
        if (cancelled.length !== 1) return false;
        await transaction`
          UPDATE capture_sessions
          SET state = 'cancelled', updated_at = clock_timestamp(), version = version + 1
          WHERE tenant_id = ${job.tenantId}::uuid
            AND project_id = ${job.projectId}::uuid
            AND id = ${job.captureSessionId}::uuid
            AND state = 'cancel-requested'
        `;
        return true;
      }
      if (
        current.state !== "leased" ||
        current.session_state !== "processing" ||
        !current.lease_current
      ) {
        return false;
      }
      const canRetry = retryable && job.attempt < 3;
      const failureCode = safeCode(code);
      const updated = await transaction<{ readonly id: string }[]>`
        UPDATE capture_processing_attempts
        SET state = 'failed', safe_code = ${failureCode}, retryable = ${canRetry},
            lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
            updated_at = clock_timestamp(), version = version + 1
        WHERE tenant_id = ${job.tenantId}::uuid
          AND project_id = ${job.projectId}::uuid
          AND capture_session_id = ${job.captureSessionId}::uuid
          AND id = ${job.attemptId}::uuid
          AND state = 'leased' AND lease_owner = ${workerId}
          AND lease_token = ${job.leaseToken}::uuid
          AND lease_expires_at > clock_timestamp()
        RETURNING id
      `;
      if (updated.length !== 1) return false;
      await transaction`
        UPDATE capture_sessions
        SET state = 'failed', safe_code = ${failureCode}, retryable = ${canRetry},
            updated_at = clock_timestamp(), version = version + 1
        WHERE tenant_id = ${job.tenantId}::uuid
          AND project_id = ${job.projectId}::uuid
          AND id = ${job.captureSessionId}::uuid
          AND state = 'processing'
      `;
      await appendWorkerEvent(transaction, {
        action: "capture.process.fail",
        captureSessionId: job.captureSessionId,
        metadata: {
          attempt: job.attempt,
          retryable: canRetry,
          safeCode: failureCode,
          state: "failed",
        },
        projectId: job.projectId,
        tenantId: job.tenantId,
        workerId,
      });
      return true;
    });
  }

  async #lockedLease(
    transaction: TransactionSql,
    job: LeasedRoomPlanCapture,
  ): Promise<LeaseRow | undefined> {
    const rows = await transaction<LeaseRow[]>`
      SELECT a.state, a.lease_owner, a.lease_token,
        COALESCE(a.lease_expires_at > clock_timestamp(), false) AS lease_current,
        s.state AS session_state,
        (b.expires_at <= clock_timestamp()) AS brief_expired,
        NOT EXISTS (
          SELECT 1 FROM capture_rights_events denied
          WHERE denied.tenant_id = s.tenant_id
            AND denied.project_id = s.project_id
            AND denied.capture_session_id = s.id
            AND NOT denied.permitted
        ) AS rights_permitted
      FROM capture_processing_attempts a
      JOIN capture_sessions s
        ON s.tenant_id = a.tenant_id
       AND s.project_id = a.project_id
       AND s.id = a.capture_session_id
      JOIN capture_briefs b
        ON b.tenant_id = s.tenant_id
       AND b.project_id = s.project_id
       AND b.capture_session_id = s.id
      WHERE a.tenant_id = ${job.tenantId}::uuid
        AND a.project_id = ${job.projectId}::uuid
        AND a.capture_session_id = ${job.captureSessionId}::uuid
        AND a.id = ${job.attemptId}::uuid
      LIMIT 1 FOR UPDATE OF a, s
    `;
    return rows[0];
  }

  async #cancelLocked(transaction: TransactionSql, row: ClaimRow, workerId: string): Promise<void> {
    await transaction`
      UPDATE capture_processing_attempts
      SET state = 'cancelled', lease_owner = NULL, lease_token = NULL,
          lease_expires_at = NULL, updated_at = clock_timestamp(), version = version + 1
      WHERE tenant_id = ${row.tenant_id}::uuid
        AND project_id = ${row.project_id}::uuid
        AND capture_session_id = ${row.capture_session_id}::uuid
        AND id = ${row.attempt_id}::uuid
        AND state IN ('queued', 'leased')
    `;
    if (row.session_state === "cancel-requested") {
      await transaction`
        UPDATE capture_sessions
        SET state = 'cancelled', updated_at = clock_timestamp(), version = version + 1
        WHERE tenant_id = ${row.tenant_id}::uuid
          AND project_id = ${row.project_id}::uuid
          AND id = ${row.capture_session_id}::uuid
          AND state = 'cancel-requested'
      `;
    }
    await appendWorkerEvent(transaction, {
      action: "capture.process.cancel",
      captureSessionId: row.capture_session_id,
      metadata: { attempt: row.attempt_number, state: "cancelled" },
      projectId: row.project_id,
      tenantId: row.tenant_id,
      workerId,
    });
  }

  async #failLocked(
    transaction: TransactionSql,
    row: ClaimRow,
    workerId: string,
    code: string,
    retryable: boolean,
  ): Promise<void> {
    await transaction`
      UPDATE capture_processing_attempts
      SET state = 'failed', safe_code = ${code}, retryable = ${retryable},
          lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
          updated_at = clock_timestamp(), version = version + 1
      WHERE tenant_id = ${row.tenant_id}::uuid
        AND project_id = ${row.project_id}::uuid
        AND capture_session_id = ${row.capture_session_id}::uuid
        AND id = ${row.attempt_id}::uuid
        AND state IN ('queued', 'leased')
    `;
    await transaction`
      UPDATE capture_sessions
      SET state = 'failed', safe_code = ${code}, retryable = ${retryable},
          updated_at = clock_timestamp(), version = version + 1
      WHERE tenant_id = ${row.tenant_id}::uuid
        AND project_id = ${row.project_id}::uuid
        AND id = ${row.capture_session_id}::uuid
        AND state IN ('uploaded', 'processing')
    `;
    await appendWorkerEvent(transaction, {
      action: "capture.process.fail",
      captureSessionId: row.capture_session_id,
      metadata: { attempt: row.attempt_number, retryable, safeCode: code, state: "failed" },
      projectId: row.project_id,
      tenantId: row.tenant_id,
      workerId,
    });
  }
}
