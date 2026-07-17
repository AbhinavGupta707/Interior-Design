import type {
  Distribution,
  ReconstructionDatasetManifest,
  ReconstructionEvaluationReport,
  ReconstructionObservation,
} from "./types.js";

const sha256 = /^[a-f0-9]{64}$/u;
const safeCode = /^[A-Z][A-Z0-9_]{2,79}$/u;

export function evaluateReconstruction(input: {
  readonly dataset: ReconstructionDatasetManifest;
  readonly observations: readonly ReconstructionObservation[];
}): ReconstructionEvaluationReport {
  assertDataset(input.dataset);
  assertObservations(input.observations);

  const attempted = input.observations.filter(({ status }) => status !== "not-run");
  const notRun = input.observations.filter(({ status }) => status === "not-run");
  const severeErrors = attempted.flatMap(({ caseId, severeErrorCodes }) =>
    severeErrorCodes.map((code) => ({ caseId, code })),
  );
  const registeredFrames = attempted.reduce(
    (total, observation) => total + observation.registeredFrameCount,
    0,
  );
  const inputFrames = attempted.reduce(
    (total, observation) => total + observation.inputFrameCount,
    0,
  );
  const failed = attempted.filter(({ status }) => status === "failed").length;
  const abstained = attempted.filter(({ status }) => status === "abstained").length;
  const partial = attempted.filter(({ status }) => status === "partial").length;
  const disconnected = attempted.filter(
    ({ componentCount }) => componentCount !== null && componentCount > 1,
  ).length;
  const evidenceClasses = new Set(input.observations.map(({ evidenceClass }) => evidenceClass));
  const evidenceState =
    attempted.length === 0
      ? "NOT_RUN"
      : evidenceClasses.size > 1
        ? "MIXED_EVIDENCE"
        : evidenceClasses.has("live-runtime")
          ? "LIVE_RUNTIME"
          : "SYNTHETIC_REFERENCE";

  return Object.freeze({
    dataset: input.dataset,
    denominators: {
      attempted: attempted.length,
      notRun: notRun.length,
      total: input.observations.length,
    },
    evidenceState,
    failures: { abstained, disconnected, failed, partial },
    metrics: {
      alignmentResidualMicrometres: distribution(
        attempted.flatMap(({ residualP90Micrometres }) =>
          residualP90Micrometres === null ? [] : [residualP90Micrometres],
        ),
      ),
      failureRateMillionths: rate(failed + abstained, attempted.length),
      geometricErrorMicrometres: distribution(
        attempted.flatMap(({ geometricErrorMicrometres, truthAvailable }) =>
          truthAvailable && geometricErrorMicrometres !== null ? geometricErrorMicrometres : [],
        ),
      ),
      latencyMilliseconds: distribution(
        attempted.flatMap(({ latencyMilliseconds }) =>
          latencyMilliseconds === null ? [] : [latencyMilliseconds],
        ),
      ),
      peakMemoryBytes: distribution(
        attempted.flatMap(({ peakMemoryBytes }) =>
          peakMemoryBytes === null ? [] : [peakMemoryBytes],
        ),
      ),
      registeredFrameCoverageMillionths: rate(registeredFrames, inputFrames),
      severeErrorRateMillionths: rate(severeErrors.length, attempted.length),
    },
    representativeAccuracyClaim: false,
    scaleStatusCounts: {
      "metric-estimated": attempted.filter(({ scaleStatus }) => scaleStatus === "metric-estimated")
        .length,
      "metric-validated": attempted.filter(({ scaleStatus }) => scaleStatus === "metric-validated")
        .length,
      unknown: attempted.filter(({ scaleStatus }) => scaleStatus === "unknown").length,
    },
    severeErrors,
  });
}

function assertDataset(dataset: ReconstructionDatasetManifest): void {
  if (
    dataset.customerData !== false ||
    dataset.trainingUseConsent !== "denied" ||
    !["licensed", "public-domain"].includes(dataset.rightsBasis) ||
    dataset.datasetId.trim().length === 0 ||
    dataset.licence.trim().length === 0
  ) {
    throw new Error("RECONSTRUCTION_DATASET_RIGHTS_INVALID");
  }
}

function assertObservations(observations: readonly ReconstructionObservation[]): void {
  const ids = new Set<string>();
  for (const observation of observations) {
    if (ids.has(observation.caseId)) throw new Error("DUPLICATE_RECONSTRUCTION_CASE");
    ids.add(observation.caseId);
    if (
      observation.caseId.trim().length === 0 ||
      !Number.isSafeInteger(observation.inputFrameCount) ||
      !Number.isSafeInteger(observation.registeredFrameCount) ||
      observation.inputFrameCount < 0 ||
      observation.registeredFrameCount < 0 ||
      observation.registeredFrameCount > observation.inputFrameCount ||
      observation.severeErrorCodes.some((code) => !safeCode.test(code))
    ) {
      throw new Error("RECONSTRUCTION_OBSERVATION_INVALID");
    }
    if (observation.status === "not-run") {
      if (
        observation.evidenceClass !== "not-run" ||
        observation.toolManifestSha256 !== null ||
        observation.latencyMilliseconds !== null ||
        observation.peakMemoryBytes !== null
      ) {
        throw new Error("NOT_RUN_OBSERVATION_HAS_RUNTIME_EVIDENCE");
      }
      continue;
    }
    if (
      observation.evidenceClass === "not-run" ||
      observation.toolManifestSha256 === null ||
      !sha256.test(observation.toolManifestSha256)
    ) {
      throw new Error("ATTEMPTED_OBSERVATION_LACKS_TOOL_MANIFEST");
    }
    if (observation.status === "completed" || observation.status === "partial") {
      if (observation.componentCount === null || observation.scaleStatus === null) {
        throw new Error("RECONSTRUCTION_RESULT_DIAGNOSTICS_MISSING");
      }
    }
    if (
      observation.scaleStatus === "metric-validated" &&
      observation.residualP90Micrometres === null
    ) {
      throw new Error("VALIDATED_SCALE_RESIDUAL_MISSING");
    }
    if (!observation.truthAvailable && observation.geometricErrorMicrometres !== null) {
      throw new Error("GEOMETRIC_ERROR_WITHOUT_TRUTH");
    }
    for (const value of [
      observation.componentCount,
      observation.latencyMilliseconds,
      observation.peakMemoryBytes,
      observation.residualP90Micrometres,
      ...(observation.geometricErrorMicrometres ?? []),
    ]) {
      if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
        throw new Error("RECONSTRUCTION_NUMERIC_OBSERVATION_INVALID");
      }
    }
  }
}

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round((numerator * 1_000_000) / denominator);
}

function distribution(values: readonly number[]): Distribution {
  if (values.length === 0) return { count: 0, maximum: null, p50: null, p90: null, p95: null };
  const sorted = [...values].sort((first, second) => first - second);
  return {
    count: sorted.length,
    maximum: sorted.at(-1) ?? null,
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
  };
}

function percentile(sorted: readonly number[], quantile: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));
  return sorted[index] ?? 0;
}
