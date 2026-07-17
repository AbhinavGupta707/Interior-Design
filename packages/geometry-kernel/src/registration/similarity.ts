import { applyFixedSimilarityTransform, fixedSimilarityFromFloating } from "./fixed-point.js";
import {
  compareText,
  deepFreeze,
  defaultCoordinateLimitMm,
  failure,
  hasOnlyKeys,
  isBoundedIdentifier,
  quantileNearestRank,
  success,
} from "./internal.js";
import type {
  Point3Mm,
  RegistrationComputation,
  RegistrationCorrespondence,
  RegistrationEstimationConfig,
  RegistrationResidualSummary,
  SimilarityRegistrationResult,
} from "./types.js";
import { fixedSimilarityVersion, registrationKernelVersion } from "./types.js";

export const defaultRegistrationEstimationConfig: RegistrationEstimationConfig = deepFreeze({
  coordinateLimitMm: defaultCoordinateLimitMm,
  inlierThresholdMm: 50,
  maximumCorrespondences: 256,
  maximumHypotheses: 1_024,
  maximumScalePartsPerMillion: 10_000_000,
  minimumInliers: 3,
  minimumScalePartsPerMillion: 100_000,
  minimumTriangleAreaSquared: 1e-24,
  reflectionPairAgreementBasisPoints: 10_000,
  seed: 0x9c9f_51a7,
  version: registrationKernelVersion,
});

interface FloatingSimilarity {
  readonly quaternion: readonly [number, number, number, number];
  readonly rotation: readonly (readonly [number, number, number])[];
  readonly scale: number;
  readonly translation: readonly [number, number, number];
}

interface Candidate {
  readonly inlierIndices: readonly number[];
  readonly medianInlierResidual: number;
  readonly p90InlierResidual: number;
  readonly tieBreakKey: string;
  readonly transform: FloatingSimilarity;
}

const correspondenceKeys = new Set([
  "confidenceBasisPoints",
  "correspondenceId",
  "sourcePoint",
  "targetPoint",
]);
const pointKeys = new Set(["xMm", "yMm", "zMm"]);

const configKeys = new Set<keyof RegistrationEstimationConfig>([
  "coordinateLimitMm",
  "inlierThresholdMm",
  "maximumCorrespondences",
  "maximumHypotheses",
  "maximumScalePartsPerMillion",
  "minimumInliers",
  "minimumScalePartsPerMillion",
  "minimumTriangleAreaSquared",
  "reflectionPairAgreementBasisPoints",
  "seed",
  "version",
]);

function resolveConfig(
  input: Partial<RegistrationEstimationConfig> | undefined,
): RegistrationComputation<RegistrationEstimationConfig> {
  if (input !== undefined) {
    const unknown = Object.keys(input).find(
      (key) => !configKeys.has(key as keyof RegistrationEstimationConfig),
    );
    if (unknown !== undefined) {
      return failure(
        "INVALID_CONFIGURATION",
        `Unknown registration configuration field: ${unknown}.`,
      );
    }
  }
  const config = { ...defaultRegistrationEstimationConfig, ...input };
  if (!isRegistrationVersion(config.version)) {
    return failure(
      "INVALID_CONFIGURATION",
      "The registration configuration version is unsupported.",
    );
  }
  const positiveSafeIntegers = [
    config.coordinateLimitMm,
    config.inlierThresholdMm,
    config.maximumCorrespondences,
    config.maximumHypotheses,
    config.maximumScalePartsPerMillion,
    config.minimumInliers,
    config.minimumScalePartsPerMillion,
  ];
  if (positiveSafeIntegers.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    return failure(
      "INVALID_CONFIGURATION",
      "Registration count, scale and distance bounds must be positive safe integers.",
    );
  }
  if (
    config.maximumCorrespondences > 4_096 ||
    config.maximumHypotheses > 65_536 ||
    config.minimumInliers < 3 ||
    config.minimumInliers > config.maximumCorrespondences ||
    config.minimumScalePartsPerMillion > config.maximumScalePartsPerMillion ||
    config.maximumScalePartsPerMillion > 1_000_000_000 ||
    config.coordinateLimitMm > Number.MAX_SAFE_INTEGER
  ) {
    return failure(
      "INVALID_CONFIGURATION",
      "Registration configuration exceeds its bounded domain.",
    );
  }
  if (
    !Number.isFinite(config.minimumTriangleAreaSquared) ||
    config.minimumTriangleAreaSquared <= 0 ||
    config.minimumTriangleAreaSquared > 1
  ) {
    return failure(
      "INVALID_CONFIGURATION",
      "The triangle degeneracy threshold must be finite and in (0, 1].",
    );
  }
  if (
    !Number.isSafeInteger(config.reflectionPairAgreementBasisPoints) ||
    config.reflectionPairAgreementBasisPoints < 5_000 ||
    config.reflectionPairAgreementBasisPoints > 10_000 ||
    !Number.isSafeInteger(config.seed) ||
    config.seed < 0 ||
    config.seed > 0xffff_ffff
  ) {
    return failure("INVALID_CONFIGURATION", "Reflection agreement and seed bounds are invalid.");
  }
  return success(deepFreeze(config));
}

