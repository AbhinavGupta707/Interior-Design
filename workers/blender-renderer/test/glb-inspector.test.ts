import { describe, expect, it } from "vitest";

import { C10ProtectedGlbInspector } from "../src/index.js";

describe("C14 protected C10 GLB inspection", () => {
  it("fails closed before Blender can import a corrupted protected GLB", async () => {
    await expect(
      new C10ProtectedGlbInspector().inspect(Buffer.from("unsafe")),
    ).rejects.toMatchObject({
      safeCode: "RENDER_GLB_UNSAFE",
    });
  });
});
