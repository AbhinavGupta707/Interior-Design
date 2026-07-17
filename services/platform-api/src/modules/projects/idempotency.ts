import { createHash } from "node:crypto";
import type { JSONValue, TransactionSql } from "postgres";

import { ApiError } from "../../errors.js";

export interface IdempotencyClaim {
  readonly actorUserId: string;
  readonly idempotencyKey: string;
  readonly operation: string;
  readonly requestBody: unknown;
  readonly tenantId: string;
}

export type IdempotencyResult =
  | { readonly kind: "claimed" }
  | { readonly body: unknown; readonly kind: "replay"; readonly status: number };

interface StoredIdempotencyRow {
  readonly actor_user_id: string;
  readonly operation: string;
  readonly request_hash: string;
  readonly response_body: unknown;
  readonly response_status: number | null;
}

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  throw new Error("Unsupported idempotency payload value.");
}

export function requestHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function parseIdempotencyKey(value: string | readonly string[] | undefined): string {
  if (typeof value !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new ApiError({
      code: "INVALID_IDEMPOTENCY_KEY",
      detail: "A valid Idempotency-Key header is required.",
      statusCode: 400,
      title: "Invalid Idempotency Key",
    });
  }
  return value;
}

export async function claimIdempotency(
  transaction: TransactionSql,
  claim: IdempotencyClaim,
): Promise<IdempotencyResult> {
  const hash = requestHash(claim.requestBody);
  const inserted = await transaction<{ readonly idempotency_key: string }[]>`
    INSERT INTO mutation_idempotency (
      tenant_id,
      idempotency_key,
      actor_user_id,
      operation,
      request_hash
    )
    VALUES (
      ${claim.tenantId}::uuid,
      ${claim.idempotencyKey},
      ${claim.actorUserId}::uuid,
      ${claim.operation},
      ${hash}
    )
    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
    RETURNING idempotency_key
  `;
  if (inserted.length === 1) {
    return { kind: "claimed" };
  }

  const rows = await transaction<StoredIdempotencyRow[]>`
    SELECT
      actor_user_id,
      operation,
      request_hash,
      response_body,
      response_status
    FROM mutation_idempotency
    WHERE tenant_id = ${claim.tenantId}::uuid
      AND idempotency_key = ${claim.idempotencyKey}
    LIMIT 1
  `;
  const stored = rows[0];
  if (stored === undefined) {
    throw new Error("Idempotency claim disappeared during the transaction.");
  }
  if (
    stored.actor_user_id !== claim.actorUserId ||
    stored.operation !== claim.operation ||
    stored.request_hash !== hash
  ) {
    throw new ApiError({
      code: "IDEMPOTENCY_CONFLICT",
      detail: "The Idempotency-Key was already used for a different mutation.",
      statusCode: 409,
      title: "Idempotency Conflict",
    });
  }
  if (stored.response_body === null || stored.response_status === null) {
    throw new Error("A committed idempotency record is incomplete.");
  }
  return { body: stored.response_body, kind: "replay", status: stored.response_status };
}

export async function completeIdempotency(
  transaction: TransactionSql,
  claim: Pick<IdempotencyClaim, "actorUserId" | "idempotencyKey" | "tenantId">,
  status: number,
  body: object,
): Promise<void> {
  const jsonBody = JSON.parse(JSON.stringify(body)) as JSONValue;
  const result = await transaction<{ readonly idempotency_key: string }[]>`
    UPDATE mutation_idempotency
    SET response_status = ${status},
        response_body = ${transaction.json(jsonBody)},
        completed_at = clock_timestamp()
    WHERE tenant_id = ${claim.tenantId}::uuid
      AND idempotency_key = ${claim.idempotencyKey}
      AND actor_user_id = ${claim.actorUserId}::uuid
      AND completed_at IS NULL
    RETURNING idempotency_key
  `;
  if (result.length !== 1) {
    throw new Error("Idempotency completion did not update exactly one record.");
  }
}
