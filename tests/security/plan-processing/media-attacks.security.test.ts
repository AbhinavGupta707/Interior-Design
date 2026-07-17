import { describe, expect, it } from "vitest";

import {
  holdoutAdversarialPlanFixtures,
  holdoutHardNegativePlanFixtures,
} from "../../../packages/test-fixtures/src/plans/holdout/catalog.js";

import { inspectSource } from "./reference-boundary.js";

describe("C6 hostile media and prompt-content attacks", () => {
  for (const fixture of holdoutAdversarialPlanFixtures) {
    it(`handles ${fixture.id} with its explicit safe disposition`, () => {
      const decision = inspectSource(fixture);
      if (fixture.expected.disposition === "proposal") {
        expect(decision).toMatchObject({
          accepted: true,
          textPolicy: "discarded-untrusted-labels",
        });
        expect(decision.normalizedPrimitiveCount).toBeGreaterThan(0);
      } else {
        expect(decision.accepted).toBe(false);
        expect(decision.code).toBe(fixture.expected.abstentionCode);
      }
      expect(JSON.stringify(decision)).not.toMatch(/attacker\.invalid|READ ENV|document\.cookie/iu);
    });
  }

  it("keeps declared hard negatives available to the evaluator instead of coercing proposals", () => {
    expect(holdoutHardNegativePlanFixtures).toHaveLength(6);
    expect(
      holdoutHardNegativePlanFixtures.every(
        ({ expected }) =>
          expected.disposition === "abstained" && expected.abstentionCode !== undefined,
      ),
    ).toBe(true);
  });
});
