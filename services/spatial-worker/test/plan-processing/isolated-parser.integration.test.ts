import { planParserRequestSchema } from "@interior-design/contracts";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { IsolatedPlanParserPort } from "../../src/plan-processing/isolated-parser.js";
import { PlanNormalizer } from "../../src/plan-processing/normalizer.js";
import { validatePlanParserOutput } from "../../src/plan-processing/parser.js";

const directories: string[] = [];

async function workspace(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "c6-isolated-parser-test-"));
  directories.push(directory);
  return directory;
}

async function parseSource(
  sourcePath: string,
  detectedMimeType: "image/png" | "image/svg+xml",
  parserPreference: "auto" | "fixture",
) {
  const source = await readFile(sourcePath);
  const sourceSha256 = createHash("sha256").update(source).digest("hex");
  const normalized = await new PlanNormalizer({
    pdfInfo: "pdfinfo",
    pdfToCairo: "pdftocairo",
    pdfToPpm: "pdftoppm",
    popplerVersion: "test-poppler",
  }).normalize({
    detectedMimeType,
    expectedByteSize: source.byteLength,
    expectedSha256: sourceSha256,
    pageIndex: 0,
    parserPreference,
    sourcePath,
    workspaceDirectory: path.dirname(sourcePath),
  });
  const request = planParserRequestSchema.parse({
    jobId: "90000000-0000-4000-8000-000000000011",
    limits: {
      maximumCandidates: 200,
      maximumOutputBytes: 5_242_880,
      timeoutMilliseconds: 30_000,
    },
    normalizers: normalized.normalizers,
    normalizedInputSha256: normalized.sha256,
    parserMode: normalized.mode,
    schemaVersion: "c6-plan-parser-input-v1",
    source: {
      assetId: "90000000-0000-4000-8000-000000000012",
      byteSize: source.byteLength,
      coordinateSpace: normalized.coordinateSpace,
      detectedMimeType,
      heightSourceUnits: normalized.heightSourceUnits,
      pageIndex: 0,
      projectId: "90000000-0000-4000-8000-000000000013",
      rights: {
        basis: "owned-by-user",
        serviceProcessingConsent: true,
        trainingUseConsent: "denied",
      },
      sha256: sourceSha256,
      widthSourceUnits: normalized.widthSourceUnits,
    },
  });
  const parserInput = { ...normalized, request };
  const parser = new IsolatedPlanParserPort({
    arguments: ["-m", "inference_worker.plan_parser"],
    command: process.env.C6_TEST_PYTHON ?? "python3",
    pythonPath: path.resolve(import.meta.dirname, "../../../inference-worker/src"),
  });
  return {
    normalized,
    result: validatePlanParserOutput(parserInput, await parser.parse(parserInput)),
  };
}

function expectPinnedProposal(
  parsed: Awaited<ReturnType<typeof parseSource>>,
  sourcePath: string,
): void {
  expect(parsed.result.status).toBe("proposal");
  expect(parsed.result.normalizedInputSha256).toBe(parsed.normalized.sha256);
  expect(parsed.result.parser.normalizers).toEqual(parsed.normalized.normalizers);
  expect(JSON.stringify(parsed.result)).not.toContain(sourcePath);
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("C6 production parser integration", () => {
  it("normalizes a source and publishes the real shell-free Python fixture proposal", async () => {
    const sourcePath = path.join(await workspace(), "source.png");
    await writeFile(sourcePath, "synthetic-rights-cleared-plan", { mode: 0o600 });
    expectPinnedProposal(await parseSource(sourcePath, "image/png", "fixture"), sourcePath);
  });

  it("runs the normalized SVG rectangle through the real vector parser", async () => {
    const sourcePath = path.join(await workspace(), "source.svg");
    await writeFile(
      sourcePath,
      '<svg viewBox="0 0 100 80"><rect x="10" y="10" width="80" height="60"/></svg>',
      { mode: 0o600 },
    );
    expectPinnedProposal(await parseSource(sourcePath, "image/svg+xml", "auto"), sourcePath);
  });

  it("runs a rewritten gray8 plan through the real CPU raster parser", async () => {
    const width = 100;
    const height = 80;
    const pixels = Buffer.alloc(width * height, 255);
    for (let x = 10; x <= 90; x += 1) {
      if (x < 40 || x > 50) pixels[10 * width + x] = 0;
      pixels[70 * width + x] = 0;
    }
    for (let y = 10; y <= 70; y += 1) {
      pixels[y * width + 10] = 0;
      pixels[y * width + 90] = 0;
    }
    const sourcePath = path.join(await workspace(), "source.png");
    await sharp(pixels, { raw: { channels: 1, height, width } })
      .png()
      .toFile(sourcePath);
    expectPinnedProposal(await parseSource(sourcePath, "image/png", "auto"), sourcePath);
  });
});
