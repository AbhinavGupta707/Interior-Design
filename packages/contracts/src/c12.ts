import { z } from "zod";

import {
  modelElementIdSchema,
  modelIdSchema,
  modelPoint2Schema,
  modelSnapshotIdSchema,
} from "./c4.js";
import {
  modelBranchIdSchema,
  modelBranchRevisionSchema,
  modelCommitIdSchema,
  modelOperationRequestSchema,
  modelPreviewIdSchema,
} from "./c5.js";

export const c12DesignConstraintSchemaVersion = "c12-design-constraint-v1" as const;
export const c12InteriorAssetRefSchemaVersion = "c12-interior-asset-ref-v1" as const;
export const c12OptionJobSchemaVersion = "c12-option-job-v1" as const;
export const c12DesignOptionSchemaVersion = "c12-design-option-v1" as const;
export const c12DesignOptionSetSchemaVersion = "c12-design-option-set-v1" as const;
export const c12OperationBundleSchemaVersion = "c12-operation-bundle-v1" as const;
export const c12OptionConfirmationSchemaVersion = "c12-option-confirmation-v1" as const;

const uuidSchema = z.uuid();
const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const boundedLabelSchema = z.string().trim().min(1).max(160);
const boundedStatementSchema = z.string().trim().min(1).max(500);

export const c12OptionPolicy = Object.freeze({
  maximumAssetsPerOption: 50,
  maximumAssumptionsPerOption: 50,
  maximumConstraints: 200,
  maximumFindingsPerOption: 1_000,
  maximumObjectives: 20,
  maximumOperationsPerOption: 50,
  maximumOptionsPerJob: 8,
  maximumProfessionalReviewItems: 50,
  maximumTradeoffsPerOption: 50,
  optionProposalTtlSeconds: 3_600,
} as const);

export const acceptedBriefReferenceSchema = z
  .object({
    briefId: uuidSchema,
    contentSha256: sha256HexSchema,
    revision: z.int().positive(),
  })
  .strict();
export type AcceptedBriefReference = z.infer<typeof acceptedBriefReferenceSchema>;

export const optionSourceModelReferenceSchema = z
  .object({
    modelId: modelIdSchema,
    profile: z.enum(["existing", "proposed"]),
    snapshotId: modelSnapshotIdSchema,
    snapshotSha256: sha256HexSchema,
    snapshotVersion: z.int().positive(),
  })
  .strict();
export type OptionSourceModelReference = z.infer<typeof optionSourceModelReferenceSchema>;

export const optionWorkingModelReferenceSchema = optionSourceModelReferenceSchema
  .extend({ profile: z.literal("proposed") })
  .strict();
export type OptionWorkingModelReference = z.infer<typeof optionWorkingModelReferenceSchema>;

const assetEnvelopeSchema = z
  .object({
    depthMm: z.int().positive().max(100_000),
    heightMm: z.int().positive().max(100_000),
    widthMm: z.int().positive().max(100_000),
  })
  .strict();

