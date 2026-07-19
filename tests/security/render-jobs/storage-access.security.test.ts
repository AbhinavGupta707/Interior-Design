import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  InMemoryRenderObjectStorage,
  S3RenderObjectStorage,
  type OpaqueRenderAccessSigner,
} from "../../../services/platform-api/src/modules/render-stills/storage.js";

describe("C14 opaque exact artifact access", () => {
  it("binds role/hash/type/size/result without exposing the object key", async () => {
    const now = new Date("2026-07-19T00:00:00.000Z");
    const storage = new InMemoryRenderObjectStorage({ now: () => now });
    const bytes = Buffer.from("geometry-safe-fixture");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const { objectKey } = await storage.putImmutable({
      bytes,
      mediaType: "image/png",
      role: "geometry-safe-png",
      sha256,
    });
    const access = await storage.signExactAccess({
      artifact: {
        byteLength: bytes.byteLength,
        heightPx: 64,
        id: "14000000-0000-4000-8000-000000000001",
        mediaType: "image/png",
        role: "geometry-safe-png",
        schemaVersion: "c14-render-artifact-v1",
        sha256,
        widthPx: 64,
      },
      expiresAt: new Date(now.getTime() + 300_000),
      manifestSha256: "a".repeat(64),
      objectKey,
      resultId: "14000000-0000-4000-8000-000000000002",
    });
    expect(access.url).not.toContain(objectKey);
    expect(access.url).not.toContain(sha256);
    expect(access.url).not.toContain("geometry-safe-png");
    expect(access.expiresAt).toBe("2026-07-19T00:05:00.000Z");
  });

  it("rejects a changed byte stream under the same claimed hash", async () => {
    const storage = new InMemoryRenderObjectStorage();
    await expect(
      storage.putImmutable({
        bytes: Buffer.from("corrupt"),
        mediaType: "image/png",
        role: "geometry-safe-png",
        sha256: "a".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "RENDER_STORAGE_UNAVAILABLE" });
  });

  it("passes the complete exact result/artifact claim to the opaque gateway signer", async () => {
    let signed: Parameters<OpaqueRenderAccessSigner["sign"]>[0] | undefined;
    const signer: OpaqueRenderAccessSigner = {
      sign: (input) => {
        signed = input;
        return Promise.resolve({
          expiresAt: input.expiresAt.toISOString(),
          url: "https://render-access.example.test/opaque-token",
        });
      },
    };
    const storage = new S3RenderObjectStorage(
      {
        accessKeyId: "fixture-access",
        endpoint: "https://objects.example.test",
        forcePathStyle: false,
        region: "fixture",
        secretAccessKey: "fixture-secret",
      },
      signer,
      { client: { send: () => Promise.reject(new Error("Object client must not be used.")) } },
    );
    const expiresAt = new Date("2026-07-19T00:05:00.000Z");
    await storage.signExactAccess({
      artifact: {
        byteLength: 1234,
        heightPx: 64,
        id: "14000000-0000-4000-8000-000000000001",
        mediaType: "image/png",
        role: "geometry-safe-png",
        schemaVersion: "c14-render-artifact-v1",
        sha256: "a".repeat(64),
        widthPx: 64,
      },
      expiresAt,
      manifestSha256: "b".repeat(64),
      objectKey: `render-stills/sha256/aa/${"a".repeat(64)}.png`,
      resultId: "14000000-0000-4000-8000-000000000002",
    });
    expect(signed).toEqual({
      artifactId: "14000000-0000-4000-8000-000000000001",
      byteLength: 1234,
      expiresAt,
      manifestSha256: "b".repeat(64),
      mediaType: "image/png",
      objectKey: `render-stills/sha256/aa/${"a".repeat(64)}.png`,
      resultId: "14000000-0000-4000-8000-000000000002",
      role: "geometry-safe-png",
      sha256: "a".repeat(64),
    });
  });
});
