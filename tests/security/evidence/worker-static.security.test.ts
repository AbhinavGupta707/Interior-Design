import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const enabled = process.env.C2_ADVERSARIAL_STATIC_PRODUCTION === "1";
const suiteName = enabled
  ? "merged C2 worker subprocess source audit"
  : "merged C2 worker subprocess source audit (set C2_ADVERSARIAL_STATIC_PRODUCTION=1 after C2-L2 merges)";

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return sourceFiles(target);
      }
      return entry.isFile() && target.endsWith(".ts") ? [target] : [];
    }),
  );
  return nested.flat();
}

describe.skipIf(!enabled)(suiteName, () => {
  it("uses no shell execution or string-command APIs", async () => {
    const files = await sourceFiles(path.resolve("services/spatial-worker/src"));
    const source = (await Promise.all(files.map(async (file) => readFile(file, "utf8")))).join(
      "\n",
    );
    expect(source).not.toMatch(/\bexec(?:Sync)?\s*\(/u);
    expect(source).not.toMatch(/shell\s*:\s*true/u);
    expect(source).not.toMatch(/spawn(?:Sync)?\s*\(\s*["'](?:bash|cmd|powershell|sh)["']/u);
    expect(source).not.toMatch(/["']-c["']/u);
  });

  it("declares wall-time, output, and temporary-resource bounds near process execution", async () => {
    const files = await sourceFiles(path.resolve("services/spatial-worker/src"));
    const source = (await Promise.all(files.map(async (file) => readFile(file, "utf8")))).join(
      "\n",
    );
    expect(source).toMatch(/(?:AbortSignal|timeout|wallTime)/u);
    expect(source).toMatch(/(?:maxOutput|maxBuffer|outputLimit|stdoutLimit)/u);
    expect(source).toMatch(/(?:maxTemporary|maxTemp|temporaryDisk|tempDisk)/u);
  });
});
