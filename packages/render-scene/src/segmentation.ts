import type { RenderSceneManifest } from "@interior-design/contracts";

import { compareRenderStrings } from "./canonical.js";
import { failRenderScene } from "./errors.js";

const paletteCapacity = 255 * 256 * 256;

export function segmentationColourForIndex(index: number): readonly [number, number, number] {
  if (!Number.isSafeInteger(index) || index < 0 || index >= paletteCapacity) {
    return failRenderScene("PALETTE_EXHAUSTED");
  }
  return [Math.floor(index / 65_536) + 1, Math.floor(index / 256) % 256, index % 256];
}

export function segmentationPaletteForElementIds(
  elementIds: readonly string[],
): RenderSceneManifest["segmentationPalette"] {
  const sorted = [...elementIds].sort(compareRenderStrings);
  if (new Set(sorted).size !== sorted.length || sorted.length > paletteCapacity) {
    return failRenderScene("PALETTE_EXHAUSTED");
  }
  return sorted.map((elementId, index) => ({
    elementId,
    rgb8: [...segmentationColourForIndex(index)],
  }));
}
