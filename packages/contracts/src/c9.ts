import { z } from "zod";

import {
  canonicalHomeSnapshotSchema,
  modelElementIdSchema,
  modelIdSchema,
  modelPoint2Schema,
  modelSnapshotIdSchema,
  provenanceKnownStateSchema,
} from "./c4.js";
import {
  modelBranchIdSchema,
  modelBranchRevisionSchema,
  modelOperationRequestSchema,
} from "./c5.js";

export const c9FusionJobSchemaVersion = "c9-fusion-job-v1" as const;
export const c9RegistrationSchemaVersion = "c9-registration-result-v1" as const;
export const c9ProposalSchemaVersion = "c9-full-house-proposal-v1" as const;
export const c9DiscrepancySchemaVersion = "c9-discrepancy-v1" as const;
export const c9OperationDraftSchemaVersion = "c9-operation-draft-v1" as const;

export const c9FusionPolicy = Object.freeze({
  maximumAnchorsPerSource: 256,
  maximumAttempts: 3,
  maximumDecisionBatch: 50,
  maximumDiscrepancies: 10_000,
  maximumFindings: 10_000,
  maximumOperationDraftSize: 50,
  maximumSources: 32,
  minimumAnchorsForFreeSimilarity: 3,
  minimumDistinctSourceKinds: 2,
  minimumSources: 2,
  workerTimeoutMilliseconds: 3_600_000,
} as const);

const uuidSchema = z.uuid();
const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const safeCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/u);
const safeVersionSchema = z.string().trim().min(1).max(100);
const confidenceBasisPointsSchema = z.int().min(0).max(10_000);

export const fusionJobIdSchema = uuidSchema;
export const fusionProposalIdSchema = uuidSchema;
export const fusionSourceIdSchema = uuidSchema;
export const fusionDiscrepancyIdSchema = uuidSchema;
export const fusionDecisionIdSchema = uuidSchema;

export const fusionRightsSchema = z
  .object({
    serviceProcessingConsent: z.literal(true),
    trainingUseConsent: z.literal("denied"),
  })
  .strict();

export const fusionSourceKindSchema = z.enum([
  "plan-proposal",
  "roomplan-proposal",
  "reconstruction-result",
  "measurement-set",
  "user-assertion-set",
]);
export type FusionSourceKind = z.infer<typeof fusionSourceKindSchema>;

export const fusionCoordinateFrameSchema = z.enum([
  "project-local",
  "source-local-metric",
  "source-local-arbitrary",
]);

export const fusionScaleStatusSchema = z.enum(["metric-validated", "metric-estimated", "unknown"]);

export const fusionSourceSchema = z
  .object({
    coordinateFrame: fusionCoordinateFrameSchema,
    elementCount: z.int().nonnegative().max(100_000),
    evidenceState: provenanceKnownStateSchema,
    id: fusionSourceIdSchema,
    kind: fusionSourceKindSchema,
    referenceId: uuidSchema,
    rights: fusionRightsSchema,
    scaleStatus: fusionScaleStatusSchema,
    schemaVersion: safeVersionSchema,
    sha256: sha256HexSchema,
  })
  .strict()
  .superRefine((source, context) => {
    if (source.coordinateFrame === "project-local" && source.scaleStatus === "unknown") {
      context.addIssue({
        code: "custom",
        message: "Project-local sources cannot have unknown scale.",
        path: ["scaleStatus"],
      });
    }
    if (source.kind === "user-assertion-set" && source.evidenceState !== "user-asserted") {
      context.addIssue({
        code: "custom",
        message: "User assertion sources must remain user-asserted.",
        path: ["evidenceState"],
      });
    }
    if (source.kind !== "user-assertion-set" && source.evidenceState === "user-asserted") {
      context.addIssue({
        code: "custom",
        message: "Only user assertion sources can claim user-asserted authority.",
        path: ["evidenceState"],
      });
    }
  });
export type FusionSource = z.infer<typeof fusionSourceSchema>;

export const fusionPointMmSchema = z
  .object({
    xMm: z.int().min(-10_000_000).max(10_000_000),
    yMm: z.int().min(-10_000_000).max(10_000_000),
    zMm: z.int().min(-10_000_000).max(10_000_000),
  })
  .strict();

export const fusionAnchorSchema = z
  .object({
    anchorId: uuidSchema,
    confidenceBasisPoints: confidenceBasisPointsSchema,
    method: z.enum([
      "shared-control-point",
      "reference-measurement",
      "roomplan-correspondence",
      "user-correspondence",
    ]),
    projectPoint: fusionPointMmSchema,
    sourcePoint: fusionPointMmSchema,
  })
  .strict();

