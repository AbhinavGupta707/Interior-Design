import { describe, expect, it } from "vitest";

import {
  inspectExrHeader,
  inspectPngHeader,
  inspectRenderArtifact,
  RenderEvaluationError,
} from "../src/index.js";
import { artifactFor, minimalExr, solidPng } from "./fixtures.js";

describe("independent C14 artifact inspection", () => {
  it("verifies PNG signature, immutable metadata, SHA-256, dimensions, and full Sharp decode", async () => {
    const bytes = await solidPng({ b: 40, g: 80, r: 120 });
    const artifact = artifactFor(bytes, "geometry-safe-png");
    const result = await inspectRenderArtifact(bytes, artifact);

    expect(result).toMatchObject({
      byteLength: bytes.byteLength,
      format: "png",
      heightPx: 64,
      role: "geometry-safe-png",
      validationScope: "sharp-decoded-pixels-and-container",
      widthPx: 64,
    });
    expect(inspectPngHeader(bytes)).toMatchObject({ bitDepth: 8, heightPx: 64, widthPx: 64 });
  });

  it("inspects only bounded EXR container metadata and states that scope", async () => {
    const bytes = minimalExr({ channels: ["Combined.R", "Depth.Z"], height: 96, width: 128 });
    const artifact = artifactFor(bytes, "multilayer-exr", 128, 96);
    const result = await inspectRenderArtifact(bytes, artifact);

    expect(result.validationScope).toBe("container-header-only-no-pixel-validation");
    expect(inspectExrHeader(bytes)).toMatchObject({ heightPx: 96, widthPx: 128 });
    expect(inspectExrHeader(bytes).channels.map(({ name }) => name)).toEqual([
      "Combined.R",
      "Depth.Z",
    ]);
  });

  it("fails closed on hash, byte, dimension, media, signature, and resource attacks", async () => {
    const bytes = await solidPng({ b: 30, g: 20, r: 10 });
    const artifact = artifactFor(bytes, "geometry-safe-png");
    const mutated = Uint8Array.from(bytes);
    mutated[mutated.length - 1] = (mutated.at(-1) ?? 0) ^ 1;
    await expect(inspectRenderArtifact(mutated, artifact)).rejects.toMatchObject({
      code: "HASH_MISMATCH",
    });
    await expect(
      inspectRenderArtifact(bytes, { ...artifact, byteLength: bytes.byteLength + 1 }),
    ).rejects.toMatchObject({ code: "BYTE_LENGTH_MISMATCH" });
    await expect(inspectRenderArtifact(bytes, { ...artifact, heightPx: 65 })).rejects.toMatchObject(
      { code: "DIMENSION_MISMATCH" },
    );
    await expect(
      inspectRenderArtifact(bytes, { ...artifact, mediaType: "image/x-exr" }),
    ).rejects.toMatchObject({ code: "MEDIA_TYPE_MISMATCH" });
    expect(() => inspectPngHeader(new Uint8Array(33))).toThrow(/signature/iu);
    await expect(
      inspectRenderArtifact(bytes, artifact, { limits: { maximumBytes: 8 } }),
    ).rejects.toBeInstanceOf(RenderEvaluationError);
  });

  it("rejects oversized PNG/EXR shapes before pixel allocation", () => {
    const png = new Uint8Array(33);
    png.set([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(png.buffer);
    view.setUint32(8, 13, false);
    png.set(Buffer.from("IHDR"), 12);
    view.setUint32(16, 100_000, false);
    view.setUint32(20, 100_000, false);
    png[24] = 8;
    png[25] = 6;
    expect(() => inspectPngHeader(png)).toThrow(/pixel budget/iu);

    const exr = minimalExr({ height: 4_096, width: 4_096 });
    expect(() => inspectExrHeader(exr, { maximumPixels: 1_000 })).toThrow(/pixel budget/iu);
  });
});
