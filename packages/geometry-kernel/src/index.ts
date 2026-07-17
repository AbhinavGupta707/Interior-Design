export {
  checkedAdd,
  checkedMultiply,
  checkedSubtract,
  orientation2d,
  polylineLengthBoundsMm,
  segmentsIntersect2d,
  signedDoubleArea2d,
} from "./integer.js";
export { validateCanonicalGeometry } from "./validator.js";
export { geometryFindingCodes } from "./types.js";
export {
  analyzeFusionProposalObservations,
  computeFusionCoverage,
  defaultFusionConflictConfig,
  defaultFusionDispositionConfig,
  detectFusionConflicts,
  recommendFusionDisposition,
} from "./fusion/analyze.js";
export { fusionAnalysisVersion } from "./fusion/types.js";
export {
  applyFixedSimilarityTransform,
  composeFixedSimilarityTransforms,
  identityFixedSimilarityTransform,
  invertFixedSimilarityTransform,
  isIdentityFixedSimilarityTransform,
  validateFixedSimilarityTransform,
} from "./registration/fixed-point.js";
export {
  defaultRegistrationGraphConfig,
  solveRegistrationConstraintGraph,
} from "./registration/graph.js";
export {
  defaultRegistrationEstimationConfig,
  estimateFreeSimilarityTransform,
} from "./registration/similarity.js";
export { fixedSimilarityVersion, registrationKernelVersion } from "./registration/types.js";
export type {
  GeometryFinding,
  GeometryFindingCode,
  GeometryLocation,
  IntegerComputation,
  IntegerComputationFailure,
  IntegerComputationFailureCode,
  IntegerComputationSuccess,
  IntegerLengthBoundsMm,
  Orientation2d,
  Point2Mm,
  SegmentIntersectionKind,
} from "./types.js";
export type {
  FusionAbstentionCode,
  FusionAnalysisComputation,
  FusionAnalysisErrorCode,
  FusionAnalysisFailure,
  FusionAnalysisSuccess,
  FusionClaim,
  FusionClaimKind,
  FusionConflict,
  FusionConflictConfig,
  FusionCoverageObservation,
  FusionCoverageRegionResult,
  FusionCoverageState,
  FusionCoverageSummary,
  FusionDisposition,
  FusionDispositionConfig,
  FusionEvidenceState,
  FusionExpectedRegion,
  FusionProposalAnalysis,
  FusionProposalAnalysisInput,
  KnownFusionClaim,
  UnknownFusionClaim,
} from "./fusion/types.js";
export type {
  FixedSimilarityTransform,
  Point3Mm,
  QuaternionE9,
  RegistrationComputation,
  RegistrationCorrespondence,
  RegistrationEdgeReliability,
  RegistrationEstimationConfig,
  RegistrationFailure,
  RegistrationGraphComponent,
  RegistrationGraphComponentStatus,
  RegistrationGraphConfig,
  RegistrationGraphEdge,
  RegistrationGraphEdgeDecision,
  RegistrationGraphEdgeStatus,
  RegistrationGraphFinding,
  RegistrationGraphFindingCode,
  RegistrationGraphLevel,
  RegistrationGraphNode,
  RegistrationGraphPathConstraint,
  RegistrationGraphResult,
  RegistrationGraphSourceResult,
  RegistrationKernelError,
  RegistrationKernelErrorCode,
  RegistrationResidualSummary,
  RegistrationScaleStatus,
  RegistrationSuccess,
  SimilarityRegistrationResult,
} from "./registration/types.js";
