import {
  canonicalHomeSnapshotSchema,
  type CanonicalHomeSnapshot,
} from "@interior-design/contracts";

export const ids = Object.freeze({
  actor: "00000000-0000-4000-8000-000000000001",
  camera: "00000000-0000-4000-8000-000000000002",
  claim: "00000000-0000-4000-8000-000000000003",
  evidence: "00000000-0000-4000-8000-000000000004",
  finish: "00000000-0000-4000-8000-000000000005",
  fixedObject: "00000000-0000-4000-8000-000000000006",
  furnishing: "00000000-0000-4000-8000-000000000007",
  ground: "00000000-0000-4000-8000-000000000008",
  light: "00000000-0000-4000-8000-000000000009",
  model: "00000000-0000-4000-8000-00000000000a",
  opening: "00000000-0000-4000-8000-00000000000b",
  project: "00000000-0000-4000-8000-00000000000c",
  space: "00000000-0000-4000-8000-00000000000d",
  stair: "00000000-0000-4000-8000-00000000000e",
  surface: "00000000-0000-4000-8000-00000000000f",
  upper: "00000000-0000-4000-8000-000000000010",
  wallEast: "00000000-0000-4000-8000-000000000011",
  wallNorth: "00000000-0000-4000-8000-000000000012",
  wallSouth: "00000000-0000-4000-8000-000000000013",
  wallWest: "00000000-0000-4000-8000-000000000014",
});

