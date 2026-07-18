import {
  c12RouteContract,
  createOptionJobRequestSchema,
  designConstraintSchema,
  designOptionSchema,
  interiorAssetRefSchema,
  optionConfirmationSchema,
  optionOperationBundleSchema,
} from "../src/index.js";
import { describe, expect, it } from "vitest";

const ids = {
  asset: "12000000-0000-4000-8000-000000000001",
  brief: "12000000-0000-4000-8000-000000000002",
  branch: "12000000-0000-4000-8000-000000000003",
  bundle: "12000000-0000-4000-8000-000000000004",
  claim: "12000000-0000-4000-8000-000000000005",
  confirmation: "12000000-0000-4000-8000-000000000006",
  commit: "12000000-0000-4000-8000-000000000018",
  constraint: "12000000-0000-4000-8000-000000000007",
  element: "12000000-0000-4000-8000-000000000008",
  job: "12000000-0000-4000-8000-000000000009",
  level: "12000000-0000-4000-8000-000000000010",
  model: "12000000-0000-4000-8000-000000000011",
  operation: "12000000-0000-4000-8000-000000000012",
  option: "12000000-0000-4000-8000-000000000013",
  project: "12000000-0000-4000-8000-000000000014",
  preview: "12000000-0000-4000-8000-000000000019",
  snapshot: "12000000-0000-4000-8000-000000000015",
  space: "12000000-0000-4000-8000-000000000016",
  user: "12000000-0000-4000-8000-000000000017",
  version: "12000000-0000-4000-8000-000000000020",
} as const;
const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const hashC = "c".repeat(64);
const timestamp = "2026-07-18T09:00:00.000Z";

const attribution = {
  actorUserId: ids.user,
  claimId: ids.claim,
  evidenceIds: [],
  method: { kind: "manual", name: "C12 contract fixture", version: "1" },
  state: "user-asserted",
  verification: { status: "not-reviewed" },
} as const;
const known = <T>(value: T) => ({ attribution, knowledge: "known" as const, value });

const asset = {
  category: "three-seat-sofa",
  contentSha256: hashA,
  metadataSha256: hashB,
  geometryEnvelopeMm: { depthMm: 900, heightMm: 820, widthMm: 2100 },
  id: ids.asset,
  kind: "furnishing",
  materialLabel: "creator-owned synthetic warm textile",
  placementPolicy: {
    allowedRotationMilliDegrees: [0, 90000, 180000, 270000],
    clearanceMm: { back: 50, front: 800, left: 100, right: 100 },
    forwardAxis: "positive-y",
    origin: "bounding-box-centre-floor",
    policySha256: hashC,
  },
  representationStatus: "bounded-proxy",
  rights: {
    attributionRequired: false,
    derivativesAllowed: true,
    licenceId: "LicenseRef-InteriorDesign-CreatorOwned-Synthetic",
    redistributionAllowed: false,
    rightsRecordSha256: hashA,
    serviceProcessingAllowed: true,
    sourceKind: "creator-owned-synthetic",
    trainingAllowed: false,
    usage: "service-and-derived-designs",
  },
  schemaVersion: "c12-interior-asset-ref-v1",
  version: "1.0.0",
  versionId: ids.version,
} as const;

const brief = { briefId: ids.brief, contentSha256: hashA, revision: 3 } as const;
const sourceModel = {
  modelId: ids.model,
  profile: "existing",
  snapshotId: ids.snapshot,
  snapshotSha256: hashA,
  snapshotVersion: 1,
} as const;
const workingModel = { ...sourceModel, profile: "proposed" as const, snapshotSha256: hashB };
const constraint = {
  assetElementIds: [ids.element],
  id: ids.constraint,
  kind: "space-containment",
  label: "Keep the sofa inside the selected living space",
  schemaVersion: "c12-design-constraint-v1",
  source: {
    briefEntryIds: [],
    kind: "system-geometry-policy",
    modelElementIds: [ids.space],
  },
  spaceId: ids.space,
  strength: "hard",
} as const;
const operation = {
  assetBinding: {
    assetId: ids.asset,
    assetVersionId: ids.version,
    contentSha256: hashA,
    metadataSha256: hashB,
    placementPolicySha256: hashC,
    rightsRecordSha256: hashA,
  },
  clientOperationId: ids.operation,
  element: {
    category: known("sofa"),
    dimensions: known({ depthMm: 900, heightMm: 820, widthMm: 2100 }),
    elementType: "furnishing",
    id: ids.element,
    levelId: ids.level,
    name: known("Creator-owned synthetic sofa"),
    origin: attribution,
    placement: {
      position: known({ xMm: 1200, yMm: 900, zMm: 0 }),
      rotationMilliDegrees: known(0),
    },
  },
  reason: "Place the synthetic sofa for the circulation-first option.",
  schemaVersion: "c12-design-element-operation-v1",
  type: "design.element.create.v1",
} as const;
const bundle = {
  assetPlacements: [{ asset, elementId: ids.element, spaceId: ids.space }],
  baseModel: workingModel,
  bundleSha256: hashB,
  candidateSnapshotSha256: hashC,
  constraintResults: [
    {
      constraintId: ids.constraint,
      detail: "The complete footprint is contained by the selected room polygon.",
      passed: true,
      strength: "hard",
    },
  ],
  id: ids.bundle,
  operations: [operation],
  projectId: ids.project,
  schemaVersion: "c12-operation-bundle-v1",
} as const;

