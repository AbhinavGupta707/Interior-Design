import {
  deepFreeze,
  defaultCoordinateLimitMm,
  e9,
  failure,
  hasOnlyKeys,
  ppm,
  roundRatio,
  success,
} from "./internal.js";
import type {
  FixedSimilarityTransform,
  Point3Mm,
  QuaternionE9,
  RegistrationComputation,
} from "./types.js";

const quaternionNormSquared = 1_000_000_000_000_000_000n;
const quaternionNormTolerance = 2_000_000_000_000_000n;
const maximumDurableScalePpm = 1_000_000_000;
const pointKeys = new Set(["xMm", "yMm", "zMm"]);
const quaternionKeys = new Set(["w", "x", "y", "z"]);
const transformKeys = new Set(["rotationQuaternionE9", "scalePartsPerMillion", "translationMm"]);

export const identityFixedSimilarityTransform: FixedSimilarityTransform = deepFreeze({
  rotationQuaternionE9: { w: e9, x: 0, y: 0, z: 0 },
  scalePartsPerMillion: ppm,
  translationMm: { xMm: 0, yMm: 0, zMm: 0 },
});

function pointIsValid(point: Point3Mm, coordinateLimitMm: number): boolean {
  return [point.xMm, point.yMm, point.zMm].every(
    (coordinate) => Number.isSafeInteger(coordinate) && Math.abs(coordinate) <= coordinateLimitMm,
  );
}

function quaternionIsCanonical(quaternion: QuaternionE9): boolean {
  for (const component of [quaternion.w, quaternion.x, quaternion.y, quaternion.z]) {
    if (component !== 0) return component > 0;
  }
  return false;
}

function canonicalQuaternion(quaternion: QuaternionE9): QuaternionE9 {
  if (quaternionIsCanonical(quaternion)) return { ...quaternion };
  return {
    w: -quaternion.w,
    x: quaternion.x === 0 ? 0 : -quaternion.x,
    y: quaternion.y === 0 ? 0 : -quaternion.y,
    z: quaternion.z === 0 ? 0 : -quaternion.z,
  };
}

export function validateFixedSimilarityTransform(
  transform: FixedSimilarityTransform,
  coordinateLimitMm = defaultCoordinateLimitMm,
): RegistrationComputation<FixedSimilarityTransform> {
  if (!Number.isSafeInteger(coordinateLimitMm) || coordinateLimitMm <= 0) {
    return failure(
      "INVALID_CONFIGURATION",
      "The coordinate limit must be a positive safe integer.",
    );
  }
  if (
    !hasOnlyKeys(transform, transformKeys) ||
    !hasOnlyKeys(transform.translationMm, pointKeys) ||
    !hasOnlyKeys(transform.rotationQuaternionE9, quaternionKeys)
  ) {
    return failure("INVALID_FIXED_TRANSFORM", "Transform objects contain unsupported fields.");
  }
  if (!pointIsValid(transform.translationMm, coordinateLimitMm)) {
    return failure(
      "INVALID_FIXED_TRANSFORM",
      "Transform translation must contain bounded safe-integer millimetres.",
    );
  }
  if (
    !Number.isSafeInteger(transform.scalePartsPerMillion) ||
    transform.scalePartsPerMillion <= 0 ||
    transform.scalePartsPerMillion > maximumDurableScalePpm
  ) {
    return failure(
      "INVALID_FIXED_TRANSFORM",
      "Transform scale must be a positive bounded safe-integer parts-per-million value.",
    );
  }
  const quaternion = transform.rotationQuaternionE9;
  const components = [quaternion.w, quaternion.x, quaternion.y, quaternion.z];
  if (
    components.some((component) => !Number.isSafeInteger(component) || Math.abs(component) > e9)
  ) {
    return failure(
      "INVALID_FIXED_TRANSFORM",
      "Transform quaternion must contain bounded safe-integer E9 components.",
    );
  }
  const norm = components.reduce(
    (sum, component) => sum + BigInt(component) * BigInt(component),
    0n,
  );
  const difference =
    norm > quaternionNormSquared ? norm - quaternionNormSquared : quaternionNormSquared - norm;
  if (difference > quaternionNormTolerance) {
    return failure(
      "INVALID_FIXED_TRANSFORM",
      "Transform quaternion is not unit length within E9 tolerance.",
    );
  }
  return success(
    deepFreeze({
      rotationQuaternionE9: canonicalQuaternion(quaternion),
      scalePartsPerMillion: transform.scalePartsPerMillion,
      translationMm: { ...transform.translationMm },
    }),
  );
}

function boundedBigIntPoint(
  xMm: bigint,
  yMm: bigint,
  zMm: bigint,
  coordinateLimitMm: number,
): RegistrationComputation<Point3Mm> {
  const limit = BigInt(coordinateLimitMm);
  if ([xMm, yMm, zMm].some((coordinate) => coordinate > limit || coordinate < -limit)) {
    return failure(
      "OUTPUT_OVERFLOW",
      "Transformed coordinates exceed the configured millimetre limit.",
    );
  }
  return success({ xMm: Number(xMm), yMm: Number(yMm), zMm: Number(zMm) });
}

