import { describe, expect, it } from "vitest";

import {
  artifactLabel,
  canCancel,
  canRetry,
  jobStateLabel,
  renderStages,
  stageIndex,
} from "../../src/features/render-stills/presentation";
import { failedJob, job, queuedJob } from "./fixtures";

describe("C14 render lifecycle presentation", () => {
  it("keeps all safe stages visible and actions tied to durable terminal state", () => {
    expect(renderStages.map(({ label }) => label)).toEqual([
      "Queued",
      "Preparing exact inputs",
      "Rendering safe result",
      "Validating passes",
      "Publishing immutable result",
      "Safe result ready",
    ]);
    expect(stageIndex("publishing-safe")).toBe(4);
    expect(stageIndex("succeeded")).toBe(5);
    expect(canCancel(queuedJob)).toBe(true);
    expect(canRetry(failedJob)).toBe(true);
    expect(canRetry(job)).toBe(false);
  });

  it("labels safe, diagnostic and optional outputs without authority inflation", () => {
    expect(jobStateLabel("succeeded")).toBe("Safe result published");
    expect(artifactLabel("geometry-safe-png")).toBe("Geometry-locked deterministic render");
    expect(artifactLabel("illustrative-enhancement-png")).toBe("Illustrative optional enhancement");
    expect(artifactLabel("multilayer-exr")).toContain("container metadata");
  });
});
