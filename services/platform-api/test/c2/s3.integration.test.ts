import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { loadS3AssetStorageConfig } from "../../src/storage/config.js";
import { S3AssetObjectStorage } from "../../src/storage/s3.js";

const endpoint = process.env.C2_TEST_S3_ENDPOINT ?? "";
const describeWithS3 = endpoint === "" ? describe.skip : describe;

async function safeFetchFailure(
  operation: string,
  response: Response,
  signedUrl?: string,
): Promise<Error> {
  const body = await response.text();
  const providerCode = /<Code>([^<]{1,80})<\/Code>/u.exec(body)?.[1];
  const signedHeaders =
    signedUrl === undefined
      ? undefined
      : new URL(signedUrl).searchParams.get("X-Amz-SignedHeaders");
  const signedParameterNames =
    signedUrl === undefined
      ? undefined
      : [...new URL(signedUrl).searchParams.keys()].sort().join(",");
  return new Error(
    `${operation} failed with storage status ${String(response.status)}` +
      (providerCode === undefined ? "" : ` (${providerCode})`) +
      (signedHeaders === undefined || signedHeaders === null
        ? "."
        : `; signed headers: ${signedHeaders}; parameters: ${signedParameterNames ?? "none"}.`),
  );
}

describeWithS3("C2 loopback S3-compatible integration", () => {
  it("completes a checksum-bound multipart source and reads it through attachment access", async () => {
    const storage = new S3AssetObjectStorage(
      loadS3AssetStorageConfig("test", {
        C2_STORAGE_ACCESS_KEY_ID: process.env.C2_TEST_S3_ACCESS_KEY ?? "localdev",
        C2_STORAGE_ENDPOINT: endpoint,
        C2_STORAGE_FORCE_PATH_STYLE: "true",
        C2_STORAGE_REGION: "local",
        C2_STORAGE_SECRET_ACCESS_KEY: process.env.C2_TEST_S3_SECRET_KEY ?? "local-development-only",
      }),
    );
    await expect(storage.readiness()).resolves.toBeUndefined();

    const bytes = new TextEncoder().encode("synthetic-c2-loopback-object-content-000001");
    const checksumSha256 = createHash("sha256").update(bytes).digest("base64");
    const key = `sources/${randomUUID()}`;
    const providerUploadId = await storage.createMultipartUpload({
      bucket: "source",
      contentType: "application/pdf",
      key,
    });
    const signedPart = await storage.signUploadPart({
      bucket: "source",
      byteSize: bytes.byteLength,
      checksumSha256,
      expiresAt: new Date(Date.now() + 900_000),
      key,
      partNumber: 1,
      providerUploadId,
    });
    const uploaded = await fetch(signedPart.url, {
      body: bytes,
      headers: signedPart.requiredHeaders,
      method: "PUT",
    });
    if (!uploaded.ok) {
      throw await safeFetchFailure("Multipart upload", uploaded, signedPart.url);
    }
    const etag = uploaded.headers.get("etag");
    if (etag === null || etag.length === 0) {
      throw new Error("Multipart upload returned no completion token.");
    }

    await storage.completeMultipartUpload({
      bucket: "source",
      expectedByteSize: bytes.byteLength,
      key,
      parts: [{ checksumSha256, etag, partNumber: 1 }],
      providerUploadId,
    });
    const signedAccess = await storage.signObjectAccess({
      bucket: "source",
      contentDisposition: "attachment",
      contentType: "application/pdf",
      expiresAt: new Date(Date.now() + 300_000),
      key,
    });
    const downloaded = await fetch(signedAccess.url);
    if (!downloaded.ok) {
      throw await safeFetchFailure("Signed source access", downloaded);
    }
    expect(downloaded.headers.get("content-disposition")).toContain("attachment");
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(bytes);
  });
});
