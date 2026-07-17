import { deterministicSha256 } from "../../../packages/test-fixtures/src/fusion/deterministic.js";
import type {
  FusionAcceptanceFixture,
  FusionCandidate,
  FusionConfidenceSample,
  FusionExactTruth,
  FusionProposedCandidate,
  FusionTransform,
} from "../../../packages/test-fixtures/src/fusion/types.js";

import type {
  CandidateMetricVector,
  CandidateStatusSummary,
  DistributionSummary,
  FusionCaseComparison,
  FusionCaseObservation,
  FusionEvaluationAdapterManifest,
  FusionEvaluationReport,
  GateResult,
} from "./types.js";

const meaningfulImprovementMinimumMillionths = 150_000 as const;
const calibrationEceMaximumMillionths = 150_000;
const safeCode = /^[A-Z][A-Z0-9_]{2,79}$/u;
const sha256 = /^[a-f0-9]{64}$/u;

interface EvaluatorInput {
  readonly adapter: FusionEvaluationAdapterManifest;
  readonly fixtures: readonly FusionAcceptanceFixture[];
  readonly observations: readonly FusionCaseObservation[];
}

export function evaluateFusion(input: EvaluatorInput): FusionEvaluationReport {
  assertAdapter(input.adapter);
  assertDataset(input.fixtures);
  const fixturesById = new Map(input.fixtures.map((fixture) => [fixture.id, fixture]));
  const observationsById = new Map<string, FusionCaseObservation>();
  let unknownObservations = 0;
  for (const observation of input.observations) {
    if (
      observation.adapterId !== input.adapter.adapterId ||
      observation.adapterVersion !== input.adapter.adapterVersion
    ) {
      throw new Error(`C9_OBSERVATION_ADAPTER_MISMATCH:${observation.fixtureId}`);
    }
    const fixture = fixturesById.get(observation.fixtureId);
    if (fixture === undefined) {
      unknownObservations += 1;
      continue;
    }
    if (observationsById.has(observation.fixtureId)) {
      throw new Error(`C9_DUPLICATE_OBSERVATION:${observation.fixtureId}`);
    }
    assertObservation(fixture, observation);
    observationsById.set(observation.fixtureId, observation);
  }

  const comparisons = input.fixtures.flatMap((fixture) => {
    const observation = observationsById.get(fixture.id);
    return observation === undefined ? [] : [compareCase(fixture, observation)];
  });
  const missingFixtureIds = input.fixtures
    .filter(({ id }) => !observationsById.has(id))
    .map(({ id }) => id);
  const failedCaseIds = [
    ...missingFixtureIds,
    ...comparisons.filter(({ passed }) => !passed).map(({ fixtureId }) => fixtureId),
  ].sort();
  const fusedCandidates = [...observationsById.values()].map(
    ({ fusionCandidate }) => fusionCandidate,
  );
  const singleSourceCandidates = [...observationsById.values()].flatMap(
    ({ singleSourceObservations }) => singleSourceObservations.map(({ candidate }) => candidate),
  );
  const fusedProposals = fusedCandidates.filter(isProposal);
  const fusionConfidenceSamples = fusedProposals.flatMap(
    ({ geometry }) => geometry.confidenceSamples,
  );
  const calibrationEce = expectedCalibrationErrorMillionths(fusionConfidenceSamples);
  const corrections = fusedProposals.map(({ correction }) => correction);
  const automatedDurations = corrections.map(
    ({ reviewCompletedMonotonicMilliseconds, reviewStartedMonotonicMilliseconds }) =>
      reviewCompletedMonotonicMilliseconds - reviewStartedMonotonicMilliseconds,
  );
  const severeErrors = comparisons.flatMap(({ fixtureId, fusedMetrics }) =>
    (fusedMetrics?.severeErrorCodes ?? []).map((code) => ({ code, fixtureId })),
  );
  const fusedMetrics = comparisons.flatMap(({ fusedMetrics }) =>
    fusedMetrics === null ? [] : [fusedMetrics],
  );
  const bestBaselineMetrics = comparisons.flatMap(({ bestSingleSourceMetrics }) =>
    bestSingleSourceMetrics === null ? [] : [bestSingleSourceMetrics],
  );
  const caseAcceptance = equalityGate(
    comparisons.filter(({ passed }) => passed).length,
    input.fixtures.length,
  );
  const gates = {
    calibrationEceMillionths: maximumGate(
      calibrationEce ?? 1_000_000,
      calibrationEceMaximumMillionths,
    ),
    caseAcceptance,
    severeErrors: equalityGate(severeErrors.length, 0),
  } satisfies FusionEvaluationReport["gates"];

  const report = {
    acceptance: {
      accepted: Object.values(gates).every(({ status }) => status === "passed"),
      failedCaseIds,
      meaningfulImprovementMinimumMillionths,
      rule: "improve-best-single-source-or-honestly-abstain",
    },
    adapter: input.adapter,
    calibration: {
      eceMillionths: calibrationEce,
      sampleCount: fusionConfidenceSamples.length,
    },
    comparisons: Object.freeze(comparisons),
    correction: {
      automatedActionCount: corrections.reduce(
        (sum, { automatedActionCount }) => sum + automatedActionCount,
        0,
      ),
      automatedReviewMilliseconds: distribution(automatedDurations),
      automatedSampleCount: corrections.length,
      humanCorrectionTime: "NOT_MEASURED",
      humanStudySampleCount: 0,
      status: "instrumentation-only",
    },
    denominators: {
      expectedFixtures: input.fixtures.length,
      honestAbstentionFixtures: input.fixtures.filter(
        ({ expected }) => expected.disposition === "honest-abstention",
      ).length,
      meaningfulImprovementFixtures: input.fixtures.filter(
        ({ expected }) => expected.disposition === "meaningful-improvement",
      ).length,
      missingObservations: missingFixtureIds.length,
      observedFixtures: observationsById.size,
      singleSourceEligible: input.fixtures.reduce(
        (sum, { sources }) =>
          sum +
          sources.filter(({ eligibleSingleSourceBaseline }) => eligibleSingleSourceBaseline).length,
        0,
      ),
      unknownObservations,
    },
    failures: {
      fusion: summarizeStatuses(fusedCandidates),
      singleSource: summarizeStatuses(singleSourceCandidates),
    },
    gates,
    generatedBy: "c9-independent-fusion-evaluator-v1",
    metrics: {
      bestSingleSourceQualityPenaltyMillionths: distribution(
        bestBaselineMetrics.map(({ qualityPenaltyMillionths }) => qualityPenaltyMillionths),
      ),
      fusedCoverageMillionths: distribution(
        fusedMetrics.map(({ coverageMillionths }) => coverageMillionths),
      ),
      fusedDimensionErrorMillimetres: distribution(
        fusedMetrics.flatMap(({ dimensionErrorMillimetres }) =>
          dimensionErrorMillimetres.p90 === null ? [] : [dimensionErrorMillimetres.p90],
        ),
      ),
      fusedLatencyMilliseconds: distribution(
        fusedCandidates.map(({ processing }) => processing.latencyMilliseconds),
      ),
      fusedPeakMemoryBytes: distribution(
        fusedCandidates.map(({ processing }) => processing.peakMemoryBytes),
      ),
      fusedQualityPenaltyMillionths: distribution(
        fusedMetrics.map(({ qualityPenaltyMillionths }) => qualityPenaltyMillionths),
      ),
      fusedRotationErrorMicrodegrees: distribution(
        fusedMetrics.flatMap(({ rotationErrorMicrodegrees }) =>
          rotationErrorMicrodegrees.p90 === null ? [] : [rotationErrorMicrodegrees.p90],
        ),
      ),
      fusedScaleErrorPartsPerMillion: distribution(
        fusedMetrics.flatMap(({ scaleErrorPartsPerMillion }) =>
          scaleErrorPartsPerMillion.p90 === null ? [] : [scaleErrorPartsPerMillion.p90],
        ),
      ),
      fusedTranslationErrorMillimetres: distribution(
        fusedMetrics.flatMap(({ translationErrorMillimetres }) =>
          translationErrorMillimetres.p90 === null ? [] : [translationErrorMillimetres.p90],
        ),
      ),
    },
    promotion: {
      eligible: false,
      reasons: [
        "independent-reference-is-not-producer-live-evidence",
        "human-correction-time-not-measured",
        "representative-home-accuracy-not-established",
      ],
    },
    representativeAccuracyClaim: false,
    severeErrors: Object.freeze(severeErrors),
  } satisfies FusionEvaluationReport;
  return Object.freeze(report);
}

