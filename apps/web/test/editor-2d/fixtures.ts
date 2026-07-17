import type {
  CanonicalHomeSnapshot,
  KnownAttribution,
  ModelBranch,
  ModelSnapshotRecord,
} from "@interior-design/contracts";

export const uuid = (sequence: number): string =>
  `10000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;
let claim = 100;

export function attribution(): KnownAttribution {
  claim += 1;
  return {
    actorUserId: uuid(1),
    claimId: uuid(claim),
    evidenceIds: [],
    method: { kind: "manual", name: "C5 web frozen mock", version: "1" },
    state: "user-asserted",
    verification: { status: "not-reviewed" },
  };
}

const known = <T>(value: T) => ({ attribution: attribution(), knowledge: "known" as const, value });

export const snapshot: CanonicalHomeSnapshot = {
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
        id: uuid(10),
        name: known("Ground"),
        origin: attribution(),
        storeyHeightMm: known(2_800),
      },
    ],
    lights: [],
    openings: [],
    spaces: [],
    stairs: [],
    surfaces: [],
    walls: [
      {
        alignment: "centre",
        baseOffsetMm: known(0),
        elementType: "wall",
        heightMm: known(2_600),
        id: uuid(20),
        levelId: uuid(10),
        name: known("External wall"),
        origin: attribution(),
        path: known([
          { xMm: 0, yMm: 0 },
          { xMm: 4_000, yMm: 0 },
        ]),
        thicknessMm: known(180),
      },
    ],
  },
  knownLimitations: [
    { code: "STRUCTURAL_STATUS_UNKNOWN", detail: "Structural status is not established." },
  ],
  modelId: uuid(4),
  profile: "existing",
  projectId: uuid(5),
  schemaVersion: "c4-canonical-home-v1",
};

export const snapshotRecord: ModelSnapshotRecord = {
  canonicalByteLength: 1_234,
  createdAt: "2026-07-17T12:00:00.000Z",
  createdBy: uuid(1),
  id: uuid(50),
  modelId: uuid(4),
  profile: "existing",
  projectId: uuid(5),
  schemaVersion: "c4-canonical-home-v1",
  snapshot,
  snapshotSha256: "a".repeat(64),
  version: 1,
};

export const branch: ModelBranch = {
  createdAt: "2026-07-17T12:00:00.000Z",
  createdBy: uuid(1),
  headSnapshotId: snapshotRecord.id,
  headSnapshotSha256: snapshotRecord.snapshotSha256,
  id: uuid(60),
  modelId: snapshotRecord.modelId,
  name: "Main study",
  profile: "existing",
  projectId: snapshotRecord.projectId,
  revision: 0,
  schemaVersion: "c5-model-branch-v1",
  sourceSnapshotId: snapshotRecord.id,
  updatedAt: "2026-07-17T12:00:00.000Z",
};
