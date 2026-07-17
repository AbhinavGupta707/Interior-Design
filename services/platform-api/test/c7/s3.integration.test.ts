import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { loadS3AssetStorageConfig } from "../../src/storage/config.js";
import { S3AssetObjectStorage } from "../../src/storage/s3.js";

const endpoint = process.env.C7_TEST_S3_ENDPOINT ?? "";
const describeWithS3 = endpoint.length === 0 ? describe.skip : describe;

describeWithS3("C7 live S3-compatible checksum-bound multipart upload", () => {
  it("signs, uploads, completes, and reads one visibly synthetic source object", async () => {
    const storage = new S3AssetObjectStorage(
      loadS3AssetStorageConfig("test", {
        C2_STORAGE_ACCESS_KEY_ID: process.env.C7_TEST_S3_ACCESS_KEY ?? "localdev",
        C2_STORAGE_ENDPOINT: endpoint,
        C2_STORAGE_FORCE_PATH_STYLE: "true",
        C2_STORAGE_REGION: process.env.C7_TEST_S3_REGION ?? "local",
        C2_STORAGE_SECRET_ACCESS_KEY: process.env.C7_TEST_S3_SECRET_KEY ?? "local-development-only",
      }),
    );
    await storage.readiness();
    const bytes = Buffer.from('{"fixture":"visibly-synthetic-c7-live-storage"}', "utf8");
    const checksumSha256 = createHash("sha256").update(bytes).digest("base64");
    const key = `capture-sources/${randomUUID()}`;
    const providerUploadId = await storage.createMultipartUpload({
      bucket: "source",
      contentType: "application/json",
      key,
    });
    const signed = await storage.signUploadPart({
      bucket: "source",
      byteSize: bytes.byteLength,
      checksumSha256,
      expiresAt: new Date(Date.now() + 5 * 60 * 1_000),
      key,
      partNumber: 1,
      providerUploadId,
    });
    const uploaded = await fetch(signed.url, {
      body: bytes,
      headers: signed.requiredHeaders,
      method: "PUT",
    });
    expect(uploaded.status).toBeGreaterThanOrEqual(200);
    expect(uploaded.status).toBeLessThan(300);
    const etag = uploaded.headers.get("etag");
    if (etag === null) throw new Error("The live synthetic upload returned no provider token.");
    await storage.completeMultipartUpload({
      bucket: "source",
      expectedByteSize: bytes.byteLength,
      key,
      parts: [{ checksumSha256, etag, partNumber: 1 }],
      providerUploadId,
    });
    const access = await storage.signObjectAccess({
      bucket: "source",
      contentDisposition: "attachment",
      contentType: "application/json",
      expiresAt: new Date(Date.now() + 60_000),
      key,
    });
    const downloaded = await fetch(access.url);
    expect(downloaded.status).toBe(200);
    expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(bytes);
  });
});
