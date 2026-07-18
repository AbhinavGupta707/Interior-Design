import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { optionA, optionB, optionsResponse } from "../../../apps/web/test/design-options/fixtures";
import { semanticOptionDifference } from "../../../apps/web/src/features/design-options/presentation";

const featureRoot = path.resolve(process.cwd(), "apps/web/src/features/design-options");
const comparisonSource = readFileSync(path.join(featureRoot, "option-comparison.tsx"), "utf8");
const workspaceSource = readFileSync(
  path.join(featureRoot, "design-options-workspace.tsx"),
  "utf8",
);

describe("C12 independent option comprehension and validity evaluation", () => {
  it("requires a complete pairwise matrix and at least two Pareto-valid options", () => {
    expect(optionsResponse.options).toHaveLength(2);
    expect(optionsResponse.optionSet?.pairwiseDiversity).toHaveLength(1);
    expect(optionsResponse.options.map(({ paretoNonDominated }) => paretoNonDominated)).toEqual([
      true,
      true,
    ]);
    expect(
      optionsResponse.options.every(({ operationBundle }) =>
        operationBundle.constraintResults
          .filter(({ strength }) => strength === "hard")
          .every(({ passed }) => passed),
      ),
    ).toBe(true);
  });

  it("proves real asset, assignment, placement, material, and operation differences", () => {
    expect(semanticOptionDifference(optionA, optionB)).toEqual({
      assetInventory: true,
      assignment: true,
      genuinelyDifferent: true,
      material: true,
      operationSignature: true,
      placement: true,
    });
    expect(optionA.operationBundle.operations[0]?.type).toBe("design.element.create.v1");
    expect(optionB.operationBundle.operations[0]?.type).toBe("design.element.create.v1");
  });

  it("keeps exact integer units, hashes, source pins, rights, and local-provider evidence visible", () => {
    for (const option of optionsResponse.options) {
      expect(option.baseBrief.contentSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(option.operationBundle.candidateSnapshotSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(option.providerManifest).toMatchObject({
        adapter: "deterministic-local-design-v1",
        externalNetworkUsed: false,
      });
      for (const { asset } of option.operationBundle.assetPlacements) {
        expect(Object.values(asset.geometryEnvelopeMm).every(Number.isInteger)).toBe(true);
        expect(asset.rights).toMatchObject({
          derivativesAllowed: true,
          redistributionAllowed: false,
          serviceProcessingAllowed: true,
          sourceKind: "creator-owned-synthetic",
          trainingAllowed: false,
        });
      }
    }
    expect(comparisonSource).toContain("Envelope (mm)");
    expect(comparisonSource).toContain("candidateSnapshotSha256");
  });

  it("states computational scope and routes unsupported certainty to review", () => {
    expect(comparisonSource).toContain("Computationally valid within the frozen scope");
    expect(comparisonSource).toContain("not structural, regulatory");
    expect(comparisonSource).not.toMatch(
      /architect approved|engineer approved|guaranteed cost|confirmed available/iu,
    );
    expect(
      optionsResponse.options.flatMap(({ professionalReview }) =>
        professionalReview.map(({ status }) => status),
      ),
    ).toEqual(["review-required", "review-required", "review-required", "review-required"]);
  });

  it("requires explicit acknowledgement and preserves sibling options after confirmation", () => {
    expect(comparisonSource).toContain("I reviewed this option’s exact pins");
    expect(comparisonSource).toContain("!acknowledged");
    expect(workspaceSource).toContain("Sibling options remain available");
    expect(workspaceSource).toContain('data-existing-profile-mutations="0"');
  });

  it("labels synthetic and production-composed evidence without claiming human quality", () => {
    expect(workspaceSource).toContain("Synthetic fixture presentation");
    expect(workspaceSource).toContain("Production-composed backend evidence");
    expect(workspaceSource).toContain("never relabelled as live backend or human-quality evidence");
  });
});
