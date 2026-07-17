import { describe, expect, it } from "vitest";

import {
  checkedAdd,
  checkedMultiply,
  orientation2d,
  polylineLengthBoundsMm,
  segmentsIntersect2d,
  signedDoubleArea2d,
} from "../src/index.js";

function required<TValue>(value: TValue | undefined): TValue {
  if (value === undefined) throw new Error("Expected test value to be present.");
  return value;
}

describe("checked integer geometry primitives", () => {
  it("classifies near-collinear orientation exactly at canonical coordinate scale", () => {
    expect(
      orientation2d(
        { xMm: 0, yMm: 0 },
        { xMm: 10_000_000, yMm: 9_999_999 },
        { xMm: 10_000_000, yMm: 10_000_000 },
      ),
    ).toEqual({ ok: true, value: 1 });
    expect(
      orientation2d(
        { xMm: -10_000_000, yMm: -10_000_000 },
        { xMm: 0, yMm: 0 },
        { xMm: 10_000_000, yMm: 10_000_000 },
      ),
    ).toEqual({ ok: true, value: 0 });
  });

  it("returns explicit failures instead of overflowing", () => {
    expect(checkedAdd(Number.MAX_SAFE_INTEGER, 1)).toMatchObject({
      code: "SAFE_INTEGER_RANGE_EXCEEDED",
      ok: false,
    });
    expect(checkedMultiply(100_000_000, 100_000_000)).toMatchObject({
      code: "SAFE_INTEGER_RANGE_EXCEEDED",
      ok: false,
    });
    expect(
      orientation2d(
        { xMm: -Number.MAX_SAFE_INTEGER, yMm: 0 },
        { xMm: Number.MAX_SAFE_INTEGER, yMm: 0 },
        { xMm: 0, yMm: 1 },
      ),
    ).toMatchObject({ code: "SAFE_INTEGER_RANGE_EXCEEDED", ok: false });
  });

  it("distinguishes crossing, touching, overlap and separation symmetrically", () => {
    const cases = [
      {
        expected: "cross",
        first: [
          { xMm: 0, yMm: 0 },
          { xMm: 10, yMm: 10 },
        ] as const,
        second: [
          { xMm: 0, yMm: 10 },
          { xMm: 10, yMm: 0 },
        ] as const,
      },
      {
        expected: "touch",
        first: [
          { xMm: 0, yMm: 0 },
          { xMm: 10, yMm: 0 },
        ] as const,
        second: [
          { xMm: 10, yMm: 0 },
          { xMm: 20, yMm: 5 },
        ] as const,
      },
      {
        expected: "overlap",
        first: [
          { xMm: 0, yMm: 0 },
          { xMm: 10, yMm: 0 },
        ] as const,
        second: [
          { xMm: 5, yMm: 0 },
          { xMm: 15, yMm: 0 },
        ] as const,
      },
      {
        expected: "none",
        first: [
          { xMm: 0, yMm: 0 },
          { xMm: 10, yMm: 0 },
        ] as const,
        second: [
          { xMm: 11, yMm: 0 },
          { xMm: 20, yMm: 0 },
        ] as const,
      },
    ] as const;
    for (const testCase of cases) {
      expect(
        segmentsIntersect2d(
          testCase.first[0],
          testCase.first[1],
          testCase.second[0],
          testCase.second[1],
        ),
      ).toEqual({
        ok: true,
        value: testCase.expected,
      });
      expect(
        segmentsIntersect2d(
          testCase.second[0],
          testCase.second[1],
          testCase.first[0],
          testCase.first[1],
        ),
      ).toEqual({
        ok: true,
        value: testCase.expected,
      });
    }
  });

  it("uses signed doubled area and exact integer length bounds without floating tolerance", () => {
    const polygon = [
      { xMm: 0, yMm: 0 },
      { xMm: 10, yMm: 0 },
      { xMm: 10, yMm: 5 },
      { xMm: 0, yMm: 5 },
    ];
    expect(signedDoubleArea2d(polygon)).toEqual({ ok: true, value: 100 });
    expect(signedDoubleArea2d([...polygon].reverse())).toEqual({ ok: true, value: -100 });
    expect(
      polylineLengthBoundsMm([
        { xMm: 0, yMm: 0 },
        { xMm: 3, yMm: 4 },
        { xMm: 6, yMm: 8 },
      ]),
    ).toEqual({ ok: true, value: { lowerBoundMm: 10, upperBoundMm: 10 } });
    expect(
      polylineLengthBoundsMm([
        { xMm: 0, yMm: 0 },
        { xMm: 1, yMm: 1 },
      ]),
    ).toEqual({ ok: true, value: { lowerBoundMm: 1, upperBoundMm: 2 } });
  });

  it("preserves orientation and intersection properties under bounded translations and reversal", () => {
    const base = [
      { xMm: -120, yMm: 75 },
      { xMm: 430, yMm: 900 },
      { xMm: 700, yMm: -250 },
    ] as const;
    for (let seed = -100; seed <= 100; seed += 1) {
      const xOffset = seed * 97;
      const yOffset = seed * -53;
      const translated = base.map((point) => ({
        xMm: point.xMm + xOffset,
        yMm: point.yMm + yOffset,
      }));
      expect(
        orientation2d(required(translated[0]), required(translated[1]), required(translated[2])),
      ).toEqual(orientation2d(base[0], base[1], base[2]));
      expect(
        orientation2d(required(translated[2]), required(translated[1]), required(translated[0])),
      ).toEqual({
        ok: true,
        value: 1,
      });
    }
  });
});
