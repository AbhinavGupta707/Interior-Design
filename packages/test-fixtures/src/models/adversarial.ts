import type { CanonicalHomeSnapshot } from "@interior-design/contracts";

import { knownFixtureValue, sourceAttribution, unknownFixtureValue } from "./attribution.js";
import { deepFreeze } from "./freeze.js";
import { canonicalFixtureIds } from "./ids.js";
import { existingHomeSnapshot } from "./valid-home.js";

export type EvaluationSeverity = "error" | "information" | "warning";

export interface ExpectedGeometryFinding {
  readonly affectedElementIds: readonly string[];
  readonly code: string;
  readonly location?: { readonly levelId: string; readonly xMm: number; readonly yMm: number };
  readonly severity: EvaluationSeverity;
}

export interface CanonicalGeometryEvaluationCase {
  readonly description: string;
  readonly expectedFindings: readonly ExpectedGeometryFinding[];
  readonly fixtureId: string;
  readonly severeErrorExpected: boolean;
  readonly snapshot: CanonicalHomeSnapshot;
}

export interface CanonicalSchemaEvaluationCase {
  readonly description: string;
  readonly expectedIssues: readonly {
    readonly code: string;
    readonly pathIncludes: string;
    readonly severity: "error";
  }[];
  readonly fixtureId: string;
  readonly input: unknown;
}

const ids = canonicalFixtureIds.elements;

function mutableSnapshot(): CanonicalHomeSnapshot {
  return structuredClone(existingHomeSnapshot);
}

function requiredElement<T extends { id: string }>(collection: readonly T[], id: string): T {
  const element = collection.find((candidate) => candidate.id === id);
  if (element === undefined) {
    throw new Error(`C4 adversarial fixture could not find element ${id}.`);
  }
  return element;
}

const finding = (
  code: string,
  severity: EvaluationSeverity,
  affectedElementIds: readonly string[],
  location?: { readonly levelId: string; readonly xMm: number; readonly yMm: number },
): ExpectedGeometryFinding => ({
  affectedElementIds: [...affectedElementIds].sort(),
  code,
  ...(location === undefined ? {} : { location }),
  severity,
});

const located = (levelId: string, xMm: number, yMm: number) => ({ levelId, xMm, yMm });

function geometryCase(
  fixtureId: string,
  description: string,
  snapshot: CanonicalHomeSnapshot,
  expectedFindings: readonly ExpectedGeometryFinding[],
  severeErrorExpected = true,
): CanonicalGeometryEvaluationCase {
  return deepFreeze({
    description,
    expectedFindings: [...expectedFindings].sort((left, right) =>
      `${left.code}\u0000${left.affectedElementIds.join(",")}`.localeCompare(
        `${right.code}\u0000${right.affectedElementIds.join(",")}`,
      ),
    ),
    fixtureId,
    severeErrorExpected,
    snapshot,
  });
}

const missingReferences = mutableSnapshot();
requiredElement(missingReferences.elements.openings, ids.openingDoorGround).hostWallId =
  canonicalFixtureIds.missing.hostWall;
requiredElement(missingReferences.elements.finishes, ids.finishGroundFloor).targetElementId =
  canonicalFixtureIds.missing.target;
requiredElement(missingReferences.elements.fixedObjects, ids.fixedKitchenCabinet).levelId =
  canonicalFixtureIds.missing.level;
requiredElement(missingReferences.elements.furnishings, ids.furnishingSofa).levelId =
  canonicalFixtureIds.missing.level;
requiredElement(missingReferences.elements.lights, ids.lightGround).levelId =
  canonicalFixtureIds.missing.level;
requiredElement(missingReferences.elements.cameras, ids.cameraGround).levelId =
  canonicalFixtureIds.missing.level;

