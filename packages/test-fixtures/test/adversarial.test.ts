import { canonicalHomeSnapshotSchema } from "@interior-design/contracts";
import { describe, expect, it } from "vitest";

import {
  canonicalGeometryEvaluationCases,
  canonicalSchemaEvaluationCases,
  producerGeometryIntegrationContract,
} from "../src/models/index.js";

describe("C4 adversarial evaluation contracts", () => {
  it.each(canonicalGeometryEvaluationCases)(
    "keeps $fixtureId schema-valid for geometry evaluation",
    (testCase) => {
      expect(canonicalHomeSnapshotSchema.safeParse(testCase.snapshot).success).toBe(true);
      expect(testCase.expectedFindings.length).toBeGreaterThan(0);
    },
  );

  it.each(canonicalSchemaEvaluationCases)(
    "rejects $fixtureId at the schema boundary",
    (testCase) => {
      const result = canonicalHomeSnapshotSchema.safeParse(testCase.input);
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((issue) => issue.path.join("."));
        for (const expectedIssue of testCase.expectedIssues) {
          expect(paths.some((path) => path.includes(expectedIssue.pathIncludes))).toBe(true);
        }
      }
    },
  );

  it("uses unique, stable fixture IDs and deterministic finding order", () => {
    const fixtureIds = [
      ...canonicalGeometryEvaluationCases.map((testCase) => testCase.fixtureId),
      ...canonicalSchemaEvaluationCases.map((testCase) => testCase.fixtureId),
    ];
    expect(new Set(fixtureIds).size).toBe(fixtureIds.length);
    for (const testCase of canonicalGeometryEvaluationCases) {
      const keys = testCase.expectedFindings.map(
        (finding) => `${finding.code}\u0000${finding.affectedElementIds.join(",")}`,
      );
      expect(keys).toEqual([...keys].sort((left, right) => left.localeCompare(right)));
    }
  });

  it("retains every severe error in the producer integration denominator", () => {
    const severeCases = canonicalGeometryEvaluationCases.filter(
      (testCase) => testCase.severeErrorExpected,
    );
    expect(severeCases).toHaveLength(12);
    expect(producerGeometryIntegrationContract.fixtureIds).toHaveLength(
      canonicalGeometryEvaluationCases.length,
    );
    expect(producerGeometryIntegrationContract.comparison).toBe(
      "exact-code-severity-location-and-affected-id-set",
    );
  });
});
