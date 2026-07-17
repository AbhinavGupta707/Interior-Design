import type {
  IntegerComputation,
  IntegerLengthBoundsMm,
  Orientation2d,
  Point2Mm,
  SegmentIntersectionKind,
} from "./types.js";

const maximumSafeInteger = BigInt(Number.MAX_SAFE_INTEGER);

function failure(
  code: "SAFE_INTEGER_RANGE_EXCEEDED" | "UNSAFE_INTEGER_INPUT",
  message: string,
): IntegerComputation<never> {
  return Object.freeze({ code, message, ok: false });
}

function success<TValue>(value: TValue): IntegerComputation<TValue> {
  return Object.freeze({ ok: true, value });
}

function isSafeIntegerPoint(point: Point2Mm): boolean {
  return Number.isSafeInteger(point.xMm) && Number.isSafeInteger(point.yMm);
}

function safeBigIntToNumber(value: bigint, operation: string): IntegerComputation<number> {
  if (value > maximumSafeInteger || value < -maximumSafeInteger) {
    return failure(
      "SAFE_INTEGER_RANGE_EXCEEDED",
      `${operation} exceeds the JavaScript safe-integer range.`,
    );
  }
  return success(Number(value));
}

export function checkedAdd(left: number, right: number): IntegerComputation<number> {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) {
    return failure("UNSAFE_INTEGER_INPUT", "Addition requires safe-integer operands.");
  }
  return safeBigIntToNumber(BigInt(left) + BigInt(right), "Addition");
}

export function checkedSubtract(left: number, right: number): IntegerComputation<number> {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) {
    return failure("UNSAFE_INTEGER_INPUT", "Subtraction requires safe-integer operands.");
  }
  return safeBigIntToNumber(BigInt(left) - BigInt(right), "Subtraction");
}

export function checkedMultiply(left: number, right: number): IntegerComputation<number> {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) {
    return failure("UNSAFE_INTEGER_INPUT", "Multiplication requires safe-integer operands.");
  }
  return safeBigIntToNumber(BigInt(left) * BigInt(right), "Multiplication");
}

export function orientation2d(
  first: Point2Mm,
  second: Point2Mm,
  third: Point2Mm,
): IntegerComputation<Orientation2d> {
  if (!isSafeIntegerPoint(first) || !isSafeIntegerPoint(second) || !isSafeIntegerPoint(third)) {
    return failure("UNSAFE_INTEGER_INPUT", "Orientation requires safe-integer coordinates.");
  }

  const firstDx = BigInt(second.xMm) - BigInt(first.xMm);
  const firstDy = BigInt(second.yMm) - BigInt(first.yMm);
  const secondDx = BigInt(third.xMm) - BigInt(first.xMm);
  const secondDy = BigInt(third.yMm) - BigInt(first.yMm);
  const differences = [firstDx, firstDy, secondDx, secondDy];
  if (differences.some((value) => value > maximumSafeInteger || value < -maximumSafeInteger)) {
    return failure(
      "SAFE_INTEGER_RANGE_EXCEEDED",
      "Orientation coordinate differences exceed the JavaScript safe-integer range.",
    );
  }

  const leftProduct = firstDx * secondDy;
  const rightProduct = firstDy * secondDx;
  const determinant = leftProduct - rightProduct;
  if (
    [leftProduct, rightProduct, determinant].some(
      (value) => value > maximumSafeInteger || value < -maximumSafeInteger,
    )
  ) {
    return failure(
      "SAFE_INTEGER_RANGE_EXCEEDED",
      "Orientation determinant exceeds the JavaScript safe-integer range.",
    );
  }

  const value: Orientation2d = determinant === 0n ? 0 : determinant > 0n ? 1 : -1;
  return success(value);
}

function pointWithinInclusiveBounds(point: Point2Mm, start: Point2Mm, end: Point2Mm): boolean {
  return (
    point.xMm >= Math.min(start.xMm, end.xMm) &&
    point.xMm <= Math.max(start.xMm, end.xMm) &&
    point.yMm >= Math.min(start.yMm, end.yMm) &&
    point.yMm <= Math.max(start.yMm, end.yMm)
  );
}

function pointKey(point: Point2Mm): string {
  return `${String(point.xMm)},${String(point.yMm)}`;
}