const degeneratePolygons = mutableSnapshot();
requiredElement(degeneratePolygons.elements.spaces, ids.spaceLiving).boundary = knownFixtureValue(
  [
    { xMm: 0, yMm: 0 },
    { xMm: 2_500, yMm: 0 },
    { xMm: 5_000, yMm: 0 },
  ],
  910,
);
requiredElement(degeneratePolygons.elements.surfaces, ids.surfaceGroundFloor).boundary =
  knownFixtureValue(
    [
      { xMm: 0, yMm: 0, zMm: 0 },
      { xMm: 2_500, yMm: 0, zMm: 0 },
      { xMm: 5_000, yMm: 0, zMm: 0 },
    ],
    911,
  );

const selfIntersectingPolygons = mutableSnapshot();
const selfIntersecting2 = [
  { xMm: 0, yMm: 0 },
  { xMm: 5_000, yMm: 5_000 },
  { xMm: 1_000, yMm: 4_000 },
  { xMm: 5_000, yMm: 0 },
];
requiredElement(selfIntersectingPolygons.elements.spaces, ids.spaceLiving).boundary =
  knownFixtureValue(selfIntersecting2, 912);
requiredElement(selfIntersectingPolygons.elements.surfaces, ids.surfaceGroundFloor).boundary =
  knownFixtureValue(
    selfIntersecting2.map((point) => ({ ...point, zMm: 0 })),
    913,
  );

const zeroRepeatedWallSegments = mutableSnapshot();
requiredElement(zeroRepeatedWallSegments.elements.walls, ids.wallGroundSouthLiving).path =
  knownFixtureValue(
    [
      { xMm: 0, yMm: 0 },
      { xMm: 0, yMm: 0 },
      { xMm: 5_000, yMm: 0 },
      { xMm: 0, yMm: 0 },
      { xMm: 5_000, yMm: 0 },
    ],
    914,
  );

const selfIntersectingWall = mutableSnapshot();
requiredElement(selfIntersectingWall.elements.walls, ids.wallGroundSouthLiving).path =
  knownFixtureValue(selfIntersecting2, 915);

const invalidOpenings = mutableSnapshot();
requiredElement(invalidOpenings.elements.openings, ids.openingDoorGround).offsetAlongHostMm =
  knownFixtureValue(5_500, 916);
const overlapOpening = structuredClone(
  requiredElement(invalidOpenings.elements.openings, ids.openingWindowGroundLiving),
);
overlapOpening.id = canonicalFixtureIds.adversarialElements.openingOverlap;
overlapOpening.name = knownFixtureValue("Synthetic overlapping window", 917);
overlapOpening.origin = sourceAttribution(918);
overlapOpening.offsetAlongHostMm = knownFixtureValue(2_000, 919);
overlapOpening.widthMm = knownFixtureValue(1_000, 920);
overlapOpening.heightMm = knownFixtureValue(2_600, 921);
overlapOpening.sillHeightMm = knownFixtureValue(500, 922);
invalidOpenings.elements.openings.push(overlapOpening);

const inconsistentRoomBoundaries = mutableSnapshot();
requiredElement(inconsistentRoomBoundaries.elements.spaces, ids.spaceLiving).boundedByElementIds = [
  ids.wallGroundSouthLiving,
  ids.wallGroundNorthLiving,
  ids.wallGroundPartition,
  ids.wallGroundEast,
];
requiredElement(inconsistentRoomBoundaries.elements.spaces, ids.spaceKitchen).boundary =
  knownFixtureValue(
    [
      { xMm: 5_000, yMm: 0 },
      { xMm: 7_500, yMm: 0 },
      { xMm: 7_500, yMm: 6_000 },
      { xMm: 5_000, yMm: 6_000 },
    ],
    923,
  );

const stairMissingLevel = mutableSnapshot();
requiredElement(stairMissingLevel.elements.stairs, ids.stairMain).toLevelId =
  canonicalFixtureIds.missing.level;

const stairIdenticalLevels = mutableSnapshot();
requiredElement(stairIdenticalLevels.elements.stairs, ids.stairMain).toLevelId = ids.levelGround;

const stairInvalidRelationship = mutableSnapshot();
const relationshipStair = requiredElement(stairInvalidRelationship.elements.stairs, ids.stairMain);
relationshipStair.riseMm = knownFixtureValue(500, 924);
relationshipStair.runMm = knownFixtureValue(100, 925);

