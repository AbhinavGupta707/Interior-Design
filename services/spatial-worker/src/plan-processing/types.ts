import type {
  C6SupportedPlanMimeType,
  PlanParserMode,
  PlanParserRequest,
  PlanParserResult,
  PlanSourceManifest,
} from "@interior-design/contracts";

export type PlanNormalizationFailureCode =
  | "invalid-parser-output"
  | "no-plan-geometry"
  | "parser-timeout"
  | "parser-unavailable"
  | "resource-limit"
  | "source-mismatch"
  | "unsafe-content"
  | "unsupported-input";

export class PlanNormalizationError extends Error {
  readonly code: PlanNormalizationFailureCode;
  readonly retryable: boolean;

  constructor(code: PlanNormalizationFailureCode, retryable = false, options?: ErrorOptions) {
    super(`plan-normalization-${code}`, options);
    this.name = "PlanNormalizationError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface PlanNormalizerToolchain {
  readonly pdfInfo: string;
  readonly pdfToCairo: string;
  readonly pdfToPpm: string;
  readonly popplerVersion: string;
}

export interface PlanNormalizationRequest {
  readonly detectedMimeType: C6SupportedPlanMimeType;
  readonly expectedByteSize: number;
  readonly expectedSha256: string;
  readonly pageIndex: number;
  readonly parserPreference: "auto" | "fixture" | "raster" | "vector";
  readonly sourcePath: string;
  readonly workspaceDirectory: string;
}

export interface NormalizedPlanInput {
  readonly coordinateSpace: "fixture-microunits" | "pdf-micropoints" | "pixels" | "svg-microunits";
  /** Internal-only path. Never persist or include it in public workflow/audit records. */
  readonly filePath: string;
  readonly heightSourceUnits: number;
  readonly mode: PlanParserMode;
  readonly normalizers: readonly { readonly name: string; readonly version: string }[];
  readonly sha256: string;
  readonly widthSourceUnits: number;
}

export interface PlanParserInput extends NormalizedPlanInput {
  readonly request: PlanParserRequest;
}

export interface PlanParserPort {
  parse(input: PlanParserInput, signal?: AbortSignal): Promise<PlanParserResult>;
}

export interface LeasedPlanProcessingJob {
  readonly assetId: string;
  readonly attempt: number;
  readonly detectedMimeType: C6SupportedPlanMimeType;
  readonly jobId: string;
  readonly leaseExpiresAt: string;
  readonly leaseToken: string;
  readonly pageIndex: number;
  readonly parserPreference: "auto" | "fixture" | "raster" | "vector";
  readonly projectId: string;
  readonly rights: PlanSourceManifest["rights"];
  readonly sourceByteSize: number;
  readonly sourceObjectKey: string;
  readonly sourceSha256: string;
  readonly tenantId: string;
}

export interface PlanProcessingQueue {
  acknowledgeCancellation(job: LeasedPlanProcessingJob, workerId: string): Promise<boolean>;
  claimNext(
    workerId: string,
    leaseMilliseconds: number,
  ): Promise<LeasedPlanProcessingJob | undefined>;
  fail(
    job: LeasedPlanProcessingJob,
    workerId: string,
    code: PlanNormalizationFailureCode | "rights-not-permitted",
    retryable: boolean,
  ): Promise<boolean>;
  heartbeat(
    job: LeasedPlanProcessingJob,
    workerId: string,
    leaseMilliseconds: number,
  ): Promise<"cancel-requested" | "leased" | "lost">;
  publish(
    job: LeasedPlanProcessingJob,
    workerId: string,
    result: PlanParserResult,
  ): Promise<boolean>;
}
