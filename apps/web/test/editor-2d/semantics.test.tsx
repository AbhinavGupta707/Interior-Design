import {
  projectCanonicalSnapshotToPlan,
  selectCanonicalElement,
} from "@interior-design/editor-core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { EditorInspector } from "../../src/features/editor-2d/inspector";
import {
  reloadExistingSetup,
  UnmeasuredWorkspaceSetup,
} from "../../src/features/editor-2d/editor-workspace";
import { ElementList, PlanView } from "../../src/features/editor-2d/plan-view";
import { snapshot, uuid } from "./fixtures";

describe("C5 editor semantics", () => {
  it("renders SVG and an equivalent focusable element list", () => {
    const plan = projectCanonicalSnapshotToPlan(snapshot, {
      levelId: uuid(10),
      selectedElementId: uuid(20),
    });
    const svg = renderToStaticMarkup(<PlanView onSelect={vi.fn()} plan={plan} />);
    const list = renderToStaticMarkup(<ElementList onSelect={vi.fn()} plan={plan} />);
    expect(svg).toContain("<svg");
    expect(svg).toContain('role="button"');
    expect(svg).toContain("Exact millimetres");
    expect(list).toContain("Elements on this level");
    expect(list).toContain('aria-pressed="true"');
    expect(list).toContain("External wall");
  });

  it("gives viewers provenance and exact IDs with no editable control", () => {
    const selection = selectCanonicalElement(snapshot, uuid(20));
    if (!selection) throw new Error("Missing wall fixture.");
    const markup = renderToStaticMarkup(
      <EditorInspector
        actorUserId={uuid(1)}
        editable={false}
        onCommand={vi.fn()}
        selection={selection}
        snapGridMm={50}
        snapshot={snapshot}
      />,
    );
    expect(markup).toContain("Viewer access is read-only");
    expect(markup).toContain("Source and provenance");
    expect(markup).toContain(uuid(20));
    expect(markup).not.toContain("Add wall translation");
    expect(markup).not.toContain("Create elements");
    expect(markup).not.toContain("<form");
  });
  it("requires two explicit accessible acknowledgements before setup", () => {
    const markup = renderToStaticMarkup(
      <UnmeasuredWorkspaceSetup busy={false} editable onInitialize={vi.fn()} onReload={vi.fn()} />,
    );
    expect(markup).toContain("<fieldset");
    expect(markup).toContain("<legend>Confirm the unmeasured starting point</legend>");
    expect(markup.match(/type="checkbox"/gu)).toHaveLength(2);
    expect(markup).toContain("I confirm this home has at least one level.");
    expect(markup).toContain("all interior measurements are unknown");
    expect(markup).toContain("required");
    expect(markup).toContain("disabled");
    expect(markup).toContain("Reload server state");
    expect(markup).toContain("property-derived interior claims");
  });

  it("renders no setup mutation control for viewers", () => {
    const markup = renderToStaticMarkup(
      <UnmeasuredWorkspaceSetup
        busy={false}
        editable={false}
        onInitialize={vi.fn()}
        onReload={vi.fn()}
      />,
    );
    expect(markup).toContain("Viewer access is read-only");
    expect(markup).not.toContain("<form");
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain('type="checkbox"');
  });

  it("clears a conflicting initialization key before explicit server reload", async () => {
    const initializationKey = { current: "conflicting-key" as string | undefined };
    const reload = vi.fn().mockResolvedValue(undefined);

    await reloadExistingSetup(initializationKey, reload);

    expect(initializationKey.current).toBeUndefined();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
