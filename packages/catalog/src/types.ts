import type {
  CatalogArtifact,
  CatalogAssetVersion,
  CatalogRelease,
  InteriorAssetRef,
} from "@interior-design/contracts";

export const catalogSourceManifestSchemaVersion = "c13-catalog-source-manifest-v1" as const;

export type CatalogSourceArtifactRole = "licence-text" | "model" | "source-receipt" | "thumbnail";

export interface CatalogSourceArtifact {
  readonly mediaType: "image/png" | "model/gltf-binary" | "text/plain; charset=utf-8";
  readonly relativePath: string;
  readonly role: CatalogSourceArtifactRole;
  readonly sha256: string;
}

export interface CatalogSourceRights {
  readonly concludedLicenceExpression: string;
  readonly creator: string;
  readonly declaredLicenceExpression: string;
  readonly grants: {
    readonly commercialUse: boolean;
    readonly derivatives: boolean;
    readonly rawRedistribution: false;
    readonly renderedOutputDistribution: boolean;
    readonly thumbnailDisplay: boolean;
  };
  readonly policy: {
    readonly serviceProcessingAllowed: boolean;
    readonly trainingAllowed: false;
  };
  readonly review: {
    readonly reviewedAt: string;
    readonly reviewerUserId: string;
    readonly state: "approved" | "expired" | "withdrawn";
  };
  readonly sourceKind: "creator-owned-synthetic";
  readonly spdxLicenseListVersion: string;
}

export interface CatalogSourceMaterial {
  readonly baseColourSrgb8: readonly [number, number, number];
  readonly emissiveSrgb8: readonly [number, number, number];
  readonly metallicBasisPoints: number;
  readonly name: string;
  readonly physicalRepeatMm: { readonly heightMm: number; readonly widthMm: number } | null;
  readonly roughnessBasisPoints: number;
}

export interface CatalogSourceAsset {
  readonly artifacts: readonly CatalogSourceArtifact[];
  readonly c12Asset: InteriorAssetRef;
  readonly description: string;
  readonly displayName: string;
  readonly material: CatalogSourceMaterial;
  readonly rights: CatalogSourceRights;
  readonly slug: string;
  readonly tags: readonly string[];
}

export interface CatalogSourceManifest {
  readonly assets: readonly CatalogSourceAsset[];
  readonly createdAt: string;
  readonly releaseVersion: string;
  readonly schemaVersion: typeof catalogSourceManifestSchemaVersion;
}

export interface ValidatedGlb {
  readonly boundsMetres: {
    readonly maximum: readonly [number, number, number];
    readonly minimum: readonly [number, number, number];
  };
  readonly material: {
    readonly baseColourSrgb8: readonly [number, number, number];
    readonly emissiveSrgb8: readonly [number, number, number];
    readonly metallicBasisPoints: number;
    readonly name: string;
    readonly roughnessBasisPoints: number;
  };
  readonly materials: number;
  readonly meshes: number;
  readonly nodes: number;
  readonly triangles: number;
  readonly vertices: number;
}

export interface ValidatedPng {
  readonly bytes: Uint8Array;
  readonly heightPx: number;
  readonly widthPx: number;
}

export interface CatalogValidatedAsset {
  readonly artifactBytes: ReadonlyMap<string, Uint8Array>;
  readonly record: CatalogAssetVersion;
}

export interface CatalogPublishedRelease {
  readonly assets: readonly CatalogAssetVersion[];
  readonly manifestBytes: Uint8Array;
  readonly release: CatalogRelease;
}

export interface CatalogArtifactPublication {
  readonly artifact: CatalogArtifact;
  readonly bytes: Uint8Array;
}

export interface KhronosValidatorEvidence {
  readonly issueCodes: readonly string[];
  readonly numErrors: number;
  readonly numWarnings: number;
  readonly validatorVersion: string;
}

export interface KhronosValidatorPort {
  validate(bytes: Uint8Array, artifactSha256: string): Promise<KhronosValidatorEvidence>;
}