export const fusionAnchorGroupSchema = z
  .object({
    anchors: z
      .array(fusionAnchorSchema)
      .min(c9FusionPolicy.minimumAnchorsForFreeSimilarity)
      .max(c9FusionPolicy.maximumAnchorsPerSource),
    sourceId: fusionSourceIdSchema,
  })
  .strict()
  .superRefine((group, context) => {
    const ids = group.anchors.map(({ anchorId }) => anchorId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", message: "Fusion anchors must be unique." });
    }
  });

export const fusionBaseSnapshotSchema = z
  .object({
    modelId: modelIdSchema,
    profile: z.literal("existing"),
    snapshotId: modelSnapshotIdSchema,
    snapshotSha256: sha256HexSchema,
  })
  .strict();

export const createFusionJobRequestSchema = z
  .object({
    anchorGroups: z.array(fusionAnchorGroupSchema).max(c9FusionPolicy.maximumSources),
    baseSnapshot: fusionBaseSnapshotSchema,
    inferencePolicy: z.literal("label-and-expose"),
    label: z.string().trim().min(1).max(120),
    sources: z
      .array(fusionSourceSchema)
      .min(c9FusionPolicy.minimumSources)
      .max(c9FusionPolicy.maximumSources),
  })
  .strict()
  .superRefine((request, context) => {
    const sourceIds = request.sources.map(({ id }) => id);
    if (new Set(sourceIds).size !== sourceIds.length) {
      context.addIssue({ code: "custom", message: "Fusion source IDs must be unique." });
    }
    const references = request.sources.map(({ kind, referenceId }) => `${kind}:${referenceId}`);
    if (new Set(references).size !== references.length) {
      context.addIssue({
        code: "custom",
        message: "The same immutable source cannot be fused twice.",
      });
    }
    const kinds = new Set(request.sources.map(({ kind }) => kind));
    if (kinds.size < c9FusionPolicy.minimumDistinctSourceKinds) {
      context.addIssue({
        code: "custom",
        message: "Fusion requires at least two distinct source kinds.",
        path: ["sources"],
      });
    }
    if (request.sources.every(({ kind }) => kind === "user-assertion-set")) {
      context.addIssue({
        code: "custom",
        message: "User assertions alone cannot establish a fusion proposal.",
        path: ["sources"],
      });
    }
    const anchorSourceIds = request.anchorGroups.map(({ sourceId }) => sourceId);
    if (new Set(anchorSourceIds).size !== anchorSourceIds.length) {
      context.addIssue({
        code: "custom",
        message: "A source can have only one explicit anchor group.",
        path: ["anchorGroups"],
      });
    }
    const knownSourceIds = new Set(sourceIds);
    request.anchorGroups.forEach((group, index) => {
      if (!knownSourceIds.has(group.sourceId)) {
        context.addIssue({
          code: "custom",
          message: "Anchor groups must reference a declared source.",
          path: ["anchorGroups", index, "sourceId"],
        });
      }
    });
  });
export type CreateFusionJobRequest = z.infer<typeof createFusionJobRequestSchema>;

export const fusionJobStateSchema = z.enum([
  "queued",
  "registering",
  "fitting",
  "comparing",
  "proposed",
  "abstained",
  "cancel-requested",
  "cancelled",
  "failed",
]);
export type FusionJobState = z.infer<typeof fusionJobStateSchema>;

export const fusionJobSchema = z
  .object({
    attempt: z.int().positive().max(c9FusionPolicy.maximumAttempts),
    createdAt: z.iso.datetime({ offset: true }),
    createdBy: uuidSchema,
    id: fusionJobIdSchema,
    projectId: uuidSchema,
    proposalId: fusionProposalIdSchema.optional(),
    request: createFusionJobRequestSchema,
    safeCode: safeCodeSchema.optional(),
    state: fusionJobStateSchema,
    updatedAt: z.iso.datetime({ offset: true }),
    version: z.int().positive(),
  })
  .strict()
  .superRefine((job, context) => {
    const hasProposal = job.proposalId !== undefined;
    if (hasProposal !== (job.state === "proposed")) {
      context.addIssue({
        code: "custom",
        message: "Only proposed fusion jobs reference a proposal.",
        path: ["proposalId"],
      });
    }
    const needsSafeCode = job.state === "abstained" || job.state === "failed";
    if (needsSafeCode !== (job.safeCode !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "Only abstained or failed jobs carry a safe code.",
        path: ["safeCode"],
      });
    }
  });
