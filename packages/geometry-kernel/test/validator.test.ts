import type { CanonicalHomeSnapshot } from "@interior-design/contracts";
import { describe, expect, it } from "vitest";

import { geometryFindingCodes as codes, validateCanonicalGeometry } from "../src/index.js";
import { elementId, ids, known, parseSnapshot, unknown, validSnapshot } from "./fixtures.js";

function findingCodes(snapshot: CanonicalHomeSnapshot): ReadonlySet<string> {
  return new Set(validateCanonicalGeometry(snapshot).map((finding) => finding.code));
}

function required<TValue>(value: TValue | undefined): TValue {
  if (value === undefined) throw new Error("Expected synthetic fixture value to be present.");
  return value;
}

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  Object.freeze(value);
}

function largeSimplePolygon(): { xMm: number; yMm: number }[] {
  const points: { xMm: number; yMm: number }[] = [];
  for (let index = 0; index < 256; index += 1) {
    points.push({ xMm: index * 10, yMm: 0 });
  }
  for (let index = 255; index >= 0; index -= 1) {
    points.push({ xMm: index * 10, yMm: 1_000 });
  }
  return points;
}

describe("validateCanonicalGeometry", () => {
  it("accepts a schema-valid synthetic multi-level home with stairs and an opening", () => {
    const snapshot = validSnapshot();

    expect(validateCanonicalGeometry(snapshot)).toEqual([]);
  });

  it("finds degenerate, self-intersecting and inconsistent room geometry", () => {
    const snapshot = validSnapshot();
    required(snapshot.elements.spaces[0]).boundary = known([
      { xMm: 0, yMm: 0 },
      { xMm: 5_000, yMm: 4_000 },
      { xMm: 0, yMm: 4_000 },
      { xMm: 5_000, yMm: 0 },
    ]);
    required(snapshot.elements.spaces[0]).boundedByElementIds = [ids.wallSouth, ids.wallNorth];
    required(snapshot.elements.walls[0]).path = known([
      { xMm: 0, yMm: 0 },
      { xMm: 5_000, yMm: 4_000 },
      { xMm: 0, yMm: 4_000 },
      { xMm: 5_000, yMm: 0 },
    ]);
    required(snapshot.elements.surfaces[0]).boundary = known([
      { xMm: 0, yMm: 0, zMm: 0 },
      { xMm: 5_000, yMm: 4_000, zMm: 0 },
      { xMm: 0, yMm: 4_000, zMm: 100 },
      { xMm: 5_000, yMm: 0, zMm: 0 },
    ]);

    const found = findingCodes(parseSnapshot(snapshot));

    for (const expected of [
      codes.roomBoundaryDisconnected,
      codes.roomBoundaryNotClosed,
      codes.spacePolygonDegenerate,
      codes.spacePolygonSelfIntersection,
      codes.surfacePolygonNonPlanar,
      codes.surfacePolygonSelfIntersection,
      codes.wallPathSelfIntersection,
    ]) {
      expect(found.has(expected), `missing ${expected}`).toBe(true);
    }
  });

  it("detects openings outside and above their host and overlapping intervals", () => {
    const snapshot = validSnapshot();
    const first = required(snapshot.elements.openings[0]);
    first.offsetAlongHostMm = known(4_500);
    first.widthMm = known(900);
    first.sillHeightMm = known(-100);
    first.heightMm = known(3_000);
    const second = structuredClone(first);
    second.id = elementId(1);
    second.offsetAlongHostMm = known(4_600);
    second.widthMm = known(300);
    second.sillHeightMm = known(0);
    second.heightMm = known(2_000);
    snapshot.elements.openings.push(second);

    const found = findingCodes(parseSnapshot(snapshot));

    expect(found.has(codes.openingOutsideHostExtent)).toBe(true);
    expect(found.has(codes.openingOverlap)).toBe(true);
    expect(found.has(codes.openingBelowHostBase)).toBe(true);
    expect(found.has(codes.openingAboveHostHeight)).toBe(true);
  });

  it("keeps irrational host and stair path comparisons explicit", () => {
    const snapshot = validSnapshot();
    required(snapshot.elements.walls[0]).path = known([
      { xMm: 0, yMm: 0 },
      { xMm: 1, yMm: 1 },
    ]);
    required(snapshot.elements.openings[0]).offsetAlongHostMm = known(1);
    required(snapshot.elements.openings[0]).widthMm = known(1);
    const stair = required(snapshot.elements.stairs[0]);
    stair.path = known([
      { xMm: 0, yMm: 0 },
      { xMm: 1, yMm: 1 },
      { xMm: 2, yMm: 2 },
      { xMm: 3, yMm: 3 },
      { xMm: 4, yMm: 4 },
    ]);
    stair.riseMm = known(1_000);
    stair.runMm = known(3);
    stair.stepCount = known(3);

    const found = findingCodes(parseSnapshot(snapshot));

    expect(found.has(codes.openingHostExtentIndeterminate)).toBe(true);
    expect(found.has(codes.stairRunPathIndeterminate)).toBe(true);
  });

  it("detects stair level, rise, run, count and path defects", () => {
    const mismatch = validSnapshot();
    required(mismatch.elements.stairs[0]).riseMm = known(199);
    required(mismatch.elements.stairs[0]).runMm = known(251);
    required(mismatch.elements.stairs[0]).path = known([
      { xMm: 0, yMm: 0 },
      { xMm: 2_000, yMm: 2_000 },
      { xMm: 0, yMm: 2_000 },
      { xMm: 2_000, yMm: 0 },
    ]);
    const mismatchCodes = findingCodes(parseSnapshot(mismatch));
    expect(mismatchCodes.has(codes.stairRiseLevelMismatch)).toBe(true);
    expect(mismatchCodes.has(codes.stairRunPathMismatch)).toBe(true);
    expect(mismatchCodes.has(codes.stairPathSelfIntersection)).toBe(true);

    const identical = validSnapshot();
    required(identical.elements.stairs[0]).toLevelId = ids.ground;
    required(identical.elements.stairs[0]).stepCount = known(0);
    const identicalCodes = findingCodes(parseSnapshot(identical));
    expect(identicalCodes.has(codes.stairLevelsIdentical)).toBe(true);
    expect(identicalCodes.has(codes.stairStepCountInvalid)).toBe(true);
  });

  it("reports missing and wrong-type level, host, room and finish targets", () => {
    const snapshot = validSnapshot();
    const missing = elementId(90);
    required(snapshot.elements.walls[0]).levelId = missing;
    required(snapshot.elements.fixedObjects[0]).levelId = missing;
    required(snapshot.elements.furnishings[0]).levelId = ids.surface;
    required(snapshot.elements.lights[0]).levelId = missing;
    required(snapshot.elements.cameras[0]).levelId = missing;
    const openingWithInvalidHost = required(snapshot.elements.openings[0]);
    openingWithInvalidHost.hostWallId = ids.space;
    const openingWithMissingHost = structuredClone(openingWithInvalidHost);
    openingWithMissingHost.id = elementId(91);
    openingWithMissingHost.hostWallId = missing;
    snapshot.elements.openings.push(openingWithMissingHost);
    required(snapshot.elements.stairs[0]).toLevelId = missing;
    required(snapshot.elements.finishes[0]).targetElementId = missing;
    required(snapshot.elements.spaces[0]).boundedByElementIds.push(missing, ids.light);

    const found = findingCodes(parseSnapshot(snapshot));

    expect(found.has(codes.levelReferenceMissing)).toBe(true);
    expect(found.has(codes.levelReferenceInvalid)).toBe(true);
    expect(found.has(codes.hostWallReferenceInvalid)).toBe(true);
    expect(found.has(codes.hostWallReferenceMissing)).toBe(true);
    expect(found.has(codes.roomBoundaryReferenceMissing)).toBe(true);
    expect(found.has(codes.roomBoundaryReferenceInvalid)).toBe(true);
    expect(found.has(codes.targetReferenceMissing)).toBe(true);
  });

  it("fails closed for duplicate and invalid element IDs when runtime schema validation is bypassed", () => {
    const snapshot = validSnapshot();
    required(snapshot.elements.cameras[0]).id = "not-a-uuid";
    required(snapshot.elements.fixedObjects[0]).id = ids.space;

    const found = findingCodes(snapshot);

    expect(found.has(codes.elementIdInvalid)).toBe(true);
    expect(found.has(codes.elementIdDuplicate)).toBe(true);
  });

  it("reports referenced positions outside known level extents", () => {
    const snapshot = validSnapshot();
    required(snapshot.elements.fixedObjects[0]).placement.position = known({
      xMm: 100,
      yMm: 100,
      zMm: 9_000,
    });
    required(snapshot.elements.lights[0]).position = known({ xMm: 200, yMm: 200, zMm: -1 });
    required(snapshot.elements.cameras[0]).position = known({
      xMm: 300,
      yMm: 300,
      zMm: 3_001,
    });
    required(snapshot.elements.cameras[0]).target = known({
      xMm: 300,
      yMm: 300,
      zMm: 4_000,
    });

    const findings = validateCanonicalGeometry(parseSnapshot(snapshot));

    expect(
      findings.filter((finding) => finding.code === codes.elementPositionOutsideLevel),
    ).toHaveLength(3);
    expect(findings.some((finding) => finding.code === codes.cameraTargetOutsideLevel)).toBe(true);
  });

  it("surfaces unknown dimensions and geometry without supplying defaults", () => {
    const snapshot = validSnapshot();
    const level = required(snapshot.elements.levels[0]);
    const space = required(snapshot.elements.spaces[0]);
    const surface = required(snapshot.elements.surfaces[0]);
    const wall = required(snapshot.elements.walls[0]);
    const opening = required(snapshot.elements.openings[0]);
    const stair = required(snapshot.elements.stairs[0]);
    const fixedObject = required(snapshot.elements.fixedObjects[0]);
    const light = required(snapshot.elements.lights[0]);
    const camera = required(snapshot.elements.cameras[0]);
    level.elevationMm = unknown();
    level.storeyHeightMm = unknown();
    space.boundary = unknown();
    surface.boundary = unknown();
    wall.path = unknown();
    wall.heightMm = unknown();
    wall.thicknessMm = unknown();
    opening.widthMm = unknown();
    opening.heightMm = unknown();
    opening.offsetAlongHostMm = unknown();
    opening.sillHeightMm = unknown();
    stair.riseMm = unknown();
    stair.runMm = unknown();
    stair.stepCount = unknown();
    fixedObject.dimensions = unknown();
    fixedObject.placement.position = unknown();
    light.position = unknown();
    camera.target = unknown();
    camera.verticalFovMilliDegrees = unknown();

    const found = findingCodes(parseSnapshot(snapshot));

    for (const expected of [
      codes.levelElevationUnknown,
      codes.levelStoreyHeightUnknown,
      codes.spaceBoundaryUnknown,
      codes.surfaceBoundaryUnknown,
      codes.wallPathUnknown,
      codes.wallHeightUnknown,
      codes.wallThicknessUnknown,
      codes.openingWidthUnknown,
      codes.openingHeightUnknown,
      codes.openingOffsetUnknown,
      codes.openingSillUnknown,
      codes.openingHostExtentUnknown,
      codes.stairRiseUnknown,
      codes.stairRunUnknown,
      codes.stairStepCountUnknown,
      codes.fixedObjectDimensionsUnknown,
      codes.fixedObjectPositionUnknown,
      codes.lightPositionUnknown,
      codes.cameraTargetUnknown,
      codes.cameraFovUnknown,
    ]) {
      expect(found.has(expected), `missing ${expected}`).toBe(true);
    }
  });

  it("emits explicit range and resource findings for adversarial bounded polygons", () => {
    const rangeSnapshot = validSnapshot();
    const wound: { xMm: number; yMm: number }[] = [];
    for (let winding = 0; winding < 12; winding += 1) {
      wound.push(
        { xMm: -10_000_000, yMm: -10_000_000 },
        { xMm: 10_000_000, yMm: -10_000_000 },
        { xMm: 10_000_000, yMm: 10_000_000 },
        { xMm: -10_000_000, yMm: 10_000_000 },
      );
    }
    required(rangeSnapshot.elements.spaces[0]).boundary = known(wound);
    expect(findingCodes(parseSnapshot(rangeSnapshot)).has(codes.geometryIntegerRangeExceeded)).toBe(
      true,
    );

    const resourceSnapshot = validSnapshot();
    const template = required(resourceSnapshot.elements.spaces[0]);
    resourceSnapshot.elements.spaces = Array.from({ length: 3 }, (_, index) => ({
      ...structuredClone(template),
      boundary: known(largeSimplePolygon()),
      boundedByElementIds: [],
      id: elementId(200 + index),
    }));
    expect(
      findingCodes(parseSnapshot(resourceSnapshot)).has(codes.geometryResourceLimitExceeded),
    ).toBe(true);
  });

  it("is deterministic under collection/path reversal, frozen at runtime and non-mutating", () => {
    const snapshot = validSnapshot();
    required(snapshot.elements.spaces[0]).boundary = known([
      { xMm: 0, yMm: 0 },
      { xMm: 5_000, yMm: 4_000 },
      { xMm: 0, yMm: 4_000 },
      { xMm: 5_000, yMm: 0 },
    ]);
    required(snapshot.elements.walls[0]).path = known([
      { xMm: 0, yMm: 0 },
      { xMm: 5_000, yMm: 4_000 },
      { xMm: 0, yMm: 4_000 },
      { xMm: 5_000, yMm: 0 },
    ]);
    const reordered = structuredClone(snapshot);
    for (const collection of Object.values(reordered.elements)) {
      collection.reverse();
    }
    for (const space of reordered.elements.spaces) {
      space.boundedByElementIds.reverse();
      if (space.boundary.knowledge === "known") space.boundary.value.reverse();
    }
    for (const wall of reordered.elements.walls) {
      if (wall.path.knowledge === "known") wall.path.value.reverse();
    }
    for (const stair of reordered.elements.stairs) {
      if (stair.path.knowledge === "known") stair.path.value.reverse();
    }
    for (const surface of reordered.elements.surfaces) {
      if (surface.boundary.knowledge === "known") surface.boundary.value.reverse();
    }

    const originalJson = JSON.stringify(snapshot);
    deepFreeze(snapshot);
    const first = validateCanonicalGeometry(snapshot);
    const second = validateCanonicalGeometry(parseSnapshot(reordered));

    expect(second).toEqual(first);
    expect(JSON.stringify(snapshot)).toBe(originalJson);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.every((finding) => Object.isFrozen(finding))).toBe(true);
    expect(first.every((finding) => Object.isFrozen(finding.affectedElementIds))).toBe(true);
  });
});
