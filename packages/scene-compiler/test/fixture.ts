import {
  canonicalHomeSnapshotSchema,
  sceneSnapshotReferenceSchema,
  type CanonicalHomeSnapshot,
  type KnownAttribution,
  type SceneSnapshotReference,
} from "@interior-design/contracts";

import { canonicalSnapshotSha256 } from "../src/index.js";

export const fixtureIds = Object.freeze({
  actor: "20000000-0000-4000-8000-000000000001",
  camera: "20000000-0000-4000-8000-000000000002",
  claim: "20000000-0000-4000-8000-000000000003",
  finish: "20000000-0000-4000-8000-000000000004",
  fixedObject: "20000000-0000-4000-8000-000000000005",
  furnishing: "20000000-0000-4000-8000-000000000006",
  ground: "20000000-0000-4000-8000-000000000007",
  light: "20000000-0000-4000-8000-000000000008",
  model: "20000000-0000-4000-8000-000000000009",
  opening: "20000000-0000-4000-8000-00000000000a",
  project: "20000000-0000-4000-8000-00000000000b",
  snapshot: "20000000-0000-4000-8000-00000000000c",
  space: "20000000-0000-4000-8000-00000000000d",
  stair: "20000000-0000-4000-8000-00000000000e",
  surface: "20000000-0000-4000-8000-00000000000f",
  upper: "20000000-0000-4000-8000-000000000010",
  wallEast: "20000000-0000-4000-8000-000000000011",
  wallNorth: "20000000-0000-4000-8000-000000000012",
  wallSouth: "20000000-0000-4000-8000-000000000013",
  wallWest: "20000000-0000-4000-8000-000000000014",
});

function attribution(): KnownAttribution {
  return {
    actorUserId: fixtureIds.actor,
    claimId: fixtureIds.claim,
    evidenceIds: [],
    method: { kind: "fixture", name: "c10-synthetic-fixture", version: "1" },
    state: "user-asserted",
    verification: { status: "not-reviewed" },
  };
}

export function known<TValue>(value: TValue) {
  return { attribution: attribution(), knowledge: "known" as const, value };
}

export function unknown() {
  return {
    attribution: {
      claimId: fixtureIds.claim,
      evidenceIds: [],
      method: { kind: "fixture" as const, name: "c10-synthetic-fixture", version: "1" },
      reason: "not-observed" as const,
      state: "unknown" as const,
      verification: { status: "not-reviewed" as const },
    },
    knowledge: "unknown" as const,
  };
}

function wall(id: string, path: readonly { readonly xMm: number; readonly yMm: number }[]) {
  return {
    alignment: "centre" as const,
    baseOffsetMm: known(0),
    elementType: "wall" as const,
    heightMm: known(2_700),
    id,
    levelId: fixtureIds.ground,
    name: known("Synthetic wall"),
    origin: attribution(),
    path: known(path),
    thicknessMm: known(200),
  };
}

