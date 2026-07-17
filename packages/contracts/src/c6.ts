import { z } from "zod";

import { modelProfileSchema } from "./c4.js";
import {
  modelBranchIdSchema,
  modelBranchRevisionSchema,
  modelOperationRequestSchema,
} from "./c5.js";

export const c6PlanJobSchemaVersion = "c6-plan-job-v1" as const;
export const c6PlanParserInputSchemaVersion = "c6-plan-parser-input-v1" as const;
export const c6PlanProposalSchemaVersion = "c6-plan-proposal-v1" as const;
export const c6PlanOperationDraftSchemaVersion = "c6-plan-operation-draft-v1" as const;

export const c6PlanPolicy = Object.freeze({
  benchmark: Object.freeze({
    maximumCalibrationEce: 0.15,
    maximumCalibrationP90Millimetres: 25,
    maximumCorrectionMedianMinutes: 8,
    maximumCorrectionP90Minutes: 15,
    maximumOpeningCentreP90Millimetres: 75,
    maximumSevereErrorPercent: 0,
    maximumWallEndpointP90Millimetres: 50,
    minimumConfidenceSampleCount: 20,
    minimumHardNegativeAbstentionPercent: 100,
    minimumInBoxAcceptedPercent: 90,
  }),
  maximumAssetBytes: 26_214_400,
  maximumAttempts: 3,
  maximumCandidates: 200,
  maximumOperationDraftSize: 50,
  maximumPageCount: 20,
  maximumParserOutputBytes: 5_242_880,
  maximumRasterPixels: 20_000_000,
  parserTimeoutMilliseconds: 30_000,
  severeWallEndpointErrorMillimetres: 250,
  minimumCandidateConfidence: 60,
  minimumProposalConfidence: 75,
} as const);

const uuidSchema = z.uuid();
const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const sourceIntegerSchema = z.int().min(-1_000_000_000).max(1_000_000_000);
const millimetresSchema = z.int().min(-10_000_000).max(10_000_000);
const positiveMillimetresSchema = z.int().positive().max(1_000_000);
const confidenceSchema = z.int().min(0).max(100);
const safeCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/u);
const safeAdapterIdSchema = z.string().regex(/^[a-z][a-z0-9.-]{2,79}$/u);
const boundedVersionSchema = z.string().trim().min(1).max(100);

export const planProcessingJobIdSchema = uuidSchema;
export const planProposalIdSchema = uuidSchema;
export const planCandidateIdSchema = uuidSchema;
export const planCalibrationIdSchema = uuidSchema;
export const planOperationDraftIdSchema = uuidSchema;

export const c6SupportedPlanMimeTypeSchema = z.enum([
  "application/pdf",
  "image/svg+xml",
  "image/png",
  "image/jpeg",
]);
export type C6SupportedPlanMimeType = z.infer<typeof c6SupportedPlanMimeTypeSchema>;

export const planParserModeSchema = z.enum([
  "deterministic-vector",
  "deterministic-raster",
  "deterministic-fixture",
]);
export type PlanParserMode = z.infer<typeof planParserModeSchema>;

export const planSourceCoordinateSpaceSchema = z.enum([
  "pdf-micropoints",
  "svg-microunits",
  "pixels",
  "fixture-microunits",
]);

export const planSourcePointSchema = z
  .object({ x: sourceIntegerSchema, y: sourceIntegerSchema })
  .strict();
export type PlanSourcePoint = z.infer<typeof planSourcePointSchema>;

export const planSourceRegionSchema = z
  .object({ maximum: planSourcePointSchema, minimum: planSourcePointSchema })
  .strict()
  .superRefine(({ maximum, minimum }, context) => {
    if (maximum.x <= minimum.x || maximum.y <= minimum.y) {
      context.addIssue({ code: "custom", message: "A source region must have positive area." });
    }
  });

