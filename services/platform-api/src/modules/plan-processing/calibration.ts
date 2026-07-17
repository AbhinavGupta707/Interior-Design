import { c6PlanPolicy } from "@interior-design/contracts";
import type {
  planRationalAffineTransformSchema,
  planSourcePointSchema,
} from "@interior-design/contracts";
import type { z } from "zod";

import { invalidPlanDraft } from "./errors.js";

type RationalTransform = z.infer<typeof planRationalAffineTransformSchema>;
type SourcePoint = z.infer<typeof planSourcePointSchema>;

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/** Exact integer division with the C6-mandated half-away-from-zero tie rule. */
export function divideRoundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("A calibration denominator must be positive.");
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (absolute(remainder) * 2n < denominator) return quotient;
  return quotient + (numerator < 0n ? -1n : 1n);
}

export function transformSourcePoint(
  point: SourcePoint,
  transform: RationalTransform,
): {
  readonly xMm: number;
  readonly yMm: number;
} {
  const denominator = BigInt(transform.denominator);
  const xNumerator = BigInt(transform.a) * BigInt(point.x) + BigInt(transform.b) * BigInt(point.y);
  const yNumerator = BigInt(transform.c) * BigInt(point.x) + BigInt(transform.d) * BigInt(point.y);
  const x =
    divideRoundHalfAwayFromZero(xNumerator, denominator) + BigInt(transform.translateXMillimetres);
  const y =
    divideRoundHalfAwayFromZero(yNumerator, denominator) + BigInt(transform.translateYMillimetres);
  const xMm = Number(x);
  const yMm = Number(y);
  if (
    !Number.isSafeInteger(xMm) ||
    !Number.isSafeInteger(yMm) ||
    Math.abs(xMm) > 10_000_000 ||
    Math.abs(yMm) > 10_000_000
  ) {
    throw invalidPlanDraft("The calibrated coordinates are outside the canonical model bounds.");
  }
  return { xMm, yMm };
}

export function calibrationResidualMillimetres(
  evidence: {
    readonly knownLengthMillimetres: number;
    readonly sourceEnd: SourcePoint;
    readonly sourceStart: SourcePoint;
  },
  transform: RationalTransform,
): number {
  const start = transformSourcePoint(evidence.sourceStart, transform);
  const end = transformSourcePoint(evidence.sourceEnd, transform);
  const mappedLength = Math.round(Math.hypot(end.xMm - start.xMm, end.yMm - start.yMm));
  return Math.abs(mappedLength - evidence.knownLengthMillimetres);
}

export function assertValidCalibrationResidual(residualMillimetres: number): void {
  if (!Number.isInteger(residualMillimetres) || residualMillimetres < 0) {
    throw invalidPlanDraft("The calibration residual is invalid.");
  }
  if (residualMillimetres > c6PlanPolicy.benchmark.maximumCalibrationP90Millimetres) {
    throw invalidPlanDraft(
      `The calibration residual exceeds ${String(c6PlanPolicy.benchmark.maximumCalibrationP90Millimetres)} mm; add or correct the known dimension.`,
    );
  }
}
