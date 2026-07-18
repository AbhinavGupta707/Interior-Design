import { z } from "zod";

import { modelSnapshotIdSchema } from "./c4.js";

export const c11DesignBriefSchemaVersion = "c11-design-brief-v1" as const;
export const c11BriefRevisionSchemaVersion = "c11-brief-revision-v1" as const;
export const c11ConsultationSessionSchemaVersion = "c11-consultation-session-v1" as const;
export const c11BriefPatchProposalSchemaVersion = "c11-brief-patch-proposal-v1" as const;
export const c11ReferenceBoardSchemaVersion = "c11-reference-board-v1" as const;

const uuidSchema = z.uuid();
const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const boundedStatementSchema = z.string().trim().min(1).max(500);

export const c11BriefPolicy = Object.freeze({
  consultationProposalTtlSeconds: 1_800,
  maximumBriefEntries: 500,
  maximumClarifications: 20,
  maximumConsultationTurns: 100,
  maximumPatchOperations: 100,
  maximumProfessionalReviewItems: 50,
  maximumReferenceItems: 100,
  maximumUserMessageCharacters: 8_000,
} as const);

export const briefEntryClassificationSchema = z.enum([
  "observed-evidence",
  "household-assertion",
  "hard-constraint",
  "preference",
  "inferred-suggestion",
  "unresolved-conflict",
  "unknown",
]);
export type BriefEntryClassification = z.infer<typeof briefEntryClassificationSchema>;

export const briefEntryCategorySchema = z.enum([
  "household-change",
  "accessibility",
  "work-study",
  "cooking-dining",
  "entertaining",
  "storage",
  "privacy",
  "acoustics",
  "daylight-view",
  "garden-outdoor",
  "retained-item",
  "spatial-need",
  "adjacency",
  "minimum-dimension",
  "style-aesthetic",
  "material-colour",
  "reference",
  "budget-category",
  "disruption-timing",
  "sustainability",
  "decision-criterion",
  "professional-review",
  "other",
]);
export type BriefEntryCategory = z.infer<typeof briefEntryCategorySchema>;

export const briefEntryProvenanceSchema = z
  .object({
    assetId: uuidSchema.optional(),
    capturedAt: z.iso.datetime({ offset: true }),
    method: z.enum([
      "user-stated",
      "evidence-linked",
      "assistant-extracted",
      "assistant-suggested",
      "system-derived",
    ]),
    sourceMessageId: uuidSchema.optional(),
    sourceSnapshotId: modelSnapshotIdSchema.optional(),
    statedByUserId: uuidSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.method === "evidence-linked" && value.assetId === undefined) {
      context.addIssue({
        code: "custom",
        message: "Evidence-linked brief entries require an immutable asset reference.",
        path: ["assetId"],
      });
    }
    if (value.method === "user-stated" && value.statedByUserId === undefined) {
      context.addIssue({
        code: "custom",
        message: "User-stated brief entries require the accountable user.",
        path: ["statedByUserId"],
      });
    }
    if (
      (value.method === "assistant-extracted" || value.method === "assistant-suggested") &&
      value.sourceMessageId === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Assistant-derived brief entries require the exact source message.",
        path: ["sourceMessageId"],
      });
    }
  });
export type BriefEntryProvenance = z.infer<typeof briefEntryProvenanceSchema>;

export const briefEntrySchema = z
  .object({
    category: briefEntryCategorySchema,
    classification: briefEntryClassificationSchema,
    id: uuidSchema,
    priority: z.int().min(1).max(5),
    provenance: briefEntryProvenanceSchema,
    roomOrLevelElementIds: z.array(uuidSchema).max(50),
    statement: boundedStatementSchema,
    status: z.enum(["active", "resolved", "withdrawn"]),
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.classification === "hard-constraint" && entry.status !== "active") {
      context.addIssue({
        code: "custom",
        message: "Inactive requirements cannot be represented as current hard constraints.",
        path: ["status"],
      });
    }
    if (
      entry.classification === "observed-evidence" &&
      entry.provenance.method !== "evidence-linked" &&
      entry.provenance.method !== "system-derived"
    ) {
      context.addIssue({
        code: "custom",
        message: "Observed evidence requires evidence-linked or system-derived provenance.",
        path: ["provenance", "method"],
      });
    }
    if (
      entry.classification === "inferred-suggestion" &&
      entry.provenance.method !== "assistant-suggested" &&
      entry.provenance.method !== "system-derived"
    ) {
      context.addIssue({
        code: "custom",
        message: "Inferred suggestions must remain attributable to an assistant or system.",
        path: ["provenance", "method"],
      });
    }
  });
