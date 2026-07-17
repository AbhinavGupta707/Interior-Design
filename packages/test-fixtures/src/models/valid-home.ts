import { c4SchemaVersion, type CanonicalHomeSnapshot } from "@interior-design/contracts";

import { assertedFixtureValue, knownFixtureValue, sourceAttribution } from "./attribution.js";
import { deepFreeze } from "./freeze.js";
import { canonicalFixtureIds } from "./ids.js";

type Point2 = { xMm: number; yMm: number };
type Point3 = Point2 & { zMm: number };

let claimSequence = 1;
const nextClaim = (): number => claimSequence++;
const known = <T>(value: T) => knownFixtureValue(value, nextClaim());
const origin = () => sourceAttribution(nextClaim());

const point3 = (xMm: number, yMm: number, zMm: number): Point3 => ({ xMm, yMm, zMm });

const level = (id: string, name: string, elevationMm: number, storeyHeightMm: number) => ({
  elementType: "level" as const,
  elevationMm: known(elevationMm),
  id,
  name: known(name),
  origin: origin(),
  storeyHeightMm: known(storeyHeightMm),
});

const wall = (id: string, levelId: string, name: string, path: readonly Point2[]) => ({
  alignment: "centre" as const,
  baseOffsetMm: known(0),
  elementType: "wall" as const,
  heightMm: known(levelId === canonicalFixtureIds.elements.levelFirst ? 2_600 : 2_800),
  id,
  levelId,
  name: known(name),
  origin: origin(),
  path: known([...path]),
  thicknessMm: known(180),
});

const space = (
  id: string,
  levelId: string,
  name: string,
  classification: string,
  boundary: readonly Point2[],
  boundedByElementIds: readonly string[],
) => ({
  boundary: known([...boundary]),
  boundedByElementIds: [...boundedByElementIds],
  classification: known(classification),
  elementType: "space" as const,
  id,
  levelId,
  name: known(name),
  origin: origin(),
});

const surface = (
  id: string,
  levelId: string,
  name: string,
  kind: "ceiling" | "floor",
  boundary: readonly Point3[],
) => ({
  boundary: known([...boundary]),
  elementType: "surface" as const,
  id,
  kind,
  levelId,
  name: known(name),
  origin: origin(),
});

const opening = (
  id: string,
  hostWallId: string,
  name: string,
  kind: "door" | "window",
  offsetAlongHostMm: number,
  widthMm: number,
  heightMm: number,
  sillHeightMm: number,
) => ({
  elementType: "opening" as const,
  heightMm: known(heightMm),
  hostWallId,
  id,
  kind,
  name: known(name),
  offsetAlongHostMm: known(offsetAlongHostMm),
  origin: origin(),
  sillHeightMm: known(sillHeightMm),
  swing: known(kind === "door" ? ("left" as const) : ("none" as const)),
  widthMm: known(widthMm),
});

const ids = canonicalFixtureIds.elements;

const groundLivingBoundary = [
  { xMm: 0, yMm: 0 },
  { xMm: 5_000, yMm: 0 },
  { xMm: 5_000, yMm: 6_000 },
  { xMm: 0, yMm: 6_000 },
];
const groundKitchenBoundary = [
  { xMm: 5_000, yMm: 0 },
  { xMm: 8_000, yMm: 0 },
  { xMm: 8_000, yMm: 6_000 },
  { xMm: 5_000, yMm: 6_000 },
];
const firstBedroomBoundary = [
  { xMm: 0, yMm: 0 },
  { xMm: 5_500, yMm: 0 },
  { xMm: 5_500, yMm: 6_000 },
  { xMm: 0, yMm: 6_000 },
];
const firstLandingBoundary = [
  { xMm: 5_500, yMm: 0 },
  { xMm: 8_000, yMm: 0 },
  { xMm: 8_000, yMm: 6_000 },
  { xMm: 5_500, yMm: 6_000 },
];

