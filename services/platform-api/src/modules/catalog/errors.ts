import { ApiError } from "../../errors.js";

export function invalidCatalogCursor(): ApiError {
  return new ApiError({
    code: "INVALID_CATALOG_CURSOR",
    detail: "The catalog cursor is invalid for this release and filter set.",
    statusCode: 400,
    title: "Invalid Catalog Cursor",
  });
}

export function invalidCatalogQuery(): ApiError {
  return new ApiError({
    code: "INVALID_CATALOG_QUERY",
    detail: "The catalog filters are invalid.",
    statusCode: 400,
    title: "Invalid Catalog Query",
  });
}

export function catalogUnavailable(
  code:
    "CATALOG_ARTIFACT_MISSING" | "CATALOG_ASSET_NOT_SELECTABLE" | "CATALOG_RELEASE_NOT_SELECTABLE",
): ApiError {
  return new ApiError({
    code,
    detail:
      "The requested catalog record remains historical but cannot be used for a new selection.",
    statusCode: 409,
    title: code
      .toLowerCase()
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" "),
  });
}