function isRegistrationVersion(value: unknown): boolean {
  return value === registrationKernelVersion;
}

function validateCorrespondences(
  input: readonly RegistrationCorrespondence[],
  config: RegistrationEstimationConfig,
): RegistrationComputation<readonly RegistrationCorrespondence[]> {
  if (input.length < 3) {
    return failure(
      "INSUFFICIENT_CORRESPONDENCES",
      "Free similarity estimation requires at least three correspondences.",
    );
  }
  if (input.length > config.maximumCorrespondences) {
    return failure(
      "RESOURCE_LIMIT_EXCEEDED",
      "Correspondence count exceeds the configured deterministic bound.",
    );
  }
  const ordered = [...input].sort((left, right) => {
    const idOrder = compareText(left.correspondenceId, right.correspondenceId);
    if (idOrder !== 0) return idOrder;
    const leftKey = pointKey(left.sourcePoint) + pointKey(left.targetPoint);
    const rightKey = pointKey(right.sourcePoint) + pointKey(right.targetPoint);
    return compareText(leftKey, rightKey);
  });
  const seen = new Set<string>();
  for (const correspondence of ordered) {
    if (
      !hasOnlyKeys(correspondence, correspondenceKeys) ||
      !hasOnlyKeys(correspondence.sourcePoint, pointKeys) ||
      !hasOnlyKeys(correspondence.targetPoint, pointKeys)
    ) {
      return failure("INVALID_OBSERVATION", "Correspondence objects contain unsupported fields.");
    }
    if (!isBoundedIdentifier(correspondence.correspondenceId)) {
      return failure(
        "INVALID_IDENTIFIER",
        "Correspondence identifiers must be 1-200 character stable safe codes.",
      );
    }
    if (seen.has(correspondence.correspondenceId)) {
      return failure("DUPLICATE_CORRESPONDENCE_ID", "Correspondence identifiers must be unique.");
    }
    seen.add(correspondence.correspondenceId);
    if (
      !Number.isSafeInteger(correspondence.confidenceBasisPoints) ||
      correspondence.confidenceBasisPoints < 1 ||
      correspondence.confidenceBasisPoints > 10_000
    ) {
      return failure(
        "NON_INTEGER_INPUT",
        "Correspondence confidence must be an integer from 1 to 10,000 basis points.",
      );
    }
    for (const point of [correspondence.sourcePoint, correspondence.targetPoint]) {
      const coordinates = [point.xMm, point.yMm, point.zMm];
      if (coordinates.some((coordinate) => !Number.isFinite(coordinate))) {
        return failure("NON_FINITE_INPUT", "Correspondence coordinates must be finite.");
      }
      if (coordinates.some((coordinate) => !Number.isSafeInteger(coordinate))) {
        return failure(
          "NON_INTEGER_INPUT",
          "Correspondence coordinates must be safe-integer millimetres.",
        );
      }
      if (coordinates.some((coordinate) => Math.abs(coordinate) > config.coordinateLimitMm)) {
        return failure(
          "COORDINATE_LIMIT_EXCEEDED",
          "Correspondence coordinates exceed the configured millimetre bound.",
        );
      }
    }
  }
  return success(
    ordered.map((correspondence) => ({
      confidenceBasisPoints: correspondence.confidenceBasisPoints,
      correspondenceId: correspondence.correspondenceId,
      sourcePoint: { ...correspondence.sourcePoint },
      targetPoint: { ...correspondence.targetPoint },
    })),
  );
}

