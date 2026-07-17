import { ApiError } from "../../src/errors.js";
import {
  expectedCapturePartBytes,
  expectedCapturePartCount,
  reconcileCaptureCompletion,
  validateCapturePartDeclaration,
} from "../../src/modules/capture/multipart.js";
import { describe, expect, it } from "vitest";

const partSize = 8_388_608;
const checksumOne = Buffer.alloc(32, 1).toString("base64");
const checksumTwo = Buffer.alloc(32, 2).toString("base64");

function expectConflict(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error("Expected a capture conflict.");
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(code);
  }
}

describe("bounded checksum-bound multipart plans", () => {
  it("calculates exact single, full, and final part sizes", () => {
    expect(expectedCapturePartCount(1)).toBe(1);
    expect(expectedCapturePartCount(partSize)).toBe(1);
    expect(expectedCapturePartCount(partSize + 1)).toBe(2);
    expect(expectedCapturePartBytes(partSize + 1, 1)).toBe(partSize);
    expect(expectedCapturePartBytes(partSize + 1, 2)).toBe(1);
    expect(expectedCapturePartBytes(partSize * 2, 2)).toBe(partSize);
  });

  it("rejects out-of-range, fractional, and mismatched declarations", () => {
    expectConflict(() => expectedCapturePartBytes(1, 0), "CAPTURE_PART_OUT_OF_RANGE");
    expectConflict(() => expectedCapturePartBytes(1, 1.5), "CAPTURE_PART_OUT_OF_RANGE");
    expectConflict(() => expectedCapturePartBytes(1, 2), "CAPTURE_PART_OUT_OF_RANGE");
    expectConflict(() => {
      validateCapturePartDeclaration(partSize + 1, 1, 1);
    }, "CAPTURE_PART_SIZE_MISMATCH");
  });

  it("accepts only consecutive declarations with exact checksums and provider tokens", () => {
    const result = reconcileCaptureCompletion(
      partSize + 1,
      [
        { byteSize: partSize, checksumSha256: checksumOne, partNumber: 1 },
        { byteSize: 1, checksumSha256: checksumTwo, partNumber: 2 },
      ],
      {
        parts: [
          { checksumSha256: checksumOne, etag: "synthetic-etag-1", partNumber: 1 },
          { checksumSha256: checksumTwo, etag: "synthetic-etag-2", partNumber: 2 },
        ],
      },
    );
    expect(result).toEqual([
      {
        byteSize: partSize,
        checksumSha256: checksumOne,
        etag: "synthetic-etag-1",
        partNumber: 1,
      },
      {
        byteSize: 1,
        checksumSha256: checksumTwo,
        etag: "synthetic-etag-2",
        partNumber: 2,
      },
    ]);
  });

  it("rejects missing, substituted, reordered, and conflicting replay completion parts", () => {
    const declared = [
      { byteSize: partSize, checksumSha256: checksumOne, partNumber: 1 },
      {
        byteSize: 1,
        checksumSha256: checksumTwo,
        etag: "synthetic-etag-existing",
        partNumber: 2,
      },
    ];
    expectConflict(
      () => reconcileCaptureCompletion(partSize + 1, declared, { parts: [] }),
      "CAPTURE_PARTS_INCOMPLETE",
    );
    expectConflict(
      () =>
        reconcileCaptureCompletion(partSize + 1, declared, {
          parts: [
            { checksumSha256: checksumTwo, etag: "one", partNumber: 1 },
            { checksumSha256: checksumTwo, etag: "synthetic-etag-existing", partNumber: 2 },
          ],
        }),
      "CAPTURE_PART_SUBSTITUTION",
    );
    expectConflict(
      () =>
        reconcileCaptureCompletion(partSize + 1, declared, {
          parts: [
            { checksumSha256: checksumOne, etag: "one", partNumber: 1 },
            { checksumSha256: checksumTwo, etag: "substituted", partNumber: 2 },
          ],
        }),
      "CAPTURE_COMPLETION_CONFLICT",
    );
  });
});
