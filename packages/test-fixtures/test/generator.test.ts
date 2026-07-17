import { describe, expect, it } from "vitest";

import {
  canonicalPropertySeeds,
  generateOrderingVariants,
  generateRectanglePropertyCases,
  existingHomeSnapshot,
} from "../src/models/index.js";

const twiceSignedArea = (points: readonly { xMm: number; yMm: number }[]): bigint =>
  points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    if (next === undefined) throw new Error("A polygon point unexpectedly disappeared.");
    return sum + BigInt(point.xMm) * BigInt(next.yMm) - BigInt(point.yMm) * BigInt(next.xMm);
  }, 0n);

describe("C4 fixed-seed property fixtures", () => {
  it("replays identical rectangle cases from the declared seed", () => {
    const first = generateRectanglePropertyCases();
    const second = generateRectanglePropertyCases(canonicalPropertySeeds.rectangles);
    expect(first).toEqual(second);
    expect(first).toHaveLength(64);
  });

  it("independently verifies every generated rectangle area and coordinate range", () => {
    for (const testCase of generateRectanglePropertyCases()) {
      expect(twiceSignedArea(testCase.points)).toBe(testCase.twiceAreaMm2);
      expect(testCase.twiceAreaMm2).toBeGreaterThan(0n);
      for (const point of testCase.points) {
        expect(Number.isSafeInteger(point.xMm)).toBe(true);
        expect(Number.isSafeInteger(point.yMm)).toBe(true);
        expect(Math.abs(point.xMm)).toBeLessThanOrEqual(10_000_000);
        expect(Math.abs(point.yMm)).toBeLessThanOrEqual(10_000_000);
      }
    }
  });

  it("replays identical ordering variants from the declared seed", () => {
    expect(generateOrderingVariants(existingHomeSnapshot)).toEqual(
      generateOrderingVariants(existingHomeSnapshot, canonicalPropertySeeds.ordering),
    );
  });
});
