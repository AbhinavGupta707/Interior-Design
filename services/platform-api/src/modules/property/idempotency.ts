import type { JSONValue, TransactionSql } from "postgres";

import { ApiError } from "../../errors.js";
import { normalizedSha256 } from "./hash.js";

export interface PropertyIdempotencyClaim {
  readonly actorUserId: string;
  readonly idempotencyKey: string;
  readonly operation: string;
  readonly projectId: string;
  readonly requestBody: unknown;
  readonly tenantId: string;
}

export type PropertyIdempotencyResult =
  | { readonly kind: "claimed" }
  | { readonly body: unknown; readonly kind: "replay"; readonly status: number };

interface StoredPropertyIdempotencyRow {
  readonly actor_user_id: string;
  readonly operation: string;
  readonly request_hash: string;
  readonly response_body: unknown;
  readonly response_status: number | null;
}

export async function claimPropertyIdempotency(
  transaction: TransactionSql,
  claim: PropertyIdempotencyClaim,
): Promise<PropertyIdempotencyResult> {
  const requestHash = normalizedSha256(claim.requestBody);
  const inserted = await transaction<{ readonly idempotency_key: string }[]>`
    INSERT INTO property_mutation_idempotency (
      tenant_id,
      project_id,
      idempotency_key,
      actor_user_id,
      operation,
      request_hash
    )
    VALUES (
      ${claim.tenantId}::uuid,
      ${claim.projectId}::uuid,
      ${claim.idempotencyKey},
      ${claim.actorUserId}::uuid,
      ${claim.operation},
      ${requestHash}
    )
    ON CONFLICT (tenant_id, project_id, idempotency_key) DO NOTHING
    RETURNING idempotency_key
  `;
  if (inserted.length === 1) {
    return { kind: "claimed" };
  }

  const rows = await transaction<StoredPropertyIdempotencyRow[]>`
    SELECT actor_user_id, operation, request_hash, response_body, response_status
    FROM property_mutation_idempotency
    WHERE tenant_id = ${claim.tenantId}::uuid
      AND project_id = ${claim.projectId}::uuid
      AND idempotency_key = ${claim.idempotencyKey}
    LIMIT 1
  `;
  const stored = rows[0];
  if (stored === undefined) {
    throw new Error("Property idempotency claim disappeared during the transaction.");
  }
  if (
    stored.actor_user_id !== claim.actorUserId ||
    stored.operation !== claim.operation ||
    stored.request_hash !== requestHash
  ) {
    throw new ApiError({
      code: "IDEMPOTENCY_CONFLICT",
      detail: "The Idempotency-Key was already used for a different mutation.",
      statusCode: 409,
      title: "Idempotency Conflict",
    });
  }
  if (stored.response_body === null || stored.response_status === null) {
    throw new Error("A committed property idempotency record is incomplete.");
  }
  return { body: stored.response_body, kind: "replay", status: stored.response_status };
}

export async function completePropertyIdempotency(
  transaction: TransactionSql,
  claim: Pick<
    PropertyIdempotencyClaim,
    "actorUserId" | "idempotencyKey" | "projectId" | "tenantId"
  >,
  status: number,
  body: object,
): Promise<void> {
  const responseBody = JSON.parse(JSON.stringify(body)) as JSONValue;
  const completed = await transaction<{ readonly idempotency_key: string }[]>`
    UPDATE property_mutation_idempotency
    SET response_status = ${status},
        response_body = ${transaction.json(responseBody)},
        completed_at = clock_timestamp()
    WHERE tenant_id = ${claim.tenantId}::uuid
      AND project_id = ${claim.projectId}::uuid
      AND idempotency_key = ${claim.idempotencyKey}
      AND actor_user_id = ${claim.actorUserId}::uuid
      AND completed_at IS NULL
    RETURNING idempotency_key
  `;
  if (completed.length !== 1) {
    throw new Error("Property idempotency completion did not update exactly one record.");
  }
}
