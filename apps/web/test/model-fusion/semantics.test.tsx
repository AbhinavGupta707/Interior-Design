import { fusionProposalSchema, type FusionJob } from "@interior-design/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  canCancelFusion,
  canRetryFusion,
  connectedComponentCount,
  materialDecisionIds,
  proposalStatusLabel,
  registrationLabel,
} from "../../src/features/discrepancy-review/presentation";
import { ProposalReview } from "../../src/features/discrepancy-review/proposal-review";
import { decision, job, proposal } from "./fixtures";

describe("C9 accessible discrepancy semantics", () => {
  it("renders partial/disconnected registration, integer residuals and attributed unknown/inferred claims", () => {
    const markup = renderToStaticMarkup(
      <ProposalReview
        busy={false}
        decisions={[]}
        editable={true}
        onReview={vi.fn()}
        proposal={proposal}
      />,
    );
    expect(markup).toContain("Partial proposal");
    expect(markup).toContain("Partially registered");
    expect(markup).toContain("Not registered");
    expect(markup).toContain("Median residual");
    expect(markup).toContain("28 mm");
    expect(markup).toContain("85 mm");
    expect(markup).toContain("inferred");
    expect(markup).toContain("Confidence unknown");
    expect(markup).toContain("Proposal only");
    expect(markup).not.toMatch(/signedUrl|objectKey|credential/iu);
  });

  it("keeps viewer review controls disabled and explicitly read-only", () => {
    const markup = renderToStaticMarkup(
      <ProposalReview
        busy={false}
        decisions={[]}
        editable={false}
        onReview={vi.fn()}
        proposal={proposal}
      />,
    );
    expect(markup).toContain("disabled");
    expect(markup).toContain("Viewer access is read-only");
  });

  it("presents honest abstention without candidate geometry", () => {
    if (proposal.status === "abstained")
      throw new Error("Synthetic proposal must carry a candidate.");
    const {
      candidateSnapshot: _candidateSnapshot,
      candidateSnapshotSha256: _candidateSnapshotSha256,
      ...core
    } = proposal;
    const abstained = fusionProposalSchema.parse({
      ...core,
      coverage: { ...core.coverage, registeredSourceCount: 0 },
      findings: [
        {
          code: "FUSION_PRODUCER_UNAVAILABLE",
          detail: "No bounded provider-free semantic producer is composed.",
          severity: "error",
        },
      ],
      registrations: core.registrations.map((registration) => ({
        findings: [
          {
            code: "FUSION_REGISTRATION_PRODUCER_UNAVAILABLE",
            detail: "No registration producer is composed.",
            severity: "error",
          },
        ],
        schemaVersion: "c9-registration-result-v1" as const,
        sourceId: registration.sourceId,
        status: "unregistered" as const,
      })),
      safeCode: "FUSION_PRODUCER_UNAVAILABLE",
      status: "abstained",
    });
    const markup = renderToStaticMarkup(
      <ProposalReview
        busy={false}
        decisions={[]}
        editable={true}
        onReview={vi.fn()}
        proposal={abstained}
      />,
    );
    expect(markup).toContain("Fusion abstained");
    expect(markup).toContain("No candidate snapshot was published");
    expect(markup).toContain("left unchanged");
    expect(markup).not.toContain("Decision reason");
    expect(_candidateSnapshot).toBeDefined();
    expect(_candidateSnapshotSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("derives durable action availability and only material draft decisions", () => {
    expect(canCancelFusion(job)).toBe(true);
    expect(canRetryFusion(job)).toBe(false);
    const terminal = { ...job, attempt: 2, safeCode: "FUSION_FAILED", state: "failed" as const };
    expect(canRetryFusion(terminal as FusionJob)).toBe(true);
    expect(connectedComponentCount(proposal)).toBe(1);
    const disconnected = proposal.registrations[1];
    if (!disconnected) throw new Error("Synthetic disconnected registration is missing.");
    expect(registrationLabel(disconnected)).toBe("Not registered");
    expect(proposalStatusLabel(proposal.status)).toBe("Partial proposal");
    expect(materialDecisionIds([{ ...decision, choice: "accept-candidate" }])).toEqual([
      decision.id,
    ]);
    expect(materialDecisionIds([decision], proposal)).toEqual([]);
    expect(materialDecisionIds([{ ...decision, choice: "defer" }])).toEqual([]);
  });
});
