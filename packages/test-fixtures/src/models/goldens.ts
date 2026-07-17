import { deepFreeze } from "./freeze.js";
import { canonicalFixtureIds } from "./ids.js";

const ids = canonicalFixtureIds.elements;

export const canonicalHashInputContract = deepFreeze({
  excludedEnvelopeFields: [
    "actor",
    "createdAt",
    "createdBy",
    "databaseSequence",
    "snapshotId",
    "transportEnvelope",
  ],
  includedRootFields: [
    "coordinateSystem",
    "derivedFromSnapshotSha256",
    "elements",
    "knownLimitations",
    "modelId",
    "profile",
    "projectId",
    "propertyId",
    "schemaVersion",
  ],
  orderedReferenceSets: ["boundedByElementIds", "evidenceIds"],
  preservedAuthoredSequences: [
    "space.boundary.value",
    "stair.path.value",
    "surface.boundary.value",
    "wall.path.value",
  ],
});

export const expectedCanonicalElementOrder = deepFreeze({
  cameras: [ids.cameraGround],
  finishes: [ids.finishGroundFloor],
  fixedObjects: [ids.fixedKitchenCabinet],
  furnishings: [ids.furnishingSofa],
  levels: [ids.levelGround, ids.levelFirst].sort(),
  lights: [ids.lightGround],
  openings: [
    ids.openingDoorGround,
    ids.openingWindowGroundLiving,
    ids.openingWindowGroundKitchen,
    ids.openingDoorFirst,
    ids.openingWindowFirst,
  ].sort(),
  spaces: [ids.spaceLiving, ids.spaceKitchen, ids.spaceBedroom, ids.spaceLanding].sort(),
  stairs: [ids.stairMain],
  surfaces: [
    ids.surfaceGroundFloor,
    ids.surfaceGroundCeiling,
    ids.surfaceFirstFloor,
    ids.surfaceFirstCeiling,
  ].sort(),
  walls: [
    ids.wallGroundSouthLiving,
    ids.wallGroundWest,
    ids.wallGroundNorthLiving,
    ids.wallGroundPartition,
    ids.wallGroundSouthKitchen,
    ids.wallGroundEast,
    ids.wallGroundNorthKitchen,
    ids.wallFirstSouthBedroom,
    ids.wallFirstWest,
    ids.wallFirstNorthBedroom,
    ids.wallFirstPartition,
    ids.wallFirstEast,
    ids.wallFirstNorthLanding,
    ids.wallFirstSouthLanding,
  ].sort(),
});

export const canonicalProfileGoldens = deepFreeze({
  "as-built": {
    canonicalByteLength: 69_173,
    sha256: "dc339d56d8a20a7bb4d23a1cc04b760fd1d675c06bf41e3b2dfdb91df6d233cc",
  },
  existing: {
    canonicalByteLength: 68_923,
    sha256: "587ebdfa03235b2dbf0346e7558398636057e735a014fdb9ca08d696ad4dda6f",
  },
  proposed: {
    canonicalByteLength: 69_173,
    sha256: "c13a92cbc6312dd08ab9dca4f2cd4dea82bdeedc9b5ab50171e7bb1ff69004b1",
  },
});
