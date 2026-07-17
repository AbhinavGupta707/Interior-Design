import { canonicalHomeSnapshotSchema } from "../../../packages/contracts/src/index.js";
import {
  canonicalGeometryEvaluationCases,
  canonicalProfileFixtures,
  canonicalSchemaEvaluationCases,
  generateRectanglePropertyCases,
} from "../../../packages/test-fixtures/src/models/index.js";
import { describe, expect, it } from "vitest";

import { evaluateReferenceGeometry, twiceSignedArea } from "./reference-geometry.js";

describe("C4 independent canonical geometry evaluation", () => {
  it.each(Object.entries(canonicalProfileFixtures))(
    "accepts the valid %s profile without a geometry finding",
    (_profile, snapshot) => {
      expect(evaluateReferenceGeometry(snapshot)).toEqual([]);
    },
  );

  it.each(canonicalGeometryEvaluationCases)(
    "matches exact retained findings for $fixtureId",
    (testCase) => {
      const snapshot = canonicalHomeSnapshotSchema.parse(testCase.snapshot);
      expect(evaluateReferenceGeometry(snapshot)).toEqual(testCase.expectedFindings);
    },
  );

  it.each(canonicalSchemaEvaluationCases)(
    "keeps $fixtureId in the schema-failure denominator",
    (testCase) => {
      expect(canonicalHomeSnapshotSchema.safeParse(testCase.input).success).toBe(false);
    },
  );

  it("uses BigInt as an independent area oracle for every fixed-seed rectangle", () => {
    for (const testCase of generateRectanglePropertyCases()) {
      expect(twiceSignedArea(testCase.points)).toBe(testCase.twiceAreaMm2);
    }
  });
});