function compareCase(
  fixture: FusionAcceptanceFixture,
  observation: FusionCaseObservation,
): FusionCaseComparison {
  const baselineRows = observation.singleSourceObservations.map(({ candidate, sourceId }) => ({
    metrics: isProposal(candidate) ? measureCandidate(fixture.truth, candidate) : null,
    sourceId,
    status: candidate.status,
  }));
  const successfulBaselines = baselineRows.filter(
    (row): row is typeof row & { readonly metrics: CandidateMetricVector } => row.metrics !== null,
  );
  const best = [...successfulBaselines].sort(
    (left, right) =>
      left.metrics.qualityPenaltyMillionths - right.metrics.qualityPenaltyMillionths ||
      left.sourceId.localeCompare(right.sourceId),
  )[0];
  const fusionCandidate = observation.fusionCandidate;
  const fusedMetrics = isProposal(fusionCandidate)
    ? measureCandidate(fixture.truth, fusionCandidate)
    : null;

  if (fixture.expected.disposition === "honest-abstention") {
    const passed =
      fusionCandidate.status === "abstained" &&
      fixture.expected.allowedAbstentionCodes.includes(fusionCandidate.safeCode);
    return Object.freeze({
      bestSingleSourceId: best?.sourceId ?? null,
      bestSingleSourceMetrics: best?.metrics ?? null,
      fixtureId: fixture.id,
      fusedMetrics,
      fusionStatus: fusionCandidate.status,
      improvementMillionths: null,
      passed,
      reason: passed ? "honest-abstention" : "unexpected-proposal",
      singleSourceMetrics: Object.freeze(baselineRows),
    });
  }

  if (fusedMetrics === null) {
    return Object.freeze({
      bestSingleSourceId: best?.sourceId ?? null,
      bestSingleSourceMetrics: best?.metrics ?? null,
      fixtureId: fixture.id,
      fusedMetrics: null,
      fusionStatus: fusionCandidate.status,
      improvementMillionths: null,
      passed: false,
      reason: "unexpected-abstention",
      singleSourceMetrics: Object.freeze(baselineRows),
    });
  }
  if (fusedMetrics.severeErrorCodes.length > 0) {
    return result("severe-error", false, null);
  }
  if (best === undefined) {
    return result("no-eligible-successful-baseline", false, null);
  }
  const improvementMillionths = improvement(
    best.metrics.qualityPenaltyMillionths,
    fusedMetrics.qualityPenaltyMillionths,
  );
  const passed =
    improvementMillionths >= meaningfulImprovementMinimumMillionths &&
    doesNotRegressPrimaryMetrics(fusedMetrics, best.metrics);
  return result(
    passed ? "meaningful-improvement" : "improvement-below-threshold",
    passed,
    improvementMillionths,
  );

  function result(
    reason: FusionCaseComparison["reason"],
    passed: boolean,
    improvementMillionths: number | null,
  ): FusionCaseComparison {
    return Object.freeze({
      bestSingleSourceId: best?.sourceId ?? null,
      bestSingleSourceMetrics: best?.metrics ?? null,
      fixtureId: fixture.id,
      fusedMetrics,
      fusionStatus: fusionCandidate.status,
      improvementMillionths,
      passed,
      reason,
      singleSourceMetrics: Object.freeze(baselineRows),
    });
  }
}

