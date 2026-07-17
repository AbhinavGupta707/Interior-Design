import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { assertNoPublicLocator } from "./reference-boundary.js";

const root = process.cwd();

describe("C10 public manifest and signed-access redaction", () => {
  it("rejects locator-shaped public manifest keys at every depth", () => {
    expect(() =>
      assertNoPublicLocator({
        compiler: { version: "1.0.0" },
        sourceSnapshot: { snapshotSha256: "a".repeat(64) },
      }),
    ).not.toThrow();
    for (const attacked of [
      { objectKey: "derived/tenant/scene.glb" },
      { artifact: { filesystemPath: "/tmp/scene.glb" } },
      { leaseToken: "secret" },
      { signedUrl: "https://storage.invalid/scene" },
      { source: { externalUri: "file:///etc/passwd" } },
    ]) {
      expect(() => assertNoPublicLocator(attacked)).toThrow("SCENE_PUBLIC_LOCATOR");
    }
  });

  it("keeps the C10 BFF free of logging, persistence and browser storage sinks", () => {
    const files = [
      "apps/web/src/app/api/c10/_shared/scene-proxy.ts",
      "apps/web/src/app/api/c10/[...segments]/route.ts",
      "apps/web/src/features/viewer-3d/api.ts",
    ];
    const source = files.map((file) => readFileSync(path.join(root, file), "utf8")).join("\n");
    expect(source).not.toMatch(
      /console\.|localStorage|sessionStorage|indexedDB|writeFile|appendFile/gu,
    );
    expect(source).not.toMatch(/NextResponse\.json\([^)]*(?:accessToken|authorization)/gu);
  });
});
