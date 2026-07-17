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
    sha256: "78779c4dead266ced6bc0beeb11c478697ef08659c58365201286567ebecc400",
  },
  existing: {
    canonicalByteLength: 68_923,
    sha256: "cfc2c65ee8c6a13d43f13c9d8a5c58b539604efe5a02bd146898675421feb0b0",
  },
  proposed: {
    canonicalByteLength: 69_173,
    sha256: "e45846a3a0e311443991df0b5210f6d66e059693efb44eae9ef84fbe5810826d",
  },
});
