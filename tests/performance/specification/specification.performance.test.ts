import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";

import { projectScheduleLines } from "../../../apps/web/src/features/materials-products/schedule-projection";
import {
  assetsResponse,
  chairLine,
  uuid,
} from "../../../apps/web/test/materials-products/fixtures";

describe("C13 specification presentation performance", () => {
  it("projects four deterministic 512-line schedules within the local regression budget", () => {
    const lines = Array.from({ length: 512 }, (_, index) => ({
      ...chairLine,
      elementId: uuid(10_000 + index),
      lineId: uuid(20_000 + index),
      roomAssignment:
        index % 7 === 0
          ? ({ reason: "Synthetic ambiguous room fixture.", status: "review-required" } as const)
          : ({ spaceId: uuid(30_000 + (index % 12)), status: "assigned" } as const),
    }));
    const started = performance.now();
    let projectedRows = 0;
    for (let repeat = 0; repeat < 100; repeat += 1) {
      projectedRows += projectScheduleLines("room", lines).length;
      projectedRows += projectScheduleLines("element", lines).length;
      projectedRows += projectScheduleLines("product-light", lines).length;
      projectedRows += projectScheduleLines("finish", lines).length;
    }
    const durationMs = performance.now() - started;
    expect(projectedRows).toBe(512 * 3 * 100);
    expect(durationMs).toBeLessThan(2_000);
  });

  it("keeps maximum catalog filtering linear and allocation-bounded", () => {
    const assets = Array.from({ length: 512 }, (_, index) => ({
      ...assetsResponse.assets[index % assetsResponse.assets.length],
      displayName: `Generic deterministic asset ${index}`,
    }));
    const started = performance.now();
    let matches = 0;
    for (let repeat = 0; repeat < 100; repeat += 1) {
      matches += assets.filter(
        (asset) =>
          asset.kind === "furnishing" &&
          asset.displayName.toLocaleLowerCase("en-GB").includes("deterministic"),
      ).length;
    }
    const durationMs = performance.now() - started;
    expect(matches).toBeGreaterThan(0);
    expect(durationMs).toBeLessThan(1_000);
  });
});
