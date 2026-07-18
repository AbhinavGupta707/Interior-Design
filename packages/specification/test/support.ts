import {
  c12DesignElementOperationSchemaVersion,
  c13CatalogArtifactSchemaVersion,
  c13CatalogAssetVersionSchemaVersion,
  c13CatalogReleaseSchemaVersion,
  c13CatalogRightsSchemaVersion,
  c13MaterialDefinitionSchemaVersion,
  c13PlacementProjectionSchemaVersion,
  c4SchemaVersion,
  canonicalHomeSnapshotSchema,
  catalogAssetVersionSchema,
  catalogReleaseSchema,
  optionOperationBundleSchema,
  type CatalogAssetVersion,
  type C12ConfirmationSource,
} from "@interior-design/contracts";

export const ids = Object.freeze({
  asset: "c1300000-0000-4000-8000-000000000010",
  assetVersion: "c1300000-0000-4000-8000-000000000011",
  branch: "c1300000-0000-4000-8000-000000000012",
  brief: "c1300000-0000-4000-8000-000000000013",
  bundle: "c1300000-0000-4000-8000-000000000014",
  commit: "c1300000-0000-4000-8000-000000000015",
  confirmation: "c1300000-0000-4000-8000-000000000016",
  element: "c1300000-0000-4000-8000-000000000017",
  evidence: "c1300000-0000-4000-8000-000000000018",
  job: "c1300000-0000-4000-8000-000000000019",
  level: "c1300000-0000-4000-8000-000000000020",
  material: "c1300000-0000-4000-8000-000000000021",
  model: "c1300000-0000-4000-8000-000000000022",
  option: "c1300000-0000-4000-8000-000000000023",
  project: "c1300000-0000-4000-8000-000000000024",
  release: "c1300000-0000-4000-8000-000000000025",
  snapshot: "c1300000-0000-4000-8000-000000000026",
  space: "c1300000-0000-4000-8000-000000000027",
  specification: "c1300000-0000-4000-8000-000000000028",
  user: "c1300000-0000-4000-8000-000000000029",
});

export const hashes = Object.freeze({
  assetContent: "1".repeat(64),
  assetMetadata: "2".repeat(64),
  bundle: "3".repeat(64),
  candidate: "4".repeat(64),
  config: "5".repeat(64),
  optionSet: "6".repeat(64),
  placement: "7".repeat(64),
  policy: "8".repeat(64),
  release: "9".repeat(64),
  rights: "a".repeat(64),
  snapshot: "b".repeat(64),
  version: "c".repeat(64),
});

function attribution(claimId: string) {
  return {
    actorUserId: ids.user,
    claimId,
    evidenceIds: [],
    method: { kind: "fixture" as const, name: "Synthetic C13 fixture", version: "1" },
    state: "user-asserted" as const,
    verification: { status: "not-reviewed" as const },
  };
}

function known<T>(claimId: string, value: T) {
  return { attribution: attribution(claimId), knowledge: "known" as const, value };
}

export function snapshot(profile: "existing" | "proposed" | "as-built" = "proposed") {
  return canonicalHomeSnapshotSchema.parse({
    coordinateSystem: {
      axes: { x: "east", y: "north", z: "up" },
      globalAnchor: { status: "not-established" },
      handedness: "right",
      kind: "local-cartesian",
      lengthUnit: "mm",
      originConvention: "project-local-model-origin",
    },
    ...(profile === "existing" ? {} : { derivedFromSnapshotSha256: "d".repeat(64) }),
    elements: {
      cameras: [],
      finishes: [],
      fixedObjects: [],
      furnishings: [
        {
          category: known("c1300000-0000-4000-8000-000000000101", "synthetic chair"),
          dimensions: known("c1300000-0000-4000-8000-000000000102", {
            depthMm: 1_000,
            heightMm: 800,
            widthMm: 1_000,
          }),
          elementType: "furnishing",
          id: ids.element,
          levelId: ids.level,
          name: known("c1300000-0000-4000-8000-000000000103", "Fixture chair"),
          origin: attribution("c1300000-0000-4000-8000-000000000104"),
          placement: {
            position: known("c1300000-0000-4000-8000-000000000105", {
              xMm: 1_500,
              yMm: 1_500,
              zMm: 0,
            }),
            rotationMilliDegrees: known("c1300000-0000-4000-8000-000000000106", 0),
          },
        },
      ],
      levels: [
        {
          elementType: "level",
          elevationMm: known("c1300000-0000-4000-8000-000000000107", 0),
          id: ids.level,
          name: known("c1300000-0000-4000-8000-000000000108", "Ground"),
          origin: attribution("c1300000-0000-4000-8000-000000000109"),
          storeyHeightMm: known("c1300000-0000-4000-8000-000000000110", 2_500),
        },
      ],
      lights: [],
      openings: [],
      spaces: [
        {
          boundary: known("c1300000-0000-4000-8000-000000000111", [
            { xMm: 0, yMm: 0 },
            { xMm: 3_000, yMm: 0 },
            { xMm: 3_000, yMm: 3_000 },
            { xMm: 0, yMm: 3_000 },
          ]),
          boundedByElementIds: [],
          classification: known("c1300000-0000-4000-8000-000000000112", "room"),
          elementType: "space",
          id: ids.space,
          levelId: ids.level,
          name: known("c1300000-0000-4000-8000-000000000113", "Synthetic room"),
          origin: attribution("c1300000-0000-4000-8000-000000000114"),
        },
      ],
      stairs: [],
      surfaces: [],
      walls: [],
    },
    knownLimitations: [{ code: "SYNTHETIC_ONLY", detail: "Creator-authored test data only." }],
    modelId: ids.model,
    profile,
    projectId: ids.project,
    schemaVersion: c4SchemaVersion,
  });
}