export const planSourceManifestSchema = z
  .object({
    assetId: uuidSchema,
    byteSize: z.int().positive().max(c6PlanPolicy.maximumAssetBytes),
    coordinateSpace: planSourceCoordinateSpaceSchema,
    detectedMimeType: c6SupportedPlanMimeTypeSchema,
    heightSourceUnits: z.int().positive().max(1_000_000_000),
    pageIndex: z
      .int()
      .min(0)
      .max(c6PlanPolicy.maximumPageCount - 1),
    projectId: uuidSchema,
    rights: z
      .object({
        basis: z.enum(["owned-by-user", "permission-granted", "public-domain", "licensed"]),
        serviceProcessingConsent: z.literal(true),
        trainingUseConsent: z.literal("denied"),
      })
      .strict(),
    sha256: sha256HexSchema,
    widthSourceUnits: z.int().positive().max(1_000_000_000),
  })
  .strict();
export type PlanSourceManifest = z.infer<typeof planSourceManifestSchema>;

export const planParserManifestSchema = z
  .object({
    adapterId: safeAdapterIdSchema,
    adapterVersion: boundedVersionSchema,
    manifestSha256: sha256HexSchema,
    mode: planParserModeSchema,
    normalizers: z
      .array(z.object({ name: safeAdapterIdSchema, version: boundedVersionSchema }).strict())
      .max(10),
  })
  .strict();

const candidateCoreShape = {
  candidateId: planCandidateIdSchema,
  confidence: confidenceSchema,
  sourceRegion: planSourceRegionSchema,
};

export const planLevelCandidateSchema = z
  .object({
    ...candidateCoreShape,
    elevationMillimetres: millimetresSchema,
    kind: z.literal("level"),
    suggestedName: z.string().trim().min(1).max(160),
  })
  .strict();

export const planWallCandidateSchema = z
  .object({
    ...candidateCoreShape,
    end: planSourcePointSchema,
    heightMillimetres: positiveMillimetresSchema.optional(),
    kind: z.literal("wall"),
    levelCandidateId: planCandidateIdSchema,
    start: planSourcePointSchema,
    thicknessMillimetres: positiveMillimetresSchema.optional(),
  })
  .strict()
  .refine(({ end, start }) => end.x !== start.x || end.y !== start.y, {
    message: "A wall candidate must have a non-zero source segment.",
  });

export const planOpeningCandidateSchema = z
  .object({
    ...candidateCoreShape,
    end: planSourcePointSchema,
    headHeightMillimetres: positiveMillimetresSchema.optional(),
    hostWallCandidateId: planCandidateIdSchema,
    kind: z.literal("opening"),
    levelCandidateId: planCandidateIdSchema,
    openingKind: z.enum(["door", "window", "unknown"]),
    sillHeightMillimetres: z.int().nonnegative().max(1_000_000).optional(),
    start: planSourcePointSchema,
  })
  .strict()
  .refine(({ end, start }) => end.x !== start.x || end.y !== start.y, {
    message: "An opening candidate must have a non-zero source segment.",
  });

export const planSpaceCandidateSchema = z
  .object({
    ...candidateCoreShape,
    boundaryWallCandidateIds: z.array(planCandidateIdSchema).min(3).max(100),
    kind: z.literal("space"),
    levelCandidateId: planCandidateIdSchema,
    suggestedName: z.string().trim().min(1).max(160),
  })
  .strict()
  .superRefine(({ boundaryWallCandidateIds }, context) => {
    if (new Set(boundaryWallCandidateIds).size !== boundaryWallCandidateIds.length) {
      context.addIssue({
        code: "custom",
        message: "A space boundary cannot repeat a wall candidate.",
        path: ["boundaryWallCandidateIds"],
      });
    }
  });

export const planCandidateSchema = z.discriminatedUnion("kind", [
  planLevelCandidateSchema,
  planWallCandidateSchema,
  planOpeningCandidateSchema,
  planSpaceCandidateSchema,
]);
export type PlanCandidate = z.infer<typeof planCandidateSchema>;

export const planProposalFindingSchema = z
  .object({
    affectedCandidateIds: z.array(planCandidateIdSchema).max(200),
    code: safeCodeSchema,
    message: z.string().trim().min(1).max(500),
    severity: z.enum(["information", "warning", "error"]),
    sourceRegion: planSourceRegionSchema.optional(),
  })
  .strict();

export const planUnresolvedRegionSchema = z
  .object({
    code: safeCodeSchema,
    detail: z.string().trim().min(1).max(500),
    id: uuidSchema,
    nextAction: z.enum([
      "correct-manually",
      "add-dimension",
      "replace-source",
      "professional-review",
    ]),
    sourceRegion: planSourceRegionSchema,
  })
  .strict();

