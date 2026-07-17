import {
  c2IngestionPolicy,
  type CompleteAssetUploadRequest,
  type SignAssetUploadPartRequest,
} from "@interior-design/contracts";

import { ApiError } from "../../errors.js";
import type { CompleteMultipartPart } from "../../storage/object-storage.js";

export const C2_PART_SIZE_BYTES = 134_217_728;
export const C2_UPLOAD_SESSION_TTL_MILLISECONDS = 24 * 60 * 60 * 1_000;

export interface RecordedUploadPart {
  readonly byteSize: number;
  readonly checksumSha256: string;
  readonly etag?: string;
  readonly partNumber: number;
}

function uploadConflict(code: string, detail: string): ApiError {
  return new ApiError({ code, detail, statusCode: 409, title: "Upload Conflict" });
}

export function expectedPartCount(byteSize: number, partSize: number): number {
  const count = Math.ceil(byteSize / partSize);
  if (count < 1 || count > c2IngestionPolicy.maximumUploadParts) {
    throw uploadConflict(
      "INVALID_MULTIPART_PLAN",
      "The upload cannot use the requested part plan.",
    );
  }
  return count;
}

export function expectedPartByteSize(
  sourceByteSize: number,
  partSize: number,
  partNumber: number,
): number {
  const partCount = expectedPartCount(sourceByteSize, partSize);
  if (partNumber < 1 || partNumber > partCount) {
    throw uploadConflict(
      "INVALID_UPLOAD_PART",
      "The requested upload part is outside the session.",
    );
  }
  return partNumber === partCount ? sourceByteSize - partSize * (partCount - 1) : partSize;
}

export function validatePartRequest(
  sourceByteSize: number,
  partSize: number,
  request: SignAssetUploadPartRequest,
): void {
  const expectedByteSize = expectedPartByteSize(sourceByteSize, partSize, request.partNumber);
  if (request.byteSize !== expectedByteSize) {
    throw uploadConflict(
      "UPLOAD_PART_SIZE_MISMATCH",
      "The upload part size does not match the immutable session plan.",
    );
  }
  const partCount = expectedPartCount(sourceByteSize, partSize);
  if (
    request.partNumber < partCount &&
    request.byteSize < c2IngestionPolicy.minimumNonFinalPartBytes
  ) {
    throw uploadConflict(
      "UPLOAD_PART_TOO_SMALL",
      "A non-final upload part is below the required minimum size.",
    );
  }
}

export function reconcileCompletion(
  sourceByteSize: number,
  sourceSha256: string,
  partSize: number,
  recorded: readonly RecordedUploadPart[],
  request: CompleteAssetUploadRequest,
): readonly CompleteMultipartPart[] {
  if (request.sha256 !== sourceSha256) {
    throw uploadConflict(
      "SOURCE_CHECKSUM_MISMATCH",
      "The completion checksum does not match the upload session.",
    );
  }

  const partCount = expectedPartCount(sourceByteSize, partSize);
  if (request.parts.length !== partCount || recorded.length !== partCount) {
    throw uploadConflict(
      "INCOMPLETE_MULTIPART_UPLOAD",
      "Every consecutive upload part must be recorded before completion.",
    );
  }

  let totalBytes = 0;
  const providerParts = request.parts.map((part, index) => {
    const expectedNumber = index + 1;
    const stored = recorded[index];
    if (
      stored === undefined ||
      stored.partNumber !== expectedNumber ||
      part.partNumber !== expectedNumber ||
      stored.checksumSha256 !== part.checksumSha256
    ) {
      throw uploadConflict(
        "UPLOAD_PART_MISMATCH",
        "Completion parts must match the recorded consecutive upload parts.",
      );
    }
    if (
      Array.from(part.etag).some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint < 32 || codePoint === 127;
      })
    ) {
      throw uploadConflict("INVALID_PROVIDER_ETAG", "An upload completion token is invalid.");
    }
    const expectedBytes = expectedPartByteSize(sourceByteSize, partSize, expectedNumber);
    if (stored.byteSize !== expectedBytes) {
      throw uploadConflict(
        "UPLOAD_PART_SIZE_MISMATCH",
        "A recorded upload part does not match the immutable session plan.",
      );
    }
    totalBytes += stored.byteSize;
    return {
      checksumSha256: part.checksumSha256,
      etag: part.etag,
      partNumber: part.partNumber,
    };
  });
  if (totalBytes !== sourceByteSize) {
    throw uploadConflict(
      "SOURCE_SIZE_MISMATCH",
      "The recorded upload parts do not match the declared source size.",
    );
  }
  return providerParts;
}
