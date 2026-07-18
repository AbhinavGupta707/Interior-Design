import { describe, expect, it } from "vitest";

import {
  exactSceneJobFromSearchParams,
  exactSceneJobHref,
  selectedSceneJobId,
} from "../../src/features/viewer-3d/deep-link";

describe("C10 exact scene deep links", () => {
  it("retains one valid exact job pin and rejects arrays or malformed identifiers", () => {
    const jobId = "a1000000-0000-4000-8000-000000000001";
    expect(exactSceneJobFromSearchParams({ jobId })).toBe(jobId);
    expect(exactSceneJobFromSearchParams({ jobId: [jobId, jobId] })).toBeUndefined();
    expect(exactSceneJobFromSearchParams({ jobId: "not-a-job" })).toBeUndefined();
  });

  it("constructs a project-scoped URL without browser authority or model payload", () => {
    const href = exactSceneJobHref(
      "a1000000-0000-4000-8000-000000000002",
      "a1000000-0000-4000-8000-000000000003",
    );
    expect(href).toBe(
      "/viewer/a1000000-0000-4000-8000-000000000002?jobId=a1000000-0000-4000-8000-000000000003",
    );
    expect(href).not.toMatch(/snapshot|role|token|operation/u);
  });

  it("selects the exact requested job unless a still-valid explicit user selection exists", () => {
    const jobs = [{ id: "first" }, { id: "exact" }, { id: "current" }];
    expect(selectedSceneJobId(jobs, undefined, "exact")).toBe("exact");
    expect(selectedSceneJobId(jobs, "current", "exact")).toBe("current");
    expect(selectedSceneJobId(jobs, "missing", "missing-too")).toBe("first");
    expect(selectedSceneJobId([], undefined, "exact")).toBeUndefined();
  });
});
