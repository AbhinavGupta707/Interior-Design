import type { PlanFixture } from "../../../packages/test-fixtures/src/plans/types.js";

import type {
  AdapterObservation,
  ConfidenceBand,
  ConfidenceSample,
  DistributionSummary,
  EvaluationDataset,
  GateResult,
  PlanEvaluationReport,
  RiskCoveragePoint,
} from "./types.js";

const thresholds = Object.freeze({
  acceptedCoveragePercent: 90,
  calibrationEce: 0.15,
  calibrationP90Millimetres: 25,
  hardNegativeAbstentionPercent: 100,
  minimumConfidenceSamples: 20,
  openingP90Millimetres: 75,
  parserDeadlineMilliseconds: 30_000,
  severeWallEndpointMillimetres: 250,
  wallP90Millimetres: 50,
});

interface EvaluatorInput {
  readonly adapter: PlanEvaluationReport["adapter"];
  readonly dataset: EvaluationDataset;
  readonly observations: readonly AdapterObservation[];
}

export function evaluatePlanAdapter(input: EvaluatorInput): PlanEvaluationReport {
  assertDataset(input.dataset);
  const expectedFixtures = [...input.dataset.inBox, ...input.dataset.hardNegatives];
  const expectedIds = new Set(expectedFixtures.map(({ id }) => id));
  const observationsByFixture = new Map<string, AdapterObservation>();
  let unknownObservationCount = 0;
  for (const observation of input.observations) {
    if (
      observation.adapterId !== input.adapter.adapterId ||
      observation.adapterVersion !== input.adapter.adapterVersion
    ) {
      throw new Error(`Observation adapter manifest mismatch for ${observation.fixtureId}.`);
    }
    if (!expectedIds.has(observation.fixtureId)) {
      unknownObservationCount += 1;
      continue;
    }
    if (observationsByFixture.has(observation.fixtureId)) {
      throw new Error(`Duplicate observation for ${observation.fixtureId}.`);
    }
    observationsByFixture.set(observation.fixtureId, observation);
  }

  const missingObservationCount = expectedFixtures.filter(
    ({ id }) => !observationsByFixture.has(id),
  ).length;
  const inBoxObservations = input.dataset.inBox.map((fixture) => ({
    fixture,
    observation: observationsByFixture.get(fixture.id),
  }));
  const negativeObservations = input.dataset.hardNegatives.map((fixture) => ({
    fixture,
    observation: observationsByFixture.get(fixture.id),
  }));

  const acceptedInBox = inBoxObservations.filter(
    ({ fixture, observation }) =>
      observation?.status === "proposal" && observation.sourceSha256 === fixture.sha256,
  );
  const abstainedNegatives = negativeObservations.filter(
    ({ observation }) => observation?.status === "abstained",
  );
  const coveragePercent = percent(acceptedInBox.length, input.dataset.inBox.length);
  const negativeAbstentionPercent = percent(
    abstainedNegatives.length,
    input.dataset.hardNegatives.length,
  );

  const severeErrors: { code: string; fixtureId: string }[] = [];
  for (const { fixture, observation } of [...inBoxObservations, ...negativeObservations]) {
    if (observation === undefined) continue;
    if (observation.crossScopeViolationCount > 0) {
      severeErrors.push({ code: "CROSS_SCOPE_VIOLATION", fixtureId: fixture.id });
    }
    if (observation.sourceSha256 !== fixture.sha256) {
      severeErrors.push({ code: "SOURCE_MISMATCH", fixtureId: fixture.id });
    }
    if (observation.status !== "proposal") continue;
    if (fixture.category === "hard-negative") {
      severeErrors.push({ code: "HARD_NEGATIVE_FALSE_ACCEPTANCE", fixtureId: fixture.id });
    }
    if (observation.geometry.levelCount !== 1) {
      severeErrors.push({ code: "WRONG_LEVEL", fixtureId: fixture.id });
    }
    if (observation.geometry.unhostedOpeningCount > 0) {
      severeErrors.push({ code: "UNHOSTED_OPENING", fixtureId: fixture.id });
    }
    if (observation.geometry.invalidRoomCount > 0) {
      severeErrors.push({ code: "INVALID_ROOM", fixtureId: fixture.id });
    }
    if (observation.geometry.hiddenOmittedRegionCount > 0) {
      severeErrors.push({ code: "HIDDEN_OMITTED_REGION", fixtureId: fixture.id });
    }
    if (
      observation.geometry.wallEndpointErrorsMillimetres.some(
        (error) => error > thresholds.severeWallEndpointMillimetres,
      )
    ) {
      severeErrors.push({ code: "SEVERE_WALL_ENDPOINT_ERROR", fixtureId: fixture.id });
    }
  }

  const acceptedProposals = acceptedInBox.flatMap(({ observation }) =>
    observation?.status === "proposal" ? [observation] : [],
  );
  const wallErrors = acceptedProposals.flatMap(
    ({ geometry }) => geometry.wallEndpointErrorsMillimetres,
  );
  const openingErrors = acceptedProposals.flatMap(
    ({ geometry }) => geometry.openingCentreErrorsMillimetres,
  );
  const calibrationErrors = acceptedProposals.flatMap(
    ({ geometry }) => geometry.calibrationResidualsMillimetres,
  );
  const confidenceSamples = acceptedProposals.flatMap(({ confidenceSamples }) => confidenceSamples);
  const confidence = confidenceReport(confidenceSamples);
  const processingSamples = [...observationsByFixture.values()].flatMap(({ processing }) =>
    processing === undefined ? [] : [processing],
  );
  const corrections = acceptedProposals.flatMap(({ correction }) =>
    correction === undefined ? [] : [correction],
  );
  const wallDistribution = distribution(wallErrors);
  const openingDistribution = distribution(openingErrors);
  const calibrationDistribution = distribution(calibrationErrors);
  const wallTimeDistribution = distribution(
    processingSamples.map(({ wallMilliseconds }) => wallMilliseconds),
  );
  const crossScopeViolations = [...observationsByFixture.values()].reduce(
    (sum, observation) => sum + observation.crossScopeViolationCount,
    0,
  );

  const gates = {
    acceptedInputCoveragePercent: minimumGate(coveragePercent, thresholds.acceptedCoveragePercent),
    calibrationEce:
      confidence.ece === null
        ? notEvaluableGate("insufficient-sample", thresholds.calibrationEce)
        : maximumGate(confidence.ece, thresholds.calibrationEce),
    calibrationResidualP90Millimetres: nullableMaximumGate(
      calibrationDistribution.p90,
      thresholds.calibrationP90Millimetres,
    ),
    crossScopeViolations: equalityGate(crossScopeViolations, 0),
    hardNegativeAbstentionPercent: minimumGate(
      negativeAbstentionPercent,
      thresholds.hardNegativeAbstentionPercent,
    ),
    openingCentreP90Millimetres: nullableMaximumGate(
      openingDistribution.p90,
      thresholds.openingP90Millimetres,
    ),
    processingDeadlineMilliseconds: nullableMaximumGate(
      wallTimeDistribution.maximum,
      thresholds.parserDeadlineMilliseconds,
    ),
    severeErrors: equalityGate(severeErrors.length, 0),
    wallEndpointP90Millimetres: nullableMaximumGate(
      wallDistribution.p90,
      thresholds.wallP90Millimetres,
    ),
  } satisfies PlanEvaluationReport["gates"];

  const promotionReasons: string[] = [];
  if (input.adapter.evidenceKind !== "producer-live") {
    promotionReasons.push("independent-reference-results-are-not-producer-evidence");
    promotionReasons.push("human-correction-time-not-measured");
  }
  if (unknownObservationCount > 0) promotionReasons.push("unknown-observations-present");
  for (const [name, gate] of Object.entries(gates)) {
    if (gate.status !== "passed") promotionReasons.push(`gate-${name}-${gate.status}`);
  }
  const report = {
    adapter: input.adapter,
    confidence,
    correction: {
      automatedActionCount: corrections.reduce((sum, { actionCount }) => sum + actionCount, 0),
      automatedSampleCount: corrections.length,
      automatedTimingStatus: "instrumentation-only",
      humanCorrectionMinutes: "not-measured",
      humanStudySampleCount: 0,
      targetStatus: "not-measured",
    },
    denominators: {
      hardNegative: input.dataset.hardNegatives.length,
      inBox: input.dataset.inBox.length,
      total: expectedFixtures.length,
    },
    errors: {
      calibrationResidualMillimetres: calibrationDistribution,
      openingCentreMillimetres: openingDistribution,
      wallEndpointMillimetres: wallDistribution,
    },
    failures: {
      abstainedInBox: inBoxObservations.filter(
        ({ observation }) => observation?.status === "abstained",
      ).length,
      failedHardNegative: negativeObservations.filter(
        ({ observation }) => observation?.status === "failed",
      ).length,
      failedInBox: inBoxObservations.filter(({ observation }) => observation?.status === "failed")
        .length,
      missingObservationCount,
      unknownObservationCount,
    },
    gates,
    generatedBy: "c6-independent-reference-evaluator-v1",
    generatedFrom: {
      fixtureSha256: expectedFixtures.map(({ sha256 }) => sha256),
      observationCount: input.observations.length,
    },
    processing: {
      cpuMilliseconds: distribution(
        processingSamples.map(({ cpuMilliseconds }) => cpuMilliseconds),
      ),
      observedPageCount: processingSamples.length,
      peakMemoryMebibytes: distribution(
        processingSamples.map(({ peakMemoryMebibytes }) => peakMemoryMebibytes),
      ),
      productionScaleClaim: false,
      wallMilliseconds: wallTimeDistribution,
    },
    promotion: {
      eligible: promotionReasons.length === 0,
      reasons: promotionReasons,
    },
    severeErrors,
  } satisfies PlanEvaluationReport;
  return Object.freeze(report);
}

