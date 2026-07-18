import {
  briefPatchProposalSchema,
  consultationSessionSchema,
  designBriefSchema,
  projectSchema,
  sessionSchema,
} from "@interior-design/contracts";

export const ids = Object.freeze({
  asset: "c1100000-0000-4000-8000-000000000001",
  brief: "c1100000-0000-4000-8000-000000000002",
  entries: [
    "c1100000-0000-4000-8000-000000000011",
    "c1100000-0000-4000-8000-000000000012",
    "c1100000-0000-4000-8000-000000000013",
    "c1100000-0000-4000-8000-000000000014",
    "c1100000-0000-4000-8000-000000000015",
    "c1100000-0000-4000-8000-000000000016",
    "c1100000-0000-4000-8000-000000000017",
  ],
  message: "c1100000-0000-4000-8000-000000000021",
  project: "c1100000-0000-4000-8000-000000000003",
  proposal: "c1100000-0000-4000-8000-000000000004",
  reference: "c1100000-0000-4000-8000-000000000005",
  session: "c1100000-0000-4000-8000-000000000006",
  tenant: "c1100000-0000-4000-8000-000000000007",
  user: "c1100000-0000-4000-8000-000000000008",
  viewer: "c1100000-0000-4000-8000-000000000009",
});

const capturedAt = "2026-07-18T09:00:00.000Z";

export const project = projectSchema.parse({
  createdAt: capturedAt,
  id: ids.project,
  name: "Synthetic garden flat consultation",
  status: "active",
  tenantId: ids.tenant,
  updatedAt: capturedAt,
  version: 1,
});

export const ownerSession = sessionSchema.parse({
  actor: {
    displayName: "Synthetic C11 homeowner",
    role: "owner",
    subject: "fixture:c11-owner",
    tenantId: ids.tenant,
    userId: ids.user,
  },
  authMode: "local-fixture",
  expiresAt: "2099-07-18T09:00:00.000Z",
});

export const viewerSession = sessionSchema.parse({
  ...ownerSession,
  actor: {
    ...ownerSession.actor,
    displayName: "Synthetic C11 viewer",
    role: "viewer",
    subject: "fixture:c11-viewer",
    userId: ids.viewer,
  },
});

export const brief = designBriefSchema.parse({
  createdAt: capturedAt,
  entries: [
    {
      category: "retained-item",
      classification: "observed-evidence",
      id: ids.entries[0],
      priority: 5,
      provenance: { assetId: ids.asset, capturedAt, method: "evidence-linked" },
      roomOrLevelElementIds: [],
      statement: "The oak dining table appears in the immutable source photograph.",
      status: "active",
    },
    {
      category: "storage",
      classification: "household-assertion",
      id: ids.entries[1],
      priority: 4,
      provenance: { capturedAt, method: "user-stated", statedByUserId: ids.user },
      roomOrLevelElementIds: [],
      statement: "Two adults share the entrance storage.",
      status: "active",
    },
    {
      category: "minimum-dimension",
      classification: "hard-constraint",
      id: ids.entries[2],
      priority: 5,
      provenance: { capturedAt, method: "user-stated", statedByUserId: ids.user },
      roomOrLevelElementIds: [],
      statement: "Keep an unobstructed circulation route beside the retained table.",
      status: "active",
    },
    {
      category: "material-colour",
      classification: "preference",
      id: ids.entries[3],
      priority: 3,
      provenance: { capturedAt, method: "user-stated", statedByUserId: ids.user },
      roomOrLevelElementIds: [],
      statement: "Prefer calm mineral colours and visible timber grain.",
      status: "active",
    },
    {
      category: "other",
      classification: "inferred-suggestion",
      id: ids.entries[4],
      priority: 2,
      provenance: {
        capturedAt,
        method: "assistant-suggested",
        sourceMessageId: ids.message,
      },
      roomOrLevelElementIds: [],
      statement: "Consider layered evening lighting near the dining area.",
      status: "active",
    },
    {
      category: "adjacency",
      classification: "unresolved-conflict",
      id: ids.entries[5],
      priority: 4,
      provenance: {
        capturedAt,
        method: "assistant-extracted",
        sourceMessageId: ids.message,
      },
      roomOrLevelElementIds: [],
      statement: "A wider route may conflict with keeping the table in its current position.",
      status: "active",
    },
    {
      category: "professional-review",
      classification: "unknown",
      id: ids.entries[6],
      priority: 5,
      provenance: {
        capturedAt,
        method: "assistant-extracted",
        sourceMessageId: ids.message,
      },
      roomOrLevelElementIds: [],
      statement: "The structural role of the nib beside the opening is unknown.",
      status: "active",
    },
  ],
  id: ids.brief,
  projectId: ids.project,
  referenceBoard: [
    {
      assetId: ids.asset,
      id: ids.reference,
      note: "Like the quiet palette; not a dimensional reference.",
      rightsRecordSha256: "a".repeat(64),
      sentiment: "like",
    },
  ],
  revision: 3,
  schemaVersion: "c11-design-brief-v1",
  status: "draft",
  updatedAt: capturedAt,
  updatedBy: ids.user,
});

