import { describe, expect, it } from "vitest";

import {
  assetTechnicalMetadataSchema,
  assetUploadSessionSchema,
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

  it("accepts only unique ascending recorded upload parts", () => {
    const session = {
      asset: {
        createdAt: "2026-07-17T12:00:00.000Z",
        declaredMimeType: "application/pdf",
        fileName: "ground-floor-plan.pdf",
        id: "5ad284ff-31de-4e0a-b77a-45aaee2a9283",
        kind: "plan",
        projectId: "719f83b4-937d-40ab-a079-4d59a2086381",
        rights: {
          basis: "owned-by-user",
          serviceProcessingConsent: true,
          trainingUseConsent: "denied",
        },
        source: { byteSize: 42_000, sha256 },
        status: "pending-upload",
        updatedAt: "2026-07-17T12:00:00.000Z",
      },
      expiresAt: "2026-07-17T12:30:00.000Z",
      maximumPartCount: 10_000,
      minimumNonFinalPartSize: 5_242_880,
      partSize: 5_242_880,
      recordedPartNumbers: [1, 3],
      sessionId: "89cd1845-01f0-4b0c-a5e1-485da52ef9fb",
      state: "uploading",
    } as const;

    expect(assetUploadSessionSchema.parse(session).recordedPartNumbers).toEqual([1, 3]);
    expect(() =>
      assetUploadSessionSchema.parse({ ...session, recordedPartNumbers: [1, 1] }),
    ).toThrow();
    expect(() =>
      assetUploadSessionSchema.parse({ ...session, recordedPartNumbers: [3, 1] }),
    ).toThrow();
  });

  it("enforces the 30 minute and 100 megapixel inspection limits", () => {
    expect(
      assetTechnicalMetadataSchema.parse({
        durationMilliseconds: 1_800_000,
        heightPixels: 10_000,
        widthPixels: 10_000,
      }),
    ).toBeDefined();
    expect(() => assetTechnicalMetadataSchema.parse({ durationMilliseconds: 1_800_001 })).toThrow();
    expect(() =>
      assetTechnicalMetadataSchema.parse({ heightPixels: 10_001, widthPixels: 10_000 }),
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