export function applyFixedSimilarityTransform(
  transform: FixedSimilarityTransform,
  point: Point3Mm,
  coordinateLimitMm = defaultCoordinateLimitMm,
): RegistrationComputation<Point3Mm> {
  const checkedTransform = validateFixedSimilarityTransform(transform, coordinateLimitMm);
  if (!checkedTransform.ok) return checkedTransform;
  if (!hasOnlyKeys(point, pointKeys) || !pointIsValid(point, coordinateLimitMm)) {
    return failure(
      "COORDINATE_LIMIT_EXCEEDED",
      "Transform application requires bounded safe-integer millimetre coordinates.",
    );
  }
  const canonical = checkedTransform.value;
  if (
    canonical === identityFixedSimilarityTransform ||
    isIdentityFixedSimilarityTransform(canonical)
  ) {
    return success({ ...point });
  }

  const { w, x, y, z } = canonical.rotationQuaternionE9;
  const [bw, bx, by, bz] = [w, x, y, z].map(BigInt) as [bigint, bigint, bigint, bigint];
  const [px, py, pz] = [point.xMm, point.yMm, point.zMm].map(BigInt) as [bigint, bigint, bigint];
  const norm = bw * bw + bx * bx + by * by + bz * bz;
  const rotatedX =
    (bw * bw + bx * bx - by * by - bz * bz) * px +
    2n * (bx * by - bw * bz) * py +
    2n * (bx * bz + bw * by) * pz;
  const rotatedY =
    2n * (bx * by + bw * bz) * px +
    (bw * bw - bx * bx + by * by - bz * bz) * py +
    2n * (by * bz - bw * bx) * pz;
  const rotatedZ =
    2n * (bx * bz - bw * by) * px +
    2n * (by * bz + bw * bx) * py +
    (bw * bw - bx * bx - by * by + bz * bz) * pz;
  const denominator = norm * BigInt(ppm);
  const scale = BigInt(canonical.scalePartsPerMillion);
  const translatedX =
    roundRatio(rotatedX * scale, denominator) + BigInt(canonical.translationMm.xMm);
  const translatedY =
    roundRatio(rotatedY * scale, denominator) + BigInt(canonical.translationMm.yMm);
  const translatedZ =
    roundRatio(rotatedZ * scale, denominator) + BigInt(canonical.translationMm.zMm);
  return boundedBigIntPoint(translatedX, translatedY, translatedZ, coordinateLimitMm);
}

export function isIdentityFixedSimilarityTransform(transform: FixedSimilarityTransform): boolean {
  const quaternion = transform.rotationQuaternionE9;
  return (
    transform.scalePartsPerMillion === ppm &&
    transform.translationMm.xMm === 0 &&
    transform.translationMm.yMm === 0 &&
    transform.translationMm.zMm === 0 &&
    Math.abs(quaternion.w) === e9 &&
    quaternion.x === 0 &&
    quaternion.y === 0 &&
    quaternion.z === 0
  );
}

function quantizeQuaternion(components: readonly number[]): RegistrationComputation<QuaternionE9> {
  if (components.length !== 4 || components.some((component) => !Number.isFinite(component))) {
    return failure("NON_FINITE_INPUT", "Quaternion quantisation requires four finite components.");
  }
  const norm = Math.hypot(...components);
  if (!Number.isFinite(norm) || norm < 1e-15) {
    return failure("DEGENERATE_CORRESPONDENCES", "Quaternion quantisation received zero rotation.");
  }
  let quantized = components.map((component) => Math.round((component / norm) * e9));
  const firstNonZero = quantized.find((component) => component !== 0);
  if (firstNonZero !== undefined && firstNonZero < 0) quantized = quantized.map((value) => -value);
  quantized = quantized.map((value) => (Object.is(value, -0) ? 0 : value));
  const [w, x, y, z] = quantized;
  if (w === undefined || x === undefined || y === undefined || z === undefined) {
    return failure("INVALID_FIXED_TRANSFORM", "Quaternion quantisation was incomplete.");
  }
  return success({ w, x, y, z });
}