export type FusionJob = z.infer<typeof fusionJobSchema>;

export const fusionQuaternionE9Schema = z
  .object({
    w: z.int().min(-1_000_000_000).max(1_000_000_000),
    x: z.int().min(-1_000_000_000).max(1_000_000_000),
    y: z.int().min(-1_000_000_000).max(1_000_000_000),
    z: z.int().min(-1_000_000_000).max(1_000_000_000),
  })
  .strict()
  .superRefine((quaternion, context) => {
    const normSquared =
      BigInt(quaternion.w) * BigInt(quaternion.w) +
      BigInt(quaternion.x) * BigInt(quaternion.x) +
      BigInt(quaternion.y) * BigInt(quaternion.y) +
      BigInt(quaternion.z) * BigInt(quaternion.z);
    const expected = 1_000_000_000_000_000_000n;
    const tolerance = 2_000_000_000_000_000n;
    const difference = normSquared > expected ? normSquared - expected : expected - normSquared;
    if (difference > tolerance) {
      context.addIssue({
        code: "custom",
        message: "The fixed-point quaternion must be unit length.",
      });
    }
  });

export const fusionSimilarityTransformSchema = z
  .object({
    rotationQuaternionE9: fusionQuaternionE9Schema,
    scalePartsPerMillion: z.int().positive().max(1_000_000_000),
    translationMm: fusionPointMmSchema,
  })
  .strict();

export const fusionResidualSummarySchema = z
  .object({
    inlierCount: z.int().nonnegative().max(1_000_000),
    maximumMm: z.int().nonnegative().max(10_000_000),
    medianMm: z.int().nonnegative().max(10_000_000),
    p90Mm: z.int().nonnegative().max(10_000_000),
    sampleCount: z.int().nonnegative().max(1_000_000),
  })
  .strict()
  .superRefine((residual, context) => {
    if (residual.inlierCount > residual.sampleCount) {
      context.addIssue({ code: "custom", message: "Inliers cannot exceed residual samples." });
    }
    if (residual.medianMm > residual.p90Mm || residual.p90Mm > residual.maximumMm) {
      context.addIssue({ code: "custom", message: "Residual quantiles must be monotonic." });
    }
  });

const registrationFindingSchema = z
  .object({
    code: safeCodeSchema,
    detail: z.string().trim().min(1).max(500),
    severity: z.enum(["information", "warning", "error"]),
  })
  .strict();

const registeredSourceSchema = z
  .object({
    confidenceBasisPoints: confidenceBasisPointsSchema,
    connectedComponentId: uuidSchema,
    findings: z.array(registrationFindingSchema).max(100),
    method: z.enum(["identity", "control-points", "constraint-graph", "semantic-overlap"]),
    residuals: fusionResidualSummarySchema,
    scaleStatus: fusionScaleStatusSchema,
    schemaVersion: z.literal(c9RegistrationSchemaVersion),
    sourceId: fusionSourceIdSchema,
    status: z.enum(["registered", "partial"]),
    transform: fusionSimilarityTransformSchema,
  })
  .strict();

const unregisteredSourceSchema = z
  .object({
    findings: z.array(registrationFindingSchema).min(1).max(100),
    schemaVersion: z.literal(c9RegistrationSchemaVersion),
    sourceId: fusionSourceIdSchema,
    status: z.literal("unregistered"),
  })
  .strict();

export const fusionRegistrationResultSchema = z.discriminatedUnion("status", [
  registeredSourceSchema,
  unregisteredSourceSchema,
]);
export type FusionRegistrationResult = z.infer<typeof fusionRegistrationResultSchema>;

export const fusionDiscrepancyKindSchema = z.enum([
  "position",
  "dimension",
  "topology",
  "classification",
  "missing-element",
  "extra-element",
  "level-alignment",
  "scale",
  "unknown-region",
]);

export const fusionSourceClaimSchema = z
  .object({
    confidenceBasisPoints: confidenceBasisPointsSchema.optional(),
    elementId: modelElementIdSchema.optional(),
    sourceId: fusionSourceIdSchema,
    state: provenanceKnownStateSchema,
    valueSha256: sha256HexSchema,
  })
  .strict();

