import type { CanonicalHomeSnapshot } from "@interior-design/contracts";

import { deepFreeze } from "./freeze.js";

export const canonicalPropertySeeds = Object.freeze({
  ordering: 0xc4a11ce,
  rectangles: 0xc4f17e,
});

function nextRandom(state: number): number {
  let value = state | 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}

function shuffle<T>(values: readonly T[], seed: number): T[] {
  const result = [...values];
  let state = seed;
  for (let index = result.length - 1; index > 0; index--) {
    state = nextRandom(state);
    const target = state % (index + 1);
    [result[index], result[target]] = [result[target] as T, result[index] as T];
  }
  return result;
}

export function generateOrderingVariants(
  source: CanonicalHomeSnapshot,
  seed: number = canonicalPropertySeeds.ordering,
  count = 24,
): readonly CanonicalHomeSnapshot[] {
  const variants: CanonicalHomeSnapshot[] = [];
  let state = seed;
  for (let index = 0; index < count; index++) {
    state = nextRandom(state);
    const snapshot = structuredClone(source);
    state = nextRandom(state);
    snapshot.elements.cameras = shuffle(snapshot.elements.cameras, state);
    state = nextRandom(state);
    snapshot.elements.finishes = shuffle(snapshot.elements.finishes, state);
    state = nextRandom(state);
    snapshot.elements.fixedObjects = shuffle(snapshot.elements.fixedObjects, state);
    state = nextRandom(state);
    snapshot.elements.furnishings = shuffle(snapshot.elements.furnishings, state);
    state = nextRandom(state);
    snapshot.elements.levels = shuffle(snapshot.elements.levels, state);
    state = nextRandom(state);
    snapshot.elements.lights = shuffle(snapshot.elements.lights, state);
    state = nextRandom(state);
    snapshot.elements.openings = shuffle(snapshot.elements.openings, state);
    state = nextRandom(state);
    snapshot.elements.spaces = shuffle(snapshot.elements.spaces, state);
    state = nextRandom(state);
    snapshot.elements.stairs = shuffle(snapshot.elements.stairs, state);
    state = nextRandom(state);
    snapshot.elements.surfaces = shuffle(snapshot.elements.surfaces, state);
    state = nextRandom(state);
    snapshot.elements.walls = shuffle(snapshot.elements.walls, state);
    for (const space of snapshot.elements.spaces) {
      state = nextRandom(state);
      space.boundedByElementIds = shuffle(space.boundedByElementIds, state);
    }
    snapshot.knownLimitations = shuffle(snapshot.knownLimitations, state);
    variants.push(snapshot);
  }
  return deepFreeze(variants);
}

export interface RectanglePropertyCase {
  readonly heightMm: number;
  readonly id: string;
  readonly points: readonly [
    { readonly xMm: number; readonly yMm: number },
    { readonly xMm: number; readonly yMm: number },
    { readonly xMm: number; readonly yMm: number },
    { readonly xMm: number; readonly yMm: number },
  ];
  readonly seed: number;
  readonly twiceAreaMm2: bigint;
  readonly widthMm: number;
}

export function generateRectanglePropertyCases(
  seed: number = canonicalPropertySeeds.rectangles,
  count = 64,
): readonly RectanglePropertyCase[] {
  let state = seed;
  const cases: RectanglePropertyCase[] = [];
  for (let index = 0; index < count; index++) {
    state = nextRandom(state);
    const widthMm = 500 + (state % 19_501);
    state = nextRandom(state);
    const heightMm = 500 + (state % 19_501);
    state = nextRandom(state);
    const xMm = -9_000_000 + (state % 18_000_001);
    state = nextRandom(state);
    const yMm = -9_000_000 + (state % 18_000_001);
    cases.push({
      heightMm,
      id: `rectangle-${seed.toString(16)}-${index.toString().padStart(3, "0")}`,
      points: [
        { xMm, yMm },
        { xMm: xMm + widthMm, yMm },
        { xMm: xMm + widthMm, yMm: yMm + heightMm },
        { xMm, yMm: yMm + heightMm },
      ],
      seed,
      twiceAreaMm2: BigInt(widthMm) * BigInt(heightMm) * 2n,
      widthMm,
    });
  }
  return deepFreeze(cases);
}