function pointKey(point: Point3Mm): string {
  return `${String(point.xMm)},${String(point.yMm)},${String(point.zMm)}`;
}

function subtract(left: readonly number[], right: readonly number[]): [number, number, number] {
  return [
    (left[0] ?? 0) - (right[0] ?? 0),
    (left[1] ?? 0) - (right[1] ?? 0),
    (left[2] ?? 0) - (right[2] ?? 0),
  ];
}

function cross(left: readonly number[], right: readonly number[]): [number, number, number] {
  return [
    (left[1] ?? 0) * (right[2] ?? 0) - (left[2] ?? 0) * (right[1] ?? 0),
    (left[2] ?? 0) * (right[0] ?? 0) - (left[0] ?? 0) * (right[2] ?? 0),
    (left[0] ?? 0) * (right[1] ?? 0) - (left[1] ?? 0) * (right[0] ?? 0),
  ];
}

function dot(left: readonly number[], right: readonly number[]): number {
  return (
    (left[0] ?? 0) * (right[0] ?? 0) +
    (left[1] ?? 0) * (right[1] ?? 0) +
    (left[2] ?? 0) * (right[2] ?? 0)
  );
}

function normSquared(vector: readonly number[]): number {
  return dot(vector, vector);
}

function hasNonCollinearTriangle(
  correspondences: readonly RegistrationCorrespondence[],
  indices: readonly number[],
  coordinateLimitMm: number,
  minimumAreaSquared: number,
): boolean {
  const first = correspondences[indices[0] ?? -1];
  const second = correspondences[indices[1] ?? -1];
  const third = correspondences[indices[2] ?? -1];
  if (first === undefined || second === undefined || third === undefined) return false;
  for (const selector of [
    (item: RegistrationCorrespondence) => item.sourcePoint,
    (item: RegistrationCorrespondence) => item.targetPoint,
  ]) {
    const firstPoint = selector(first);
    const secondPoint = selector(second);
    const thirdPoint = selector(third);
    const a = [firstPoint.xMm, firstPoint.yMm, firstPoint.zMm].map(
      (value) => value / coordinateLimitMm,
    );
    const b = [secondPoint.xMm, secondPoint.yMm, secondPoint.zMm].map(
      (value) => value / coordinateLimitMm,
    );
    const c = [thirdPoint.xMm, thirdPoint.yMm, thirdPoint.zMm].map(
      (value) => value / coordinateLimitMm,
    );
    if (normSquared(cross(subtract(b, a), subtract(c, a))) <= minimumAreaSquared) return false;
  }
  return true;
}

