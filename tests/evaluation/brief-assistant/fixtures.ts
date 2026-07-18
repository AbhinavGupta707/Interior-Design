import {
  briefPatchProposalSchema,
  designBriefSchema,
} from "../../../packages/contracts/src/index.js";

const projectId = "e1100000-0000-4000-8000-000000000001";
const userId = "e1100000-0000-4000-8000-000000000002";
const messageId = "e1100000-0000-4000-8000-000000000003";
const capturedAt = "2026-07-18T12:00:00.000Z";

const classifications = [
  "observed-evidence",
  "household-assertion",
  "hard-constraint",
  "preference",
  "inferred-suggestion",
  "unresolved-conflict",
  "unknown",
] as const;

export const evaluationBrief = designBriefSchema.parse({
  createdAt: capturedAt,
  entries: classifications.map((classification, index) => ({
    category: classification === "unknown" ? "professional-review" : "decision-criterion",
    classification,
    id: `e1100000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
    priority: (index % 5) + 1,
    provenance:
      classification === "observed-evidence"
        ? {
            assetId: "e1100000-0000-4000-8000-000000000004",
            capturedAt,
            method: "evidence-linked",
          }
        : classification === "inferred-suggestion"
          ? { capturedAt, method: "assistant-suggested", sourceMessageId: messageId }
          : classification === "unresolved-conflict" || classification === "unknown"
            ? { capturedAt, method: "assistant-extracted", sourceMessageId: messageId }
            : { capturedAt, method: "user-stated", statedByUserId: userId },
    roomOrLevelElementIds: [],
    statement:
      classification === "unknown"
        ? "The wall construction is unknown and requires evidence."
        : `Synthetic ${classification.replaceAll("-", " ")} statement.`,
    status: "active",
  })),
  id: "e1100000-0000-4000-8000-000000000005",
  projectId,
  referenceBoard: [
    {
      assetId: "e1100000-0000-4000-8000-000000000004",
      id: "e1100000-0000-4000-8000-000000000006",
      note: "Aesthetic context only; not dimensional evidence.",
      rightsRecordSha256: "d".repeat(64),
      sentiment: "context-only",
    },
  ],
  revision: 2,
  schemaVersion: "c11-design-brief-v1",
  status: "draft",
  updatedAt: capturedAt,
  updatedBy: userId,
});

export const evaluationProposal = briefPatchProposalSchema.parse({
  baseBriefId: evaluationBrief.id,
  baseBriefRevision: evaluationBrief.revision,
  clarifyingQuestions: ["Which outcome matters most if the two preferences conflict?"],
  createdAt: capturedAt,
  expiresAt: "2099-07-18T12:30:00.000Z",
  id: "e1100000-0000-4000-8000-000000000007",
  operations: [
    {
      entry: {
        category: "style-aesthetic",
        classification: "preference",
        id: "e1100000-0000-4000-8000-000000000008",
        priority: 3,
        provenance: { capturedAt, method: "assistant-extracted", sourceMessageId: messageId },
        roomOrLevelElementIds: [],
        statement: "Prefer a restrained, tactile palette.",
        status: "active",
      },
      kind: "entry.add",
    },
  ],
  professionalReview: [
    {
      question: "Is this wall safe to remove?",
      reason: "structural",
      status: "review-required",
    },
    {
      question: "Is the named item available to buy today?",
      reason: "product-availability",
      status: "review-required",
    },
  ],
  projectId,
  providerManifest: {
    adapter: "deterministic-local-v1",
    externalNetworkUsed: false,
    promptRegistryVersion: "evaluation-prompt-v1",
    toolRegistryVersion: "evaluation-tools-v1",
  },
  schemaVersion: "c11-brief-patch-proposal-v1",
  sessionId: "e1100000-0000-4000-8000-000000000009",
  sourceMessageId: messageId,
  status: "pending",
  summary: "A bounded synthetic proposal for independent status-comprehension evaluation.",
});
