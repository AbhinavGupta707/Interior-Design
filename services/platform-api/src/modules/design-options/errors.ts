import { ApiError } from "../../errors.js";

export type DesignOptionConflictCode =
  | "ASSET_BINDING_CHANGED"
  | "BRIEF_NOT_ACCEPTED"
  | "CONFIRMATION_CONFLICT"
  | "CONSTRAINTS_FAILED"
  | "IDEMPOTENCY_CONFLICT"
  | "JOB_NOT_RETRYABLE"
  | "JOB_VERSION_CONFLICT"
  | "LEASE_LOST"
  | "OPTION_EXPIRED"
  | "OPTION_NOT_PENDING"
  | "PROPOSED_BASE_CONFLICT"
  | "PUBLICATION_INVALID"
  | "SOURCE_CHANGED";

export function designOptionConflict(
  code: DesignOptionConflictCode,
  detail: string,
  statusCode: 409 | 410 | 422 = 409,
): ApiError {
  return new ApiError({
    code,
    detail,
    statusCode,
    title: code
      .toLowerCase()
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" "),
  });
}

export function invalidPublication(detail: string): ApiError {
  return designOptionConflict("PUBLICATION_INVALID", detail, 422);
}
