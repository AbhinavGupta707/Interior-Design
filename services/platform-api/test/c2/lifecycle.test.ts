import {
  completeAssetUploadRequestSchema,
  signAssetUploadPartRequestSchema,
} from "@interior-design/contracts";
import { describe, expect, it } from "vitest";

import {
  C2_PART_SIZE_BYTES,
  expectedPartByteSize,
  expectedPartCount,
  reconcileCompletion,
  validatePartRequest,
} from "../../src/modules/assets/lifecycle.js";

const checksumA = `${"A".repeat(43)}=`;
const checksumB = `${"B".repeat(43)}=`;
const sourceSha256 = "a".repeat(64);

describe("C2 multipart lifecycle", () => {
  it("creates a deterministic bounded plan with an exact final part", () => {
    const byteSize = C2_PART_SIZE_BYTES + 42;
    expect(expectedPartCount(byteSize, C2_PART_SIZE_BYTES)).toBe(2);
    expect(expectedPartByteSize(byteSize, C2_PART_SIZE_BYTES, 1)).toBe(C2_PART_SIZE_BYTES);
    expect(expectedPartByteSize(byteSize, C2_PART_SIZE_BYTES, 2)).toBe(42);
  });

  it("binds every signed part to the immutable size plan", () => {
    const request = signAssetUploadPartRequestSchema.parse({
      byteSize: C2_PART_SIZE_BYTES,
      checksumSha256: checksumA,
      partNumber: 1,
    });
    expect(() => {
      validatePartRequest(C2_PART_SIZE_BYTES + 42, C2_PART_SIZE_BYTES, request);
    }).not.toThrow();
    expect(() => {
      validatePartRequest(C2_PART_SIZE_BYTES + 41, C2_PART_SIZE_BYTES, {
        ...request,
        byteSize: 41,
        partNumber: 2,
      });
    }).not.toThrow();
    expect(() => {
      validatePartRequest(C2_PART_SIZE_BYTES + 42, C2_PART_SIZE_BYTES, {
        ...request,
        byteSize: 41,
        partNumber: 2,
      });
    }).toThrow(expect.objectContaining({ code: "UPLOAD_PART_SIZE_MISMATCH" }));
  });

  it("reconciles only ordered, complete, checksum-matching provider tokens", () => {
    const byteSize = C2_PART_SIZE_BYTES + 42;
    const request = completeAssetUploadRequestSchema.parse({
      parts: [
        { checksumSha256: checksumA, etag: "etag-one", partNumber: 1 },
        { checksumSha256: checksumB, etag: "etag-two", partNumber: 2 },
      ],
      sha256: sourceSha256,
    });
    const recorded = [
      {
        byteSize: C2_PART_SIZE_BYTES,
        checksumSha256: checksumA,
        partNumber: 1,
      },
      { byteSize: 42, checksumSha256: checksumB, partNumber: 2 },
    ];
    expect(
      reconcileCompletion(byteSize, sourceSha256, C2_PART_SIZE_BYTES, recorded, request),
    ).toEqual(request.parts);
    expect(() =>
      reconcileCompletion(byteSize, "b".repeat(64), C2_PART_SIZE_BYTES, recorded, request),
    ).toThrow(expect.objectContaining({ code: "SOURCE_CHECKSUM_MISMATCH" }));
    expect(() =>
      reconcileCompletion(
        byteSize,
        sourceSha256,
        C2_PART_SIZE_BYTES,
        [
          {
            byteSize: C2_PART_SIZE_BYTES,
            checksumSha256: checksumB,
            partNumber: 1,
          },
          { byteSize: 42, checksumSha256: checksumB, partNumber: 2 },
        ],
        request,
      ),
    ).toThrow(expect.objectContaining({ code: "UPLOAD_PART_MISMATCH" }));
  });
});