function measureCandidate(
  truth: FusionExactTruth,
  candidate: FusionProposedCandidate,
): CandidateMetricVector {
  const translationErrors: number[] = [];
  const rotationErrors: number[] = [];
  const scaleErrors: number[] = [];
  const severeErrors = new Set<string>();
  for (const sourceId of candidate.sourceIds) {
    const expected = truth.sourceTransforms[sourceId];
    const actual = candidate.geometry.transforms[sourceId];
    if (expected === undefined || actual === undefined) {
      severeErrors.add("SOURCE_TRANSFORM_MISSING");
      continue;
    }
    const translationError = translationDistance(actual, expected);
    const rotationError = rotationDistance(actual, expected);
    const scaleError = Math.abs(actual.scalePartsPerMillion - expected.scalePartsPerMillion);
    translationErrors.push(translationError);
    rotationErrors.push(rotationError);
    scaleErrors.push(scaleError);
    if (translationError > 1_000) severeErrors.add("SEVERE_TRANSLATION_ERROR");
    if (rotationError > 10_000_000) severeErrors.add("SEVERE_ROTATION_ERROR");
    if (scaleError > 100_000) severeErrors.add("SEVERE_SCALE_ERROR");
  }

  const actualRooms = new Map(candidate.geometry.roomDimensions.map((room) => [room.roomId, room]));
  const dimensionErrors: number[] = [];
  let missingDimensionCount = 0;
  for (const expected of truth.roomDimensions) {
    const actual = actualRooms.get(expected.roomId);
    if (actual === undefined) {
      missingDimensionCount += 3;
      continue;
    }
    for (const error of [
      Math.abs(actual.widthMillimetres - expected.widthMillimetres),
      Math.abs(actual.lengthMillimetres - expected.lengthMillimetres),
      Math.abs(actual.heightMillimetres - expected.heightMillimetres),
    ]) {
      dimensionErrors.push(error);
      if (error > 500) severeErrors.add("SEVERE_DIMENSION_ERROR");
    }
  }
  for (const roomId of actualRooms.keys()) {
    if (!truth.roomDimensions.some((room) => room.roomId === roomId)) {
      severeErrors.add("UNSUPPORTED_ROOM_GEOMETRY");
    }
  }

  const actualEdges = new Set(candidate.geometry.topologyEdges);
  const expectedEdges = new Set(truth.topologyEdges);
  const topologyErrorCount = symmetricDifferenceCount(actualEdges, expectedEdges);
  if ([...actualEdges].some((edge) => !expectedEdges.has(edge))) {
    severeErrors.add("UNSUPPORTED_TOPOLOGY");
  }
  const covered = new Set(candidate.geometry.coveredRegionIds);
  const supported = new Set(truth.supportedRegionIds);
  const requiredUnknown = new Set(truth.requiredUnknownRegionIds);
  const coveredSupportedCount = [...covered].filter((regionId) => supported.has(regionId)).length;
  const coverageMillionths = rate(coveredSupportedCount, supported.size);
  if ([...covered].some((regionId) => requiredUnknown.has(regionId))) {
    severeErrors.add("OCCLUDED_GEOMETRY_FABRICATED");
  }
  if ([...covered].some((regionId) => !supported.has(regionId) && !requiredUnknown.has(regionId))) {
    severeErrors.add("UNSUPPORTED_REGION");
  }
  const actualUnknown = new Set(candidate.geometry.unknownRegionIds);
  if ([...requiredUnknown].some((regionId) => !actualUnknown.has(regionId))) {
    severeErrors.add("UNKNOWN_REGION_HIDDEN");
  }
  if (candidate.geometry.levelCount !== truth.levelCount) severeErrors.add("WRONG_LEVEL_COUNT");
  if (candidate.geometry.connectedComponentCount !== truth.expectedConnectedComponentCount) {
    severeErrors.add(
      candidate.geometry.connectedComponentCount < truth.expectedConnectedComponentCount
        ? "DISCONNECTED_COMPONENT_HIDDEN"
        : "COMPONENT_COUNT_MISMATCH",
    );
  }
  const discrepancies = new Set(candidate.geometry.surfacedDiscrepancyKinds);
  if (truth.expectedDiscrepancyKinds.some((kind) => !discrepancies.has(kind))) {
    severeErrors.add("EXPECTED_DISCREPANCY_HIDDEN");
  }

  const translation = distribution(translationErrors);
  const rotation = distribution(rotationErrors);
  const scale = distribution(scaleErrors);
  const dimensions = distribution(dimensionErrors);
  const qualityPenaltyMillionths = qualityPenalty({
    coverageMillionths,
    dimensionP90: dimensions.p90,
    missingDimensionCount,
    rotationP90: rotation.p90,
    scaleP90: scale.p90,
    topologyErrorCount,
    topologyTruthCount: truth.topologyEdges.length,
    translationP90: translation.p90,
  });
  return Object.freeze({
    calibrationEceMillionths: expectedCalibrationErrorMillionths(
      candidate.geometry.confidenceSamples,
    ),
    coverageMillionths,
    dimensionErrorMillimetres: dimensions,
    missingDimensionCount,
    qualityPenaltyMillionths,
    rotationErrorMicrodegrees: rotation,
    scaleErrorPartsPerMillion: scale,
    severeErrorCodes: Object.freeze([...severeErrors].sort()),
    topologyErrorCount,
    translationErrorMillimetres: translation,
  });
}

