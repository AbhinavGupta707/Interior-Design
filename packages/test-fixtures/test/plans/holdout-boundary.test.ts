import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const producerRoots = [
  "packages/provider-adapters/src",
  "services/inference-worker",
  "services/platform-api/src",
  "services/spatial-worker/src",
];
const holdoutImportPattern =
  /test-fixtures(?:\/src)?\/plans\/holdout|plans\/holdout\/catalog|holdout(?:InBox|HardNegative|Adversarial|Plan)Fixtures/u;

describe("C6 holdout import boundary", () => {
  it("does not export holdout plans from the fixture package", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { readonly exports?: Record<string, unknown> };
    expect(Object.keys(packageJson.exports ?? {})).not.toContain("./plans/holdout");

    const planIndex = await readFile(new URL("../../src/plans/index.ts", import.meta.url), "utf8");
    expect(planIndex).not.toMatch(/export \* from ["'].+holdout/u);
  });

  it("is not imported by any parser, workflow or worker producer source", async () => {
    const violations: string[] = [];
    for (const relativeRoot of producerRoots) {
      for (const file of await sourceFiles(`${repositoryRoot}${relativeRoot}`)) {
        const source = await readFile(file, "utf8");
        if (holdoutImportPattern.test(source)) violations.push(file.replace(repositoryRoot, ""));
      }
    }
    expect(violations).toEqual([]);
  });
});

async function sourceFiles(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (["dist", "node_modules", "test", "tests"].includes(entry.name)) continue;
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    if (entry.isFile() && /\.(?:mjs|py|ts|tsx)$/u.test(entry.name)) files.push(path);
  }
  return files;
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
