import { z } from "zod";

import {
  attributedValueSchema,
  knownAttributionSchema,
  modelElementIdSchema,
  modelLevelSchema,
  modelOpeningSchema,
  modelPoint2Schema,
  modelProfileSchema,
  modelSpaceSchema,
  modelSnapshotIdSchema,
  modelWallSchema,
  unknownAttributionSchema,
} from "./c4.js";

export const c5OperationSchemaVersion = "c5-model-operation-v1" as const;
export const c5BranchSchemaVersion = "c5-model-branch-v1" as const;

const projectIdSchema = z.uuid();
const userIdSchema = z.uuid();
const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export const modelBranchIdSchema = z.uuid();
export const modelOperationIdSchema = z.uuid();
export const modelCommitIdSchema = z.uuid();
export const modelPreviewIdSchema = z.uuid();
export const modelBranchRevisionSchema = z.int().nonnegative();
export const modelBranchNameSchema = z.string().trim().min(1).max(80);

const operationCoreShape = {
  clientOperationId: z.uuid(),
  reason: z.string().trim().min(1).max(500),
  schemaVersion: z.literal(c5OperationSchemaVersion),
};

const nonZeroTranslationSchema = z
  .object({
    xMm: z.int().min(-1_000_000).max(1_000_000),
    yMm: z.int().min(-1_000_000).max(1_000_000),
  })
  .strict()
  .refine(
    ({ xMm, yMm }) => xMm !== 0 || yMm !== 0,
    "A wall translation must move on at least one axis.",
  );

const attributedTextSchema = attributedValueSchema(z.string().trim().min(1).max(160));
const metadataTargetSchema = z
  .object({
    collection: z.enum([
      "finishes",
      "fixedObjects",
      "furnishings",
      "levels",
      "lights",
      "openings",
      "spaces",
      "stairs",
      "surfaces",
      "walls",
    ]),
    elementId: modelElementIdSchema,
    field: z.enum(["category", "classification", "material", "name"]),
  })
  .strict();
const provenanceTargetSchema = z
  .object({
    collection: z.enum([
      "finishes",
      "fixedObjects",
      "furnishings",
      "levels",
      "lights",
      "openings",
      "spaces",
      "stairs",
      "surfaces",
      "walls",
    ]),
    elementId: modelElementIdSchema,
    field: z.enum([
      "boundary",
      "category",
      "classification",
      "heightMm",
      "material",
      "name",
      "path",
      "thicknessMm",
      "widthMm",
    ]),
  })
  .strict();

export const createLevelOperationSchema = z
  .object({ ...operationCoreShape, level: modelLevelSchema, type: z.literal("level.create.v1") })
  .strict();
export const createWallOperationSchema = z
  .object({ ...operationCoreShape, type: z.literal("wall.create.v1"), wall: modelWallSchema })
  .strict();
export const translateWallOperationSchema = z
  .object({
    ...operationCoreShape,
    pathAttribution: knownAttributionSchema,
    translation: nonZeroTranslationSchema,
    type: z.literal("wall.translate.v1"),
    wallId: modelElementIdSchema,
  })
  .strict();
export const insertOpeningOperationSchema = z
  .object({
    ...operationCoreShape,
    opening: modelOpeningSchema,
    type: z.literal("opening.insert.v1"),
  })
  .strict();
export const createSpaceOperationSchema = z
  .object({ ...operationCoreShape, space: modelSpaceSchema, type: z.literal("space.create.v1") })
  .strict();
export const renameSpaceOperationSchema = z
  .object({
    ...operationCoreShape,
    name: attributedTextSchema,
    spaceId: modelElementIdSchema,
    type: z.literal("space.rename.v1"),
  })
  .strict();
export const correctElementMetadataOperationSchema = z
  .object({
    ...operationCoreShape,
    target: metadataTargetSchema,
    type: z.literal("element.metadata.correct.v1"),
    value: attributedTextSchema,
  })
  .strict();
