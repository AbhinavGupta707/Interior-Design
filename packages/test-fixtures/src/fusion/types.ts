export type FusionFixtureDisposition = "honest-abstention" | "meaningful-improvement";

export type FusionSourceKind =
  | "measurement-set"
  | "plan-proposal"
  | "reconstruction-result"
  | "roomplan-proposal"
  | "user-assertion-set";

export type FusionCandidateStatus = "abstained" | "failed" | "full" | "partial";

export interface FusionFixtureRights {
  readonly allowedPurposes: readonly (
    "local-ci-evaluation" | "security-testing" | "ui-acceptance"
  )[];
  readonly creator: "Interior Design C9 synthetic QA lane";
  readonly licence: "CC0-1.0";
  readonly origin: "generated-in-repository";
  readonly serviceProcessingConsent: true;
  readonly synthetic: true;
  readonly trainingUseConsent: "denied";
}

export interface FusionFixtureScope {
  readonly baseSnapshotId: string;
  readonly baseSnapshotSha256: string;
  readonly modelId: string;
  readonly profile: "existing";
  readonly projectId: string;
  readonly tenantId: string;
}

export interface FusionPointMillimetres {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Synthetic fixtures use exact integer Euler microdegrees for independently checkable truth. */
export interface FusionTransform {
  readonly rotationMicrodegrees: FusionPointMillimetres;
  readonly scalePartsPerMillion: number;
  readonly translationMillimetres: FusionPointMillimetres;
}

export interface FusionRoomDimensions {
  readonly heightMillimetres: number;
  readonly lengthMillimetres: number;
  readonly roomId: string;
  readonly widthMillimetres: number;
}

export interface FusionConfidenceSample {
  readonly confidenceMillionths: number;
  readonly correct: boolean;
  readonly kind: "dimension" | "level" | "registration" | "topology";
}

export interface FusionProcessingObservation {
  readonly cpuMilliseconds: number;
  readonly latencyMilliseconds: number;
  readonly peakMemoryBytes: number;
}

export interface FusionCorrectionInstrumentation {
  readonly automatedActionCount: number;
  readonly reviewCompletedMonotonicMilliseconds: number;
  readonly reviewStartedMonotonicMilliseconds: number;
  readonly humanStudy: false;
}

export interface FusionCandidateGeometry {
  readonly confidenceSamples: readonly FusionConfidenceSample[];
  readonly connectedComponentCount: number;
  readonly coveredRegionIds: readonly string[];
  readonly levelCount: number;
  readonly roomDimensions: readonly FusionRoomDimensions[];
  readonly surfacedDiscrepancyKinds: readonly FusionDiscrepancyKind[];
  readonly topologyEdges: readonly string[];
  readonly transforms: Readonly<Record<string, FusionTransform>>;
  readonly unknownRegionIds: readonly string[];
}

export type FusionDiscrepancyKind =
  | "classification"
  | "dimension"
  | "extra-element"
  | "level-alignment"
  | "missing-element"
  | "position"
  | "scale"
  | "topology"
  | "unknown-region";

interface FusionCandidateCore {
  readonly processing: FusionProcessingObservation;
  readonly sourceIds: readonly string[];
}

export interface FusionProposedCandidate extends FusionCandidateCore {
  readonly correction: FusionCorrectionInstrumentation;
  readonly geometry: FusionCandidateGeometry;
  readonly status: "full" | "partial";
}

export interface FusionAbstainedCandidate extends FusionCandidateCore {
  readonly safeCode: string;
  readonly status: "abstained";
}

export interface FusionFailedCandidate extends FusionCandidateCore {
  readonly safeCode: string;
  readonly status: "failed";
}

export type FusionCandidate =
  FusionAbstainedCandidate | FusionFailedCandidate | FusionProposedCandidate;

export interface FusionSourceManifest {
  readonly coordinateFrame: "project-local" | "source-local-arbitrary" | "source-local-metric";
  readonly eligibleSingleSourceBaseline: boolean;
  readonly evidenceState: "observed" | "source-derived" | "user-asserted";
  readonly id: string;
  readonly kind: FusionSourceKind;
  readonly referenceId: string;
  readonly referencePayload: {
    readonly fixtureId: string;
    readonly sourceSequence: number;
    readonly syntheticLabel: string;
  };
  readonly referenceSha256: string;
  readonly rights: FusionFixtureRights;
  readonly scaleStatus: "metric-estimated" | "metric-validated" | "unknown";
  readonly schemaVersion: string;
}

export interface FusionExactTruth {
  readonly expectedConnectedComponentCount: number;
  readonly expectedDiscrepancyKinds: readonly FusionDiscrepancyKind[];
  readonly levelCount: number;
  readonly requiredUnknownRegionIds: readonly string[];
  readonly roomDimensions: readonly FusionRoomDimensions[];
  readonly sourceTransforms: Readonly<Record<string, FusionTransform>>;
  readonly supportedRegionIds: readonly string[];
  readonly topologyEdges: readonly string[];
}

export interface FusionAcceptanceFixture {
  readonly description: string;
  readonly expected: {
    readonly allowedAbstentionCodes: readonly string[];
    readonly disposition: FusionFixtureDisposition;
  };
  readonly id: string;
  readonly manifestSha256: string;
  readonly referenceFusionCandidate: FusionCandidate;
  readonly rights: FusionFixtureRights;
  readonly scope: FusionFixtureScope;
  readonly singleSourceCandidates: Readonly<Record<string, FusionCandidate>>;
  readonly sources: readonly FusionSourceManifest[];
  readonly title: string;
  readonly truth: FusionExactTruth;
  readonly visiblySynthetic: true;
}

export type FusionAdversarialKind =
  | "collinear-anchors"
  | "duplicate-reference"
  | "non-finite-number"
  | "overflow-coordinate"
  | "path-injection"
  | "reflection-transform"
  | "url-injection";

export interface FusionAdversarialFixture {
  readonly expectedSafeCode: string;
  readonly id: string;
  readonly kind: FusionAdversarialKind;
  readonly manifestSha256: string;
  readonly payload: unknown;
  readonly rights: FusionFixtureRights;
  readonly visiblySynthetic: true;
}
