import { describe, expect, it } from "vitest";

import { __test__ } from "../src/exr-inspector.js";

function output(channels: readonly string[]): string {
  return [
    "Blender 5.2.0 LTS",
    `C14_EXR_INSPECTION ${JSON.stringify({
      allFinite: true,
      channels,
      cryptomatteObjectNames: ["furnishing:fixture"],
      heightPx: 256,
      schemaVersion: "c14-exr-inspection-v1",
      widthPx: 256,
    })}`,
    "Blender quit",
  ].join("\n");
}

describe("C14 independently pinned EXR inspection", () => {
  it("normalises Blender 5.2 diagnostic channel spelling to the C14 contract", () => {
    expect(__test__.parseInspectionOutput(output(["depth.V"]), "depth-exr")).toMatchObject({
      actualChannels: ["depth.V"],
      channels: ["Z"],
      cryptomatteObjectNames: ["furnishing:fixture"],
      heightPx: 256,
      widthPx: 256,
    });
    expect(
      __test__.parseInspectionOutput(output(["normal.X", "normal.Y", "normal.Z"]), "normal-exr"),
    ).toMatchObject({ channels: ["Normal.X", "Normal.Y", "Normal.Z"] });
    expect(
      __test__.parseInspectionOutput(
        output(["Combined.R", "Combined.G", "Combined.B", "CryptoObject00.r", "CryptoObject00.g"]),
        "multilayer-exr",
      ),
    ).toMatchObject({
      channels: ["Combined.R", "Combined.G", "Combined.B", "CryptoObject00.R"],
    });
  });

  it("fails closed on ambiguous or malformed inspector output", () => {
    expect(() => __test__.parseInspectionOutput("not-json", "depth-exr")).toThrow(
      expect.objectContaining({ safeCode: "RENDER_EXR_INSPECTION_INVALID" }),
    );
    expect(() =>
      __test__.parseInspectionOutput(`${output(["depth.V"])}\n${output(["depth.V"])}`, "depth-exr"),
    ).toThrow(expect.objectContaining({ safeCode: "RENDER_EXR_INSPECTION_INVALID" }));
  });
});
