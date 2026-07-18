import { describe, expect, it } from "vitest";

import { consultationWorkspaceSchema } from "../../src/features/design-consultation/contracts";
import {
  canAcceptBrief,
  classificationFor,
  entryCounts,
  proposalHasExpired,
  reviewReasonLabel,
} from "../../src/features/design-consultation/presentation";
import { brief, proposal, workspace } from "./fixtures";

describe("C11 consultation presentation contracts", () => {
  it("validates a tenant-aligned, local-only workspace", () => {
    const parsed = consultationWorkspaceSchema.parse(workspace);
    expect(parsed.capability).toEqual(
      expect.objectContaining({ externalNetworkUsed: false, externalProviders: "disabled" }),
    );
  });

  it("rejects project, brief and session identity mismatches", () => {
    const mismatch = consultationWorkspaceSchema.safeParse({
      ...workspace,
      project: { ...workspace.project, tenantId: "c1100000-0000-4000-8000-000000000099" },
    });
    expect(mismatch.success).toBe(false);
    expect(
      consultationWorkspaceSchema.safeParse({
        ...workspace,
        brief: { ...brief, projectId: "c1100000-0000-4000-8000-000000000098" },
      }).success,
    ).toBe(false);
  });

  it("keeps every classification legible and independently counted", () => {
    const counts = entryCounts(brief);
    expect(Object.values(counts)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(classificationFor("hard-constraint").label).toBe("Constraint");
    expect(classificationFor("observed-evidence").label).toBe("Evidence");
    expect(classificationFor("inferred-suggestion").description).toContain(
      "not an established fact",
    );
  });

  it("distinguishes proposal expiry and named professional review", () => {
    expect(proposalHasExpired(proposal, Date.parse("2026-07-18T09:01:00.000Z"))).toBe(false);
    expect(proposalHasExpired(proposal, Date.parse("2100-07-18T09:01:00.000Z"))).toBe(true);
    expect(reviewReasonLabel("cost-certainty")).toBe("Cost review");
    expect(reviewReasonLabel("structural")).toBe("Structural engineer review");
  });

  it("requires attributable content before a draft can be accepted", () => {
    expect(canAcceptBrief(brief)).toBe(true);
    expect(canAcceptBrief({ ...brief, entries: [] })).toBe(false);
    expect(
      canAcceptBrief({
        ...brief,
        acceptedAt: "2026-07-18T10:00:00.000Z",
        acceptedBy: brief.updatedBy,
        status: "accepted",
      }),
    ).toBe(false);
  });
});
