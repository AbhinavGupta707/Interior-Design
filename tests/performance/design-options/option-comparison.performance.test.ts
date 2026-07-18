import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  narrativeOnlyDuplicate,
  optionA,
  optionB,
} from "../../../apps/web/test/design-options/fixtures";
import { semanticOptionDifference } from "../../../apps/web/src/features/design-options/presentation";

describe("C12 canvas-independent comparison performance", () => {
  it("derives bounded semantic differences without quadratic asset scans", () => {
    const started = performance.now();
    for (let index = 0; index < 2_000; index += 1) {
      const result = semanticOptionDifference(
        optionA,
        index % 2 === 0 ? optionB : narrativeOnlyDuplicate,
      );
      expect(typeof result.genuinelyDifferent).toBe("boolean");
    }
    const durationMs = performance.now() - started;
    expect(durationMs).toBeLessThan(1_000);
  });

  it("keeps the primary comparison path DOM/SVG-native with no canvas dependency", () => {
    const source = readFileSync(
      path.resolve(process.cwd(), "apps/web/src/features/design-options/option-comparison.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/<canvas|three|webgl|requestAnimationFrame/iu);
    expect(source).toContain("<table>");
    expect(source).toContain("<meter");
  });
});
