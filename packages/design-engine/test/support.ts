import type {
  CanonicalHomeSnapshot,
  DesignBrief,
  InteriorAssetRef,
  KnownAttribution,
  ModelOperationRequest,
} from "@interior-design/contracts";
import { validateAndCanonicalizeSnapshot } from "@interior-design/model-operations";

import { compareStrings, sha256Canonical } from "../src/canonical.js";
import type {
  BriefConstraintFact,
  DesignCandidateTemplate,
  DeterministicDesignConstraintRequest,
  DeterministicDesignEngineRequest,
  FinishTargetDeclaration,
  KeepOutDeclaration,
} from "../src/types.js";

export function id(ordinal: number): string {
  return `12000000-0000-4000-8000-${ordinal.toString(16).padStart(12, "0")}`;
}

export const ids = Object.freeze({
  actor: id(1),
  asset: id(2),
  assetVersion: id(3),
  brief: id(4),
  claim: id(5),
  elementA: id(6),
  elementB: id(7),
  fixed: id(8),
  level: id(9),
  model: id(10),
  project: id(11),
  snapshot: id(12),
  space: id(13),
  surface: id(14),
  templateA: id(15),
  templateB: id(16),
  templateC: id(17),
});

export const attribution: KnownAttribution = {
  actorUserId: ids.actor,
  claimId: ids.claim,
  evidenceIds: [],
  method: { kind: "fixture", name: "C12 synthetic fixture", version: "1" },
  state: "user-asserted",
  verification: { status: "not-reviewed" },
};

export function known<TValue>(value: TValue) {
  return { attribution, knowledge: "known" as const, value };
}

export function makeAsset(overrides: Partial<InteriorAssetRef> = {}): InteriorAssetRef {
  return {
    category: "synthetic-seat",
    contentSha256: "a".repeat(64),
    geometryEnvelopeMm: { depthMm: 500, heightMm: 800, widthMm: 1_000 },
    id: ids.asset,
    kind: "furnishing",
    materialLabel: "Synthetic textile",
    metadataSha256: "b".repeat(64),
    placementPolicy: {
      allowedRotationMilliDegrees: [0, 45_000, 90_000, 180_000, 270_000],
      clearanceMm: { back: 0, front: 0, left: 0, right: 0 },
      forwardAxis: "positive-y",
      origin: "bounding-box-centre-floor",
      policySha256: "c".repeat(64),
    },
    representationStatus: "bounded-proxy",
    rights: {
      attributionRequired: false,
      derivativesAllowed: true,
      licenceId: "LicenseRef-InteriorDesign-CreatorOwned-Synthetic",
      redistributionAllowed: false,
      rightsRecordSha256: "d".repeat(64),
      serviceProcessingAllowed: true,
      sourceKind: "creator-owned-synthetic",
      trainingAllowed: false,
      usage: "service-and-derived-designs",
    },
    schemaVersion: "c12-interior-asset-ref-v1",
    version: "1.0.0",
    versionId: ids.assetVersion,
    ...overrides,
  };
}

export function makeExistingSnapshot(
  boundary: readonly { readonly xMm: number; readonly yMm: number }[] = [
    { xMm: 0, yMm: 0 },
    { xMm: 5_000, yMm: 0 },
    { xMm: 5_000, yMm: 4_000 },
    { xMm: 0, yMm: 4_000 },
  ],
): CanonicalHomeSnapshot {
  return {
    coordinateSystem: {
      axes: { x: "east", y: "north", z: "up" },
      globalAnchor: { status: "not-established" },
      handedness: "right",
      kind: "local-cartesian",
      lengthUnit: "mm",
      originConvention: "project-local-model-origin",
    },
    elements: {
      cameras: [],
      finishes: [],
      fixedObjects: [],
      furnishings: [],
      levels: [
        {
          elementType: "level",
          elevationMm: known(0),
          id: ids.level,
          name: known("Synthetic level"),
          origin: attribution,
          storeyHeightMm: known(3_000),
        },
      ],
      lights: [],
      openings: [],
      spaces: [
        {
          boundary: known(boundary.map((point) => ({ ...point }))),
          boundedByElementIds: [],
          classification: known("Synthetic room"),
          elementType: "space",
          id: ids.space,
          levelId: ids.level,
          name: known("Synthetic room"),
          origin: attribution,
        },
      ],
      stairs: [],
      surfaces: [],
      walls: [],
    },
    knownLimitations: [
      { code: "SYNTHETIC_FIXTURE", detail: "Creator-owned synthetic geometry for tests only." },
    ],
    modelId: ids.model,
    profile: "existing",
    projectId: ids.project,
    schemaVersion: "c4-canonical-home-v1",
  };
}

