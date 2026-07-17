import { describe, expect, it } from "vitest";

import { evaluateReconstruction } from "./reference-evaluator.js";
import { syntheticDataset, syntheticObservations } from "./synthetic-dataset.js";
import type { ReconstructionObservation } from "./types.js";

describe("C8 independent reconstruction evaluation", () => {
  it("keeps failures and severe errors in denominators and reports every required resource field", () => {
    const report = evaluateReconstruction({
      dataset: syntheticDataset,
      observations: syntheticObservations,
    });

    expect(report.evidenceState).toBe("MIXED_EVIDENCE");
    expect(report.denominators).toEqual({ attempted: 4, notRun: 1, total: 5 });
    expect(report.failures).toEqual({ abstained: 1, disconnected: 1, failed: 1, partial: 1 });
    expect(report.metrics.registeredFrameCoverageMillionths).toBe(350_000);
    expect(report.metrics.failureRateMillionths).toBe(500_000);
    expect(report.metrics.severeErrorRateMillionths).toBe(250_000);
    expect(report.metrics.alignmentResidualMicrometres.p90).toBe(12_000);
    expect(report.metrics.geometricErrorMicrometres).toMatchObject({
      count: 3,
      maximum: 30_000,
      p90: 30_000,
    });
    expect(report.metrics.latencyMilliseconds).toMatchObject({ count: 4, maximum: 1_500 });
    expect(report.metrics.peakMemoryBytes).toMatchObject({ count: 4, maximum: 120_000_000 });
    expect(report.scaleStatusCounts).toEqual({
      "metric-estimated": 0,
      "metric-validated": 1,
      unknown: 1,
    });
    expect(report.representativeAccuracyClaim).toBe(false);
  });

  it("does not invent geometric error without truth and does not promote NOT RUN", () => {
    const invalid: ReconstructionObservation[] = structuredClone([...syntheticObservations]);
    invalid[1] = {
      ...invalid[1]!,
      geometricErrorMicrometres: [1],
      truthAvailable: false,
    };
    expect(() =>
      evaluateReconstruction({ dataset: syntheticDataset, observations: invalid }),
    ).toThrow("GEOMETRIC_ERROR_WITHOUT_TRUTH");

    const promoted: ReconstructionObservation[] = structuredClone([...syntheticObservations]);
    promoted[4] = { ...promoted[4]!, latencyMilliseconds: 1 };
    expect(() =>
      evaluateReconstruction({ dataset: syntheticDataset, observations: promoted }),
    ).toThrow("NOT_RUN_OBSERVATION_HAS_RUNTIME_EVIDENCE");
  });

  it("rejects customer/training data and duplicate cases", () => {
    expect(() =>
      evaluateReconstruction({
        dataset: { ...syntheticDataset, trainingUseConsent: "allowed" as "denied" },
        observations: syntheticObservations,
      }),
    ).toThrow("RECONSTRUCTION_DATASET_RIGHTS_INVALID");
    expect(() =>
      evaluateReconstruction({
        dataset: syntheticDataset,
        observations: [...syntheticObservations, syntheticObservations[0]!],
      }),
    ).toThrow("DUPLICATE_RECONSTRUCTION_CASE");
  });

  it("reports an empty hardware suite honestly as NOT RUN", () => {
    const report = evaluateReconstruction({
      dataset: { ...syntheticDataset, split: "holdout" },
      observations: [syntheticObservations[4]!],
    });
    expect(report.evidenceState).toBe("NOT_RUN");
    expect(report.metrics.failureRateMillionths).toBeNull();
    expect(report.metrics.registeredFrameCoverageMillionths).toBeNull();
  });
});
