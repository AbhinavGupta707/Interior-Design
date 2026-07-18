/// <reference types="node" />

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function buildInFreshProcess(environment: Readonly<Record<string, string>>): string {
  const child = fileURLToPath(new URL("./fresh-process-child.ts", import.meta.url));
  const spatialWorkerDirectory = fileURLToPath(
    new URL("../../../services/spatial-worker/", import.meta.url),
  );
  return execFileSync(process.execPath, ["--conditions=development", "--import", "tsx", child], {
    cwd: spatialWorkerDirectory,
    encoding: "utf8",
    env: { ...process.env, ...environment },
    timeout: 30_000,
  });
}

describe("fresh-process render-scene determinism", () => {
  it("is byte-identical across locale and timezone changes", () => {
    const london = buildInFreshProcess({ LANG: "en_GB.UTF-8", TZ: "Europe/London" });
    const tokyo = buildInFreshProcess({ LANG: "ja_JP.UTF-8", TZ: "Asia/Tokyo" });
    expect(tokyo).toBe(london);
    const parsed: unknown = JSON.parse(london);
    expect(parsed).toMatchObject({
      envelope: {
        manifestSchemaVersion: "c14-render-scene-manifest-v1",
        schemaVersion: "c14-render-scene-external-sha256-v1",
      },
    });
    const sha256 = (parsed as { envelope: { sha256: unknown } }).envelope.sha256;
    expect(typeof sha256).toBe("string");
    expect(sha256).toMatch(/^[a-f0-9]{64}$/u);
  });
});