export function proposedClone(source: CanonicalHomeSnapshot): CanonicalHomeSnapshot {
  const sourceSha256 = validateAndCanonicalizeSnapshot(source).snapshotSha256;
  return {
    ...structuredClone(source),
    derivedFromSnapshotSha256: sourceSha256,
    profile: "proposed",
  };
}

export function furnishingOperation(input: {
  readonly asset?: InteriorAssetRef;
  readonly elementId: string;
  readonly operationId: string;
  readonly reason?: string;
  readonly rotationMilliDegrees?: number;
  readonly xMm: number;
  readonly yMm: number;
  readonly zMm?: number;
}): Extract<ModelOperationRequest, { readonly type: "design.element.create.v1" }> {
  const asset = input.asset ?? makeAsset();
  return {
    assetBinding: {
      assetId: asset.id,
      assetVersionId: asset.versionId,
      contentSha256: asset.contentSha256,
      metadataSha256: asset.metadataSha256,
      placementPolicySha256: asset.placementPolicy.policySha256,
      rightsRecordSha256: asset.rights.rightsRecordSha256,
    },
    clientOperationId: input.operationId,
    element: {
      category: known(asset.category),
      dimensions: known(asset.geometryEnvelopeMm),
      elementType: "furnishing",
      id: input.elementId,
      levelId: ids.level,
      name: known("Creator-owned synthetic furnishing"),
      origin: attribution,
      placement: {
        position: known({ xMm: input.xMm, yMm: input.yMm, zMm: input.zMm ?? 0 }),
        rotationMilliDegrees: known(input.rotationMilliDegrees ?? 0),
      },
    },
    reason: input.reason ?? "Place a creator-owned synthetic furnishing in the proposed profile.",
    schemaVersion: "c12-design-element-operation-v1",
    type: "design.element.create.v1",
  };
}

export function template(input: {
  readonly assignmentKey?: string;
  readonly direction: DesignCandidateTemplate["direction"];
  readonly elementId: string;
  readonly objectives: readonly [circulation: number, conversation: number];
  readonly operation: Extract<ModelOperationRequest, { readonly type: "design.element.create.v1" }>;
  readonly templateId: string;
}): DesignCandidateTemplate {
  return {
    assetPlacements: [
      {
        assignmentKey: input.assignmentKey ?? "primary-seat",
        assetVersionId: input.operation.assetBinding.assetVersionId,
        elementId: input.elementId,
        spaceId: ids.space,
      },
    ],
    direction: input.direction,
    objectives: [
      {
        basisPoints: input.objectives[0],
        id: "circulation",
        rationale: "Deterministic synthetic circulation objective.",
      },
      {
        basisPoints: input.objectives[1],
        id: "conversation",
        rationale: "Deterministic synthetic conversation objective.",
      },
    ],
    operations: [input.operation],
    templateId: input.templateId,
  };
}

export function makeBrief(
  entries: DesignBrief["entries"] = [],
  modelReference?: DesignBrief["modelReference"],
): DesignBrief {
  return {
    acceptedAt: "2026-07-18T10:00:00.000Z",
    acceptedBy: ids.actor,
    createdAt: "2026-07-18T09:00:00.000Z",
    entries,
    id: ids.brief,
    ...(modelReference === undefined ? {} : { modelReference }),
    projectId: ids.project,
    referenceBoard: [],
    revision: 1,
    schemaVersion: "c11-design-brief-v1",
    status: "accepted",
    updatedAt: "2026-07-18T10:00:00.000Z",
    updatedBy: ids.actor,
  };
}

function briefContentSha256(brief: DesignBrief): string {
  return sha256Canonical({
    entries: brief.entries
      .map((entry) => ({
        ...entry,
        roomOrLevelElementIds: [...entry.roomOrLevelElementIds].sort(),
      }))
      .sort((left, right) => compareStrings(left.id, right.id)),
    id: brief.id,
    ...(brief.modelReference === undefined ? {} : { modelReference: brief.modelReference }),
    projectId: brief.projectId,
    referenceBoard: [...brief.referenceBoard].sort((left, right) =>
      compareStrings(left.id, right.id),
    ),
    schemaVersion: brief.schemaVersion,
  });
}