export function canonicalFixture(): CanonicalHomeSnapshot {
  return canonicalHomeSnapshotSchema.parse({
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
          id: fixtureIds.camera,
          levelId: fixtureIds.ground,
          name: known("Synthetic camera"),
          origin: attribution(),
          position: known({ xMm: 1_000, yMm: 1_000, zMm: 1_600 }),
          target: known({ xMm: 2_500, yMm: 2_000, zMm: 1_200 }),
          verticalFovMilliDegrees: known(60_000),
        },
      ],
      finishes: [
        {
          elementType: "finish",
          face: "top",
          id: fixtureIds.finish,
          material: known("Synthetic oak finish"),
          name: known("Synthetic finish"),
          origin: attribution(),
          targetElementId: fixtureIds.surface,
        },
      ],
      fixedObjects: [
        {
          category: known("Cabinet"),
          dimensions: known({ depthMm: 600, heightMm: 900, widthMm: 1_000 }),
          elementType: "fixed-object",
          id: fixtureIds.fixedObject,
          levelId: fixtureIds.ground,
          name: known("Synthetic cabinet"),
          origin: attribution(),
          placement: {
            position: known({ xMm: 700, yMm: 700, zMm: 0 }),
            rotationMilliDegrees: known(30_000),
          },
        },
      ],
      furnishings: [
        {
          category: known("Chair"),
          dimensions: known({ depthMm: 500, heightMm: 800, widthMm: 500 }),
          elementType: "furnishing",
          id: fixtureIds.furnishing,
          levelId: fixtureIds.upper,
          name: known("Synthetic chair"),
          origin: attribution(),
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
          id: fixtureIds.ground,
          name: known("Ground"),
          origin: attribution(),
          storeyHeightMm: known(3_000),
        },
        {
          elementType: "level",
          elevationMm: known(3_000),
          id: fixtureIds.upper,
          name: known("Upper"),
          origin: attribution(),
          storeyHeightMm: known(3_000),
        },
      ],
      lights: [
        {
          colourTemperatureKelvin: known(3_000),
          elementType: "light",
          id: fixtureIds.light,
          kind: "point",
          levelId: fixtureIds.ground,
          luminousFluxLumens: known(800),
          name: known("Synthetic light"),
          origin: attribution(),
          position: known({ xMm: 2_500, yMm: 2_000, zMm: 2_500 }),
        },
      ],
      openings: [
        {
          elementType: "opening",
          heightMm: known(2_100),
          hostWallId: fixtureIds.wallSouth,
          id: fixtureIds.opening,
          kind: "door",
          name: known("Synthetic door"),
          offsetAlongHostMm: known(1_000),
          origin: attribution(),
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
          boundedByElementIds: [
            fixtureIds.wallSouth,
            fixtureIds.wallEast,
            fixtureIds.wallNorth,
            fixtureIds.wallWest,
          ],
          classification: known("Room"),
          elementType: "space",
          id: fixtureIds.space,
          levelId: fixtureIds.ground,
          name: known("Synthetic room"),
          origin: attribution(),
        },
      ],
      stairs: [
        {
          elementType: "stair",
          fromLevelId: fixtureIds.ground,
          id: fixtureIds.stair,
          name: known("Synthetic stair"),
          origin: attribution(),
          path: known([
            { xMm: 500, yMm: 500 },
            { xMm: 4_000, yMm: 500 },
          ]),
          riseMm: known(200),
          runMm: known(250),
          stepCount: known(15),
          toLevelId: fixtureIds.upper,
          widthMm: known(900),
        },
      ],
      surfaces: [
        {
          boundary: known([
            { xMm: 0, yMm: 0, zMm: 0 },
            { xMm: 5_000, yMm: 0, zMm: 0 },
            { xMm: 5_000, yMm: 4_000, zMm: 0 },
            { xMm: 3_000, yMm: 3_000, zMm: 0 },
            { xMm: 0, yMm: 4_000, zMm: 0 },
          ]),
          elementType: "surface",
          id: fixtureIds.surface,
          kind: "floor",
          levelId: fixtureIds.ground,
          name: known("Concave synthetic floor"),
          origin: attribution(),
        },
      ],
      walls: [
        wall(fixtureIds.wallSouth, [
          { xMm: 0, yMm: 0 },
          { xMm: 5_000, yMm: 0 },
        ]),
        wall(fixtureIds.wallEast, [
          { xMm: 5_000, yMm: 0 },
          { xMm: 5_000, yMm: 2_000 },
          { xMm: 5_000, yMm: 4_000 },
        ]),
        wall(fixtureIds.wallNorth, [
          { xMm: 5_000, yMm: 4_000 },
          { xMm: 0, yMm: 4_000 },
        ]),
        wall(fixtureIds.wallWest, [
          { xMm: 0, yMm: 4_000 },
          { xMm: 0, yMm: 0 },
        ]),
      ],
    },
    knownLimitations: [
      {
        code: "SYNTHETIC_FIXTURE_ONLY",
        detail: "Synthetic geometry for deterministic C10 validation; not survey evidence.",
      },
    ],
    modelId: fixtureIds.model,
    profile: "existing",
    projectId: fixtureIds.project,
    schemaVersion: "c4-canonical-home-v1",
  });
}

export function fixtureReference(snapshot: CanonicalHomeSnapshot): SceneSnapshotReference {
  return sceneSnapshotReferenceSchema.parse({
    modelId: snapshot.modelId,
    profile: snapshot.profile,
    projectId: snapshot.projectId,
    schemaVersion: snapshot.schemaVersion,
    snapshotId: fixtureIds.snapshot,
    snapshotSha256: canonicalSnapshotSha256(snapshot),
  });
}
