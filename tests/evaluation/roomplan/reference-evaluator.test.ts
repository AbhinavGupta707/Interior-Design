import { describe, expect, it } from "vitest";

import { evaluateRoomPlan } from "./reference-evaluator.js";
import {
  syntheticAdapterManifest,
  syntheticRoomPlanFixtures,
  syntheticRoomPlanObservations,
} from "./synthetic-dataset.js";
import { createSyntheticRoomPlanReport } from "./synthetic-report.js";
import type { RoomPlanObservation } from "./types.js";

describe("C7 failure-inclusive independent RoomPlan evaluator", () => {
  it("passes synthetic conformance without making a physical or producer claim", () => {
    const report = createSyntheticRoomPlanReport();
    expect(report.denominators).toEqual({
      hardNegative: 6,
      inBox: 6,
      physicalHardNegative: 0,
      physicalInBox: 0,
      physicalStructure: 0,
      total: 12,
    });
    expect(report.failures).toEqual({ abstainedInBox: 0, failed: 0, missing: 0, unknown: 0 });
    expect(report.gates.acceptedCoveragePercent).toMatchObject({ actual: 100, status: "passed" });
    expect(report.gates.hardNegativeAbstentionPercent).toMatchObject({
      actual: 100,
      status: "passed",
    });
    expect(report.gates.hashLinkagePercent.status).toBe("passed");
    expect(report.gates.severeErrors.status).toBe("passed");
    expect(report.gates.maximumMemoryMebibytes.status).toBe("passed");
    expect(report.gates.maximumWallMilliseconds.status).toBe("passed");
    expect(report.gates.physicalInBoxMinimum).toEqual({
      actual: "physical-field-not-run",
      comparator: "status",
      status: "not-evaluable",
      target: 12,
    });
    expect(report.gates.wallEndpointP90Millimetres.status).toBe("not-evaluable");
    expect(report.physicalGeometry.wallEndpointMillimetres.count).toBe(0);
    expect(report.promotion.eligible).toBe(false);
    expect(report.promotion.reasons).toContain("reference-adapter-is-not-producer-evidence");
    expect(report.promotion.reasons).toContain("gate-physicalInBoxMinimum-not-evaluable");
  });

  it("keeps missing, failed and abstained in-box attempts in the coverage denominator", () => {
    const inBox = syntheticRoomPlanFixtures.filter(({ category }) => category === "in-box");
    const missing = requireFixture(inBox, 0);
    const failed = requireFixture(inBox, 1);
    const abstained = requireFixture(inBox, 2);
    const observations = syntheticRoomPlanObservations
      .filter(({ fixtureId }) => fixtureId !== missing.id)
      .map((observation): RoomPlanObservation => {
        if (observation.fixtureId === failed.id) {
          return {
            ...observation,
            safeCode: "CONVERSION_FAILED",
            status: "failed",
          };
        }
        if (observation.fixtureId === abstained.id) {
          return {
            ...observation,
            code: "low-quality",
            status: "abstained",
          };
        }
        return observation;
      });
    const report = evaluateRoomPlan({
      adapter: syntheticAdapterManifest,
      fixtures: syntheticRoomPlanFixtures,
      observations,
    });
    expect(report.denominators.inBox).toBe(6);
    expect(report.gates.acceptedCoveragePercent.actual).toBeCloseTo(50);
    expect(report.gates.acceptedCoveragePercent.status).toBe("failed");
    expect(report.failures).toMatchObject({ abstainedInBox: 1, failed: 1, missing: 1 });
    expect(report.severeErrors).toContainEqual({
      code: "MISSING_OBSERVATION",
      fixtureId: missing.id,
    });
  });

  it("never averages away source substitution, canonical mutation or hard-negative acceptance", () => {
    const negative = syntheticRoomPlanFixtures.find(({ category }) => category === "hard-negative");
    if (negative === undefined) throw new Error("Expected a hard-negative fixture.");
    const attacked = syntheticRoomPlanObservations.map((observation): RoomPlanObservation => {
      if (observation.fixtureId !== negative.id) return observation;
      return {
        ...observation,
        canonicalMutationCount: 1,
        confidenceSamples: [],
        packageManifestSha256: "a".repeat(64),
        physicalGeometry: {
          openingCentreErrorsMillimetres: [],
          structureAlignmentResidualsMillimetres: [],
          wallEndpointErrorsMillimetres: [251],
        },
        proposalPackageManifestSha256: "b".repeat(64),
        sourceSha256: "f".repeat(64),
        status: "proposal",
      };
    });
    const report = evaluateRoomPlan({
      adapter: syntheticAdapterManifest,
      fixtures: syntheticRoomPlanFixtures,
      observations: attacked,
    });
    expect(new Set(report.severeErrors.map(({ code }) => code))).toEqual(
      new Set([
        "CANONICAL_MUTATION",
        "HARD_NEGATIVE_FALSE_ACCEPTANCE",
        "PROPOSAL_PACKAGE_HASH_MISMATCH",
        "SEVERE_WALL_ENDPOINT_ERROR",
        "SOURCE_HASH_MISMATCH",
      ]),
    );
    expect(report.gates.severeErrors.status).toBe("failed");
    expect(report.gates.hashLinkagePercent.status).toBe("failed");
    expect(report.gates.hardNegativeAbstentionPercent.status).toBe("failed");
  });

  it("rejects duplicate fixtures, duplicate observations and adapter drift deterministically", () => {
    const fixture = requireFixture(syntheticRoomPlanFixtures, 0);
    const observation = syntheticRoomPlanObservations.find(
      ({ fixtureId }) => fixture.id === fixtureId,
    );
    if (observation === undefined) throw new Error("Expected an observation.");
    expect(() =>
      evaluateRoomPlan({
        adapter: syntheticAdapterManifest,
        fixtures: [...syntheticRoomPlanFixtures, fixture],
        observations: syntheticRoomPlanObservations,
      }),
    ).toThrow("DUPLICATE_FIXTURE");
    expect(() =>
      evaluateRoomPlan({
        adapter: syntheticAdapterManifest,
        fixtures: syntheticRoomPlanFixtures,
        observations: [...syntheticRoomPlanObservations, observation],
      }),
    ).toThrow("DUPLICATE_OBSERVATION");
    expect(() =>
      evaluateRoomPlan({
        adapter: syntheticAdapterManifest,
        fixtures: syntheticRoomPlanFixtures,
        observations: [{ ...observation, adapterVersion: "attacker-version" }],
      }),
    ).toThrow("ADAPTER_MANIFEST_MISMATCH");
  });
});

function requireFixture<T>(fixtures: readonly T[], index: number): T {
  const fixture = fixtures[index];
  if (fixture === undefined) throw new Error(`Missing fixture at index ${String(index)}.`);
  return fixture;
}
