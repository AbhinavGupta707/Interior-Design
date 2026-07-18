import { z } from "zod";

import { modelElementIdSchema, modelIdSchema, modelSnapshotIdSchema } from "./c4.js";
import {
  modelBranchIdSchema,
  modelBranchRevisionSchema,
  modelCommitIdSchema,
  modelPreviewIdSchema,
} from "./c5.js";
import { interiorAssetRefSchema } from "./c12.js";

const uuidSchema = z.uuid();
const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const boundedLabelSchema = z.string().trim().min(1).max(160);
const boundedTextSchema = z.string().trim().min(1).max(2_000);

export const c13CatalogArtifactSchemaVersion = "c13-catalog-artifact-v1" as const;
export const c13CatalogRightsSchemaVersion = "c13-catalog-rights-record-v1" as const;
export const c13MaterialDefinitionSchemaVersion = "c13-material-definition-v1" as const;
export const c13CatalogAssetVersionSchemaVersion = "c13-catalog-asset-version-v1" as const;
export const c13CatalogReleaseSchemaVersion = "c13-catalog-release-v1" as const;
export const c13PlacementProjectionSchemaVersion = "c13-placement-projection-v1" as const;
export const c13SpecificationSchemaVersion = "c13-specification-v1" as const;
export const c13SpecificationRevisionSchemaVersion = "c13-specification-revision-v1" as const;
export const c13SpecificationLineSchemaVersion = "c13-specification-line-v1" as const;
export const c13SelectionBoardSchemaVersion = "c13-selection-board-v1" as const;
export const c13SubstitutionPreviewSchemaVersion = "c13-substitution-preview-v1" as const;
export const c13SubstitutionConfirmationSchemaVersion = "c13-substitution-confirmation-v1" as const;

export const c13CatalogPolicy = Object.freeze({
  ingestionTimeoutSeconds: 60,
  maximumArtifactBytesPerAsset: 64 * 1024 * 1024,
  maximumArtifactsPerAsset: 16,
  maximumAssetsPerRelease: 512,
  maximumGlbBytes: 32 * 1024 * 1024,
  maximumGlbMaterials: 128,
  maximumGlbMeshes: 128,
  maximumGlbNodes: 512,
  maximumGlbTextures: 32,
  maximumGlbTriangles: 250_000,
  maximumGlbVertices: 500_000,
  maximumImageDimensionPixels: 4_096,
  maximumImageEncodedBytes: 8 * 1024 * 1024,
  maximumReleaseManifestBytes: 2 * 1024 * 1024,
  maximumWorkerMemoryBytes: 512 * 1024 * 1024,
  modelBoundsToleranceMm: 2,
  substitutionPreviewTtlSeconds: 3_600,
} as const);

export const catalogArtifactRoleSchema = z.enum([
  "model",
  "thumbnail",
  "texture",
  "licence-text",
  "source-receipt",
]);

export const catalogArtifactSchema = z
  .object({
    artifactId: uuidSchema,
    byteLength: z.int().positive().max(c13CatalogPolicy.maximumArtifactBytesPerAsset),
    derivation: z
      .object({
        configurationSha256: sha256HexSchema,
        sourceSha256: z.array(sha256HexSchema).max(16),
        tool: boundedLabelSchema,
        toolVersion: boundedLabelSchema,
      })
      .strict(),
    image: z
      .object({
        colourEncoding: z.enum(["srgb", "linear"]),
        heightPx: z.int().positive().max(c13CatalogPolicy.maximumImageDimensionPixels),
        semantic: z.enum([
          "thumbnail",
          "base-colour",
          "emissive",
          "normal",
          "occlusion",
          "metallic-roughness",
        ]),
        widthPx: z.int().positive().max(c13CatalogPolicy.maximumImageDimensionPixels),
      })
      .strict()
      .optional(),
    mediaType: z.enum(["model/gltf-binary", "image/png", "text/plain; charset=utf-8"]),
    objectKey: z.string().regex(/^catalog\/sha256\/[a-f0-9]{2}\/[a-f0-9]{64}$/u),
    role: catalogArtifactRoleSchema,
    schemaVersion: z.literal(c13CatalogArtifactSchemaVersion),
    sha256: sha256HexSchema,
  })
  .strict()
  .superRefine((artifact, context) => {
    if (!artifact.objectKey.endsWith(`/${artifact.sha256}`)) {
      context.addIssue({
        code: "custom",
        message: "Catalog object keys must match the exact byte hash.",
      });
    }
    const imageRole = artifact.role === "thumbnail" || artifact.role === "texture";
    if (
      imageRole !== (artifact.image !== undefined) ||
      (imageRole && artifact.mediaType !== "image/png")
    ) {
      context.addIssue({
        code: "custom",
        message: "Only PNG image artifacts require image metadata.",
      });
    }
    if (artifact.role === "model" && artifact.mediaType !== "model/gltf-binary") {
      context.addIssue({ code: "custom", message: "Model artifacts must be GLB." });
    }
  });
