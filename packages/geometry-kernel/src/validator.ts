import type { CanonicalHomeSnapshot } from "@interior-design/contracts";

import {
  checkedAdd,
  checkedMultiply,
  checkedSubtract,
  polylineLengthBoundsMm,
  segmentsIntersect2d,
  signedDoubleArea2d,
} from "./integer.js";
import {
  geometryFindingCodes as codes,
  type GeometryFinding,
  type GeometryFindingCode,
  type GeometryLocation,
  type Point2Mm,
} from "./types.js";

type Elements = CanonicalHomeSnapshot["elements"];
type Level = Elements["levels"][number];
type Space = Elements["spaces"][number];
type Surface = Elements["surfaces"][number];
type Wall = Elements["walls"][number];
type Opening = Elements["openings"][number];
type Stair = Elements["stairs"][number];
type FixedObject = Elements["fixedObjects"][number];
type Furnishing = Elements["furnishings"][number];
type Finish = Elements["finishes"][number];
type Light = Elements["lights"][number];
type Camera = Elements["cameras"][number];
type ModelElement =
  | Camera
  | Finish
  | FixedObject
  | Furnishing
  | Level
  | Light
  | Opening
  | Space
  | Stair
  | Surface
  | Wall;
type Point3Mm = { readonly xMm: number; readonly yMm: number; readonly zMm: number };
type Attributed<TValue> =
  { readonly knowledge: "known"; readonly value: TValue } | { readonly knowledge: "unknown" };