export const interiorAssetRefSchema = z
  .object({
    category: boundedLabelSchema,
    contentSha256: sha256HexSchema,
    metadataSha256: sha256HexSchema,
    geometryEnvelopeMm: assetEnvelopeSchema,
    id: uuidSchema,
    kind: z.enum(["furnishing", "finish", "light"]),
    materialLabel: boundedLabelSchema,
    placementPolicy: z
      .object({
        allowedRotationMilliDegrees: z.array(z.int().min(0).max(359_999)).min(1).max(36),
        clearanceMm: z
          .object({
            back: z.int().nonnegative().max(10_000),
            front: z.int().nonnegative().max(10_000),
            left: z.int().nonnegative().max(10_000),
            right: z.int().nonnegative().max(10_000),
          })
          .strict(),
        forwardAxis: z.literal("positive-y"),
        origin: z.literal("bounding-box-centre-floor"),
        policySha256: sha256HexSchema,
      })
      .strict(),
    representationStatus: z.literal("bounded-proxy"),
    rights: z
      .object({
        attributionRequired: z.literal(false),
        derivativesAllowed: z.literal(true),
        licenceId: z.literal("LicenseRef-InteriorDesign-CreatorOwned-Synthetic"),
        redistributionAllowed: z.literal(false),
        rightsRecordSha256: sha256HexSchema,
        serviceProcessingAllowed: z.literal(true),
        sourceKind: z.literal("creator-owned-synthetic"),
        trainingAllowed: z.literal(false),
        usage: z.literal("service-and-derived-designs"),
      })
      .strict(),
    schemaVersion: z.literal(c12InteriorAssetRefSchemaVersion),
    version: z.string().trim().min(1).max(80),
    versionId: uuidSchema,
  })
  .strict()
  .superRefine((asset, context) => {
    const rotations = asset.placementPolicy.allowedRotationMilliDegrees;
    if (new Set(rotations).size !== rotations.length) {
      context.addIssue({
        code: "custom",
        message: "Allowed asset rotations must be unique.",
        path: ["placementPolicy", "allowedRotationMilliDegrees"],
      });
    }
  });
export type InteriorAssetRef = z.infer<typeof interiorAssetRefSchema>;

const constraintCoreShape = {
  id: uuidSchema,
  label: boundedLabelSchema,
  schemaVersion: z.literal(c12DesignConstraintSchemaVersion),
  source: z
    .object({
      briefEntryIds: z.array(uuidSchema).max(50),
      modelElementIds: z.array(modelElementIdSchema).max(50),
      kind: z.enum(["accepted-brief", "canonical-model", "system-geometry-policy"]),
    })
    .strict(),
  strength: z.enum(["hard", "objective"]),
};

export const designConstraintSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...constraintCoreShape,
      assetElementIds: z.array(modelElementIdSchema).min(1).max(50),
      kind: z.literal("space-containment"),
      spaceId: modelElementIdSchema,
    })
    .strict(),
  z
    .object({
      ...constraintCoreShape,
      assetElementIds: z.array(modelElementIdSchema).min(1).max(50),
      clearanceMm: z.int().nonnegative().max(10_000),
      kind: z.literal("minimum-clearance"),
      scope: z.enum(["all-sides", "front-access", "circulation-target"]),
    })
    .strict(),
  z
    .object({
      ...constraintCoreShape,
      assetElementIds: z.array(modelElementIdSchema).min(2).max(50),
      kind: z.literal("no-overlap"),
    })
    .strict(),
  z
    .object({
      ...constraintCoreShape,
      expectedElementSha256: sha256HexSchema,
      kind: z.literal("retain-element"),
      retainedElementId: modelElementIdSchema,
    })
    .strict(),
  z
    .object({
      ...constraintCoreShape,
      kind: z.literal("keep-out-polygon"),
      levelId: modelElementIdSchema,
      polygon: z.array(modelPoint2Schema).min(3).max(128),
      sourceElementIds: z.array(modelElementIdSchema).max(50),
    })
    .strict(),
  z
    .object({
      ...constraintCoreShape,
      assetElementId: modelElementIdSchema,
      kind: z.literal("adjacency-objective"),
      maximumDistanceMm: z.int().positive().max(100_000),
      targetElementId: modelElementIdSchema,
    })
    .strict(),
]);
export type DesignConstraint = z.infer<typeof designConstraintSchema>;

export const constraintResultSchema = z
  .object({
    constraintId: uuidSchema,
    detail: boundedStatementSchema,
    measuredValue: z.int().min(-1_000_000_000).max(1_000_000_000).optional(),
    passed: z.boolean(),
    strength: z.enum(["hard", "objective"]),
    thresholdValue: z.int().min(-1_000_000_000).max(1_000_000_000).optional(),
  })
  .strict();

export const optionObjectiveSchema = z
  .object({
    basisPoints: z.int().min(0).max(10_000),
    id: z.enum([
      "brief-fit",
      "circulation",
      "conversation",
      "daylight",
      "edit-distance",
      "material-coherence",
      "retention",
      "storage",
    ]),
    rationale: boundedStatementSchema,
  })
  .strict();

