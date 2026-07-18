import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { OptionComparison } from "../../src/features/design-options/option-comparison";
import { semanticOptionDifference } from "../../src/features/design-options/presentation";
import {
  confirmationA,
  ids,
  job,
  narrativeOnlyDuplicate,
  optionA,
  optionB,
  optionSet,
} from "./fixtures";

const workspaceSource = readFileSync(
  path.resolve(process.cwd(), "src/features/design-options/design-options-workspace.tsx"),
  "utf8",
);

function markup(editable: boolean, confirmed = false): string {
  return renderToStaticMarkup(
    <OptionComparison
      acknowledgements={{ [ids.optionA]: true }}
      confirmations={confirmed ? { [ids.optionA]: confirmationA } : {}}
      editable={editable}
      job={job}
      leftOptionId={ids.optionA}
      onAcknowledgedChange={vi.fn()}
      onConfirm={vi.fn()}
      onSelectionChange={vi.fn()}
      optionSet={optionSet}
      options={[optionA, optionB]}
      rightOptionId={ids.optionB}
    />,
  );
}

describe("C12 option semantics", () => {
  it("presents exact scope, pins, assets, assignments, trade-offs, reviews, and confirmation boundary", () => {
    const rendered = markup(true);
    expect(rendered).toContain("Compare operations, not just narratives");
    expect(rendered).toContain("Computationally valid within the frozen scope");
    expect(rendered).toContain("not structural, regulatory");
    expect(rendered).toContain("Asset inventory: different");
    expect(rendered).toContain("Placement: different");
    expect(rendered).toContain("undyed linen");
    expect(rendered).toContain("wool and walnut");
    expect(rendered).toContain("accessibility clinical");
    expect(rendered).toContain("Create a separate proposed branch");
    expect(rendered).toContain("c12-design-element-operation-v1");
  });

  it("makes viewer confirmation controls read-only", () => {
    const rendered = markup(false);
    expect(rendered).toContain("Viewer access is read-only");
    expect(rendered.match(/disabled=""/gu)?.length).toBeGreaterThanOrEqual(4);
  });

  it("shows branch, commit, and exact result hash after independent confirmation", () => {
    const rendered = markup(true, true);
    expect(rendered).toContain("Confirmed into an isolated proposed branch");
    expect(rendered).toContain(confirmationA.branchId);
    expect(rendered).toContain(confirmationA.commitId);
    expect(rendered).toContain(confirmationA.resultSnapshotSha256);
  });

  it("counts UUID and narrative changes as zero semantic diversity", () => {
    expect(semanticOptionDifference(optionA, narrativeOnlyDuplicate)).toEqual({
      assetInventory: false,
      assignment: false,
      genuinelyDifferent: false,
      material: false,
      operationSignature: false,
      placement: false,
    });
    expect(semanticOptionDifference(optionA, optionB).genuinelyDifferent).toBe(true);
  });

  it("binds cancel/retry to the displayed job object and keeps stale recovery explicit", () => {
    expect(workspaceSource).toContain("cancelJob(projectId, selectedJob)");
    expect(workspaceSource).toContain("retryJob(projectId, selectedJob)");
    expect(workspaceSource).toContain("Reload the exact latest pins before trying again.");
  });
});
