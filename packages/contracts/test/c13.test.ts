import { describe, expect, it } from "vitest";

import {
  c13CatalogPolicy,
  c13RouteContract,
  catalogAssetVersionSchema,
  catalogRightsRecordSchema,
  createSubstitutionPreviewRequestSchema,
} from "../src/index.js";

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const hashC = "c".repeat(64);
const hashD = "d".repeat(64);
const uuid = (suffix: string) => `13000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

const artifact = (
  id: string,
  role: "model" | "thumbnail" | "licence-text" | "source-receipt",
  sha256: string,
) => ({
  artifactId: id,
  byteLength: 128,
  derivation: {
    configurationSha256: hashA,
    sourceSha256: [sha256],
    tool: "C13 deterministic fixture builder",
    toolVersion: "1.0.0",
  },
  ...(role === "thumbnail"
    ? {
        image: {
          colourEncoding: "srgb" as const,
          heightPx: 512,
          semantic: "thumbnail" as const,
          widthPx: 512,
        },
      }
    : {}),
  mediaType:
    role === "model"
      ? ("model/gltf-binary" as const)
      : role === "thumbnail"
        ? ("image/png" as const)
        : ("text/plain; charset=utf-8" as const),
  objectKey: `catalog/sha256/${sha256.slice(0, 2)}/${sha256}`,
  role,
  schemaVersion: "c13-catalog-artifact-v1" as const,
  sha256,
});

const rights = {
  concludedLicenceExpression: "LicenseRef-InteriorDesign-CreatorOwned-Synthetic",
  creator: "Interior Design synthetic fixture team",
  declaredLicenceExpression: "LicenseRef-InteriorDesign-CreatorOwned-Synthetic",
  grants: {
    commercialUse: true,
    derivatives: true,
    rawRedistribution: false,
    renderedOutputDistribution: true,
    thumbnailDisplay: true,
  },
  licenceTextArtifactSha256: hashC,
  policy: { serviceProcessingAllowed: true, trainingAllowed: false },
  recordSha256: hashA,
  review: {
    reviewedAt: "2026-07-18T12:00:00.000Z",
    reviewerUserId: uuid("1"),
    state: "approved" as const,
  },
  schemaVersion: "c13-catalog-rights-record-v1" as const,
  sourceKind: "creator-owned-synthetic" as const,
  sourceReceiptArtifactSha256: hashD,
  spdxLicenseListVersion: "3.27",
};

const c12Asset = {
  category: "generic-chair",
  contentSha256: hashA,
  geometryEnvelopeMm: { depthMm: 800, heightMm: 900, widthMm: 750 },
  id: uuid("2"),
  kind: "furnishing" as const,
  materialLabel: "Generic creator-owned textile",
  metadataSha256: hashB,
  placementPolicy: {
    allowedRotationMilliDegrees: [0, 90_000, 180_000, 270_000],
    clearanceMm: { back: 50, front: 600, left: 100, right: 100 },
    forwardAxis: "positive-y" as const,
    origin: "bounding-box-centre-floor" as const,
    policySha256: hashC,
  },
  representationStatus: "bounded-proxy" as const,
  rights: {
    attributionRequired: false,
    derivativesAllowed: true,
    licenceId: "LicenseRef-InteriorDesign-CreatorOwned-Synthetic" as const,
    redistributionAllowed: false,
    rightsRecordSha256: hashA,
    serviceProcessingAllowed: true,
    sourceKind: "creator-owned-synthetic" as const,
    trainingAllowed: false,
    usage: "service-and-derived-designs" as const,
  },
  schemaVersion: "c12-interior-asset-ref-v1" as const,
  version: "1.0.0",
  versionId: uuid("3"),
};

const asset = {
  artifacts: [
    artifact(uuid("4"), "model", hashA),
    artifact(uuid("5"), "thumbnail", hashB),
    artifact(uuid("6"), "licence-text", hashC),
    artifact(uuid("7"), "source-receipt", hashD),
  ],
  assetId: c12Asset.id,
  category: "generic-chair",
  commercialData: {
    delivery: "not-provided" as const,
    liveAvailability: "not-provided" as const,
    price: "not-provided" as const,
    supplier: "not-provided" as const,
  },
  description: "A deterministic creator-owned generic chair fixture.",
  displayName: "Generic lounge chair",
  kind: "furnishing" as const,
  lifecycle: "approved" as const,
  materials: [],
  placementProjection: {
    c12Asset,
    coordinateTransform: "gltf-front-positive-z-to-interior-forward-positive-y-v1" as const,
    floorCentredPivot: true as const,
    gltfMetresToInteriorMillimetres: 1_000 as const,
    projectionSha256: hashD,
    schemaVersion: "c13-placement-projection-v1" as const,
  },
  rights,
  schemaVersion: "c13-catalog-asset-version-v1" as const,
  tags: ["generic", "chair"],
  version: "1.0.0",
  versionId: c12Asset.versionId,
  versionSha256: hashB,
};

describe("C13 frozen shared contracts", () => {
  it("wraps an exact C12 placement projection with reviewed rights and explicit unknown commercial data", () => {
    expect(catalogAssetVersionSchema.parse(asset)).toEqual(asset);
    expect(
      catalogAssetVersionSchema.safeParse({
        ...asset,
        commercialData: { ...asset.commercialData, price: "£1,000" },
      }).success,
    ).toBe(false);
  });

  it("requires licence text for custom SPDX LicenseRef expressions and denies training", () => {
    expect(catalogRightsRecordSchema.parse(rights)).toEqual(rights);
    expect(
      catalogRightsRecordSchema.safeParse({ ...rights, licenceTextArtifactSha256: undefined })
        .success,
    ).toBe(false);
    expect(
      catalogRightsRecordSchema.safeParse({
        ...rights,
        policy: { ...rights.policy, trainingAllowed: true },
      }).success,
    ).toBe(false);
  });

  it("pins substitution previews to one specification and branch revision", () => {
    expect(
      createSubstitutionPreviewRequestSchema.parse({
        elementId: uuid("8"),
        expectedBranchRevision: 2,
        expectedSpecificationRevision: 3,
        replacementAssetVersionId: uuid("9"),
      }),
    ).toBeDefined();
  });

  it("freezes project-scoped catalog and specification routes", () => {
    expect(Object.values(c13RouteContract)).toHaveLength(15);
    expect(
      Object.values(c13RouteContract).every((route) => route.startsWith("/v1/projects/")),
    ).toBe(true);
    expect(c13CatalogPolicy.maximumGlbBytes).toBe(32 * 1024 * 1024);
  });
});
