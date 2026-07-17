import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  assetAccessResponseSchema,
  assetProcessingCommandSchema,
  assetProcessingResultSchema,
  assetRightsAssertionSchema,
  assetSchema,
  assetTechnicalMetadataSchema,
  assetUploadSessionSchema,
  c2IngestionPolicy,
  completeAssetUploadRequestSchema,
  initiateAssetUploadRequestSchema,
  internalObjectKeySchema,
  safeAssetFileNameSchema,
  signAssetUploadPartRequestSchema,
  signedAssetUploadPartSchema,
} from "../../../packages/contracts/src/index.js";
import {
  adversarialFixtureDefinitions,
  createAdversarialFixture,
  fixtureSha256,
} from "../../fixtures/c2/adversarial/factory.js";

const timestamp = "2026-07-17T12:00:00.000Z";
const assetId = "5ad284ff-31de-4e0a-b77a-45aaee2a9283";
const projectId = "719f83b4-937d-40ab-a079-4d59a2086381";
const sha256 = "a".repeat(64);
const checksumBase64 = `${"A".repeat(43)}=`;

const baseAsset = {
  createdAt: timestamp,
  declaredMimeType: "image/png" as const,
  fileName: "synthetic.png",
  id: assetId,
  kind: "photograph" as const,
  projectId,
  rights: {
    basis: "owned-by-user" as const,
    serviceProcessingConsent: true as const,
    trainingUseConsent: "denied" as const,
  },
  source: { byteSize: 68, sha256 },
  status: "pending-upload" as const,
  updatedAt: timestamp,
};

function uploadRequestForFixture(index: number) {
  const definition = adversarialFixtureDefinitions[index];
  if (definition === undefined) {
    throw new Error(`Missing fixture definition ${index}`);
  }
  const bytes = createAdversarialFixture(definition.id);
  return {
    byteSize: bytes.byteLength,
    declaredMimeType: definition.declaredMimeType,
    fileName: definition.fileName,
    kind: definition.kind,
    rights: { basis: "owned-by-user", serviceProcessingConsent: true },
    sha256: fixtureSha256(definition.id),
  };
}