export type CatalogArtifact = z.infer<typeof catalogArtifactSchema>;

export const catalogRightsRecordSchema = z
  .object({
    attributionText: z.string().trim().max(1_000).optional(),
    concludedLicenceExpression: boundedLabelSchema,
    creator: boundedLabelSchema,
    declaredLicenceExpression: boundedLabelSchema,
    grants: z
      .object({
        commercialUse: z.boolean(),
        derivatives: z.boolean(),
        rawRedistribution: z.boolean(),
        renderedOutputDistribution: z.boolean(),
        thumbnailDisplay: z.boolean(),
      })
      .strict(),
    licenceTextArtifactSha256: sha256HexSchema.optional(),
    modificationNotice: z.string().trim().max(1_000).optional(),
    policy: z
      .object({ serviceProcessingAllowed: z.boolean(), trainingAllowed: z.literal(false) })
      .strict(),
    recordSha256: sha256HexSchema,
    review: z
      .object({
        reviewedAt: z.iso.datetime({ offset: true }),
        reviewerUserId: uuidSchema,
        state: z.enum(["approved", "withdrawn", "expired"]),
      })
      .strict(),
    schemaVersion: z.literal(c13CatalogRightsSchemaVersion),
    sourceKind: z.enum(["creator-owned-synthetic", "licensed-local"]),
    sourceReceiptArtifactSha256: sha256HexSchema,
    sourceUri: z.url().max(2_048).optional(),
    spdxLicenseListVersion: boundedLabelSchema,
  })
  .strict()
  .superRefine((rights, context) => {
    if (
      (rights.declaredLicenceExpression.includes("LicenseRef-") ||
        rights.concludedLicenceExpression.includes("LicenseRef-")) &&
      rights.licenceTextArtifactSha256 === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Custom LicenseRef expressions require an exact licence-text artifact hash.",
        path: ["licenceTextArtifactSha256"],
      });
    }
    if (rights.sourceKind === "creator-owned-synthetic" && rights.grants.rawRedistribution) {
      context.addIssue({
        code: "custom",
        message: "M1 creator-owned starter bytes are service-only and cannot be redistributed raw.",
        path: ["grants", "rawRedistribution"],
      });
    }
  });
export type CatalogRightsRecord = z.infer<typeof catalogRightsRecordSchema>;

const srgb8Schema = z.tuple([
  z.int().min(0).max(255),
  z.int().min(0).max(255),
  z.int().min(0).max(255),
]);

export const catalogMaterialDefinitionSchema = z
  .object({
    baseColourSrgb8: srgb8Schema,
    emissiveSrgb8: srgb8Schema,
    materialId: uuidSchema,
    metallicBasisPoints: z.int().min(0).max(10_000),
    name: boundedLabelSchema,
    opaque: z.literal(true),
    physicalRepeatMm: z
      .object({
        heightMm: z.int().positive().max(100_000),
        widthMm: z.int().positive().max(100_000),
      })
      .strict()
      .optional(),
    roughnessBasisPoints: z.int().min(0).max(10_000),
    schemaVersion: z.literal(c13MaterialDefinitionSchemaVersion),
    textureArtifactIds: z.array(uuidSchema).max(8),
    uvSet: z.int().min(0).max(1),
  })
  .strict();