const stairElevationMismatch = mutableSnapshot();
requiredElement(stairElevationMismatch.elements.stairs, ids.stairMain).riseMm = knownFixtureValue(
  180,
  926,
);

const unknownWallDimensions = mutableSnapshot();
const unknownWall = requiredElement(unknownWallDimensions.elements.walls, ids.wallGroundPartition);
unknownWall.heightMm = unknownFixtureValue(927, "not-observed");
unknownWall.thicknessMm = unknownFixtureValue(928, "conflicting-evidence");

const unsafeArithmetic = mutableSnapshot();
const repeatedExtremeRing = Array.from({ length: 128 }).flatMap(() => [
  { xMm: -10_000_000, yMm: -10_000_000 },
  { xMm: 10_000_000, yMm: -10_000_000 },
  { xMm: 10_000_000, yMm: 10_000_000 },
  { xMm: -10_000_000, yMm: 10_000_000 },
]);
requiredElement(unsafeArithmetic.elements.spaces, ids.spaceLiving).boundary = knownFixtureValue(
  repeatedExtremeRing,
  929,
);

export const canonicalGeometryEvaluationCases = deepFreeze([
  geometryCase(
    "c4-geo-001-missing-references",
    "Missing host, target, and level references.",
    missingReferences,
    [
      finding("HOST_WALL_REFERENCE_MISSING", "error", [ids.openingDoorGround]),
      finding("TARGET_ELEMENT_REFERENCE_MISSING", "error", [ids.finishGroundFloor]),
      finding("LEVEL_REFERENCE_MISSING", "error", [ids.fixedKitchenCabinet]),
      finding("LEVEL_REFERENCE_MISSING", "error", [ids.furnishingSofa]),
      finding("LEVEL_REFERENCE_MISSING", "error", [ids.lightGround]),
      finding("LEVEL_REFERENCE_MISSING", "error", [ids.cameraGround]),
    ],
  ),
  geometryCase(
    "c4-geo-002-degenerate-polygons",
    "Collinear room and floor-surface polygons.",
    degeneratePolygons,
    [
      finding(
        "SPACE_POLYGON_DEGENERATE",
        "error",
        [ids.spaceLiving],
        located(ids.levelGround, 0, 0),
      ),
      finding(
        "SURFACE_POLYGON_DEGENERATE",
        "error",
        [ids.surfaceGroundFloor],
        located(ids.levelGround, 0, 0),
      ),
    ],
  ),
  geometryCase(
    "c4-geo-003-self-intersecting-polygons",
    "Self-intersecting room and floor-surface polygons.",
    selfIntersectingPolygons,
    [
      finding(
        "SPACE_POLYGON_SELF_INTERSECTS",
        "error",
        [ids.spaceLiving],
        located(ids.levelGround, 2_500, 2_500),
      ),
      finding(
        "SURFACE_POLYGON_SELF_INTERSECTS",
        "error",
        [ids.surfaceGroundFloor],
        located(ids.levelGround, 2_500, 2_500),
      ),
    ],
  ),
  geometryCase(
    "c4-geo-004-zero-repeated-wall",
    "Zero-length and repeated segments in one wall path.",
    zeroRepeatedWallSegments,
    [
      finding(
        "WALL_PATH_SEGMENT_REPEATED",
        "error",
        [ids.wallGroundSouthLiving],
        located(ids.levelGround, 0, 0),
      ),
      finding(
        "WALL_PATH_ZERO_LENGTH",
        "error",
        [ids.wallGroundSouthLiving],
        located(ids.levelGround, 0, 0),
      ),
    ],
  ),
  geometryCase(
    "c4-geo-005-self-intersecting-wall",
    "A self-intersecting multi-segment wall path.",
    selfIntersectingWall,
    [
      finding(
        "WALL_PATH_SELF_INTERSECTS",
        "error",
        [ids.wallGroundSouthLiving],
        located(ids.levelGround, 2_500, 2_500),
      ),
    ],
  ),
  geometryCase(
    "c4-geo-006-invalid-openings",
    "Overlapping, out-of-host, and vertically invalid openings.",
    invalidOpenings,
    [
      finding(
        "OPENING_OUTSIDE_HOST",
        "error",
        [ids.openingDoorGround],
        located(ids.levelGround, 5_000, 6_000),
      ),
      finding(
        "OPENINGS_OVERLAP",
        "error",
        [ids.openingWindowGroundLiving, canonicalFixtureIds.adversarialElements.openingOverlap],
        located(ids.levelGround, 2_000, 0),
      ),
      finding(
        "OPENING_VERTICAL_EXTENT_INVALID",
        "error",
        [canonicalFixtureIds.adversarialElements.openingOverlap],
        located(ids.levelGround, 2_000, 0),
      ),
    ],
  ),
  geometryCase(
    "c4-geo-007-room-boundaries",
    "Disconnected wall topology and boundaries inconsistent with wall endpoints.",
    inconsistentRoomBoundaries,
    [
      finding(
        "ROOM_BOUNDARY_DISCONNECTED",
        "error",
        [ids.spaceLiving],
        located(ids.levelGround, 0, 0),
      ),
      finding(
        "ROOM_BOUNDARY_INCONSISTENT",
        "error",
        [ids.spaceLiving],
        located(ids.levelGround, 0, 0),
      ),
      finding(
        "ROOM_BOUNDARY_INCONSISTENT",
        "error",
        [ids.spaceKitchen],
        located(ids.levelGround, 5_000, 0),
      ),
    ],
  ),
  geometryCase(
    "c4-geo-008-stair-missing-level",
    "A stair points to a missing destination level.",
    stairMissingLevel,
    [finding("STAIR_LEVEL_REFERENCE_MISSING", "error", [ids.stairMain])],
  ),
  geometryCase(
    "c4-geo-009-stair-identical-levels",
    "A stair starts and ends on the same level.",
    stairIdenticalLevels,
    [
      finding("STAIR_LEVELS_IDENTICAL", "error", [ids.stairMain]),
      finding(
        "STAIR_ELEVATION_MISMATCH",
        "error",
        [ids.stairMain],
        located(ids.levelGround, 4_200, 5_000),
      ),
    ],
  ),
  geometryCase(
    "c4-geo-010-stair-relationship",
    "A stair has an implausible rise/run relationship and total rise.",
    stairInvalidRelationship,
    [
      finding(
        "STAIR_RISE_RUN_RELATION_INVALID",
        "error",
        [ids.stairMain],
        located(ids.levelGround, 4_200, 1_000),
      ),
      finding(
        "STAIR_ELEVATION_MISMATCH",
        "error",
        [ids.stairMain],
        located(ids.levelGround, 4_200, 5_000),
      ),
    ],
  ),
  geometryCase(
    "c4-geo-011-stair-elevation",
    "Stair rise times count does not reach the destination elevation.",
    stairElevationMismatch,
    [
      finding(
        "STAIR_ELEVATION_MISMATCH",
        "error",
        [ids.stairMain],
        located(ids.levelGround, 4_200, 5_000),
      ),
    ],
  ),
  geometryCase(
    "c4-geo-012-unknown-wall-dimensions",
    "Wall height and thickness remain explicitly unknown.",
    unknownWallDimensions,
    [
      finding(
        "WALL_HEIGHT_UNKNOWN",
        "warning",
        [ids.wallGroundPartition],
        located(ids.levelGround, 5_000, 0),
      ),
      finding(
        "WALL_THICKNESS_UNKNOWN",
        "information",
        [ids.wallGroundPartition],
        located(ids.levelGround, 5_000, 0),
      ),
    ],
    false,
  ),
  geometryCase(
    "c4-geo-013-unsafe-arithmetic",
    "A schema-valid repeated extreme ring exceeds safe integer accumulation.",
    unsafeArithmetic,
    [
      finding(
        "ARITHMETIC_RANGE_UNSAFE",
        "error",
        [ids.spaceLiving],
        located(ids.levelGround, -10_000_000, -10_000_000),
      ),
    ],
  ),
]);

