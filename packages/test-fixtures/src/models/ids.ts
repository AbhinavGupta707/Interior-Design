const fixtureUuid = (namespace: string, sequence: number): string =>
  `${namespace}-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;

export const fixtureClaimId = (sequence: number): string => fixtureUuid("c4000000", sequence);
export const fixtureEvidenceId = (sequence: number): string => fixtureUuid("e4000000", sequence);

/**
 * Opaque, deterministic identifiers reserved for the C4 synthetic evaluation pack.
 * They identify no customer, address, provider record, or real property.
 */
export const canonicalFixtureIds = Object.freeze({
  actor: fixtureUuid("14000000", 1),
  adversarialElements: Object.freeze({
    openingOverlap: fixtureUuid("a4000000", 100),
  }),
  evidence: Object.freeze({
    authoredPlan: fixtureEvidenceId(1),
    syntheticBrief: fixtureEvidenceId(2),
  }),
  elements: Object.freeze({
    cameraGround: fixtureUuid("a4000000", 74),
    finishGroundFloor: fixtureUuid("a4000000", 72),
    fixedKitchenCabinet: fixtureUuid("a4000000", 70),
    furnishingSofa: fixtureUuid("a4000000", 71),
    levelFirst: fixtureUuid("a4000000", 2),
    levelGround: fixtureUuid("a4000000", 1),
    lightGround: fixtureUuid("a4000000", 73),
    openingDoorFirst: fixtureUuid("a4000000", 53),
    openingDoorGround: fixtureUuid("a4000000", 50),
    openingWindowFirst: fixtureUuid("a4000000", 54),
    openingWindowGroundKitchen: fixtureUuid("a4000000", 52),
    openingWindowGroundLiving: fixtureUuid("a4000000", 51),
    spaceBedroom: fixtureUuid("a4000000", 12),
    spaceKitchen: fixtureUuid("a4000000", 11),
    spaceLanding: fixtureUuid("a4000000", 13),
    spaceLiving: fixtureUuid("a4000000", 10),
    stairMain: fixtureUuid("a4000000", 60),
    surfaceFirstCeiling: fixtureUuid("a4000000", 23),
    surfaceFirstFloor: fixtureUuid("a4000000", 22),
    surfaceGroundCeiling: fixtureUuid("a4000000", 21),
    surfaceGroundFloor: fixtureUuid("a4000000", 20),
    wallFirstEast: fixtureUuid("a4000000", 41),
    wallFirstNorthBedroom: fixtureUuid("a4000000", 39),
    wallFirstNorthLanding: fixtureUuid("a4000000", 42),
    wallFirstPartition: fixtureUuid("a4000000", 40),
    wallFirstSouthBedroom: fixtureUuid("a4000000", 37),
    wallFirstSouthLanding: fixtureUuid("a4000000", 43),
    wallFirstWest: fixtureUuid("a4000000", 38),
    wallGroundEast: fixtureUuid("a4000000", 35),
    wallGroundNorthKitchen: fixtureUuid("a4000000", 36),
    wallGroundNorthLiving: fixtureUuid("a4000000", 32),
    wallGroundPartition: fixtureUuid("a4000000", 33),
    wallGroundSouthKitchen: fixtureUuid("a4000000", 34),
    wallGroundSouthLiving: fixtureUuid("a4000000", 30),
    wallGroundWest: fixtureUuid("a4000000", 31),
  }),
  missing: Object.freeze({
    hostWall: fixtureUuid("a4000000", 901),
    level: fixtureUuid("a4000000", 900),
    target: fixtureUuid("a4000000", 902),
  }),
  model: fixtureUuid("b4000000", 1),
  project: fixtureUuid("d4000000", 1),
  property: fixtureUuid("f4000000", 1),
});