export type CatalogMaterialDefinition = z.infer<typeof catalogMaterialDefinitionSchema>;

export const catalogPlacementProjectionSchema = z
  .object({
    c12Asset: interiorAssetRefSchema,
    coordinateTransform: z.literal("gltf-front-positive-z-to-interior-forward-positive-y-v1"),
    floorCentredPivot: z.literal(true),
    gltfMetresToInteriorMillimetres: z.literal(1_000),
    projectionSha256: sha256HexSchema,
    schemaVersion: z.literal(c13PlacementProjectionSchemaVersion),
  })
  .strict();
export type CatalogPlacementProjection = z.infer<typeof catalogPlacementProjectionSchema>;

export const catalogCommercialDataSchema = z
  .object({
    delivery: z.literal("not-provided"),
    liveAvailability: z.literal("not-provided"),
    price: z.literal("not-provided"),
    supplier: z.literal("not-provided"),
  })
  .strict();

export const catalogAssetVersionSchema = z
  .object({
    artifacts: z.array(catalogArtifactSchema).min(4).max(c13CatalogPolicy.maximumArtifactsPerAsset),
    assetId: uuidSchema,
    category: boundedLabelSchema,
    commercialData: catalogCommercialDataSchema,
    description: boundedTextSchema,
    displayName: boundedLabelSchema,
    kind: z.enum(["furnishing", "finish", "light"]),
    lifecycle: z.enum(["draft", "quarantined", "approved", "withdrawn", "deprecated"]),
    materials: z.array(catalogMaterialDefinitionSchema).max(32),
    placementProjection: catalogPlacementProjectionSchema,
    rights: catalogRightsRecordSchema,
    schemaVersion: z.literal(c13CatalogAssetVersionSchemaVersion),
    tags: z.array(boundedLabelSchema).max(32),
    version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u),
    versionId: uuidSchema,
    versionSha256: sha256HexSchema,
  })
  .strict()
  .superRefine((asset, context) => {
    const artifactIds = asset.artifacts.map(({ artifactId }) => artifactId);
    if (new Set(artifactIds).size !== artifactIds.length) {
      context.addIssue({ code: "custom", message: "Catalog artifact IDs must be unique." });
    }
    for (const requiredRole of ["model", "thumbnail", "licence-text", "source-receipt"] as const) {
      if (!asset.artifacts.some(({ role }) => role === requiredRole)) {
        context.addIssue({
          code: "custom",
          message: `Approved catalog assets require ${requiredRole}.`,
        });
      }
    }
    if (
      asset.rights.recordSha256 !== asset.placementProjection.c12Asset.rights.rightsRecordSha256
    ) {
      context.addIssue({
        code: "custom",
        message: "The rich rights record must match the immutable C12 placement projection.",
      });
    }
  });
export type CatalogAssetVersion = z.infer<typeof catalogAssetVersionSchema>;

export const catalogReleaseSchema = z
  .object({
    assetVersionIds: z.array(uuidSchema).min(1).max(c13CatalogPolicy.maximumAssetsPerRelease),
    createdAt: z.iso.datetime({ offset: true }),
    manifestSha256: sha256HexSchema,
    releaseId: uuidSchema,
    schemaVersion: z.literal(c13CatalogReleaseSchemaVersion),
    status: z.enum(["published", "superseded", "withdrawn"]),
    version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u),
  })
  .strict();
export type CatalogRelease = z.infer<typeof catalogReleaseSchema>;

export const c12ConfirmationSourceSchema = z
  .object({
    acceptedBrief: z
      .object({ briefId: uuidSchema, contentSha256: sha256HexSchema, revision: z.int().positive() })
      .strict(),
    assetManifestSha256: sha256HexSchema,
    branchId: modelBranchIdSchema,
    branchRevision: modelBranchRevisionSchema,
    bundleId: uuidSchema,
    bundleSha256: sha256HexSchema,
    candidateSnapshotSha256: sha256HexSchema,
    commitId: modelCommitIdSchema,
    confirmationId: uuidSchema,
    jobId: uuidSchema,
    jobVersion: z.int().positive(),
    modelId: modelIdSchema,
    optionId: uuidSchema,
    optionSetSha256: sha256HexSchema,
    profile: z.literal("proposed"),
    resultSnapshotId: modelSnapshotIdSchema,
    resultSnapshotSha256: sha256HexSchema,
    resultSnapshotVersion: z.int().positive(),
  })
  .strict();
