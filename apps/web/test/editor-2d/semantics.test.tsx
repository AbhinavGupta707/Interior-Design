import {
  projectCanonicalSnapshotToPlan,
  selectCanonicalElement,
} from "@interior-design/editor-core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { EditorInspector } from "../../src/features/editor-2d/inspector";
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
});
