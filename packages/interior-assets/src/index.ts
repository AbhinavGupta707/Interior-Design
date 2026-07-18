export const interiorAssetsPackageContract = "c12-interior-assets-v1" as const;

export {
  assetJsonLimits,
  assetSha256,
  assertBoundedPlainJson,
  canonicalAssetJson,
  deepFreezeAssetValue,
  deterministicC12Uuid,
  maximumAssetCatalogBytes,
} from "./canonical.js";
export {
  createValidatedAssetCatalog,
  findAssetRecord,
  interiorAssetCatalogPolicy,
  parseAssetCatalogJson,
  validateAssetCatalog,
} from "./catalog.js";
export {
  InteriorAssetError,
  interiorAssetSafeCodes,
  safeInteriorAssetDiagnostic,
} from "./errors.js";
export { creatorOwnedSyntheticAssetCatalog } from "./starter-catalog.js";
export {
  boundedProxyContentSchemaVersion,
  boundedProxyMetadataSchemaVersion,
  creatorOwnedCatalogSchemaVersion,
} from "./types.js";
export type { BoundedJsonLimits } from "./canonical.js";
export type { InteriorAssetSafeCode, SafeInteriorAssetDiagnostic } from "./errors.js";
export type {
  BoundedProxyContent,
  BoundedProxyMetadata,
  CreatorOwnedAssetCatalog,
  CreatorOwnedAssetRecord,
  ExactTargetFace,
  FinishProxyMetadata,
  FurnishingProxyMetadata,
  LightProxyMetadata,
  ValidatedAssetCatalog,
} from "./types.js";