export type BriefEntry = z.infer<typeof briefEntrySchema>;

export const referenceBoardItemSchema = z
  .object({
    assetId: uuidSchema,
    id: uuidSchema,
    note: z.string().trim().max(500).optional(),
    rightsRecordSha256: sha256HexSchema,
    sentiment: z.enum(["like", "dislike", "context-only"]),
  })
  .strict();
export type ReferenceBoardItem = z.infer<typeof referenceBoardItemSchema>;

export const briefModelReferenceSchema = z
  .object({
    modelId: uuidSchema,
    snapshotId: modelSnapshotIdSchema,
    snapshotSha256: sha256HexSchema,
  })
  .strict();

export const designBriefSchema = z
  .object({
    acceptedAt: z.iso.datetime({ offset: true }).optional(),
    acceptedBy: uuidSchema.optional(),
    createdAt: z.iso.datetime({ offset: true }),
    entries: z.array(briefEntrySchema).max(c11BriefPolicy.maximumBriefEntries),
    id: uuidSchema,
    modelReference: briefModelReferenceSchema.optional(),
    projectId: uuidSchema,
    referenceBoard: z.array(referenceBoardItemSchema).max(c11BriefPolicy.maximumReferenceItems),
    revision: z.int().positive(),
    schemaVersion: z.literal(c11DesignBriefSchemaVersion),
    status: z.enum(["draft", "accepted", "superseded"]),
    updatedAt: z.iso.datetime({ offset: true }),
    updatedBy: uuidSchema,
  })
  .strict()
  .superRefine((brief, context) => {
    const entryIds = new Set(brief.entries.map(({ id }) => id));
    if (entryIds.size !== brief.entries.length) {
      context.addIssue({
        code: "custom",
        message: "Brief entry IDs must be unique.",
        path: ["entries"],
      });
    }
    const referenceIds = new Set(brief.referenceBoard.map(({ id }) => id));
    if (referenceIds.size !== brief.referenceBoard.length) {
      context.addIssue({
        code: "custom",
        message: "Reference-board item IDs must be unique.",
        path: ["referenceBoard"],
      });
    }
    const accepted = brief.status === "accepted";
    if (accepted !== (brief.acceptedAt !== undefined && brief.acceptedBy !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "Only accepted briefs carry an accountable acceptance timestamp and actor.",
        path: ["status"],
      });
    }
  });
export type DesignBrief = z.infer<typeof designBriefSchema>;

export const briefPatchOperationSchema = z.discriminatedUnion("kind", [
  z.object({ entry: briefEntrySchema, kind: z.literal("entry.add") }).strict(),
  z
    .object({
      entry: briefEntrySchema,
      expectedEntryId: uuidSchema,
      kind: z.literal("entry.replace"),
    })
    .strict()
    .refine((value) => value.entry.id === value.expectedEntryId, {
      message: "Replacement entries must retain their stable ID.",
      path: ["entry", "id"],
    }),
  z.object({ entryId: uuidSchema, kind: z.literal("entry.remove") }).strict(),
  z.object({ item: referenceBoardItemSchema, kind: z.literal("reference.add") }).strict(),
  z.object({ itemId: uuidSchema, kind: z.literal("reference.remove") }).strict(),
]);
export type BriefPatchOperation = z.infer<typeof briefPatchOperationSchema>;

export const updateBriefRequestSchema = z
  .object({
    expectedRevision: z.int().nonnegative(),
    idempotencyKey: uuidSchema,
    operations: z
      .array(briefPatchOperationSchema)
      .min(1)
      .max(c11BriefPolicy.maximumPatchOperations),
  })
  .strict();
export type UpdateBriefRequest = z.infer<typeof updateBriefRequestSchema>;

export const acceptBriefRequestSchema = z
  .object({ expectedRevision: z.int().positive(), idempotencyKey: uuidSchema })
  .strict();

export const consultationProviderModeSchema = z.enum(["deterministic-local", "external-disabled"]);
export type ConsultationProviderMode = z.infer<typeof consultationProviderModeSchema>;

