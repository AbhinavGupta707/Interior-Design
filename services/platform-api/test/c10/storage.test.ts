import { GetObjectCommand, HeadBucketCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  InMemorySceneObjectStorage,
  S3SceneObjectStorage,
} from "../../src/modules/scenes/storage.js";
import { validGlb } from "./support.js";

const now = new Date("2026-07-17T20:00:00.000Z");
const liveStorageEndpoint = process.env.C10_TEST_STORAGE_ENDPOINT;
const itWithLiveStorage = liveStorageEndpoint === undefined ? it.skip : it;

describe("C10 narrow scene object storage", () => {
  it("content-addresses immutable bytes without accepting or returning a locator", async () => {
    const storage = new InMemorySceneObjectStorage({ now: () => now });
    const bytes = validGlb();
    const hash = createHash("sha256").update(bytes).digest("hex");
    await storage.putImmutable({
      byteSize: bytes.byteLength,
      bytes,
      glbSha256: hash,
      mimeType: "model/gltf-binary",
    });
    await storage.putImmutable({
      byteSize: bytes.byteLength,
      bytes,
      glbSha256: hash,
      mimeType: "model/gltf-binary",
    });
    await expect(
      storage.putImmutable({
        byteSize: bytes.byteLength,
        bytes,
        glbSha256: "f".repeat(64),
        mimeType: "model/gltf-binary",
      }),
    ).rejects.toThrow("object-storage operation failed");
    const signed = await storage.signAccess({
      expiresAt: new Date(now.getTime() + 300_000),
      glbSha256: hash,
      mimeType: "model/gltf-binary",
    });
    expect(signed).toEqual({
      expiresAt: "2026-07-17T20:05:00.000Z",
      url: `http://127.0.0.1:43110/scene-artifacts/${hash}`,
    });
    expect(JSON.stringify(signed)).not.toMatch(/bucket|objectKey|credential|provider/u);
  });

  it("derives the private S3 key internally, binds checksum metadata, and signs only reads", async () => {
    const commands: object[] = [];
    const client = {
      send(command: object) {
        commands.push(command);
        return Promise.resolve({});
      },
    };
    const storage = new S3SceneObjectStorage(
      {
        accessKeyId: "localdev",
        endpoint: "http://127.0.0.1:8333",
        forcePathStyle: true,
        region: "local",
        secretAccessKey: "local-development-only",
      },
      {
        client,
        now: () => now,
        presign: (command) => {
          commands.push(command);
          return Promise.resolve("https://assets.example.test/signed-scene");
        },
      },
    );
    const bytes = validGlb();
    const hash = createHash("sha256").update(bytes).digest("hex");
    await storage.putImmutable({
      byteSize: bytes.byteLength,
      bytes,
      glbSha256: hash,
      mimeType: "model/gltf-binary",
    });
    await storage.readiness();
    const signed = await storage.signAccess({
      expiresAt: new Date(now.getTime() + 60_000),
      glbSha256: hash,
      mimeType: "model/gltf-binary",
    });
    expect(commands[0]).toBeInstanceOf(PutObjectCommand);
    expect(commands[1]).toBeInstanceOf(HeadBucketCommand);
    expect(commands[2]).toBeInstanceOf(GetObjectCommand);
    expect(signed.url).toBe("https://assets.example.test/signed-scene");
    const putInput = (commands[0] as PutObjectCommand).input;
    expect(putInput).toMatchObject({
      Bucket: "derived",
      ChecksumAlgorithm: "SHA256",
      ContentLength: bytes.byteLength,
      ContentType: "model/gltf-binary",
      IfNoneMatch: "*",
      Metadata: { sha256: hash },
    });
    expect(putInput.Key).toContain(hash);
    expect(JSON.stringify(signed)).not.toContain(String(putInput.Key));
  });

  itWithLiveStorage(
    "round-trips one checksum-bound immutable GLB through disposable S3-compatible storage",
    async () => {
      const storage = new S3SceneObjectStorage({
        accessKeyId: process.env.C10_TEST_STORAGE_ACCESS_KEY_ID ?? "localdev",
        endpoint: liveStorageEndpoint as string,
        forcePathStyle: true,
        region: process.env.C10_TEST_STORAGE_REGION ?? "local",
        secretAccessKey: process.env.C10_TEST_STORAGE_SECRET_ACCESS_KEY ?? "local-development-only",
      });
      const bytes = validGlb();
      const glbSha256 = createHash("sha256").update(bytes).digest("hex");
      const input = {
        byteSize: bytes.byteLength,
        bytes,
        glbSha256,
        mimeType: "model/gltf-binary" as const,
      };
      await storage.readiness();
      await storage.putImmutable(input);
      await storage.putImmutable(input);
      const signed = await storage.signAccess({
        expiresAt: new Date(Date.now() + 60_000),
        glbSha256,
        mimeType: input.mimeType,
      });
      expect(signed.url).toMatch(/^https?:\/\//u);
      expect(JSON.stringify(signed)).not.toMatch(
        /credential|secretAccessKey|objectKey|providerId/u,
      );
    },
  );
});