const maximumPairwiseSegmentComparisons = 300_000;
const maximumSafeIntegerBigInt = BigInt(Number.MAX_SAFE_INTEGER);
const uuidPattern =
  /^(?:00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareNumbers(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedById<TElement extends { readonly id: string }>(
  elements: readonly TElement[],
): readonly TElement[] {
  return [...elements].sort((left, right) => compareStrings(left.id, right.id));
}

function knownValue<TValue>(attributed: Attributed<TValue>): TValue | undefined {
  return attributed.knowledge === "known" ? attributed.value : undefined;
}

function point2Key(point: Point2Mm): string {
  return `${String(point.xMm)},${String(point.yMm)}`;
}

function point3Key(point: Point3Mm): string {
  return `${String(point.xMm)},${String(point.yMm)},${String(point.zMm)}`;
}

function samePoint2(left: Point2Mm, right: Point2Mm): boolean {
  return left.xMm === right.xMm && left.yMm === right.yMm;
}

function samePoint3(left: Point3Mm, right: Point3Mm): boolean {
  return left.xMm === right.xMm && left.yMm === right.yMm && left.zMm === right.zMm;
}

function comparePoint2(left: Point2Mm, right: Point2Mm): number {
  return compareNumbers(left.xMm, right.xMm) || compareNumbers(left.yMm, right.yMm);
}

function comparePoint3(left: Point3Mm, right: Point3Mm): number {
  return (
    compareNumbers(left.xMm, right.xMm) ||
    compareNumbers(left.yMm, right.yMm) ||
    compareNumbers(left.zMm, right.zMm)
  );
}

function minimumPoint2(points: readonly Point2Mm[]): Point2Mm | undefined {
  return [...points].sort(comparePoint2)[0];
}

function minimumPoint3(points: readonly Point3Mm[]): Point3Mm | undefined {
  return [...points].sort(comparePoint3)[0];
}

interface AddFindingInput {
  readonly affectedElementIds: readonly string[];
  readonly code: GeometryFindingCode;
  readonly location?: GeometryLocation;
  readonly message: string;
  readonly severity: GeometryFinding["severity"];
}

class FindingCollector {
  readonly #findings = new Map<string, GeometryFinding>();

  add(input: AddFindingInput): void {
    const affectedElementIds = Object.freeze(
      [...new Set(input.affectedElementIds)].sort(compareStrings),
    );
    const location =
      input.location === undefined
        ? undefined
        : Object.freeze({
            levelId: input.location.levelId,
            xMm: input.location.xMm,
            yMm: input.location.yMm,
          });
    const finding: GeometryFinding = Object.freeze({
      affectedElementIds,
      code: input.code,
      ...(location === undefined ? {} : { location }),
      message: input.message,
      severity: input.severity,
    });
    const key = findingSortKey(finding);
    if (!this.#findings.has(key)) {
      this.#findings.set(key, finding);
    }
  }

  finish(): readonly GeometryFinding[] {
    return Object.freeze([...this.#findings.values()].sort(compareFindings));
  }
}

function findingSortKey(finding: GeometryFinding): string {
  const location = finding.location;
  return [
    finding.code,
    finding.affectedElementIds.join("\u0001"),
    location?.levelId ?? "",
    location === undefined ? "" : String(location.xMm).padStart(18, "0"),
    location === undefined ? "" : String(location.yMm).padStart(18, "0"),
    finding.severity,
    finding.message,
  ].join("\u0000");
}

function compareFindings(left: GeometryFinding, right: GeometryFinding): number {
  return compareStrings(findingSortKey(left), findingSortKey(right));
}

class ComparisonBudget {
  #remaining = maximumPairwiseSegmentComparisons;

  consume(comparisons: number): boolean {
    if (comparisons > this.#remaining) {
      return false;
    }
    this.#remaining -= comparisons;
    return true;
  }
}

function locationForPoint(
  levelId: string,
  point: Point2Mm | undefined,
  levelsById: ReadonlyMap<string, Level>,
): GeometryLocation | undefined {
  if (point === undefined || !levelsById.has(levelId)) {
    return undefined;
  }
  return { levelId, xMm: point.xMm, yMm: point.yMm };
}

function rangeFinding(
  collector: FindingCollector,
  elementId: string,
  location: GeometryLocation | undefined,
  message: string,
): void {
  collector.add({
    affectedElementIds: [elementId],
    code: codes.geometryIntegerRangeExceeded,
    ...(location === undefined ? {} : { location }),
    message,
    severity: "error",
  });
}

interface PathFindingCodes {
  readonly repeatedVertex: GeometryFindingCode;
  readonly selfIntersection: GeometryFindingCode;
  readonly zeroLength: GeometryFindingCode;
}

interface ValidatePathInput {
  readonly closed: boolean;
  readonly collector: FindingCollector;
  readonly elementId: string;
  readonly findingCodes: PathFindingCodes;
  readonly location: GeometryLocation | undefined;
  readonly noun: string;
  readonly points: readonly Point2Mm[];
  readonly resourceBudget: ComparisonBudget;
}

function candidateSegmentPairCount(pointCount: number, closed: boolean): number {
  const segmentCount = closed ? pointCount : Math.max(0, pointCount - 1);
  if (segmentCount < 2) {
    return 0;
  }
  const allPairs = (segmentCount * (segmentCount - 1)) / 2;
  const adjacentPairs = closed ? segmentCount : segmentCount - 1;
  return Math.max(0, allPairs - adjacentPairs);
}

function segmentsAreAdjacent(
  firstIndex: number,
  secondIndex: number,
  segmentCount: number,
  closed: boolean,
): boolean {
  return (
    secondIndex === firstIndex + 1 ||
    (closed && firstIndex === 0 && secondIndex === segmentCount - 1)
  );
}

function validatePointPath(input: ValidatePathInput): void {
  const { points } = input;
  const segmentCount = input.closed ? points.length : Math.max(0, points.length - 1);
  const zeroLengthPoints: Point2Mm[] = [];
  for (let index = 0; index < segmentCount; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    if (start !== undefined && end !== undefined && samePoint2(start, end)) {
      zeroLengthPoints.push(start);
    }
  }
  if (zeroLengthPoints.length > 0) {
    const point = minimumPoint2(zeroLengthPoints);
    input.collector.add({
      affectedElementIds: [input.elementId],
      code: input.findingCodes.zeroLength,
      ...(input.location === undefined || point === undefined
        ? {}
        : { location: { ...input.location, xMm: point.xMm, yMm: point.yMm } }),
      message: `${input.noun} contains a zero-length segment.`,
      severity: "error",
    });
  }

  const firstByKey = new Map<string, Point2Mm>();
  const repeatedPoints: Point2Mm[] = [];
  for (const point of points) {
    const key = point2Key(point);
    if (firstByKey.has(key)) {
      repeatedPoints.push(point);
    } else {
      firstByKey.set(key, point);
    }
  }
  if (repeatedPoints.length > 0) {
    const point = minimumPoint2(repeatedPoints);
    input.collector.add({
      affectedElementIds: [input.elementId],
      code: input.findingCodes.repeatedVertex,
      ...(input.location === undefined || point === undefined
        ? {}
        : { location: { ...input.location, xMm: point.xMm, yMm: point.yMm } }),
      message: `${input.noun} repeats a vertex.`,
      severity: "error",
    });
  }

  const candidatePairs = candidateSegmentPairCount(points.length, input.closed);
  if (!input.resourceBudget.consume(candidatePairs)) {
    input.collector.add({
      affectedElementIds: [input.elementId],
      code: codes.geometryResourceLimitExceeded,
      ...(input.location === undefined ? {} : { location: input.location }),
      message:
        "The deterministic segment-comparison budget was exhausted before self-intersection validation completed.",
      severity: "error",
    });
    return;
  }

  const intersectingPoints: Point2Mm[] = [];
  for (let firstIndex = 0; firstIndex < segmentCount; firstIndex += 1) {
    const firstStart = points[firstIndex];
    const firstEnd = points[(firstIndex + 1) % points.length];
    if (firstStart === undefined || firstEnd === undefined) {
      continue;
    }
    for (let secondIndex = firstIndex + 1; secondIndex < segmentCount; secondIndex += 1) {
      if (segmentsAreAdjacent(firstIndex, secondIndex, segmentCount, input.closed)) {
        continue;
      }
      const secondStart = points[secondIndex];
      const secondEnd = points[(secondIndex + 1) % points.length];
      if (secondStart === undefined || secondEnd === undefined) {
        continue;
      }
      const intersection = segmentsIntersect2d(firstStart, firstEnd, secondStart, secondEnd);
      if (!intersection.ok) {
        rangeFinding(
          input.collector,
          input.elementId,
          input.location,
          `${input.noun} intersection arithmetic exceeded the safe-integer range.`,
        );
        return;
      }
      if (intersection.value !== "none") {
        intersectingPoints.push(firstStart, firstEnd, secondStart, secondEnd);
      }
    }
  }
  if (intersectingPoints.length > 0) {
    const point = minimumPoint2(intersectingPoints);
    input.collector.add({
      affectedElementIds: [input.elementId],
      code: input.findingCodes.selfIntersection,
      ...(input.location === undefined || point === undefined
        ? {}
        : { location: { ...input.location, xMm: point.xMm, yMm: point.yMm } }),
      message: `${input.noun} self-intersects.`,
      severity: "error",
    });
  }
}

interface PolygonFindingCodes extends PathFindingCodes {
  readonly degenerate: GeometryFindingCode;
}

function validatePolygon2d(input: {
  readonly collector: FindingCollector;
  readonly elementId: string;
  readonly findingCodes: PolygonFindingCodes;
  readonly location: GeometryLocation | undefined;
  readonly noun: string;
  readonly points: readonly Point2Mm[];
  readonly resourceBudget: ComparisonBudget;
}): void {
  const area = signedDoubleArea2d(input.points);
  if (!area.ok) {
    rangeFinding(
      input.collector,
      input.elementId,
      input.location,
      `${input.noun} area arithmetic exceeded the safe-integer range.`,
    );
  } else if (area.value === 0) {
    input.collector.add({
      affectedElementIds: [input.elementId],
      code: input.findingCodes.degenerate,
      ...(input.location === undefined ? {} : { location: input.location }),
      message: `${input.noun} has zero signed area and is degenerate.`,
      severity: "error",
    });
  }
  validatePointPath({ ...input, closed: true });
}

function allModelElements(elements: Elements): readonly ModelElement[] {
  return [
    ...elements.cameras,
    ...elements.finishes,
    ...elements.fixedObjects,
    ...elements.furnishings,
    ...elements.levels,
    ...elements.lights,
    ...elements.openings,
    ...elements.spaces,
    ...elements.stairs,
    ...elements.surfaces,
    ...elements.walls,
  ].sort(
    (left, right) =>
      compareStrings(left.id, right.id) || compareStrings(left.elementType, right.elementType),
  );
}

function indexElements(
  snapshot: CanonicalHomeSnapshot,
  collector: FindingCollector,
): {
  readonly byId: ReadonlyMap<string, ModelElement>;
  readonly levelsById: ReadonlyMap<string, Level>;
} {
  const byId = new Map<string, ModelElement>();
  for (const element of allModelElements(snapshot.elements)) {
    if (!uuidPattern.test(element.id)) {
      collector.add({
        affectedElementIds: [element.id],
        code: codes.elementIdInvalid,
        message: "A canonical element ID is not a UUID.",
        severity: "error",
      });
    }
    if (byId.has(element.id)) {
      collector.add({
        affectedElementIds: [element.id],
        code: codes.elementIdDuplicate,
        message: "A canonical element ID occurs in more than one element collection.",
        severity: "error",
      });
    } else {
      byId.set(element.id, element);
    }
  }
  const levelsById = new Map<string, Level>();
  for (const level of sortedById(snapshot.elements.levels)) {
    if (!levelsById.has(level.id)) {
      levelsById.set(level.id, level);
    }
  }
  return { byId, levelsById };
}

function validateLevelReference(input: {
  readonly byId: ReadonlyMap<string, ModelElement>;
  readonly collector: FindingCollector;
  readonly elementId: string;
  readonly elementLabel: string;
  readonly levelId: string;
}): Level | undefined {
  const target = input.byId.get(input.levelId);
  if (target === undefined) {
    input.collector.add({
      affectedElementIds: [input.elementId, input.levelId],
      code: codes.levelReferenceMissing,
      message: `The ${input.elementLabel} references a level that is not present.`,
      severity: "error",
    });
    return undefined;
  }
  if (target.elementType !== "level") {
    input.collector.add({
      affectedElementIds: [input.elementId, input.levelId],
      code: codes.levelReferenceInvalid,
      message: `The ${input.elementLabel} level reference targets a non-level element.`,
      severity: "error",
    });
    return undefined;
  }
  return target;
}

function levelVerticalBounds(
  level: Level,
): { readonly bottomMm: number; readonly topMm: number } | undefined {
  const elevation = knownValue(level.elevationMm);
  const height = knownValue(level.storeyHeightMm);
  if (elevation === undefined || height === undefined) {
    return undefined;
  }
  const top = checkedAdd(elevation, height);
  return top.ok ? { bottomMm: elevation, topMm: top.value } : undefined;
}

function validateLevels(levels: readonly Level[], collector: FindingCollector): void {
  for (const level of sortedById(levels)) {
    const elevation = knownValue(level.elevationMm);
    const height = knownValue(level.storeyHeightMm);
    if (elevation === undefined) {
      collector.add({
        affectedElementIds: [level.id],
        code: codes.levelElevationUnknown,
        message: "The level elevation is explicitly unknown; no elevation was assumed.",
        severity: "information",
      });
    }
    if (height === undefined) {
      collector.add({
        affectedElementIds: [level.id],
        code: codes.levelStoreyHeightUnknown,
        message: "The level storey height is explicitly unknown; no height was assumed.",
        severity: "information",
      });
    }
    if (elevation !== undefined && height !== undefined && !checkedAdd(elevation, height).ok) {
      rangeFinding(
        collector,
        level.id,
        undefined,
        "The level vertical extent exceeds the safe-integer range.",
      );
    }
  }
}

function validateSpaces(input: {
  readonly byId: ReadonlyMap<string, ModelElement>;
  readonly collector: FindingCollector;
  readonly levelsById: ReadonlyMap<string, Level>;
  readonly resourceBudget: ComparisonBudget;
  readonly spaces: readonly Space[];
}): void {
  for (const space of sortedById(input.spaces)) {
    const level = validateLevelReference({
      byId: input.byId,
      collector: input.collector,
      elementId: space.id,
      elementLabel: "space",
      levelId: space.levelId,
    });
    const boundary = knownValue(space.boundary);
    const baseLocation = locationForPoint(
      space.levelId,
      boundary === undefined ? undefined : minimumPoint2(boundary),
      input.levelsById,
    );
    if (boundary === undefined) {
      input.collector.add({
        affectedElementIds: [space.id],
        code: codes.spaceBoundaryUnknown,
        message: "The space boundary is explicitly unknown; no polygon was assumed.",
        severity: "information",
      });
    } else {
      validatePolygon2d({
        collector: input.collector,
        elementId: space.id,
        findingCodes: {
          degenerate: codes.spacePolygonDegenerate,
          repeatedVertex: codes.spacePolygonRepeatedVertex,
          selfIntersection: codes.spacePolygonSelfIntersection,
          zeroLength: codes.spacePolygonZeroLengthEdge,
        },
        location: baseLocation,
        noun: "Space polygon",
        points: boundary,
        resourceBudget: input.resourceBudget,
      });
    }
    validateRoomBoundaryReferences({
      ...input,
      baseLocation,
      level,
      space,
    });
  }
}

function validateRoomBoundaryReferences(input: {
  readonly baseLocation: GeometryLocation | undefined;
  readonly byId: ReadonlyMap<string, ModelElement>;
  readonly collector: FindingCollector;
  readonly level: Level | undefined;
  readonly levelsById: ReadonlyMap<string, Level>;
  readonly resourceBudget: ComparisonBudget;
  readonly space: Space;
}): void {
  const { space } = input;
  if (space.boundedByElementIds.length === 0) {
    input.collector.add({
      affectedElementIds: [space.id],
      code: codes.roomBoundaryReferencesEmpty,
      ...(input.baseLocation === undefined ? {} : { location: input.baseLocation }),
      message: "The space has no boundary-element references.",
      severity: "warning",
    });
    return;
  }

  const seenReferences = new Set<string>();
  const wallEdges: { readonly end: Point2Mm; readonly start: Point2Mm }[] = [];
  let connectivityUnknown = false;
  for (const targetId of [...space.boundedByElementIds].sort(compareStrings)) {
    if (seenReferences.has(targetId)) {
      input.collector.add({
        affectedElementIds: [space.id, targetId],
        code: codes.roomBoundaryReferenceDuplicate,
        ...(input.baseLocation === undefined ? {} : { location: input.baseLocation }),
        message: "The space repeats a boundary-element reference.",
        severity: "error",
      });
      continue;
    }
    seenReferences.add(targetId);
    const target = input.byId.get(targetId);
    if (target === undefined) {
      input.collector.add({
        affectedElementIds: [space.id, targetId],
        code: codes.roomBoundaryReferenceMissing,
        ...(input.baseLocation === undefined ? {} : { location: input.baseLocation }),
        message: "A space boundary reference is not present in the snapshot.",
        severity: "error",
      });
      connectivityUnknown = true;
      continue;
    }
    if (target.elementType !== "wall" && target.elementType !== "surface") {
      input.collector.add({
        affectedElementIds: [space.id, target.id],
        code: codes.roomBoundaryReferenceInvalid,
        ...(input.baseLocation === undefined ? {} : { location: input.baseLocation }),
        message: "A space boundary reference targets neither a wall nor a surface.",
        severity: "error",
      });
      connectivityUnknown = true;
      continue;
    }
    if (target.levelId !== space.levelId) {
      input.collector.add({
        affectedElementIds: [space.id, target.id],
        code: codes.roomBoundaryLevelMismatch,
        ...(input.baseLocation === undefined ? {} : { location: input.baseLocation }),
        message: "A space boundary element belongs to a different level.",
        severity: "error",
      });
      connectivityUnknown = true;
      continue;
    }
    if (target.elementType === "surface") {
      connectivityUnknown = true;
      continue;
    }
    const path = knownValue(target.path);
    const start = path?.[0];
    const end = path?.[path.length - 1];
    if (start === undefined || end === undefined || samePoint2(start, end)) {
      connectivityUnknown = true;
      continue;
    }
    wallEdges.push({ end, start });
  }

  if (input.level === undefined || wallEdges.length === 0 || connectivityUnknown) {
    input.collector.add({
      affectedElementIds: [space.id],
      code: codes.roomBoundaryConnectivityUnknown,
      ...(input.baseLocation === undefined ? {} : { location: input.baseLocation }),
      message:
        "Room-boundary connectivity could not be established solely from valid known wall paths.",
      severity: "information",
    });
  }
  if (wallEdges.length === 0) {
    return;
  }

  const adjacency = new Map<string, Set<string>>();
  const addNeighbour = (from: string, to: string): void => {
    const neighbours = adjacency.get(from) ?? new Set<string>();
    neighbours.add(to);
    adjacency.set(from, neighbours);
  };
  for (const edge of wallEdges) {
    const startKey = point2Key(edge.start);
    const endKey = point2Key(edge.end);
    addNeighbour(startKey, endKey);
    addNeighbour(endKey, startKey);
  }
  const nodes = [...adjacency.keys()].sort(compareStrings);
  const visited = new Set<string>();
  let components = 0;
  for (const node of nodes) {
    if (visited.has(node)) {
      continue;
    }
    components += 1;
    const pending = [node];
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined || visited.has(current)) {
        continue;
      }
      visited.add(current);
      for (const neighbour of adjacency.get(current) ?? []) {
        if (!visited.has(neighbour)) {
          pending.push(neighbour);
        }
      }
    }
  }
  if (components > 1) {
    input.collector.add({
      affectedElementIds: [space.id, ...space.boundedByElementIds],
      code: codes.roomBoundaryDisconnected,
      ...(input.baseLocation === undefined ? {} : { location: input.baseLocation }),
      message: "Known wall references form disconnected room-boundary components.",
      severity: "error",
    });
  }
  if (nodes.some((node) => adjacency.get(node)?.size !== 2)) {
    input.collector.add({
      affectedElementIds: [space.id, ...space.boundedByElementIds],
      code: codes.roomBoundaryNotClosed,
      ...(input.baseLocation === undefined ? {} : { location: input.baseLocation }),
      message: "Known wall references do not form a closed degree-two boundary loop.",
      severity: "error",
    });
  }
}

interface Cross3 {
  readonly x: bigint;
  readonly y: bigint;
  readonly z: bigint;
}

function crossProduct(first: Point3Mm, second: Point3Mm, third: Point3Mm): Cross3 {
  const firstX = BigInt(second.xMm) - BigInt(first.xMm);
  const firstY = BigInt(second.yMm) - BigInt(first.yMm);
  const firstZ = BigInt(second.zMm) - BigInt(first.zMm);
  const secondX = BigInt(third.xMm) - BigInt(first.xMm);
  const secondY = BigInt(third.yMm) - BigInt(first.yMm);
  const secondZ = BigInt(third.zMm) - BigInt(first.zMm);
  return {
    x: firstY * secondZ - firstZ * secondY,
    y: firstZ * secondX - firstX * secondZ,
    z: firstX * secondY - firstY * secondX,
  };
}

function crossIsZero(cross: Cross3): boolean {
  return cross.x === 0n && cross.y === 0n && cross.z === 0n;
}

function absoluteBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function surfacePlane(
  points: readonly Point3Mm[],
):
  | { readonly anchor: Point3Mm; readonly droppedAxis: "x" | "y" | "z"; readonly normal: Cross3 }
  | undefined {
  const unique = [...new Map(points.map((point) => [point3Key(point), point])).values()].sort(
    comparePoint3,
  );
  const anchor = unique[0];
  if (anchor === undefined) {
    return undefined;
  }
  const second = unique[1];
  if (second === undefined) {
    return undefined;
  }
  for (let thirdIndex = 2; thirdIndex < unique.length; thirdIndex += 1) {
    const third = unique[thirdIndex];
    if (third === undefined) {
      continue;
    }
    const normal = crossProduct(anchor, second, third);
    if (crossIsZero(normal)) {
      continue;
    }
    const magnitudes = [
      { axis: "x" as const, value: absoluteBigInt(normal.x) },
      { axis: "y" as const, value: absoluteBigInt(normal.y) },
      { axis: "z" as const, value: absoluteBigInt(normal.z) },
    ].sort((left, right) =>
      left.value === right.value
        ? compareStrings(left.axis, right.axis)
        : left.value > right.value
          ? -1
          : 1,
    );
    const droppedAxis = magnitudes[0]?.axis;
    if (droppedAxis !== undefined) {
      return { anchor, droppedAxis, normal };
    }
  }
  return undefined;
}

function projectPoint(point: Point3Mm, droppedAxis: "x" | "y" | "z"): Point2Mm {
  switch (droppedAxis) {
    case "x":
      return { xMm: point.yMm, yMm: point.zMm };
    case "y":
      return { xMm: point.xMm, yMm: point.zMm };
    case "z":
      return { xMm: point.xMm, yMm: point.yMm };
  }
}

function scalarPlaneResidual(
  plane: NonNullable<ReturnType<typeof surfacePlane>>,
  point: Point3Mm,
): bigint {
  const x = BigInt(point.xMm) - BigInt(plane.anchor.xMm);
  const y = BigInt(point.yMm) - BigInt(plane.anchor.yMm);
  const z = BigInt(point.zMm) - BigInt(plane.anchor.zMm);
  return plane.normal.x * x + plane.normal.y * y + plane.normal.z * z;
}

function validateSurfaces(input: {
  readonly byId: ReadonlyMap<string, ModelElement>;
  readonly collector: FindingCollector;
  readonly levelsById: ReadonlyMap<string, Level>;
  readonly resourceBudget: ComparisonBudget;
  readonly surfaces: readonly Surface[];
}): void {
  for (const surface of sortedById(input.surfaces)) {
    const level = validateLevelReference({
      byId: input.byId,
      collector: input.collector,
      elementId: surface.id,
      elementLabel: "surface",
      levelId: surface.levelId,
    });
    const boundary = knownValue(surface.boundary);
    const minimumPoint = boundary === undefined ? undefined : minimumPoint3(boundary);
    const location = locationForPoint(surface.levelId, minimumPoint, input.levelsById);
    if (boundary === undefined) {
      input.collector.add({
        affectedElementIds: [surface.id],
        code: codes.surfaceBoundaryUnknown,
        message: "The surface boundary is explicitly unknown; no polygon was assumed.",
        severity: "information",
      });
      continue;
    }

    const plane = surfacePlane(boundary);
    if (plane === undefined) {
      input.collector.add({
        affectedElementIds: [surface.id],
        code: codes.surfacePolygonDegenerate,
        ...(location === undefined ? {} : { location }),
        message: "Surface polygon vertices are collinear or coincident.",
        severity: "error",
      });
    } else {
      const residuals = boundary.map((point) => scalarPlaneResidual(plane, point));
      if (residuals.some((residual) => residual !== 0n)) {
        input.collector.add({
          affectedElementIds: [surface.id],
          code: codes.surfacePolygonNonPlanar,
          ...(location === undefined ? {} : { location }),
          message: "Surface polygon vertices are not coplanar.",
          severity: "error",
        });
      }
      if (residuals.some((residual) => absoluteBigInt(residual) > maximumSafeIntegerBigInt)) {
        rangeFinding(
          input.collector,
          surface.id,
          location,
          "Surface planarity arithmetic exceeds the safe-integer range.",
        );
      }
      validatePolygon2d({
        collector: input.collector,
        elementId: surface.id,
        findingCodes: {
          degenerate: codes.surfacePolygonDegenerate,
          repeatedVertex: codes.surfacePolygonRepeatedVertex,
          selfIntersection: codes.surfacePolygonSelfIntersection,
          zeroLength: codes.surfacePolygonZeroLengthEdge,
        },
        location,
        noun: "Surface polygon",
        points: boundary.map((point) => projectPoint(point, plane.droppedAxis)),
        resourceBudget: input.resourceBudget,
      });
    }

    const bounds = level === undefined ? undefined : levelVerticalBounds(level);
    if (
      level !== undefined &&
      bounds !== undefined &&
      boundary.some((point) => point.zMm < bounds.bottomMm || point.zMm > bounds.topMm)
    ) {
      input.collector.add({
        affectedElementIds: [surface.id, level.id],
        code: codes.surfaceOutsideLevelVerticalExtent,
        ...(location === undefined ? {} : { location }),
        message: "A surface vertex lies outside its level's known vertical extent.",
        severity: "error",
      });
    }
  }
}

function validateWalls(input: {
  readonly byId: ReadonlyMap<string, ModelElement>;
  readonly collector: FindingCollector;
  readonly levelsById: ReadonlyMap<string, Level>;
  readonly resourceBudget: ComparisonBudget;
  readonly walls: readonly Wall[];
}): void {
  for (const wall of sortedById(input.walls)) {
    const level = validateLevelReference({
      byId: input.byId,
      collector: input.collector,
      elementId: wall.id,
      elementLabel: "wall",
      levelId: wall.levelId,
    });
    const path = knownValue(wall.path);
    const location = locationForPoint(
      wall.levelId,
      path === undefined ? undefined : minimumPoint2(path),
      input.levelsById,
    );
    if (path === undefined) {
      input.collector.add({
        affectedElementIds: [wall.id],
        code: codes.wallPathUnknown,
        message: "The wall path is explicitly unknown; no path was assumed.",
        severity: "information",
      });
    } else {
      validatePointPath({
        closed: false,
        collector: input.collector,
        elementId: wall.id,
        findingCodes: {
          repeatedVertex: codes.wallPathRepeatedVertex,
          selfIntersection: codes.wallPathSelfIntersection,
          zeroLength: codes.wallPathZeroLengthSegment,
        },
        location,
        noun: "Wall path",
        points: path,
        resourceBudget: input.resourceBudget,
      });
      if (!polylineLengthBoundsMm(path).ok) {
        rangeFinding(
          input.collector,
          wall.id,
          location,
          "Wall path length arithmetic exceeded the safe-integer range.",
        );
      }
    }

    const height = knownValue(wall.heightMm);
    const thickness = knownValue(wall.thicknessMm);
    const baseOffset = knownValue(wall.baseOffsetMm);
    const unknownDimensions = [
      {
        code: codes.wallHeightUnknown,
        message: "Wall height is explicitly unknown; no height was assumed.",
        value: height,
      },
      {
        code: codes.wallThicknessUnknown,
        message: "Wall thickness is explicitly unknown; no thickness was assumed.",
        value: thickness,
      },
      {
        code: codes.wallBaseOffsetUnknown,
        message: "Wall base offset is explicitly unknown; no offset was assumed.",
        value: baseOffset,
      },
    ];
    for (const unknown of unknownDimensions) {
      if (unknown.value === undefined) {
        input.collector.add({
          affectedElementIds: [wall.id],
          code: unknown.code,
          ...(location === undefined ? {} : { location }),
          message: unknown.message,
          severity: "information",
        });
      }
    }
    const bounds = level === undefined ? undefined : levelVerticalBounds(level);
    const elevation = level === undefined ? undefined : knownValue(level.elevationMm);
    if (
      level !== undefined &&
      bounds !== undefined &&
      elevation !== undefined &&
      baseOffset !== undefined &&
      height !== undefined
    ) {
      const bottom = checkedAdd(elevation, baseOffset);
      const top = bottom.ok ? checkedAdd(bottom.value, height) : bottom;
      if (!bottom.ok || !top.ok) {
        rangeFinding(
          input.collector,
          wall.id,
          location,
          "Wall vertical extent arithmetic exceeded the safe-integer range.",
        );
      } else if (bottom.value < bounds.bottomMm || top.value > bounds.topMm) {
        input.collector.add({
          affectedElementIds: [wall.id, level.id],
          code: codes.wallOutsideLevelVerticalExtent,
          ...(location === undefined ? {} : { location }),
          message: "The wall lies outside its level's known vertical extent.",
          severity: "error",
        });
      }
    }
  }
}

interface OpeningInterval {
  readonly endMm: number;
  readonly hostWallId: string;
  readonly id: string;
  readonly location: GeometryLocation | undefined;
  readonly startMm: number;
}

function validateOpenings(input: {
  readonly byId: ReadonlyMap<string, ModelElement>;
  readonly collector: FindingCollector;
  readonly levelsById: ReadonlyMap<string, Level>;
  readonly openings: readonly Opening[];
}): void {
  const intervals: OpeningInterval[] = [];
  for (const opening of sortedById(input.openings)) {
    const target = input.byId.get(opening.hostWallId);
    if (target === undefined) {
      input.collector.add({
        affectedElementIds: [opening.id, opening.hostWallId],
        code: codes.hostWallReferenceMissing,
        message: "The opening host wall is not present in the snapshot.",
        severity: "error",
      });
      reportUnknownOpeningDimensions(opening, input.collector, undefined);
      continue;
    }
    if (target.elementType !== "wall") {
      input.collector.add({
        affectedElementIds: [opening.id, opening.hostWallId],
        code: codes.hostWallReferenceInvalid,
        message: "The opening host reference targets a non-wall element.",
        severity: "error",
      });
      reportUnknownOpeningDimensions(opening, input.collector, undefined);
      continue;
    }
    const wall = target;
    const path = knownValue(wall.path);
    const location = locationForPoint(
      wall.levelId,
      path === undefined ? undefined : minimumPoint2(path),
      input.levelsById,
    );
    reportUnknownOpeningDimensions(opening, input.collector, location);
    const offset = knownValue(opening.offsetAlongHostMm);
    const width = knownValue(opening.widthMm);
    const end = offset === undefined || width === undefined ? undefined : checkedAdd(offset, width);
    if (end !== undefined && !end.ok) {
      rangeFinding(
        input.collector,
        opening.id,
        location,
        "Opening host-interval arithmetic exceeded the safe-integer range.",
      );
    }
    if (path === undefined) {
      input.collector.add({
        affectedElementIds: [opening.id, wall.id],
        code: codes.openingHostExtentUnknown,
        ...(location === undefined ? {} : { location }),
        message: "The host wall path is unknown, so opening containment was not assumed.",
        severity: "information",
      });
    } else if (end?.ok === true && offset !== undefined) {
      const length = polylineLengthBoundsMm(path);
      if (!length.ok) {
        rangeFinding(
          input.collector,
          opening.id,
          location,
          "Host-wall length arithmetic exceeded the safe-integer range.",
        );
      } else if (end.value > length.value.upperBoundMm) {
        input.collector.add({
          affectedElementIds: [opening.id, wall.id],
          code: codes.openingOutsideHostExtent,
          ...(location === undefined ? {} : { location }),
          message:
            "The opening interval extends beyond the host wall's maximum exact length bound.",
          severity: "error",
        });
      } else if (end.value > length.value.lowerBoundMm) {
        input.collector.add({
          affectedElementIds: [opening.id, wall.id],
          code: codes.openingHostExtentIndeterminate,
          ...(location === undefined ? {} : { location }),
          message:
            "Integer length bounds cannot prove whether the opening endpoint is inside the host wall.",
          severity: "warning",
        });
      }
      intervals.push({
        endMm: end.value,
        hostWallId: wall.id,
        id: opening.id,
        location,
        startMm: offset,
      });
    }

    const sill = knownValue(opening.sillHeightMm);
    const height = knownValue(opening.heightMm);
    const wallHeight = knownValue(wall.heightMm);
    if (sill !== undefined && sill < 0) {
      input.collector.add({
        affectedElementIds: [opening.id, wall.id],
        code: codes.openingBelowHostBase,
        ...(location === undefined ? {} : { location }),
        message: "The opening sill is below the host wall base.",
        severity: "error",
      });
    }
    if (sill !== undefined && height !== undefined && wallHeight !== undefined) {
      const top = checkedAdd(sill, height);
      if (!top.ok) {
        rangeFinding(
          input.collector,
          opening.id,
          location,
          "Opening vertical-extent arithmetic exceeded the safe-integer range.",
        );
      } else if (top.value > wallHeight) {
        input.collector.add({
          affectedElementIds: [opening.id, wall.id],
          code: codes.openingAboveHostHeight,
          ...(location === undefined ? {} : { location }),
          message: "The opening top lies above the host wall's known height.",
          severity: "error",
        });
      }
    }
  }
  validateOpeningOverlaps(intervals, input.collector);
}

function reportUnknownOpeningDimensions(
  opening: Opening,
  collector: FindingCollector,
  location: GeometryLocation | undefined,
): void {
  const unknowns = [
    {
      attributed: opening.widthMm,
      code: codes.openingWidthUnknown,
      message: "Opening width is explicitly unknown; no width was assumed.",
    },
    {
      attributed: opening.heightMm,
      code: codes.openingHeightUnknown,
      message: "Opening height is explicitly unknown; no height was assumed.",
    },
    {
      attributed: opening.offsetAlongHostMm,
      code: codes.openingOffsetUnknown,
      message: "Opening host offset is explicitly unknown; no offset was assumed.",
    },
    {
      attributed: opening.sillHeightMm,
      code: codes.openingSillUnknown,
      message: "Opening sill height is explicitly unknown; no sill was assumed.",
    },
  ];
  for (const unknown of unknowns) {
    if (unknown.attributed.knowledge === "unknown") {
      collector.add({
        affectedElementIds: [opening.id],
        code: unknown.code,
        ...(location === undefined ? {} : { location }),
        message: unknown.message,
        severity: "information",
      });
    }
  }
}

function validateOpeningOverlaps(
  intervals: readonly OpeningInterval[],
  collector: FindingCollector,
): void {
  const byHost = new Map<string, OpeningInterval[]>();
  for (const interval of intervals) {
    const hostIntervals = byHost.get(interval.hostWallId) ?? [];
    hostIntervals.push(interval);
    byHost.set(interval.hostWallId, hostIntervals);
  }
  for (const [hostWallId, hostIntervals] of [...byHost.entries()].sort(([left], [right]) =>
    compareStrings(left, right),
  )) {
    const ordered = hostIntervals.sort(
      (left, right) =>
        compareNumbers(left.startMm, right.startMm) ||
        compareNumbers(left.endMm, right.endMm) ||
        compareStrings(left.id, right.id),
    );
    let active: OpeningInterval | undefined;
    for (const interval of ordered) {
      if (active !== undefined && interval.startMm < active.endMm) {
        collector.add({
          affectedElementIds: [active.id, interval.id, hostWallId],
          code: codes.openingOverlap,
          ...(interval.location === undefined ? {} : { location: interval.location }),
          message: "Known opening intervals overlap on the same host wall.",
          severity: "error",
        });
      }
      if (
        active === undefined ||
        interval.endMm > active.endMm ||
        (interval.endMm === active.endMm && compareStrings(interval.id, active.id) < 0)
      ) {
        active = interval;
      }
    }
  }
}

function validateStairs(input: {
  readonly byId: ReadonlyMap<string, ModelElement>;
  readonly collector: FindingCollector;
  readonly levelsById: ReadonlyMap<string, Level>;
  readonly resourceBudget: ComparisonBudget;
  readonly stairs: readonly Stair[];
}): void {
  for (const stair of sortedById(input.stairs)) {
    const fromLevel = validateLevelReference({
      byId: input.byId,
      collector: input.collector,
      elementId: stair.id,
      elementLabel: "stair origin",
      levelId: stair.fromLevelId,
    });
    const toLevel = validateLevelReference({
      byId: input.byId,
      collector: input.collector,
      elementId: stair.id,
      elementLabel: "stair destination",
      levelId: stair.toLevelId,
    });
    const path = knownValue(stair.path);
    const location = locationForPoint(
      stair.fromLevelId,
      path === undefined ? undefined : minimumPoint2(path),
      input.levelsById,
    );
    if (stair.fromLevelId === stair.toLevelId) {
      input.collector.add({
        affectedElementIds: [stair.id, stair.fromLevelId],
        code: codes.stairLevelsIdentical,
        ...(location === undefined ? {} : { location }),
        message: "A stair must connect two distinct level IDs.",
        severity: "error",
      });
    }
    if (path === undefined) {
      input.collector.add({
        affectedElementIds: [stair.id],
        code: codes.stairPathUnknown,
        message: "The stair path is explicitly unknown; no path was assumed.",
        severity: "information",
      });
    } else {
      validatePointPath({
        closed: false,
        collector: input.collector,
        elementId: stair.id,
        findingCodes: {
          repeatedVertex: codes.stairPathRepeatedVertex,
          selfIntersection: codes.stairPathSelfIntersection,
          zeroLength: codes.stairPathZeroLengthSegment,
        },
        location,
        noun: "Stair path",
        points: path,
        resourceBudget: input.resourceBudget,
      });
    }

    const rise = knownValue(stair.riseMm);
    const run = knownValue(stair.runMm);
    const stepCount = knownValue(stair.stepCount);
    const width = knownValue(stair.widthMm);
    const unknowns = [
      {
        code: codes.stairRiseUnknown,
        message: "Stair rise is explicitly unknown; no rise was assumed.",
        value: rise,
      },
      {
        code: codes.stairRunUnknown,
        message: "Stair run is explicitly unknown; no run was assumed.",
        value: run,
      },
      {
        code: codes.stairStepCountUnknown,
        message: "Stair step count is explicitly unknown; no count was assumed.",
        value: stepCount,
      },
      {
        code: codes.stairWidthUnknown,
        message: "Stair width is explicitly unknown; no width was assumed.",
        value: width,
      },
    ];
    for (const unknown of unknowns) {
      if (unknown.value === undefined) {
        input.collector.add({
          affectedElementIds: [stair.id],
          code: unknown.code,
          ...(location === undefined ? {} : { location }),
          message: unknown.message,
          severity: "information",
        });
      }
    }
    if (stepCount !== undefined && stepCount < 1) {
      input.collector.add({
        affectedElementIds: [stair.id],
        code: codes.stairStepCountInvalid,
        ...(location === undefined ? {} : { location }),
        message: "A known stair step count must be at least one.",
        severity: "error",
      });
    }

    if (fromLevel !== undefined && toLevel !== undefined && stair.fromLevelId !== stair.toLevelId) {
      const fromElevation = knownValue(fromLevel.elevationMm);
      const toElevation = knownValue(toLevel.elevationMm);
      if (fromElevation === undefined || toElevation === undefined) {
        input.collector.add({
          affectedElementIds: [stair.id, fromLevel.id, toLevel.id],
          code: codes.stairLevelElevationUnknown,
          ...(location === undefined ? {} : { location }),
          message:
            "A connected level elevation is unknown, so the stair's vertical relationship was not assumed.",
          severity: "information",
        });
      } else if (rise !== undefined && stepCount !== undefined && stepCount > 0) {
        const elevationDifference = checkedSubtract(toElevation, fromElevation);
        const totalRise = checkedMultiply(rise, stepCount);
        if (!elevationDifference.ok || !totalRise.ok) {
          rangeFinding(
            input.collector,
            stair.id,
            location,
            "Stair rise/elevation arithmetic exceeded the safe-integer range.",
          );
        } else if (Math.abs(elevationDifference.value) !== totalRise.value) {
          input.collector.add({
            affectedElementIds: [stair.id, fromLevel.id, toLevel.id],
            code: codes.stairRiseLevelMismatch,
            ...(location === undefined ? {} : { location }),
            message:
              "Known stair rise multiplied by step count does not equal the connected level elevation difference.",
            severity: "error",
          });
        }
      }
    }

    if (path !== undefined && run !== undefined && stepCount !== undefined && stepCount > 0) {
      const expectedRun = checkedMultiply(run, stepCount - 1);
      const length = polylineLengthBoundsMm(path);
      if (!expectedRun.ok || !length.ok) {
        rangeFinding(
          input.collector,
          stair.id,
          location,
          "Stair run/path arithmetic exceeded the safe-integer range.",
        );
      } else if (length.value.lowerBoundMm === length.value.upperBoundMm) {
        if (expectedRun.value !== length.value.lowerBoundMm) {
          input.collector.add({
            affectedElementIds: [stair.id],
            code: codes.stairRunPathMismatch,
            ...(location === undefined ? {} : { location }),
            message: "Known stair run and step count do not equal the exact path length.",
            severity: "error",
          });
        }
      } else if (
        expectedRun.value <= length.value.lowerBoundMm ||
        expectedRun.value >= length.value.upperBoundMm
      ) {
        input.collector.add({
          affectedElementIds: [stair.id],
          code: codes.stairRunPathMismatch,
          ...(location === undefined ? {} : { location }),
          message: "Known stair run lies outside the path's exact integer length bounds.",
          severity: "error",
        });
      } else {
        input.collector.add({
          affectedElementIds: [stair.id],
          code: codes.stairRunPathIndeterminate,
          ...(location === undefined ? {} : { location }),
          message: "Integer length bounds cannot prove the known stair run equals its path length.",
          severity: "warning",
        });
      }
    }
  }
}

function validatePositionAgainstLevel(input: {
  readonly collector: FindingCollector;
  readonly elementId: string;
  readonly elementLabel: string;
  readonly level: Level | undefined;
  readonly point: Point3Mm;
}): void {
  const bounds = input.level === undefined ? undefined : levelVerticalBounds(input.level);
  if (
    input.level !== undefined &&
    bounds !== undefined &&
    (input.point.zMm < bounds.bottomMm || input.point.zMm > bounds.topMm)
  ) {
    input.collector.add({
      affectedElementIds: [input.elementId, input.level.id],
      code: codes.elementPositionOutsideLevel,
      location: {
        levelId: input.level.id,
        xMm: input.point.xMm,
        yMm: input.point.yMm,
      },
      message: `The ${input.elementLabel} position lies outside its level's known vertical extent.`,
      severity: "error",
    });
  }
}

function validatePlacedObjects(input: {
  readonly byId: ReadonlyMap<string, ModelElement>;
  readonly collector: FindingCollector;
  readonly fixedObjects: readonly FixedObject[];
  readonly furnishings: readonly Furnishing[];
}): void {
  const validate = (
    element: FixedObject | Furnishing,
    label: "fixed object" | "furnishing",
  ): void => {
    const level = validateLevelReference({
      byId: input.byId,
      collector: input.collector,
      elementId: element.id,
      elementLabel: label,
      levelId: element.levelId,
    });
    const position = knownValue(element.placement.position);
    if (position === undefined) {
      input.collector.add({
        affectedElementIds: [element.id],
        code:
          element.elementType === "fixed-object"
            ? codes.fixedObjectPositionUnknown
            : codes.furnishingPositionUnknown,
        message: `The ${label} position is explicitly unknown; no placement was assumed.`,
        severity: "information",
      });
    } else {
      validatePositionAgainstLevel({
        collector: input.collector,
        elementId: element.id,
        elementLabel: label,
        level,
        point: position,
      });
    }
    if (element.dimensions.knowledge === "unknown") {
      input.collector.add({
        affectedElementIds: [element.id],
        code:
          element.elementType === "fixed-object"
            ? codes.fixedObjectDimensionsUnknown
            : codes.furnishingDimensionsUnknown,
        ...(position === undefined || level === undefined
          ? {}
          : {
              location: {
                levelId: level.id,
                xMm: position.xMm,
                yMm: position.yMm,
              },
            }),
        message: `The ${label} dimensions are explicitly unknown; no size was assumed.`,
        severity: "information",
      });
    }
  };
  for (const element of sortedById(input.fixedObjects)) {
    validate(element, "fixed object");
  }
  for (const element of sortedById(input.furnishings)) {
    validate(element, "furnishing");
  }
}

function validateFinishes(input: {
  readonly byId: ReadonlyMap<string, ModelElement>;
  readonly collector: FindingCollector;
  readonly finishes: readonly Finish[];
}): void {
  for (const finish of sortedById(input.finishes)) {
    const target = input.byId.get(finish.targetElementId);
    if (target === undefined) {
      input.collector.add({
        affectedElementIds: [finish.id, finish.targetElementId],
        code: codes.targetReferenceMissing,
        message: "The finish target is not present in the snapshot.",
        severity: "error",
      });
    } else if (target.id === finish.id) {
      input.collector.add({
        affectedElementIds: [finish.id],
        code: codes.targetReferenceInvalid,
        message: "A finish cannot target itself.",
        severity: "error",
      });
    }
  }
}

function validateLights(input: {
  readonly byId: ReadonlyMap<string, ModelElement>;
  readonly collector: FindingCollector;
  readonly lights: readonly Light[];
}): void {
  for (const light of sortedById(input.lights)) {
    const level = validateLevelReference({
      byId: input.byId,
      collector: input.collector,
      elementId: light.id,
      elementLabel: "light",
      levelId: light.levelId,
    });
    const position = knownValue(light.position);
    if (position === undefined) {
      input.collector.add({
        affectedElementIds: [light.id],
        code: codes.lightPositionUnknown,
        message: "The light position is explicitly unknown; no position was assumed.",
        severity: "information",
      });
    } else {
      validatePositionAgainstLevel({
        collector: input.collector,
        elementId: light.id,
        elementLabel: "light",
        level,
        point: position,
      });
    }
  }
}

function validateCameras(input: {
  readonly byId: ReadonlyMap<string, ModelElement>;
  readonly cameras: readonly Camera[];
  readonly collector: FindingCollector;
}): void {
  for (const camera of sortedById(input.cameras)) {
    const level = validateLevelReference({
      byId: input.byId,
      collector: input.collector,
      elementId: camera.id,
      elementLabel: "camera",
      levelId: camera.levelId,
    });
    const position = knownValue(camera.position);
    const target = knownValue(camera.target);
    if (position === undefined) {
      input.collector.add({
        affectedElementIds: [camera.id],
        code: codes.cameraPositionUnknown,
        message: "The camera position is explicitly unknown; no position was assumed.",
        severity: "information",
      });
    } else {
      validatePositionAgainstLevel({
        collector: input.collector,
        elementId: camera.id,
        elementLabel: "camera",
        level,
        point: position,
      });
    }
    if (target === undefined) {
      input.collector.add({
        affectedElementIds: [camera.id],
        code: codes.cameraTargetUnknown,
        message: "The camera target is explicitly unknown; no target was assumed.",
        severity: "information",
      });
    } else {
      const bounds = level === undefined ? undefined : levelVerticalBounds(level);
      if (
        level !== undefined &&
        bounds !== undefined &&
        (target.zMm < bounds.bottomMm || target.zMm > bounds.topMm)
      ) {
        input.collector.add({
          affectedElementIds: [camera.id, level.id],
          code: codes.cameraTargetOutsideLevel,
          location: { levelId: level.id, xMm: target.xMm, yMm: target.yMm },
          message: "The camera target lies outside its level's known vertical extent.",
          severity: "warning",
        });
      }
    }
    if (position !== undefined && target !== undefined && samePoint3(position, target)) {
      input.collector.add({
        affectedElementIds: [camera.id],
        code: codes.cameraTargetCoincident,
        ...(level === undefined
          ? {}
          : {
              location: { levelId: level.id, xMm: position.xMm, yMm: position.yMm },
            }),
        message: "The camera position and target are coincident.",
        severity: "error",
      });
    }
    if (camera.verticalFovMilliDegrees.knowledge === "unknown") {
      input.collector.add({
        affectedElementIds: [camera.id],
        code: codes.cameraFovUnknown,
        message: "The camera field of view is explicitly unknown; no angle was assumed.",
        severity: "information",
      });
    }
  }
}

/**
 * Validate a frozen C4 canonical snapshot without mutation or repair.
 *
 * The caller remains responsible for schema validation. For every schema-valid
 * bounded snapshot this function returns a deterministically sorted, frozen
 * finding array; unknown attributed values remain explicit findings.
 */
export function validateCanonicalGeometry(
  snapshot: CanonicalHomeSnapshot,
): readonly GeometryFinding[] {
  const collector = new FindingCollector();
  const resourceBudget = new ComparisonBudget();
  const { byId, levelsById } = indexElements(snapshot, collector);

  validateLevels(snapshot.elements.levels, collector);
  validateSpaces({
    byId,
    collector,
    levelsById,
    resourceBudget,
    spaces: snapshot.elements.spaces,
  });
  validateSurfaces({
    byId,
    collector,
    levelsById,
    resourceBudget,
    surfaces: snapshot.elements.surfaces,
  });
  validateWalls({
    byId,
    collector,
    levelsById,
    resourceBudget,
    walls: snapshot.elements.walls,
  });
  validateOpenings({ byId, collector, levelsById, openings: snapshot.elements.openings });
  validateStairs({
    byId,
    collector,
    levelsById,
    resourceBudget,
    stairs: snapshot.elements.stairs,
  });
  validatePlacedObjects({
    byId,
    collector,
    fixedObjects: snapshot.elements.fixedObjects,
    furnishings: snapshot.elements.furnishings,
  });
  validateFinishes({ byId, collector, finishes: snapshot.elements.finishes });
  validateLights({ byId, collector, lights: snapshot.elements.lights });
  validateCameras({ byId, cameras: snapshot.elements.cameras, collector });

  return collector.finish();
}
