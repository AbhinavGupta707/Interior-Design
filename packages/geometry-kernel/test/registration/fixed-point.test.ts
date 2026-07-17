import { describe, expect, it } from "vitest";

import {
  applyFixedSimilarityTransform,
  composeFixedSimilarityTransforms,
  identityFixedSimilarityTransform,
  invertFixedSimilarityTransform,
  isIdentityFixedSimilarityTransform,
  validateFixedSimilarityTransform,
  type FixedSimilarityTransform,
} from "../../src/index.js";

const quarterTurn: FixedSimilarityTransform = {
  rotationQuaternionE9: { w: 707_106_781, x: 0, y: 0, z: 707_106_781 },
  scalePartsPerMillion: 2_000_000,
  translationMm: { xMm: 100, yMm: -200, zMm: 300 },
};

function valueOf<TValue>(result: { ok: false } | { ok: true; value: TValue }): TValue {
  if (!result.ok) throw new Error("Expected a successful registration computation.");
  return result.value;
}

describe("fixed-point durable similarity transforms", () => {
  it("applies exact identity without floating-point drift", () => {
    const points = [
      { xMm: 0, yMm: 0, zMm: 0 },
      { xMm: 10_000_000, yMm: -10_000_000, zMm: 9_999_999 },
      { xMm: -10_000_000, yMm: 10_000_000, zMm: -9_999_999 },
    ] as const;
    for (const point of points) {
      expect(applyFixedSimilarityTransform(identityFixedSimilarityTransform, point)).toEqual({
        ok: true,
        value: point,
      });
    }
    expect(isIdentityFixedSimilarityTransform(identityFixedSimilarityTransform)).toBe(true);
    expect(Object.isFrozen(identityFixedSimilarityTransform)).toBe(true);
  });

  it("applies integer scale, translation and cardinal rotation exactly", () => {
    expect(applyFixedSimilarityTransform(quarterTurn, { xMm: 50, yMm: 20, zMm: -10 })).toEqual({
      ok: true,
      value: { xMm: 60, yMm: -100, zMm: 280 },
    });
  });

  it("composes and inverts source-to-target transforms in declared order", () => {
    const translation: FixedSimilarityTransform = {
      ...identityFixedSimilarityTransform,
      translationMm: { xMm: 500, yMm: 700, zMm: -50 },
    };
    const composed = valueOf(composeFixedSimilarityTransforms(translation, quarterTurn));
    const source = { xMm: 50, yMm: 20, zMm: -10 };
    const sequential = valueOf(
      applyFixedSimilarityTransform(
        translation,
        valueOf(applyFixedSimilarityTransform(quarterTurn, source)),
      ),
    );
    expect(valueOf(applyFixedSimilarityTransform(composed, source))).toEqual(sequential);

    const inverse = valueOf(invertFixedSimilarityTransform(quarterTurn));
    const transformed = valueOf(applyFixedSimilarityTransform(quarterTurn, source));
    expect(valueOf(applyFixedSimilarityTransform(inverse, transformed))).toEqual(source);
    expect(
      valueOf(composeFixedSimilarityTransforms(identityFixedSimilarityTransform, quarterTurn)),
    ).toEqual(valueOf(validateFixedSimilarityTransform(quarterTurn)));
  });

  it("canonicalises quaternion sign while preserving durable equality", () => {
    const negative = {
      ...quarterTurn,
      rotationQuaternionE9: { w: -707_106_781, x: 0, y: 0, z: -707_106_781 },
    };
    expect(valueOf(validateFixedSimilarityTransform(negative))).toEqual(
      valueOf(validateFixedSimilarityTransform(quarterTurn)),
    );
    expect(Object.isFrozen(negative)).toBe(false);
    expect(Object.isFrozen(negative.rotationQuaternionE9)).toBe(false);
  });

  it("fails closed for invalid quaternions, scales, coordinates and output overflow", () => {
    expect(
      validateFixedSimilarityTransform({
        ...quarterTurn,
        rotationQuaternionE9: { w: 1, x: 1, y: 1, z: 1 },
      }),
    ).toMatchObject({ error: { code: "INVALID_FIXED_TRANSFORM" }, ok: false });
    expect(
      validateFixedSimilarityTransform({ ...quarterTurn, scalePartsPerMillion: 0 }),
    ).toMatchObject({ error: { code: "INVALID_FIXED_TRANSFORM" }, ok: false });
    expect(
      applyFixedSimilarityTransform(identityFixedSimilarityTransform, {
        xMm: Number.NaN,
        yMm: 0,
        zMm: 0,
      }),
    ).toMatchObject({ error: { code: "COORDINATE_LIMIT_EXCEEDED" }, ok: false });
    expect(
      applyFixedSimilarityTransform(
        {
          ...identityFixedSimilarityTransform,
          translationMm: { xMm: 1, yMm: 0, zMm: 0 },
        },
        { xMm: 10_000_000, yMm: 0, zMm: 0 },
      ),
    ).toMatchObject({ error: { code: "OUTPUT_OVERFLOW" }, ok: false });
    expect(
      validateFixedSimilarityTransform({
        ...quarterTurn,
        unexpected: true,
      } as unknown as FixedSimilarityTransform),
    ).toMatchObject({ error: { code: "INVALID_FIXED_TRANSFORM" }, ok: false });
  });
});
