import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  compareProtectedImageGeometry,
  inspectSegmentationPng,
  RenderEvaluationError,
} from "../src/index.js";
import { solidPng } from "./fixtures.js";

async function composite(
  background: Uint8Array,
  overlay: {
    readonly colour: { readonly b: number; readonly g: number; readonly r: number };
    readonly left: number;
    readonly top: number;
  },
): Promise<Uint8Array> {
  const square = await sharp({
    create: {
      background: { ...overlay.colour, alpha: 1 },
      channels: 4,
      height: 16,
      width: 16,
    },
  })
    .png()
    .toBuffer();
  return sharp(background)
    .composite([{ input: square, left: overlay.left, top: overlay.top }])
    .png({ adaptiveFiltering: false })
    .toBuffer();
}

describe("independent C14 segmentation, edge, and edit-mask guards", () => {
  it("accepts an unchanged protected image and exact segmentation palette", async () => {
    const base = await composite(await solidPng({ b: 20, g: 20, r: 20 }), {
      colour: { b: 220, g: 220, r: 220 },
      left: 24,
      top: 24,
    });
    const segmentation = await composite(await solidPng({ b: 0, g: 0, r: 0 }), {
      colour: { b: 3, g: 2, r: 1 },
      left: 24,
      top: 24,
    });
    const mask = await solidPng({ b: 0, g: 0, r: 0 });
    const report = await compareProtectedImageGeometry({
      allowedEditMaskPng: mask,
      basePng: base,
      baseSegmentationPng: segmentation,
      candidatePng: base,
      candidateSegmentationPng: segmentation,
    });
    expect(report).toMatchObject({
      changedOutsideAllowedMaskPixels: 0,
      changedPixelCount: 0,
      protectedEdgeAgreementBasisPoints: 10_000,
      segmentationIoUBasisPoints: 10_000,
      validationScope: "bounded-png-pixel-comparison-no-camera-or-blender-validation",
    });
    await expect(inspectSegmentationPng(segmentation, [[1, 2, 3]])).resolves.toMatchObject({
      missingPaletteColours: [],
      unexpectedColours: [],
    });
  });

  it("detects edits outside the allowed mask and segmentation label displacement", async () => {
    const base = await composite(await solidPng({ b: 20, g: 20, r: 20 }), {
      colour: { b: 220, g: 220, r: 220 },
      left: 24,
      top: 24,
    });
    const candidate = await composite(base, {
      colour: { b: 0, g: 0, r: 240 },
      left: 0,
      top: 0,
    });
    const segmentation = await composite(await solidPng({ b: 0, g: 0, r: 0 }), {
      colour: { b: 3, g: 2, r: 1 },
      left: 24,
      top: 24,
    });
    const movedSegmentation = await composite(await solidPng({ b: 0, g: 0, r: 0 }), {
      colour: { b: 3, g: 2, r: 1 },
      left: 16,
      top: 24,
    });
    const mask = await solidPng({ b: 0, g: 0, r: 0 });
    const report = await compareProtectedImageGeometry({
      allowedEditMaskPng: mask,
      basePng: base,
      baseSegmentationPng: segmentation,
      candidatePng: candidate,
      candidateSegmentationPng: movedSegmentation,
    });
    expect(report.changedOutsideAllowedMaskPixels).toBeGreaterThan(0);
    expect(report.segmentationIoUBasisPoints).toBeLessThan(9_800);
  });

  it("reports hostile palette colours and missing expected members without interpreting semantics", async () => {
    const segmentation = await solidPng({ b: 9, g: 8, r: 7 });
    const report = await inspectSegmentationPng(segmentation, [
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(report.unexpectedColours).toEqual(["7,8,9"]);
    expect(report.missingPaletteColours).toEqual(["1,2,3", "4,5,6"]);
  });

  it("fails closed on corrupt, mismatched-shape, and aggregate resource attacks", async () => {
    await expect(inspectSegmentationPng(new Uint8Array(33), [[1, 2, 3]])).rejects.toMatchObject({
      code: "INVALID_PNG",
    });
    const base = await solidPng({ b: 20, g: 20, r: 20 });
    const narrow = await solidPng({ b: 20, g: 20, r: 20 }, 32, 64);
    await expect(
      compareProtectedImageGeometry({
        allowedEditMaskPng: base,
        basePng: base,
        baseSegmentationPng: base,
        candidatePng: narrow,
        candidateSegmentationPng: base,
      }),
    ).rejects.toMatchObject({ code: "DIMENSION_MISMATCH" });
    await expect(
      compareProtectedImageGeometry({
        allowedEditMaskPng: base,
        basePng: base,
        baseSegmentationPng: base,
        candidatePng: base,
        candidateSegmentationPng: base,
        limits: { maximumBytes: base.byteLength * 4 },
      }),
    ).rejects.toBeInstanceOf(RenderEvaluationError);
    await expect(
      compareProtectedImageGeometry({
        allowedEditMaskPng: base,
        basePng: base,
        baseSegmentationPng: base,
        candidatePng: base,
        candidateSegmentationPng: base,
        limits: { maximumPixels: 64 * 64 * 4 },
      }),
    ).rejects.toMatchObject({ code: "RESOURCE_LIMIT_EXCEEDED" });
  });
});
