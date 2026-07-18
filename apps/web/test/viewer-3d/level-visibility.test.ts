import { describe, expect, it } from "vitest";

import {
  canonicalLevelId,
  isVisibleForLevels,
} from "../../src/features/viewer-3d/level-visibility";

describe("C10 level visibility", () => {
  it("hides every derived node pinned to a disabled canonical level", () => {
    const ground = "a1000000-0000-4000-8000-000000000001";
    const first = "a1000000-0000-4000-8000-000000000002";
    expect(canonicalLevelId({ userData: { levelId: first } })).toBe(first);
    expect(isVisibleForLevels({ userData: { levelId: ground } }, new Set([ground]))).toBe(true);
    expect(isVisibleForLevels({ userData: { levelId: first } }, new Set([ground]))).toBe(false);
  });

  it("keeps unpinned metadata nodes visible instead of inventing a level", () => {
    expect(isVisibleForLevels({ userData: {} }, new Set())).toBe(true);
    expect(canonicalLevelId({ userData: { levelId: 42 } })).toBeUndefined();
  });
});
