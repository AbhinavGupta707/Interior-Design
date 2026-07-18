/// <reference types="node" />

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function compileInFreshProcess(): string {
  const child = fileURLToPath(new URL("./fresh-process-child.ts", import.meta.url));
  const spatialWorkerDirectory = fileURLToPath(
    new URL("../../../services/spatial-worker/", import.meta.url),
  );
  return execFileSync(process.execPath, ["--conditions=development", "--import", "tsx", child], {
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
        byteSize: 29_456,
        glbSha256: "730e0b6b20d1a5438d17b15a592d4fda52b8d15c41fd76e5b54411f98f817a7a",
      },
    });
  });
});