export const optionAssetPlacementSchema = z
  .object({
    asset: interiorAssetRefSchema,
    elementId: modelElementIdSchema,
    spaceId: modelElementIdSchema.optional(),
  })
  .strict();

export const optionOperationBundleSchema = z
  .object({
    assetPlacements: z
      .array(optionAssetPlacementSchema)
      .max(c12OptionPolicy.maximumAssetsPerOption),
    baseModel: optionWorkingModelReferenceSchema,
    bundleSha256: sha256HexSchema,
    candidateSnapshotSha256: sha256HexSchema,
    constraintResults: z.array(constraintResultSchema).max(c12OptionPolicy.maximumConstraints),
    id: uuidSchema,
    operations: z
      .array(modelOperationRequestSchema)
      .min(1)
      .max(c12OptionPolicy.maximumOperationsPerOption),
    projectId: uuidSchema,
    schemaVersion: z.literal(c12OperationBundleSchemaVersion),
  })
  .strict()
  .superRefine((bundle, context) => {
    if (
      bundle.operations.some(
        ({ type }) =>
          type !== "design.element.create.v1" &&
          type !== "design.element.replace.v1" &&
          type !== "design.element.remove.v1",
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "C12 option bundles may contain only proposed-profile design-element operations.",
        path: ["operations"],
      });
    }
    if (bundle.constraintResults.some(({ passed, strength }) => strength === "hard" && !passed)) {
      context.addIssue({
        code: "custom",
        message: "Persisted option bundles must pass every frozen hard constraint.",
        path: ["constraintResults"],
      });
    }
    const operationIds = bundle.operations.map(({ clientOperationId }) => clientOperationId);
    if (new Set(operationIds).size !== operationIds.length) {
      context.addIssue({
        code: "custom",
        message: "Option-bundle operation IDs must be unique.",
        path: ["operations"],
      });
    }
    const placementIds = bundle.assetPlacements.map(({ elementId }) => elementId);
    if (new Set(placementIds).size !== placementIds.length) {
      context.addIssue({
        code: "custom",
        message: "An option may link at most one asset reference to each design element.",
        path: ["assetPlacements"],
      });
    }
    bundle.assetPlacements.forEach(({ asset, elementId }, index) => {
      const operation = bundle.operations.find(
        (candidate) =>
          (candidate.type === "design.element.create.v1" ||
            candidate.type === "design.element.replace.v1") &&
          candidate.element.id === elementId,
      );
      const binding =
        operation?.type === "design.element.create.v1" ||
        operation?.type === "design.element.replace.v1"
          ? operation.assetBinding
          : undefined;
      if (
        binding === undefined ||
        binding.assetId !== asset.id ||
        binding.assetVersionId !== asset.versionId ||
        binding.contentSha256 !== asset.contentSha256 ||
        binding.metadataSha256 !== asset.metadataSha256 ||
        binding.placementPolicySha256 !== asset.placementPolicy.policySha256 ||
        binding.rightsRecordSha256 !== asset.rights.rightsRecordSha256
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Every option asset placement must match the retained design-operation asset binding.",
          path: ["assetPlacements", index],
        });
      }
    });
  });
export type OptionOperationBundle = z.infer<typeof optionOperationBundleSchema>;

export const optionProfessionalReviewSchema = z
  .object({
    question: boundedStatementSchema,
    reason: z.enum([
      "structural",
      "regulatory",
      "accessibility-clinical",
      "cost-certainty",
      "product-availability",
      "professional-judgement",
      "insufficient-evidence",
    ]),
    status: z.literal("review-required"),
  })
  .strict();

export const optionDirectionSchema = z.enum([
  "circulation-first",
  "conversation-first",
  "daylight-first",
  "retention-first",
  "storage-first",
]);
const requestedOptionDirectionsSchema = z
  .array(optionDirectionSchema)
  .min(2)
  .max(5)
  .refine((directions) => new Set(directions).size === directions.length, {
    message: "Requested design directions must be unique.",
  });