export const consultation = consultationSessionSchema.parse({
  baseBriefId: ids.brief,
  baseBriefRevision: brief.revision,
  createdAt: capturedAt,
  createdBy: ids.user,
  id: ids.session,
  projectId: ids.project,
  providerMode: "deterministic-local",
  schemaVersion: "c11-consultation-session-v1",
  state: "active",
  turnCount: 1,
  updatedAt: capturedAt,
});

export const proposal = briefPatchProposalSchema.parse({
  baseBriefId: ids.brief,
  baseBriefRevision: brief.revision,
  clarifyingQuestions: ["Must the dining table remain in exactly its current position?"],
  createdAt: capturedAt,
  expiresAt: "2099-07-18T09:30:00.000Z",
  id: ids.proposal,
  operations: [
    {
      entry: {
        category: "other",
        classification: "preference",
        id: "c1100000-0000-4000-8000-000000000018",
        priority: 3,
        provenance: {
          capturedAt,
          method: "assistant-extracted",
          sourceMessageId: ids.message,
        },
        roomOrLevelElementIds: [],
        statement: "Prefer warm, dimmable light for evening meals.",
        status: "active",
      },
      kind: "entry.add",
    },
  ],
  professionalReview: [
    {
      question: "Can the nib beside the opening be removed?",
      reason: "structural",
      status: "review-required",
    },
    {
      question: "What will the final construction cost be?",
      reason: "cost-certainty",
      status: "review-required",
    },
  ],
  projectId: ids.project,
  providerManifest: {
    adapter: "deterministic-local-v1",
    externalNetworkUsed: false,
    promptRegistryVersion: "brief-consultation-v1",
    toolRegistryVersion: "brief-tools-v1",
  },
  schemaVersion: "c11-brief-patch-proposal-v1",
  sessionId: ids.session,
  sourceMessageId: ids.message,
  status: "pending",
  summary:
    "One preference can be added; one conflict needs clarification and two questions need review.",
});

export const workspace = Object.freeze({
  brief,
  capability: {
    activeAdapter: "deterministic-local-v1" as const,
    evidenceClassification: "fixture-presentation" as const,
    externalNetworkUsed: false as const,
    externalProviders: "disabled" as const,
  },
  intake: null,
  project,
  session: ownerSession,
});

export const intakeSeed = Object.freeze({
  accessibilityNeeds: ["Step-free circulation to the main living spaces."],
  goals: ["Make the dining space work for calm weekday meals."],
  mustChange: ["Improve uneven evening lighting."],
  mustKeep: ["Keep the existing oak dining table."],
  projectId: ids.project,
  styleWords: ["warm mineral palette"],
  updatedAt: capturedAt,
  updatedBy: ids.viewer,
  version: 2,
});
