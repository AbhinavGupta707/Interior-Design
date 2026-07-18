import { ApiError } from "../../errors.js";

export type SpecificationConflictCode =
  | "CATALOG_BINDING_CHANGED"
  | "CONFIRMATION_CONFLICT"
  | "GEOMETRY_INVALID"
  | "IDEMPOTENCY_CONFLICT"
  | "PREVIEW_EXPIRED"
  | "PREVIEW_NOT_PENDING"
  | "SOURCE_CHANGED"
  | "SPECIFICATION_REVISION_CONFLICT";

export function specificationConflict(
  code: SpecificationConflictCode,
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
