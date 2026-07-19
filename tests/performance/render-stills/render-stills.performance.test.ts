import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";

import {
  compareProtectedImageGeometry,
  inspectRenderArtifact,
} from "../../../packages/render-evaluation/src/index";
import { artifactFor, solidPng } from "../../../packages/render-evaluation/test/fixtures";

describe("C14 bounded independent evaluation performance", () => {
  it("decodes and hashes a bounded 1024px PNG within the local regression ceiling", async () => {
    const bytes = await solidPng({ b: 96, g: 128, r: 160 }, 1_024, 1_024);
    const started = performance.now();
    const result = await inspectRenderArtifact(
      bytes,
      artifactFor(bytes, "geometry-safe-png", 1_024, 1_024),
    );
    expect(result.widthPx).toBe(1_024);
    expect(performance.now() - started).toBeLessThan(3_000);
  });

  it("keeps a five-image 256px geometry guard bounded in time and heap growth", async () => {
    const before = process.memoryUsage().heapUsed;
    const base = await solidPng({ b: 48, g: 64, r: 80 }, 256, 256);
    const mask = await solidPng({ b: 0, g: 0, r: 0 }, 256, 256);
    const segmentation = await solidPng({ b: 3, g: 2, r: 1 }, 256, 256);
    const started = performance.now();
    const result = await compareProtectedImageGeometry({
      allowedEditMaskPng: mask,
      basePng: base,
      baseSegmentationPng: segmentation,
      candidatePng: base,
      candidateSegmentationPng: segmentation,
    });
    const heapGrowth = process.memoryUsage().heapUsed - before;
    expect(result.changedPixelCount).toBe(0);
    expect(performance.now() - started).toBeLessThan(3_000);
    expect(heapGrowth).toBeLessThan(128 * 1024 * 1024);
  });
});
