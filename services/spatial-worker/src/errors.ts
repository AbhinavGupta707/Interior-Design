import type { AssetProcessingResult, AssetRejectionCode } from "@interior-design/contracts";

export type AssetTechnicalMetadata = AssetProcessingResult["technicalMetadata"];

export class MediaRejection extends Error {
  readonly code: AssetRejectionCode;
  readonly detectedMimeType: string;
  readonly technicalMetadata: AssetTechnicalMetadata;

  constructor(
    code: AssetRejectionCode,
    options: {
      readonly detectedMimeType?: string;
      readonly technicalMetadata?: AssetTechnicalMetadata;
    } = {},
  ) {
    super(code);
    this.name = "MediaRejection";
    this.code = code;
    this.detectedMimeType = options.detectedMimeType ?? "application/octet-stream";
    this.technicalMetadata = options.technicalMetadata ?? {};
  }
}

export class RetryableWorkerError extends Error {
  readonly safeCode: string;

  constructor(safeCode: string, cause?: unknown) {
    super(safeCode, cause === undefined ? undefined : { cause });
    this.name = "RetryableWorkerError";
    this.safeCode = safeCode;
  }
}

export class LeaseLostError extends Error {
  constructor() {
    super("lease-lost");
    this.name = "LeaseLostError";
  }
}

export function isMissingExecutable(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as Error & { readonly code?: unknown }).code === "ENOENT"
  );
}
