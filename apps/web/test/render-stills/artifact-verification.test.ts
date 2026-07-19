import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { renderArtifactAccessSchema, renderArtifactSchema } from "@interior-design/contracts";

import {
  ArtifactVerificationError,
  fetchVerifiedArtifact,
  safeArtifactUrl,
  verifyArtifactAccess,
} from "../../src/features/render-stills/artifact-verification";
import { ids } from "./fixtures";

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13, false);
  bytes.set(new TextEncoder().encode("IHDR"), 12);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  bytes[24] = 8;
  bytes[25] = 6;
  return bytes;
}

describe("C14 browser artifact verification", () => {
  it("verifies access, type, bytes, SHA-256, signature and dimensions before returning bytes", async () => {
    const bytes = pngHeader(96, 64);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const artifact = renderArtifactSchema.parse({
      byteLength: bytes.byteLength,
      heightPx: 64,
      id: ids.artifactSafe,
      mediaType: "image/png",
      role: "geometry-safe-png",
      schemaVersion: "c14-render-artifact-v1",
      sha256,
      widthPx: 96,
    });
    const access = renderArtifactAccessSchema.parse({
      artifactId: artifact.id,
      byteLength: artifact.byteLength,
      expiresAt: "2027-07-19T12:00:00.000Z",
      manifestSha256: "f".repeat(64),
      mediaType: artifact.mediaType,
      role: artifact.role,
      sha256: artifact.sha256,
      url: "http://127.0.0.1:4353/signed/safe?signature=short-lived",
    });
    const transport = vi.fn().mockResolvedValue(
      new Response(Uint8Array.from(bytes).buffer, {
        headers: {
          "content-length": String(bytes.byteLength),
          "content-type": "image/png",
        },
      }),
    );
    await expect(
      fetchVerifiedArtifact(access, artifact, access.manifestSha256, transport),
    ).resolves.toMatchObject({ format: "png", heightPx: 64, widthPx: 96 });
  });

  it("fails closed on unsafe, expired, mismatched and tampered access", async () => {
    expect(() => safeArtifactUrl("http://example.com/private")).toThrow(ArtifactVerificationError);
    expect(() => safeArtifactUrl("https://user:secret@example.com/private")).toThrow(
      ArtifactVerificationError,
    );
    const bytes = pngHeader(96, 64);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const artifact = renderArtifactSchema.parse({
      byteLength: bytes.byteLength,
      heightPx: 64,
      id: ids.artifactSafe,
      mediaType: "image/png",
      role: "geometry-safe-png",
      schemaVersion: "c14-render-artifact-v1",
      sha256,
      widthPx: 96,
    });
    const expired = renderArtifactAccessSchema.parse({
      artifactId: artifact.id,
      byteLength: artifact.byteLength,
      expiresAt: "2020-01-01T00:00:00.000Z",
      manifestSha256: "f".repeat(64),
      mediaType: artifact.mediaType,
      role: artifact.role,
      sha256: artifact.sha256,
      url: "https://example.com/signed",
    });
    expect(() => verifyArtifactAccess(expired, artifact, expired.manifestSha256)).toThrow(
      expect.objectContaining({ kind: "expired" }),
    );
    const current = { ...expired, expiresAt: "2027-07-19T12:00:00.000Z" };
    await expect(
      fetchVerifiedArtifact(
        current,
        artifact,
        current.manifestSha256,
        vi.fn().mockResolvedValue(
          new Response(
            Uint8Array.from(bytes, (value, index) => value ^ (index === 32 ? 1 : 0)).buffer,
            {
              headers: {
                "content-length": String(bytes.byteLength),
                "content-type": "image/png",
              },
            },
          ),
        ),
      ),
    ).rejects.toMatchObject({ kind: "tampered" });
  });
});
