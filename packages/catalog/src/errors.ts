export const catalogSafeCodes = [
  "CATALOG_ARTIFACT_HASH_MISMATCH",
  "CATALOG_ARTIFACT_TYPE_INVALID",
  "CATALOG_CANCELLED",
  "CATALOG_GLB_GEOMETRY_INVALID",
  "CATALOG_GLB_INVALID",
  "CATALOG_GLB_RESOURCE_LIMIT",
  "CATALOG_INPUT_MALFORMED",
  "CATALOG_PNG_INVALID",
  "CATALOG_RELEASE_CONFLICT",
  "CATALOG_RESOURCE_LIMIT",
  "CATALOG_RIGHTS_INVALID",
  "CATALOG_SOURCE_PATH_INVALID",
  "CATALOG_VALIDATOR_FAILED",
] as const;

export type CatalogSafeCode = (typeof catalogSafeCodes)[number];

export class CatalogError extends Error {
  readonly safeCode: CatalogSafeCode;

  constructor(safeCode: CatalogSafeCode, options?: ErrorOptions) {
    super("The catalog operation could not be completed safely.", options);
    this.name = "CatalogError";
    this.safeCode = safeCode;
  }
}

export function safeCatalogDiagnostic(error: unknown): {
  readonly code: CatalogSafeCode | "CATALOG_INTERNAL_FAILURE";
  readonly message: string;
} {
  return error instanceof CatalogError
    ? { code: error.safeCode, message: error.message }
    : {
        code: "CATALOG_INTERNAL_FAILURE",
        message: "The catalog operation failed without exposing private artifact details.",
      };
}
