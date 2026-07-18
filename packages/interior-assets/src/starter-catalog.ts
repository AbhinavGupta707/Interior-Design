import type { InteriorAssetRef } from "@interior-design/contracts";

import { assetSha256, deterministicC12Uuid } from "./canonical.js";
import { createValidatedAssetCatalog } from "./catalog.js";
import {
  boundedProxyContentSchemaVersion,
  boundedProxyMetadataSchemaVersion,
  type BoundedProxyContent,
  type BoundedProxyMetadata,
  type CreatorOwnedAssetRecord,
  type ExactTargetFace,
} from "./types.js";

interface StarterDescriptorCore {
  readonly allowedRotationMilliDegrees: readonly number[];
  readonly allowedTargetFaces: readonly ExactTargetFace[];
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
  readonly materialLabel: string;
  readonly slug: string;
}

type StarterDescriptor =
  | (StarterDescriptorCore & {
      readonly applicationThicknessMm: number;
      readonly kind: "finish";
    })
  | (StarterDescriptorCore & {
      readonly kind: "furnishing";
    })
  | (StarterDescriptorCore & {
      readonly kind: "light";
      readonly light: {
        readonly colourTemperatureKelvin: number;
        readonly lightKind: "area" | "linear" | "point" | "spot";
        readonly luminousFluxLumens: number;
      };
    });

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

const descriptors: readonly StarterDescriptor[] = [
  {
    allowedRotationMilliDegrees: [0, 90_000, 180_000, 270_000],
    allowedTargetFaces: ["top"],
    category: "three-seat-sofa",
    clearanceMm: { back: 50, front: 800, left: 100, right: 100 },
    dimensions: { depthMm: 900, heightMm: 820, widthMm: 2_100 },
    displayName: "Synthetic three-seat sofa proxy",
    kind: "furnishing",
    materialLabel: "creator-owned synthetic warm textile",
    slug: "three-seat-sofa",
  },
  {
    allowedRotationMilliDegrees: [0, 90_000, 180_000, 270_000],
    allowedTargetFaces: ["top"],
    category: "lounge-chair",
    clearanceMm: { back: 50, front: 700, left: 100, right: 100 },
    dimensions: { depthMm: 900, heightMm: 900, widthMm: 900 },
    displayName: "Synthetic lounge chair proxy",
    kind: "furnishing",
    materialLabel: "creator-owned synthetic woven textile",
    slug: "lounge-chair",
  },
  {
    allowedRotationMilliDegrees: [0, 90_000, 180_000, 270_000],
    allowedTargetFaces: ["top"],
    category: "coffee-table",
    clearanceMm: { back: 450, front: 450, left: 450, right: 450 },
    dimensions: { depthMm: 600, heightMm: 420, widthMm: 1_100 },
    displayName: "Synthetic coffee table proxy",
    kind: "furnishing",
    materialLabel: "creator-owned synthetic timber tone",
    slug: "coffee-table",
  },
  {
    allowedRotationMilliDegrees: [0, 90_000, 180_000, 270_000],
    allowedTargetFaces: ["top"],
    category: "low-storage-console",
    clearanceMm: { back: 0, front: 900, left: 100, right: 100 },
    dimensions: { depthMm: 450, heightMm: 800, widthMm: 1_400 },
    displayName: "Synthetic low storage console proxy",
    kind: "furnishing",
    materialLabel: "creator-owned synthetic neutral laminate",
    slug: "low-storage-console",
  },
  {
    allowedRotationMilliDegrees: [0, 90_000, 180_000, 270_000],
    allowedTargetFaces: ["top"],
    applicationThicknessMm: 12,
    category: "floor-finish-timber-tone",
    clearanceMm: { back: 0, front: 0, left: 0, right: 0 },
    dimensions: { depthMm: 1_000, heightMm: 12, widthMm: 1_000 },
    displayName: "Synthetic timber-tone floor finish proxy",
    kind: "finish",
    materialLabel: "creator-owned synthetic timber-tone finish",
    slug: "floor-finish-timber-tone",
  },
  {
    allowedRotationMilliDegrees: [0, 90_000, 180_000, 270_000],
    allowedTargetFaces: ["inside", "outside"],
    applicationThicknessMm: 20,
    category: "wall-finish-warm-neutral",
    clearanceMm: { back: 0, front: 0, left: 0, right: 0 },
    dimensions: { depthMm: 20, heightMm: 1_000, widthMm: 1_000 },
    displayName: "Synthetic warm-neutral wall finish proxy",
    kind: "finish",
    materialLabel: "creator-owned synthetic warm-neutral finish",
    slug: "wall-finish-warm-neutral",
  },
  {
    allowedRotationMilliDegrees: [0],
    allowedTargetFaces: ["bottom"],
    category: "pendant-light",
    clearanceMm: { back: 150, front: 150, left: 150, right: 150 },
    dimensions: { depthMm: 400, heightMm: 500, widthMm: 400 },
    displayName: "Synthetic pendant light proxy",
    kind: "light",
    light: { colourTemperatureKelvin: 2_700, lightKind: "point", luminousFluxLumens: 1_500 },
    materialLabel: "creator-owned synthetic opaque shade",
    slug: "pendant-light",
  },
  {
    allowedRotationMilliDegrees: [0, 90_000, 180_000, 270_000],
    allowedTargetFaces: ["top"],
    category: "floor-light",
    clearanceMm: { back: 100, front: 100, left: 100, right: 100 },
    dimensions: { depthMm: 400, heightMm: 1_500, widthMm: 400 },
    displayName: "Synthetic floor light proxy",
    kind: "light",
    light: { colourTemperatureKelvin: 2_700, lightKind: "point", luminousFluxLumens: 900 },
    materialLabel: "creator-owned synthetic neutral metal",
    slug: "floor-light",
  },
];

function createRecord(descriptor: StarterDescriptor): CreatorOwnedAssetRecord {
  const version = "1.0.0";
  const assetId = deterministicC12Uuid(`c12:creator-owned-asset:${descriptor.slug}`);
  const assetVersionId = deterministicC12Uuid(
    `c12:creator-owned-asset:${descriptor.slug}:version:${version}`,
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
    schemaVersion: boundedProxyContentSchemaVersion,
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
    schemaVersion: boundedProxyMetadataSchemaVersion,
    syntheticFixture: true as const,
    version,
  };
  const metadata: BoundedProxyMetadata =
    descriptor.kind === "light"
      ? { ...metadataCore, ...descriptor.light, kind: "light" }
      : descriptor.kind === "finish"
        ? {
            ...metadataCore,
            applicationThicknessMm: descriptor.applicationThicknessMm,
            kind: "finish",
          }
        : { ...metadataCore, allowedTargetFaces: ["top"], kind: "furnishing" };
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
    rights: {
      ...rightsWithoutHash,
      rightsRecordSha256: assetSha256(rightsWithoutHash),
    },
    schemaVersion: "c12-interior-asset-ref-v1",
    version,
    versionId: assetVersionId,
  };
  return { content, metadata, ref };
}

export const creatorOwnedSyntheticAssetCatalog = createValidatedAssetCatalog(
  descriptors.map(createRecord),
);