export type C12ConfirmationSource = z.infer<typeof c12ConfirmationSourceSchema>;

export const specificationLineSchema = z
  .object({
    assetVersionId: uuidSchema,
    assetVersionSha256: sha256HexSchema,
    assetContentSha256: sha256HexSchema,
    assetMetadataSha256: sha256HexSchema,
    catalogReleaseId: uuidSchema,
    catalogReleaseSha256: sha256HexSchema,
    decisionStatus: z.enum(["selected", "shortlisted", "rejected", "needs-review"]),
    elementId: modelElementIdSchema,
    kind: z.enum(["furnishing", "finish", "light"]),
    levelId: modelElementIdSchema,
    lineId: uuidSchema,
    notes: z.string().trim().max(2_000),
    placementProjectionSha256: sha256HexSchema,
    placementPolicySha256: sha256HexSchema,
    quantity: z.discriminatedUnion("state", [
      z.object({ count: z.literal(1), state: z.literal("counted") }).strict(),
      z.object({ reason: z.literal("not-derived-in-c13"), state: z.literal("unknown") }).strict(),
    ]),
    rightsRecordSha256: sha256HexSchema,
    roomAssignment: z.discriminatedUnion("status", [
      z.object({ spaceId: modelElementIdSchema, status: z.literal("assigned") }).strict(),
      z.object({ reason: boundedTextSchema, status: z.literal("review-required") }).strict(),
    ]),
    schemaVersion: z.literal(c13SpecificationLineSchemaVersion),
    selectionSource: z.discriminatedUnion("kind", [
      z.object({ confirmationId: uuidSchema, kind: z.literal("confirmed-option") }).strict(),
      z.object({ confirmationId: uuidSchema, kind: z.literal("confirmed-substitution") }).strict(),
    ]),
  })
  .strict();
export type SpecificationLine = z.infer<typeof specificationLineSchema>;

export const selectionBoardEntrySchema = z
  .object({
    assetVersionId: uuidSchema,
    elementId: modelElementIdSchema,
    note: z.string().trim().max(1_000),
    state: z.enum(["selected", "shortlisted", "rejected", "needs-review"]),
  })
  .strict();

export const selectionBoardSchema = z
  .object({
    entries: z.array(selectionBoardEntrySchema).max(1_024),
    revision: z.int().positive(),
    schemaVersion: z.literal(c13SelectionBoardSchemaVersion),
  })
  .strict();

export const specificationRevisionSchema = z
  .object({
    branchId: modelBranchIdSchema,
    branchRevision: modelBranchRevisionSchema,
    catalogReleaseId: uuidSchema,
    catalogReleaseSha256: sha256HexSchema,
    createdAt: z.iso.datetime({ offset: true }),
    createdBy: uuidSchema,
    lines: z.array(specificationLineSchema).max(1_024),
    modelSnapshotId: modelSnapshotIdSchema,
    modelSnapshotSha256: sha256HexSchema,
    revision: z.int().positive(),
    revisionSha256: sha256HexSchema,
    schemaVersion: z.literal(c13SpecificationRevisionSchemaVersion),
    sourceConfirmation: c12ConfirmationSourceSchema,
  })
  .strict();
export type SpecificationRevision = z.infer<typeof specificationRevisionSchema>;

export const specificationSchema = z
  .object({
    currentRevision: specificationRevisionSchema,
    projectId: uuidSchema,
    schemaVersion: z.literal(c13SpecificationSchemaVersion),
    selectionBoard: selectionBoardSchema,
    specificationId: uuidSchema,
    status: z.literal("working"),
  })
  .strict();
export type Specification = z.infer<typeof specificationSchema>;

