import type { InteriorAssetRef } from "@interior-design/contracts";
import {
  assetSha256,
  createValidatedAssetCatalog,
  creatorOwnedSyntheticAssetCatalog,
  deterministicC12Uuid,
  type BoundedProxyContent,
  type BoundedProxyMetadata,
  type CreatorOwnedAssetRecord,
} from "@interior-design/interior-assets";

interface AlternativeDescriptor {
  readonly allowedRotationMilliDegrees: readonly number[];
  readonly allowedTargetFaces: readonly ("inside" | "outside" | "top")[];
  readonly applicationThicknessMm?: number;
  readonly category: string;
  readonly clearanceMm: {
    readonly back: number;
    readonly front: number;
    readonly left: number;
    readonly right: number;
  };
  readonly dimensions: {
    readonly depthMm: number;
    readonly heightMm: number;
    readonly widthMm: number;
  };
  readonly displayName: string;
  readonly kind: "finish" | "furnishing" | "light";
  readonly light?: {
    readonly colourTemperatureKelvin: number;
    readonly lightKind: "area" | "linear" | "point" | "spot";
    readonly luminousFluxLumens: number;
  };
  readonly materialLabel: string;
  readonly slug: string;
}

const rightsWithoutHash = Object.freeze({
  attributionRequired: false,
  derivativesAllowed: true,
  licenceId: "LicenseRef-InteriorDesign-CreatorOwned-Synthetic",
  redistributionAllowed: false,
  serviceProcessingAllowed: true,
  sourceKind: "creator-owned-synthetic",
  trainingAllowed: false,
  usage: "service-and-derived-designs",
} as const);

const alternatives: readonly AlternativeDescriptor[] = [
  {
    allowedRotationMilliDegrees: [0, 90_000, 180_000, 270_000],
    allowedTargetFaces: ["top"],
    category: "compact-armchair",
    clearanceMm: { back: 50, front: 700, left: 100, right: 100 },
    dimensions: { depthMm: 820, heightMm: 880, widthMm: 780 },
    displayName: "Synthetic compact armchair",
    kind: "furnishing",
    materialLabel: "creator-owned synthetic blue woven textile",
    slug: "compact-armchair",
  },
  {
    allowedRotationMilliDegrees: [0, 90_000, 180_000, 270_000],
    allowedTargetFaces: ["top"],
    applicationThicknessMm: 10,
    category: "floor-finish-mineral-tone",
    clearanceMm: { back: 0, front: 0, left: 0, right: 0 },
    dimensions: { depthMm: 1_000, heightMm: 10, widthMm: 1_000 },
    displayName: "Synthetic mineral-tone floor finish",
    kind: "finish",
    materialLabel: "creator-owned synthetic mineral-tone finish",
    slug: "floor-finish-mineral-tone",
  },
  {
    allowedRotationMilliDegrees: [0, 90_000, 180_000, 270_000],
    allowedTargetFaces: ["inside", "outside"],
    category: "wall-sconce",
    clearanceMm: { back: 100, front: 300, left: 150, right: 150 },
    dimensions: { depthMm: 180, heightMm: 320, widthMm: 260 },
    displayName: "Synthetic wall sconce",
    kind: "light",
    light: { colourTemperatureKelvin: 2_700, lightKind: "point", luminousFluxLumens: 650 },
    materialLabel: "creator-owned synthetic warm metal",
    slug: "wall-sconce",
  },
];

function createAlternativeRecord(descriptor: AlternativeDescriptor): CreatorOwnedAssetRecord {
  const version = "1.0.0";
  const assetId = deterministicC12Uuid(`c13:creator-owned-asset:${descriptor.slug}`);
  const assetVersionId = deterministicC12Uuid(
    `c13:creator-owned-asset:${descriptor.slug}:version:${version}`,
  );
  const content: BoundedProxyContent = {
    assetId,
    assetVersionId,
    coordinateConvention: {
      forwardAxis: "positive-y",
      handedness: "right",
      lengthUnit: "millimetre",
      origin: "bounding-box-centre-floor",
      xAxis: "right",
      yAxis: "forward",
      zAxis: "up",
    },
    geometryEnvelopeMm: descriptor.dimensions,
    proxyPrimitive: "axis-aligned-box",
    schemaVersion: "c12-bounded-proxy-content-v1",
  };
  const metadataCore = {
    allowedTargetFaces: descriptor.allowedTargetFaces,
    assetId,
    assetVersionId,
    category: descriptor.category,
    dimensionsSource: "explicit-creator-authored-integer-mm" as const,
    displayName: descriptor.displayName,
    kind: descriptor.kind,
    materialLabel: descriptor.materialLabel,
    representationStatus: "bounded-proxy" as const,
    schemaVersion: "c12-bounded-proxy-metadata-v1" as const,
    syntheticFixture: true as const,
    version,
  };
  let metadata: BoundedProxyMetadata;
  if (descriptor.kind === "furnishing") {
    metadata = { ...metadataCore, allowedTargetFaces: ["top"], kind: "furnishing" };
  } else if (descriptor.kind === "finish") {
    metadata = {
      ...metadataCore,
      applicationThicknessMm: descriptor.applicationThicknessMm ?? 1,
      kind: "finish",
    };
  } else {
    const light = descriptor.light;
    if (light === undefined) throw new Error("A light fixture descriptor requires light output.");
    metadata = { ...metadataCore, ...light, kind: "light" };
  }
  const policyWithoutHash = {
    allowedRotationMilliDegrees: descriptor.allowedRotationMilliDegrees,
    clearanceMm: descriptor.clearanceMm,
    forwardAxis: "positive-y" as const,
    origin: "bounding-box-centre-floor" as const,
  };
  const ref: InteriorAssetRef = {
    category: descriptor.category,
    contentSha256: assetSha256(content),
    geometryEnvelopeMm: descriptor.dimensions,
    id: assetId,
    kind: descriptor.kind,
    materialLabel: descriptor.materialLabel,
    metadataSha256: assetSha256(metadata),
    placementPolicy: {
      ...policyWithoutHash,
      allowedRotationMilliDegrees: [...descriptor.allowedRotationMilliDegrees],
      policySha256: assetSha256(policyWithoutHash),
    },
    representationStatus: "bounded-proxy",
    rights: { ...rightsWithoutHash, rightsRecordSha256: assetSha256(rightsWithoutHash) },
    schemaVersion: "c12-interior-asset-ref-v1",
    version,
    versionId: assetVersionId,
  };
  return { content, metadata, ref };
}

export const c13AlternativeAssetCatalog = createValidatedAssetCatalog(
  alternatives.map(createAlternativeRecord),
);

export const c13CreatorOwnedAssetCatalog = createValidatedAssetCatalog([
  ...creatorOwnedSyntheticAssetCatalog.assets,
  ...c13AlternativeAssetCatalog.assets,
]);