function largestEigenvectorSymmetric4(
  matrix: readonly (readonly number[])[],
): readonly [number, number, number, number] {
  const values = matrix.map((row) => [...row]);
  const vectors: number[][] = Array.from({ length: 4 }, (_, row) =>
    Array.from({ length: 4 }, (_, column) => (row === column ? 1 : 0)),
  );
  for (let sweep = 0; sweep < 64; sweep += 1) {
    let p = 0;
    let q = 1;
    let maximum = 0;
    for (let row = 0; row < 4; row += 1) {
      for (let column = row + 1; column < 4; column += 1) {
        const magnitude = Math.abs(values[row]?.[column] ?? 0);
        if (magnitude > maximum) {
          maximum = magnitude;
          p = row;
          q = column;
        }
      }
    }
    if (maximum <= 1e-15) break;
    const app = values[p]?.[p] ?? 0;
    const aqq = values[q]?.[q] ?? 0;
    const apq = values[p]?.[q] ?? 0;
    const angle = 0.5 * Math.atan2(2 * apq, aqq - app);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    for (let index = 0; index < 4; index += 1) {
      if (index === p || index === q) continue;
      const aip = values[index]?.[p] ?? 0;
      const aiq = values[index]?.[q] ?? 0;
      const nextP = cosine * aip - sine * aiq;
      const nextQ = sine * aip + cosine * aiq;
      const valueRow = values[index];
      if (valueRow !== undefined) {
        valueRow[p] = nextP;
        valueRow[q] = nextQ;
      }
      const pRow = values[p];
      const qRow = values[q];
      if (pRow !== undefined) pRow[index] = nextP;
      if (qRow !== undefined) qRow[index] = nextQ;
    }
    const pRow = values[p];
    const qRow = values[q];
    if (pRow !== undefined && qRow !== undefined) {
      pRow[p] = cosine * cosine * app - 2 * sine * cosine * apq + sine * sine * aqq;
      qRow[q] = sine * sine * app + 2 * sine * cosine * apq + cosine * cosine * aqq;
      pRow[q] = 0;
      qRow[p] = 0;
    }
    for (let row = 0; row < 4; row += 1) {
      const vip = vectors[row]?.[p] ?? 0;
      const viq = vectors[row]?.[q] ?? 0;
      const vectorRow = vectors[row];
      if (vectorRow !== undefined) {
        vectorRow[p] = cosine * vip - sine * viq;
        vectorRow[q] = sine * vip + cosine * viq;
      }
    }
  }
  let largest = 0;
  for (let index = 1; index < 4; index += 1) {
    if ((values[index]?.[index] ?? -Infinity) > (values[largest]?.[largest] ?? -Infinity))
      largest = index;
  }
  const result = [0, 1, 2, 3].map((row) => vectors[row]?.[largest] ?? 0);
  const magnitude = Math.hypot(...result);
  let normalized = result.map((component) => component / magnitude);
  const firstNonZero = normalized.find((component) => Math.abs(component) > 1e-15);
  if (firstNonZero !== undefined && firstNonZero < 0)
    normalized = normalized.map((value) => -value);
  return [normalized[0] ?? 1, normalized[1] ?? 0, normalized[2] ?? 0, normalized[3] ?? 0];
}

function rotationFromQuaternion(
  quaternion: readonly [number, number, number, number],
): readonly (readonly [number, number, number])[] {
  const [w, x, y, z] = quaternion;
  return [
    [w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z],
  ];
}

function rotate(
  rotation: readonly (readonly number[])[],
  point: readonly number[],
): [number, number, number] {
  return [
    dot(rotation[0] ?? [], point),
    dot(rotation[1] ?? [], point),
    dot(rotation[2] ?? [], point),
  ];
}