export const createSpecificationRequestSchema = z
  .object({
    catalogReleaseId: uuidSchema,
    catalogReleaseSha256: sha256HexSchema,
    confirmationId: uuidSchema,
  })
  .strict();

export const updateSelectionBoardRequestSchema = z
  .object({
    entries: z.array(selectionBoardEntrySchema).max(1_024),
    expectedRevision: z.int().positive(),
  })
  .strict();

export const createSubstitutionPreviewRequestSchema = z
  .object({
    elementId: modelElementIdSchema,
    expectedBranchRevision: modelBranchRevisionSchema,
    expectedSpecificationRevision: z.int().positive(),
    replacementAssetVersionId: uuidSchema,
  })
  .strict();

export const substitutionPreviewSchema = z
  .object({
    baseSnapshotId: modelSnapshotIdSchema,
    baseSnapshotSha256: sha256HexSchema,
    candidateSnapshotSha256: sha256HexSchema,
    elementId: modelElementIdSchema,
    expiresAt: z.iso.datetime({ offset: true }),
    findings: z.array(boundedTextSchema).max(1_000),
    modelPreviewId: modelPreviewIdSchema,
    previewId: uuidSchema,
    replacementAssetVersionId: uuidSchema,
    replacementAssetVersionSha256: sha256HexSchema,
    schemaVersion: z.literal(c13SubstitutionPreviewSchemaVersion),
    specificationId: uuidSchema,
    specificationRevision: z.int().positive(),
    visualisationStatus: z.literal("bounded-catalog-preview-only"),
  })
  .strict();
export type SubstitutionPreview = z.infer<typeof substitutionPreviewSchema>;

export const confirmSubstitutionRequestSchema = z
  .object({
    expectedCandidateSnapshotSha256: sha256HexSchema,
    expectedSpecificationRevision: z.int().positive(),
    previewId: uuidSchema,
  })
  .strict();

export const substitutionConfirmationSchema = z
  .object({
    commitId: modelCommitIdSchema,
    confirmationId: uuidSchema,
    elementId: modelElementIdSchema,
    resultSnapshotId: modelSnapshotIdSchema,
    resultSnapshotSha256: sha256HexSchema,
    sceneJobId: uuidSchema,
    schemaVersion: z.literal(c13SubstitutionConfirmationSchemaVersion),
    specificationId: uuidSchema,
    specificationRevision: z.int().positive(),
  })
  .strict();
export type SubstitutionConfirmation = z.infer<typeof substitutionConfirmationSchema>;

export const c13RouteContract = Object.freeze({
  confirmSubstitution:
    "/v1/projects/:projectId/specifications/:specificationId/substitutions/:previewId/confirm",
  createSpecification: "/v1/projects/:projectId/specifications/from-c12-confirmation",
  createSceneJob:
    "/v1/projects/:projectId/specifications/:specificationId/revisions/:revision/scene-jobs",
  createSubstitutionPreview:
    "/v1/projects/:projectId/specifications/:specificationId/substitutions",
  getCatalogAsset: "/v1/projects/:projectId/catalog/releases/:releaseId/assets/:assetVersionId",
  getCatalogArtifact: "/v1/projects/:projectId/catalog/artifacts/:artifactId",
  getCatalogRelease: "/v1/projects/:projectId/catalog/releases/:releaseId",
  getSpecification: "/v1/projects/:projectId/specifications/:specificationId",
  getSpecificationRevisions: "/v1/projects/:projectId/specifications/:specificationId/revisions",
  getSpecificationSchedule:
    "/v1/projects/:projectId/specifications/:specificationId/schedule-lines",
  getSubstitutionPreview:
    "/v1/projects/:projectId/specifications/:specificationId/substitutions/:previewId",
  listCatalogAssets: "/v1/projects/:projectId/catalog/releases/:releaseId/assets",
  listCatalogReleases: "/v1/projects/:projectId/catalog/releases",
  listSpecifications: "/v1/projects/:projectId/specifications",
  updateSelectionBoard: "/v1/projects/:projectId/specifications/:specificationId/selection-board",
});
