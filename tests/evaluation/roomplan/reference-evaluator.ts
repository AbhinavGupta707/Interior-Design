import type {
  ConfidenceSample,
  DistributionSummary,
  EvaluationAdapterManifest,
  GateResult,
  RoomPlanEvaluationFixture,
  RoomPlanEvaluationReport,
  RoomPlanObservation,
} from "./types.js";

export const c7EvaluationThresholds = Object.freeze({
  acceptedCoveragePercent: 90,
  confidenceEce: 0.15,
  hardNegativeAbstentionPercent: 100,
  hashLinkagePercent: 100,
  maximumMemoryMebibytes: 1_024,
  maximumWallMilliseconds: 60_000,
  minimumConfidenceSamples: 50,
  minimumPhysicalHardNegatives: 4,
  minimumPhysicalInBox: 12,
  minimumPhysicalStructures: 4,
  openingCentreP90Millimetres: 100,
  severeWallEndpointMillimetres: 250,
  structureAlignmentP90Millimetres: 150,
  wallEndpointP90Millimetres: 100,
});

export function evaluateRoomPlan(input: {
  readonly adapter: EvaluationAdapterManifest;
  readonly fixtures: readonly RoomPlanEvaluationFixture[];
  readonly observations: readonly RoomPlanObservation[];
}): RoomPlanEvaluationReport {
  assertFixtures(input.fixtures);
  const expectedIds = new Set(input.fixtures.map(({ id }) => id));
  const observations = new Map<string, RoomPlanObservation>();
  let unknown = 0;
  for (const observation of input.observations) {
    if (
      observation.adapterId !== input.adapter.adapterId ||
      observation.adapterVersion !== input.adapter.adapterVersion
    ) {
      throw new Error(`ADAPTER_MANIFEST_MISMATCH:${observation.fixtureId}`);
    }
    if (!expectedIds.has(observation.fixtureId)) {
      unknown += 1;
      continue;
    }
    if (observations.has(observation.fixtureId)) {
      throw new Error(`DUPLICATE_OBSERVATION:${observation.fixtureId}`);
    }
    observations.set(observation.fixtureId, observation);
  }

  const paired = input.fixtures.map((fixture) => ({
    fixture,
    observation: observations.get(fixture.id),
  }));
  const inBox = paired.filter(({ fixture }) => fixture.category === "in-box");
  const hardNegative = paired.filter(({ fixture }) => fixture.category === "hard-negative");
  const physicalInBox = inBox.filter(({ fixture }) => fixture.evidenceClass === "physical-field");
  const physicalHardNegative = hardNegative.filter(
    ({ fixture }) => fixture.evidenceClass === "physical-field",
  );
  const physicalStructure = physicalInBox.filter(({ fixture }) => fixture.structure);

  const accepted = inBox.filter(
    ({ fixture, observation }) =>
      observation?.status === "proposal" && observation.sourceSha256 === fixture.sourceSha256,
  );
  const safelyAbstained = hardNegative.filter(
    ({ fixture, observation }) =>
      observation?.status === "abstained" &&
      (fixture.expectedCode === undefined || fixture.expectedCode === observation.code),
  );
  const linked = paired.filter(({ fixture, observation }) => {
    if (observation === undefined || observation.sourceSha256 !== fixture.sourceSha256)
      return false;
    return (
      observation.status !== "proposal" ||
      observation.proposalPackageManifestSha256 === observation.packageManifestSha256
    );
  });

  const severeErrors: { code: string; fixtureId: string }[] = [];
  for (const { fixture, observation } of paired) {
    if (observation === undefined) {
      severeErrors.push({ code: "MISSING_OBSERVATION", fixtureId: fixture.id });
      continue;
    }
    for (const code of observation.severeErrorCodes)
      severeErrors.push({ code, fixtureId: fixture.id });
    if (observation.sourceSha256 !== fixture.sourceSha256) {
      severeErrors.push({ code: "SOURCE_HASH_MISMATCH", fixtureId: fixture.id });
    }
    if (observation.canonicalMutationCount !== 0) {
      severeErrors.push({ code: "CANONICAL_MUTATION", fixtureId: fixture.id });
    }
    if (
      observation.status === "proposal" &&
      observation.proposalPackageManifestSha256 !== observation.packageManifestSha256
    ) {
      severeErrors.push({ code: "PROPOSAL_PACKAGE_HASH_MISMATCH", fixtureId: fixture.id });
    }
    if (fixture.category === "hard-negative" && observation.status === "proposal") {
      severeErrors.push({ code: "HARD_NEGATIVE_FALSE_ACCEPTANCE", fixtureId: fixture.id });
    }
    if (
      observation.status === "proposal" &&
      observation.physicalGeometry?.wallEndpointErrorsMillimetres.some(
        (error) => error > c7EvaluationThresholds.severeWallEndpointMillimetres,
      )
    ) {
      severeErrors.push({ code: "SEVERE_WALL_ENDPOINT_ERROR", fixtureId: fixture.id });
    }
  }

  const physicalProposals = physicalInBox.flatMap(({ observation }) =>
    observation?.status === "proposal" ? [observation] : [],
  );
  const wallErrors = physicalProposals.flatMap(
    ({ physicalGeometry }) => physicalGeometry?.wallEndpointErrorsMillimetres ?? [],
  );
  const openingErrors = physicalProposals.flatMap(
    ({ physicalGeometry }) => physicalGeometry?.openingCentreErrorsMillimetres ?? [],
  );
  const structureErrors = physicalProposals.flatMap(
    ({ physicalGeometry }) => physicalGeometry?.structureAlignmentResidualsMillimetres ?? [],
  );
  const confidenceSamples = physicalProposals.flatMap(({ confidenceSamples }) => confidenceSamples);
  const confidenceEce = expectedCalibrationError(confidenceSamples);
  const wall = distribution(wallErrors);
  const opening = distribution(openingErrors);
  const structure = distribution(structureErrors);
  const wallTimes = [...observations.values()].map(({ wallMilliseconds }) => wallMilliseconds);
  const memory = [...observations.values()].map(
    ({ peakResidentSetMebibytes }) => peakResidentSetMebibytes,
  );

  const gates = {
    acceptedCoveragePercent: minimumGate(
      percent(accepted.length, inBox.length),
      c7EvaluationThresholds.acceptedCoveragePercent,
    ),
    confidenceEce:
      confidenceEce === null
        ? notEvaluable(
            "insufficient-physical-confidence-samples",
            c7EvaluationThresholds.confidenceEce,
          )
        : maximumGate(confidenceEce, c7EvaluationThresholds.confidenceEce),
    hardNegativeAbstentionPercent: minimumGate(
      percent(safelyAbstained.length, hardNegative.length),
      c7EvaluationThresholds.hardNegativeAbstentionPercent,
    ),
    hashLinkagePercent: minimumGate(
      percent(linked.length, input.fixtures.length),
      c7EvaluationThresholds.hashLinkagePercent,
    ),
    maximumMemoryMebibytes: nullableMaximumGate(
      distribution(memory).maximum,
      c7EvaluationThresholds.maximumMemoryMebibytes,
      "no-resource-observations",
    ),
    maximumWallMilliseconds: nullableMaximumGate(
      distribution(wallTimes).maximum,
      c7EvaluationThresholds.maximumWallMilliseconds,
      "no-resource-observations",
    ),
    openingCentreP90Millimetres: nullableMaximumGate(
      opening.p90,
      c7EvaluationThresholds.openingCentreP90Millimetres,
      "no-physical-opening-observations",
    ),
    physicalHardNegativeMinimum: physicalMinimumGate(
      physicalHardNegative.length,
      c7EvaluationThresholds.minimumPhysicalHardNegatives,
    ),
    physicalInBoxMinimum: physicalMinimumGate(
      physicalInBox.length,
      c7EvaluationThresholds.minimumPhysicalInBox,
    ),
    physicalStructureMinimum: physicalMinimumGate(
      physicalStructure.length,
      c7EvaluationThresholds.minimumPhysicalStructures,
    ),
    severeErrors: equalityGate(severeErrors.length, 0),
    structureAlignmentP90Millimetres: nullableMaximumGate(
      structure.p90,
      c7EvaluationThresholds.structureAlignmentP90Millimetres,
      "no-physical-structure-observations",
    ),
    wallEndpointP90Millimetres: nullableMaximumGate(
      wall.p90,
      c7EvaluationThresholds.wallEndpointP90Millimetres,
      "no-physical-wall-observations",
    ),
  } satisfies RoomPlanEvaluationReport["gates"];

  const reasons: string[] = [];
  if (input.adapter.evidenceKind !== "producer-live")
    reasons.push("reference-adapter-is-not-producer-evidence");
  if (unknown > 0) reasons.push("unknown-observations-present");
  for (const [name, gate] of Object.entries(gates)) {
    if (gate.status !== "passed") reasons.push(`gate-${name}-${gate.status}`);
  }

  return Object.freeze({
    adapter: input.adapter,
    denominators: {
      hardNegative: hardNegative.length,
      inBox: inBox.length,
      physicalHardNegative: physicalHardNegative.length,
      physicalInBox: physicalInBox.length,
      physicalStructure: physicalStructure.length,
      total: input.fixtures.length,
    },
    failures: {
      abstainedInBox: inBox.filter(({ observation }) => observation?.status === "abstained").length,
      failed: paired.filter(({ observation }) => observation?.status === "failed").length,
      missing: paired.filter(({ observation }) => observation === undefined).length,
      unknown,
    },
    gates,
    generatedBy: "c7-independent-roomplan-evaluator-v1",
    physicalGeometry: {
      openingCentreMillimetres: opening,
      structureAlignmentMillimetres: structure,
      wallEndpointMillimetres: wall,
    },
    promotion: { eligible: reasons.length === 0, reasons },
    severeErrors,
  } satisfies RoomPlanEvaluationReport);
}

