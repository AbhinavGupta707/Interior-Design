export const interiorAssetSafeCodes = [
  "ASSET_INPUT_MALFORMED",
  "ASSET_RESOURCE_LIMIT",
  "ASSET_DUPLICATE",
  "ASSET_HASH_MISMATCH",
  "ASSET_RIGHTS_INVALID",
  "ASSET_DIMENSIONS_INVALID",
  "ASSET_COORDINATE_CONVENTION_INVALID",
  "ASSET_ROTATIONS_INVALID",
  "ASSET_CLEARANCE_INVALID",
  "ASSET_METADATA_HOSTILE",
  "ASSET_METADATA_FORBIDDEN",
] as const;

export type InteriorAssetSafeCode = (typeof interiorAssetSafeCodes)[number];

const safeMessages: Readonly<Record<InteriorAssetSafeCode, string>> = Object.freeze({
  ASSET_CLEARANCE_INVALID: "Asset clearance policy is invalid.",
  ASSET_COORDINATE_CONVENTION_INVALID: "Asset coordinate convention is invalid.",
  ASSET_DIMENSIONS_INVALID: "Asset geometry dimensions are invalid.",
  ASSET_DUPLICATE: "Asset catalog contains a duplicate identity.",
  ASSET_HASH_MISMATCH: "Asset catalog integrity validation failed.",
  ASSET_INPUT_MALFORMED: "Asset catalog input is malformed.",
  ASSET_METADATA_FORBIDDEN: "Asset metadata contains a forbidden field.",
  ASSET_METADATA_HOSTILE: "Asset metadata contains unsafe text.",
  ASSET_RESOURCE_LIMIT: "Asset catalog exceeds a bounded resource limit.",
  ASSET_RIGHTS_INVALID: "Asset rights do not permit this service boundary.",
  ASSET_ROTATIONS_INVALID: "Asset rotation policy is invalid.",
});

export class InteriorAssetError extends Error {
  readonly safeCode: InteriorAssetSafeCode;

  constructor(safeCode: InteriorAssetSafeCode, options?: ErrorOptions) {
    super(safeMessages[safeCode], options);
    this.name = "InteriorAssetError";
    this.safeCode = safeCode;
  }
}

export interface SafeInteriorAssetDiagnostic {
  readonly safeCode: InteriorAssetSafeCode;
}

/** Returns only a stable code. No asset label, metadata, hash or parser detail is exposed. */
export function safeInteriorAssetDiagnostic(error: unknown): SafeInteriorAssetDiagnostic {
  return Object.freeze({
    safeCode: error instanceof InteriorAssetError ? error.safeCode : "ASSET_INPUT_MALFORMED",
  });
}