describe("C12 frozen shared contracts", () => {
  it("requires creator-owned synthetic rights, exact integer envelopes and content identity", () => {
    expect(interiorAssetRefSchema.parse(asset)).toEqual(asset);
    expect(
      interiorAssetRefSchema.safeParse({
        ...asset,
        rights: { ...asset.rights, sourceKind: "unknown" },
      }).success,
    ).toBe(false);
    expect(
      interiorAssetRefSchema.safeParse({
        ...asset,
        geometryEnvelopeMm: { ...asset.geometryEnvelopeMm, widthMm: 2100.5 },
      }).success,
    ).toBe(false);
  });

  it("freezes typed geometry constraints without regulatory or structural certainty", () => {
    expect(designConstraintSchema.parse(constraint)).toEqual(constraint);
    expect(
      designConstraintSchema.safeParse({ ...constraint, kind: "planning-compliant" }).success,
    ).toBe(false);
  });

  it("accepts only proposed-profile design operations whose hard constraints passed", () => {
    expect(optionOperationBundleSchema.parse(bundle)).toEqual(bundle);
    expect(
      optionOperationBundleSchema.safeParse({
        ...bundle,
        constraintResults: [{ ...bundle.constraintResults[0], passed: false }],
      }).success,
    ).toBe(false);
    expect(
      optionOperationBundleSchema.safeParse({
        ...bundle,
        operations: [
          {
            clientOperationId: ids.operation,
            name: known("Unsafe scope"),
            reason: "A C12 bundle must not modify room identity.",
            schemaVersion: "c5-model-operation-v1",
            spaceId: ids.space,
            type: "space.rename.v1",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires accepted brief and exact source model pins when creating an option job", () => {
    expect(
      createOptionJobRequestSchema.parse({
        baseBrief: brief,
        requestedDirections: ["circulation-first", "conversation-first", "storage-first"],
        requestedOptionCount: 3,
        sourceModel,
      }),
    ).toBeDefined();
    expect(
      createOptionJobRequestSchema.safeParse({
        baseBrief: { ...brief, contentSha256: undefined },
        constraints: [constraint],
        requestedOptionCount: 3,
        sourceModel,
      }).success,
    ).toBe(false);
  });

  it("requires non-dominated, expiring, locally generated and inspectable options", () => {
    expect(
      designOptionSchema.parse({
        assumptions: ["Circulation is a design target, not an accessibility certification."],
        baseBrief: brief,
        createdAt: timestamp,
        direction: "circulation-first",
        expiresAt: "2026-07-18T10:00:00.000Z",
        id: ids.option,
        jobId: ids.job,
        objectives: [
          {
            basisPoints: 8800,
            id: "circulation",
            rationale: "The measured minimum clear route is larger than the alternative.",
          },
        ],
        operationBundle: bundle,
        paretoNonDominated: true,
        professionalReview: [],
        projectId: ids.project,
        providerManifest: {
          adapter: "deterministic-local-design-v1",
          candidateBudget: 500,
          engineVersion: "1.0.0",
          externalNetworkUsed: false,
          seed: 12,
        },
        schemaVersion: "c12-design-option-v1",
        status: "pending",
        summary: "A measured circulation-first furniture and material direction.",
        title: "Clear route",
        tradeoffs: ["Uses less conversational seating than the alternative."],
        unknowns: ["Physical upholstery comfort is not measured."],
      }),
    ).toBeDefined();
  });

  it("links explicit confirmation to one isolated C5 branch and exact result hash", () => {
    expect(
      optionConfirmationSchema.parse({
        branchId: ids.branch,
        branchRevision: 1,
        commitId: ids.commit,
        confirmedAt: timestamp,
        confirmedBy: ids.user,
        id: ids.confirmation,
        idempotencyKey: ids.confirmation,
        optionId: ids.option,
        previewId: ids.preview,
        projectId: ids.project,
        resultSnapshotSha256: hashC,
        schemaVersion: "c12-option-confirmation-v1",
      }),
    ).toBeDefined();
  });

  it("freezes the eight exact job, option and confirmation routes", () => {
    expect(Object.keys(c12RouteContract).sort()).toEqual([
      "cancelJob",
      "confirmOption",
      "createJob",
      "getJob",
      "getOption",
      "listJobs",
      "listOptions",
      "retryJob",
    ]);
  });
});
