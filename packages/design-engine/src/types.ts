import type {
  CanonicalHomeSnapshot,
  DesignBrief,
  DesignConstraint,
  DesignOption,
  DesignOptionSet,
  InteriorAssetRef,
  ModelOperationRequest,
  OptionOperationBundle,
  OptionSourceModelReference,
  OptionWorkingModelReference,
} from "@interior-design/contracts";

export const designEnginePackageContract = "c12-design-engine-v1" as const;
export const deterministicSearchConfigurationVersion =
  "c12-deterministic-search-config-v1" as const;
export const deterministicLayoutEngineVersion = "c12-deterministic-layout-engine-v1" as const;

export const designEngineResourcePolicy = Object.freeze({
  maximumAssets: 500,
  maximumBriefConstraintFacts: 200,
  maximumCandidateBudget: 10_000,
  maximumCandidateTemplates: 10_000,
  maximumExistingFurnishings: 1_000,
  maximumFinishTargets: 2_000,
  maximumFixedObjects: 1_000,
  maximumKeepOuts: 100,
  maximumLevels: 32,
  maximumPolygonVertices: 128,
  maximumSpaces: 512,
} as const);

export type BoundaryTouchRule = "allow" | "forbid";

export interface BoundaryTouchPolicy {
  /** Whether a furnishing clearance envelope may touch its containing room boundary. */
  readonly room: BoundaryTouchRule;
  /** Whether furnishing/fixed-object envelopes may touch without being treated as a collision. */
  readonly obstacle: BoundaryTouchRule;
  /** Whether a furnishing footprint may touch an explicit keep-out polygon. */
  readonly keepOut: BoundaryTouchRule;
}

export interface KeepOutDeclaration {
  readonly id: string;
  readonly levelId: string;
  readonly polygon: readonly { readonly xMm: number; readonly yMm: number }[];
  readonly sourceElementIds: readonly string[];
}

export type FinishFace = "all" | "bottom" | "inside" | "outside" | "top" | "unspecified";

export interface FinishTargetDeclaration {
  readonly allowedFaces: readonly FinishFace[];
  readonly targetElementId: string;
}

export type BriefConstraintFact =
  | {
      readonly assetElementIds: readonly string[];
      readonly briefEntryId: string;
      readonly clearanceMm: number;
      readonly kind: "minimum-clearance";
      readonly scope: "all-sides" | "circulation-target" | "front-access";
    }
  | {
      readonly assetElementId: string;
      readonly briefEntryId: string;
      readonly kind: "adjacency-objective";
      readonly maximumDistanceMm: number;
      readonly targetElementId: string;
    }
  | {
      readonly briefEntryId: string;
      readonly kind: "retain-element";
      readonly retainedElementId: string;
    };

export interface DeterministicSearchConfiguration {
  readonly boundaryTouch: BoundaryTouchPolicy;
  /** The exact number of sorted templates examined; search never terminates by time. */
  readonly candidateBudget: number;
  readonly schemaVersion: typeof deterministicSearchConfigurationVersion;
}

export interface CandidateAssetPlacementInput {
  /** Stable semantic slot, deliberately independent of generated element/operation UUIDs. */
  readonly assignmentKey: string;
  readonly assetVersionId: string;
  readonly elementId: string;
  readonly spaceId?: string;
}

export interface DesignCandidateTemplate {
  readonly assetPlacements: readonly CandidateAssetPlacementInput[];
  readonly direction: DesignOption["direction"];
  readonly objectives: DesignOption["objectives"];
  readonly operations: readonly ModelOperationRequest[];
  readonly templateId: string;
}

export interface DeterministicDesignEngineRequest {
  readonly acceptedBrief: DesignBrief;
  readonly acceptedBriefContentSha256: string;
  /** Frozen external manifest pin retained in every deterministic seed/declaration. */
  readonly assetManifestSha256: string;
  readonly assets: readonly InteriorAssetRef[];
  readonly briefConstraintFacts: readonly BriefConstraintFact[];
  readonly candidateTemplates: readonly DesignCandidateTemplate[];
  readonly configuration: DeterministicSearchConfiguration;
  readonly finishTargets: readonly FinishTargetDeclaration[];
  readonly keepOuts: readonly KeepOutDeclaration[];
  readonly requestedDirections: readonly DesignOption["direction"][];
  readonly requestedOptionCount: number;
  readonly sourceModel: OptionSourceModelReference;
  readonly sourceSnapshot: CanonicalHomeSnapshot;
  readonly workingModel: OptionWorkingModelReference;
  readonly workingSnapshot: CanonicalHomeSnapshot;
}

