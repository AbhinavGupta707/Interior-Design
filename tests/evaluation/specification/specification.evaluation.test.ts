import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  artifactReadiness,
  assetSelectable,
  commercialUnknowns,
  previewTruth,
  rightsLabel,
  roomLabel,
} from "../../../apps/web/src/features/materials-products/presentation";
import {
  chairAsset,
  finishLine,
  preview,
  sofaAsset,
  specification,
  withdrawnAsset,
} from "../../../apps/web/test/materials-products/fixtures";

const workspaceSource = readFileSync(
  path.resolve(
    process.cwd(),
    "apps/web/src/features/materials-products/materials-products-workspace.tsx",
  ),
  "utf8",
);
const previewSource = readFileSync(
  path.resolve(process.cwd(), "apps/web/src/features/materials-products/preview-panel.tsx"),
  "utf8",
);

describe("C13 independent specification language evaluation", () => {
  it("keeps source, rights, representation, and commercial truth independently visible", () => {
    expect(chairAsset.rights.sourceKind).toBe("creator-owned-synthetic");
    expect(sofaAsset.rights.sourceKind).toBe("licensed-local");
    expect(artifactReadiness(chairAsset)).toContain("Validated local GLB");
    expect(artifactReadiness(chairAsset)).toContain("Placement remains a bounded proxy");
    expect(commercialUnknowns).toEqual([
      "Price not provided",
      "Supplier not provided",
      "Stock not provided",
      "Delivery not provided",
    ]);
  });

  it("blocks new selection for withdrawn rights and never silently infers a room", () => {
    expect(assetSelectable(withdrawnAsset)).toBe(false);
    expect(rightsLabel(withdrawnAsset)).toContain("withdrawn");
    expect(roomLabel(finishLine)).toContain("Room review required");
    expect(finishLine.roomAssignment.status).toBe("review-required");
  });

  it("uses bounded pre-confirmation language and an exact post-confirmation scene seam", () => {
    expect(previewTruth()).toContain("bounded catalog preview");
    expect(previewTruth(preview)).toContain("not canonical");
    expect(previewSource).toContain("/viewer/${projectId}?jobId=${confirmation.sceneJobId}");
    expect(workspaceSource).toContain('data-existing-mutations="0"');
    expect(workspaceSource).toContain('data-as-built-mutations="0"');
  });

  it("retains one immutable line truth for all four schedule projections", () => {
    expect(specification.currentRevision.lines).toHaveLength(3);
    expect(new Set(specification.currentRevision.lines.map(({ lineId }) => lineId)).size).toBe(3);
    expect(
      specification.currentRevision.lines.find(({ kind }) => kind === "finish")?.quantity,
    ).toEqual({ reason: "not-derived-in-c13", state: "unknown" });
  });

  it("contains no purchase, professional, structural, or canonical-preview certainty claim", () => {
    expect(workspaceSource).not.toMatch(
      /in stock|buy now|guaranteed delivery|architect approved/iu,
    );
    expect(workspaceSource).toContain("not an approval, purchase, quote, availability check");
    expect(workspaceSource).toContain("Preview one safe replacement at a time");
  });
});