function estimateLeastSquares(
  correspondences: readonly RegistrationCorrespondence[],
  indices: readonly number[],
  coordinateLimitMm: number,
): FloatingSimilarity | undefined {
  let weightSum = 0;
  const sourceCentroid = [0, 0, 0];
  const targetCentroid = [0, 0, 0];
  for (const index of indices) {
    const item = correspondences[index];
    if (item === undefined) return undefined;
    const weight = item.confidenceBasisPoints / 10_000;
    weightSum += weight;
    const source = [item.sourcePoint.xMm, item.sourcePoint.yMm, item.sourcePoint.zMm];
    const target = [item.targetPoint.xMm, item.targetPoint.yMm, item.targetPoint.zMm];
    for (let axis = 0; axis < 3; axis += 1) {
      sourceCentroid[axis] = (sourceCentroid[axis] ?? 0) + (source[axis] ?? 0) * weight;
      targetCentroid[axis] = (targetCentroid[axis] ?? 0) + (target[axis] ?? 0) * weight;
    }
  }
  if (!Number.isFinite(weightSum) || weightSum <= 0) return undefined;
  for (let axis = 0; axis < 3; axis += 1) {
    sourceCentroid[axis] = (sourceCentroid[axis] ?? 0) / weightSum;
    targetCentroid[axis] = (targetCentroid[axis] ?? 0) / weightSum;
  }
  const covariance = Array.from({ length: 3 }, () => [0, 0, 0]);
  let sourceVariance = 0;
  for (const index of indices) {
    const item = correspondences[index];
    if (item === undefined) return undefined;
    const weight = item.confidenceBasisPoints / 10_000;
    const source = subtract(
      [item.sourcePoint.xMm, item.sourcePoint.yMm, item.sourcePoint.zMm],
      sourceCentroid,
    ).map((value) => value / coordinateLimitMm);
    const target = subtract(
      [item.targetPoint.xMm, item.targetPoint.yMm, item.targetPoint.zMm],
      targetCentroid,
    ).map((value) => value / coordinateLimitMm);
    sourceVariance += weight * normSquared(source);
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        const covarianceRow = covariance[row];
        if (covarianceRow !== undefined) {
          covarianceRow[column] =
            (covarianceRow[column] ?? 0) + weight * (source[row] ?? 0) * (target[column] ?? 0);
        }
      }
    }
  }
  if (!Number.isFinite(sourceVariance) || sourceVariance <= 1e-24) return undefined;
  const sxx = covariance[0]?.[0] ?? 0;
  const sxy = covariance[0]?.[1] ?? 0;
  const sxz = covariance[0]?.[2] ?? 0;
  const syx = covariance[1]?.[0] ?? 0;
  const syy = covariance[1]?.[1] ?? 0;
  const syz = covariance[1]?.[2] ?? 0;
  const szx = covariance[2]?.[0] ?? 0;
  const szy = covariance[2]?.[1] ?? 0;
  const szz = covariance[2]?.[2] ?? 0;
  const quaternion = largestEigenvectorSymmetric4([
    [sxx + syy + szz, syz - szy, szx - sxz, sxy - syx],
    [syz - szy, sxx - syy - szz, sxy + syx, szx + sxz],
    [szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy],
    [sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz],
  ]);
  const rotation = rotationFromQuaternion(quaternion);
  let numerator = 0;
  for (const index of indices) {
    const item = correspondences[index];
    if (item === undefined) return undefined;
    const weight = item.confidenceBasisPoints / 10_000;
    const source = subtract(
      [item.sourcePoint.xMm, item.sourcePoint.yMm, item.sourcePoint.zMm],
      sourceCentroid,
    ).map((value) => value / coordinateLimitMm);
    const target = subtract(
      [item.targetPoint.xMm, item.targetPoint.yMm, item.targetPoint.zMm],
      targetCentroid,
    ).map((value) => value / coordinateLimitMm);
    numerator += weight * dot(target, rotate(rotation, source));
  }
  const scale = numerator / sourceVariance;
  const rotatedCentroid = rotate(rotation, sourceCentroid);
  const translation: [number, number, number] = [
    (targetCentroid[0] ?? 0) - scale * rotatedCentroid[0],
    (targetCentroid[1] ?? 0) - scale * rotatedCentroid[1],
    (targetCentroid[2] ?? 0) - scale * rotatedCentroid[2],
  ];
  if (![scale, ...translation].every(Number.isFinite)) return undefined;
  return { quaternion, rotation, scale, translation };
}

function floatingResidual(
  transform: FloatingSimilarity,
  correspondence: RegistrationCorrespondence,
): number {
  const rotated = rotate(transform.rotation, [
    correspondence.sourcePoint.xMm,
    correspondence.sourcePoint.yMm,
    correspondence.sourcePoint.zMm,
  ]);
  return Math.hypot(
    transform.scale * rotated[0] + transform.translation[0] - correspondence.targetPoint.xMm,
    transform.scale * rotated[1] + transform.translation[1] - correspondence.targetPoint.yMm,
    transform.scale * rotated[2] + transform.translation[2] - correspondence.targetPoint.zMm,
  );
}

function combinationCount(count: number): number {
  return (count * (count - 1) * (count - 2)) / 6;
}

function makePrng(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) state = 0x6d2b_79f5;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