export const planAbstentionCodeSchema = z.enum([
  "unsupported-input",
  "source-not-ready",
  "rights-not-permitted",
  "source-mismatch",
  "resource-limit",
  "unsafe-content",
  "no-plan-geometry",
  "ambiguous-topology",
  "low-confidence",
  "invalid-parser-output",
  "parser-timeout",
  "parser-unavailable",
]);
export type PlanAbstentionCode = z.infer<typeof planAbstentionCodeSchema>;

const proposalResultCoreShape = {
  createdAt: z.iso.datetime({ offset: true }),
  jobId: planProcessingJobIdSchema,
  parser: planParserManifestSchema,
  projectId: uuidSchema,
  proposalId: planProposalIdSchema,
  schemaVersion: z.literal(c6PlanProposalSchemaVersion),
  source: planSourceManifestSchema,
};

export const planProposalSchema = z
  .object({
    ...proposalResultCoreShape,
    candidates: z.array(planCandidateSchema).min(1).max(c6PlanPolicy.maximumCandidates),
    findings: z.array(planProposalFindingSchema).max(1_000),
    normalizedInputSha256: sha256HexSchema,
    overallConfidence: confidenceSchema,
    status: z.literal("proposal"),
    unresolvedRegions: z.array(planUnresolvedRegionSchema).max(100),
  })
  .strict()
  .superRefine(({ candidates, overallConfidence }, context) => {
    const ids = candidates.map(({ candidateId }) => candidateId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "Plan candidate IDs must be globally unique.",
        path: ["candidates"],
      });
    }
    if (overallConfidence < c6PlanPolicy.minimumProposalConfidence) {
      context.addIssue({
        code: "custom",
        message: "A published proposal must satisfy the minimum overall confidence.",
        path: ["overallConfidence"],
      });
    }
  });
export type PlanProposal = z.infer<typeof planProposalSchema>;

export const planAbstentionSchema = z
  .object({
    ...proposalResultCoreShape,
    code: planAbstentionCodeSchema,
    detail: z.string().trim().min(1).max(500),
    findings: z.array(planProposalFindingSchema).max(1_000),
    nextActions: z
      .array(
        z.enum([
          "replace-source",
          "select-another-page",
          "add-known-dimension",
          "retry",
          "use-manual-editor",
          "request-professional-input",
        ]),
      )
      .min(1)
      .max(6),
    normalizedInputSha256: sha256HexSchema.optional(),
    retryable: z.boolean(),
    status: z.literal("abstained"),
  })
  .strict();
export type PlanAbstention = z.infer<typeof planAbstentionSchema>;

export const planParserResultSchema = z.discriminatedUnion("status", [
  planProposalSchema,
  planAbstentionSchema,
]);
export type PlanParserResult = z.infer<typeof planParserResultSchema>;

export const planParserRequestSchema = z
  .object({
    jobId: planProcessingJobIdSchema,
    limits: z
      .object({
        maximumCandidates: z.literal(c6PlanPolicy.maximumCandidates),
        maximumOutputBytes: z.literal(c6PlanPolicy.maximumParserOutputBytes),
        timeoutMilliseconds: z.literal(c6PlanPolicy.parserTimeoutMilliseconds),
      })
      .strict(),
    normalizers: z
      .array(z.object({ name: safeAdapterIdSchema, version: boundedVersionSchema }).strict())
      .min(1)
      .max(10),
    normalizedInputSha256: sha256HexSchema,
    parserMode: planParserModeSchema,
    schemaVersion: z.literal(c6PlanParserInputSchemaVersion),
    source: planSourceManifestSchema,
  })
  .strict();
export type PlanParserRequest = z.infer<typeof planParserRequestSchema>;

export const planJobStateSchema = z.enum([
  "queued",
  "processing",
  "proposed",
  "abstained",
  "cancel-requested",
  "cancelled",
  "failed",
]);
export type PlanJobState = z.infer<typeof planJobStateSchema>;