function qualityPenalty(input: {
  readonly coverageMillionths: number;
  readonly dimensionP90: number | null;
  readonly missingDimensionCount: number;
  readonly rotationP90: number | null;
  readonly scaleP90: number | null;
  readonly topologyErrorCount: number;
  readonly topologyTruthCount: number;
  readonly translationP90: number | null;
}): number {
  const components = [
    normalizedError(input.translationP90, 250),
    normalizedError(input.rotationP90, 5_000_000),
    normalizedError(input.scaleP90, 25_000),
    normalizedError(input.dimensionP90, 250),
    rate(input.topologyErrorCount, Math.max(1, input.topologyTruthCount)),
    1_000_000 - input.coverageMillionths,
    rate(input.missingDimensionCount, 12),
  ];
  return Math.round(components.reduce((sum, value) => sum + value, 0) / components.length);
}

function normalizedError(value: number | null, threshold: number): number {
  return value === null ? 4_000_000 : Math.min(4_000_000, rate(value, threshold));
}

function doesNotRegressPrimaryMetrics(
  fusion: CandidateMetricVector,
  baseline: CandidateMetricVector,
): boolean {
  return (
    noLarger(fusion.translationErrorMillimetres.p90, baseline.translationErrorMillimetres.p90) &&
    noLarger(fusion.rotationErrorMicrodegrees.p90, baseline.rotationErrorMicrodegrees.p90) &&
    noLarger(fusion.scaleErrorPartsPerMillion.p90, baseline.scaleErrorPartsPerMillion.p90) &&
    noLarger(fusion.dimensionErrorMillimetres.p90, baseline.dimensionErrorMillimetres.p90) &&
    fusion.topologyErrorCount <= baseline.topologyErrorCount &&
    fusion.coverageMillionths >= baseline.coverageMillionths &&
    fusion.missingDimensionCount <= baseline.missingDimensionCount
  );
}

