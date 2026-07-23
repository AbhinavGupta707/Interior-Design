import type { S3Client } from "@aws-sdk/client-s3";
import type { CatalogRelease } from "@interior-design/contracts";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { S3ExactCatalogManifestReader } from "../../src/render-stills/composition.js";

async function* chunks(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  await Promise.resolve();
  const split = Math.max(1, Math.floor(bytes.byteLength / 2));
  yield bytes.subarray(0, split);
  if (split < bytes.byteLength) yield bytes.subarray(split);
}

function release(bytes: Uint8Array): CatalogRelease {
  return {
    manifestSha256: createHash("sha256").update(bytes).digest("hex"),
  } as CatalogRelease;
}

describe("C14 catalog manifest boundary", () => {
  it("accepts only the exact bounded content-addressed C13 manifest bytes", async () => {
    const bytes = Buffer.from("{}", "utf8");
    const client = {
      send: vi.fn(() =>
        Promise.resolve({
          Body: chunks(bytes),
          ContentLength: bytes.byteLength,
          ContentType: "application/json",
        }),
      ),
    } as unknown as Pick<S3Client, "send">;
    await expect(new S3ExactCatalogManifestReader(client).read(release(bytes))).resolves.toEqual(
      bytes,
    );
  });

  it("rejects a manifest whose immutable content hash differs from its C13 release", async () => {
    const bytes = Buffer.from("{}", "utf8");
    const client = {
      send: vi.fn(() =>
        Promise.resolve({
          Body: chunks(bytes),
          ContentLength: bytes.byteLength,
          ContentType: "application/json",
        }),
      ),
    } as unknown as Pick<S3Client, "send">;
    await expect(
      new S3ExactCatalogManifestReader(client).read({
        manifestSha256: "f".repeat(64),
      } as CatalogRelease),
    ).rejects.toMatchObject({ code: "RENDER_CATALOG_MANIFEST_INVALID" });
  });
});
