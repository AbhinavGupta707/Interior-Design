import { describe, expect, it } from "vitest";

import {
  calibrationResidualMillimetres,
  divideRoundHalfAwayFromZero,
  transformSourcePoint,
} from "../../src/modules/plan-processing/calibration.js";

describe("C6 rational calibration", () => {
  it("rounds exact positive and negative ties away from zero", () => {
    expect(divideRoundHalfAwayFromZero(1n, 2n)).toBe(1n);
    expect(divideRoundHalfAwayFromZero(-1n, 2n)).toBe(-1n);
    expect(divideRoundHalfAwayFromZero(3n, 2n)).toBe(2n);
    expect(divideRoundHalfAwayFromZero(-3n, 2n)).toBe(-2n);
    expect(divideRoundHalfAwayFromZero(1n, 3n)).toBe(0n);
  });

  it("uses integer affine arithmetic and reports a bounded known-length residual", () => {
    const transform = {
      a: 25,
      b: 0,
      c: 0,
      d: 25,
      denominator: 10,
      rounding: "half-away-from-zero" as const,
      translateXMillimetres: -10,
      translateYMillimetres: 20,
    };
    expect(transformSourcePoint({ x: 1, y: -1 }, transform)).toEqual({ xMm: -7, yMm: 17 });
    expect(
      calibrationResidualMillimetres(
        {
          knownLengthMillimetres: 100,
          sourceEnd: { x: 40, y: 0 },
          sourceStart: { x: 0, y: 0 },
        },
        transform,
      ),
    ).toBe(0);
  });
});
