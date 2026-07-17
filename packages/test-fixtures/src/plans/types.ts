export type PlanFixtureSplit = "train" | "validation" | "holdout";

export type PlanFixtureCategory = "golden" | "hard-negative" | "adversarial";

export type PlanFixtureMimeType = "application/pdf" | "image/jpeg" | "image/png" | "image/svg+xml";

export interface PlanFixtureRights {
  readonly allowedPurpose: readonly (
    "local-ci-evaluation" | "security-testing" | "ui-acceptance"
  )[];
  readonly creator: "Interior Design C6 synthetic QA lane";
  readonly licence: "CC0-1.0";
  readonly origin: "generated-in-repository";
  readonly right: "creator-dedicated";
  readonly serviceProcessingConsent: true;
  readonly split: PlanFixtureSplit;
  readonly synthetic: true;
  readonly trainingUseConsent: "denied";
}

export interface PlanFixtureScope {
  readonly assetId: string;
  readonly objectKey: string;
  readonly projectId: string;
  readonly sourceStatus: "ready";
  readonly tenantId: string;
}

export interface PlanTruthPoint {
  readonly xMillimetres: number;
  readonly yMillimetres: number;
}

export interface PlanTruthWall {
  readonly end: PlanTruthPoint;
  readonly id: string;
  readonly start: PlanTruthPoint;
}

export interface PlanTruthOpening {
  readonly centre: PlanTruthPoint;
  readonly hostWallId: string;
  readonly id: string;
}

export interface PlanFixtureTruth {
  readonly calibrationResidualMillimetres: number;
  readonly levelCount: 1;
  readonly openings: readonly PlanTruthOpening[];
  readonly roomsAreClosedAndSimple: true;
  readonly sourceUnitsPerMillimetre: number;
  readonly walls: readonly PlanTruthWall[];
}

export interface PlanFixtureExpectation {
  readonly abstentionCode?:
    | "ambiguous-topology"
    | "invalid-parser-output"
    | "low-confidence"
    | "no-plan-geometry"
    | "resource-limit"
    | "unsafe-content"
    | "unsupported-input";
  readonly disposition: "proposal" | "abstained" | "rejected";
  readonly textPolicy?: "inert-label-only";
}

export interface PlanFixture {
  readonly bytes: Uint8Array;
  readonly category: PlanFixtureCategory;
  readonly description: string;
  readonly expected: PlanFixtureExpectation;
  readonly id: string;
  readonly mimeType: PlanFixtureMimeType;
  readonly rights: PlanFixtureRights;
  readonly sha256: string;
  readonly scope: PlanFixtureScope;
  readonly title: string;
  readonly truth?: PlanFixtureTruth;
}
