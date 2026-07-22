import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { S3ExactSceneGlbReader } from "../../../src/modules/render-stills/index.js";

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
