import {
  designOptionSchema,
  designOptionSetSchema,
  listDesignOptionsResponseSchema,
  optionConfirmationSchema,
  optionJobSchema,
  projectSchema,
  sessionSchema,
} from "@interior-design/contracts";

function uuid(value: number): string {
  return `c1200000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function hash(digit: string): string {
  return digit.repeat(64);
}

export const ids = Object.freeze({
  assetA: uuid(31),
  assetB: uuid(32),
  assetVersionA: uuid(33),
  assetVersionB: uuid(34),
  brief: uuid(4),
  branchA: uuid(61),
  claim: uuid(71),
  commitA: uuid(62),
  confirmationA: uuid(63),
  constraint: uuid(15),
  elementA: uuid(21),
  elementB: uuid(22),
  evidence: uuid(72),
  job: uuid(8),
  level: uuid(12),
  model: uuid(5),
  operationA: uuid(41),
  operationB: uuid(42),
  optionA: uuid(9),
  optionB: uuid(10),
  previewA: uuid(64),
  project: uuid(3),
  snapshot: uuid(6),
  space: uuid(13),
  tenant: uuid(1),
  user: uuid(2),
  viewer: uuid(14),
  workingModel: uuid(18),
  workingSnapshot: uuid(19),
});

export const project = projectSchema.parse({
  createdAt: "2026-07-18T09:00:00.000Z",
  id: ids.project,
  name: "Synthetic option study",
  status: "active",
  tenantId: ids.tenant,
  updatedAt: "2026-07-18T10:00:00.000Z",
  version: 3,
});

export const ownerSession = sessionSchema.parse({
  actor: {
    displayName: "Synthetic Owner",
    role: "owner",
    subject: "fixture:synthetic-owner",
    tenantId: ids.tenant,
    userId: ids.user,
  },
  authMode: "local-fixture",
  expiresAt: "2027-07-18T10:00:00.000Z",
});

export const viewerSession = sessionSchema.parse({
  actor: {
    displayName: "Synthetic Viewer",
    role: "viewer",
    subject: "fixture:synthetic-viewer",
    tenantId: ids.tenant,
    userId: ids.viewer,
  },
  authMode: "local-fixture",
  expiresAt: "2027-07-18T10:00:00.000Z",
});

const baseBrief = {
  briefId: ids.brief,
  contentSha256: hash("a"),
  revision: 3,
} as const;

const sourceModel = {
  modelId: ids.model,
  profile: "existing",
  snapshotId: ids.snapshot,
  snapshotSha256: hash("b"),
  snapshotVersion: 7,
} as const;

const workingModel = {
  modelId: ids.workingModel,
  profile: "proposed",
  snapshotId: ids.workingSnapshot,
  snapshotSha256: hash("c"),
  snapshotVersion: 1,
} as const;

const attribution = {
  claimId: ids.claim,
  evidenceIds: [ids.evidence],
  method: { kind: "fixture", name: "C12 synthetic fixture", version: "1.0.0" },
  state: "source-derived",
  verification: { status: "not-reviewed" },
} as const;

function known<T>(value: T) {
  return { attribution, knowledge: "known" as const, value };
}

function asset(input: {
  readonly assetId: string;
  readonly category: string;
  readonly digit: string;
  readonly material: string;
  readonly versionId: string;
}) {
  return {
    category: input.category,
    contentSha256: hash(input.digit),
    geometryEnvelopeMm: { depthMm: 900, heightMm: 760, widthMm: 1_900 },
    id: input.assetId,
    kind: "furnishing" as const,
    materialLabel: input.material,
    metadataSha256: hash(input.digit === "d" ? "e" : "f"),
    placementPolicy: {
      allowedRotationMilliDegrees: [0, 90_000, 180_000, 270_000],
      clearanceMm: { back: 100, front: 700, left: 150, right: 150 },
      forwardAxis: "positive-y" as const,
      origin: "bounding-box-centre-floor" as const,
      policySha256: hash(input.digit === "d" ? "1" : "2"),
    },
    representationStatus: "bounded-proxy" as const,
    rights: {
      attributionRequired: false as const,
      derivativesAllowed: true as const,
      licenceId: "LicenseRef-InteriorDesign-CreatorOwned-Synthetic" as const,
      redistributionAllowed: false as const,
      rightsRecordSha256: hash(input.digit === "d" ? "3" : "4"),
      serviceProcessingAllowed: true as const,
      sourceKind: "creator-owned-synthetic" as const,
      trainingAllowed: false as const,
      usage: "service-and-derived-designs" as const,
    },
    schemaVersion: "c12-interior-asset-ref-v1" as const,
    version: "1.0.0",
    versionId: input.versionId,
  };
}

function option(input: {
  readonly assetId: string;
  readonly assetVersionId: string;
  readonly digit: string;
  readonly direction: "circulation-first" | "conversation-first";
  readonly elementId: string;
  readonly material: string;
  readonly operationId: string;
  readonly optionId: string;
  readonly positionX: number;
  readonly rotation: number;
  readonly title: string;
}) {
  const assetRef = asset({
    assetId: input.assetId,
    category: input.direction === "circulation-first" ? "compact-sofa" : "conversation-bench",
    digit: input.digit,
    material: input.material,
    versionId: input.assetVersionId,
  });
  const element = {
    category: known("seating"),
    dimensions: known({ depthMm: 900, heightMm: 760, widthMm: 1_900 }),
    elementType: "furnishing" as const,
    id: input.elementId,
    levelId: ids.level,
    name: known(input.title),
    origin: attribution,
    placement: {
      position: known({ xMm: input.positionX, yMm: 1_800, zMm: 0 }),
      rotationMilliDegrees: known(input.rotation),
    },
  };
  const assetBinding = {
    assetId: assetRef.id,
    assetVersionId: assetRef.versionId,
    contentSha256: assetRef.contentSha256,
    metadataSha256: assetRef.metadataSha256,
    placementPolicySha256: assetRef.placementPolicy.policySha256,
    rightsRecordSha256: assetRef.rights.rightsRecordSha256,
  };
  return designOptionSchema.parse({
    assumptions: ["The supplied clearance target applies to the synthetic seating zone."],
    baseBrief,
    createdAt: "2026-07-18T10:02:00.000Z",
    direction: input.direction,
    expiresAt: "2027-07-18T11:02:00.000Z",
    id: input.optionId,
    jobId: ids.job,
    objectives: [
      {
        basisPoints: input.direction === "circulation-first" ? 8_800 : 7_200,
        id: "circulation",
        rationale: "Exact supplied clearance is scored without claiming accessibility approval.",
      },
      {
        basisPoints: input.direction === "conversation-first" ? 9_100 : 6_900,
        id: "conversation",
        rationale: "Seating orientation is compared as a bounded conversation proxy.",
      },
    ],
    operationBundle: {
      assetPlacements: [{ asset: assetRef, elementId: input.elementId, spaceId: ids.space }],
      baseModel: workingModel,
      bundleSha256: hash(input.digit === "d" ? "5" : "6"),
      candidateSnapshotSha256: hash(input.digit === "d" ? "7" : "8"),
      constraintResults: [
        {
          constraintId: ids.constraint,
          detail: "Synthetic seating footprint retains at least 700 mm supplied front clearance.",
          measuredValue: input.direction === "circulation-first" ? 920 : 760,
          passed: true,
          strength: "hard",
          thresholdValue: 700,
        },
      ],
      id: uuid(input.digit === "d" ? 51 : 52),
      operations: [
        {
          assetBinding,
          clientOperationId: input.operationId,
          element,
          reason: "Synthetic deterministic option operation.",
          schemaVersion: "c12-design-element-operation-v1",
          type: "design.element.create.v1",
        },
      ],
      projectId: ids.project,
      schemaVersion: "c12-operation-bundle-v1",
    },
    paretoNonDominated: true,
    professionalReview: [
      {
        question: "Confirm the circulation target with the relevant accessibility reviewer.",
        reason: "accessibility-clinical",
        status: "review-required",
      },
      {
        question: "Confirm real product availability after C13 catalogue selection.",
        reason: "product-availability",
        status: "review-required",
      },
    ],
    projectId: ids.project,
    providerManifest: {
      adapter: "deterministic-local-design-v1",
      candidateBudget: 1_024,
      engineVersion: "c12-fixture-engine-1.0.0",
      externalNetworkUsed: false,
      seed: input.direction === "circulation-first" ? 101 : 202,
    },
    schemaVersion: "c12-design-option-v1",
    status: "pending",
    summary:
      input.direction === "circulation-first"
        ? "Keeps the central route open with compact synthetic seating."
        : "Rotates seating toward a bounded conversation grouping.",
    title: input.title,
    tradeoffs: [
      input.direction === "circulation-first"
        ? "More open circulation with less face-to-face seating."
        : "Stronger conversation grouping with a narrower supplied route.",
    ],
    unknowns: ["Structural, cost, live-product, and professional judgements remain unresolved."],
  });
}

export const optionA = option({
  assetId: ids.assetA,
  assetVersionId: ids.assetVersionA,
  digit: "d",
  direction: "circulation-first",
  elementId: ids.elementA,
  material: "undyed linen",
  operationId: ids.operationA,
  optionId: ids.optionA,
  positionX: 1_200,
  rotation: 0,
  title: "Open route",
});

export const optionB = option({
  assetId: ids.assetB,
  assetVersionId: ids.assetVersionB,
  digit: "e",
  direction: "conversation-first",
  elementId: ids.elementB,
  material: "wool and walnut",
  operationId: ids.operationB,
  optionId: ids.optionB,
  positionX: 3_100,
  rotation: 90_000,
  title: "Conversation angle",
});

export const job = optionJobSchema.parse({
  assetManifestSha256: hash("9"),
  attempt: 1,
  baseBrief,
  completedAt: "2026-07-18T10:03:00.000Z",
  constraints: [
    {
      assetElementIds: [ids.elementA, ids.elementB],
      clearanceMm: 700,
      id: ids.constraint,
      kind: "minimum-clearance",
      label: "Retain the supplied front circulation target",
      schemaVersion: "c12-design-constraint-v1",
      scope: "front-access",
      source: {
        briefEntryIds: [uuid(73)],
        kind: "accepted-brief",
        modelElementIds: [],
      },
      strength: "hard",
    },
  ],
  constraintsSha256: hash("0"),
  createdAt: "2026-07-18T10:01:00.000Z",
  createdBy: ids.user,
  id: ids.job,
  optionCount: 2,
  projectId: ids.project,
  requestedDirections: ["circulation-first", "conversation-first"],
  requestedOptionCount: 2,
  retryable: false,
  schemaVersion: "c12-option-job-v1",
  sourceModel,
  stage: "complete",
  state: "succeeded",
  updatedAt: "2026-07-18T10:03:00.000Z",
  version: 4,
  workingModel,
});

export const optionSet = designOptionSetSchema.parse({
  createdAt: "2026-07-18T10:03:00.000Z",
  jobId: ids.job,
  optionIds: [ids.optionA, ids.optionB],
  pairwiseDiversity: [
    {
      assetInventoryDistanceBasisPoints: 10_000,
      assignmentDistanceBasisPoints: 10_000,
      leftOptionId: ids.optionA,
      materialDistanceBasisPoints: 10_000,
      operationSignatureDistanceBasisPoints: 8_500,
      placementDistanceMm: 1_900,
      rightOptionId: ids.optionB,
      spatiallyOrMateriallyDistinct: true,
    },
  ],
  projectId: ids.project,
  schemaVersion: "c12-design-option-set-v1",
  setSha256: hash("f"),
});

export const optionsResponse = listDesignOptionsResponseSchema.parse({
  jobId: ids.job,
  optionSet,
  options: [optionA, optionB],
  projectId: ids.project,
});

export const confirmationA = optionConfirmationSchema.parse({
  branchId: ids.branchA,
  branchRevision: 1,
  commitId: ids.commitA,
  confirmedAt: "2026-07-18T10:04:00.000Z",
  confirmedBy: ids.user,
  id: ids.confirmationA,
  idempotencyKey: uuid(65),
  optionId: ids.optionA,
  previewId: ids.previewA,
  projectId: ids.project,
  resultSnapshotSha256: optionA.operationBundle.candidateSnapshotSha256,
  schemaVersion: "c12-option-confirmation-v1",
});

export const narrativeOnlyDuplicate = designOptionSchema.parse({
  ...optionA,
  id: uuid(81),
  operationBundle: {
    ...optionA.operationBundle,
    bundleSha256: hash("2"),
    candidateSnapshotSha256: hash("3"),
    id: uuid(82),
    operations: optionA.operationBundle.operations.map((operation) => ({
      ...operation,
      clientOperationId: uuid(83),
      reason: "Different prose and UUID only.",
    })),
  },
  summary: "A rewritten narrative with identical assets, assignment, placement, and material.",
  title: "Narrative duplicate",
});

export const launchContext = {
  baseBrief,
  requestedDirections: ["circulation-first", "conversation-first"],
  requestedOptionCount: 2,
  sourceModel,
} as const;
