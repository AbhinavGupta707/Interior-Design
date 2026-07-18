import type { BoundaryTouchRule } from "./types.js";

const trigonometricScale = 1_000_000_000_000n;
const coordinateScale = trigonometricScale * 2n;
const fullRotationMilliDegrees = 360_000;
const rightAngleMilliDegrees = 90_000;
const maximumCoordinateMagnitudeMm = 10_000_000;

// atan(2^-i), expressed in integer nanodegrees. These immutable constants and BigInt-only CORDIC
// arithmetic make arbitrary milli-degree rotations repeatable without host trigonometric calls.
const cordicAnglesNanoDegrees = Object.freeze([
  45_000_000_000n,
  26_565_051_177n,
  14_036_243_468n,
  7_125_016_349n,
  3_576_334_375n,
  1_789_910_608n,
  895_173_710n,
  447_614_171n,
  223_810_500n,
  111_905_677n,
  55_952_892n,
  27_976_453n,
  13_988_227n,
  6_994_114n,
  3_497_057n,
  1_748_528n,
  874_264n,
  437_132n,
  218_566n,
  109_283n,
  54_642n,
  27_321n,
  13_660n,
  6_830n,
  3_415n,
  1_708n,
  854n,
  427n,
  213n,
  107n,
  53n,
  27n,
  13n,
  7n,
  3n,
  2n,
  1n,
] as const);
const cordicGainInverseScaled = 607_252_935_009n;

export interface IntegerPointMm {
  readonly xMm: number;
  readonly yMm: number;
}

export interface ClearanceBySideMm {
  readonly back: number;
  readonly front: number;
  readonly left: number;
  readonly right: number;
}

export interface ScaledPoint {
  readonly x: bigint;
  readonly y: bigint;
}

export type ScaledPolygon = readonly ScaledPoint[];

export type PolygonValidationCode =
  "MALFORMED_GEOMETRY" | "NUMERIC_RANGE_EXCEEDED" | "RESOURCE_LIMIT";

export interface PolygonValidationFailure {
  readonly code: PolygonValidationCode;
  readonly ok: false;
}

export interface PolygonValidationSuccess {
  readonly ok: true;
  readonly polygon: ScaledPolygon;
}

export type PolygonValidation = PolygonValidationFailure | PolygonValidationSuccess;

type PointLocation = "boundary" | "inside" | "outside";
type SegmentIntersection = "cross" | "none" | "overlap" | "touch";

function normalizeRotation(rotationMilliDegrees: number): number {
  const normalized = rotationMilliDegrees % fullRotationMilliDegrees;
  return normalized < 0 ? normalized + fullRotationMilliDegrees : normalized;
}

function cordicFirstQuadrant(angleMilliDegrees: number): readonly [bigint, bigint] {
  if (angleMilliDegrees === 0) return [trigonometricScale, 0n];
  if (angleMilliDegrees === rightAngleMilliDegrees) return [0n, trigonometricScale];
  let x = cordicGainInverseScaled;
  let y = 0n;
  let residual = BigInt(angleMilliDegrees) * 1_000_000n;
  cordicAnglesNanoDegrees.forEach((step, index) => {
    const direction = residual >= 0n ? 1n : -1n;
    const nextX = x - direction * (y >> BigInt(index));
    const nextY = y + direction * (x >> BigInt(index));
    residual -= direction * step;
    x = nextX;
    y = nextY;
  });
  return [x, y];
}

