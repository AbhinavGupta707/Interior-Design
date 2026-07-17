import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const sourceRoot = path.resolve(
  process.cwd(),
  "services/inference-worker/src/inference_worker/reconstruction",
);

describe("C8 neural adapter static subprocess boundary", () => {
  it("uses fixed argv without shell helpers, network clients, canonical mutation or C5 calls", async () => {
    const sources = await Promise.all(
      [
        "nerfstudio/adapter.py",
        "nerfstudio/contracts.py",
        "nerfstudio/runtime.py",
        "gsplat/adapter.py",
      ].map((file) => readFile(path.join(sourceRoot, file), "utf8")),
    );
    const combined = sources.join("\n");
    for (const forbidden of [
      "shell=True",
      "os.system(",
      "subprocess.call(",
      "requests.",
      "urllib.request",
      "signedUrl",
      "objectKey",
      "canonicalModel",
      "model-operations",
      "/c5",
    ]) {
      expect(combined).not.toContain(forbidden);
    }
    expect(combined).toContain("shell=False");
    expect(combined).toContain('"dimensionalAuthority": "non-dimensional"');
    expect(combined).toContain("publication_fence");
  });
});