const existingSnapshotValue: CanonicalHomeSnapshot = {
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
        id: ids.cameraGround,
        levelId: ids.levelGround,
        name: known("Synthetic living-room camera"),
        origin: origin(),
        position: known(point3(2_000, 2_000, 1_600)),
        target: known(point3(4_000, 3_000, 1_400)),
        verticalFovMilliDegrees: known(60_000),
      },
    ],
    finishes: [
      {
        elementType: "finish",
        face: "top",
        id: ids.finishGroundFloor,
        material: known("Generic synthetic timber finish"),
        name: known("Synthetic ground-floor finish"),
        origin: origin(),
        targetElementId: ids.surfaceGroundFloor,
      },
    ],
    fixedObjects: [
      {
        category: known("generic synthetic cabinet"),
        dimensions: known({ depthMm: 600, heightMm: 900, widthMm: 1_800 }),
        elementType: "fixed-object",
        id: ids.fixedKitchenCabinet,
        levelId: ids.levelGround,
        name: known("Synthetic fixed cabinet"),
        origin: origin(),
        placement: {
          position: known(point3(6_800, 5_300, 0)),
          rotationMilliDegrees: known(0),
        },
      },
    ],
    furnishings: [
      {
        category: known("generic synthetic sofa"),
        dimensions: known({ depthMm: 900, heightMm: 850, widthMm: 2_000 }),
        elementType: "furnishing",
        id: ids.furnishingSofa,
        levelId: ids.levelGround,
        name: known("Synthetic loose sofa"),
        origin: origin(),
        placement: {
          position: known(point3(1_500, 4_500, 0)),
          rotationMilliDegrees: known(90_000),
        },
      },
    ],
    levels: [
      level(ids.levelFirst, "Synthetic first level", 2_800, 2_600),
      level(ids.levelGround, "Synthetic ground level", 0, 2_800),
    ],
    lights: [
      {
        colourTemperatureKelvin: known(3_000),
        elementType: "light",
        id: ids.lightGround,
        kind: "point",
        levelId: ids.levelGround,
        luminousFluxLumens: known(800),
        name: known("Synthetic pendant light"),
        origin: origin(),
        position: known(point3(2_500, 3_000, 2_400)),
      },
    ],
    openings: [
      opening(
        ids.openingWindowGroundKitchen,
        ids.wallGroundEast,
        "Synthetic kitchen window",
        "window",
        2_000,
        1_400,
        1_200,
        900,
      ),
      opening(
        ids.openingDoorGround,
        ids.wallGroundPartition,
        "Synthetic ground door",
        "door",
        1_200,
        900,
        2_100,
        0,
      ),
      opening(
        ids.openingWindowFirst,
        ids.wallFirstSouthBedroom,
        "Synthetic first-level window",
        "window",
        2_000,
        1_500,
        1_200,
        900,
      ),
      opening(
        ids.openingWindowGroundLiving,
        ids.wallGroundSouthLiving,
        "Synthetic living window",
        "window",
        1_400,
        1_600,
        1_200,
        900,
      ),
      opening(
        ids.openingDoorFirst,
        ids.wallFirstPartition,
        "Synthetic first-level door",
        "door",
        2_000,
        900,
        2_100,
        0,
      ),
    ],
    spaces: [
      space(
        ids.spaceKitchen,
        ids.levelGround,
        "Synthetic kitchen",
        "kitchen",
        groundKitchenBoundary,
        [
          ids.wallGroundNorthKitchen,
          ids.wallGroundPartition,
          ids.wallGroundEast,
          ids.wallGroundSouthKitchen,
        ],
      ),
      space(
        ids.spaceBedroom,
        ids.levelFirst,
        "Synthetic bedroom",
        "bedroom",
        firstBedroomBoundary,
        [
          ids.wallFirstPartition,
          ids.wallFirstSouthBedroom,
          ids.wallFirstWest,
          ids.wallFirstNorthBedroom,
        ],
      ),
      space(
        ids.spaceLiving,
        ids.levelGround,
        "Synthetic living room",
        "living-room",
        groundLivingBoundary,
        [
          ids.wallGroundPartition,
          ids.wallGroundWest,
          ids.wallGroundSouthLiving,
          ids.wallGroundNorthLiving,
        ],
      ),
      space(
        ids.spaceLanding,
        ids.levelFirst,
        "Synthetic landing",
        "landing",
        firstLandingBoundary,
        [
          ids.wallFirstNorthLanding,
          ids.wallFirstEast,
          ids.wallFirstPartition,
          ids.wallFirstSouthLanding,
        ],
      ),
    ],
    stairs: [
      {
        elementType: "stair",
        fromLevelId: ids.levelGround,
        id: ids.stairMain,
        name: known("Synthetic straight stair"),
        origin: origin(),
        path: known([
          { xMm: 4_200, yMm: 1_000 },
          { xMm: 4_200, yMm: 4_750 },
        ]),
        riseMm: known(175),
        runMm: known(250),
        stepCount: known(16),
        toLevelId: ids.levelFirst,
        widthMm: known(900),
      },
    ],
    surfaces: [
      surface(ids.surfaceFirstCeiling, ids.levelFirst, "Synthetic first ceiling", "ceiling", [
        point3(0, 0, 5_400),
        point3(8_000, 0, 5_400),
        point3(8_000, 6_000, 5_400),
        point3(0, 6_000, 5_400),
      ]),
      surface(ids.surfaceGroundFloor, ids.levelGround, "Synthetic ground floor", "floor", [
        point3(0, 0, 0),
        point3(8_000, 0, 0),
        point3(8_000, 6_000, 0),
        point3(0, 6_000, 0),
      ]),
      surface(ids.surfaceFirstFloor, ids.levelFirst, "Synthetic first floor", "floor", [
        point3(0, 0, 2_800),
        point3(8_000, 0, 2_800),
        point3(8_000, 6_000, 2_800),
        point3(0, 6_000, 2_800),
      ]),
      surface(ids.surfaceGroundCeiling, ids.levelGround, "Synthetic ground ceiling", "ceiling", [
        point3(0, 0, 2_800),
        point3(8_000, 0, 2_800),
        point3(8_000, 6_000, 2_800),
        point3(0, 6_000, 2_800),
      ]),
    ],
    walls: [
      wall(ids.wallGroundPartition, ids.levelGround, "Synthetic ground partition", [
        { xMm: 5_000, yMm: 0 },
        { xMm: 5_000, yMm: 6_000 },
      ]),
      wall(ids.wallGroundSouthLiving, ids.levelGround, "Synthetic living south wall", [
        { xMm: 0, yMm: 0 },
        { xMm: 5_000, yMm: 0 },
      ]),
      wall(ids.wallGroundNorthLiving, ids.levelGround, "Synthetic living north wall", [
        { xMm: 5_000, yMm: 6_000 },
        { xMm: 0, yMm: 6_000 },
      ]),
      wall(ids.wallGroundWest, ids.levelGround, "Synthetic ground west wall", [
        { xMm: 0, yMm: 6_000 },
        { xMm: 0, yMm: 0 },
      ]),
      wall(ids.wallGroundEast, ids.levelGround, "Synthetic ground east wall", [
        { xMm: 8_000, yMm: 0 },
        { xMm: 8_000, yMm: 6_000 },
      ]),
      wall(ids.wallGroundSouthKitchen, ids.levelGround, "Synthetic kitchen south wall", [
        { xMm: 5_000, yMm: 0 },
        { xMm: 8_000, yMm: 0 },
      ]),
      wall(ids.wallGroundNorthKitchen, ids.levelGround, "Synthetic kitchen north wall", [
        { xMm: 8_000, yMm: 6_000 },
        { xMm: 5_000, yMm: 6_000 },
      ]),
      wall(ids.wallFirstPartition, ids.levelFirst, "Synthetic first partition", [
        { xMm: 5_500, yMm: 0 },
        { xMm: 5_500, yMm: 6_000 },
      ]),
      wall(ids.wallFirstNorthBedroom, ids.levelFirst, "Synthetic bedroom north wall", [
        { xMm: 5_500, yMm: 6_000 },
        { xMm: 0, yMm: 6_000 },
      ]),
      wall(ids.wallFirstSouthBedroom, ids.levelFirst, "Synthetic bedroom south wall", [
        { xMm: 0, yMm: 0 },
        { xMm: 5_500, yMm: 0 },
      ]),
      wall(ids.wallFirstEast, ids.levelFirst, "Synthetic first east wall", [
        { xMm: 8_000, yMm: 0 },
        { xMm: 8_000, yMm: 6_000 },
      ]),
      wall(ids.wallFirstWest, ids.levelFirst, "Synthetic first west wall", [
        { xMm: 0, yMm: 6_000 },
        { xMm: 0, yMm: 0 },
      ]),
      wall(ids.wallFirstNorthLanding, ids.levelFirst, "Synthetic landing north wall", [
        { xMm: 8_000, yMm: 6_000 },
        { xMm: 5_500, yMm: 6_000 },
      ]),
      wall(ids.wallFirstSouthLanding, ids.levelFirst, "Synthetic landing south wall", [
        { xMm: 5_500, yMm: 0 },
        { xMm: 8_000, yMm: 0 },
      ]),
    ],
  },
  knownLimitations: [
    {
      code: "SYNTHETIC_EVALUATION_ONLY",
      detail: "This deterministic fixture represents no address, customer, or real property.",
    },
    {
      code: "STRUCTURAL_STATUS_UNKNOWN",
      detail: "No wall has an established structural role; specialist review would be required.",
    },
    {
      code: "NOT_SURVEY_OR_AS_BUILT_TRUTH",
      detail:
        "Fixture geometry exercises software contracts and is not survey or as-built evidence.",
    },
  ],
  modelId: canonicalFixtureIds.model,
  profile: "existing",
  projectId: canonicalFixtureIds.project,
  propertyId: canonicalFixtureIds.property,
  schemaVersion: c4SchemaVersion,
};

