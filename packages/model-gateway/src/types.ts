export const modelGatewayRequestSchemaVersion = "model-gateway-request-v1" as const;
export const modelGatewayResultSchemaVersion = "model-gateway-result-v1" as const;
export const deterministicLocalAdapterId = "deterministic-local-v1" as const;
export const externalDisabledAdapterId = "external-disabled" as const;
export const consultationPromptId = "c11-consultation-extract-v1" as const;
export const consultationToolId = "c11.propose-brief-patch-v1" as const;

export type ModelAdapterId = typeof deterministicLocalAdapterId | typeof externalDisabledAdapterId;

export const modelGatewayLimits = Object.freeze({
  maximumBriefEntries: 500,
  maximumClarifications: 5,
  maximumEvidenceExcerptCharacters: 2_000,
  maximumEvidenceExcerpts: 20,
  maximumOperations: 20,
  maximumProfessionalReviewItems: 10,
  maximumRequestCharacters: 32_000,
  maximumResultCharacters: 24_000,
  maximumStatementCharacters: 500,
  maximumSummaryCharacters: 1_000,
  maximumTimeoutMs: 5_000,
  maximumUserMessageCharacters: 8_000,
} as const);

export type GatewayBriefEntryCategory =
  | "household-change"
  | "accessibility"
  | "work-study"
  | "cooking-dining"
  | "entertaining"
  | "storage"
  | "privacy"
  | "acoustics"
  | "daylight-view"
  | "garden-outdoor"
  | "retained-item"
  | "spatial-need"
  | "adjacency"
  | "minimum-dimension"
  | "style-aesthetic"
  | "material-colour"
  | "reference"
  | "budget-category"
  | "disruption-timing"
  | "sustainability"
  | "decision-criterion"
  | "professional-review"
  | "other";

export type GatewayBriefEntryClassification =
  | "observed-evidence"
  | "household-assertion"
  | "hard-constraint"
  | "preference"
  | "inferred-suggestion"
  | "unresolved-conflict"
  | "unknown";

export type GatewayProposedClassification =
  "household-assertion" | "hard-constraint" | "preference" | "unresolved-conflict" | "unknown";

export interface GatewayBriefContextEntry {
  readonly category: GatewayBriefEntryCategory;
  readonly classification: GatewayBriefEntryClassification;
  readonly id: string;
  readonly statement: string;
  readonly status: "active" | "resolved" | "withdrawn";
}

export interface GatewayEvidenceExcerpt {
  readonly assetId: string;
  readonly id: string;
  readonly text: string;
}

export interface ModelGatewayRequest {
  readonly adapterId: ModelAdapterId;
  readonly input: {
    readonly currentBriefEntries: readonly GatewayBriefContextEntry[];
    readonly evidenceExcerpts: readonly GatewayEvidenceExcerpt[];
    readonly generatedAt: string;
    readonly sourceMessage: {
      readonly id: string;
      readonly text: string;
    };
  };
  readonly limits: {
    readonly timeoutMs: number;
  };
  readonly promptId: typeof consultationPromptId;
  readonly requestId: string;
  readonly schemaVersion: typeof modelGatewayRequestSchemaVersion;
  readonly toolId: typeof consultationToolId;
}

export interface GatewayEntryAddOperation {
  readonly entry: {
    readonly category: GatewayBriefEntryCategory;
    readonly classification: GatewayProposedClassification;
    readonly id: string;
    readonly priority: number;
    readonly provenance: {
      readonly capturedAt: string;
      readonly method: "assistant-extracted";
      readonly sourceMessageId: string;
    };
    readonly roomOrLevelElementIds: readonly string[];
    readonly statement: string;
    readonly status: "active";
  };
  readonly kind: "entry.add";
}

export type ProfessionalReviewReason =
  | "structural"
  | "regulatory"
  | "accessibility-clinical"
  | "cost-certainty"
  | "product-availability"
  | "professional-judgement"
  | "insufficient-evidence";

export interface GatewayProfessionalReview {
  readonly question: string;
  readonly reason: ProfessionalReviewReason;
  readonly status: "review-required";
}

export interface ModelGatewayResult {
  readonly manifest: {
    readonly adapter: typeof deterministicLocalAdapterId;
    readonly externalNetworkUsed: false;
    readonly promptRegistryVersion: string;
    readonly toolRegistryVersion: string;
  };
  readonly output: {
    readonly clarifyingQuestions: readonly string[];
    readonly operations: readonly GatewayEntryAddOperation[];
    readonly professionalReview: readonly GatewayProfessionalReview[];
    readonly summary: string;
  };
  readonly requestId: string;
  readonly schemaVersion: typeof modelGatewayResultSchemaVersion;
}

export interface PromptRegistryEntry {
  readonly id: typeof consultationPromptId;
  readonly purpose: "extract-c11-brief-patch-proposal";
  readonly treatsUntrustedTextAsData: true;
  readonly version: string;
}

export interface ToolRegistryEntry {
  readonly allowedOperationKinds: readonly ["entry.add"];
  readonly id: typeof consultationToolId;
  readonly sideEffects: false;
  readonly version: string;
}

export interface ModelCapabilityManifest {
  readonly adapterId: ModelAdapterId;
  readonly available: boolean;
  readonly deniedCapabilities: readonly [
    "generic-network",
    "generic-filesystem",
    "generic-database",
    "object-storage",
    "canonical-model-mutation",
    "brief-mutation",
  ];
  readonly externalNetworkUsed: false;
  readonly inputLogged: false;
  readonly promptIds: readonly [typeof consultationPromptId];
  readonly toolIds: readonly [typeof consultationToolId];
  readonly trainingUsed: false;
}

export interface ModelGatewayInvocationOptions {
  readonly signal?: AbortSignal;
}
