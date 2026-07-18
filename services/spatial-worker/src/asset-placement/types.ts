import type {
  InteriorAssetRef,
  KnownAttribution,
  ModelOperationRequest,
} from "@interior-design/contracts";
import type {
  CreatorOwnedAssetCatalog,
  InteriorAssetSafeCode,
} from "@interior-design/interior-assets";

export const assetPlacementRequestSchemaVersion = "c12-asset-placement-request-v1" as const;
export const assetPlacementManifestSchemaVersion = "c12-asset-placement-manifest-v1" as const;
export const assetPlacementCandidateSchemaVersion = "c12-asset-placement-candidate-v1" as const;
export const deterministicAssetPlacementEngineVersion =
  "c12-deterministic-asset-placement-v1" as const;

export const assetPlacementResourcePolicy = Object.freeze({
  maximumAllowedAssetIdsPerTarget: 32,
  maximumAnchorPointsPerTarget: 16,
  maximumCandidateEvaluations: 10_000,
  maximumCandidatesPerRequest: 512,
  maximumExclusionsPerTarget: 32,
  maximumTargetsPerRequest: 64,
} as const);

export interface BoundsMm {
  readonly maximumXMm: number;
  readonly maximumYMm: number;
  readonly minimumXMm: number;
  readonly minimumYMm: number;
}

export interface Point2Mm {
  readonly xMm: number;
  readonly yMm: number;
}

interface PlacementTargetCore {
  readonly allowedAssetIds?: readonly string[] | undefined;
  readonly replaceElementId?: string | undefined;
  readonly targetId: string;
}

export interface FurnishingPlacementTarget extends PlacementTargetCore {
  readonly anchorPointsMm: readonly Point2Mm[];
  readonly boundsMm: BoundsMm;
  readonly exclusionsMm: readonly BoundsMm[];
  readonly floorZMm: number;
  readonly kind: "furnishing-zone";
  readonly levelId: string;
  readonly maximumHeightMm: number;
  readonly spaceId: string;
}

export interface FinishPlacementTarget extends PlacementTargetCore {
  readonly face: "all" | "bottom" | "inside" | "outside" | "top";
  readonly kind: "finish-face";
  readonly maximumApplicationThicknessMm: number;
  readonly spaceId?: string | undefined;
  readonly targetElementId: string;
}

export interface LightPlacementTarget extends PlacementTargetCore {
  readonly kind: "light-point";
  readonly levelId: string;
  readonly maximumEnvelopeHeightMm: number;
  readonly mountFace: "all" | "bottom" | "inside" | "outside" | "top";
  readonly positionMm: { readonly xMm: number; readonly yMm: number; readonly zMm: number };
  readonly spaceId?: string | undefined;
  readonly targetElementId: string;
}

export type AssetPlacementTarget =
  FinishPlacementTarget | FurnishingPlacementTarget | LightPlacementTarget;

export interface AssetPlacementRequest {
  readonly catalog: CreatorOwnedAssetCatalog;
  readonly jobId: string;
  readonly projectId: string;
  readonly proposalAttribution: KnownAttribution;
  readonly requestedMaximumCandidates: number;
  readonly schemaVersion: typeof assetPlacementRequestSchemaVersion;
  readonly seedSha256: string;
  readonly sourcePins: {
    readonly acceptedBriefContentSha256: string;
    readonly constraintsSha256: string;
    readonly workingSnapshotSha256: string;
  };
  readonly targets: readonly AssetPlacementTarget[];
}

export interface DoubledMillimetreBounds {
  /** All values use two integer coordinate units per millimetre. */
  readonly coordinateScale: "two-integer-units-per-millimetre";
  readonly maximumX2Mm: number;
  readonly maximumY2Mm: number;
  readonly minimumX2Mm: number;
  readonly minimumY2Mm: number;
}

export interface PlacementCandidate {
  readonly asset: InteriorAssetRef;
  readonly candidateSha256: string;
  readonly clearanceBounds2Mm?: DoubledMillimetreBounds;
  readonly elementId: string;
  readonly operation: ModelOperationRequest;
  readonly rotationMilliDegrees?: number;
  readonly schemaVersion: typeof assetPlacementCandidateSchemaVersion;
  readonly spaceId?: string;
  readonly targetElementId?: string;
  readonly targetFace?: "all" | "bottom" | "inside" | "outside" | "top";
  readonly targetId: string;
}

export type AssetPlacementAbstentionCode = "NO_APPLICABLE_ASSETS" | "NO_FEASIBLE_PLACEMENTS";

export type AssetPlacementSafeCode =
  | AssetPlacementAbstentionCode
  | InteriorAssetSafeCode
  | "PLACEMENT_CANCELLED"
  | "PLACEMENT_INPUT_INVALID"
  | "PLACEMENT_INTERNAL_FAILURE"
  | "PLACEMENT_RESOURCE_LIMIT";

export interface AssetPlacementManifest {
  readonly candidateLimit: number;
  readonly candidateSha256s: readonly string[];
  readonly candidatesProduced: number;
  readonly catalogManifestSha256: string;
  readonly engineVersion: typeof deterministicAssetPlacementEngineVersion;
  readonly evaluatedCombinations: number;
  readonly externalNetworkUsed: false;
  readonly manifestSha256: string;
  readonly requestSha256: string;
  readonly schemaVersion: typeof assetPlacementManifestSchemaVersion;
  readonly status: "abstained" | "produced";
  readonly abstentionCode?: AssetPlacementAbstentionCode;
}

export type AssetPlacementProductionResult =
  | {
      readonly candidates: readonly PlacementCandidate[];
      readonly manifest: AssetPlacementManifest;
      readonly status: "produced";
    }
  | {
      readonly manifest: AssetPlacementManifest;
      readonly safeCode: AssetPlacementAbstentionCode;
      readonly status: "abstained";
    }
  | {
      readonly safeCode: "PLACEMENT_CANCELLED";
      readonly status: "cancelled";
    }
  | {
      readonly safeCode: Exclude<
        AssetPlacementSafeCode,
        AssetPlacementAbstentionCode | "PLACEMENT_CANCELLED"
      >;
      readonly status: "failed";
    };

export interface AssetPlacementProducerPort {
  produce(request: unknown, signal: AbortSignal): Promise<AssetPlacementProductionResult>;
}