function hypothesisTriples(
  count: number,
  maximum: number,
  seed: number,
): readonly (readonly number[])[] {
  const total = combinationCount(count);
  const triples: number[][] = [];
  if (total <= maximum) {
    for (let first = 0; first < count - 2; first += 1) {
      for (let second = first + 1; second < count - 1; second += 1) {
        for (let third = second + 1; third < count; third += 1)
          triples.push([first, second, third]);
      }
    }
    return triples;
  }
  const seen = new Set<string>();
  const add = (values: readonly number[]): void => {
    const ordered = [...values].sort((left, right) => left - right);
    if (new Set(ordered).size !== 3) return;
    const key = ordered.join(":");
    if (!seen.has(key)) {
      seen.add(key);
      triples.push(ordered);
    }
  };
  add([0, Math.floor((count - 1) / 2), count - 1]);
  const random = makePrng(seed);
  const attemptLimit = maximum * 32;
  for (let attempt = 0; triples.length < maximum && attempt < attemptLimit; attempt += 1) {
    add([random() % count, random() % count, random() % count]);
  }
  return triples;
}

function betterCandidate(candidate: Candidate, current: Candidate | undefined): boolean {
  if (current === undefined) return true;
  if (candidate.inlierIndices.length !== current.inlierIndices.length) {
    return candidate.inlierIndices.length > current.inlierIndices.length;
  }
  if (candidate.medianInlierResidual !== current.medianInlierResidual) {
    return candidate.medianInlierResidual < current.medianInlierResidual;
  }
  if (candidate.p90InlierResidual !== current.p90InlierResidual) {
    return candidate.p90InlierResidual < current.p90InlierResidual;
  }
  return compareText(candidate.tieBreakKey, current.tieBreakKey) < 0;
}

function determinant3(matrix: readonly (readonly number[])[]): number {
  const a = matrix[0]?.[0] ?? 0;
  const b = matrix[0]?.[1] ?? 0;
  const c = matrix[0]?.[2] ?? 0;
  const d = matrix[1]?.[0] ?? 0;
  const e = matrix[1]?.[1] ?? 0;
  const f = matrix[1]?.[2] ?? 0;
  const g = matrix[2]?.[0] ?? 0;
  const h = matrix[2]?.[1] ?? 0;
  const i = matrix[2]?.[2] ?? 0;
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

function centeredCovarianceDeterminant(
  correspondences: readonly RegistrationCorrespondence[],
  selector: "cross" | "source" | "target",
  coordinateLimitMm: number,
): number {
  const sourceCentroid = [0, 0, 0];
  const targetCentroid = [0, 0, 0];
  for (const item of correspondences) {
    for (let axis = 0; axis < 3; axis += 1) {
      sourceCentroid[axis] =
        (sourceCentroid[axis] ?? 0) +
        ([item.sourcePoint.xMm, item.sourcePoint.yMm, item.sourcePoint.zMm][axis] ?? 0) /
          correspondences.length;
      targetCentroid[axis] =
        (targetCentroid[axis] ?? 0) +
        ([item.targetPoint.xMm, item.targetPoint.yMm, item.targetPoint.zMm][axis] ?? 0) /
          correspondences.length;
    }
  }
  const matrix = Array.from({ length: 3 }, () => [0, 0, 0]);
  for (const item of correspondences) {
    const source = subtract(
      [item.sourcePoint.xMm, item.sourcePoint.yMm, item.sourcePoint.zMm],
      sourceCentroid,
    ).map((value) => value / coordinateLimitMm);
    const target = subtract(
      [item.targetPoint.xMm, item.targetPoint.yMm, item.targetPoint.zMm],
      targetCentroid,
    ).map((value) => value / coordinateLimitMm);
    const left = selector === "target" ? target : source;
    const right = selector === "source" ? source : target;
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        const matrixRow = matrix[row];
        if (matrixRow !== undefined) {
          matrixRow[column] = (matrixRow[column] ?? 0) + (left[row] ?? 0) * (right[column] ?? 0);
        }
      }
    }
  }
  return determinant3(matrix);
}

