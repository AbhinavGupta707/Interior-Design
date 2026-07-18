/**
 * Pure C12 deterministic constraint/layout engine.
 *
 * The public surface is deliberately narrow: callers freeze candidate-independent constraints,
 * then provide frozen C11/C12/C5 declarations to `runDeterministicDesignEngine`; both paths return
 * exact declarations or a typed, privacy-minimised abstention. No provider, clock, random source or
 * mutation capability exists.
 */
export { runDeterministicDesignEngine } from "./engine.js";
export { deriveDeterministicDesignConstraints } from "./preflight.js";
export {
  designEngineAbstentionCodes,
  designEnginePackageContract,
  designEngineResourcePolicy,
  deterministicLayoutEngineVersion,
  deterministicSearchConfigurationVersion,
} from "./types.js";
export type {
  BoundaryTouchPolicy,
  BoundaryTouchRule,
  BriefConstraintFact,
  CandidateAssetPlacementInput,
  CandidateRejectionSummary,
  DesignCandidateDeclaration,
  DesignCandidateTemplate,
  DesignEngineAbstention,
  DesignEngineAbstentionCode,
  DeterministicDesignEngineFailure,
  DeterministicDesignConstraintRequest,
  DeterministicDesignConstraintResult,
  DeterministicDesignConstraintSuccess,
  DeterministicDesignConstraintSystemPolicy,
  DeterministicDesignEngineRequest,
  DeterministicDesignEngineResult,
  DeterministicDesignEngineSuccess,
  DeterministicSearchConfiguration,
  FinishFace,
  FinishTargetDeclaration,
  KeepOutDeclaration,
  PairwiseDiversityDeclaration,
} from "./types.js";
