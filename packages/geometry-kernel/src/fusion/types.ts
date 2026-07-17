import type { Point3Mm } from "../registration/types.js";

export const fusionAnalysisVersion = "c9-fusion-analysis-v1" as const;

export type FusionClaimKind = "classification" | "dimension" | "position" | "presence" | "topology";

export type FusionEvidenceState =
  "fused" | "inferred" | "observed" | "source-derived" | "unknown" | "user-asserted";

interface FusionClaimBase {
  readonly claimId: string;
  readonly confidenceBasisPoints?: number;
  readonly kind: FusionClaimKind;
  readonly location?: Point3Mm;
  /** Stable element/attribute identity. This must not contain raw user-entered claim text. */
  readonly semanticKey: string;
  readonly sourceId: string;
}

export interface KnownFusionClaim extends FusionClaimBase {
  readonly numericValueMm?: number;
  readonly state: Exclude<FusionEvidenceState, "unknown">;
  readonly valueSha256: string;
}

export interface UnknownFusionClaim extends FusionClaimBase {
  readonly state: "unknown";
}

export type FusionClaim = KnownFusionClaim | UnknownFusionClaim;

export interface FusionConflictConfig {
  readonly coordinateLimitMm: number;
  readonly dimensionalToleranceMm: number;
  readonly maximumClaims: number;
  readonly maximumClaimsPerSemanticKey: number;
  readonly maximumConflicts: number;
  readonly version: typeof fusionAnalysisVersion;
}

export interface FusionConflict {
  readonly claimIds: readonly string[];
  readonly code:
    | "CLASSIFICATION_CONFLICT"
    | "DIMENSION_CONFLICT"
    | "POSITION_CONFLICT"
    | "PRESENCE_CONFLICT"
    | "TOPOLOGY_CONFLICT";
  readonly kind: FusionClaimKind;
  readonly magnitudeMm?: number;
  readonly requiresHumanDecision: true;
  readonly semanticKey: string;
  readonly severity: "error" | "warning";
  readonly sourceClaims: readonly KnownFusionClaim[];
  readonly sourceIds: readonly string[];
}

export type FusionCoverageState = "inferred" | "supported" | "unknown";

export interface FusionExpectedRegion {
  readonly levelId: string;
  readonly regionId: string;
}

export interface FusionCoverageObservation {
  readonly evidenceSha256?: string;
  readonly levelId: string;
  readonly regionId: string;
  readonly sourceId: string;
  readonly state: FusionCoverageState;
}

export interface FusionCoverageRegionResult {
  readonly levelId: string;
  readonly regionId: string;
  readonly sourceIds: readonly string[];
  readonly state: FusionCoverageState;
}

export interface FusionCoverageSummary {
  readonly inferredRegionCount: number;
  readonly registeredSourceCount: number;
  readonly regions: readonly FusionCoverageRegionResult[];
  readonly supportedCoverageBasisPoints: number;
  readonly supportedRegionCount: number;
  readonly totalRegionCount: number;
  readonly unknownRegionCount: number;
}

export interface FusionDispositionConfig {
  readonly maximumErrorConflictsBeforeAbstention: number;
  readonly minimumPartialCoverageBasisPoints: number;
  readonly version: typeof fusionAnalysisVersion;
}

export type FusionAbstentionCode =
  | "CONFLICT_LIMIT_EXCEEDED"
  | "INSUFFICIENT_COVERAGE"
  | "NO_REGISTERED_SOURCES"
  | "NO_SUPPORTED_REGIONS";

export interface FusionDisposition {
  readonly reasons: readonly FusionAbstentionCode[];
  readonly status: "abstained" | "full-proposal" | "partial-proposal";
  readonly version: typeof fusionAnalysisVersion;
}

export interface FusionProposalAnalysis {
  readonly conflictConfig: FusionConflictConfig;
  readonly conflicts: readonly FusionConflict[];
  readonly coverage: FusionCoverageSummary;
  readonly dispositionConfig: FusionDispositionConfig;
  readonly disposition: FusionDisposition;
  readonly version: typeof fusionAnalysisVersion;
}

export interface FusionProposalAnalysisInput {
  readonly claims: readonly FusionClaim[];
  readonly coverageObservations: readonly FusionCoverageObservation[];
  readonly expectedRegions: readonly FusionExpectedRegion[];
  readonly registeredSourceIds: readonly string[];
  readonly sourceIds: readonly string[];
}

export type FusionAnalysisErrorCode =
  | "DUPLICATE_CLAIM"
  | "DUPLICATE_REGION"
  | "INVALID_CLAIM"
  | "INVALID_CONFIGURATION"
  | "INVALID_COVERAGE"
  | "INVALID_IDENTIFIER"
  | "RESOURCE_LIMIT_EXCEEDED"
  | "UNKNOWN_SOURCE";

export interface FusionAnalysisFailure {
  readonly error: {
    readonly code: FusionAnalysisErrorCode;
    readonly detail: string;
  };
  readonly ok: false;
}

export interface FusionAnalysisSuccess<TValue> {
  readonly ok: true;
  readonly value: TValue;
}

export type FusionAnalysisComputation<TValue> =
  FusionAnalysisFailure | FusionAnalysisSuccess<TValue>;
