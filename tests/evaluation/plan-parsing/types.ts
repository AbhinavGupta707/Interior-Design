import type { PlanFixture } from "../../../packages/test-fixtures/src/plans/types.js";

export interface AdapterManifest {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly evidenceKind: "independent-reference" | "producer-live";
  readonly manifestSha256: string;
}

export interface ConfidenceSample {
  readonly confidence: number;
  readonly correct: boolean;
  readonly kind: "level" | "opening" | "space" | "wall";
}

export interface GeometryObservation {
  readonly calibrationResidualsMillimetres: readonly number[];
  readonly hiddenOmittedRegionCount: number;
  readonly invalidRoomCount: number;
  readonly levelCount: number;
  readonly openingCentreErrorsMillimetres: readonly number[];
  readonly unhostedOpeningCount: number;
  readonly wallEndpointErrorsMillimetres: readonly number[];
}

export interface ProcessingObservation {
  readonly cpuMilliseconds: number;
  readonly peakMemoryMebibytes: number;
  readonly wallMilliseconds: number;
}

export interface CorrectionInstrumentation {
  readonly actionCount: number;
  readonly automatedReviewMilliseconds: number;
  readonly humanStudy: false;
}

interface ObservationCore {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly crossScopeViolationCount: number;
  readonly fixtureId: string;
  readonly processing?: ProcessingObservation;
  readonly sourceSha256: string;
}

export interface ProposalObservation extends ObservationCore {
  readonly confidenceSamples: readonly ConfidenceSample[];
  readonly correction?: CorrectionInstrumentation;
  readonly geometry: GeometryObservation;
  readonly status: "proposal";
}

export interface AbstentionObservation extends ObservationCore {
  readonly code: string;
  readonly status: "abstained";
}

export interface FailureObservation extends ObservationCore {
  readonly safeCode: string;
  readonly status: "failed";
}

export type AdapterObservation = AbstentionObservation | FailureObservation | ProposalObservation;

export interface PlanEvaluationAdapter {
  readonly manifest: AdapterManifest;
  evaluate(fixture: PlanFixture): Promise<AdapterObservation>;
}

export interface EvaluationDataset {
  readonly hardNegatives: readonly PlanFixture[];
  readonly inBox: readonly PlanFixture[];
}

export type GateStatus = "failed" | "not-evaluable" | "passed";

export interface GateResult {
  readonly actual: number | string;
  readonly comparator: ">=" | "<=" | "=" | "status";
  readonly status: GateStatus;
  readonly target: number | string;
}

export interface DistributionSummary {
  readonly count: number;
  readonly maximum: number | null;
  readonly median: number | null;
  readonly p90: number | null;
}

export interface RiskCoveragePoint {
  readonly confidenceThreshold: number;
  readonly coverage: number;
  readonly errorCount: number;
  readonly risk: number | null;
  readonly selectedCount: number;
}

export interface ConfidenceBand {
  readonly accuracy: number | null;
  readonly count: number;
  readonly maximumExclusive: number;
  readonly meanConfidence: number | null;
  readonly minimumInclusive: number;
}

export interface PlanEvaluationReport {
  readonly adapter: AdapterManifest;
  readonly correction: {
    readonly automatedActionCount: number;
    readonly automatedSampleCount: number;
    readonly automatedTimingStatus: "instrumentation-only";
    readonly humanCorrectionMinutes: "not-measured";
    readonly humanStudySampleCount: 0;
    readonly targetStatus: "not-measured";
  };
  readonly denominators: {
    readonly hardNegative: number;
    readonly inBox: number;
    readonly total: number;
  };
  readonly errors: {
    readonly calibrationResidualMillimetres: DistributionSummary;
    readonly openingCentreMillimetres: DistributionSummary;
    readonly wallEndpointMillimetres: DistributionSummary;
  };
  readonly failures: {
    readonly abstainedInBox: number;
    readonly failedHardNegative: number;
    readonly failedInBox: number;
    readonly missingObservationCount: number;
    readonly unknownObservationCount: number;
  };
  readonly gates: {
    readonly acceptedInputCoveragePercent: GateResult;
    readonly calibrationEce: GateResult;
    readonly calibrationResidualP90Millimetres: GateResult;
    readonly crossScopeViolations: GateResult;
    readonly hardNegativeAbstentionPercent: GateResult;
    readonly openingCentreP90Millimetres: GateResult;
    readonly processingDeadlineMilliseconds: GateResult;
    readonly severeErrors: GateResult;
    readonly wallEndpointP90Millimetres: GateResult;
  };
  readonly generatedBy: "c6-independent-reference-evaluator-v1";
  readonly generatedFrom: {
    readonly fixtureSha256: readonly string[];
    readonly observationCount: number;
  };
  readonly processing: {
    readonly cpuMilliseconds: DistributionSummary;
    readonly observedPageCount: number;
    readonly peakMemoryMebibytes: DistributionSummary;
    readonly productionScaleClaim: false;
    readonly wallMilliseconds: DistributionSummary;
  };
  readonly promotion: {
    readonly eligible: boolean;
    readonly reasons: readonly string[];
  };
  readonly severeErrors: readonly {
    readonly code: string;
    readonly fixtureId: string;
  }[];
  readonly confidence: {
    readonly bands: readonly ConfidenceBand[];
    readonly ece: number | null;
    readonly minimumSampleCount: 20;
    readonly riskCoverage: readonly RiskCoveragePoint[];
    readonly sampleCount: number;
    readonly status: "insufficient-sample" | "sufficient";
  };
}
