import type { FusionOperationDraft } from "@interior-design/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CanonicalHandoffPanel } from "../../src/features/homeowner-journey/canonical-handoff-panel";

const projectId = "00000000-0000-4000-8000-000000000301";
const hash = "d".repeat(64);
const draft = {
  baseSnapshot: {
    modelId: "00000000-0000-4000-8000-000000000302",
    profile: "existing",
    snapshotId: "00000000-0000-4000-8000-000000000303",
    snapshotSha256: hash,
  },
  branchId: "00000000-0000-4000-8000-000000000304",
  decisionIds: ["00000000-0000-4000-8000-000000000305"],
  expectedBranchRevision: 0,
  expectedHeadSnapshotSha256: hash,
  operations: [
    {
      clientOperationId: "00000000-0000-4000-8000-000000000306",
      input: {},
      reason: "Reviewed discrepancy",
      schemaVersion: "c5-model-operation-v1",
      type: "space.rename.v1",
    },
  ],
  projectId,
  proposalId: "00000000-0000-4000-8000-000000000307",
  schemaVersion: "c9-operation-draft-v1",
} as unknown as FusionOperationDraft;

describe("C14.1 canonical handoff semantics", () => {
  it("renders one explicit preview gesture and no automatic commit control before preview", () => {
    const markup = renderToStaticMarkup(
      <CanonicalHandoffPanel draft={draft} editable projectId={projectId} />,
    );
    expect(markup).toContain("Preview typed corrections");
    expect(markup).toContain("Preview is non-mutating");
    expect(markup).toContain('aria-live="polite"');
    expect(markup).not.toContain("Confirm corrections and commit");
    expect(markup).not.toContain("Create scene from current committed profile");
    expect(markup).not.toMatch(/signedUrl|objectKey|storageKey|bearer|credential/iu);
  });

  it("removes every mutation control for viewers", () => {
    const markup = renderToStaticMarkup(
      <CanonicalHandoffPanel draft={draft} editable={false} projectId={projectId} />,
    );
    expect(markup).toContain("Viewer access is read-only");
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("Preview typed corrections");
  });
});
