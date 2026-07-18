import {
  c13CatalogPolicy,
  catalogArtifactSchema,
  catalogAssetVersionSchema,
  catalogReleaseSchema,
  catalogRightsRecordSchema,
  type CatalogArtifact,
  type CatalogAssetVersion,
  type CatalogMaterialDefinition,
  type CatalogRelease,
} from "@interior-design/contracts";
import { assetSha256, creatorOwnedSyntheticAssetCatalog } from "@interior-design/interior-assets";

import {
  catalogCanonicalBytes,
  catalogSha256,
  compareCatalogStrings,
  deterministicCatalogUuid,
  hasUnsafeCatalogText,
  sha256Bytes,
} from "./canonical.js";
import { CatalogError } from "./errors.js";
import { validateCatalogGlb } from "./glb.js";
import { validateAndCanonicalizePng } from "./png.js";
import type {
  CatalogArtifactPublication,
  CatalogPublishedRelease,
  CatalogSourceArtifactRole,
  CatalogSourceAsset,
  CatalogSourceManifest,
  CatalogValidatedAsset,
  KhronosValidatorPort,
} from "./types.js";

export const pinnedKhronosValidatorVersion = "2.0.0-dev.3.10" as const;

function inputMalformed(): never {
  throw new CatalogError("CATALOG_INPUT_MALFORMED");
}

function validateText(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength < 1 || bytes.byteLength > 256 * 1024) {
    throw new CatalogError("CATALOG_RESOURCE_LIMIT");
  }
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new CatalogError("CATALOG_ARTIFACT_TYPE_INVALID", { cause: error });
  }
  if (
    decoded.charCodeAt(0) === 0xfeff ||
    !decoded.endsWith("\n") ||
    hasUnsafeCatalogText(decoded, true) ||
    /(?:bearer|credential|password|secret|signed[ -]?url|token)\s*[:=]/iu.test(decoded)
  ) {
    throw new CatalogError("CATALOG_ARTIFACT_TYPE_INVALID");
  }
  return new TextEncoder().encode(decoded.replaceAll("\r\n", "\n"));
}

function artifact(
  source: CatalogSourceAsset,
  role: CatalogSourceArtifactRole,
  bytes: Uint8Array,
  sourceSha256: readonly string[],
  image?: { readonly heightPx: number; readonly widthPx: number },
): CatalogArtifact {
  const descriptor = source.artifacts.find((candidate) => candidate.role === role);
  if (descriptor === undefined) inputMalformed();
  const sha256 = sha256Bytes(bytes);
  const core = {
    role,
    sourceSha256,
    tool: "interior-design-c13-catalog-ingestor",
    toolVersion: "1.0.0",
  };
  const candidate = {
    artifactId: deterministicCatalogUuid(
      `c13:artifact:${source.c12Asset.versionId}:${role}:${sha256}`,
    ),
    byteLength: bytes.byteLength,
    derivation: {
      configurationSha256: catalogSha256(core),
      sourceSha256: [...sourceSha256],
      tool: core.tool,
      toolVersion: core.toolVersion,
    },
    ...(image === undefined
      ? {}
      : {
          image: {
            colourEncoding: "srgb" as const,
            heightPx: image.heightPx,
            semantic: "thumbnail" as const,
            widthPx: image.widthPx,
          },
        }),
    mediaType: descriptor.mediaType,
    objectKey: `catalog/sha256/${sha256.slice(0, 2)}/${sha256}`,
    role,
    schemaVersion: "c13-catalog-artifact-v1",
    sha256,
  };
  const parsed = catalogArtifactSchema.safeParse(candidate);
  if (!parsed.success) inputMalformed();
  return parsed.data;
}

function projection(source: CatalogSourceAsset) {
  const core = {
    c12Asset: source.c12Asset,
    coordinateTransform: "gltf-front-positive-z-to-interior-forward-positive-y-v1" as const,
    floorCentredPivot: true as const,
    gltfMetresToInteriorMillimetres: 1_000 as const,
    schemaVersion: "c13-placement-projection-v1" as const,
  };
  return { ...core, projectionSha256: catalogSha256(core) };
}

function material(source: CatalogSourceAsset): CatalogMaterialDefinition {
  const sourceMaterial = source.material;
  return {
    baseColourSrgb8: [...sourceMaterial.baseColourSrgb8],
    emissiveSrgb8: [...sourceMaterial.emissiveSrgb8],
    materialId: deterministicCatalogUuid(`c13:material:${source.c12Asset.versionId}`),
    metallicBasisPoints: sourceMaterial.metallicBasisPoints,
    name: sourceMaterial.name,
    opaque: true,
    ...(sourceMaterial.physicalRepeatMm === null
      ? {}
      : { physicalRepeatMm: { ...sourceMaterial.physicalRepeatMm } }),
    roughnessBasisPoints: sourceMaterial.roughnessBasisPoints,
    schemaVersion: "c13-material-definition-v1",
    textureArtifactIds: [],
    uvSet: 0,
  };
}

