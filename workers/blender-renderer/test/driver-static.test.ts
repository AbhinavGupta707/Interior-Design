import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const driverPath = path.resolve(testDirectory, "../renderer/c14_render.py");

describe("C14 Blender driver static contract", () => {
  it("pins the Blender 5.2 compositor route for required diagnostic roles", async () => {
    const source = await readFile(driverPath, "utf8");

    expect(source).toContain('scene.render.engine = "BLENDER_EEVEE"');
    expect(source).toContain('multilayer.format.file_format = "OPEN_EXR_MULTILAYER"');
    expect(source).toContain('("RGBA", "Combined", "Image")');
    expect(source).toContain('("FLOAT", "Z", "Depth")');
    expect(source).toContain('("VECTOR", "Normal", "Normal")');
    expect(source).toContain('("RGBA", "CryptoObject00", "CryptoObject00")');
    expect(source).toContain('for role in ("multilayer", "depth", "normal")');
  });
});