function artifact(role: "licence-text" | "model" | "source-receipt" | "thumbnail", index: number) {
  const sha256 = index.toString(16).repeat(64);
  return {
    artifactId: `c1300000-0000-4000-8000-00000000020${String(index)}`,
    byteLength: role === "model" ? 128 : 64,
    derivation: {
      configurationSha256: hashes.config,
      sourceSha256: [],
      tool: "synthetic-c13-fixture",
      toolVersion: "1",
    },
    ...(role === "thumbnail"
      ? { image: { colourEncoding: "srgb", heightPx: 512, semantic: "thumbnail", widthPx: 512 } }
      : {}),
    mediaType:
      role === "model"
        ? "model/gltf-binary"
        : role === "thumbnail"
          ? "image/png"
          : "text/plain; charset=utf-8",
    objectKey: `catalog/sha256/${sha256.slice(0, 2)}/${sha256}`,
    role,
    schemaVersion: c13CatalogArtifactSchemaVersion,
    sha256,
  } as const;
}

export function catalogAsset(options?: {
  readonly kind?: "finish" | "furnishing" | "light";
  readonly lifecycle?: "approved" | "withdrawn";
  readonly versionId?: string;
  readonly widthMm?: number;
}): CatalogAssetVersion {
  const kind = options?.kind ?? "furnishing";
  const versionId = options?.versionId ?? ids.assetVersion;
  const c12Asset = {
    category: `synthetic-${kind}`,
    contentSha256: hashes.assetContent,
    geometryEnvelopeMm: {
      depthMm: 1_000,
      heightMm: 800,
      widthMm: options?.widthMm ?? 1_000,
    },
    id: ids.asset,
    kind,
    materialLabel: "synthetic creator-authored material",
    metadataSha256: hashes.assetMetadata,
    placementPolicy: {
      allowedRotationMilliDegrees: [0],
      clearanceMm: { back: 0, front: 0, left: 0, right: 0 },
      forwardAxis: "positive-y",
      origin: "bounding-box-centre-floor",
      policySha256: hashes.policy,
    },
    representationStatus: "bounded-proxy",
    rights: {
      attributionRequired: false,
      derivativesAllowed: true,
      licenceId: "LicenseRef-InteriorDesign-CreatorOwned-Synthetic",
      redistributionAllowed: false,
      rightsRecordSha256: hashes.rights,
      serviceProcessingAllowed: true,
      sourceKind: "creator-owned-synthetic",
      trainingAllowed: false,
      usage: "service-and-derived-designs",
    },
    schemaVersion: "c12-interior-asset-ref-v1",
    version: "1.0.0",
    versionId,
  } as const;
  return catalogAssetVersionSchema.parse({
    artifacts: [
      artifact("model", 1),
      artifact("thumbnail", 2),
      artifact("licence-text", 3),
      artifact("source-receipt", 4),
    ],
    assetId: ids.asset,
    category: `synthetic-${kind}`,
    commercialData: {
      delivery: "not-provided",
      liveAvailability: "not-provided",
      price: "not-provided",
      supplier: "not-provided",
    },
    description: "Creator-authored synthetic catalog fixture with no commercial claims.",
    displayName: `Synthetic ${kind}`,
    kind,
    lifecycle: options?.lifecycle ?? "approved",
    materials: [
      {
        baseColourSrgb8: [10, 20, 30],
        emissiveSrgb8: [0, 0, 0],
        materialId: ids.material,
        metallicBasisPoints: 0,
        name: "Synthetic material",
        opaque: true,
        roughnessBasisPoints: 5_000,
        schemaVersion: c13MaterialDefinitionSchemaVersion,
        textureArtifactIds: [],
        uvSet: 0,
      },
    ],
    placementProjection: {
      c12Asset,
      coordinateTransform: "gltf-front-positive-z-to-interior-forward-positive-y-v1",
      floorCentredPivot: true,
      gltfMetresToInteriorMillimetres: 1_000,
      projectionSha256: hashes.placement,
      schemaVersion: c13PlacementProjectionSchemaVersion,
    },
    rights: {
      concludedLicenceExpression: "LicenseRef-InteriorDesign-CreatorOwned-Synthetic",
      creator: "C13 synthetic fixture author",
      declaredLicenceExpression: "LicenseRef-InteriorDesign-CreatorOwned-Synthetic",
      grants: {
        commercialUse: true,
        derivatives: true,
        rawRedistribution: false,
        renderedOutputDistribution: true,
        thumbnailDisplay: true,
      },
      licenceTextArtifactSha256: "3".repeat(64),
      policy: { serviceProcessingAllowed: true, trainingAllowed: false },
      recordSha256: hashes.rights,
      review: {
        reviewedAt: "2026-07-18T12:00:00.000Z",
        reviewerUserId: ids.user,
        state: "approved",
      },
      schemaVersion: c13CatalogRightsSchemaVersion,
      sourceKind: "creator-owned-synthetic",
      sourceReceiptArtifactSha256: "4".repeat(64),
      spdxLicenseListVersion: "3.27.0",
    },
    schemaVersion: c13CatalogAssetVersionSchemaVersion,
    tags: ["synthetic"],
    version: "1.0.0",
    versionId,
    versionSha256: hashes.version,
  });
}