const duplicateElementId = mutableSnapshot();
requiredElement(duplicateElementId.elements.cameras, ids.cameraGround).id = ids.levelGround;

const coordinateOverflow = mutableSnapshot();
requiredElement(coordinateOverflow.elements.cameras, ids.cameraGround).position = knownFixtureValue(
  { xMm: 10_000_001, yMm: 0, zMm: 1_600 },
  950,
);

const dimensionOverflow = mutableSnapshot();
requiredElement(dimensionOverflow.elements.walls, ids.wallGroundWest).heightMm = knownFixtureValue(
  1_000_001,
  951,
);

const nonFiniteInput = mutableSnapshot();
requiredElement(nonFiniteInput.elements.cameras, ids.cameraGround).verticalFovMilliDegrees =
  knownFixtureValue(Number.NaN, 952);

const missingProfileDerivation = mutableSnapshot();
missingProfileDerivation.profile = "proposed";

const existingWithDerivation = mutableSnapshot();
existingWithDerivation.derivedFromSnapshotSha256 = "a".repeat(64);

export const canonicalSchemaEvaluationCases: readonly CanonicalSchemaEvaluationCase[] = deepFreeze([
  {
    description: "An element ID is duplicated across level and camera collections.",
    expectedIssues: [{ code: "ELEMENT_ID_DUPLICATE", pathIncludes: "elements", severity: "error" }],
    fixtureId: "c4-schema-001-duplicate-element-id",
    input: duplicateElementId,
  },
  {
    description: "A local coordinate exceeds the frozen 10,000,000 mm range.",
    expectedIssues: [
      { code: "COORDINATE_RANGE_EXCEEDED", pathIncludes: "position", severity: "error" },
    ],
    fixtureId: "c4-schema-002-coordinate-overflow",
    input: coordinateOverflow,
  },
  {
    description: "A dimension exceeds the frozen 1,000,000 mm range.",
    expectedIssues: [
      { code: "DIMENSION_RANGE_EXCEEDED", pathIncludes: "heightMm", severity: "error" },
    ],
    fixtureId: "c4-schema-003-dimension-overflow",
    input: dimensionOverflow,
  },
  {
    description: "A derived numeric input is non-finite and outside I-JSON.",
    expectedIssues: [
      { code: "NON_FINITE_NUMBER", pathIncludes: "verticalFovMilliDegrees", severity: "error" },
    ],
    fixtureId: "c4-schema-004-non-finite",
    input: nonFiniteInput,
  },
  {
    description: "A proposed profile omits its source snapshot hash.",
    expectedIssues: [
      {
        code: "PROFILE_DERIVATION_MISSING",
        pathIncludes: "derivedFromSnapshotSha256",
        severity: "error",
      },
    ],
    fixtureId: "c4-schema-005-proposed-derivation-missing",
    input: missingProfileDerivation,
  },
  {
    description: "An existing profile incorrectly claims derivation.",
    expectedIssues: [
      {
        code: "EXISTING_DERIVATION_FORBIDDEN",
        pathIncludes: "derivedFromSnapshotSha256",
        severity: "error",
      },
    ],
    fixtureId: "c4-schema-006-existing-derivation-forbidden",
    input: existingWithDerivation,
  },
]);

export const producerGeometryIntegrationContract = deepFreeze({
  actualFindingShape: ["affectedElementIds", "code", "location", "message", "severity"],
  comparison: "exact-code-severity-location-and-affected-id-set",
  fixtureIds: canonicalGeometryEvaluationCases.map((testCase) => testCase.fixtureId),
  requiredExport: "validateCanonicalGeometry",
  requiredPackage: "@interior-design/geometry-kernel",
  resultOrdering: "code, affectedElementIds, levelId, xMm, yMm",
  skippedByDefaultReason:
    "C4-L4 cannot change or require an unfinished producer lane; integration is explicitly opt-in.",
});