export function fixedSimilarityFromFloating(
  rotationQuaternion: readonly number[],
  scale: number,
  translationMm: readonly number[],
  coordinateLimitMm = defaultCoordinateLimitMm,
): RegistrationComputation<FixedSimilarityTransform> {
  if (
    !Number.isFinite(scale) ||
    translationMm.length !== 3 ||
    translationMm.some((coordinate) => !Number.isFinite(coordinate))
  ) {
    return failure("NON_FINITE_INPUT", "Similarity quantisation requires finite values.");
  }
  const quaternion = quantizeQuaternion(rotationQuaternion);
  if (!quaternion.ok) return quaternion;
  const scalePartsPerMillion = Math.round(scale * ppm);
  const [xMm, yMm, zMm] = translationMm.map((coordinate) => Math.round(coordinate));
  if (xMm === undefined || yMm === undefined || zMm === undefined) {
    return failure(
      "INVALID_FIXED_TRANSFORM",
      "Similarity translation quantisation was incomplete.",
    );
  }
  if ([xMm, yMm, zMm].some((coordinate) => Math.abs(coordinate) > coordinateLimitMm)) {
    return failure(
      "OUTPUT_OVERFLOW",
      "Quantised similarity translation exceeds the configured millimetre limit.",
    );
  }
  if (scalePartsPerMillion <= 0 || scalePartsPerMillion > maximumDurableScalePpm) {
    return failure("SCALE_OUT_OF_RANGE", "Quantised similarity scale is outside durable bounds.");
  }
  return validateFixedSimilarityTransform(
    {
      rotationQuaternionE9: quaternion.value,
      scalePartsPerMillion,
      translationMm: { xMm, yMm, zMm },
    },
    coordinateLimitMm,
  );
}

export function composeFixedSimilarityTransforms(
  outer: FixedSimilarityTransform,
  inner: FixedSimilarityTransform,
  coordinateLimitMm = defaultCoordinateLimitMm,
): RegistrationComputation<FixedSimilarityTransform> {
  const checkedOuter = validateFixedSimilarityTransform(outer, coordinateLimitMm);
  if (!checkedOuter.ok) return checkedOuter;
  const checkedInner = validateFixedSimilarityTransform(inner, coordinateLimitMm);
  if (!checkedInner.ok) return checkedInner;
  if (isIdentityFixedSimilarityTransform(checkedOuter.value)) return success(checkedInner.value);
  if (isIdentityFixedSimilarityTransform(checkedInner.value)) return success(checkedOuter.value);

  const left = checkedOuter.value.rotationQuaternionE9;
  const right = checkedInner.value.rotationQuaternionE9;
  const quaternion = quantizeQuaternion([
    left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z,
    left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
    left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
    left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
  ]);
  if (!quaternion.ok) return quaternion;
  const scale = roundRatio(
    BigInt(checkedOuter.value.scalePartsPerMillion) *
      BigInt(checkedInner.value.scalePartsPerMillion),
    BigInt(ppm),
  );
  if (scale <= 0n || scale > BigInt(maximumDurableScalePpm)) {
    return failure("SCALE_OUT_OF_RANGE", "Composed fixed-point scale is outside durable bounds.");
  }
  const translation = applyFixedSimilarityTransform(
    checkedOuter.value,
    checkedInner.value.translationMm,
    coordinateLimitMm,
  );
  if (!translation.ok) return translation;
  return validateFixedSimilarityTransform(
    {
      rotationQuaternionE9: quaternion.value,
      scalePartsPerMillion: Number(scale),
      translationMm: translation.value,
    },
    coordinateLimitMm,
  );
}

export function invertFixedSimilarityTransform(
  transform: FixedSimilarityTransform,
  coordinateLimitMm = defaultCoordinateLimitMm,
): RegistrationComputation<FixedSimilarityTransform> {
  const checked = validateFixedSimilarityTransform(transform, coordinateLimitMm);
  if (!checked.ok) return checked;
  if (isIdentityFixedSimilarityTransform(checked.value))
    return success(identityFixedSimilarityTransform);
  const source = checked.value;
  const inverseScale = roundRatio(BigInt(ppm) * BigInt(ppm), BigInt(source.scalePartsPerMillion));
  if (inverseScale <= 0n || inverseScale > BigInt(maximumDurableScalePpm)) {
    return failure("SCALE_OUT_OF_RANGE", "Inverse fixed-point scale is outside durable bounds.");
  }
  const rotation = canonicalQuaternion({
    w: source.rotationQuaternionE9.w,
    x: -source.rotationQuaternionE9.x,
    y: -source.rotationQuaternionE9.y,
    z: -source.rotationQuaternionE9.z,
  });
  const zeroTranslationInverse: FixedSimilarityTransform = {
    rotationQuaternionE9: rotation,
    scalePartsPerMillion: Number(inverseScale),
    translationMm: { xMm: 0, yMm: 0, zMm: 0 },
  };
  const negativeTranslation = {
    xMm: -source.translationMm.xMm,
    yMm: -source.translationMm.yMm,
    zMm: -source.translationMm.zMm,
  };
  const translation = applyFixedSimilarityTransform(
    zeroTranslationInverse,
    negativeTranslation,
    coordinateLimitMm,
  );
  if (!translation.ok) return translation;
  return validateFixedSimilarityTransform(
    { ...zeroTranslationInverse, translationMm: translation.value },
    coordinateLimitMm,
  );
}
