import {
  canonicalHomeSnapshotSchema,
  designBriefSchema,
  modelSnapshotRecordSchema,
  optionJobSchema,
  type KnownAttribution,
} from "@interior-design/contracts";
import {
  deriveDeterministicDesignConstraints,
  deterministicSearchConfigurationVersion,
} from "@interior-design/design-engine";
import { creatorOwnedSyntheticAssetCatalog } from "@interior-design/interior-assets";
import { validateAndCanonicalizeSnapshot } from "@interior-design/model-operations";
import {
  c12Sha256,
  constraintsSha256,
  type LeasedOptionAttempt,
} from "@interior-design/platform-api/design-options";

import { c12BoundaryTouchPolicy } from "../../src/design-options/planner.js";

export function id(ordinal: number): string {
  return `c1200000-0000-4000-8000-${ordinal.toString(16).padStart(12, "0")}`;
}

const ids = Object.freeze({
  actor: id(1),
  brief: id(2),
  ceiling: id(3),
  evidence: id(4),
  level: id(5),
  model: id(6),
  project: id(7),
  snapshot: id(8),
  space: id(9),
  floor: id(10),
  job: id(11),
  working: id(12),
});

const attribution: KnownAttribution = {
  claimId: id(20),
  evidenceIds: [ids.evidence],
  method: { kind: "fixture", name: "C12 exact synthetic home", version: "1" },
  state: "source-derived",
  verification: { status: "not-reviewed" },
};

function briefContentSha256(brief: ReturnType<typeof designBriefSchema.parse>): string {
  return c12Sha256({
    entries: brief.entries,
    id: brief.id,
    ...(brief.modelReference === undefined ? {} : { modelReference: brief.modelReference }),
    projectId: brief.projectId,
    referenceBoard: brief.referenceBoard,
    schemaVersion: brief.schemaVersion,
  });
}