function assertFixtures(fixtures: readonly RoomPlanEvaluationFixture[]): void {
  if (fixtures.length === 0) throw new Error("EMPTY_EVALUATION_DATASET");
  const ids = new Set<string>();
  for (const fixture of fixtures) {
    if (ids.has(fixture.id)) throw new Error(`DUPLICATE_FIXTURE:${fixture.id}`);
    ids.add(fixture.id);
    if (!/^[a-f0-9]{64}$/u.test(fixture.sourceSha256))
      throw new Error(`INVALID_SOURCE_HASH:${fixture.id}`);
    if (fixture.category === "hard-negative" && fixture.expectedOutcome !== "abstained") {
      throw new Error(`UNSAFE_NEGATIVE_EXPECTATION:${fixture.id}`);
    }
  }
}

function expectedCalibrationError(samples: readonly ConfidenceSample[]): number | null {
  if (samples.length < c7EvaluationThresholds.minimumConfidenceSamples) return null;
  let weightedError = 0;
  for (let lower = 0; lower < 100; lower += 10) {
    const selected = samples.filter(
      ({ confidencePercent }) => confidencePercent >= lower && confidencePercent < lower + 10,
    );
    if (selected.length === 0) continue;
    const meanConfidence =
      selected.reduce((sum, { confidencePercent }) => sum + confidencePercent / 100, 0) /
      selected.length;
    const accuracy = selected.filter(({ correct }) => correct).length / selected.length;
    weightedError += (selected.length / samples.length) * Math.abs(accuracy - meanConfidence);
  }
  return weightedError;
}

