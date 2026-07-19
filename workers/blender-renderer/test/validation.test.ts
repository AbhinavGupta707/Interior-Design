import { describe, expect, it } from "vitest";

import { validateArtifactBytes, validateProtectedGlb } from "../src/index.js";

function png(width: number, height: number): Uint8Array {
  const bytes = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function exr(): Uint8Array {
  const bytes = Buffer.alloc(16);
  bytes.writeUInt32LE(20_000_630, 0);
  return bytes;
}

describe("C14 renderer artifact validation", () => {
  it("validates exact PNG dimensions and rejects corrupt magic", async () => {
    await expect(
      validateArtifactBytes({
        artifactId: "14000000-0000-4000-8000-000000000001",
        bytes: png(64, 64),
        expectedHeightPx: 64,
        expectedWidthPx: 64,
        exrInspector: {
          inspect: () =>
            Promise.resolve({ allFinite: true, channels: [], heightPx: 64, widthPx: 64 }),
        },
        role: "geometry-safe-png",
      }),
    ).resolves.toMatchObject({ mediaType: "image/png", role: "geometry-safe-png" });
    await expect(
      validateArtifactBytes({
        artifactId: "14000000-0000-4000-8000-000000000001",
        bytes: Buffer.from("not-png"),
        expectedHeightPx: 64,
        expectedWidthPx: 64,
        exrInspector: {
          inspect: () =>
            Promise.resolve({ allFinite: true, channels: [], heightPx: 64, widthPx: 64 }),
        },
        role: "geometry-safe-png",
      }),
    ).rejects.toMatchObject({ safeCode: "RENDER_PNG_INVALID" });
  });

  it("requires finite EXR pixels and every diagnostic channel", async () => {
    await expect(
      validateArtifactBytes({
        artifactId: "14000000-0000-4000-8000-000000000001",
        bytes: exr(),
        expectedHeightPx: 64,
        expectedWidthPx: 64,
        exrInspector: {
          inspect: () =>
            Promise.resolve({ allFinite: true, channels: ["Z"], heightPx: 64, widthPx: 64 }),
        },
        role: "depth-exr",
      }),
    ).resolves.toMatchObject({ mediaType: "image/x-exr", role: "depth-exr" });
    await expect(
      validateArtifactBytes({
        artifactId: "14000000-0000-4000-8000-000000000001",
        bytes: exr(),
        expectedHeightPx: 64,
        expectedWidthPx: 64,
        exrInspector: {
          inspect: () =>
            Promise.resolve({ allFinite: false, channels: ["Z"], heightPx: 64, widthPx: 64 }),
        },
        role: "depth-exr",
      }),
    ).rejects.toMatchObject({ safeCode: "RENDER_EXR_NON_FINITE" });
  });

  it("rejects external resources, scripts, object mismatches and forged C13 extras", () => {
    const manifest = {
      protectedElementIds: ["14000000-0000-4000-8000-000000000002"],
      source: {
        specification: {
          catalogReleaseId: "14000000-0000-4000-8000-000000000003",
          catalogReleaseSha256: "a".repeat(64),
          specificationId: "14000000-0000-4000-8000-000000000004",
          specificationRevision: 2,
          specificationRevisionSha256: "b".repeat(64),
        },
      },
    } as never;
    expect(() => {
      validateProtectedGlb({
        actualSha256: "c".repeat(64),
        expectedSha256: "c".repeat(64),
        inspection: {
          c13SpecificationBinding: {
            catalogReleaseId: "14000000-0000-4000-8000-000000000003",
            catalogReleaseSha256: "a".repeat(64),
            specificationId: "14000000-0000-4000-8000-000000000004",
            specificationRevision: 2,
            specificationRevisionSha256: "9".repeat(64),
          },
          containsDriversOrScripts: false,
          externalResourceCount: 0,
          objectBounds: [
            {
              elementId: "14000000-0000-4000-8000-000000000002",
              maximumMetres: [1, 1, 1],
              minimumMetres: [0, 0, 0],
            },
          ],
          objectIds: ["14000000-0000-4000-8000-000000000002"],
          unsafeExtensionNames: [],
        },
        manifest,
      });
    }).toThrow(expect.objectContaining({ safeCode: "RENDER_C13_BINDING_MISMATCH" }));
  });
});