function confidenceReport(samples: readonly ConfidenceSample[]) {
  const sufficient = samples.length >= thresholds.minimumConfidenceSamples;
  const bands: ConfidenceBand[] = [];
  for (let minimum = 0; minimum < 100; minimum += 10) {
    const maximum = minimum + 10;
    const selected = samples.filter(
      ({ confidence }) => confidence >= minimum && confidence < maximum,
    );
    bands.push({
      accuracy:
        selected.length === 0
          ? null
          : selected.filter(({ correct }) => correct).length / selected.length,
      count: selected.length,
      maximumExclusive: maximum,
      meanConfidence:
        selected.length === 0
          ? null
          : selected.reduce((sum, { confidence }) => sum + confidence, 0) / selected.length / 100,
      minimumInclusive: minimum,
    });
  }
  const ece = sufficient
    ? bands.reduce((sum, band) => {
        if (band.count === 0 || band.accuracy === null || band.meanConfidence === null) return sum;
        return sum + (band.count / samples.length) * Math.abs(band.accuracy - band.meanConfidence);
      }, 0)
    : null;
  return Object.freeze({
    bands: Object.freeze(bands),
    ece,
    minimumSampleCount: 20 as const,
    riskCoverage: Object.freeze([0, 60, 75, 90].map((value) => riskCoverage(samples, value))),
    sampleCount: samples.length,
    status: sufficient ? ("sufficient" as const) : ("insufficient-sample" as const),
  });
}