function noLarger(actual: number | null, baseline: number | null): boolean {
  if (actual === null) return false;
  return baseline === null || actual <= baseline;
}

function improvement(baseline: number, fusion: number): number {
  if (baseline === 0) return fusion === 0 ? 0 : -1_000_000;
  return Math.round(((baseline - fusion) * 1_000_000) / baseline);
}

function expectedCalibrationErrorMillionths(
  samples: readonly FusionConfidenceSample[],
): number | null {
  if (samples.length === 0) return null;
  let weightedError = 0;
  for (let minimum = 0; minimum < 1_000_000; minimum += 100_000) {
    const maximum = minimum + 100_000;
    const selected = samples.filter(
      ({ confidenceMillionths }) =>
        confidenceMillionths >= minimum && confidenceMillionths < maximum,
    );
    if (selected.length === 0) continue;
    const meanConfidence = Math.round(
      selected.reduce((sum, { confidenceMillionths }) => sum + confidenceMillionths, 0) /
        selected.length,
    );
    const accuracy = rate(selected.filter(({ correct }) => correct).length, selected.length);
    weightedError += Math.round(
      (selected.length * Math.abs(accuracy - meanConfidence)) / samples.length,
    );
  }
  return weightedError;
}

function translationDistance(actual: FusionTransform, expected: FusionTransform): number {
  return Math.round(
    Math.hypot(
      actual.translationMillimetres.x - expected.translationMillimetres.x,
      actual.translationMillimetres.y - expected.translationMillimetres.y,
      actual.translationMillimetres.z - expected.translationMillimetres.z,
    ),
  );
}

function rotationDistance(actual: FusionTransform, expected: FusionTransform): number {
  return Math.round(
    Math.hypot(
      angularDifference(actual.rotationMicrodegrees.x, expected.rotationMicrodegrees.x),
      angularDifference(actual.rotationMicrodegrees.y, expected.rotationMicrodegrees.y),
      angularDifference(actual.rotationMicrodegrees.z, expected.rotationMicrodegrees.z),
    ),
  );
}

