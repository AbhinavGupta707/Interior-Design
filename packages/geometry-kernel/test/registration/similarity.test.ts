import { describe, expect, it } from "vitest";

import {
  applyFixedSimilarityTransform,
  estimateFreeSimilarityTransform,
  type FixedSimilarityTransform,
  type Point3Mm,
  type RegistrationCorrespondence,
} from "../../src/index.js";

const truth: FixedSimilarityTransform = {
  rotationQuaternionE9: { w: 707_106_781, x: 0, y: 0, z: 707_106_781 },
  scalePartsPerMillion: 1_250_000,
  translationMm: { xMm: 1_000, yMm: -750, zMm: 300 },
};

const sourcePoints: readonly Point3Mm[] = [
  { xMm: 0, yMm: 0, zMm: 0 },
  { xMm: 1_000, yMm: 0, zMm: 0 },
  { xMm: 0, yMm: 1_000, zMm: 0 },
  { xMm: 0, yMm: 0, zMm: 1_000 },
  { xMm: 1_000, yMm: 2_000, zMm: 300 },
  { xMm: -700, yMm: 500, zMm: 1_800 },
  { xMm: 2_200, yMm: -400, zMm: 900 },
  { xMm: -1_200, yMm: -900, zMm: 500 },
] as const;

function transformed(point: Point3Mm): Point3Mm {
  const result = applyFixedSimilarityTransform(truth, point);
  if (!result.ok) throw new Error(result.error.detail);
  return result.value;
}

function correspondences(
  noise: (index: number) => Point3Mm = () => ({ xMm: 0, yMm: 0, zMm: 0 }),
): RegistrationCorrespondence[] {
  return sourcePoints.map((sourcePoint, index) => {
    const target = transformed(sourcePoint);
    const offset = noise(index);
    return {
      confidenceBasisPoints: 10_000 - index * 100,
      correspondenceId: `anchor-${String(index).padStart(2, "0")}`,
      sourcePoint,
      targetPoint: {
        xMm: target.xMm + offset.xMm,
        yMm: target.yMm + offset.yMm,
        zMm: target.zMm + offset.zMm,
      },
    };
  });
}

function valueOf<TValue>(result: { ok: false } | { ok: true; value: TValue }): TValue {
  if (!result.ok) throw new Error("Expected successful robust registration.");
  return result.value;
}