function riskCoverage(
  samples: readonly ConfidenceSample[],
  confidenceThreshold: number,
): RiskCoveragePoint {
  const selected = samples.filter(({ confidence }) => confidence >= confidenceThreshold);
  const errorCount = selected.filter(({ correct }) => !correct).length;
  return {
    confidenceThreshold,
    coverage: samples.length === 0 ? 0 : selected.length / samples.length,
    errorCount,
    risk: selected.length === 0 ? null : errorCount / selected.length,
    selectedCount: selected.length,
  };
}

function distribution(values: readonly number[]): DistributionSummary {
  if (values.length === 0) return { count: 0, maximum: null, median: null, p90: null };
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    maximum: sorted.at(-1) ?? null,
    median: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
  };
}

function percentile(sorted: readonly number[], quantile: number): number {
  const index = Math.max(0, Math.ceil(quantile * sorted.length) - 1);
  const value = sorted[index];
  if (value === undefined) throw new Error("Cannot calculate a percentile without samples.");
  return value;
}

function percent(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : (numerator / denominator) * 100;
}

function minimumGate(actual: number, target: number): GateResult {
  return { actual, comparator: ">=", status: actual >= target ? "passed" : "failed", target };
}

function maximumGate(actual: number, target: number): GateResult {
  return { actual, comparator: "<=", status: actual <= target ? "passed" : "failed", target };
}

function nullableMaximumGate(actual: number | null, target: number): GateResult {
  return actual === null
    ? notEvaluableGate("no-evaluable-samples", target)
    : maximumGate(actual, target);
}

function equalityGate(actual: number, target: number): GateResult {
  return { actual, comparator: "=", status: actual === target ? "passed" : "failed", target };
}

function notEvaluableGate(actual: string, target: number | string): GateResult {
  return { actual, comparator: "status", status: "not-evaluable", target };
}

function assertDataset(dataset: EvaluationDataset): void {
  if (dataset.inBox.length === 0 || dataset.hardNegatives.length === 0) {
    throw new Error("Both in-box and hard-negative denominators must be non-empty.");
  }
  const fixtures: readonly PlanFixture[] = [...dataset.inBox, ...dataset.hardNegatives];
  const ids = fixtures.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) throw new Error("Fixture IDs must be unique.");
  if (dataset.inBox.some(({ truth }) => truth === undefined)) {
    throw new Error("Every in-box fixture must retain independent geometry truth.");
  }
}
