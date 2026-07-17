export type EvidenceClass = "physical-field" | "synthetic-conformance";
export type FixtureCategory = "hard-negative" | "in-box";

export interface RoomPlanEvaluationFixture {
  readonly category: FixtureCategory;
  readonly evidenceClass: EvidenceClass;
  readonly expectedCode?: string;
  readonly expectedOutcome: "abstained" | "proposal";
  readonly id: string;
  readonly sourceSha256: string;
  readonly structure: boolean;
}

export interface ConfidenceSample {
  readonly confidencePercent: number;
  readonly correct: boolean;
}

export interface PhysicalGeometryObservation {
  readonly openingCentreErrorsMillimetres: readonly number[];
  readonly structureAlignmentResidualsMillimetres: readonly number[];
  readonly wallEndpointErrorsMillimetres: readonly number[];
}

interface ObservationCore {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly canonicalMutationCount: number;
  readonly fixtureId: string;
  readonly packageManifestSha256: string;
  readonly peakResidentSetMebibytes: number;
  readonly severeErrorCodes: readonly string[];
  readonly sourceSha256: string;
  readonly wallMilliseconds: number;
}

export interface ProposalObservation extends ObservationCore {
  readonly confidenceSamples: readonly ConfidenceSample[];
  readonly physicalGeometry?: PhysicalGeometryObservation;
  readonly proposalPackageManifestSha256: string;
  readonly status: "proposal";
}

export interface AbstentionObservation extends ObservationCore {
  readonly code: string;
  readonly status: "abstained";
}

export interface FailedObservation extends ObservationCore {
  readonly safeCode: string;
  readonly status: "failed";
}

export type RoomPlanObservation = AbstentionObservation | FailedObservation | ProposalObservation;

export interface EvaluationAdapterManifest {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly evidenceKind: "independent-reference" | "producer-live";
  readonly manifestSha256: string;
}

export type GateStatus = "failed" | "not-evaluable" | "passed";

export interface GateResult {
  readonly actual: number | string;
  readonly comparator: "<=" | "=" | ">=" | "status";
  readonly status: GateStatus;
  readonly target: number | string;
}

export interface DistributionSummary {
  readonly count: number;
  readonly maximum: number | null;
  readonly p90: number | null;
}

export interface RoomPlanEvaluationReport {
  readonly adapter: EvaluationAdapterManifest;
  readonly denominators: {
    readonly hardNegative: number;
    readonly inBox: number;
    readonly physicalHardNegative: number;
    readonly physicalInBox: number;
    readonly physicalStructure: number;
    readonly total: number;
  };
  readonly failures: {
    readonly abstainedInBox: number;
    readonly failed: number;
    readonly missing: number;
    readonly unknown: number;
  };
  readonly gates: {
    readonly acceptedCoveragePercent: GateResult;
    readonly confidenceEce: GateResult;
    readonly hardNegativeAbstentionPercent: GateResult;
    readonly hashLinkagePercent: GateResult;
    readonly maximumMemoryMebibytes: GateResult;
    readonly maximumWallMilliseconds: GateResult;
    readonly openingCentreP90Millimetres: GateResult;
    readonly physicalHardNegativeMinimum: GateResult;
    readonly physicalInBoxMinimum: GateResult;
    readonly physicalStructureMinimum: GateResult;
    readonly severeErrors: GateResult;
    readonly structureAlignmentP90Millimetres: GateResult;
    readonly wallEndpointP90Millimetres: GateResult;
  };
  readonly generatedBy: "c7-independent-roomplan-evaluator-v1";
  readonly physicalGeometry: {
    readonly openingCentreMillimetres: DistributionSummary;
    readonly structureAlignmentMillimetres: DistributionSummary;
    readonly wallEndpointMillimetres: DistributionSummary;
  };
  readonly promotion: {
    readonly eligible: boolean;
    readonly reasons: readonly string[];
  };
  readonly severeErrors: readonly { readonly code: string; readonly fixtureId: string }[];
}