export function deterministicSinCos(
  rotationMilliDegrees: number,
): readonly [cosine: bigint, sine: bigint] {
  const normalized = normalizeRotation(rotationMilliDegrees);
  if (normalized === 0) return [trigonometricScale, 0n];
  if (normalized === 90_000) return [0n, trigonometricScale];
  if (normalized === 180_000) return [-trigonometricScale, 0n];
  if (normalized === 270_000) return [0n, -trigonometricScale];
  const quadrant = Math.floor(normalized / rightAngleMilliDegrees);
  const withinQuadrant = normalized % rightAngleMilliDegrees;
  const acute = quadrant % 2 === 0 ? withinQuadrant : rightAngleMilliDegrees - withinQuadrant;
  const [acuteCosine, acuteSine] = cordicFirstQuadrant(acute);
  switch (quadrant) {
    case 0:
      return [acuteCosine, acuteSine];
    case 1:
      return [-acuteCosine, acuteSine];
    case 2:
      return [-acuteCosine, -acuteSine];
    default:
      return [acuteCosine, -acuteSine];
  }
}

export function rotatedRectangle(
  centre: IntegerPointMm,
  widthMm: number,
  depthMm: number,
  rotationMilliDegrees: number,
  clearance: ClearanceBySideMm = { back: 0, front: 0, left: 0, right: 0 },
): ScaledPolygon {
  const [cosine, sine] = deterministicSinCos(rotationMilliDegrees);
  const localPoints = [
    { xTwice: -widthMm - clearance.left * 2, yTwice: -depthMm - clearance.back * 2 },
    { xTwice: widthMm + clearance.right * 2, yTwice: -depthMm - clearance.back * 2 },
    { xTwice: widthMm + clearance.right * 2, yTwice: depthMm + clearance.front * 2 },
    { xTwice: -widthMm - clearance.left * 2, yTwice: depthMm + clearance.front * 2 },
  ] as const;
  const centreX = BigInt(centre.xMm) * coordinateScale;
  const centreY = BigInt(centre.yMm) * coordinateScale;
  return Object.freeze(
    localPoints.map(({ xTwice, yTwice }) => {
      const x = BigInt(xTwice);
      const y = BigInt(yTwice);
      return Object.freeze({
        x: centreX + x * cosine - y * sine,
        y: centreY + x * sine + y * cosine,
      });
    }),
  );
}

function orientation(first: ScaledPoint, second: ScaledPoint, third: ScaledPoint): -1 | 0 | 1 {
  const determinant =
    (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x);
  return determinant === 0n ? 0 : determinant > 0n ? 1 : -1;
}

function inBounds(point: ScaledPoint, start: ScaledPoint, end: ScaledPoint): boolean {
  return (
    point.x >= (start.x < end.x ? start.x : end.x) &&
    point.x <= (start.x > end.x ? start.x : end.x) &&
    point.y >= (start.y < end.y ? start.y : end.y) &&
    point.y <= (start.y > end.y ? start.y : end.y)
  );
}

function segmentIntersection(
  firstStart: ScaledPoint,
  firstEnd: ScaledPoint,
  secondStart: ScaledPoint,
  secondEnd: ScaledPoint,
): SegmentIntersection {
  const firstStartSide = orientation(firstStart, firstEnd, secondStart);
  const firstEndSide = orientation(firstStart, firstEnd, secondEnd);
  const secondStartSide = orientation(secondStart, secondEnd, firstStart);
  const secondEndSide = orientation(secondStart, secondEnd, firstEnd);
  if (
    firstStartSide !== 0 &&
    firstEndSide !== 0 &&
    secondStartSide !== 0 &&
    secondEndSide !== 0 &&
    firstStartSide !== firstEndSide &&
    secondStartSide !== secondEndSide
  ) {
    return "cross";
  }
  const contacts = [
    firstStartSide === 0 && inBounds(secondStart, firstStart, firstEnd),
    firstEndSide === 0 && inBounds(secondEnd, firstStart, firstEnd),
    secondStartSide === 0 && inBounds(firstStart, secondStart, secondEnd),
    secondEndSide === 0 && inBounds(firstEnd, secondStart, secondEnd),
  ].filter(Boolean).length;
  if (contacts === 0) return "none";
  if (firstStartSide === 0 && firstEndSide === 0 && secondStartSide === 0 && secondEndSide === 0) {
    const firstAxis = firstStart.x === firstEnd.x ? "y" : "x";
    const firstLow =
      firstStart[firstAxis] < firstEnd[firstAxis] ? firstStart[firstAxis] : firstEnd[firstAxis];
    const firstHigh =
      firstStart[firstAxis] > firstEnd[firstAxis] ? firstStart[firstAxis] : firstEnd[firstAxis];
    const secondLow =
      secondStart[firstAxis] < secondEnd[firstAxis] ? secondStart[firstAxis] : secondEnd[firstAxis];
    const secondHigh =
      secondStart[firstAxis] > secondEnd[firstAxis] ? secondStart[firstAxis] : secondEnd[firstAxis];
    const overlapLow = firstLow > secondLow ? firstLow : secondLow;
    const overlapHigh = firstHigh < secondHigh ? firstHigh : secondHigh;
    return overlapLow < overlapHigh ? "overlap" : "touch";
  }
  return "touch";
}