function assertRightsCompatible(source: CatalogSourceAsset): void {
  const c12 = source.c12Asset.rights;
  if (
    source.rights.policy.serviceProcessingAllowed !== c12.serviceProcessingAllowed ||
    source.rights.grants.derivatives !== c12.derivativesAllowed ||
    !source.rights.grants.commercialUse ||
    !source.rights.grants.renderedOutputDistribution ||
    !source.rights.grants.thumbnailDisplay ||
    source.rights.review.state !== "approved" ||
    source.rights.spdxLicenseListVersion !== "3.0.1" ||
    source.rights.declaredLicenceExpression !== c12.licenceId ||
    source.rights.concludedLicenceExpression !== c12.licenceId
  ) {
    throw new CatalogError("CATALOG_RIGHTS_INVALID");
  }
}

export function assertExactC12StarterCoverage(sources: readonly CatalogSourceAsset[]): void {
  const byVersionId = new Map(
    sources.map((source) => [source.c12Asset.versionId, source.c12Asset]),
  );
  for (const starter of creatorOwnedSyntheticAssetCatalog.assets) {
    const wrapped = byVersionId.get(starter.ref.versionId);
    if (wrapped === undefined || assetSha256(wrapped) !== assetSha256(starter.ref)) {
      throw new CatalogError("CATALOG_INPUT_MALFORMED");
    }
  }
}

export async function validateCatalogSourceAsset(input: {
  readonly bytesByRole: ReadonlyMap<CatalogSourceArtifactRole, Uint8Array>;
  readonly source: CatalogSourceAsset;
  readonly validator: KhronosValidatorPort;
}): Promise<CatalogValidatedAsset> {
  const { source } = input;
  assertRightsCompatible(source);
  if (input.bytesByRole.size !== 4) inputMalformed();
  for (const descriptor of source.artifacts) {
    const raw = input.bytesByRole.get(descriptor.role);
    if (raw === undefined || sha256Bytes(raw) !== descriptor.sha256) {
      throw new CatalogError("CATALOG_ARTIFACT_HASH_MISMATCH");
    }
  }
  const modelBytes = input.bytesByRole.get("model");
  const thumbnailBytes = input.bytesByRole.get("thumbnail");
  const licenceBytes = input.bytesByRole.get("licence-text");
  const receiptBytes = input.bytesByRole.get("source-receipt");
  if (
    modelBytes === undefined ||
    thumbnailBytes === undefined ||
    licenceBytes === undefined ||
    receiptBytes === undefined
  ) {
    inputMalformed();
  }
  const glb = validateCatalogGlb(modelBytes, source.c12Asset);
  if (
    glb.material.name !== source.material.name ||
    glb.material.metallicBasisPoints !== source.material.metallicBasisPoints ||
    glb.material.roughnessBasisPoints !== source.material.roughnessBasisPoints ||
    glb.material.baseColourSrgb8.some(
      (component, index) => component !== source.material.baseColourSrgb8[index],
    ) ||
    glb.material.emissiveSrgb8.some(
      (component, index) => component !== source.material.emissiveSrgb8[index],
    )
  ) {
    throw new CatalogError("CATALOG_GLB_INVALID");
  }
  let validatorEvidence;
  try {
    validatorEvidence = await input.validator.validate(modelBytes, sha256Bytes(modelBytes));
  } catch (error) {
    throw new CatalogError("CATALOG_VALIDATOR_FAILED", { cause: error });
  }
  if (
    validatorEvidence.validatorVersion !== pinnedKhronosValidatorVersion ||
    validatorEvidence.numErrors !== 0 ||
    validatorEvidence.numWarnings !== 0
  ) {
    throw new CatalogError("CATALOG_VALIDATOR_FAILED");
  }
  const thumbnail = validateAndCanonicalizePng(thumbnailBytes);
  if (thumbnail.widthPx !== 512 || thumbnail.heightPx !== 512) {
    throw new CatalogError("CATALOG_PNG_INVALID");
  }
  const licence = validateText(licenceBytes);
  const receipt = validateText(receiptBytes);
  const modelSourceSha256 = sha256Bytes(modelBytes);
  const thumbnailSourceSha256 = sha256Bytes(thumbnailBytes);
  const licenceSourceSha256 = sha256Bytes(licenceBytes);
  const receiptSourceSha256 = sha256Bytes(receiptBytes);
  const artifactsWithBytes: CatalogArtifactPublication[] = [
    {
      artifact: artifact(source, "model", modelBytes, [modelSourceSha256]),
      bytes: Uint8Array.from(modelBytes),
    },
    {
      artifact: artifact(
        source,
        "thumbnail",
        thumbnail.bytes,
        [modelSourceSha256, thumbnailSourceSha256].sort(compareCatalogStrings),
        thumbnail,
      ),
      bytes: thumbnail.bytes,
    },
    {
      artifact: artifact(source, "licence-text", licence, [licenceSourceSha256]),
      bytes: licence,
    },
    {
      artifact: artifact(source, "source-receipt", receipt, [receiptSourceSha256]),
      bytes: receipt,
    },
  ].sort((left, right) => compareCatalogStrings(left.artifact.role, right.artifact.role));
  const licenceArtifact = artifactsWithBytes.find(
    ({ artifact: item }) => item.role === "licence-text",
  );
  const receiptArtifact = artifactsWithBytes.find(
    ({ artifact: item }) => item.role === "source-receipt",
  );
  if (licenceArtifact === undefined || receiptArtifact === undefined) inputMalformed();
  const rights = catalogRightsRecordSchema.safeParse({
    concludedLicenceExpression: source.rights.concludedLicenceExpression,
    creator: source.rights.creator,
    declaredLicenceExpression: source.rights.declaredLicenceExpression,
    grants: source.rights.grants,
    licenceTextArtifactSha256: licenceArtifact.artifact.sha256,
    policy: source.rights.policy,
    recordSha256: source.c12Asset.rights.rightsRecordSha256,
    review: source.rights.review,
    schemaVersion: "c13-catalog-rights-record-v1",
    sourceKind: source.rights.sourceKind,
    sourceReceiptArtifactSha256: receiptArtifact.artifact.sha256,
    spdxLicenseListVersion: source.rights.spdxLicenseListVersion,
  });
  if (!rights.success) throw new CatalogError("CATALOG_RIGHTS_INVALID");
  const core = {
    artifacts: artifactsWithBytes.map(({ artifact: item }) => item),
    assetId: source.c12Asset.id,
    category: source.c12Asset.category,
    commercialData: {
      delivery: "not-provided" as const,
      liveAvailability: "not-provided" as const,
      price: "not-provided" as const,
      supplier: "not-provided" as const,
    },
    description: source.description,
    displayName: source.displayName,
    kind: source.c12Asset.kind,
    lifecycle:
      source.rights.review.state === "approved" ? ("approved" as const) : ("withdrawn" as const),
    materials: [material(source)],
    placementProjection: projection(source),
    rights: rights.data,
    schemaVersion: "c13-catalog-asset-version-v1" as const,
    tags: [...source.tags].sort(compareCatalogStrings),
    version: source.c12Asset.version,
    versionId: source.c12Asset.versionId,
  };
  const parsed = catalogAssetVersionSchema.safeParse({
    ...core,
    versionSha256: catalogSha256(core),
  });
  if (!parsed.success) inputMalformed();
  return {
    artifactBytes: new Map(
      artifactsWithBytes.map(({ artifact: item, bytes }) => [
        item.artifactId,
        Uint8Array.from(bytes),
      ]),
    ),
    record: parsed.data,
  };
}