export function constraintRequest(
  request: DeterministicDesignEngineRequest,
): DeterministicDesignConstraintRequest {
  return {
    acceptedBrief: request.acceptedBrief,
    acceptedBriefContentSha256: request.acceptedBriefContentSha256,
    briefConstraintFacts: request.briefConstraintFacts,
    finishTargets: request.finishTargets,
    keepOuts: request.keepOuts,
    sourceModel: request.sourceModel,
    sourceSnapshot: request.sourceSnapshot,
    systemPolicy: {
      boundaryTouch: request.configuration.boundaryTouch,
      schemaVersion: request.configuration.schemaVersion,
    },
    workingModel: request.workingModel,
    workingSnapshot: request.workingSnapshot,
  };
}

export function makeRequest(
  overrides: {
    readonly assets?: readonly InteriorAssetRef[];
    readonly briefEntries?: DesignBrief["entries"];
    readonly briefConstraintFacts?: readonly BriefConstraintFact[];
    readonly candidateTemplates?: readonly DesignCandidateTemplate[];
    readonly existing?: CanonicalHomeSnapshot;
    readonly finishTargets?: readonly FinishTargetDeclaration[];
    readonly keepOuts?: readonly KeepOutDeclaration[];
    readonly requestedDirections?: DeterministicDesignEngineRequest["requestedDirections"];
    readonly requestedOptionCount?: number;
    readonly touch?: DeterministicDesignEngineRequest["configuration"]["boundaryTouch"];
  } = {},
): DeterministicDesignEngineRequest {
  const existing = overrides.existing ?? makeExistingSnapshot();
  const source = validateAndCanonicalizeSnapshot(existing);
  const workingSnapshot = proposedClone(existing);
  const working = validateAndCanonicalizeSnapshot(workingSnapshot);
  const brief = makeBrief(overrides.briefEntries ?? [], {
    modelId: ids.model,
    snapshotId: ids.snapshot,
    snapshotSha256: source.snapshotSha256,
  });
  const asset = overrides.assets?.[0] ?? makeAsset();
  const operationA = furnishingOperation({
    asset,
    elementId: ids.elementA,
    operationId: id(100),
    xMm: 1_200,
    yMm: 1_000,
  });
  const operationB = furnishingOperation({
    asset,
    elementId: ids.elementB,
    operationId: id(101),
    xMm: 3_200,
    yMm: 1_000,
  });
  const templates = overrides.candidateTemplates ?? [
    template({
      direction: "circulation-first",
      elementId: ids.elementA,
      objectives: [9_000, 5_000],
      operation: operationA,
      templateId: ids.templateA,
    }),
    template({
      direction: "conversation-first",
      elementId: ids.elementB,
      objectives: [5_000, 9_000],
      operation: operationB,
      templateId: ids.templateB,
    }),
  ];
  return {
    acceptedBrief: brief,
    acceptedBriefContentSha256: briefContentSha256(brief),
    assetManifestSha256: "e".repeat(64),
    assets: overrides.assets ?? [asset],
    briefConstraintFacts: overrides.briefConstraintFacts ?? [],
    candidateTemplates: templates,
    configuration: {
      boundaryTouch: overrides.touch ?? { keepOut: "forbid", obstacle: "allow", room: "allow" },
      candidateBudget: 500,
      schemaVersion: "c12-deterministic-search-config-v1",
    },
    finishTargets: overrides.finishTargets ?? [],
    keepOuts: overrides.keepOuts ?? [],
    requestedDirections: overrides.requestedDirections ?? [
      "circulation-first",
      "conversation-first",
    ],
    requestedOptionCount: overrides.requestedOptionCount ?? 2,
    sourceModel: {
      modelId: ids.model,
      profile: "existing",
      snapshotId: ids.snapshot,
      snapshotSha256: source.snapshotSha256,
      snapshotVersion: 1,
    },
    sourceSnapshot: existing,
    workingModel: {
      modelId: ids.model,
      profile: "proposed",
      snapshotId: id(200),
      snapshotSha256: working.snapshotSha256,
      snapshotVersion: 1,
    },
    workingSnapshot,
  };
}
