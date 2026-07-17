import { validateCanonicalGeometry } from "../../../packages/geometry-kernel/src/index.js";
import {
  canonicalGeometryEvaluationCases,
  canonicalProfileFixtures,
  type ExpectedGeometryFinding,
} from "../../../packages/test-fixtures/src/models/index.js";
import { describe, expect, it } from "vitest";

const integrationEnabled = process.env.C4_RUN_PRODUCER_INTEGRATION === "1";

const comparable = (finding: {
  readonly affectedElementIds: readonly string[];
  readonly code: string;
  readonly location?: { readonly levelId: string; readonly xMm: number; readonly yMm: number };
  readonly severity: string;
}): ExpectedGeometryFinding => ({
  affectedElementIds: [...finding.affectedElementIds].sort(),
  code: finding.code,
  ...(finding.location === undefined ? {} : { location: finding.location }),
  severity: finding.severity as ExpectedGeometryFinding["severity"],
});

describe.skipIf(!integrationEnabled)("C4 geometry producer integration", () => {
  it.each(Object.entries(canonicalProfileFixtures))(
    "returns no finding for the valid %s profile",
    (_profile, snapshot) => {
      expect(validateCanonicalGeometry(snapshot)).toEqual([]);
    },
  );

  it.each(canonicalGeometryEvaluationCases)("matches exact findings for $fixtureId", (testCase) => {
    const actual = validateCanonicalGeometry(testCase.snapshot)
      .map(comparable)
      .sort((left, right) =>
        `${left.code}\u0000${left.affectedElementIds.join(",")}`.localeCompare(
          `${right.code}\u0000${right.affectedElementIds.join(",")}`,
        ),
      );
    expect(actual).toEqual(testCase.expectedFindings);
  });
});