export function elementId(sequence: number): string {
  return `10000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;
}

function method() {
  return { kind: "fixture" as const, name: "synthetic-geometry-fixture", version: "1" };
}

function knownAttribution() {
  return {
    actorUserId: ids.actor,
    claimId: ids.claim,
    evidenceIds: [],
    method: method(),
    state: "user-asserted" as const,
    verification: { status: "not-reviewed" as const },
  };
}

export function known<TValue>(value: TValue) {
  return { attribution: knownAttribution(), knowledge: "known" as const, value };
}

export function unknown() {
  return {
    attribution: {
      claimId: ids.claim,
      evidenceIds: [],
      method: method(),
      reason: "not-observed" as const,
      state: "unknown" as const,
      verification: { status: "not-reviewed" as const },
    },
    knowledge: "unknown" as const,
  };
}

function wall(id: string, path: { xMm: number; yMm: number }[]) {
  return {
    alignment: "centre" as const,
    baseOffsetMm: known(0),
    elementType: "wall" as const,
    heightMm: known(2_700),
    id,
    levelId: ids.ground,
    name: known("Synthetic wall"),
    origin: knownAttribution(),
    path: known(path),
    thicknessMm: known(200),
  };
}

export function validSnapshot(): CanonicalHomeSnapshot {
  const snapshot: CanonicalHomeSnapshot = {
    coordinateSystem: {
      axes: { x: "east", y: "north", z: "up" },
      globalAnchor: { status: "not-established" },
      handedness: "right",
      kind: "local-cartesian",
      lengthUnit: "mm",
      originConvention: "project-local-model-origin",
    },
    elements: {
      cameras: [
        {
          elementType: "camera",
          id: ids.camera,
          levelId: ids.ground,
          name: known("Synthetic camera"),
          origin: knownAttribution(),
          position: known({ xMm: 1_000, yMm: 1_000, zMm: 1_600 }),
          target: known({ xMm: 2_500, yMm: 2_000, zMm: 1_200 }),
          verticalFovMilliDegrees: known(60_000),
        },
      ],
      finishes: [
        {
          elementType: "finish",
          face: "top",
          id: ids.finish,
          material: known("Synthetic finish"),
          name: known("Synthetic floor finish"),
          origin: knownAttribution(),
          targetElementId: ids.surface,
        },
      ],
      fixedObjects: [
        {
          category: known("Synthetic cabinet"),
          dimensions: known({ depthMm: 600, heightMm: 900, widthMm: 1_000 }),
          elementType: "fixed-object",
          id: ids.fixedObject,
          levelId: ids.ground,
          name: known("Synthetic fixed object"),
          origin: knownAttribution(),
          placement: {
            position: known({ xMm: 500, yMm: 500, zMm: 0 }),
            rotationMilliDegrees: known(0),
          },
        },
      ],
      furnishings: [
        {
          category: known("Synthetic chair"),
          dimensions: known({ depthMm: 500, heightMm: 800, widthMm: 500 }),
          elementType: "furnishing",
          id: ids.furnishing,
          levelId: ids.upper,
          name: known("Synthetic furnishing"),
          origin: knownAttribution(),
          placement: {
            position: known({ xMm: 1_000, yMm: 1_000, zMm: 3_000 }),
            rotationMilliDegrees: known(90_000),
          },
        },
      ],
      levels: [
        {
          elementType: "level",
          elevationMm: known(0),
          id: ids.ground,
          name: known("Synthetic ground level"),
          origin: knownAttribution(),
          storeyHeightMm: known(3_000),
        },
        {
          elementType: "level",
          elevationMm: known(3_000),
          id: ids.upper,
          name: known("Synthetic upper level"),
          origin: knownAttribution(),
          storeyHeightMm: known(3_000),
        },
      ],
      lights: [
        {
          colourTemperatureKelvin: known(3_000),
          elementType: "light",
          id: ids.light,
          kind: "point",
          levelId: ids.ground,
          luminousFluxLumens: known(800),
          name: known("Synthetic light"),
          origin: knownAttribution(),
          position: known({ xMm: 2_500, yMm: 2_000, zMm: 2_500 }),
        },
      ],
      openings: [
        {
          elementType: "opening",
          heightMm: known(2_100),
          hostWallId: ids.wallSouth,
          id: ids.opening,
          kind: "door",
          name: known("Synthetic opening"),
          offsetAlongHostMm: known(1_000),
          origin: knownAttribution(),
          sillHeightMm: known(0),
          swing: known("left" as const),
          widthMm: known(900),
        },
      ],
      spaces: [
        {
          boundary: known([
            { xMm: 0, yMm: 0 },
            { xMm: 5_000, yMm: 0 },
            { xMm: 5_000, yMm: 4_000 },
            { xMm: 0, yMm: 4_000 },
          ]),
          boundedByElementIds: [ids.wallSouth, ids.wallEast, ids.wallNorth, ids.wallWest],
          classification: known("Synthetic room"),
          elementType: "space",
          id: ids.space,
          levelId: ids.ground,
          name: known("Synthetic space"),
          origin: knownAttribution(),
        },
      ],
      stairs: [
        {
          elementType: "stair",
          fromLevelId: ids.ground,
          id: ids.stair,
          name: known("Synthetic stair"),
          origin: knownAttribution(),
          path: known([
            { xMm: 500, yMm: 500 },
            { xMm: 4_000, yMm: 500 },
          ]),
          riseMm: known(200),
          runMm: known(250),
          stepCount: known(15),
          toLevelId: ids.upper,
          widthMm: known(900),
        },
      ],
      surfaces: [
        {
          boundary: known([
            { xMm: 0, yMm: 0, zMm: 0 },
            { xMm: 5_000, yMm: 0, zMm: 0 },
            { xMm: 5_000, yMm: 4_000, zMm: 0 },
            { xMm: 0, yMm: 4_000, zMm: 0 },
          ]),
          elementType: "surface",
          id: ids.surface,
          kind: "floor",
          levelId: ids.ground,
          name: known("Synthetic floor surface"),
          origin: knownAttribution(),
        },
      ],
      walls: [
        wall(ids.wallSouth, [
          { xMm: 0, yMm: 0 },
          { xMm: 5_000, yMm: 0 },
        ]),
        wall(ids.wallEast, [
          { xMm: 5_000, yMm: 0 },
          { xMm: 5_000, yMm: 4_000 },
        ]),
        wall(ids.wallNorth, [
          { xMm: 5_000, yMm: 4_000 },
          { xMm: 0, yMm: 4_000 },
        ]),
        wall(ids.wallWest, [
          { xMm: 0, yMm: 4_000 },
          { xMm: 0, yMm: 0 },
        ]),
      ],
    },
    knownLimitations: [
      {
        code: "SYNTHETIC_FIXTURE_ONLY",
        detail: "Synthetic geometry for deterministic validation; not property or survey evidence.",
      },
    ],
    modelId: ids.model,
    profile: "existing",
    projectId: ids.project,
    schemaVersion: "c4-canonical-home-v1",
  };
  return canonicalHomeSnapshotSchema.parse(snapshot);
}

export function parseSnapshot(snapshot: CanonicalHomeSnapshot): CanonicalHomeSnapshot {
  return canonicalHomeSnapshotSchema.parse(snapshot);
}