export function richLease(withEvidence = true): LeasedOptionAttempt {
  const usedAttribution = withEvidence
    ? attribution
    : ({
        actorUserId: ids.actor,
        claimId: id(21),
        evidenceIds: [],
        method: { kind: "fixture", name: "Unlinked C12 fixture", version: "1" },
        state: "user-asserted",
        verification: { status: "not-reviewed" },
      } satisfies KnownAttribution);
  const value = <T>(input: T) => ({
    attribution: usedAttribution,
    knowledge: "known" as const,
    value: input,
  });
  const existing = canonicalHomeSnapshotSchema.parse({
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
          elevationMm: value(0),
          id: ids.level,
          name: value("Synthetic ground floor"),
          origin: usedAttribution,
          storeyHeightMm: value(3_000),
        },
      ],
      lights: [],
      openings: [],
      spaces: [
        {
          boundary: value([
            { xMm: 0, yMm: 0 },
            { xMm: 7_000, yMm: 0 },
            { xMm: 7_000, yMm: 5_000 },
            { xMm: 0, yMm: 5_000 },
          ]),
          boundedByElementIds: [],
          classification: value("living-room"),
          elementType: "space",
          id: ids.space,
          levelId: ids.level,
          name: value("Synthetic living room"),
          origin: usedAttribution,
        },
      ],
      stairs: [],
      surfaces: [
        {
          boundary: value([
            { xMm: 0, yMm: 0, zMm: 0 },
            { xMm: 7_000, yMm: 0, zMm: 0 },
            { xMm: 7_000, yMm: 5_000, zMm: 0 },
            { xMm: 0, yMm: 5_000, zMm: 0 },
          ]),
          elementType: "surface",
          id: ids.floor,
          kind: "floor",
          levelId: ids.level,
          name: value("Synthetic floor"),
          origin: usedAttribution,
        },
        {
          boundary: value([
            { xMm: 0, yMm: 0, zMm: 3_000 },
            { xMm: 0, yMm: 5_000, zMm: 3_000 },
            { xMm: 7_000, yMm: 5_000, zMm: 3_000 },
            { xMm: 7_000, yMm: 0, zMm: 3_000 },
          ]),
          elementType: "surface",
          id: ids.ceiling,
          kind: "ceiling",
          levelId: ids.level,
          name: value("Synthetic ceiling"),
          origin: usedAttribution,
        },
      ],
      walls: [],
    },
    knownLimitations: [
      { code: "SYNTHETIC_FIXTURE", detail: "Creator-owned synthetic geometry for C12 tests only." },
    ],
    modelId: ids.model,
    profile: "existing",
    projectId: ids.project,
    schemaVersion: "c4-canonical-home-v1",
  });
  const sourceSha256 = validateAndCanonicalizeSnapshot(existing).snapshotSha256;
  const working = canonicalHomeSnapshotSchema.parse({
    ...structuredClone(existing),
    derivedFromSnapshotSha256: sourceSha256,
    profile: "proposed",
  });
  const workingSha256 = validateAndCanonicalizeSnapshot(working).snapshotSha256;
  const brief = designBriefSchema.parse({
    acceptedAt: "2026-07-18T04:00:00.000Z",
    acceptedBy: ids.actor,
    createdAt: "2026-07-18T03:00:00.000Z",
    entries: [],
    id: ids.brief,
    modelReference: {
      modelId: ids.model,
      snapshotId: ids.snapshot,
      snapshotSha256: sourceSha256,
    },
    projectId: ids.project,
    referenceBoard: [],
    revision: 1,
    schemaVersion: "c11-design-brief-v1",
    status: "accepted",
    updatedAt: "2026-07-18T04:00:00.000Z",
    updatedBy: ids.actor,
  });
  const contentSha256 = briefContentSha256(brief);
  const sourceModel = {
    modelId: ids.model,
    profile: "existing" as const,
    snapshotId: ids.snapshot,
    snapshotSha256: sourceSha256,
    snapshotVersion: 1,
  };
  const workingModel = {
    modelId: ids.model,
    profile: "proposed" as const,
    snapshotId: ids.working,
    snapshotSha256: workingSha256,
    snapshotVersion: 1,
  };
  const preflight = deriveDeterministicDesignConstraints({
    acceptedBrief: brief,
    acceptedBriefContentSha256: contentSha256,
    briefConstraintFacts: [],
    finishTargets: [
      { allowedFaces: ["bottom"], targetElementId: ids.ceiling },
      { allowedFaces: ["top"], targetElementId: ids.floor },
    ],
    keepOuts: [],
    sourceModel,
    sourceSnapshot: existing,
    systemPolicy: {
      boundaryTouch: c12BoundaryTouchPolicy,
      schemaVersion: deterministicSearchConfigurationVersion,
    },
    workingModel,
    workingSnapshot: working,
  });
  if (!preflight.ok)
    throw new Error(`Synthetic C12 preflight failed: ${preflight.abstention.code}`);
  const job = optionJobSchema.parse({
    assetManifestSha256: creatorOwnedSyntheticAssetCatalog.manifestSha256,
    attempt: 1,
    baseBrief: { briefId: ids.brief, contentSha256, revision: 1 },
    constraints: preflight.constraints,
    constraintsSha256: constraintsSha256(preflight.constraints),
    createdAt: "2026-07-18T05:00:00.000Z",
    createdBy: ids.actor,
    id: ids.job,
    optionCount: 0,
    projectId: ids.project,
    requestedDirections: ["circulation-first", "conversation-first"],
    requestedOptionCount: 2,
    retryable: false,
    schemaVersion: "c12-option-job-v1",
    sourceModel,
    stage: "deriving-constraints",
    state: "running",
    updatedAt: "2026-07-18T05:00:01.000Z",
    version: 2,
    workingModel,
  });
  return {
    acceptedBrief: brief,
    attempt: 1,
    constraints: preflight.constraints,
    job,
    leaseExpiresAt: "2026-07-18T05:05:01.000Z",
    leaseToken: id(30),
    sourceSnapshot: modelSnapshotRecordSchema.parse({
      canonicalByteLength: JSON.stringify(existing).length,
      createdAt: "2026-07-18T02:00:00.000Z",
      createdBy: ids.actor,
      id: ids.snapshot,
      modelId: ids.model,
      profile: "existing",
      projectId: ids.project,
      schemaVersion: "c4-canonical-home-v1",
      snapshot: existing,
      snapshotSha256: sourceSha256,
      version: 1,
    }),
    tenantId: id(40),
    workingSnapshot: working,
  };
}
