import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  classificationFor,
  entryCounts,
  reviewReasonLabel,
} from "../../../apps/web/src/features/design-consultation/presentation";
import { evaluationBrief, evaluationProposal } from "./fixtures";

const featureRoot = path.resolve(process.cwd(), "apps/web/src/features/design-consultation");
const overviewSource = readFileSync(path.join(featureRoot, "brief-overview.tsx"), "utf8");
const proposalSource = readFileSync(path.join(featureRoot, "proposal-inspector.tsx"), "utf8");
const referenceSource = readFileSync(path.join(featureRoot, "reference-board.tsx"), "utf8");
const workspaceSource = readFileSync(path.join(featureRoot, "consultation-workspace.tsx"), "utf8");

describe("C11 independent brief-assistant comprehension evaluation", () => {
  it("gives every evidence status a distinct label and explanation", () => {
    const expected = new Map([
      ["observed-evidence", "Evidence"],
      ["household-assertion", "Assertion"],
      ["hard-constraint", "Constraint"],
      ["preference", "Preference"],
      ["inferred-suggestion", "Inference"],
      ["unresolved-conflict", "Conflict"],
      ["unknown", "Unknown"],
    ] as const);
    for (const [classification, label] of expected) {
      const presentation = classificationFor(classification);
      expect(presentation.label).toBe(label);
      expect(presentation.description.length).toBeGreaterThan(25);
    }
    expect(entryCounts(evaluationBrief)).toEqual({
      "hard-constraint": 1,
      "household-assertion": 1,
      "inferred-suggestion": 1,
      "observed-evidence": 1,
      preference: 1,
      "unresolved-conflict": 1,
      unknown: 1,
    });
  });

  it("renders status in named text and structure rather than colour alone", () => {
    expect(overviewSource).toContain("ClassificationBadge");
    expect(overviewSource).toContain('aria-label="Brief classification summary"');
    expect(overviewSource).toContain("presentation.label");
    expect(overviewSource).toContain("provenanceLabel(entry)");
  });

  it("keeps evidence/reference boundaries and immutable rights linkage explicit", () => {
    expect(referenceSource).toContain("rights-recorded source asset");
    expect(referenceSource).toContain("does not establish dimensions");
    expect(referenceSource).toContain("Rights record SHA-256");
    expect(evaluationBrief.referenceBoard[0]?.rightsRecordSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("routes unsupported claims to named review without professional certainty", () => {
    expect(reviewReasonLabel("structural")).toBe("Structural engineer review");
    expect(reviewReasonLabel("product-availability")).toBe("Product availability check");
    expect(
      evaluationProposal.professionalReview.every(({ status }) => status === "review-required"),
    ).toBe(true);
    expect(proposalSource).toContain("remain unresolved");
    expect(proposalSource).not.toMatch(/architect approved|guaranteed cost|confirmed available/iu);
  });

  it("requires explicit reviewed-state acknowledgements before brief confirmation and acceptance", () => {
    expect(proposalSource).toContain("I reviewed the included changes");
    expect(proposalSource).toContain("!acknowledged");
    expect(proposalSource).toContain("updates only the C11 design brief");
    expect(workspaceSource).toContain("I reviewed this exact revision");
    expect(workspaceSource).toContain("!acceptAcknowledged");
  });

  it("implements non-focus-stealing status announcements and named input errors", () => {
    expect(workspaceSource).toContain('aria-live="polite"');
    expect(workspaceSource).toContain('role="status"');
    expect(workspaceSource).toContain('role="alert"');
    expect(workspaceSource).toContain("aria-invalid={messageError");
    expect(workspaceSource).toContain("consultation-message-error");
  });
});
