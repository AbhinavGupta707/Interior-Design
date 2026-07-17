import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const forbiddenMarkers = [
  "@interior-design/test-fixtures/fusion",
  "fusionAcceptanceFixtures",
  "fusionAdversarialFixtures",
  "test-fixtures/src/fusion",
] as const;

describe("C9 fixture producer isolation", () => {
  it("does not allow a production producer to import or identify the C9 acceptance fixtures", async () => {
    const repositoryRoot = path.resolve(__dirname, "../../..");
    const roots = ["apps", "services", "workers", "packages"];
    const findings: string[] = [];
    for (const root of roots) {
      await scan(path.join(repositoryRoot, root), repositoryRoot, findings);
    }
    expect(findings).toEqual([]);
  });
});

async function scan(directory: string, repositoryRoot: string, findings: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error: unknown) {
    if (isMissing(error)) return;
    throw error;
  }
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(repositoryRoot, absolute);
    if (
      entry.isDirectory() &&
      (entry.name === "dist" ||
        entry.name === "node_modules" ||
        relative === "packages/test-fixtures")
    ) {
      continue;
    }
    if (entry.isDirectory()) {
      await scan(absolute, repositoryRoot, findings);
      continue;
    }
    if (!/\.(?:mjs|py|swift|ts|tsx)$/u.test(entry.name)) continue;
    const source = await readFile(absolute, "utf8");
    for (const marker of forbiddenMarkers) {
      if (source.includes(marker)) findings.push(`${relative}:${marker}`);
    }
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}