export const correctElementProvenanceOperationSchema = z
  .object({
    ...operationCoreShape,
    attribution: z.union([knownAttributionSchema, unknownAttributionSchema]),
    target: provenanceTargetSchema,
    type: z.literal("element.provenance.correct.v1"),
  })
  .strict();

export const modelOperationRequestSchema = z.discriminatedUnion("type", [
  createLevelOperationSchema,
  createWallOperationSchema,
  translateWallOperationSchema,
  insertOpeningOperationSchema,
  createSpaceOperationSchema,
  renameSpaceOperationSchema,
  correctElementMetadataOperationSchema,
  correctElementProvenanceOperationSchema,
]);
export type ModelOperationRequest = z.infer<typeof modelOperationRequestSchema>;

export const modelOperationTypeSchema = z.enum([
  "snapshot.initialize.v1",
  "snapshot.restore.v1",
  "level.create.v1",
  "wall.create.v1",
  "wall.translate.v1",
  "opening.insert.v1",
  "space.create.v1",
  "space.rename.v1",
  "element.metadata.correct.v1",
  "element.provenance.correct.v1",
]);
export type ModelOperationType = z.infer<typeof modelOperationTypeSchema>;

export const geometryFindingSchema = z
  .object({
    affectedElementIds: z.array(modelElementIdSchema).max(256),
    code: z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/u),
    location: z
      .object({ levelId: modelElementIdSchema, ...modelPoint2Schema.shape })
      .strict()
      .optional(),
    message: z.string().trim().min(1).max(500),
    severity: z.enum(["information", "warning", "error"]),
  })
  .strict();

export const createModelBranchRequestSchema = z
  .object({
    name: modelBranchNameSchema,
    sourceSnapshotId: modelSnapshotIdSchema,
    sourceSnapshotSha256: sha256HexSchema,
  })
  .strict();

export const modelBranchSchema = z
  .object({
    createdAt: z.iso.datetime({ offset: true }),
    createdBy: userIdSchema,
    headSnapshotId: modelSnapshotIdSchema,
    headSnapshotSha256: sha256HexSchema,
    id: modelBranchIdSchema,
    modelId: z.uuid(),
    name: modelBranchNameSchema,
    profile: modelProfileSchema,
    projectId: projectIdSchema,
    revision: modelBranchRevisionSchema,
    schemaVersion: z.literal(c5BranchSchemaVersion),
    sourceSnapshotId: modelSnapshotIdSchema,
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type ModelBranch = z.infer<typeof modelBranchSchema>;

export const listModelBranchesResponseSchema = z
  .object({
    branches: z.array(modelBranchSchema).max(100),
    projectId: projectIdSchema,
    profile: modelProfileSchema,
  })
  .strict();

export const previewModelOperationsRequestSchema = z
  .object({
    expectedHeadSnapshotSha256: sha256HexSchema,
    expectedRevision: modelBranchRevisionSchema,
    operations: z.array(modelOperationRequestSchema).min(1).max(50),
  })
  .strict()
  .superRefine((request, context) => {
    const ids = request.operations.map(({ clientOperationId }) => clientOperationId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "Client operation IDs must be unique within a preview.",
        path: ["operations"],
      });
    }
  });

export const modelOperationsPreviewSchema = z
  .object({
    baseHeadSnapshotSha256: sha256HexSchema,
    baseRevision: modelBranchRevisionSchema,
    branchId: modelBranchIdSchema,
    canonicalByteLength: z.int().positive().max(10_485_760),
    expiresAt: z.iso.datetime({ offset: true }),
    findings: z.array(geometryFindingSchema).max(10_000),
    hasBlockingFindings: z.boolean(),
    id: modelPreviewIdSchema,
    operations: z.array(modelOperationRequestSchema).min(1).max(50),
    projectId: projectIdSchema,
    resultSnapshotSha256: sha256HexSchema,
  })
  .strict();
