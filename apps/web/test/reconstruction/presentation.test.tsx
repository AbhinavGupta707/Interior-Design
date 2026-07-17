import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  diagnosticMessage,
  reconstructionStages,
} from "../../src/features/reconstruction/presentation";
import { ReconstructionResultPanel } from "../../src/features/reconstruction/result-panel";
import { RuntimeStatus } from "../../src/features/reconstruction/runtime-status";
import { abstainedResult, job, partialResult, workspace } from "./fixtures";

describe("C8 accessible status and result presentation", () => {
  it("keeps partial, disconnected and unknown-scale geometry explicit and separates appearance", () => {
    const markup = renderToStaticMarkup(<ReconstructionResultPanel result={partialResult} />);
    expect(markup).toContain("Proposal published");
    expect(markup).toContain("Some prepared frames did not register");
    expect(markup).toContain("Disconnected components were not silently merged");
    expect(markup).toContain("Scale remains unknown");
    expect(markup).toContain("Geometry · proposal-only");
    expect(markup).toContain("Appearance · non-dimensional");
    expect(markup).toContain("No layer published");
    expect(markup).not.toMatch(/signedUrl|objectKey|sourceObjectKey/u);
  });

  it("renders honest no-provider/no-GPU states and a durable queued stage", () => {
    const runtime = renderToStaticMarkup(<RuntimeStatus capabilities={workspace.capabilities} />);
    const stages = reconstructionStages(job, workspace.capabilities);
    expect(runtime).toContain("Geometry worker");
    expect(runtime).toContain("GPU runtime");
    expect(runtime.match(/data-state="unavailable"/gu)).toHaveLength(3);
    expect(stages[0]).toMatchObject({ state: "current" });
    expect(stages[0]?.detail).toContain("Durably queued");
    expect(diagnosticMessage("SCALE_UNKNOWN")).toContain("arbitrary units");
  });

  it("explains an immutable abstention without implying geometry", () => {
    const markup = renderToStaticMarkup(<ReconstructionResultPanel result={abstainedResult} />);
    expect(markup).toContain("Abstained safely");
    expect(markup).toContain("No geometry proposal was published");
    expect(markup).toContain("did not invent missing geometry");
    expect(markup).toContain("INSUFFICIENT_OVERLAP");
    expect(markup).not.toContain("Geometry result summary");
  });
});
