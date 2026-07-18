import type { InteriorAssetRef } from "@interior-design/contracts";

export const creatorOwnedCatalogSchemaVersion =
  "c12-creator-owned-synthetic-asset-catalog-v1" as const;
export const boundedProxyContentSchemaVersion = "c12-bounded-proxy-content-v1" as const;
export const boundedProxyMetadataSchemaVersion = "c12-bounded-proxy-metadata-v1" as const;

export type ExactTargetFace = "all" | "bottom" | "inside" | "outside" | "top";

export interface BoundedProxyContent {
  readonly assetId: string;
  readonly assetVersionId: string;
  readonly coordinateConvention: {
    readonly forwardAxis: "positive-y";
    readonly handedness: "right";
    readonly lengthUnit: "millimetre";
    readonly origin: "bounding-box-centre-floor";
    readonly xAxis: "right";
    readonly yAxis: "forward";
    readonly zAxis: "up";
  };
  readonly geometryEnvelopeMm: {
    readonly depthMm: number;
    readonly heightMm: number;
    readonly widthMm: number;
  };
  readonly proxyPrimitive: "axis-aligned-box";
  readonly schemaVersion: typeof boundedProxyContentSchemaVersion;
}

interface BoundedProxyMetadataCore {
  readonly assetId: string;
  readonly assetVersionId: string;
  readonly category: string;
  readonly dimensionsSource: "explicit-creator-authored-integer-mm";
  readonly displayName: string;
  readonly materialLabel: string;
  readonly representationStatus: "bounded-proxy";
  readonly schemaVersion: typeof boundedProxyMetadataSchemaVersion;
  readonly syntheticFixture: true;
  readonly version: string;
}

export interface FurnishingProxyMetadata extends BoundedProxyMetadataCore {
  readonly allowedTargetFaces: readonly ["top"];
  readonly kind: "furnishing";
}

export interface FinishProxyMetadata extends BoundedProxyMetadataCore {
  readonly allowedTargetFaces: readonly ExactTargetFace[];
  readonly applicationThicknessMm: number;
  readonly kind: "finish";
}

export interface LightProxyMetadata extends BoundedProxyMetadataCore {
  readonly allowedTargetFaces: readonly ExactTargetFace[];
  readonly colourTemperatureKelvin: number;
  readonly kind: "light";
  readonly lightKind: "area" | "linear" | "point" | "spot";
  readonly luminousFluxLumens: number;
}

export type BoundedProxyMetadata =
  FinishProxyMetadata | FurnishingProxyMetadata | LightProxyMetadata;

export interface CreatorOwnedAssetRecord {
  readonly content: BoundedProxyContent;
  readonly metadata: BoundedProxyMetadata;
  readonly ref: InteriorAssetRef;
}

export interface CreatorOwnedAssetCatalog {
  readonly assets: readonly CreatorOwnedAssetRecord[];
  readonly manifestSha256: string;
  readonly schemaVersion: typeof creatorOwnedCatalogSchemaVersion;
}

export interface ValidatedAssetCatalog extends CreatorOwnedAssetCatalog {
  readonly assets: readonly CreatorOwnedAssetRecord[];
}
