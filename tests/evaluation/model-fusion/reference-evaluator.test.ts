import { describe, expect, it } from "vitest";

import { fusionAcceptanceFixtures } from "../../../packages/test-fixtures/src/fusion/catalog.js";
import type { FusionCaseObservation } from "./types.js";

import { runFusionAdapter } from "./adapter-seam.js";
import { FusionReferenceAdapter } from "./reference-adapter.js";
import { evaluateFusion } from "./reference-evaluator.js";
import { createFusionReferenceReport } from "./report.js";

describe("C9 independent failure-inclusive fusion evaluation", () => {
  it("compares every eligible source and accepts only improvement or honest abstention", async () => {
    const report = await createFusionReferenceReport();

    expect(report.denominators).toEqual({
      expectedFixtures: 7,
      honestAbstentionFixtures: 3,
      meaningfulImprovementFixtures: 4,
      missingObservations: 0,
      observedFixtures: 7,
      singleSourceEligible: 22,
      unknownObservations: 0,
    });
    expect(report.failures.fusion).toEqual({
      abstained: 3,
      failed: 0,
      full: 2,
      partial: 2,
      total: 7,
    });
    expect(report.failures.singleSource).toEqual({
      abstained: 1,
      failed: 1,
      full: 0,
      partial: 20,
      total: 22,
    });
    expect(report.comparisons).toHaveLength(7);
    expect(report.comparisons.every(({ passed }) => passed)).toBe(true);
    expect(
      report.comparisons
        .filter(({ reason }) => reason === "meaningful-improvement")
        .every(
          ({ improvementMillionths }) =>
            (improvementMillionths ?? 0) >=
            report.acceptance.meaningfulImprovementMinimumMillionths,
        ),
    ).toBe(true);
    expect(report.acceptance).toMatchObject({ accepted: true, failedCaseIds: [] });
    expect(report.gates).toMatchObject({
      calibrationEceMillionths: { status: "passed" },
      caseAcceptance: { status: "passed" },
      severeErrors: { actual: 0, status: "passed" },
    });
    expect(report.severeErrors).toEqual([]);
  });

  it("reports every declared geometric, calibration, resource and timing metric", async () => {
    const report = await createFusionReferenceReport();

    for (const comparison of report.comparisons.filter(
      ({ reason }) => reason === "meaningful-improvement",
    )) {
      expect(comparison.bestSingleSourceId).not.toBeNull();
      expect(comparison.singleSourceMetrics.length).toBeGreaterThanOrEqual(4);
      expect(comparison.fusedMetrics).toMatchObject({
        coverageMillionths: 1_000_000,
        missingDimensionCount: 0,
        severeErrorCodes: [],
        topologyErrorCount: 0,
      });
      expect(comparison.fusedMetrics?.translationErrorMillimetres.p90).not.toBeNull();
      expect(comparison.fusedMetrics?.rotationErrorMicrodegrees.p90).not.toBeNull();
      expect(comparison.fusedMetrics?.scaleErrorPartsPerMillion.p90).not.toBeNull();
      expect(comparison.fusedMetrics?.dimensionErrorMillimetres.p90).not.toBeNull();
    }
    expect(report.calibration.sampleCount).toBe(24);
    expect(report.calibration.eceMillionths).not.toBeNull();
    expect(report.metrics.fusedLatencyMilliseconds.count).toBe(7);
    expect(report.metrics.fusedPeakMemoryBytes.count).toBe(7);
    expect(report.correction).toMatchObject({
      automatedSampleCount: 4,
      humanCorrectionTime: "NOT_MEASURED",
      humanStudySampleCount: 0,
      status: "instrumentation-only",
    });
    expect(report.correction.automatedReviewMilliseconds.count).toBe(4);
    expect(report.representativeAccuracyClaim).toBe(false);
    expect(report.promotion.eligible).toBe(false);
  });

  it("keeps missing observations and source failures in their original denominators", async () => {
    const { adapter, observations } = await baseline();
    const omitted = observations.at(-1);
    if (omitted === undefined) throw new Error("Expected an observation to omit.");
    const report = evaluateFusion({
      adapter: adapter.manifest,
      fixtures: fusionAcceptanceFixtures,
      observations: observations.slice(0, -1),
    });

    expect(report.denominators.expectedFixtures).toBe(7);
    expect(report.denominators.observedFixtures).toBe(6);
    expect(report.denominators.missingObservations).toBe(1);
    expect(report.failures.singleSource).toMatchObject({ abstained: 1, failed: 1 });
    expect(report.gates.caseAcceptance).toEqual({
      actual: 6,
      comparator: "=",
      status: "failed",
      target: 7,
    });
    expect(report.acceptance.accepted).toBe(false);
    expect(report.acceptance.failedCaseIds).toContain(omitted.fixtureId);
  });

  it("fails severe fabricated geometry instead of averaging it away", async () => {
    const { adapter, observations } = await baseline();
    const target = requireProposalObservation(observations);
    const fixture = fusionAcceptanceFixtures.find(({ id }) => id === target.fixtureId);
    if (fixture === undefined) throw new Error("Expected fixture for attacked observation.");
    const unknownRegion = fixture.truth.requiredUnknownRegionIds[0] ?? "synthetic-attacker-region";
    const attacked: FusionCaseObservation = {
      ...target,
      fusionCandidate: {
        ...target.fusionCandidate,
        geometry: {
          ...target.fusionCandidate.geometry,
          coveredRegionIds: [...target.fusionCandidate.geometry.coveredRegionIds, unknownRegion],
          levelCount: fixture.truth.levelCount + 1,
          surfacedDiscrepancyKinds: [],
          topologyEdges: [
            ...target.fusionCandidate.geometry.topologyEdges,
            "synthetic-attacker-room|synthetic-ground-living",
          ],
        },
      },
    };
    const report = evaluateFusion({
      adapter: adapter.manifest,
      fixtures: fusionAcceptanceFixtures,
      observations: observations.map((observation) =>
        observation.fixtureId === target.fixtureId ? attacked : observation,
      ),
    });
    const codes = new Set(report.severeErrors.map(({ code }) => code));
    expect(codes).toEqual(
      new Set([
        "EXPECTED_DISCREPANCY_HIDDEN",
        "UNSUPPORTED_REGION",
        "UNSUPPORTED_TOPOLOGY",
        "WRONG_LEVEL_COUNT",
      ]),
    );
    expect(report.gates.severeErrors.status).toBe("failed");
    expect(report.acceptance.accepted).toBe(false);
  });

  it("rejects incomplete baselines, hash substitution and non-finite resource observations", async () => {
    const { adapter, observations } = await baseline();
    const first = observations.find(
      ({ singleSourceObservations }) => singleSourceObservations.length > 1,
    );
    if (first === undefined) throw new Error("Expected a reference observation.");
    const incomplete = {
      ...first,
      singleSourceObservations: first.singleSourceObservations.slice(1),
    };
    expect(() =>
      evaluateFusion({
        adapter: adapter.manifest,
        fixtures: fusionAcceptanceFixtures,
        observations: observations.map((observation) =>
          observation.fixtureId === first.fixtureId ? incomplete : observation,
        ),
      }),
    ).toThrow("C9_OBSERVATION_BASELINE_SET_INCOMPLETE");

    const substituted = {
      ...first,
      fixtureManifestSha256: "f".repeat(64),
    };
    expect(() =>
      evaluateFusion({
        adapter: adapter.manifest,
        fixtures: fusionAcceptanceFixtures,
        observations: observations.map((observation) =>
          observation.fixtureId === first.fixtureId ? substituted : observation,
        ),
      }),
    ).toThrow("C9_OBSERVATION_FIXTURE_HASH_MISMATCH");

    const nonFinite: FusionCaseObservation = {
      ...first,
      fusionCandidate: {
        ...first.fusionCandidate,
        processing: { ...first.fusionCandidate.processing, latencyMilliseconds: Number.NaN },
      },
    };
    expect(() =>
      evaluateFusion({
        adapter: adapter.manifest,
        fixtures: fusionAcceptanceFixtures,
        observations: observations.map((observation) =>
          observation.fixtureId === first.fixtureId ? nonFinite : observation,
        ),
      }),
    ).toThrow("C9_CANDIDATE_RESOURCE_OR_SOURCE_INVALID");
  });
});

async function baseline() {
  const adapter = new FusionReferenceAdapter();
  const observations = await runFusionAdapter(adapter, fusionAcceptanceFixtures);
  return { adapter, observations };
}

function requireProposalObservation(
  observations: readonly FusionCaseObservation[],
): FusionCaseObservation & {
  readonly fusionCandidate: Extract<
    FusionCaseObservation["fusionCandidate"],
    { status: "full" | "partial" }
  >;
} {
  const observation = observations.find(
    ({ fusionCandidate }) =>
      (fusionCandidate.status === "full" || fusionCandidate.status === "partial") &&
      fusionCandidate.geometry.surfacedDiscrepancyKinds.length > 0,
  );
  if (
    observation === undefined ||
    (observation.fusionCandidate.status !== "full" &&
      observation.fusionCandidate.status !== "partial")
  ) {
    throw new Error("Expected a proposed fusion observation.");
  }
  return observation as FusionCaseObservation & {
    readonly fusionCandidate: Extract<
      FusionCaseObservation["fusionCandidate"],
      { status: "full" | "partial" }
    >;
  };
}