export const existingHomeSnapshot = deepFreeze(existingSnapshotValue) as CanonicalHomeSnapshot;

const proposedSnapshotValue = structuredClone(existingSnapshotValue);
proposedSnapshotValue.profile = "proposed";
proposedSnapshotValue.derivedFromSnapshotSha256 =
  "587ebdfa03235b2dbf0346e7558398636057e735a014fdb9ca08d696ad4dda6f";
proposedSnapshotValue.knownLimitations.push({
  code: "PROPOSED_PROFILE_NOT_ISSUED",
  detail:
    "The proposed profile is an editable synthetic option and has no professional issue status.",
});
const proposedSofa = proposedSnapshotValue.elements.furnishings.find(
  (furnishing) => furnishing.id === ids.furnishingSofa,
);
if (proposedSofa === undefined) {
  throw new Error("C4 fixture construction lost the synthetic sofa.");
}
proposedSofa.placement.position = assertedFixtureValue(point3(2_200, 4_000, 0), 900);
proposedSofa.placement.rotationMilliDegrees = assertedFixtureValue(0, 901);

export const proposedHomeSnapshot = deepFreeze(proposedSnapshotValue) as CanonicalHomeSnapshot;

const asBuiltSnapshotValue = structuredClone(proposedSnapshotValue);
asBuiltSnapshotValue.profile = "as-built";
asBuiltSnapshotValue.derivedFromSnapshotSha256 =
  "c13a92cbc6312dd08ab9dca4f2cd4dea82bdeedc9b5ab50171e7bb1ff69004b1";
asBuiltSnapshotValue.knownLimitations = asBuiltSnapshotValue.knownLimitations.filter(
  (limitation) => limitation.code !== "PROPOSED_PROFILE_NOT_ISSUED",
);
asBuiltSnapshotValue.knownLimitations.push({
  code: "AS_BUILT_STATUS_UNCONFIRMED",
  detail:
    "This state-separation fixture has no observation establishing installed or as-built truth.",
});
const asBuiltSofa = asBuiltSnapshotValue.elements.furnishings.find(
  (furnishing) => furnishing.id === ids.furnishingSofa,
);
if (asBuiltSofa === undefined) {
  throw new Error("C4 fixture construction lost the synthetic sofa.");
}
asBuiltSofa.placement.position = assertedFixtureValue(point3(2_250, 4_050, 0), 902);

export const asBuiltHomeSnapshot = deepFreeze(asBuiltSnapshotValue) as CanonicalHomeSnapshot;

export const canonicalProfileFixtures = deepFreeze({
  "as-built": asBuiltHomeSnapshot,
  existing: existingHomeSnapshot,
  proposed: proposedHomeSnapshot,
});

export const preservedUnknownFactCodes = Object.freeze(["STRUCTURAL_STATUS_UNKNOWN"] as const);