export const designEngineAbstentionCodes = Object.freeze([
  "CONTRADICTORY_REQUIREMENT",
  "INSUFFICIENT_GEOMETRY",
  "INVALID_INPUT",
  "MALFORMED_GEOMETRY",
  "NO_FEASIBLE_CANDIDATE",
  "NO_FEASIBLE_DIVERSE_SET",
  "NUMERIC_RANGE_EXCEEDED",
  "OPERATION_REPLAY_FAILED",
  "RESOURCE_LIMIT",
  "SOURCE_PIN_MISMATCH",
  "UNSUPPORTED_HARD_REQUIREMENT",
] as const);
export type DesignEngineAbstentionCode = (typeof designEngineAbstentionCodes)[number];

export interface DesignEngineAbstention {
  readonly code: DesignEngineAbstentionCode;
  /** Privacy-minimised fixed text: never contains brief prose or asset payloads. */
  readonly detail: string;
  readonly professionalReviewReasons: readonly (
    | "accessibility-clinical"
    | "cost-certainty"
    | "insufficient-evidence"
    | "professional-judgement"
    | "product-availability"
    | "regulatory"
    | "structural"
  )[];
  readonly stage: "derive" | "parse" | "search" | "validate";
}

export interface CandidateRejectionSummary {
  readonly code:
    | "ASSET_BINDING_INVALID"
    | "COLLISION"
    | "CONTAINMENT"
    | "FINISH_TARGET_INVALID"
    | "HARD_CONSTRAINT_FAILED"
    | "KEEP_OUT"
    | "OPERATION_INVALID"
    | "RETAINED_ELEMENT_CHANGED"
    | "VERTICAL_FIT";
  readonly count: number;
}

export interface DesignCandidateDeclaration {
  readonly candidateDeclarationSha256: string;
  readonly candidateId: string;
  readonly candidateSnapshot: CanonicalHomeSnapshot;
  readonly direction: DesignOption["direction"];
  readonly objectiveVectorSha256: string;
  readonly objectives: DesignOption["objectives"];
  readonly operationBundle: OptionOperationBundle;
  readonly operationSignatureSha256: string;
  readonly paretoNonDominated: true;
  readonly semanticSha256: string;
  readonly templateId: string;
}

export type PairwiseDiversityDeclaration = DesignOptionSet["pairwiseDiversity"][number];

export interface DeterministicDesignEngineSuccess {
  readonly assetSetSha256: string;
  readonly candidates: readonly DesignCandidateDeclaration[];
  readonly constraints: readonly DesignConstraint[];
  readonly constraintsSha256: string;
  readonly declarationSha256: string;
  readonly evaluatedCandidateCount: number;
  readonly ok: true;
  readonly pairwiseDiversity: readonly PairwiseDiversityDeclaration[];
  readonly providerManifest: {
    readonly adapter: "deterministic-local-design-v1";
    readonly candidateBudget: number;
    readonly engineVersion: typeof deterministicLayoutEngineVersion;
    readonly externalNetworkUsed: false;
    readonly seed: number;
  };
  readonly rejectionSummary: readonly CandidateRejectionSummary[];
  readonly searchTruncated: boolean;
}

export interface DeterministicDesignEngineFailure {
  readonly abstention: DesignEngineAbstention;
  readonly ok: false;
}

export type DeterministicDesignEngineResult =
  DeterministicDesignEngineFailure | DeterministicDesignEngineSuccess;

export interface DerivedConstraintSet {
  readonly constraints: readonly DesignConstraint[];
  readonly constraintsSha256: string;
}

export interface ParsedDesignEngineRequest extends Omit<
  DeterministicDesignEngineRequest,
  "candidateTemplates"
> {
  readonly candidateTemplates: readonly DesignCandidateTemplate[];
}

export interface CandidateEvaluationArtifacts {
  readonly assignmentTokens: readonly string[];
  readonly assetInventoryTokens: readonly string[];
  readonly candidate: DesignCandidateDeclaration;
  readonly materialTokens: readonly string[];
  readonly operationSignatures: readonly string[];
  readonly placementsByAssignment: ReadonlyMap<
    string,
    { readonly rotationMilliDegrees: number; readonly xMm: number; readonly yMm: number }
  >;
}
