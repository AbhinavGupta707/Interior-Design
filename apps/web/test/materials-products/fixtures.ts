import {
  catalogAssetVersionSchema,
  catalogReleaseSchema,
  projectSchema,
  sessionSchema,
  specificationSchema,
  substitutionConfirmationSchema,
  substitutionPreviewSchema,
} from "@interior-design/contracts";
import type { CatalogAssetVersion } from "@interior-design/contracts";

export function uuid(value: number): string {
  return `c1300000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

export function hash(digit: string): string {
  return digit.repeat(64);
}

export const ids = Object.freeze({
  assetChair: uuid(20),
  assetFinish: uuid(21),
  assetLight: uuid(22),
  assetSofa: uuid(23),
  assetWithdrawn: uuid(24),
  branch: uuid(40),
  brief: uuid(4),
  bundle: uuid(5),
  commit: uuid(6),
  confirmation: uuid(7),
  elementChair: uuid(30),
  elementFinish: uuid(31),
  elementLight: uuid(32),
  level: uuid(33),
  lineChair: uuid(34),
  lineFinish: uuid(35),
  lineLight: uuid(36),
  model: uuid(8),
  modelPreview: uuid(51),
  option: uuid(9),
  optionJob: uuid(10),
  preview: uuid(50),
  project: uuid(3),
  release: uuid(12),
  resultSnapshot: uuid(13),
  room: uuid(37),
  sceneJob: uuid(52),
  specification: uuid(14),
  tenant: uuid(1),
  user: uuid(2),
  viewer: uuid(15),
});

function artifact(
  assetIndex: number,
  role: "licence-text" | "model" | "source-receipt" | "thumbnail",
  digit: string,
) {
  const sha256 = hash(digit);
  return {
    artifactId: uuid(
      assetIndex * 10 +
        ["model", "thumbnail", "licence-text", "source-receipt"].indexOf(role) +
        100,
    ),
    byteLength: 512,
    derivation: {
      configurationSha256: hash("a"),
      sourceSha256: [sha256],
      tool: "C13 creator-authored fixture builder",
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
  };
}

function makeAsset(input: {
  readonly assetId: string;
  readonly colour: readonly [number, number, number];
  readonly index: number;
  readonly kind: "finish" | "furnishing" | "light";
  readonly lifecycle?: "approved" | "withdrawn";
  readonly name: string;
  readonly rightsState?: "approved" | "withdrawn";
  readonly sourceKind?: "creator-owned-synthetic" | "licensed-local";
}): CatalogAssetVersion {
  const rightsHash = hash(String((input.index % 8) + 1));
  const contentHash = hash(String(((input.index + 1) % 8) + 1));
  const metadataHash = hash(String(((input.index + 2) % 8) + 1));
  const policyHash = hash(String(((input.index + 3) % 8) + 1));
  const c12Asset = {
    category: `${input.kind}-generic`,
    contentSha256: contentHash,
    geometryEnvelopeMm:
      input.kind === "finish"
        ? { depthMm: 20, heightMm: 2_400, widthMm: 3_600 }
        : input.kind === "light"
          ? { depthMm: 420, heightMm: 260, widthMm: 420 }
          : { depthMm: 860, heightMm: 780, widthMm: 1_840 },
    id: input.assetId,
    kind: input.kind,
    materialLabel: `${input.name} material`,
    metadataSha256: metadataHash,
    placementPolicy: {
      allowedRotationMilliDegrees: [0, 90_000, 180_000, 270_000],
      clearanceMm: { back: 50, front: 650, left: 100, right: 100 },
      forwardAxis: "positive-y" as const,
      origin: "bounding-box-centre-floor" as const,
      policySha256: policyHash,
    },
    representationStatus: "bounded-proxy" as const,
    rights: {
      attributionRequired: false as const,
      derivativesAllowed: true as const,
      licenceId: "LicenseRef-InteriorDesign-CreatorOwned-Synthetic" as const,
      redistributionAllowed: false as const,
      rightsRecordSha256: rightsHash,
      serviceProcessingAllowed: true as const,
      sourceKind: "creator-owned-synthetic" as const,
      trainingAllowed: false as const,
      usage: "service-and-derived-designs" as const,
    },
    schemaVersion: "c12-interior-asset-ref-v1" as const,
    version: "1.0.0",
    versionId: input.assetId,
  };
  const licenceHash = hash("c");
  const receiptHash = hash("d");
  return catalogAssetVersionSchema.parse({
    artifacts: [
      artifact(input.index, "model", "a"),
      artifact(input.index, "thumbnail", "b"),
      artifact(input.index, "licence-text", "c"),
      artifact(input.index, "source-receipt", "d"),
    ],
    assetId: input.assetId,
    category: `${input.kind}-generic`,
    commercialData: {
      delivery: "not-provided",
      liveAvailability: "not-provided",
      price: "not-provided",
      supplier: "not-provided",
    },
    description: `${input.name} is deterministic creator-authored fixture data for local C13 acceptance.`,
    displayName: input.name,
    kind: input.kind,
    lifecycle: input.lifecycle ?? "approved",
    materials: [
      {
        baseColourSrgb8: input.colour,
        emissiveSrgb8: [0, 0, 0],
        materialId: uuid(300 + input.index),
        metallicBasisPoints: 0,
        name: `${input.name} base material`,
        opaque: true,
        roughnessBasisPoints: 7_500,
        schemaVersion: "c13-material-definition-v1",
        textureArtifactIds: [],
        uvSet: 0,
      },
    ],
    placementProjection: {
      c12Asset,
      coordinateTransform: "gltf-front-positive-z-to-interior-forward-positive-y-v1",
      floorCentredPivot: true,
      gltfMetresToInteriorMillimetres: 1_000,
      projectionSha256: hash("e"),
      schemaVersion: "c13-placement-projection-v1",
    },
    rights: {
      concludedLicenceExpression:
        input.sourceKind === "licensed-local"
          ? "CC-BY-4.0"
          : "LicenseRef-InteriorDesign-CreatorOwned-Synthetic",
      creator:
        input.sourceKind === "licensed-local"
          ? "Synthetic local licence fixture creator"
          : "Interior Design synthetic fixture team",
      declaredLicenceExpression:
        input.sourceKind === "licensed-local"
          ? "CC-BY-4.0"
          : "LicenseRef-InteriorDesign-CreatorOwned-Synthetic",
      grants: {
        commercialUse: true,
        derivatives: true,
        rawRedistribution: false,
        renderedOutputDistribution: true,
        thumbnailDisplay: true,
      },
      licenceTextArtifactSha256: licenceHash,
      policy: { serviceProcessingAllowed: true, trainingAllowed: false },
      recordSha256: rightsHash,
      review: {
        reviewedAt: "2026-07-18T12:00:00.000Z",
        reviewerUserId: ids.user,
        state: input.rightsState ?? "approved",
      },
      schemaVersion: "c13-catalog-rights-record-v1",
      sourceKind: input.sourceKind ?? "creator-owned-synthetic",
      sourceReceiptArtifactSha256: receiptHash,
      spdxLicenseListVersion: "3.27",
    },
    schemaVersion: "c13-catalog-asset-version-v1",
    tags: [input.kind, "generic", "fixture"],
    version: "1.0.0",
    versionId: input.assetId,
    versionSha256: hash("f"),
  });
}

export const chairAsset = makeAsset({
  assetId: ids.assetChair,
  colour: [180, 164, 139],
  index: 1,
  kind: "furnishing",
  name: "Generic low lounge chair",
});
export const sofaAsset = makeAsset({
  assetId: ids.assetSofa,
  colour: [118, 137, 126],
  index: 2,
  kind: "furnishing",
  name: "Generic compact sofa",
  sourceKind: "licensed-local",
});
export const finishAsset = makeAsset({
  assetId: ids.assetFinish,
  colour: [222, 216, 199],
  index: 3,
  kind: "finish",
  name: "Generic chalk wall finish",
});
export const lightAsset = makeAsset({
  assetId: ids.assetLight,
  colour: [236, 217, 174],
  index: 4,
  kind: "light",
  name: "Generic opal pendant light",
});
export const withdrawnAsset = makeAsset({
  assetId: ids.assetWithdrawn,
  colour: [143, 108, 96],
  index: 5,
  kind: "furnishing",
  lifecycle: "withdrawn",
  name: "Withdrawn generic armchair",
  rightsState: "withdrawn",
});

export const release = catalogReleaseSchema.parse({
  assetVersionIds: [
    chairAsset.versionId,
    sofaAsset.versionId,
    finishAsset.versionId,
    lightAsset.versionId,
    withdrawnAsset.versionId,
  ],
  createdAt: "2026-07-18T12:30:00.000Z",
  manifestSha256: hash("1"),
  releaseId: ids.release,
  schemaVersion: "c13-catalog-release-v1",
  status: "published",
  version: "1.0.0",
});

const sourceConfirmation = {
  acceptedBrief: { briefId: ids.brief, contentSha256: hash("2"), revision: 3 },
  assetManifestSha256: hash("3"),
  branchId: ids.branch,
  branchRevision: 2,
  bundleId: ids.bundle,
  bundleSha256: hash("4"),
  candidateSnapshotSha256: hash("5"),
  commitId: ids.commit,
  confirmationId: ids.confirmation,
  jobId: ids.optionJob,
  jobVersion: 4,
  modelId: ids.model,
  optionId: ids.option,
  optionSetSha256: hash("6"),
  profile: "proposed" as const,
  resultSnapshotId: ids.resultSnapshot,
  resultSnapshotSha256: hash("7"),
  resultSnapshotVersion: 8,
};

function line(input: {
  readonly asset: CatalogAssetVersion;
  readonly elementId: string;
  readonly kind: "finish" | "furnishing" | "light";
  readonly lineId: string;
  readonly roomReview?: boolean;
}) {
  return {
    assetContentSha256: input.asset.placementProjection.c12Asset.contentSha256,
    assetMetadataSha256: input.asset.placementProjection.c12Asset.metadataSha256,
    assetVersionId: input.asset.versionId,
    assetVersionSha256: input.asset.versionSha256,
    catalogReleaseId: release.releaseId,
    catalogReleaseSha256: release.manifestSha256,
    decisionStatus: input.roomReview ? ("needs-review" as const) : ("selected" as const),
    elementId: input.elementId,
    kind: input.kind,
    levelId: ids.level,
    lineId: input.lineId,
    notes: "",
    placementPolicySha256: input.asset.placementProjection.c12Asset.placementPolicy.policySha256,
    placementProjectionSha256: input.asset.placementProjection.projectionSha256,
    quantity:
      input.kind === "finish"
        ? ({ reason: "not-derived-in-c13", state: "unknown" } as const)
        : ({ count: 1, state: "counted" } as const),
    rightsRecordSha256: input.asset.rights.recordSha256,
    roomAssignment: input.roomReview
      ? ({
          reason: "Two source spaces overlap this finish target.",
          status: "review-required",
        } as const)
      : ({ spaceId: ids.room, status: "assigned" } as const),
    schemaVersion: "c13-specification-line-v1" as const,
    selectionSource: {
      confirmationId: ids.confirmation,
      kind: "confirmed-option" as const,
    },
  };
}

export const chairLine = line({
  asset: chairAsset,
  elementId: ids.elementChair,
  kind: "furnishing",
  lineId: ids.lineChair,
});
export const finishLine = line({
  asset: finishAsset,
  elementId: ids.elementFinish,
  kind: "finish",
  lineId: ids.lineFinish,
  roomReview: true,
});
export const lightLine = line({
  asset: lightAsset,
  elementId: ids.elementLight,
  kind: "light",
  lineId: ids.lineLight,
});

export const specification = specificationSchema.parse({
  currentRevision: {
    branchId: ids.branch,
    branchRevision: 2,
    catalogReleaseId: release.releaseId,
    catalogReleaseSha256: release.manifestSha256,
    createdAt: "2026-07-18T12:35:00.000Z",
    createdBy: ids.user,
    lines: [chairLine, finishLine, lightLine],
    modelSnapshotId: ids.resultSnapshot,
    modelSnapshotSha256: hash("7"),
    revision: 1,
    revisionSha256: hash("8"),
    schemaVersion: "c13-specification-revision-v1",
    sourceConfirmation,
  },
  projectId: ids.project,
  schemaVersion: "c13-specification-v1",
  selectionBoard: {
    entries: [chairLine, finishLine, lightLine].map((item) => ({
      assetVersionId: item.assetVersionId,
      elementId: item.elementId,
      note: item.notes,
      state: item.decisionStatus,
    })),
    revision: 1,
    schemaVersion: "c13-selection-board-v1",
  },
  specificationId: ids.specification,
  status: "working",
});

export const specificationRevisionTwo = specificationSchema.parse({
  ...specification,
  currentRevision: {
    ...specification.currentRevision,
    createdAt: "2026-07-18T12:40:00.000Z",
    revision: 2,
    revisionSha256: hash("9"),
  },
  selectionBoard: {
    ...specification.selectionBoard,
    entries: specification.selectionBoard.entries.map((entry) =>
      entry.elementId === ids.elementChair
        ? { ...entry, note: "Keep near the west window.", state: "shortlisted" }
        : entry,
    ),
    revision: 2,
  },
});

export const preview = substitutionPreviewSchema.parse({
  baseSnapshotId: ids.resultSnapshot,
  baseSnapshotSha256: hash("7"),
  candidateSnapshotSha256: hash("a"),
  elementId: ids.elementChair,
  expiresAt: "2027-07-18T13:30:00.000Z",
  findings: ["Candidate retains the supplied 650 mm front clearance."],
  modelPreviewId: ids.modelPreview,
  previewId: ids.preview,
  replacementAssetVersionId: sofaAsset.versionId,
  replacementAssetVersionSha256: sofaAsset.versionSha256,
  schemaVersion: "c13-substitution-preview-v1",
  specificationId: ids.specification,
  specificationRevision: 1,
  visualisationStatus: "bounded-catalog-preview-only",
});

export const confirmation = substitutionConfirmationSchema.parse({
  commitId: uuid(53),
  confirmationId: uuid(54),
  elementId: ids.elementChair,
  resultSnapshotId: uuid(55),
  resultSnapshotSha256: hash("b"),
  sceneJobId: ids.sceneJob,
  schemaVersion: "c13-substitution-confirmation-v1",
  specificationId: ids.specification,
  specificationRevision: 2,
});

export const project = projectSchema.parse({
  createdAt: "2026-07-18T09:00:00.000Z",
  id: ids.project,
  name: "Synthetic room specification",
  status: "active",
  tenantId: ids.tenant,
  updatedAt: "2026-07-18T12:35:00.000Z",
  version: 4,
});

export const ownerSession = sessionSchema.parse({
  actor: {
    displayName: "Synthetic Owner",
    role: "owner",
    subject: "fixture:c13-owner",
    tenantId: ids.tenant,
    userId: ids.user,
  },
  authMode: "local-fixture",
  expiresAt: "2027-07-18T12:00:00.000Z",
});

export const viewerSession = sessionSchema.parse({
  actor: {
    displayName: "Synthetic Viewer",
    role: "viewer",
    subject: "fixture:c13-viewer",
    tenantId: ids.tenant,
    userId: ids.viewer,
  },
  authMode: "local-fixture",
  expiresAt: "2027-07-18T12:00:00.000Z",
});

export const releasesResponse = { releases: [release] };
export const specificationsResponse = { projectId: ids.project, specifications: [specification] };
export const scheduleResponse = {
  lines: specification.currentRevision.lines,
  revision: 1,
  specificationId: ids.specification,
};
export const assetsResponse = {
  assets: [chairAsset, sofaAsset, finishAsset, lightAsset, withdrawnAsset],
  releaseId: ids.release,
  total: 5,
};