export const designOptionSchema = z
  .object({
    assumptions: z.array(boundedStatementSchema).max(c12OptionPolicy.maximumAssumptionsPerOption),
    baseBrief: acceptedBriefReferenceSchema,
    createdAt: z.iso.datetime({ offset: true }),
    direction: optionDirectionSchema,
    expiresAt: z.iso.datetime({ offset: true }),
    id: uuidSchema,
    jobId: uuidSchema,
    objectives: z.array(optionObjectiveSchema).min(1).max(c12OptionPolicy.maximumObjectives),
    operationBundle: optionOperationBundleSchema,
    paretoNonDominated: z.literal(true),
    professionalReview: z
      .array(optionProfessionalReviewSchema)
      .max(c12OptionPolicy.maximumProfessionalReviewItems),
    projectId: uuidSchema,
    providerManifest: z
      .object({
        adapter: z.literal("deterministic-local-design-v1"),
        candidateBudget: z.int().positive().max(100_000),
        engineVersion: z.string().trim().min(1).max(80),
        externalNetworkUsed: z.literal(false),
        seed: z.int().nonnegative().max(2_147_483_647),
      })
      .strict(),
    schemaVersion: z.literal(c12DesignOptionSchemaVersion),
    status: z.enum(["pending", "confirmed", "expired", "rejected"]),
    summary: z.string().trim().min(1).max(1_000),
    title: boundedLabelSchema,
    tradeoffs: z.array(boundedStatementSchema).max(c12OptionPolicy.maximumTradeoffsPerOption),
    unknowns: z.array(boundedStatementSchema).max(c12OptionPolicy.maximumAssumptionsPerOption),
  })
  .strict()
  .superRefine((option, context) => {
    if (option.projectId !== option.operationBundle.projectId) {
      context.addIssue({
        code: "custom",
        message: "The design option and its operation bundle must share one project.",
        path: ["operationBundle", "projectId"],
      });
    }
    if (Date.parse(option.expiresAt) <= Date.parse(option.createdAt)) {
      context.addIssue({
        code: "custom",
        message: "A pending design option must expire after creation.",
        path: ["expiresAt"],
      });
    }
    const objectiveIds = option.objectives.map(({ id }) => id);
    if (new Set(objectiveIds).size !== objectiveIds.length) {
      context.addIssue({
        code: "custom",
        message: "Each option objective may appear only once.",
        path: ["objectives"],
      });
    }
  });
export type DesignOption = z.infer<typeof designOptionSchema>;

export const optionPairwiseDiversitySchema = z
  .object({
    assetInventoryDistanceBasisPoints: z.int().min(0).max(10_000),
    assignmentDistanceBasisPoints: z.int().min(0).max(10_000),
    leftOptionId: uuidSchema,
    materialDistanceBasisPoints: z.int().min(0).max(10_000),
    operationSignatureDistanceBasisPoints: z.int().min(0).max(10_000),
    placementDistanceMm: z.int().nonnegative().max(10_000_000),
    rightOptionId: uuidSchema,
    spatiallyOrMateriallyDistinct: z.literal(true),
  })
  .strict()
  .refine(({ leftOptionId, rightOptionId }) => leftOptionId !== rightOptionId, {
    message: "Pairwise diversity must compare two different options.",
    path: ["rightOptionId"],
  });

