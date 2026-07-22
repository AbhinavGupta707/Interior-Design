import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  EncryptedRenderArtifactBroker,
  S3ExactSceneGlbReader,
} from "../../../src/modules/render-stills/index.js";

const storage = {
  accessKeyId: "fixture-access",
  endpoint: "http://127.0.0.1:8333",
  forcePathStyle: true,
  region: "local",
  secretAccessKey: "fixture-secret",
};

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function* chunks(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes.subarray(0, 7);
  await Promise.resolve();
  yield bytes.subarray(7);
}

describe("C14 exact C10 GLB reader", () => {
  it("derives the internal object identity and verifies bounded exact bytes", async () => {
    const bytes = Buffer.from("C14 protected GLB fixture bytes");
    const reader = new S3ExactSceneGlbReader(storage, {
      client: {
        send: () => Promise.resolve({ Body: chunks(bytes), ContentLength: bytes.byteLength }),
      },
    });
    await expect(reader.read({ byteSize: bytes.byteLength, glbSha256: digest(bytes) })).resolves.toEqual(
      bytes,
    );
  });

  it("fails closed when object metadata or streamed bytes diverge from C10 authority", async () => {
    const bytes = Buffer.from("C14 protected GLB fixture bytes");
    const reader = new S3ExactSceneGlbReader(storage, {
      client: {
        send: () =>
          Promise.resolve({ Body: chunks(Buffer.from("forged protected GLB bytes")), ContentLength: bytes.byteLength }),
      },
    });
    await expect(reader.read({ byteSize: bytes.byteLength, glbSha256: digest(bytes) })).rejects.toThrow(
      "C10 GLB",
    );
  });
});

describe("C14 opaque render-artifact access", () => {
  it("encrypts the object key and serves only a byte-exact, unexpired artifact", async () => {
    const now = new Date("2026-07-22T01:00:00.000Z");
    const bytes = Buffer.from("C14 immutable safe artifact");
    const broker = new EncryptedRenderArtifactBroker({
      baseUrl: "http://127.0.0.1:43110",
      client: {
        send: () =>
          Promise.resolve({
            Body: chunks(bytes),
            ContentLength: bytes.byteLength,
            ContentType: "image/png",
            Metadata: { sha256: digest(bytes) },
          }),
      },
      key: Buffer.alloc(32, 7),
      now: () => now,
    });
    const signed = await broker.sign({
      artifactId: "14000000-0000-4000-8000-000000000001",
      byteLength: bytes.byteLength,
      expiresAt: new Date(now.getTime() + 60_000),
      manifestSha256: "a".repeat(64),
      mediaType: "image/png",
      objectKey: `render-stills/sha256/${digest(bytes).slice(0, 2)}/${digest(bytes)}.png`,
      resultId: "14000000-0000-4000-8000-000000000002",
      role: "geometry-safe-png",
      sha256: digest(bytes),
    });
    expect(signed.url).not.toContain("render-stills/");
    const token = new URL(signed.url).pathname.split("/").at(-1);
    if (token === undefined) throw new Error("Fixture access token is missing.");
    await expect(broker.open(token)).resolves.toEqual({ bytes, mediaType: "image/png" });
  });
});
