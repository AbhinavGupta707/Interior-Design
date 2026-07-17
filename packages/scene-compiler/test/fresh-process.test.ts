/// <reference types="node" />

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function compileInFreshProcess(): string {
  const child = fileURLToPath(new URL("./fresh-process-child.ts", import.meta.url));
  const spatialWorkerDirectory = fileURLToPath(
    new URL("../../../services/spatial-worker/", import.meta.url),
  );
  return execFileSync(process.execPath, ["--import", "tsx", child], {
    cwd: spatialWorkerDirectory,
    encoding: "utf8",
    timeout: 30_000,
  });
}

describe("fresh-process determinism", () => {
  it("produces byte-identical GLB and manifest outputs", () => {
    const first = compileInFreshProcess();
    const second = compileInFreshProcess();
    expect(second).toBe(first);
    expect(JSON.parse(first)).toMatchObject({
      artifact: {
        byteSize: 28_816,
        glbSha256: "ed323d5eadb5c26e901cbbf719a96b571dca816e4f3ed3233f9f0b3c48a97392",
      },
    });
  });
});
