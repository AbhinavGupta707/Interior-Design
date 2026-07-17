import type {
  FusionAcceptanceFixture,
  FusionCandidate,
} from "../../../packages/test-fixtures/src/fusion/types.js";

export interface FusionEvaluationAdapterManifest {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly evidenceClass: "independent-synthetic-reference" | "producer-live";
  readonly manifestSha256: string;
}

export interface SingleSourceObservation {
  readonly candidate: FusionCandidate;
  readonly sourceId: string;
  readonly sourceReferenceSha256: string;
}

export interface FusionCaseObservation {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly fixtureId: string;
  readonly fixtureManifestSha256: string;
  readonly fusionCandidate: FusionCandidate;
  readonly singleSourceObservations: readonly SingleSourceObservation[];
}

export interface FusionEvaluationAdapter {
  readonly manifest: FusionEvaluationAdapterManifest;
  evaluate(fixture: FusionAcceptanceFixture): Promise<FusionCaseObservation>;
}

export interface DistributionSummary {
  readonly count: number;
  readonly maximum: number | null;
  readonly median: number | null;
  readonly p90: number | null;
  readonly p95: number | null;
}

export interface CandidateMetricVector {
  readonly calibrationEceMillionths: number | null;
  readonly coverageMillionths: number;
  readonly dimensionErrorMillimetres: DistributionSummary;
  readonly missingDimensionCount: number;
  readonly qualityPenaltyMillionths: number;
  readonly rotationErrorMicrodegrees: DistributionSummary;
  readonly scaleErrorPartsPerMillion: DistributionSummary;
  readonly severeErrorCodes: readonly string[];
  readonly topologyErrorCount: number;
  readonly translationErrorMillimetres: DistributionSummary;
}

export interface CandidateStatusSummary {
  readonly abstained: number;
  readonly failed: number;
  readonly full: number;
  readonly partial: number;
  readonly total: number;
}

export interface FusionCaseComparison {
  readonly bestSingleSourceId: string | null;
  readonly bestSingleSourceMetrics: CandidateMetricVector | null;
  readonly fixtureId: string;
  readonly fusedMetrics: CandidateMetricVector | null;
  readonly fusionStatus: FusionCandidate["status"];
  readonly improvementMillionths: number | null;
  readonly passed: boolean;
  readonly reason:
    | "honest-abstention"
    | "improvement-below-threshold"
    | "meaningful-improvement"
    | "no-eligible-successful-baseline"
    | "severe-error"
    | "unexpected-abstention"
    | "unexpected-proposal";
  readonly singleSourceMetrics: readonly {
    readonly metrics: CandidateMetricVector | null;
    readonly sourceId: string;
    readonly status: FusionCandidate["status"];
  }[];
}

export interface GateResult {
  readonly actual: number;
  readonly comparator: "<=" | "=" | ">=";
  readonly status: "failed" | "passed";
  readonly target: number;
}

export interface FusionEvaluationReport {
  readonly acceptance: {
    readonly accepted: boolean;
    readonly failedCaseIds: readonly string[];
    readonly meaningfulImprovementMinimumMillionths: 150_000;
    readonly rule: "improve-best-single-source-or-honestly-abstain";
  };
  readonly adapter: FusionEvaluationAdapterManifest;
  readonly calibration: {
    readonly eceMillionths: number | null;
    readonly sampleCount: number;
  };
  readonly comparisons: readonly FusionCaseComparison[];
  readonly correction: {
    readonly automatedActionCount: number;
    readonly automatedReviewMilliseconds: DistributionSummary;
    readonly automatedSampleCount: number;
    readonly humanCorrectionTime: "NOT_MEASURED";
    readonly humanStudySampleCount: 0;
    readonly status: "instrumentation-only";
  };
  readonly denominators: {
    readonly expectedFixtures: number;
    readonly honestAbstentionFixtures: number;
    readonly meaningfulImprovementFixtures: number;
    readonly missingObservations: number;
    readonly observedFixtures: number;
    readonly singleSourceEligible: number;
    readonly unknownObservations: number;
  };
  readonly failures: {
    readonly fusion: CandidateStatusSummary;
    readonly singleSource: CandidateStatusSummary;
  };
  readonly gates: {
    readonly calibrationEceMillionths: GateResult;
    readonly caseAcceptance: GateResult;
    readonly severeErrors: GateResult;
  };
  readonly generatedBy: "c9-independent-fusion-evaluator-v1";
  readonly metrics: {
    readonly bestSingleSourceQualityPenaltyMillionths: DistributionSummary;
    readonly fusedCoverageMillionths: DistributionSummary;
    readonly fusedDimensionErrorMillimetres: DistributionSummary;
    readonly fusedLatencyMilliseconds: DistributionSummary;
    readonly fusedPeakMemoryBytes: DistributionSummary;
    readonly fusedQualityPenaltyMillionths: DistributionSummary;
    readonly fusedRotationErrorMicrodegrees: DistributionSummary;
    readonly fusedScaleErrorPartsPerMillion: DistributionSummary;
    readonly fusedTranslationErrorMillimetres: DistributionSummary;
  };
  readonly promotion: {
    readonly eligible: false;
    readonly reasons: readonly [
      "independent-reference-is-not-producer-live-evidence",
      "human-correction-time-not-measured",
      "representative-home-accuracy-not-established",
    ];
  };
  readonly representativeAccuracyClaim: false;
  readonly severeErrors: readonly {
    readonly code: string;
    readonly fixtureId: string;
  }[];
}