export const planProcessingJobSchema = z
  .object({
    assetId: uuidSchema,
    attempt: z.int().min(1).max(c6PlanPolicy.maximumAttempts),
    createdAt: z.iso.datetime({ offset: true }),
    id: planProcessingJobIdSchema,
    pageIndex: z
      .int()
      .min(0)
      .max(c6PlanPolicy.maximumPageCount - 1),
    parserPreference: z.enum(["auto", "vector", "raster", "fixture"]),
    projectId: uuidSchema,
    resultId: planProposalIdSchema.optional(),
    retryable: z.boolean(),
    safeCode: z.union([planAbstentionCodeSchema, safeCodeSchema]).optional(),
    schemaVersion: z.literal(c6PlanJobSchemaVersion),
    sourceSha256: sha256HexSchema,
    state: planJobStateSchema,
    updatedAt: z.iso.datetime({ offset: true }),
    version: z.int().positive(),
  })
  .strict()
  .superRefine(({ resultId, safeCode, state }, context) => {
    if (["proposed", "abstained"].includes(state) !== (resultId !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "Only proposal or abstention terminal states carry a result ID.",
        path: ["resultId"],
      });
    }
    if (state === "abstained" && safeCode === undefined) {
      context.addIssue({
        code: "custom",
        message: "An abstained job requires a safe code.",
        path: ["safeCode"],
      });
    }
  });
export type PlanProcessingJob = z.infer<typeof planProcessingJobSchema>;

export const createPlanProcessingJobRequestSchema = z
  .object({
    assetId: uuidSchema,
    pageIndex: z
      .int()
      .min(0)
      .max(c6PlanPolicy.maximumPageCount - 1)
      .default(0),
    parserPreference: z.enum(["auto", "vector", "raster", "fixture"]).default("auto"),
  })
  .strict();

export const listPlanProcessingJobsResponseSchema = z
  .object({ jobs: z.array(planProcessingJobSchema).max(100) })
  .strict();

export const transitionPlanProcessingJobRequestSchema = z
  .object({ expectedVersion: z.int().positive() })
  .strict();

export const planRationalAffineTransformSchema = z
  .object({
    a: z.int().min(-1_000_000).max(1_000_000),
    b: z.int().min(-1_000_000).max(1_000_000),
    c: z.int().min(-1_000_000).max(1_000_000),
    d: z.int().min(-1_000_000).max(1_000_000),
    denominator: z.int().positive().max(1_000_000),
    rounding: z.literal("half-away-from-zero"),
    translateXMillimetres: millimetresSchema,
    translateYMillimetres: millimetresSchema,
  })
  .strict()
  .refine(({ a, b, c, d }) => a * d - b * c !== 0, {
    message: "A source-to-model transform must be invertible.",
  });

export const planCalibrationEvidenceSchema = z
  .object({
    knownLengthMillimetres: positiveMillimetresSchema,
    method: z.enum(["known-length", "declared-scale", "scale-bar"]),
    sourceEnd: planSourcePointSchema,
    sourceStart: planSourcePointSchema,
  })
  .strict()
  .refine(
    ({ sourceEnd, sourceStart }) => sourceEnd.x !== sourceStart.x || sourceEnd.y !== sourceStart.y,
    { message: "Calibration evidence must select a non-zero source segment." },
  );

export const createPlanCalibrationRequestSchema = z
  .object({
    evidence: planCalibrationEvidenceSchema,
    sourceToModel: planRationalAffineTransformSchema,
  })
  .strict();

export const planCalibrationSchema = z
  .object({
    createdAt: z.iso.datetime({ offset: true }),
    createdBy: uuidSchema,
    evidence: planCalibrationEvidenceSchema,
    id: planCalibrationIdSchema,
    jobId: planProcessingJobIdSchema,
    projectId: uuidSchema,
    proposalId: planProposalIdSchema,
    residualMillimetres: z.int().nonnegative().max(1_000_000),
    sourceToModel: planRationalAffineTransformSchema,
  })
  .strict();
export type PlanCalibration = z.infer<typeof planCalibrationSchema>;