describe("deterministic robust free-similarity estimation", () => {
  it("recovers an exact proper 3D similarity at the fixed-point boundary", () => {
    const result = valueOf(estimateFreeSimilarityTransform(correspondences()));

    expect(result.transform).toEqual(truth);
    expect(result.residuals).toEqual({
      inlierCount: sourcePoints.length,
      maximumMm: 0,
      medianMm: 0,
      p90Mm: 0,
      sampleCount: sourcePoints.length,
    });
    expect(result.outlierCorrespondenceIds).toEqual([]);
    expect(result.algorithmVersion).toBe("c9-registration-kernel-v1");
    expect(result.transformVersion).toBe("c9-fixed-similarity-v1");
  });

  it("recovers a proper rotation spanning all three axes", () => {
    const threeAxisTruth: FixedSimilarityTransform = {
      rotationQuaternionE9: {
        w: 500_000_000,
        x: 500_000_000,
        y: 500_000_000,
        z: 500_000_000,
      },
      scalePartsPerMillion: 750_000,
      translationMm: { xMm: -300, yMm: 800, zMm: 1_200 },
    };
    const input = sourcePoints.map((sourcePoint, index) => {
      const target = applyFixedSimilarityTransform(threeAxisTruth, sourcePoint);
      if (!target.ok) throw new Error(target.error.detail);
      return {
        confidenceBasisPoints: 10_000,
        correspondenceId: `three-axis-${String(index)}`,
        sourcePoint,
        targetPoint: target.value,
      };
    });

    const result = valueOf(estimateFreeSimilarityTransform(input));

    expect(result.transform).toEqual(threeAxisTruth);
    expect(result.residuals.maximumMm).toBe(0);
  });

  it("fits bounded noise, rejects outliers and reports durable residuals", () => {
    const input = correspondences((index) => ({
      xMm: (index % 3) - 1,
      yMm: ((index * 2) % 5) - 2,
      zMm: (index % 2) * 2 - 1,
    }));
    input.push(
      {
        confidenceBasisPoints: 8_000,
        correspondenceId: "outlier-a",
        sourcePoint: { xMm: 300, yMm: 400, zMm: 500 },
        targetPoint: { xMm: 8_000, yMm: -7_000, zMm: 6_000 },
      },
      {
        confidenceBasisPoints: 8_000,
        correspondenceId: "outlier-b",
        sourcePoint: { xMm: -300, yMm: 900, zMm: 200 },
        targetPoint: { xMm: -8_000, yMm: 7_000, zMm: -6_000 },
      },
    );

    const result = valueOf(
      estimateFreeSimilarityTransform(input, { inlierThresholdMm: 10, seed: 123_456 }),
    );

    expect(result.inlierCorrespondenceIds).toHaveLength(sourcePoints.length);
    expect(result.outlierCorrespondenceIds).toEqual(["outlier-a", "outlier-b"]);
    expect(result.residuals.inlierCount).toBe(sourcePoints.length);
    expect(result.residuals.medianMm).toBeLessThanOrEqual(3);
    expect(
      Math.abs(result.transform.scalePartsPerMillion - truth.scalePartsPerMillion),
    ).toBeLessThanOrEqual(1_000);
  });

  it("is byte-deterministic under shuffled input for one explicit seed and config", () => {
    const input = correspondences();
    const shuffled = [
      input[6],
      input[1],
      input[7],
      input[0],
      input[4],
      input[2],
      input[5],
      input[3],
    ].filter((value): value is RegistrationCorrespondence => value !== undefined);
    const first = estimateFreeSimilarityTransform(input, { maximumHypotheses: 23, seed: 99 });
    const second = estimateFreeSimilarityTransform(shuffled, { maximumHypotheses: 23, seed: 99 });

    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    if (first.ok) {
      expect(Object.isFrozen(first.value)).toBe(true);
      expect(Object.isFrozen(first.value.transform)).toBe(true);
      expect(Object.isFrozen(first.value.inlierCorrespondenceIds)).toBe(true);
    }
  });

  it("rejects collinear/rank-deficient and reflected anchors explicitly", () => {
    const collinear = [0, 1, 2, 3].map((index) => ({
      confidenceBasisPoints: 10_000,
      correspondenceId: `line-${String(index)}`,
      sourcePoint: { xMm: index * 100, yMm: index * 200, zMm: index * 300 },
      targetPoint: { xMm: index * 400, yMm: index * 500, zMm: index * 600 },
    }));
    expect(estimateFreeSimilarityTransform(collinear)).toMatchObject({
      error: { code: "DEGENERATE_CORRESPONDENCES" },
      ok: false,
    });

    const reflected = [
      { xMm: 0, yMm: 0, zMm: 0 },
      { xMm: 1_000, yMm: 0, zMm: 0 },
      { xMm: 0, yMm: 1_000, zMm: 0 },
      { xMm: 0, yMm: 0, zMm: 1_000 },
      { xMm: 700, yMm: 900, zMm: 1_100 },
    ].map((sourcePoint, index) => ({
      confidenceBasisPoints: 10_000,
      correspondenceId: `reflection-${String(index)}`,
      sourcePoint,
      targetPoint: { xMm: -sourcePoint.xMm, yMm: sourcePoint.yMm, zMm: sourcePoint.zMm },
    }));
    expect(estimateFreeSimilarityTransform(reflected)).toMatchObject({
      error: { code: "REFLECTION_REJECTED" },
      ok: false,
    });
  });

  it("rejects non-finite, duplicate, over-limit, invalid-scale and insufficient inputs", () => {
    const valid = correspondences();
    expect(estimateFreeSimilarityTransform(valid.slice(0, 2))).toMatchObject({
      error: { code: "INSUFFICIENT_CORRESPONDENCES" },
      ok: false,
    });
    expect(
      estimateFreeSimilarityTransform([
        { ...valid[0], sourcePoint: { xMm: Number.NaN, yMm: 0, zMm: 0 } },
        valid[1],
        valid[2],
      ] as RegistrationCorrespondence[]),
    ).toMatchObject({ error: { code: "NON_FINITE_INPUT" }, ok: false });
    expect(
      estimateFreeSimilarityTransform(
        [
          valid[0],
          { ...valid[1], correspondenceId: valid[0]?.correspondenceId ?? "" },
          valid[2],
        ].filter((value): value is RegistrationCorrespondence => value !== undefined),
      ),
    ).toMatchObject({ error: { code: "DUPLICATE_CORRESPONDENCE_ID" }, ok: false });
    expect(
      estimateFreeSimilarityTransform(
        valid.map((item) => ({
          ...item,
          targetPoint: {
            xMm: item.targetPoint.xMm * 100,
            yMm: item.targetPoint.yMm * 100,
            zMm: item.targetPoint.zMm * 100,
          },
        })),
        { coordinateLimitMm: 1_000_000_000, minimumTriangleAreaSquared: 1e-30 },
      ),
    ).toMatchObject({ error: { code: "SCALE_OUT_OF_RANGE" }, ok: false });
    expect(estimateFreeSimilarityTransform(valid, { maximumCorrespondences: 4 })).toMatchObject({
      error: { code: "RESOURCE_LIMIT_EXCEEDED" },
      ok: false,
    });
    expect(
      estimateFreeSimilarityTransform(
        [
          {
            ...valid[0],
            sourcePoint: { xMm: 10_000_001, yMm: 0, zMm: 0 },
          },
          valid[1],
          valid[2],
        ].filter((value): value is RegistrationCorrespondence => value !== undefined),
      ),
    ).toMatchObject({ error: { code: "COORDINATE_LIMIT_EXCEEDED" }, ok: false });
    expect(
      estimateFreeSimilarityTransform(
        [{ ...valid[0], unexpected: "field" }, valid[1], valid[2]].filter(
          (value): value is RegistrationCorrespondence => value !== undefined,
        ),
      ),
    ).toMatchObject({ error: { code: "INVALID_OBSERVATION" }, ok: false });
  });

  it("rejects a finite estimate whose durable translation would overflow project bounds", () => {
    const input: RegistrationCorrespondence[] = [
      { xMm: -9_000_000, yMm: 0, zMm: 0 },
      { xMm: -8_000_000, yMm: 0, zMm: 0 },
      { xMm: -9_000_000, yMm: 1_000_000, zMm: 0 },
      { xMm: -9_000_000, yMm: 0, zMm: 1_000_000 },
    ].map((sourcePoint, index) => ({
      confidenceBasisPoints: 10_000,
      correspondenceId: `overflow-${String(index)}`,
      sourcePoint,
      targetPoint: {
        xMm: sourcePoint.xMm + 18_000_000,
        yMm: sourcePoint.yMm,
        zMm: sourcePoint.zMm,
      },
    }));

    expect(estimateFreeSimilarityTransform(input)).toMatchObject({
      error: { code: "OUTPUT_OVERFLOW" },
      ok: false,
    });
  });

  it("preserves bounded deterministic behavior across a property-style transform corpus", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const translation = { xMm: seed * 11, yMm: seed * -7, zMm: seed * 3 };
      const transform: FixedSimilarityTransform = {
        rotationQuaternionE9:
          seed % 2 === 0
            ? { w: 1_000_000_000, x: 0, y: 0, z: 0 }
            : { w: 707_106_781, x: 0, y: 0, z: 707_106_781 },
        scalePartsPerMillion: 500_000 + seed * 25_000,
        translationMm: translation,
      };
      const input = sourcePoints.slice(0, 6).map((sourcePoint, index) => {
        const target = applyFixedSimilarityTransform(transform, sourcePoint);
        if (!target.ok) throw new Error(target.error.detail);
        return {
          confidenceBasisPoints: 10_000,
          correspondenceId: `seed-${String(seed)}-${String(index)}`,
          sourcePoint,
          targetPoint: target.value,
        };
      });
      const estimated = valueOf(estimateFreeSimilarityTransform(input, { seed }));
      expect(estimated.residuals.maximumMm).toBeLessThanOrEqual(1);
      for (const item of input) {
        expect(
          valueOf(applyFixedSimilarityTransform(estimated.transform, item.sourcePoint)),
        ).toEqual(item.targetPoint);
      }
    }
  });
});