function edges(polygon: ScaledPolygon): readonly (readonly [ScaledPoint, ScaledPoint])[] {
  return polygon.map((point, index) => [
    point,
    polygon[(index + 1) % polygon.length] as ScaledPoint,
  ]);
}

function pointLocation(point: ScaledPoint, polygon: ScaledPolygon): PointLocation {
  let winding = 0;
  for (const [start, end] of edges(polygon)) {
    if (orientation(start, end, point) === 0 && inBounds(point, start, end)) return "boundary";
    if (start.y <= point.y) {
      if (end.y > point.y && orientation(start, end, point) > 0) winding += 1;
    } else if (end.y <= point.y && orientation(start, end, point) < 0) {
      winding -= 1;
    }
  }
  return winding === 0 ? "outside" : "inside";
}

function polygonCentroidAverage(polygon: ScaledPolygon): ScaledPoint {
  const sums = polygon.reduce(
    (accumulator, point) => ({ x: accumulator.x + point.x, y: accumulator.y + point.y }),
    { x: 0n, y: 0n },
  );
  return { x: sums.x / BigInt(polygon.length), y: sums.y / BigInt(polygon.length) };
}

export function polygonContainsPolygon(
  container: ScaledPolygon,
  candidate: ScaledPolygon,
  boundaryTouch: BoundaryTouchRule,
): boolean {
  const locations = candidate.map((point) => pointLocation(point, container));
  if (locations.some((location) => location === "outside")) return false;
  if (boundaryTouch === "forbid" && locations.some((location) => location === "boundary")) {
    return false;
  }
  for (const candidateEdge of edges(candidate)) {
    for (const containerEdge of edges(container)) {
      const intersection = segmentIntersection(...candidateEdge, ...containerEdge);
      if (intersection === "cross") return false;
      if (boundaryTouch === "forbid" && intersection !== "none") return false;
    }
  }
  return true;
}

export function polygonsOverlap(
  left: ScaledPolygon,
  right: ScaledPolygon,
  boundaryTouch: BoundaryTouchRule,
): boolean {
  let boundaryContact = false;
  for (const leftEdge of edges(left)) {
    for (const rightEdge of edges(right)) {
      const intersection = segmentIntersection(...leftEdge, ...rightEdge);
      if (intersection === "cross") return true;
      if (intersection === "overlap") {
        const leftSides = left
          .map((point) => orientation(leftEdge[0], leftEdge[1], point))
          .filter((side) => side !== 0);
        const rightSides = right
          .map((point) => orientation(leftEdge[0], leftEdge[1], point))
          .filter((side) => side !== 0);
        if (leftSides.some((leftSide) => rightSides.some((rightSide) => leftSide === rightSide))) {
          return true;
        }
      }
      if (intersection !== "none") boundaryContact = true;
    }
  }
  if (left.some((point) => pointLocation(point, right) === "inside")) return true;
  if (right.some((point) => pointLocation(point, left) === "inside")) return true;
  if (pointLocation(polygonCentroidAverage(left), right) === "inside") return true;
  if (pointLocation(polygonCentroidAverage(right), left) === "inside") return true;
  return boundaryTouch === "forbid" && boundaryContact;
}

