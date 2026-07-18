import { describe, expect, it } from "vitest";

import {
  convexPolygonsOverlap,
  deterministicSinCos,
  polygonContainsPolygon,
  rotatedRectangle,
  polygonsOverlap,
  validateAndScalePolygon,
} from "../src/geometry.js";

describe("integer rotation and polygon properties", () => {
  it("is periodic for every sampled allowed milli-degree rotation", () => {
    for (let rotation = 0; rotation < 360_000; rotation += 7_500) {
      expect(deterministicSinCos(rotation + 360_000)).toEqual(deterministicSinCos(rotation));
      expect(rotatedRectangle({ xMm: 123, yMm: -456 }, 1_001, 503, rotation + 360_000)).toEqual(
        rotatedRectangle({ xMm: 123, yMm: -456 }, 1_001, 503, rotation),
      );
    }
  });

  it("contains sampled rotations in a large concave-safe room without mutating its input", () => {
    const points = [
      { xMm: -5_000, yMm: -5_000 },
      { xMm: 5_000, yMm: -5_000 },
      { xMm: 5_000, yMm: 5_000 },
      { xMm: -5_000, yMm: 5_000 },
    ];
    const original = structuredClone(points);
    const room = validateAndScalePolygon(points, 128);
    expect(room.ok).toBe(true);
    if (!room.ok) return;
    for (let rotation = 0; rotation < 360_000; rotation += 15_000) {
      const furnishing = rotatedRectangle({ xMm: 0, yMm: 0 }, 2_001, 999, rotation);
      expect(polygonContainsPolygon(room.polygon, furnishing, "forbid")).toBe(true);
    }
    expect(points).toEqual(original);
  });

  it("distinguishes exact contact from one-unit overlap for translated rectangle samples", () => {
    for (let yMm = -2_000; yMm <= 2_000; yMm += 500) {
      const fixed = rotatedRectangle({ xMm: 0, yMm }, 1_000, 500, 0);
      const touching = rotatedRectangle({ xMm: 1_000, yMm }, 1_000, 500, 0);
      const overlapping = rotatedRectangle({ xMm: 999, yMm }, 1_000, 500, 0);
      expect(convexPolygonsOverlap(fixed, touching, "allow")).toBe(false);
      expect(convexPolygonsOverlap(fixed, touching, "forbid")).toBe(true);
      expect(convexPolygonsOverlap(fixed, overlapping, "allow")).toBe(true);
    }
  });

  it("detects a one-millimetre collinear overlap against a general keep-out polygon", () => {
    const furnishing = rotatedRectangle({ xMm: 0, yMm: 0 }, 1_000, 500, 0);
    const keepOut = validateAndScalePolygon(
      [
        { xMm: 499, yMm: -250 },
        { xMm: 1_500, yMm: -250 },
        { xMm: 1_500, yMm: 250 },
        { xMm: 499, yMm: 250 },
      ],
      128,
    );
    expect(keepOut.ok).toBe(true);
    if (!keepOut.ok) return;
    expect(polygonsOverlap(furnishing, keepOut.polygon, "allow")).toBe(true);
  });
});
