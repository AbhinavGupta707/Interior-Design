import { describe, expect, it } from "vitest";

import {
  holdoutHardNegativePlanFixtures,
  holdoutInBoxPlanFixtures,
} from "../../../packages/test-fixtures/src/plans/holdout/catalog.js";

import { runAdapter } from "./adapter-seam.js";
import { parseObservationBundle } from "./observation-codec.js";
import { ReferenceBaselineAdapter } from "./reference-baseline-adapter.js";
import { evaluatePlanAdapter } from "./reference-evaluator.js";
import { createReferenceBaselineReport } from "./report.js";
import type { AdapterObservation } from "./types.js";

describe("C6 independent plan evaluator", () => {
  it("publishes the failure-inclusive reference baseline without producer claims", async () => {
    const report = await createReferenceBaselineReport();
    expect(report.denominators).toEqual({ hardNegative: 6, inBox: 10, total: 16 });
    expect(report.failures).toMatchObject({
      abstainedInBox: 1,
      failedHardNegative: 0,
      failedInBox: 0,
      missingObservationCount: 0,
      unknownObservationCount: 0,
    });
    expect(report.gates.acceptedInputCoveragePercent).toEqual({
      actual: 90,
      comparator: ">=",
      status: "passed",
      target: 90,
    });
    expect(report.gates.hardNegativeAbstentionPercent.status).toBe("passed");
    expect(report.gates.severeErrors.status).toBe("passed");
    expect(report.gates.crossScopeViolations.status).toBe("passed");
    expect(report.gates.wallEndpointP90Millimetres.status).toBe("passed");
    expect(report.gates.openingCentreP90Millimetres.status).toBe("passed");
    expect(report.gates.calibrationResidualP90Millimetres.status).toBe("passed");
    expect(report.confidence).toMatchObject({
      minimumSampleCount: 20,
      sampleCount: 45,
      status: "sufficient",
    });
    expect(report.confidence.ece).not.toBeNull();
    expect(report.confidence.ece ?? 1).toBeLessThanOrEqual(0.15);
    expect(report.confidence.riskCoverage).toHaveLength(4);
    expect(report.correction).toMatchObject({
      automatedSampleCount: 9,
      automatedTimingStatus: "instrumentation-only",
      humanCorrectionMinutes: "not-measured",
      humanStudySampleCount: 0,
      targetStatus: "not-measured",
    });
    expect(report.processing.productionScaleClaim).toBe(false);
    expect(report.promotion).toEqual({
      eligible: false,
      reasons: [
        "independent-reference-results-are-not-producer-evidence",
        "human-correction-time-not-measured",
      ],
    });
  });

  it("keeps missing, failed and abstained in-box results in the coverage denominator", async () => {
    const adapter = new ReferenceBaselineAdapter();
    const fixtures = [...holdoutInBoxPlanFixtures, ...holdoutHardNegativePlanFixtures];
    const baseline = [...(await runAdapter(adapter, fixtures))];
    const missingFixture = requireInBoxFixture(0);
    const failedFixture = requireInBoxFixture(1);
    const withoutOne = baseline.filter(({ fixtureId }) => fixtureId !== missingFixture.id);
    const failedId = failedFixture.id;
    const withFailure = withoutOne.map((observation): AdapterObservation =>
      observation.fixtureId === failedId
        ? {
            adapterId: observation.adapterId,
            adapterVersion: observation.adapterVersion,
            crossScopeViolationCount: 0,
            fixtureId: observation.fixtureId,
            safeCode: "PARSER_CRASH",
            sourceSha256: observation.sourceSha256,
            status: "failed",
          }
        : observation,
    );
    const report = evaluatePlanAdapter({
      adapter: adapter.manifest,
      dataset: {
        hardNegatives: holdoutHardNegativePlanFixtures,
        inBox: holdoutInBoxPlanFixtures,
      },
      observations: withFailure,
    });
    expect(report.denominators.inBox).toBe(10);
    expect(report.gates.acceptedInputCoveragePercent.actual).toBe(70);
    expect(report.gates.acceptedInputCoveragePercent.status).toBe("failed");
    expect(report.failures).toMatchObject({
      abstainedInBox: 1,
      failedInBox: 1,
      missingObservationCount: 1,
    });
  });

  it("classifies every frozen severe-error mode and never averages it away", async () => {
    const adapter = new ReferenceBaselineAdapter();
    const fixtures = [...holdoutInBoxPlanFixtures, ...holdoutHardNegativePlanFixtures];
    const baseline = [...(await runAdapter(adapter, fixtures))];
    const target = baseline.find(({ status }) => status === "proposal");
    if (target === undefined) throw new Error("Expected a proposal observation.");
    if (target.status !== "proposal") throw new Error("Expected a proposal fixture.");
    const attacked: AdapterObservation = {
      ...target,
      crossScopeViolationCount: 1,
      geometry: {
        ...target.geometry,
        hiddenOmittedRegionCount: 1,
        invalidRoomCount: 1,
        levelCount: 2,
        unhostedOpeningCount: 1,
        wallEndpointErrorsMillimetres: [251],
      },
      sourceSha256: "f".repeat(64),
    };
    const report = evaluatePlanAdapter({
      adapter: adapter.manifest,
      dataset: {
        hardNegatives: holdoutHardNegativePlanFixtures,
        inBox: holdoutInBoxPlanFixtures,
      },
      observations: baseline.map((observation) =>
        observation.fixtureId === target.fixtureId ? attacked : observation,
      ),
    });
    expect(new Set(report.severeErrors.map(({ code }) => code))).toEqual(
      new Set([
        "CROSS_SCOPE_VIOLATION",
        "HIDDEN_OMITTED_REGION",
        "INVALID_ROOM",
        "SEVERE_WALL_ENDPOINT_ERROR",
        "SOURCE_MISMATCH",
        "UNHOSTED_OPENING",
        "WRONG_LEVEL",
      ]),
    );
    expect(report.gates.severeErrors.status).toBe("failed");
    expect(report.gates.crossScopeViolations.status).toBe("failed");
  });

  it("reports insufficient confidence samples instead of calculating promotion ECE", async () => {
    const adapter = new ReferenceBaselineAdapter();
    const inBoxFixture = requireInBoxFixture(0);
    const proposal = await adapter.evaluate(inBoxFixture);
    if (proposal.status !== "proposal") throw new Error("Expected proposal.");
    const sparse: AdapterObservation = {
      ...proposal,
      confidenceSamples: proposal.confidenceSamples.slice(0, 3),
    };
    const negatives = await runAdapter(adapter, holdoutHardNegativePlanFixtures);
    const report = evaluatePlanAdapter({
      adapter: adapter.manifest,
      dataset: {
        hardNegatives: holdoutHardNegativePlanFixtures,
        inBox: [inBoxFixture],
      },
      observations: [sparse, ...negatives],
    });
    expect(report.confidence).toMatchObject({
      ece: null,
      sampleCount: 3,
      status: "insufficient-sample",
    });
    expect(report.gates.calibrationEce.status).toBe("not-evaluable");
    expect(report.promotion.reasons).toContain("gate-calibrationEce-not-evaluable");
  });

  it("strictly rejects malformed, oversized and unknown-field observation bundles", () => {
    expect(() => parseObservationBundle(new TextEncoder().encode("{"))).toThrow(
      "OBSERVATION_BUNDLE_MALFORMED",
    );
    expect(() => parseObservationBundle(new Uint8Array(5_242_881))).toThrow(
      "OBSERVATION_BUNDLE_TOO_LARGE",
    );
    expect(() =>
      parseObservationBundle(
        new TextEncoder().encode(
          JSON.stringify([
            {
              adapterId: "fixture-adapter",
              adapterVersion: "1",
              code: "low-confidence",
              crossScopeViolationCount: 0,
              fixtureId: "fixture-1",
              secret: "must-not-pass",
              sourceSha256: "a".repeat(64),
              status: "abstained",
            },
          ]),
        ),
      ),
    ).toThrow(/unknown field secret/u);
  });
});

function requireInBoxFixture(index: number) {
  const fixture = holdoutInBoxPlanFixtures[index];
  if (fixture === undefined) throw new Error(`Missing in-box fixture at index ${String(index)}.`);
  return fixture;
}