export const fusionDiscrepancySchema = z
  .object({
    affectedElementIds: z.array(modelElementIdSchema).max(256),
    code: safeCodeSchema,
    id: fusionDiscrepancyIdSchema,
    kind: fusionDiscrepancyKindSchema,
    location: z
      .object({ levelId: modelElementIdSchema, ...modelPoint2Schema.shape })
      .strict()
      .optional(),
    magnitudeMm: z.int().nonnegative().max(10_000_000).optional(),
    message: z.string().trim().min(1).max(500),
    requiresHumanDecision: z.literal(true),
    schemaVersion: z.literal(c9DiscrepancySchemaVersion),
    severity: z.enum(["information", "warning", "error"]),
    sourceClaims: z.array(fusionSourceClaimSchema).min(1).max(c9FusionPolicy.maximumSources),
    suggestedOperations: z.array(modelOperationRequestSchema).max(10),
  })
  .strict()
  .superRefine((discrepancy, context) => {
    const sourceIds = discrepancy.sourceClaims.map(({ sourceId }) => sourceId);
    if (new Set(sourceIds).size !== sourceIds.length) {
      context.addIssue({ code: "custom", message: "Discrepancy source claims must be unique." });
    }
    if (
      ["position", "dimension", "topology", "classification", "level-alignment", "scale"].includes(
        discrepancy.kind,
      ) &&
      discrepancy.sourceClaims.length < 2
    ) {
      context.addIssue({
        code: "custom",
        message: "Conflicting discrepancy kinds require at least two source claims.",
        path: ["sourceClaims"],
      });
    }
  });
export type FusionDiscrepancy = z.infer<typeof fusionDiscrepancySchema>;

export const fusionCoverageSchema = z
  .object({
    inputSourceCount: z.int().min(c9FusionPolicy.minimumSources).max(c9FusionPolicy.maximumSources),
    levelsCovered: z.int().nonnegative().max(100),
    registeredSourceCount: z.int().nonnegative().max(c9FusionPolicy.maximumSources),
    unknownRegionCount: z.int().nonnegative().max(c9FusionPolicy.maximumDiscrepancies),
  })
  .strict()
  .superRefine((coverage, context) => {
    if (coverage.registeredSourceCount > coverage.inputSourceCount) {
      context.addIssue({ code: "custom", message: "Registered sources cannot exceed inputs." });
    }
  });

const fusionProposalCoreShape = {
  authority: z.literal("proposal-only"),
  baseSnapshot: fusionBaseSnapshotSchema,
  coverage: fusionCoverageSchema,
  createdAt: z.iso.datetime({ offset: true }),
  discrepancies: z.array(fusionDiscrepancySchema).max(c9FusionPolicy.maximumDiscrepancies),
  id: fusionProposalIdSchema,
  projectId: uuidSchema,
  registrations: z
    .array(fusionRegistrationResultSchema)
    .min(c9FusionPolicy.minimumSources)
    .max(c9FusionPolicy.maximumSources),
  schemaVersion: z.literal(c9ProposalSchemaVersion),
  sourceManifestSha256: sha256HexSchema,
  version: z.int().positive(),
};

const proposedFusionSchema = z
  .object({
    ...fusionProposalCoreShape,
    candidateSnapshot: canonicalHomeSnapshotSchema,
    candidateSnapshotSha256: sha256HexSchema,
    status: z.enum(["full-house-proposal", "partial-proposal"]),
  })
  .strict()
  .superRefine((proposal, context) => {
    if (proposal.candidateSnapshot.profile !== "existing") {
      context.addIssue({
        code: "custom",
        message: "A fused existing-condition proposal must retain the existing profile.",
        path: ["candidateSnapshot", "profile"],
      });
    }
    if (
      proposal.candidateSnapshot.projectId !== proposal.projectId ||
      proposal.candidateSnapshot.modelId !== proposal.baseSnapshot.modelId
    ) {
      context.addIssue({
        code: "custom",
        message: "The candidate snapshot must remain inside the exact project and model.",
        path: ["candidateSnapshot"],
      });
    }
    const registeredCount = proposal.registrations.filter(
      ({ status }) => status === "registered" || status === "partial",
    ).length;
    if (registeredCount === 0 || registeredCount !== proposal.coverage.registeredSourceCount) {
      context.addIssue({
        code: "custom",
        message: "Proposal coverage must match its registered source results.",
        path: ["coverage", "registeredSourceCount"],
      });
    }
  });

const abstainedFusionSchema = z
  .object({
    ...fusionProposalCoreShape,
    findings: z.array(registrationFindingSchema).min(1).max(c9FusionPolicy.maximumFindings),
    safeCode: safeCodeSchema,
    status: z.literal("abstained"),
  })
  .strict();

