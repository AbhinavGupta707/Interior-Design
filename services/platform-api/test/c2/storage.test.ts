import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";

import { loadS3AssetStorageConfig } from "../../src/storage/config.js";
import { S3AssetObjectStorage } from "../../src/storage/s3.js";

const now = new Date("2026-07-17T12:00:00.000Z");
const checksum = `${"A".repeat(43)}=`;

class FakeCommandClient {
  readonly commands: object[] = [];
  readonly responses: unknown[] = [];

  send(command: object): Promise<unknown> {
    this.commands.push(command);
    const response = this.responses.shift();
    if (response instanceof Error) {
      return Promise.reject(response);
    }
    return Promise.resolve(response ?? {});
  }
}

const config = loadS3AssetStorageConfig("test", {});

describe("C2 S3-compatible object storage", () => {
  it("fails closed in production without explicit HTTPS credentials", () => {
    expect(() => loadS3AssetStorageConfig("production", {})).toThrow(/required in production/u);
    expect(() =>
      loadS3AssetStorageConfig("production", {
        C2_STORAGE_ACCESS_KEY_ID: "production-access",
        C2_STORAGE_ENDPOINT: "http://127.0.0.1:8333",
        C2_STORAGE_SECRET_ACCESS_KEY: "production-secret",
      }),
    ).toThrow(/non-loopback HTTPS/u);
  });

  it("uses path-style loopback defaults and never sources implicit credentials", () => {
    expect(config).toMatchObject({
      accessKeyId: "localdev",
      endpoint: "http://127.0.0.1:8333",
      forcePathStyle: true,
      region: "local",
    });
  });

  it("binds upload URLs to checksum, byte size, part number, key, and a 15-minute maximum", async () => {
    const client = new FakeCommandClient();
    client.responses.push({ UploadId: "provider-internal-upload" });
    const presigned: Array<{ command: object; expiresIn: number }> = [];
    const storage = new S3AssetObjectStorage(config, {
      client,
      now: () => now,
      presign: (command, expiresIn) => {
        presigned.push({ command, expiresIn });
        return Promise.resolve("http://127.0.0.1:8333/source/signed?redacted=test");
      },
    });
    await expect(
      storage.createMultipartUpload({
        bucket: "source",
        contentType: "application/pdf",
        key: "sources/opaque",
      }),
    ).resolves.toBe("provider-internal-upload");
    expect(client.commands[0]).toBeInstanceOf(CreateMultipartUploadCommand);

    const signed = await storage.signUploadPart({
      bucket: "source",
      byteSize: 42,
      checksumSha256: checksum,
      expiresAt: new Date(now.getTime() + 900_000),
      key: "sources/opaque",
      partNumber: 1,
      providerUploadId: "provider-internal-upload",
    });
    expect(signed.requiredHeaders).toEqual({
      "content-length": "42",
      "x-amz-checksum-sha256": checksum,
      "x-amz-sdk-checksum-algorithm": "SHA256",
    });
    expect(presigned[0]?.expiresIn).toBe(900);
    expect(presigned[0]?.command).toBeInstanceOf(UploadPartCommand);
    expect((presigned[0]?.command as UploadPartCommand).input).toMatchObject({
      Bucket: "source",
      ChecksumAlgorithm: "SHA256",
      ChecksumSHA256: checksum,
      ContentLength: 42,
      Key: "sources/opaque",
      PartNumber: 1,
      UploadId: "provider-internal-upload",
    });
  });

  it("recovers an ambiguous complete retry only when the immutable object size matches", async () => {
    const client = new FakeCommandClient();
    const missingUpload = new Error("provider detail that must not escape");
    missingUpload.name = "NoSuchUpload";
    client.responses.push(missingUpload, { ContentLength: 42 });
    const storage = new S3AssetObjectStorage(config, { client, now: () => now });
    await expect(
      storage.completeMultipartUpload({
        bucket: "source",
        expectedByteSize: 42,
        key: "sources/opaque",
        parts: [{ checksumSha256: checksum, etag: "etag-one", partNumber: 1 }],
        providerUploadId: "provider-internal-upload",
      }),
    ).resolves.toBeUndefined();
    expect(client.commands[0]).toBeInstanceOf(CompleteMultipartUploadCommand);
    expect(client.commands[1]).toBeInstanceOf(HeadObjectCommand);
  });

  it("treats missing aborts as idempotent and strips provider details from failures", async () => {
    const missingClient = new FakeCommandClient();
    const missingUpload = new Error("provider upload id");
    missingUpload.name = "NoSuchUpload";
    missingClient.responses.push(missingUpload);
    const missingStorage = new S3AssetObjectStorage(config, { client: missingClient });
    await expect(
      missingStorage.abortMultipartUpload({
        bucket: "source",
        key: "sources/opaque",
        providerUploadId: "provider-internal-upload",
      }),
    ).resolves.toBeUndefined();
    expect(missingClient.commands[0]).toBeInstanceOf(AbortMultipartUploadCommand);

    const failedClient = new FakeCommandClient();
    failedClient.responses.push(new Error("secret-provider-url-and-upload-id"));
    const failedStorage = new S3AssetObjectStorage(config, { client: failedClient });
    await expect(
      failedStorage.createMultipartUpload({
        bucket: "source",
        contentType: "application/pdf",
        key: "sources/opaque",
      }),
    ).rejects.toThrow("The object-storage operation failed.");
  });

  it("signs ready access for at most five minutes and checks every required bucket", async () => {
    const client = new FakeCommandClient();
    const presigned: Array<{ command: object; expiresIn: number }> = [];
    const storage = new S3AssetObjectStorage(config, {
      client,
      now: () => now,
      presign: (command, expiresIn) => {
        presigned.push({ command, expiresIn });
        return Promise.resolve("http://localhost:8333/derived/signed");
      },
    });
    await storage.signObjectAccess({
      bucket: "derived",
      contentDisposition: "inline",
      contentType: "image/png",
      expiresAt: new Date(now.getTime() + 300_000),
      key: "derived/content-addressed.png",
    });
    expect(presigned[0]?.expiresIn).toBe(300);
    expect(presigned[0]?.command).toBeInstanceOf(GetObjectCommand);
    await storage.readiness();
    expect(client.commands.filter((command) => command instanceof HeadBucketCommand)).toHaveLength(
      3,
    );
  });
});