describe("C2 adversarial frozen-contract boundaries", () => {
  it("rejects traversal and control filenames before any storage operation", () => {
    const rejected = adversarialFixtureDefinitions.filter(
      (fixture) => fixture.edgeExpectation === "reject-request",
    );
    expect(rejected).toHaveLength(3);
    for (const fixture of rejected) {
      expect(safeAssetFileNameSchema.safeParse(fixture.fileName).success).toBe(false);
    }
  });

  it("treats accepted names, extensions, kinds, and declared MIME as untrusted hints", () => {
    const acceptedIndexes = adversarialFixtureDefinitions
      .map((fixture, index) => ({ fixture, index }))
      .filter(({ fixture }) => fixture.edgeExpectation === "accept-as-untrusted-hint");
    for (const { index } of acceptedIndexes) {
      expect(
        initiateAssetUploadRequestSchema.safeParse(uploadRequestForFixture(index)).success,
      ).toBe(true);
    }
    const mismatch = acceptedIndexes.find(
      ({ fixture }) => fixture.id === "mime-signature-mismatch",
    );
    expect(mismatch?.fixture.declaredMimeType).toBe("image/jpeg");
    expect(
      createAdversarialFixture("mime-signature-mismatch").subarray(0, 4).toString("ascii"),
    ).toBe("%PDF");
  });

  it("requires processing consent and defaults separate training consent to denied", () => {
    expect(
      assetRightsAssertionSchema.parse({
        basis: "permission-granted",
        serviceProcessingConsent: true,
      }),
    ).toMatchObject({ trainingUseConsent: "denied" });
    expect(
      assetRightsAssertionSchema.safeParse({
        basis: "permission-granted",
        serviceProcessingConsent: false,
        trainingUseConsent: "granted",
      }).success,
    ).toBe(false);
  });

  it("keeps public assets strict and rejects internal storage/provider locators", () => {
    expect(assetSchema.parse(baseAsset)).toBeDefined();
    for (const extra of [
      { bucket: "source" },
      { objectKey: "projects/secret/source" },
      { providerUploadId: "provider-secret" },
      { signedUrl: "https://storage.invalid/signed" },
    ]) {
      expect(assetSchema.safeParse({ ...baseAsset, ...extra }).success).toBe(false);
    }
  });

  it("pins worker buckets, version, attempt bounds, and non-traversing keys", () => {
    const command = {
      assetId,
      attempt: 1,
      destinations: {
        derivedBucket: "derived",
        prefix: "projects/synthetic/assets/item",
        quarantineBucket: "quarantine",
      },
      expected: {
        byteSize: 68,
        declaredMimeType: "image/png",
        kind: "photograph",
        sha256,
      },
      projectId,
      source: { bucket: "source", key: "projects/synthetic/assets/item/source" },
      version: "c2-ingest-v1",
    };
    expect(assetProcessingCommandSchema.parse(command)).toBeDefined();
    expect(
      assetProcessingCommandSchema.safeParse({
        ...command,
        source: { bucket: "derived", key: command.source.key },
      }).success,
    ).toBe(false);
    expect(
      assetProcessingCommandSchema.safeParse({
        ...command,
        source: { bucket: "source", key: "projects/../foreign/source" },
      }).success,
    ).toBe(false);
    expect(assetProcessingCommandSchema.safeParse({ ...command, attempt: 11 }).success).toBe(false);
    expect(
      assetProcessingCommandSchema.safeParse({ ...command, version: "c2-ingest-v2" }).success,
    ).toBe(false);
  });

  it("rejects duplicate, gapped, and reordered completion parts", () => {
    const part = (partNumber: number) => ({
      checksumSha256: checksumBase64,
      etag: `provider-token-${partNumber}`,
      partNumber,
    });
    for (const parts of [
      [part(1), part(1)],
      [part(1), part(3)],
      [part(2), part(1)],
    ]) {
      expect(completeAssetUploadRequestSchema.safeParse({ parts, sha256 }).success).toBe(false);
    }
    expect(
      completeAssetUploadRequestSchema.parse({ parts: [part(1), part(2)], sha256 }),
    ).toBeDefined();
  });

  it("never substitutes an S3 ETag for the declared whole-object SHA-256", () => {
    const parsed = completeAssetUploadRequestSchema.parse({
      parts: [{ checksumSha256: checksumBase64, etag: sha256, partNumber: 1 }],
      sha256: "b".repeat(64),
    });
    expect(parsed.parts[0]?.etag).toBe(sha256);
    expect(parsed.sha256).toBe("b".repeat(64));
    expect(parsed.parts[0]?.etag).not.toBe(parsed.sha256);
  });

  it("enforces part count/size ceilings and frozen signed URL TTL ceilings", () => {
    expect(
      signAssetUploadPartRequestSchema.safeParse({
        byteSize: c2IngestionPolicy.maximumAssetBytes,
        checksumSha256: checksumBase64,
        partNumber: 1,
      }).success,
    ).toBe(false);
    expect(
      signAssetUploadPartRequestSchema.safeParse({
        byteSize: 1,
        checksumSha256: checksumBase64,
        partNumber: c2IngestionPolicy.maximumUploadParts + 1,
      }).success,
    ).toBe(false);
    expect(c2IngestionPolicy.signedUploadPartTtlSeconds).toBe(900);
    expect(c2IngestionPolicy.signedAccessTtlSeconds).toBe(300);
  });

  it("allows HTTP signed URLs only on loopback and preserves required headers", () => {
    const signedPart = {
      expiresAt: timestamp,
      partNumber: 1,
      requiredHeaders: { "x-amz-checksum-sha256": checksumBase64 },
      url: "http://127.0.0.1:8333/source?X-Amz-Expires=900",
    };
    expect(signedAssetUploadPartSchema.parse(signedPart).requiredHeaders).toEqual(
      signedPart.requiredHeaders,
    );
    expect(
      signedAssetUploadPartSchema.safeParse({
        ...signedPart,
        url: "http://storage.example.test/source?X-Amz-Expires=900",
      }).success,
    ).toBe(false);
    expect(
      assetAccessResponseSchema.safeParse({
        contentDisposition: "attachment",
        expiresAt: timestamp,
        url: "javascript:alert(1)",
      }).success,
    ).toBe(false);
  });

  it("requires ready results to carry bounded derived artifacts", () => {
    const resultBase = {
      assetId,
      detectedMimeType: "image/png",
      projectId,
      provenance: {
        executedAt: timestamp,
        policyVersion: "c2-ingest-v1",
        tools: [{ name: "synthetic-inspector", version: "1" }],
      },
      technicalMetadata: { heightPixels: 1, widthPixels: 1 },
      verifiedSource: { byteSize: 68, sha256 },
      version: "c2-ingest-v1",
    };
    expect(
      assetProcessingResultSchema.safeParse({ ...resultBase, artifacts: [], status: "ready" })
        .success,
    ).toBe(false);
    expect(
      assetProcessingResultSchema.safeParse({
        ...resultBase,
        artifacts: [
          {
            byteSize: 32,
            key: "projects/synthetic/derived/preview.png",
            kind: "preview",
            mimeType: "image/png",
            sha256,
          },
        ],
        status: "ready",
      }).success,
    ).toBe(true);
    expect(internalObjectKeySchema.safeParse("projects/../source").success).toBe(false);
  });

  it("records the 100 MP cross-field validation gap for worker enforcement", () => {
    const metadata = assetTechnicalMetadataSchema.parse({
      heightPixels: c2IngestionPolicy.maximumImageDimension,
      widthPixels: c2IngestionPolicy.maximumImageDimension,
    });
    expect((metadata.heightPixels ?? 0) * (metadata.widthPixels ?? 0)).toBeGreaterThan(
      c2IngestionPolicy.maximumImagePixels,
    );
  });

  it("records the prose/schema video-duration mismatch for orchestrator routing", () => {
    expect(c2IngestionPolicy.maximumVideoDurationMilliseconds / 60_000).toBe(1_800);
    expect(c2IngestionPolicy.maximumVideoDurationMilliseconds).not.toBe(30 * 60_000);
  });

  it("records that strict upload-session schema cannot carry resumed part numbers", () => {
    const session = {
      asset: baseAsset,
      expiresAt: timestamp,
      maximumPartCount: 10_000,
      minimumNonFinalPartSize: 5_242_880,
      partSize: 5_242_880,
      recordedPartNumbers: [1],
      sessionId: randomUUID(),
      state: "uploading",
    };
    expect(assetUploadSessionSchema.safeParse(session).success).toBe(false);
  });

  it("records misleading-but-pathless filename cases that must never become keys or commands", () => {
    for (const fileName of [".", "..", "plan%2f..%2fsource.pdf", "plan\u202efdp.exe"]) {
      expect(safeAssetFileNameSchema.safeParse(fileName).success).toBe(true);
    }
  });
});
