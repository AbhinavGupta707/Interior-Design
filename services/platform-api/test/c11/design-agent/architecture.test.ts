import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

async function sourceText(directory: string): Promise<string> {
  const files = (await readdir(directory)).filter((name) => name.endsWith(".ts")).sort();
  return (
    await Promise.all(files.map((file) => readFile(path.join(directory, file), "utf8")))
  ).join("\n");
}

describe("C11 zero-direct-mutation and bounded capability architecture", () => {
  it("keeps orchestration away from SQL/canonical mutation and leaves confirmation to L1", async () => {
    const testDirectory = path.dirname(fileURLToPath(import.meta.url));
    const moduleDirectory = path.resolve(testDirectory, "../../../src/modules/design-agent");
    const service = await readFile(path.join(moduleDirectory, "service.ts"), "utf8");
    const postgres = await readFile(path.join(moduleDirectory, "postgres.ts"), "utf8");
    expect(service).not.toMatch(/from\s+["'][^"']*postgres|\b(?:INSERT|UPDATE|DELETE)\b/iu);
    expect(service).not.toMatch(/models\/core|model-operations|model_operations/iu);
    expect(service).toContain("BriefCommandPort");
    expect(service).toContain("DesignAgentRepository");
    expect(postgres).not.toMatch(/models\/core|model-operations|model_operations/iu);
    expect(postgres).not.toMatch(/(?:INSERT\s+INTO|UPDATE)\s+design_brief_revisions/iu);
    expect(postgres).not.toMatch(/(?:INSERT\s+INTO|UPDATE)\s+design_briefs\b/iu);
    expect(postgres).not.toContain("confirmProposalAtomically");
  });

  it("keeps the model gateway free of generic network, filesystem and database clients", async () => {
    const testDirectory = path.dirname(fileURLToPath(import.meta.url));
    const gatewayDirectory = path.resolve(
      testDirectory,
      "../../../../../packages/model-gateway/src",
    );
    const source = await sourceText(gatewayDirectory);
    expect(source).not.toMatch(/from\s+["']node:(?:fs|http|https|net|tls)/u);
    expect(source).not.toMatch(/\bfetch\s*\(/u);
    expect(source).not.toMatch(/from\s+["'](?:postgres|pg|@aws-sdk)/u);
    expect(source).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM|[a-z_]+)/u);
  });
});