export const consultationSessionSchema = z
  .object({
    baseBriefId: uuidSchema,
    baseBriefRevision: z.int().nonnegative(),
    cancelledAt: z.iso.datetime({ offset: true }).optional(),
    createdAt: z.iso.datetime({ offset: true }),
    createdBy: uuidSchema,
    id: uuidSchema,
    projectId: uuidSchema,
    providerMode: consultationProviderModeSchema,
    schemaVersion: z.literal(c11ConsultationSessionSchemaVersion),
    state: z.enum(["active", "cancelled", "completed"]),
    turnCount: z.int().nonnegative().max(c11BriefPolicy.maximumConsultationTurns),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .superRefine((session, context) => {
    if ((session.state === "cancelled") !== (session.cancelledAt !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "Only cancelled sessions carry a cancellation timestamp.",
        path: ["cancelledAt"],
      });
    }
  });
export type ConsultationSession = z.infer<typeof consultationSessionSchema>;

export const createConsultationSessionRequestSchema = z
  .object({
    baseBriefId: uuidSchema,
    baseBriefRevision: z.int().nonnegative(),
    idempotencyKey: uuidSchema,
    providerMode: consultationProviderModeSchema.default("deterministic-local"),
  })
  .strict();

export const submitConsultationTurnRequestSchema = z
  .object({
    clientMessageId: uuidSchema,
    expectedBriefRevision: z.int().nonnegative(),
    message: z.string().trim().min(1).max(c11BriefPolicy.maximumUserMessageCharacters),
  })
  .strict();

export const professionalReviewRouteSchema = z
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

export const briefPatchProposalSchema = z
  .object({
    baseBriefId: uuidSchema,
    baseBriefRevision: z.int().nonnegative(),
    clarifyingQuestions: z.array(boundedStatementSchema).max(c11BriefPolicy.maximumClarifications),
    createdAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
    id: uuidSchema,
    operations: z.array(briefPatchOperationSchema).max(c11BriefPolicy.maximumPatchOperations),
    professionalReview: z
      .array(professionalReviewRouteSchema)
      .max(c11BriefPolicy.maximumProfessionalReviewItems),
    projectId: uuidSchema,
    providerManifest: z
      .object({
        adapter: z.literal("deterministic-local-v1"),
        externalNetworkUsed: z.literal(false),
        promptRegistryVersion: z.string().trim().min(1).max(100),
        toolRegistryVersion: z.string().trim().min(1).max(100),
      })
      .strict(),
    schemaVersion: z.literal(c11BriefPatchProposalSchemaVersion),
    sessionId: uuidSchema,
    sourceMessageId: uuidSchema,
    status: z.enum(["pending", "confirmed", "expired", "rejected"]),
    summary: z.string().trim().min(1).max(1_000),
  })
  .strict()
  .superRefine((proposal, context) => {
    if (Date.parse(proposal.expiresAt) <= Date.parse(proposal.createdAt)) {
      context.addIssue({
        code: "custom",
        message: "Consultation proposals must expire after creation.",
        path: ["expiresAt"],
      });
    }
    if (
      proposal.operations.length === 0 &&
      proposal.clarifyingQuestions.length === 0 &&
      proposal.professionalReview.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "A proposal must contain a patch, clarification or review route.",
      });
    }
  });
export type BriefPatchProposal = z.infer<typeof briefPatchProposalSchema>;

export const confirmBriefPatchProposalRequestSchema = z
  .object({
    expectedBriefRevision: z.int().nonnegative(),
    idempotencyKey: uuidSchema,
  })
  .strict();

export const c11RouteContract = Object.freeze({
  acceptBrief: "/v1/projects/:projectId/design-brief/accept",
  cancelConsultation: "/v1/projects/:projectId/design-consultations/:sessionId/cancel",
  confirmProposal:
    "/v1/projects/:projectId/design-consultations/:sessionId/proposals/:proposalId/confirm",
  createConsultation: "/v1/projects/:projectId/design-consultations",
  getBrief: "/v1/projects/:projectId/design-brief",
  getConsultation: "/v1/projects/:projectId/design-consultations/:sessionId",
  getProposal: "/v1/projects/:projectId/design-consultations/:sessionId/proposals/:proposalId",
  submitTurn: "/v1/projects/:projectId/design-consultations/:sessionId/turns",
  updateBrief: "/v1/projects/:projectId/design-brief",
});