function angularDifference(actual: number, expected: number): number {
  const fullTurn = 360_000_000;
  const direct = Math.abs(actual - expected) % fullTurn;
  return Math.min(direct, fullTurn - direct);
}

function symmetricDifferenceCount(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  return (
    [...left].filter((value) => !right.has(value)).length +
    [...right].filter((value) => !left.has(value)).length
  );
}

function distribution(values: readonly number[]): DistributionSummary {
  if (values.length === 0) {
    return { count: 0, maximum: null, median: null, p90: null, p95: null };
  }
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    maximum: sorted.at(-1) ?? null,
    median: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
  };
}

function percentile(sorted: readonly number[], quantile: number): number {
  const value = sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
  if (value === undefined) throw new Error("C9_PERCENTILE_WITHOUT_SAMPLE");
  return value;
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator * 1_000_000) / denominator);
}

function summarizeStatuses(candidates: readonly FusionCandidate[]): CandidateStatusSummary {
  return {
    abstained: candidates.filter(({ status }) => status === "abstained").length,
    failed: candidates.filter(({ status }) => status === "failed").length,
    full: candidates.filter(({ status }) => status === "full").length,
    partial: candidates.filter(({ status }) => status === "partial").length,
    total: candidates.length,
  };
}

function isProposal(candidate: FusionCandidate): candidate is FusionProposedCandidate {
  return candidate.status === "full" || candidate.status === "partial";
}

function equalityGate(actual: number, target: number): GateResult {
  return { actual, comparator: "=", status: actual === target ? "passed" : "failed", target };
}

function maximumGate(actual: number, target: number): GateResult {
  return { actual, comparator: "<=", status: actual <= target ? "passed" : "failed", target };
}

function assertAdapter(adapter: FusionEvaluationAdapterManifest): void {
  if (
    adapter.adapterId.trim().length === 0 ||
    adapter.adapterVersion.trim().length === 0 ||
    !sha256.test(adapter.manifestSha256)
  ) {
    throw new Error("C9_ADAPTER_MANIFEST_INVALID");
  }
}

function assertDataset(fixtures: readonly FusionAcceptanceFixture[]): void {
  if (fixtures.length === 0) throw new Error("C9_DATASET_EMPTY");
  const ids = new Set<string>();
  for (const fixture of fixtures) {
    if (ids.has(fixture.id)) throw new Error(`C9_DUPLICATE_FIXTURE:${fixture.id}`);
    ids.add(fixture.id);
    assertFixture(fixture);
  }
  if (!fixtures.some(({ expected }) => expected.disposition === "honest-abstention")) {
    throw new Error("C9_DATASET_ABSTENTION_DENOMINATOR_EMPTY");
  }
  if (!fixtures.some(({ expected }) => expected.disposition === "meaningful-improvement")) {
    throw new Error("C9_DATASET_IMPROVEMENT_DENOMINATOR_EMPTY");
  }
}

