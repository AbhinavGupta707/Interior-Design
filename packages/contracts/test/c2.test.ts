import { describe, expect, it } from "vitest";

import {
  assetProcessingCommandSchema,
  assetRightsAssertionSchema,
  completeAssetUploadRequestSchema,
  initiateAssetUploadRequestSchema,
  safeAssetFileNameSchema,
} from "../src/index.js";

const sha256 = "a".repeat(64);
const partChecksum = `${"A".repeat(43)}=`;

describe("C2 immutable evidence contracts", () => {
  it("defaults training use to denied while requiring processing consent", () => {
    expect(
      assetRightsAssertionSchema.parse({
        basis: "owned-by-user",
        serviceProcessingConsent: true,
      }),
    ).toMatchObject({ trainingUseConsent: "denied" });
    expect(() =>
      assetRightsAssertionSchema.parse({
        basis: "owned-by-user",
        serviceProcessingConsent: false,
      }),
    ).toThrow();
  });

  it("rejects path-shaped and control-character file names", () => {
    expect(() => safeAssetFileNameSchema.parse("../private/plan.pdf")).toThrow();
    expect(() => safeAssetFileNameSchema.parse("plan\u0000.pdf")).toThrow();
  });

  it("accepts a bounded rights-aware upload request", () => {
    expect(
      initiateAssetUploadRequestSchema.parse({
        byteSize: 42_000,
        declaredMimeType: "application/pdf",
        fileName: "ground-floor-plan.pdf",
        kind: "plan",
        rights: {
          basis: "permission-granted",
          serviceProcessingConsent: true,
        },
        sha256,
      }),
    ).toMatchObject({ rights: { trainingUseConsent: "denied" } });
  });

  it("requires ordered consecutive multipart completion records", () => {
    expect(() =>
      completeAssetUploadRequestSchema.parse({
        parts: [
          { checksumSha256: partChecksum, etag: "part-one", partNumber: 1 },
          { checksumSha256: partChecksum, etag: "part-three", partNumber: 3 },
        ],
        sha256,
      }),
    ).toThrow();
  });

  it("keeps storage locators in an explicit internal worker command", () => {
    expect(
      assetProcessingCommandSchema.parse({
        assetId: "5ad284ff-31de-4e0a-b77a-45aaee2a9283",
        attempt: 1,
        destinations: {
          derivedBucket: "derived",
          prefix: "projects/719f83b4/assets/5ad284ff",
          quarantineBucket: "quarantine",
        },
        expected: {
          byteSize: 42_000,
          declaredMimeType: "application/pdf",
          kind: "plan",
          sha256,
        },
        projectId: "719f83b4-937d-40ab-a079-4d59a2086381",
        source: {
          bucket: "source",
          key: "projects/719f83b4/assets/5ad284ff/source",
        },
        version: "c2-ingest-v1",
      }),
    ).toBeDefined();
  });
});