export function buildCatalogRelease(
  source: CatalogSourceManifest,
  validatedAssets: readonly CatalogValidatedAsset[],
): CatalogPublishedRelease {
  assertExactC12StarterCoverage(source.assets);
  if (validatedAssets.length !== source.assets.length) inputMalformed();
  const assets = validatedAssets
    .map(({ record }) => record)
    .sort((left, right) => compareCatalogStrings(left.versionId, right.versionId));
  if (new Set(assets.map(({ versionId }) => versionId)).size !== assets.length) inputMalformed();
  const manifestCore = {
    assets: assets.map(({ assetId, versionId, versionSha256 }) => ({
      assetId,
      versionId,
      versionSha256,
    })),
    createdAt: source.createdAt,
    releaseVersion: source.releaseVersion,
    schemaVersion: "c13-catalog-release-manifest-v1",
  };
  const manifestBytes = catalogCanonicalBytes(manifestCore);
  if (manifestBytes.byteLength > c13CatalogPolicy.maximumReleaseManifestBytes) {
    throw new CatalogError("CATALOG_RESOURCE_LIMIT");
  }
  const manifestSha256 = sha256Bytes(manifestBytes);
  const release: CatalogRelease = catalogReleaseSchema.parse({
    assetVersionIds: assets.map(({ versionId }) => versionId),
    createdAt: source.createdAt,
    manifestSha256,
    releaseId: deterministicCatalogUuid(`c13:release:${manifestSha256}`),
    schemaVersion: "c13-catalog-release-v1",
    status: "published",
    version: source.releaseVersion,
  });
  return { assets, manifestBytes, release };
}

export function isCatalogAssetSelectable(asset: CatalogAssetVersion): boolean {
  return (
    asset.lifecycle === "approved" &&
    asset.rights.review.state === "approved" &&
    asset.rights.policy.serviceProcessingAllowed &&
    asset.artifacts.some(({ role }) => role === "model") &&
    asset.artifacts.some(({ role }) => role === "thumbnail") &&
    asset.artifacts.some(({ role }) => role === "licence-text") &&
    asset.artifacts.some(({ role }) => role === "source-receipt")
  );
}