function isGloballyReflected(
  correspondences: readonly RegistrationCorrespondence[],
  config: RegistrationEstimationConfig,
): boolean {
  if (correspondences.length < 4) return false;
  const sourceRank = Math.abs(
    centeredCovarianceDeterminant(correspondences, "source", config.coordinateLimitMm),
  );
  const targetRank = Math.abs(
    centeredCovarianceDeterminant(correspondences, "target", config.coordinateLimitMm),
  );
  const crossDeterminant = centeredCovarianceDeterminant(
    correspondences,
    "cross",
    config.coordinateLimitMm,
  );
  if (sourceRank <= 1e-30 || targetRank <= 1e-30 || crossDeterminant >= -1e-30) return false;
  const ratios: number[] = [];
  const pairs: { sourceDistance: number; targetDistance: number }[] = [];
  for (let first = 0; first < correspondences.length - 1; first += 1) {
    for (let second = first + 1; second < correspondences.length; second += 1) {
      const left = correspondences[first];
      const right = correspondences[second];
      if (left === undefined || right === undefined) continue;
      const sourceDistance = Math.hypot(
        left.sourcePoint.xMm - right.sourcePoint.xMm,
        left.sourcePoint.yMm - right.sourcePoint.yMm,
        left.sourcePoint.zMm - right.sourcePoint.zMm,
      );
      const targetDistance = Math.hypot(
        left.targetPoint.xMm - right.targetPoint.xMm,
        left.targetPoint.yMm - right.targetPoint.yMm,
        left.targetPoint.zMm - right.targetPoint.zMm,
      );
      if (sourceDistance > 0) {
        ratios.push(targetDistance / sourceDistance);
        pairs.push({ sourceDistance, targetDistance });
      }
    }
  }
  ratios.sort((left, right) => left - right);
  const scale = quantileNearestRank(ratios, 50);
  const agreeing = pairs.filter(
    ({ sourceDistance, targetDistance }) =>
      Math.abs(targetDistance - scale * sourceDistance) <= config.inlierThresholdMm,
  ).length;
  return agreeing * 10_000 >= pairs.length * config.reflectionPairAgreementBasisPoints;
}

function residualSummary(
  residuals: readonly number[],
  inlierCount: number,
): RegistrationResidualSummary {
  const ordered = [...residuals].sort((left, right) => left - right);
  return deepFreeze({
    inlierCount,
    maximumMm: ordered.at(-1) ?? 0,
    medianMm: quantileNearestRank(ordered, 50),
    p90Mm: quantileNearestRank(ordered, 90),
    sampleCount: ordered.length,
  });
}

