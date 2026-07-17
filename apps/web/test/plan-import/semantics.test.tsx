import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CandidateInspector, CandidateList } from "../../src/features/plan-import/candidate-review";
import { PlanOverlay } from "../../src/features/editor-2d/plan-overlay/plan-overlay";
import { defaultReview } from "../../src/features/plan-import/review-model";
import { proposal } from "./fixtures";

describe("C6 correction semantics", () => {
  it("renders safe SVG primitives and an equivalent structured candidate list", () => {
    const selected = proposal.candidates[1];
    if (!selected) throw new Error("Missing candidate fixture.");
    const overlay = renderToStaticMarkup(
      <PlanOverlay
        onSelect={vi.fn()}
        proposal={proposal}
        selectedCandidateId={selected.candidateId}
        sourcePreviewUrl="http://localhost:3000/safe-derived-preview.png"
      />,
    );
    const list = renderToStaticMarkup(
      <CandidateList
        onSelect={vi.fn()}
        proposal={proposal}
        reviews={Object.fromEntries(
          proposal.candidates.map((candidate) => [candidate.candidateId, defaultReview(candidate)]),
        )}
        selectedCandidateId={selected.candidateId}
      />,
    );
    expect(overlay).toContain("<svg");
    expect(overlay).toContain("Safe derived preview");
    expect(overlay).toContain('role="button"');
    expect(overlay).not.toContain("dangerouslySetInnerHTML");
    expect(overlay).not.toContain("<script");
    expect(list).toContain("Every candidate needs an explicit review decision");
    expect(list).toContain('aria-pressed="true"');
  });

  it("gives viewers source/confidence/unknown context with no mutation controls", () => {
    const candidate = proposal.candidates[1];
    if (!candidate) throw new Error("Missing candidate fixture.");
    const markup = renderToStaticMarkup(
      <CandidateInspector
        candidate={candidate}
        editable={false}
        onReview={vi.fn()}
        proposal={proposal}
        review={defaultReview(candidate)}
      />,
    );
    expect(markup).toContain("Viewer access is read-only");
    expect(markup).toContain("Knowledge status");
    expect(markup).toContain("Confidence");
    expect(markup).toContain("Source region");
    expect(markup).not.toContain('type="radio"');
    expect(markup).not.toContain("Exact wall correction");
  });
});
