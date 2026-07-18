import { describe, expect, it } from "vitest";

import {
  applySelectionBoard,
  buildInitialSpecificationLines,
  buildSpecificationRevision,
  initialSelectionBoard,
  verifySpecificationRevision,
} from "../src/index.js";
import type { SpecificationDomainError } from "../src/index.js";
import { hashes, ids, initialLinesInput, only, sourceConfirmation } from "./support.js";

function initialRevision() {
  return buildSpecificationRevision({
    branchId: ids.branch,
    branchRevision: 1,
    catalogReleaseId: ids.release,
    catalogReleaseSha256: hashes.release,
    createdAt: "2026-07-18T12:00:00.000Z",
    createdBy: ids.user,
    lines: buildInitialSpecificationLines(initialLinesInput()),
    modelSnapshotId: ids.snapshot,
    modelSnapshotSha256: hashes.snapshot,
    revision: 1,
    sourceConfirmation,
  });
}

describe("immutable specification revisions", () => {
  it("hashes canonically, verifies history, and rejects a one-byte tamper", () => {
    const revision = initialRevision();
    expect(verifySpecificationRevision(structuredClone(revision))).toEqual(revision);
    expect(() =>
      verifySpecificationRevision({
        ...revision,
        lines: revision.lines.map((line) => ({ ...line, notes: "tampered" })),
      }),
    ).toThrow(
      expect.objectContaining<Partial<SpecificationDomainError>>({ code: "INVALID_REVISION" }),
    );
  });

  it("creates note/decision-only revisions without mutating history or asset pins", () => {
    const current = initialRevision();
    const before = structuredClone(current);
    const line = only(current.lines);
    const next = applySelectionBoard(
      current,
      [
        {
          assetVersionId: line.assetVersionId,
          elementId: line.elementId,
          note: "Synthetic preference",
          state: "shortlisted",
        },
      ],
      {
        branchId: current.branchId,
        branchRevision: current.branchRevision,
        catalogReleaseId: current.catalogReleaseId,
        catalogReleaseSha256: current.catalogReleaseSha256,
        createdAt: "2026-07-18T12:00:01.000Z",
        createdBy: ids.user,
        modelSnapshotId: current.modelSnapshotId,
        modelSnapshotSha256: current.modelSnapshotSha256,
        revision: 2,
      },
    );
    expect(current).toEqual(before);
    expect(next.lines[0]).toMatchObject({
      assetVersionSha256: line.assetVersionSha256,
      decisionStatus: "shortlisted",
      notes: "Synthetic preference",
    });
    expect(initialSelectionBoard(next.lines, next.revision)).toMatchObject({ revision: 2 });
  });

  it("prevents the selection board from smuggling an asset substitution", () => {
    const current = initialRevision();
    expect(() =>
      applySelectionBoard(
        current,
        [{ assetVersionId: ids.asset, elementId: ids.element, note: "forged", state: "selected" }],
        {
          branchId: current.branchId,
          branchRevision: current.branchRevision,
          catalogReleaseId: current.catalogReleaseId,
          catalogReleaseSha256: current.catalogReleaseSha256,
          createdAt: "2026-07-18T12:00:01.000Z",
          createdBy: ids.user,
          modelSnapshotId: current.modelSnapshotId,
          modelSnapshotSha256: current.modelSnapshotSha256,
          revision: 2,
        },
      ),
    ).toThrow(
      expect.objectContaining<Partial<SpecificationDomainError>>({ code: "LINE_SET_MISMATCH" }),
    );
  });
});
