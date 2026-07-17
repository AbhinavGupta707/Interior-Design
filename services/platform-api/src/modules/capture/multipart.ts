import { c7CapturePolicy } from "@interior-design/contracts";

import { captureConflict } from "./errors.js";
import type { CompleteCaptureArtifactUploadRequest } from "./types.js";

export interface DeclaredCapturePart {
  readonly byteSize: number;
  readonly checksumSha256: string;
  readonly etag?: string;
  readonly partNumber: number;
}

export function expectedCapturePartCount(byteSize: number): number {
  return Math.ceil(byteSize / c7CapturePolicy.uploadPartSizeBytes);
}

export function expectedCapturePartBytes(totalBytes: number, partNumber: number): number {
  const count = expectedCapturePartCount(totalBytes);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > count) {
    throw captureConflict(
      "CAPTURE_PART_OUT_OF_RANGE",
      "The upload part number is outside this artifact's immutable multipart plan.",
    );
  }
  if (partNumber < count) return c7CapturePolicy.uploadPartSizeBytes;
  const remainder = totalBytes % c7CapturePolicy.uploadPartSizeBytes;
  return remainder === 0 ? c7CapturePolicy.uploadPartSizeBytes : remainder;
}

export function validateCapturePartDeclaration(
  totalBytes: number,
  partNumber: number,
  byteSize: number,
): void {
  if (byteSize !== expectedCapturePartBytes(totalBytes, partNumber)) {
    throw captureConflict(
      "CAPTURE_PART_SIZE_MISMATCH",
      "The upload part size does not match this artifact's immutable multipart plan.",
    );
  }
}

export function reconcileCaptureCompletion(
  totalBytes: number,
  recorded: readonly DeclaredCapturePart[],
  request: CompleteCaptureArtifactUploadRequest,
): readonly Required<DeclaredCapturePart>[] {
  const expectedCount = expectedCapturePartCount(totalBytes);
  if (recorded.length !== expectedCount || request.parts.length !== expectedCount) {
    throw captureConflict(
      "CAPTURE_PARTS_INCOMPLETE",
      "Every planned artifact part must be declared and completed exactly once.",
    );
  }
  return request.parts.map((completed, index) => {
    const declaration = recorded[index];
    if (
      declaration === undefined ||
      declaration.partNumber !== completed.partNumber ||
      declaration.checksumSha256 !== completed.checksumSha256 ||
      declaration.byteSize !== expectedCapturePartBytes(totalBytes, completed.partNumber)
    ) {
      throw captureConflict(
        "CAPTURE_PART_SUBSTITUTION",
        "Artifact completion does not match the immutable part declarations.",
      );
    }
    if (declaration.etag !== undefined && declaration.etag !== completed.etag) {
      throw captureConflict(
        "CAPTURE_COMPLETION_CONFLICT",
        "The artifact part was already completed with a different provider token.",
      );
    }
    return { ...declaration, etag: completed.etag };
  });
}
