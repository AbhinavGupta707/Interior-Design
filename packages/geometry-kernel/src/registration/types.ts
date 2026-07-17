export const registrationKernelVersion = "c9-registration-kernel-v1" as const;
export const fixedSimilarityVersion = "c9-fixed-similarity-v1" as const;

export interface Point3Mm {
  readonly xMm: number;
  readonly yMm: number;
  readonly zMm: number;
}

export interface QuaternionE9 {
  readonly w: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Durable source-to-target transform. Scale is parts per million and rotation is unit E9. */
export interface FixedSimilarityTransform {
  readonly rotationQuaternionE9: QuaternionE9;
  readonly scalePartsPerMillion: number;
  readonly translationMm: Point3Mm;
}

export type RegistrationKernelErrorCode =
  | "COORDINATE_LIMIT_EXCEEDED"
  | "DEGENERATE_CORRESPONDENCES"
  | "DUPLICATE_CORRESPONDENCE_ID"
  | "INSUFFICIENT_CORRESPONDENCES"
  | "INSUFFICIENT_INLIERS"
  | "INVALID_CONFIGURATION"
  | "INVALID_OBSERVATION"
  | "INVALID_FIXED_TRANSFORM"
  | "INVALID_IDENTIFIER"
  | "NON_FINITE_INPUT"
  | "NON_INTEGER_INPUT"
  | "OUTPUT_OVERFLOW"
  | "REFLECTION_REJECTED"
  | "RESOURCE_LIMIT_EXCEEDED"
  | "SCALE_OUT_OF_RANGE";

export interface RegistrationKernelError {
  readonly code: RegistrationKernelErrorCode;
  readonly detail: string;
}

export interface RegistrationFailure {
  readonly error: RegistrationKernelError;
  readonly ok: false;
}

export interface RegistrationSuccess<TValue> {
  readonly ok: true;
  readonly value: TValue;
}

export type RegistrationComputation<TValue> = RegistrationFailure | RegistrationSuccess<TValue>;

export interface RegistrationCorrespondence {
  /** Stable, source-scoped anchor identifier used for canonical ordering. */
  readonly correspondenceId: string;
  readonly confidenceBasisPoints: number;
  readonly sourcePoint: Point3Mm;
  readonly targetPoint: Point3Mm;
}

export interface RegistrationEstimationConfig {
  readonly coordinateLimitMm: number;
  readonly inlierThresholdMm: number;
  readonly maximumCorrespondences: number;
  readonly maximumHypotheses: number;
  readonly maximumScalePartsPerMillion: number;
  readonly minimumInliers: number;
  readonly minimumScalePartsPerMillion: number;
  /** Squared cross-product magnitude after coordinates are normalised to the coordinate limit. */
  readonly minimumTriangleAreaSquared: number;
  readonly reflectionPairAgreementBasisPoints: number;
  readonly seed: number;
  readonly version: typeof registrationKernelVersion;
}

export interface RegistrationResidualSummary {
  readonly inlierCount: number;
  readonly maximumMm: number;
  readonly medianMm: number;
  readonly p90Mm: number;
  readonly sampleCount: number;
}

export interface SimilarityRegistrationResult {
  readonly algorithmVersion: typeof registrationKernelVersion;
  readonly config: RegistrationEstimationConfig;
  readonly inlierCorrespondenceIds: readonly string[];
  readonly outlierCorrespondenceIds: readonly string[];
  readonly residuals: RegistrationResidualSummary;
  readonly seed: number;
  readonly transform: FixedSimilarityTransform;
  readonly transformVersion: typeof fixedSimilarityVersion;
}

export type RegistrationScaleStatus = "metric-estimated" | "metric-validated" | "unknown";

export interface RegistrationGraphLevel {
  readonly elevationMm: number;
  /** Stable semantic level identity shared across sources, not user-entered display text. */
  readonly semanticLevelId: string;
}

export interface RegistrationGraphNode {
  readonly levels: readonly RegistrationGraphLevel[];
  /** When present, this independently validated transform maps the node into project space. */
  readonly projectTransform?: FixedSimilarityTransform;
  readonly scaleStatus: RegistrationScaleStatus;
  readonly sourceId: string;
}

export type RegistrationEdgeReliability = "reliable" | "uncertain";

export interface RegistrationGraphEdge {
  readonly confidenceBasisPoints: number;
  readonly edgeId: string;
  readonly fromSourceId: string;
  readonly reliability: RegistrationEdgeReliability;
  readonly residuals: RegistrationResidualSummary;
  /** Maps coordinates from `fromSourceId` into `toSourceId`. */
  readonly transformFromTo: FixedSimilarityTransform;
  readonly toSourceId: string;
}

export interface RegistrationGraphConfig {
  readonly cycleRotationToleranceMilliDegrees: number;
  readonly cycleScaleTolerancePartsPerMillion: number;
  readonly cycleTranslationToleranceMm: number;
  readonly levelAlignmentToleranceMm: number;
  readonly maximumEdges: number;
  readonly maximumLevelsPerSource: number;
  readonly maximumNodes: number;
  readonly maximumReliableResidualMm: number;
  readonly metricScaleTolerancePartsPerMillion: number;
  readonly minimumUncertainConfidenceBasisPoints: number;
  readonly maximumUncertainResidualMm: number;
  readonly version: typeof registrationKernelVersion;
}

export type RegistrationGraphFindingCode =
  | "ANCHOR_CONFLICT"
  | "CONSTRAINT_CYCLE_CONFLICT"
  | "DISCONNECTED_COMPONENT"
  | "INVALID_GRAPH"
  | "LEVEL_ALIGNMENT_CONFLICT"
  | "RELIABLE_EDGE_RESIDUAL_EXCEEDED"
  | "SCALE_ALIGNMENT_CONFLICT"
  | "UNCERTAIN_EDGE_PRUNED";

export interface RegistrationGraphFinding {
  readonly code: RegistrationGraphFindingCode;
  readonly detail: string;
  readonly edgeIds: readonly string[];
  readonly magnitude?: number;
  readonly severity: "error" | "information" | "warning";
  readonly sourceIds: readonly string[];
}

export type RegistrationGraphEdgeStatus = "conflict" | "pruned" | "redundant" | "selected";

export interface RegistrationGraphEdgeDecision {
  readonly edgeId: string;
  readonly reasonCode?: RegistrationGraphFindingCode;
  readonly status: RegistrationGraphEdgeStatus;
}

export type RegistrationGraphComponentStatus =
  "conflicted" | "partial" | "registered" | "unregistered";

export interface RegistrationGraphComponent {
  readonly anchoredToProject: boolean;
  readonly componentId: string;
  readonly sourceIds: readonly string[];
  readonly status: RegistrationGraphComponentStatus;
}

export interface RegistrationGraphSourceResult {
  readonly componentId: string;
  /** Exact selected constraints from this source to its deterministic component root. */
  readonly constraintPath: readonly RegistrationGraphPathConstraint[];
  readonly sourceId: string;
  readonly status: "partial" | "registered" | "unregistered";
  /** Relative-only transform for a component with no validated project anchor. */
  readonly transformToComponent?: FixedSimilarityTransform;
  /** Present only when the component has at least one validated project anchor. */
  readonly transformToProject?: FixedSimilarityTransform;
}

export interface RegistrationGraphPathConstraint {
  readonly edgeId: string;
  readonly reliability: RegistrationEdgeReliability;
  readonly residuals: RegistrationResidualSummary;
}

export interface RegistrationGraphResult {
  readonly components: readonly RegistrationGraphComponent[];
  readonly config: RegistrationGraphConfig;
  readonly edgeDecisions: readonly RegistrationGraphEdgeDecision[];
  readonly findings: readonly RegistrationGraphFinding[];
  readonly sources: readonly RegistrationGraphSourceResult[];
  readonly version: typeof registrationKernelVersion;
}