function assertFixture(fixture: FusionAcceptanceFixture): void {
  const visiblySynthetic: unknown = fixture.visiblySynthetic;
  const rightsSynthetic: unknown = fixture.rights.synthetic;
  const serviceProcessingConsent: unknown = fixture.rights.serviceProcessingConsent;
  const trainingUseConsent: unknown = fixture.rights.trainingUseConsent;
  const profile: unknown = fixture.scope.profile;
  if (
    visiblySynthetic !== true ||
    rightsSynthetic !== true ||
    serviceProcessingConsent !== true ||
    trainingUseConsent !== "denied" ||
    profile !== "existing"
  ) {
    throw new Error(`C9_FIXTURE_RIGHTS_OR_SCOPE_INVALID:${fixture.id}`);
  }
  const { manifestSha256, ...manifest } = fixture;
  if (!sha256.test(manifestSha256) || deterministicSha256(manifest) !== manifestSha256) {
    throw new Error(`C9_FIXTURE_HASH_INVALID:${fixture.id}`);
  }
  const sourceIds = fixture.sources.map(({ id }) => id);
  const referenceKeys = fixture.sources.map(({ kind, referenceId }) => `${kind}:${referenceId}`);
  if (new Set(sourceIds).size !== sourceIds.length) {
    throw new Error(`C9_FIXTURE_SOURCE_ID_DUPLICATE:${fixture.id}`);
  }
  if (new Set(referenceKeys).size !== referenceKeys.length) {
    throw new Error(`C9_FIXTURE_SOURCE_REFERENCE_DUPLICATE:${fixture.id}`);
  }
  if (
    fixture.expected.disposition === "meaningful-improvement" &&
    new Set(fixture.sources.map(({ kind }) => kind)).size < 2
  ) {
    throw new Error(`C9_FIXTURE_SOURCE_KINDS_INSUFFICIENT:${fixture.id}`);
  }
  for (const source of fixture.sources) {
    const sourceTrainingUseConsent: unknown = source.rights.trainingUseConsent;
    const sourceServiceProcessingConsent: unknown = source.rights.serviceProcessingConsent;
    if (
      deterministicSha256(source.referencePayload) !== source.referenceSha256 ||
      sourceTrainingUseConsent !== "denied" ||
      sourceServiceProcessingConsent !== true
    ) {
      throw new Error(`C9_FIXTURE_SOURCE_INVALID:${fixture.id}:${source.id}`);
    }
  }
  if (
    Object.keys(fixture.truth.sourceTransforms).sort().join("|") !== [...sourceIds].sort().join("|")
  ) {
    throw new Error(`C9_FIXTURE_TRANSFORM_TRUTH_INCOMPLETE:${fixture.id}`);
  }
  assertSafeIntegers(fixture, fixture.id);
  assertCandidate(fixture, fixture.referenceFusionCandidate, sourceIds);
  for (const source of fixture.sources) {
    const candidate = fixture.singleSourceCandidates[source.id];
    if (candidate === undefined) {
      throw new Error(`C9_FIXTURE_BASELINE_MISSING:${fixture.id}:${source.id}`);
    }
    assertCandidate(fixture, candidate, [source.id]);
  }
}

function assertObservation(
  fixture: FusionAcceptanceFixture,
  observation: FusionCaseObservation,
): void {
  if (observation.fixtureManifestSha256 !== fixture.manifestSha256) {
    throw new Error(`C9_OBSERVATION_FIXTURE_HASH_MISMATCH:${fixture.id}`);
  }
  const eligibleSources = fixture.sources.filter(
    ({ eligibleSingleSourceBaseline }) => eligibleSingleSourceBaseline,
  );
  const expectedIds = eligibleSources.map(({ id }) => id).sort();
  const actualIds = observation.singleSourceObservations.map(({ sourceId }) => sourceId).sort();
  if (expectedIds.join("|") !== actualIds.join("|")) {
    throw new Error(`C9_OBSERVATION_BASELINE_SET_INCOMPLETE:${fixture.id}`);
  }
  for (const baseline of observation.singleSourceObservations) {
    const source = eligibleSources.find(({ id }) => id === baseline.sourceId);
    if (
      source === undefined ||
      source.referenceSha256 !== baseline.sourceReferenceSha256 ||
      baseline.candidate.sourceIds.length !== 1 ||
      baseline.candidate.sourceIds[0] !== source.id
    ) {
      throw new Error(`C9_OBSERVATION_BASELINE_REFERENCE_MISMATCH:${fixture.id}`);
    }
    assertCandidate(fixture, baseline.candidate, [source.id]);
  }
  assertCandidate(
    fixture,
    observation.fusionCandidate,
    fixture.sources.map(({ id }) => id),
  );
}