export function estimateFreeSimilarityTransform(
  correspondences: readonly RegistrationCorrespondence[],
  configInput?: Partial<RegistrationEstimationConfig>,
): RegistrationComputation<SimilarityRegistrationResult> {
  const configResult = resolveConfig(configInput);
  if (!configResult.ok) return configResult;
  const config = configResult.value;
  const input = validateCorrespondences(correspondences, config);
  if (!input.ok) return input;
  const ordered = input.value;
  if (config.minimumInliers > ordered.length) {
    return failure(
      "INVALID_CONFIGURATION",
      "Minimum inliers cannot exceed the supplied correspondence count.",
    );
  }
  if (isGloballyReflected(ordered, config)) {
    return failure(
      "REFLECTION_REJECTED",
      "A distance-consistent orientation-reversing correspondence set was rejected.",
    );
  }

  let best: Candidate | undefined;
  let nonDegenerateHypothesisCount = 0;
  for (const indices of hypothesisTriples(ordered.length, config.maximumHypotheses, config.seed)) {
    if (
      !hasNonCollinearTriangle(
        ordered,
        indices,
        config.coordinateLimitMm,
        config.minimumTriangleAreaSquared,
      )
    ) {
      continue;
    }
    nonDegenerateHypothesisCount += 1;
    const transform = estimateLeastSquares(ordered, indices, config.coordinateLimitMm);
    if (transform === undefined || transform.scale <= 0) continue;
    const scalePpm = Math.round(transform.scale * 1_000_000);
    if (
      scalePpm < config.minimumScalePartsPerMillion ||
      scalePpm > config.maximumScalePartsPerMillion
    ) {
      continue;
    }
    const residuals = ordered.map((item) => floatingResidual(transform, item));
    if (residuals.some((residual) => !Number.isFinite(residual))) continue;
    const inlierIndices = residuals
      .map((residual, index) => ({ index, residual }))
      .filter(({ residual }) => residual <= config.inlierThresholdMm)
      .map(({ index }) => index);
    if (inlierIndices.length < 3) continue;
    const inlierResiduals = inlierIndices
      .map((index) => residuals[index] ?? Number.POSITIVE_INFINITY)
      .sort((left, right) => left - right);
    const candidate: Candidate = {
      inlierIndices,
      medianInlierResidual: quantileNearestRank(inlierResiduals, 50),
      p90InlierResidual: quantileNearestRank(inlierResiduals, 90),
      tieBreakKey: indices.map((index) => ordered[index]?.correspondenceId ?? "").join(":"),
      transform,
    };
    if (betterCandidate(candidate, best)) best = candidate;
  }
  if (nonDegenerateHypothesisCount === 0) {
    return failure(
      "DEGENERATE_CORRESPONDENCES",
      "No source/target anchor triple is independently non-collinear.",
    );
  }
  if (best === undefined || best.inlierIndices.length < config.minimumInliers) {
    const unconstrained = estimateLeastSquares(
      ordered,
      Array.from({ length: ordered.length }, (_, index) => index),
      config.coordinateLimitMm,
    );
    if (unconstrained !== undefined) {
      const scalePpm = Math.round(unconstrained.scale * 1_000_000);
      if (
        scalePpm < config.minimumScalePartsPerMillion ||
        scalePpm > config.maximumScalePartsPerMillion
      ) {
        return failure(
          "SCALE_OUT_OF_RANGE",
          "All viable similarity estimates violate configured scale bounds.",
        );
      }
    }
    return failure(
      "INSUFFICIENT_INLIERS",
      "Robust estimation found too few mutually consistent correspondences.",
    );
  }
  const refined = estimateLeastSquares(ordered, best.inlierIndices, config.coordinateLimitMm);
  if (refined === undefined) {
    return failure("DEGENERATE_CORRESPONDENCES", "The robust inlier set is rank deficient.");
  }
  const scalePpm = Math.round(refined.scale * 1_000_000);
  if (
    scalePpm < config.minimumScalePartsPerMillion ||
    scalePpm > config.maximumScalePartsPerMillion
  ) {
    return failure("SCALE_OUT_OF_RANGE", "Estimated similarity scale violates configured bounds.");
  }
  const durable = fixedSimilarityFromFloating(
    refined.quaternion,
    refined.scale,
    refined.translation,
    config.coordinateLimitMm,
  );
  if (!durable.ok) return durable;
  const durableResiduals: number[] = [];
  for (const item of ordered) {
    const transformed = applyFixedSimilarityTransform(
      durable.value,
      item.sourcePoint,
      config.coordinateLimitMm,
    );
    if (!transformed.ok) return transformed;
    const distance = Math.hypot(
      transformed.value.xMm - item.targetPoint.xMm,
      transformed.value.yMm - item.targetPoint.yMm,
      transformed.value.zMm - item.targetPoint.zMm,
    );
    if (!Number.isFinite(distance) || distance > Number.MAX_SAFE_INTEGER) {
      return failure("OUTPUT_OVERFLOW", "Residual computation exceeded bounded finite output.");
    }
    durableResiduals.push(Math.round(distance));
  }
  const inlierCorrespondenceIds = ordered
    .filter((_, index) => (durableResiduals[index] ?? Infinity) <= config.inlierThresholdMm)
    .map(({ correspondenceId }) => correspondenceId);
  if (inlierCorrespondenceIds.length < config.minimumInliers) {
    return failure("INSUFFICIENT_INLIERS", "Fixed-point quantisation left too few inliers.");
  }
  const inlierSet = new Set(inlierCorrespondenceIds);
  return success(
    deepFreeze({
      algorithmVersion: registrationKernelVersion,
      config,
      inlierCorrespondenceIds,
      outlierCorrespondenceIds: ordered
        .filter(({ correspondenceId }) => !inlierSet.has(correspondenceId))
        .map(({ correspondenceId }) => correspondenceId),
      residuals: residualSummary(durableResiduals, inlierCorrespondenceIds.length),
      seed: config.seed,
      transform: durable.value,
      transformVersion: fixedSimilarityVersion,
    }),
  );
}