export const designOptionSetSchema = z
  .object({
    createdAt: z.iso.datetime({ offset: true }),
    jobId: uuidSchema,
    optionIds: z.array(uuidSchema).min(2).max(c12OptionPolicy.maximumOptionsPerJob),
    pairwiseDiversity: z.array(optionPairwiseDiversitySchema).min(1).max(28),
    projectId: uuidSchema,
    schemaVersion: z.literal(c12DesignOptionSetSchemaVersion),
    setSha256: sha256HexSchema,
  })
  .strict()
  .superRefine((set, context) => {
    const ids = new Set(set.optionIds);
    if (ids.size !== set.optionIds.length) {
      context.addIssue({
        code: "custom",
        message: "An option set cannot repeat an option ID.",
        path: ["optionIds"],
      });
    }
    const expectedPairs = (set.optionIds.length * (set.optionIds.length - 1)) / 2;
    const pairKeys = new Set(
      set.pairwiseDiversity.map(({ leftOptionId, rightOptionId }) =>
        [leftOptionId, rightOptionId].sort().join(":"),
      ),
    );
    if (
      set.pairwiseDiversity.length !== expectedPairs ||
      pairKeys.size !== expectedPairs ||
      set.pairwiseDiversity.some(
        ({ leftOptionId, rightOptionId }) => !ids.has(leftOptionId) || !ids.has(rightOptionId),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "An option set must contain one complete pairwise diversity matrix.",
        path: ["pairwiseDiversity"],
      });
    }
  });
export type DesignOptionSet = z.infer<typeof designOptionSetSchema>;

export const optionJobStateSchema = z.enum([
  "queued",
  "running",
  "cancel-requested",
  "succeeded",
  "failed",
  "cancelled",
  "abstained",
]);

export const optionJobSchema = z
  .object({
    assetManifestSha256: sha256HexSchema,
    baseBrief: acceptedBriefReferenceSchema,
    cancelledAt: z.iso.datetime({ offset: true }).optional(),
    completedAt: z.iso.datetime({ offset: true }).optional(),
    constraints: z.array(designConstraintSchema).min(1).max(c12OptionPolicy.maximumConstraints),
    constraintsSha256: sha256HexSchema,
    createdAt: z.iso.datetime({ offset: true }),
    createdBy: uuidSchema,
    id: uuidSchema,
    attempt: z.int().positive().max(100),
    optionCount: z.int().nonnegative().max(c12OptionPolicy.maximumOptionsPerJob),
    projectId: uuidSchema,
    requestedOptionCount: z.int().min(2).max(c12OptionPolicy.maximumOptionsPerJob),
    requestedDirections: requestedOptionDirectionsSchema,
    retryable: z.boolean(),
    safeCode: z
      .enum([
        "BRIEF_NOT_ACCEPTED",
        "CONSTRAINTS_INFEASIBLE",
        "MODEL_NOT_PROPOSED",
        "SOURCE_CHANGED",
        "RESOURCE_LIMIT",
        "INTERNAL_FAILURE",
        "NO_FEASIBLE_DIVERSE_SET",
      ])
      .optional(),
    schemaVersion: z.literal(c12OptionJobSchemaVersion),
    sourceModel: optionSourceModelReferenceSchema,
    stage: z.enum([
      "queued",
      "deriving-constraints",
      "generating",
      "validating",
      "publishing",
      "complete",
    ]),
    state: optionJobStateSchema,
    updatedAt: z.iso.datetime({ offset: true }),
    version: z.int().positive(),
    workingModel: optionWorkingModelReferenceSchema,
  })
  .strict()
  .superRefine((job, context) => {
    if ((job.state === "cancelled") !== (job.cancelledAt !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "Only cancelled jobs carry a cancellation timestamp.",
        path: ["cancelledAt"],
      });
    }
    if (
      (job.state === "succeeded" || job.state === "abstained") !==
      (job.completedAt !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Only succeeded jobs carry a completion timestamp.",
        path: ["completedAt"],
      });
    }
    if ((job.state === "failed" || job.state === "abstained") !== (job.safeCode !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "Only failed jobs carry a bounded safe failure code.",
        path: ["safeCode"],
      });
    }
    if (job.state === "succeeded" && job.optionCount < 2) {
      context.addIssue({
        code: "custom",
        message: "A successful C12 job must publish at least two distinct valid options.",
        path: ["optionCount"],
      });
    }
    if (job.state === "succeeded" && job.optionCount !== job.requestedOptionCount) {
      context.addIssue({
        code: "custom",
        message: "A successful C12 job must publish the exact requested option count.",
        path: ["optionCount"],
      });
    }
    if (job.state === "abstained" && job.optionCount !== 0) {
      context.addIssue({
        code: "custom",
        message: "An abstained C12 job cannot publish a partial option set.",
        path: ["optionCount"],
      });
    }
    if (job.state === "abstained" && job.safeCode !== "NO_FEASIBLE_DIVERSE_SET") {
      context.addIssue({
        code: "custom",
        message: "An abstained C12 job must identify the bounded no-feasible-set reason.",
        path: ["safeCode"],
      });
    }
    if (job.retryable && !["failed", "cancelled", "abstained"].includes(job.state)) {
      context.addIssue({
        code: "custom",
        message: "Only a terminal unsuccessful C12 job may be retryable.",
        path: ["retryable"],
      });
    }
    const terminal = ["succeeded", "failed", "cancelled", "abstained"].includes(job.state);
    if ((job.stage === "complete") !== terminal) {
      context.addIssue({
        code: "custom",
        message: "Only terminal C12 jobs use the complete stage.",
        path: ["stage"],
      });
    }
    if (job.state === "queued" && job.stage !== "queued") {
      context.addIssue({
        code: "custom",
        message: "Queued C12 jobs must remain at the queued stage.",
        path: ["stage"],
      });
    }
  });