function assertCandidate(
  fixture: FusionAcceptanceFixture,
  candidate: FusionCandidate,
  expectedSourceIds: readonly string[],
): void {
  if (
    [...candidate.sourceIds].sort().join("|") !== [...expectedSourceIds].sort().join("|") ||
    !Number.isSafeInteger(candidate.processing.cpuMilliseconds) ||
    !Number.isSafeInteger(candidate.processing.latencyMilliseconds) ||
    !Number.isSafeInteger(candidate.processing.peakMemoryBytes) ||
    candidate.processing.cpuMilliseconds < 0 ||
    candidate.processing.latencyMilliseconds < 0 ||
    candidate.processing.latencyMilliseconds > 3_600_000 ||
    candidate.processing.peakMemoryBytes < 0 ||
    candidate.processing.peakMemoryBytes > 8 * 1_024 * 1_024 * 1_024
  ) {
    throw new Error(`C9_CANDIDATE_RESOURCE_OR_SOURCE_INVALID:${fixture.id}`);
  }
  if (!isProposal(candidate)) {
    if (!safeCode.test(candidate.safeCode)) {
      throw new Error(`C9_CANDIDATE_SAFE_CODE_INVALID:${fixture.id}`);
    }
    return;
  }
  const { correction, geometry } = candidate;
  const humanStudy: unknown = correction.humanStudy;
  if (
    humanStudy !== false ||
    !Number.isSafeInteger(correction.automatedActionCount) ||
    correction.automatedActionCount < 0 ||
    !Number.isSafeInteger(correction.reviewStartedMonotonicMilliseconds) ||
    !Number.isSafeInteger(correction.reviewCompletedMonotonicMilliseconds) ||
    correction.reviewCompletedMonotonicMilliseconds <
      correction.reviewStartedMonotonicMilliseconds ||
    !Number.isSafeInteger(geometry.levelCount) ||
    geometry.levelCount < 0 ||
    geometry.levelCount > 100 ||
    !Number.isSafeInteger(geometry.connectedComponentCount) ||
    geometry.connectedComponentCount < 1 ||
    geometry.connectedComponentCount > 32
  ) {
    throw new Error(`C9_CANDIDATE_GEOMETRY_OR_CORRECTION_INVALID:${fixture.id}`);
  }
  assertUnique(
    geometry.roomDimensions.map(({ roomId }) => roomId),
    "ROOM",
    fixture.id,
  );
  assertUnique(geometry.topologyEdges, "TOPOLOGY", fixture.id);
  assertUnique(geometry.coveredRegionIds, "COVERAGE", fixture.id);
  assertUnique(geometry.unknownRegionIds, "UNKNOWN", fixture.id);
  assertUnique(geometry.surfacedDiscrepancyKinds, "DISCREPANCY", fixture.id);
  for (const dimensions of geometry.roomDimensions) {
    if (
      dimensions.widthMillimetres <= 0 ||
      dimensions.lengthMillimetres <= 0 ||
      dimensions.heightMillimetres <= 0 ||
      [
        dimensions.widthMillimetres,
        dimensions.lengthMillimetres,
        dimensions.heightMillimetres,
      ].some((value) => value > 100_000)
    ) {
      throw new Error(`C9_CANDIDATE_DIMENSION_INVALID:${fixture.id}`);
    }
  }
  for (const confidence of geometry.confidenceSamples) {
    if (
      !Number.isSafeInteger(confidence.confidenceMillionths) ||
      confidence.confidenceMillionths < 0 ||
      confidence.confidenceMillionths > 1_000_000
    ) {
      throw new Error(`C9_CANDIDATE_CONFIDENCE_INVALID:${fixture.id}`);
    }
  }
  for (const transform of Object.values(geometry.transforms))
    assertTransform(transform, fixture.id);
}

function assertTransform(transform: FusionTransform, fixtureId: string): void {
  const translations = [
    transform.translationMillimetres.x,
    transform.translationMillimetres.y,
    transform.translationMillimetres.z,
  ];
  const rotations = [
    transform.rotationMicrodegrees.x,
    transform.rotationMicrodegrees.y,
    transform.rotationMicrodegrees.z,
  ];
  if (
    !Number.isSafeInteger(transform.scalePartsPerMillion) ||
    transform.scalePartsPerMillion <= 0 ||
    transform.scalePartsPerMillion > 1_000_000_000 ||
    translations.some((value) => !Number.isSafeInteger(value) || Math.abs(value) > 10_000_000) ||
    rotations.some((value) => !Number.isSafeInteger(value) || Math.abs(value) > 360_000_000)
  ) {
    throw new Error(`C9_CANDIDATE_TRANSFORM_INVALID:${fixtureId}`);
  }
}

function assertUnique(values: readonly string[], kind: string, fixtureId: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`C9_CANDIDATE_${kind}_DUPLICATE:${fixtureId}`);
  }
}

function assertSafeIntegers(value: unknown, fixtureId: string): void {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error(`C9_FIXTURE_NUMBER_INVALID:${fixtureId}`);
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) assertSafeIntegers(child, fixtureId);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) assertSafeIntegers(child, fixtureId);
  }
}