export const fusionProposalSchema = z.discriminatedUnion("status", [
  proposedFusionSchema,
  abstainedFusionSchema,
]);
export type FusionProposal = z.infer<typeof fusionProposalSchema>;

const fusionDecisionChoiceSchema = z.enum([
  "accept-candidate",
  "keep-base",
  "correct",
  "mark-unknown",
  "defer",
]);

export const fusionDiscrepancyDecisionInputSchema = z
  .object({
    choice: fusionDecisionChoiceSchema,
    correctedOperations: z.array(modelOperationRequestSchema).max(10),
    discrepancyId: fusionDiscrepancyIdSchema,
    reason: z.string().trim().min(1).max(500),
  })
  .strict()
  .superRefine((decision, context) => {
    const hasCorrections = decision.correctedOperations.length > 0;
    if ((decision.choice === "correct") !== hasCorrections) {
      context.addIssue({
        code: "custom",
        message: "Only corrected decisions carry one or more exact C5 operations.",
        path: ["correctedOperations"],
      });
    }
  });

export const reviewFusionDiscrepanciesRequestSchema = z
  .object({
    decisions: z
      .array(fusionDiscrepancyDecisionInputSchema)
      .min(1)
      .max(c9FusionPolicy.maximumDecisionBatch),
    expectedProposalVersion: z.int().positive(),
  })
  .strict()
  .superRefine((request, context) => {
    const ids = request.decisions.map(({ discrepancyId }) => discrepancyId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", message: "A discrepancy can be decided once per batch." });
    }
  });

export const fusionDiscrepancyDecisionSchema = z
  .object({
    choice: fusionDecisionChoiceSchema,
    decidedAt: z.iso.datetime({ offset: true }),
    decidedBy: uuidSchema,
    discrepancyId: fusionDiscrepancyIdSchema,
    id: fusionDecisionIdSchema,
    proposalId: fusionProposalIdSchema,
    reason: z.string().trim().min(1).max(500),
    version: z.int().positive(),
  })
  .strict();

export const createFusionOperationDraftRequestSchema = z
  .object({
    branchId: modelBranchIdSchema,
    decisionIds: z
      .array(fusionDecisionIdSchema)
      .min(1)
      .max(c9FusionPolicy.maximumOperationDraftSize),
    expectedBranchRevision: modelBranchRevisionSchema,
    expectedHeadSnapshotSha256: sha256HexSchema,
    expectedProposalVersion: z.int().positive(),
  })
  .strict()
  .superRefine((request, context) => {
    if (new Set(request.decisionIds).size !== request.decisionIds.length) {
      context.addIssue({ code: "custom", message: "Fusion draft decision IDs must be unique." });
    }
  });

export const fusionOperationDraftSchema = z
  .object({
    baseSnapshot: fusionBaseSnapshotSchema,
    branchId: modelBranchIdSchema,
    decisionIds: z
      .array(fusionDecisionIdSchema)
      .min(1)
      .max(c9FusionPolicy.maximumOperationDraftSize),
    expectedBranchRevision: modelBranchRevisionSchema,
    expectedHeadSnapshotSha256: sha256HexSchema,
    operations: z
      .array(modelOperationRequestSchema)
      .min(1)
      .max(c9FusionPolicy.maximumOperationDraftSize),
    projectId: uuidSchema,
    proposalId: fusionProposalIdSchema,
    schemaVersion: z.literal(c9OperationDraftSchemaVersion),
  })
  .strict();
export type FusionOperationDraft = z.infer<typeof fusionOperationDraftSchema>;

export const c9RouteContract = Object.freeze({
  cancelJob: "/v1/projects/:projectId/fusion-jobs/:fusionJobId/cancel",
  createJob: "/v1/projects/:projectId/fusion-jobs",
  createOperationDraft:
    "/v1/projects/:projectId/fusion-jobs/:fusionJobId/proposal/operation-drafts",
  getJob: "/v1/projects/:projectId/fusion-jobs/:fusionJobId",
  getProposal: "/v1/projects/:projectId/fusion-jobs/:fusionJobId/proposal",
  listJobs: "/v1/projects/:projectId/fusion-jobs",
  retryJob: "/v1/projects/:projectId/fusion-jobs/:fusionJobId/retry",
  reviewDiscrepancies:
    "/v1/projects/:projectId/fusion-jobs/:fusionJobId/proposal/discrepancy-decisions",
});
