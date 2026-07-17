export type EvidenceClass = "live-runtime" | "not-run" | "synthetic-reference";
export type ObservationStatus = "abstained" | "completed" | "failed" | "not-run" | "partial";
export type ScaleStatus = "metric-estimated" | "metric-validated" | "unknown";

export interface ReconstructionDatasetManifest {
  readonly customerData: false;
  readonly datasetId: string;
  readonly licence: string;
  readonly rightsBasis: "licensed" | "public-domain";
  readonly split: "development" | "holdout";
  readonly trainingUseConsent: "denied";
}

export interface ReconstructionObservation {
  readonly caseId: string;
  readonly componentCount: number | null;
  readonly evidenceClass: EvidenceClass;
  readonly geometricErrorMicrometres: readonly number[] | null;
  readonly inputFrameCount: number;
  readonly latencyMilliseconds: number | null;
  readonly peakMemoryBytes: number | null;
  readonly registeredFrameCount: number;
  readonly residualP90Micrometres: number | null;
  readonly safeCode: string | null;
  readonly scaleStatus: ScaleStatus | null;
  readonly severeErrorCodes: readonly string[];
  readonly status: ObservationStatus;
  readonly toolManifestSha256: string | null;
  readonly truthAvailable: boolean;
}

export interface Distribution {
  readonly count: number;
  readonly maximum: number | null;
  readonly p50: number | null;
  readonly p90: number | null;
  readonly p95: number | null;
}

export interface ReconstructionEvaluationReport {
  readonly dataset: ReconstructionDatasetManifest;
  readonly denominators: {
    readonly attempted: number;
    readonly notRun: number;
    readonly total: number;
  };
  readonly evidenceState: "LIVE_RUNTIME" | "MIXED_EVIDENCE" | "NOT_RUN" | "SYNTHETIC_REFERENCE";
  readonly failures: {
    readonly abstained: number;
    readonly disconnected: number;
    readonly failed: number;
    readonly partial: number;
  };
  readonly metrics: {
    readonly alignmentResidualMicrometres: Distribution;
    readonly failureRateMillionths: number | null;
    readonly geometricErrorMicrometres: Distribution;
    readonly latencyMilliseconds: Distribution;
    readonly peakMemoryBytes: Distribution;
    readonly registeredFrameCoverageMillionths: number | null;
    readonly severeErrorRateMillionths: number | null;
  };
  readonly representativeAccuracyClaim: false;
  readonly scaleStatusCounts: Readonly<Record<ScaleStatus, number>>;
  readonly severeErrors: readonly { readonly caseId: string; readonly code: string }[];
}