export const planCandidateDecisionSchema = z
  .object({
    candidateId: planCandidateIdSchema,
    decision: z.enum(["accepted", "corrected", "excluded", "unresolved"]),
    resultingClientOperationIds: z.array(uuidSchema).max(c6PlanPolicy.maximumOperationDraftSize),
  })
  .strict()
  .superRefine(({ decision, resultingClientOperationIds }, context) => {
    const createsGeometry = decision === "accepted" || decision === "corrected";
    if (createsGeometry !== resultingClientOperationIds.length > 0) {
      context.addIssue({
        code: "custom",
        message: "Accepted/corrected candidates, and only those candidates, require operations.",
        path: ["resultingClientOperationIds"],
      });
    }
  });

export const planOperationDraftTargetSchema = z
  .object({
    branchId: modelBranchIdSchema,
    expectedHeadSnapshotSha256: sha256HexSchema,
    expectedRevision: modelBranchRevisionSchema,
    profile: modelProfileSchema,
  })
  .strict();

export const createPlanOperationDraftRequestSchema = z
  .object({
    acknowledgedFindingCodes: z.array(safeCodeSchema).max(100),
    calibrationId: planCalibrationIdSchema,
    decisions: z.array(planCandidateDecisionSchema).min(1).max(c6PlanPolicy.maximumCandidates),
    operations: z
      .array(modelOperationRequestSchema)
      .min(1)
      .max(c6PlanPolicy.maximumOperationDraftSize),
    reviewDurationMilliseconds: z.int().nonnegative().max(86_400_000),
    target: planOperationDraftTargetSchema,
  })
  .strict()
  .superRefine(({ decisions, operations }, context) => {
    const candidateIds = decisions.map(({ candidateId }) => candidateId);
    if (new Set(candidateIds).size !== candidateIds.length) {
      context.addIssue({
        code: "custom",
        message: "A candidate can appear in a draft decision only once.",
        path: ["decisions"],
      });
    }
    const operationIds = operations.map(({ clientOperationId }) => clientOperationId);
    if (new Set(operationIds).size !== operationIds.length) {
      context.addIssue({
        code: "custom",
        message: "Draft client operation IDs must be unique.",
        path: ["operations"],
      });
    }
  });

export const planOperationDraftSchema = z
  .object({
    acknowledgedFindingCodes: z.array(safeCodeSchema).max(100),
    calibrationId: planCalibrationIdSchema,
    createdAt: z.iso.datetime({ offset: true }),
    createdBy: uuidSchema,
    decisions: z.array(planCandidateDecisionSchema).min(1).max(c6PlanPolicy.maximumCandidates),
    id: planOperationDraftIdSchema,
    jobId: planProcessingJobIdSchema,
    metrics: z
      .object({
        acceptedCount: z.int().nonnegative().max(c6PlanPolicy.maximumCandidates),
        correctedCount: z.int().nonnegative().max(c6PlanPolicy.maximumCandidates),
        excludedCount: z.int().nonnegative().max(c6PlanPolicy.maximumCandidates),
        reviewDurationMilliseconds: z.int().nonnegative().max(86_400_000),
        unresolvedCount: z.int().nonnegative().max(c6PlanPolicy.maximumCandidates),
      })
      .strict(),
    operations: z
      .array(modelOperationRequestSchema)
      .min(1)
      .max(c6PlanPolicy.maximumOperationDraftSize),
    projectId: uuidSchema,
    proposalId: planProposalIdSchema,
    schemaVersion: z.literal(c6PlanOperationDraftSchemaVersion),
    target: planOperationDraftTargetSchema,
  })
  .strict();
export type PlanOperationDraft = z.infer<typeof planOperationDraftSchema>;

export const c6RouteContract = Object.freeze({
  calibrateProposal: "/v1/projects/:projectId/plan-processing-jobs/:jobId/proposal/calibrations",
  cancelJob: "/v1/projects/:projectId/plan-processing-jobs/:jobId/cancel",
  createJob: "/v1/projects/:projectId/plan-processing-jobs",
  createOperationDraft:
    "/v1/projects/:projectId/plan-processing-jobs/:jobId/proposal/operation-drafts",
  getJob: "/v1/projects/:projectId/plan-processing-jobs/:jobId",
  getProposal: "/v1/projects/:projectId/plan-processing-jobs/:jobId/proposal",
  listJobs: "/v1/projects/:projectId/plan-processing-jobs",
  retryJob: "/v1/projects/:projectId/plan-processing-jobs/:jobId/retry",
});