export function segmentsIntersect2d(
  firstStart: Point2Mm,
  firstEnd: Point2Mm,
  secondStart: Point2Mm,
  secondEnd: Point2Mm,
): IntegerComputation<SegmentIntersectionKind> {
  const orientations = [
    orientation2d(firstStart, firstEnd, secondStart),
    orientation2d(firstStart, firstEnd, secondEnd),
    orientation2d(secondStart, secondEnd, firstStart),
    orientation2d(secondStart, secondEnd, firstEnd),
  ] as const;
  const [firstToStartResult, firstToEndResult, secondToStartResult, secondToEndResult] =
    orientations;
  if (!firstToStartResult.ok) return firstToStartResult;
  if (!firstToEndResult.ok) return firstToEndResult;
  if (!secondToStartResult.ok) return secondToStartResult;
  if (!secondToEndResult.ok) return secondToEndResult;
  const firstToStart = firstToStartResult.value;
  const firstToEnd = firstToEndResult.value;
  const secondToStart = secondToStartResult.value;
  const secondToEnd = secondToEndResult.value;

  if (firstToStart === 0 && firstToEnd === 0 && secondToStart === 0 && secondToEnd === 0) {
    const sharedPoints = [firstStart, firstEnd, secondStart, secondEnd].filter(
      (point, index, points) =>
        pointWithinInclusiveBounds(point, firstStart, firstEnd) &&
        pointWithinInclusiveBounds(point, secondStart, secondEnd) &&
        points.findIndex((candidate) => pointKey(candidate) === pointKey(point)) === index,
    );
    return success(
      sharedPoints.length === 0 ? "none" : sharedPoints.length === 1 ? "touch" : "overlap",
    );
  }

  const firstStraddles =
    (firstToStart === -1 && firstToEnd === 1) || (firstToStart === 1 && firstToEnd === -1);
  const secondStraddles =
    (secondToStart === -1 && secondToEnd === 1) || (secondToStart === 1 && secondToEnd === -1);
  if (firstStraddles && secondStraddles) {
    return success("cross");
  }
  if (
    (firstToStart === 0 && pointWithinInclusiveBounds(secondStart, firstStart, firstEnd)) ||
    (firstToEnd === 0 && pointWithinInclusiveBounds(secondEnd, firstStart, firstEnd)) ||
    (secondToStart === 0 && pointWithinInclusiveBounds(firstStart, secondStart, secondEnd)) ||
    (secondToEnd === 0 && pointWithinInclusiveBounds(firstEnd, secondStart, secondEnd))
  ) {
    return success("touch");
  }
  return success("none");
}

export function signedDoubleArea2d(points: readonly Point2Mm[]): IntegerComputation<number> {
  if (points.some((point) => !isSafeIntegerPoint(point))) {
    return failure("UNSAFE_INTEGER_INPUT", "Polygon area requires safe-integer coordinates.");
  }
  if (points.length < 3) {
    return success(0);
  }

  let sum = 0n;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    if (point === undefined || next === undefined) {
      return failure("UNSAFE_INTEGER_INPUT", "Polygon area received an incomplete point path.");
    }
    const leftProduct = BigInt(point.xMm) * BigInt(next.yMm);
    const rightProduct = BigInt(point.yMm) * BigInt(next.xMm);
    if (
      leftProduct > maximumSafeInteger ||
      leftProduct < -maximumSafeInteger ||
      rightProduct > maximumSafeInteger ||
      rightProduct < -maximumSafeInteger
    ) {
      return failure(
        "SAFE_INTEGER_RANGE_EXCEEDED",
        "Polygon area products exceed the JavaScript safe-integer range.",
      );
    }
    sum += leftProduct - rightProduct;
  }
  return safeBigIntToNumber(sum, "Signed doubled polygon area");
}

function integerSquareRoot(value: bigint): bigint {
  if (value < 2n) {
    return value;
  }
  let current = value;
  let next = (current + value / current) / 2n;
  while (next < current) {
    current = next;
    next = (current + value / current) / 2n;
  }
  return current;
}

export function polylineLengthBoundsMm(
  points: readonly Point2Mm[],
): IntegerComputation<IntegerLengthBoundsMm> {
  if (points.some((point) => !isSafeIntegerPoint(point))) {
    return failure("UNSAFE_INTEGER_INPUT", "Path length requires safe-integer coordinates.");
  }
  let lowerBound = 0n;
  let upperBound = 0n;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    if (previous === undefined || point === undefined) {
      return failure("UNSAFE_INTEGER_INPUT", "Path length received an incomplete point path.");
    }
    const xDifference = BigInt(point.xMm) - BigInt(previous.xMm);
    const yDifference = BigInt(point.yMm) - BigInt(previous.yMm);
    if (
      xDifference > maximumSafeInteger ||
      xDifference < -maximumSafeInteger ||
      yDifference > maximumSafeInteger ||
      yDifference < -maximumSafeInteger
    ) {
      return failure(
        "SAFE_INTEGER_RANGE_EXCEEDED",
        "Path coordinate differences exceed the JavaScript safe-integer range.",
      );
    }
    const squaredLength = xDifference * xDifference + yDifference * yDifference;
    if (squaredLength > maximumSafeInteger) {
      return failure(
        "SAFE_INTEGER_RANGE_EXCEEDED",
        "Squared path length exceeds the JavaScript safe-integer range.",
      );
    }
    const floorLength = integerSquareRoot(squaredLength);
    const ceilingLength =
      floorLength * floorLength === squaredLength ? floorLength : floorLength + 1n;
    lowerBound += floorLength;
    upperBound += ceilingLength;
    if (lowerBound > maximumSafeInteger || upperBound > maximumSafeInteger) {
      return failure(
        "SAFE_INTEGER_RANGE_EXCEEDED",
        "Accumulated path length exceeds the JavaScript safe-integer range.",
      );
    }
  }
  return success(
    Object.freeze({ lowerBoundMm: Number(lowerBound), upperBoundMm: Number(upperBound) }),
  );
}