export type ModelOperationsPreview = z.infer<typeof modelOperationsPreviewSchema>;

export const commitModelOperationsRequestSchema = z
  .object({
    commitMessage: z.string().trim().min(1).max(500),
    expectedHeadSnapshotSha256: sha256HexSchema,
    expectedRevision: modelBranchRevisionSchema,
    previewId: modelPreviewIdSchema,
  })
  .strict();

export const modelCommitSchema = z
  .object({
    branchId: modelBranchIdSchema,
    committedAt: z.iso.datetime({ offset: true }),
    committedBy: userIdSchema,
    id: modelCommitIdSchema,
    message: z.string().trim().min(1).max(500),
    operationIds: z.array(modelOperationIdSchema).min(1).max(50),
    parentSnapshotSha256: sha256HexSchema,
    projectId: projectIdSchema,
    revision: z.int().positive(),
    snapshotId: modelSnapshotIdSchema,
    snapshotSha256: sha256HexSchema,
  })
  .strict();
export type ModelCommit = z.infer<typeof modelCommitSchema>;

export const modelOperationRecordSchema = z
  .object({
    branchId: modelBranchIdSchema,
    clientOperationId: z.uuid(),
    commitId: modelCommitIdSchema,
    committedAt: z.iso.datetime({ offset: true }),
    committedBy: userIdSchema,
    id: modelOperationIdSchema,
    ordinal: z.int().nonnegative().max(49),
    projectId: projectIdSchema,
    reason: z.string().trim().min(1).max(500),
    revision: z.int().positive(),
    schemaVersion: z.literal(c5OperationSchemaVersion),
    type: modelOperationTypeSchema,
  })
  .strict();

export const commitModelOperationsResponseSchema = z
  .object({
    branch: modelBranchSchema,
    commit: modelCommitSchema,
    findings: z.array(geometryFindingSchema).max(10_000),
  })
  .strict();

export const restoreModelBranchRequestSchema = z
  .object({
    expectedHeadSnapshotSha256: sha256HexSchema,
    expectedRevision: modelBranchRevisionSchema,
    reason: z.string().trim().min(1).max(500),
    sourceSnapshotId: modelSnapshotIdSchema,
    sourceSnapshotSha256: sha256HexSchema,
  })
  .strict();

const elementDiffSchema = z
  .object({ elementId: modelElementIdSchema, kind: z.enum(["added", "modified", "removed"]) })
  .strict();
export const modelBranchComparisonSchema = z
  .object({
    baseBranchId: modelBranchIdSchema,
    baseHeadSnapshotSha256: sha256HexSchema,
    changes: z.array(elementDiffSchema).max(100_000),
    projectId: projectIdSchema,
    targetBranchId: modelBranchIdSchema,
    targetHeadSnapshotSha256: sha256HexSchema,
    truncated: z.boolean(),
  })
  .strict();

export const modelOperationHistoryResponseSchema = z
  .object({
    nextCursor: z.string().min(1).max(500).optional(),
    operations: z.array(modelOperationRecordSchema).max(100),
  })
  .strict();

export const c5RouteContract = Object.freeze({
  commitOperations: "/v1/projects/:projectId/models/:profile/branches/:branchId/commits",
  compareBranch:
    "/v1/projects/:projectId/models/:profile/branches/:branchId/compare/:targetBranchId",
  createBranch: "/v1/projects/:projectId/models/:profile/branches",
  getBranch: "/v1/projects/:projectId/models/:profile/branches/:branchId",
  listBranches: "/v1/projects/:projectId/models/:profile/branches",
  listOperations: "/v1/projects/:projectId/models/:profile/branches/:branchId/operations",
  previewOperations: "/v1/projects/:projectId/models/:profile/branches/:branchId/previews",
  restoreBranch: "/v1/projects/:projectId/models/:profile/branches/:branchId/restores",
});
