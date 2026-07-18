import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(paths: readonly string[]): string {
  return paths.map((path) => readFileSync(resolve(root, path), "utf8")).join("\n");
}

describe("C13 catalog static security boundary", () => {
  it("exposes read-only catalog routes with no upload, archive, scrape or arbitrary URL surface", () => {
    const routes = read(["services/platform-api/src/modules/catalog/routes.ts"]);
    expect(routes.match(/server\.get\(/gu)).toHaveLength(5);
    expect(routes).not.toMatch(/server\.(?:post|put|patch|delete)\(/gu);
    expect(routes).not.toMatch(/upload|archive|scrape|sourceUri|objectKey/gu);
  });

  it("keeps catalog source and worker code free of network-ingestion and shell execution sinks", () => {
    const implementation = read([
      "packages/catalog/src/manifest.ts",
      "packages/catalog/src/glb.ts",
      "packages/catalog/src/png.ts",
      "services/spatial-worker/src/catalog/source.ts",
      "services/spatial-worker/src/catalog/pipeline.ts",
    ]);
    expect(implementation).not.toMatch(
      /\b(?:fetch|axios|XMLHttpRequest|child_process|execFile|spawn|curl|wget)\b/gu,
    );
    expect(implementation).not.toMatch(/console\.|authorization|accessKeyId|secretAccessKey/gu);
  });

  it("does not log artifact bytes, storage locators, rights receipts or signed access URLs", () => {
    const implementation = read([
      "services/platform-api/src/modules/catalog/service.ts",
      "services/platform-api/src/modules/catalog/storage.ts",
      "services/platform-api/src/modules/catalog/telemetry.ts",
      "services/spatial-worker/src/catalog/pipeline.ts",
      "services/spatial-worker/src/catalog/publication.ts",
      "services/spatial-worker/src/catalog/filesystem-publication.ts",
      "services/spatial-worker/src/catalog/s3-publication.ts",
    ]);
    expect(implementation).not.toMatch(/console\.|request\.log|logger\.|pino\(/gu);
    expect(implementation).not.toMatch(/record\([^)]*(?:objectKey|sourceUri|url|bytes|receipt)/gu);
  });
});