export function catalogRelease(assetVersionIds: readonly string[] = [ids.assetVersion]) {
  return catalogReleaseSchema.parse({
    assetVersionIds,
    createdAt: "2026-07-18T12:00:00.000Z",
    manifestSha256: hashes.release,
    releaseId: ids.release,
    schemaVersion: c13CatalogReleaseSchemaVersion,
    status: "published",
    version: "1.0.0",
  });
}

export const sourceConfirmation: C12ConfirmationSource = {
  acceptedBrief: { briefId: ids.brief, contentSha256: "e".repeat(64), revision: 2 },
  assetManifestSha256: "f".repeat(64),
  branchId: ids.branch,
  branchRevision: 1,
  bundleId: ids.bundle,
  bundleSha256: hashes.bundle,
  candidateSnapshotSha256: hashes.candidate,
  commitId: ids.commit,
  confirmationId: ids.confirmation,
  jobId: ids.job,
  jobVersion: 3,
  modelId: ids.model,
  optionId: ids.option,
  optionSetSha256: hashes.optionSet,
  profile: "proposed",
  resultSnapshotId: ids.snapshot,
  resultSnapshotSha256: hashes.snapshot,
  resultSnapshotVersion: 2,
};

export function bundle(asset = catalogAsset()) {
  const projected = asset.placementProjection.c12Asset;
  return optionOperationBundleSchema.parse({
    assetPlacements: [{ asset: projected, elementId: ids.element, spaceId: ids.space }],
    baseModel: {
      modelId: ids.model,
      profile: "proposed",
      snapshotId: ids.snapshot,
      snapshotSha256: hashes.snapshot,
      snapshotVersion: 2,
    },
    bundleSha256: hashes.bundle,
    candidateSnapshotSha256: hashes.candidate,
    constraintResults: [],
    id: ids.bundle,
    operations: [
      {
        assetBinding: {
          assetId: projected.id,
          assetVersionId: projected.versionId,
          contentSha256: projected.contentSha256,
          metadataSha256: projected.metadataSha256,
          placementPolicySha256: projected.placementPolicy.policySha256,
          rightsRecordSha256: projected.rights.rightsRecordSha256,
        },
        clientOperationId: "c1300000-0000-4000-8000-000000000230",
        element: snapshot().elements.furnishings[0],
        expectedElementId: ids.element,
        reason: "Retain exact fixture placement.",
        schemaVersion: c12DesignElementOperationSchemaVersion,
        type: "design.element.replace.v1",
      },
    ],
    projectId: ids.project,
    schemaVersion: "c12-operation-bundle-v1",
  });
}

export function initialLinesInput(asset = catalogAsset()) {
  return {
    assets: [asset],
    bundle: bundle(asset),
    catalogRelease: catalogRelease([asset.versionId]),
    catalogReleaseSha256: hashes.release,
    snapshot: snapshot(),
    source: sourceConfirmation,
    specificationId: ids.specification,
  };
}

export function only<T>(values: readonly T[]): T {
  const value = values[0];
  if (value === undefined || values.length !== 1) {
    throw new Error(`Expected exactly one synthetic value; received ${String(values.length)}.`);
  }
  return value;
}