function distribution(values: readonly number[]): DistributionSummary {
  if (values.length === 0) return { count: 0, maximum: null, p90: null };
  if (!values.every((value) => Number.isFinite(value) && value >= 0)) {
    throw new Error("INVALID_METRIC_VALUE");
  }
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    maximum: sorted.at(-1) ?? null,
    p90: sorted[Math.max(0, Math.ceil(sorted.length * 0.9) - 1)] ?? null,
  };
}

function percent(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : (numerator / denominator) * 100;
}

function minimumGate(actual: number, target: number): GateResult {
  return { actual, comparator: ">=", status: actual >= target ? "passed" : "failed", target };
}

function physicalMinimumGate(actual: number, target: number): GateResult {
  return actual === 0
    ? notEvaluable("physical-field-not-run", target)
    : minimumGate(actual, target);
}

function maximumGate(actual: number, target: number): GateResult {
  return { actual, comparator: "<=", status: actual <= target ? "passed" : "failed", target };
}

function nullableMaximumGate(actual: number | null, target: number, reason: string): GateResult {
  return actual === null ? notEvaluable(reason, target) : maximumGate(actual, target);
}

function equalityGate(actual: number, target: number): GateResult {
  return { actual, comparator: "=", status: actual === target ? "passed" : "failed", target };
}

function notEvaluable(actual: string, target: number): GateResult {
  return { actual, comparator: "status", status: "not-evaluable", target };
}