/** Exact separating-axis test for the convex rotated rectangles used by placement envelopes. */
export function convexPolygonsOverlap(
  left: ScaledPolygon,
  right: ScaledPolygon,
  boundaryTouch: BoundaryTouchRule,
): boolean {
  let boundaryOnly = false;
  for (const [start, end] of [...edges(left), ...edges(right)]) {
    const axisX = -(end.y - start.y);
    const axisY = end.x - start.x;
    const project = (point: ScaledPoint): bigint => point.x * axisX + point.y * axisY;
    const leftValues = left.map(project);
    const rightValues = right.map(project);
    const leftMinimum = leftValues.reduce((minimum, value) => (value < minimum ? value : minimum));
    const leftMaximum = leftValues.reduce((maximum, value) => (value > maximum ? value : maximum));
    const rightMinimum = rightValues.reduce((minimum, value) =>
      value < minimum ? value : minimum,
    );
    const rightMaximum = rightValues.reduce((maximum, value) =>
      value > maximum ? value : maximum,
    );
    if (leftMaximum < rightMinimum || rightMaximum < leftMinimum) return false;
    if (leftMaximum === rightMinimum || rightMaximum === leftMinimum) boundaryOnly = true;
  }
  return boundaryTouch === "forbid" || !boundaryOnly;
}

function rawAreaTwice(polygon: ScaledPolygon): bigint {
  return edges(polygon).reduce(
    (area, [start, end]) => area + start.x * end.y - end.x * start.y,
    0n,
  );
}

export function validateAndScalePolygon(
  points: readonly IntegerPointMm[],
  maximumVertices: number,
): PolygonValidation {
  if (points.length > maximumVertices) return { code: "RESOURCE_LIMIT", ok: false };
  if (points.length < 3) return { code: "MALFORMED_GEOMETRY", ok: false };
  if (
    points.some(
      ({ xMm, yMm }) =>
        !Number.isSafeInteger(xMm) ||
        !Number.isSafeInteger(yMm) ||
        Math.abs(xMm) > maximumCoordinateMagnitudeMm ||
        Math.abs(yMm) > maximumCoordinateMagnitudeMm,
    )
  ) {
    return { code: "NUMERIC_RANGE_EXCEEDED", ok: false };
  }
  const keys = points.map(({ xMm, yMm }) => `${String(xMm)}:${String(yMm)}`);
  if (new Set(keys).size !== keys.length) return { code: "MALFORMED_GEOMETRY", ok: false };
  const polygon = points.map(({ xMm, yMm }) => ({
    x: BigInt(xMm) * coordinateScale,
    y: BigInt(yMm) * coordinateScale,
  }));
  if (rawAreaTwice(polygon) === 0n) return { code: "MALFORMED_GEOMETRY", ok: false };
  const polygonEdges = edges(polygon);
  for (let leftIndex = 0; leftIndex < polygonEdges.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < polygonEdges.length; rightIndex += 1) {
      if (
        rightIndex === leftIndex + 1 ||
        (leftIndex === 0 && rightIndex === polygonEdges.length - 1)
      ) {
        continue;
      }
      const left = polygonEdges[leftIndex];
      const right = polygonEdges[rightIndex];
      if (left === undefined || right === undefined) continue;
      if (segmentIntersection(...left, ...right) !== "none") {
        return { code: "MALFORMED_GEOMETRY", ok: false };
      }
    }
  }
  return { ok: true, polygon: Object.freeze(polygon.map((point) => Object.freeze(point))) };
}

export function manhattanDistanceMm(
  left: { readonly xMm: number; readonly yMm: number },
  right: { readonly xMm: number; readonly yMm: number },
): number {
  return Math.abs(left.xMm - right.xMm) + Math.abs(left.yMm - right.yMm);
}

export function normalizedRotationMilliDegrees(rotationMilliDegrees: number): number {
  return normalizeRotation(rotationMilliDegrees);
}