export type OptionJob = z.infer<typeof optionJobSchema>;

export const createOptionJobRequestSchema = z
  .object({
    baseBrief: acceptedBriefReferenceSchema,
    requestedDirections: requestedOptionDirectionsSchema,
    requestedOptionCount: z.int().min(2).max(c12OptionPolicy.maximumOptionsPerJob),
    sourceModel: optionSourceModelReferenceSchema,
  })
  .strict();

export const optionConfirmationSchema = z
  .object({
    branchId: modelBranchIdSchema,
    branchRevision: modelBranchRevisionSchema.positive(),
    commitId: modelCommitIdSchema,
    confirmedAt: z.iso.datetime({ offset: true }),
    confirmedBy: uuidSchema,
    id: uuidSchema,
    idempotencyKey: uuidSchema,
    optionId: uuidSchema,
    previewId: modelPreviewIdSchema,
    projectId: uuidSchema,
    resultSnapshotSha256: sha256HexSchema,
    schemaVersion: z.literal(c12OptionConfirmationSchemaVersion),
  })
  .strict();
export type OptionConfirmation = z.infer<typeof optionConfirmationSchema>;

export const confirmOptionRequestSchema = z
  .object({
    expectedBriefContentSha256: sha256HexSchema,
    expectedBriefRevision: z.int().positive(),
    expectedJobVersion: z.int().positive(),
    expectedOptionStatus: z.literal("pending"),
    expectedOptionSetSha256: sha256HexSchema,
    expectedSourceSnapshotSha256: sha256HexSchema,
    idempotencyKey: uuidSchema,
  })
  .strict();

export const listDesignOptionsResponseSchema = z
  .object({
    jobId: uuidSchema,
    optionSet: designOptionSetSchema.optional(),
    options: z.array(designOptionSchema).max(c12OptionPolicy.maximumOptionsPerJob),
    projectId: uuidSchema,
  })
  .strict();

export const listOptionJobsResponseSchema = z
  .object({
    jobs: z.array(optionJobSchema).max(100),
    projectId: uuidSchema,
  })
  .strict();

export const c12RouteContract = Object.freeze({
  cancelJob: "/v1/projects/:projectId/design-option-jobs/:jobId/cancel",
  confirmOption: "/v1/projects/:projectId/design-option-jobs/:jobId/options/:optionId/confirm",
  createJob: "/v1/projects/:projectId/design-option-jobs",
  getJob: "/v1/projects/:projectId/design-option-jobs/:jobId",
  getOption: "/v1/projects/:projectId/design-option-jobs/:jobId/options/:optionId",
  listJobs: "/v1/projects/:projectId/design-option-jobs",
  listOptions: "/v1/projects/:projectId/design-option-jobs/:jobId/options",
  retryJob: "/v1/projects/:projectId/design-option-jobs/:jobId/retry",
});
