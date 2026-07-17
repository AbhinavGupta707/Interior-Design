import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DomSceneFallback, ElementInspector } from "../../src/features/viewer-3d/dom-fallback";
import {
  canCancelScene,
  canRetryScene,
  sceneJobStateLabel,
} from "../../src/features/viewer-3d/presentation";
import { job, manifest } from "./fixtures";

describe("C10 accessible scene presentation", () => {
  it("keeps canonical IDs, source hash, omissions and professional limitations in DOM fallback", () => {
    const markup = renderToStaticMarkup(
      <DomSceneFallback
        manifest={manifest}
        onSelect={() => undefined}
        reason="WebGL unavailable in this browser."
        selectedElementId={manifest.elementMappings[1]?.elementId}
        visibleLevelIds={new Set([manifest.elementMappings[0]?.elementId ?? ""])}
      />,
    );
    expect(markup).toContain("Progressive enhancement fallback");
    expect(markup).toContain("Top-down model bounds overview; not a floor plan");
    expect(markup).toContain(manifest.sourceSnapshot.snapshotSha256);
    expect(markup).toContain(manifest.elementMappings[1]?.elementId);
    expect(markup).toContain("SYNTHETIC_FIXTURE_ONLY");
    expect(markup).not.toMatch(/surveyed floor plan|professionally approved/iu);
  });

  it("shows a synchronized read-only inspector without using display names as identity", () => {
    const selected = manifest.elementMappings[1];
    const markup = renderToStaticMarkup(
      <ElementInspector manifest={manifest} selectedElementId={selected?.elementId} />,
    );
    expect(markup).toContain("Canonical ID");
    expect(markup).toContain(selected?.elementId);
    expect(markup).toContain("Derived visualisation only");
    expect(markup).toContain("does not establish surveyed dimensions");
  });

  it("keeps lifecycle actions role-independent and attempt-bounded", () => {
    expect(sceneJobStateLabel("cancel-requested")).toBe("Cancellation requested");
    expect(canCancelScene({ ...job, sceneId: undefined, state: "compiling" } as never)).toBe(true);
    expect(
      canRetryScene({
        ...job,
        attempt: 2,
        safeCode: "SCENE_FAILED",
        sceneId: undefined,
        state: "failed",
      } as never),
    ).toBe(true);
    expect(
      canRetryScene({
        ...job,
        attempt: 3,
        safeCode: "SCENE_FAILED",
        sceneId: undefined,
        state: "failed",
      } as never),
    ).toBe(false);
  });
});
