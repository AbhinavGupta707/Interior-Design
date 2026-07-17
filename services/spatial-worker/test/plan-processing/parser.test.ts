import { planParserRequestSchema } from "@interior-design/contracts";
import { describe, expect, it } from "vitest";

import { LocalPlanParserFake, validatePlanParserOutput } from "../../src/plan-processing/parser.js";

const request = planParserRequestSchema.parse({
  jobId: "90000000-0000-4000-8000-000000000001",
  limits: { maximumCandidates: 200, maximumOutputBytes: 5_242_880, timeoutMilliseconds: 30_000 },
  normalizedInputSha256: "d".repeat(64),
  parserMode: "deterministic-fixture",
  schemaVersion: "c6-plan-parser-input-v1",
  source: {
    assetId: "90000000-0000-4000-8000-000000000002",
    byteSize: 100,
    coordinateSpace: "fixture-microunits",
    detectedMimeType: "image/svg+xml",
    heightSourceUnits: 1000,
    pageIndex: 0,
    projectId: "90000000-0000-4000-8000-000000000003",
    rights: {
      basis: "owned-by-user",
      serviceProcessingConsent: true,
      trainingUseConsent: "denied",
    },
    sha256: "e".repeat(64),
    widthSourceUnits: 1000,
  },
});

const fixtureInput = {
  coordinateSpace: "fixture-microunits" as const,
  filePath: "/internal/not-persisted.json",
  heightSourceUnits: 1000,
  mode: "deterministic-fixture" as const,
  normalizers: [{ name: "fixture-normalizer", version: "1.0.0" }],
  request,
  sha256: request.normalizedInputSha256,
  widthSourceUnits: 1000,
};

describe("C6 local parser port", () => {
  it("emits a deterministic schema-valid closed fixture proposal", async () => {
    const parser = new LocalPlanParserFake(() => new Date("2026-07-17T12:00:00.000Z"));
    const left = await parser.parse(fixtureInput);
    const right = await parser.parse(fixtureInput);
    expect(right).toEqual(left);
    expect(validatePlanParserOutput(fixtureInput, left)).toEqual(left);
    expect(left.status).toBe("proposal");
    if (left.status !== "proposal") throw new Error("Expected a fixture proposal.");
    expect(left.candidates.filter(({ kind }) => kind === "wall")).toHaveLength(4);
    expect(left.unresolvedRegions).toEqual([]);
    expect(JSON.stringify(left)).not.toContain(fixtureInput.filePath);
  });

  it("rejects source-scoping and topology drift at the untrusted parser boundary", async () => {
    const parser = new LocalPlanParserFake(() => new Date("2026-07-17T12:00:00.000Z"));
    const result = await parser.parse(fixtureInput);
    expect(result.status).toBe("proposal");
    if (result.status !== "proposal") throw new Error("Expected a fixture proposal.");
    expect(() =>
      validatePlanParserOutput(fixtureInput, {
        ...result,
        source: { ...result.source, projectId: "90000000-0000-4000-8000-000000000099" },
      }),
    ).toThrow(/invalid-parser-output/u);
    const wallIndex = result.candidates.findIndex(({ kind }) => kind === "wall");
    const candidates = [...result.candidates];
    const wall = candidates[wallIndex];
    if (wall?.kind !== "wall") throw new Error("Expected a fixture wall.");
    candidates[wallIndex] = {
      ...wall,
      levelCandidateId: "90000000-0000-4000-8000-000000000098",
    };
    expect(() => validatePlanParserOutput(fixtureInput, { ...result, candidates })).toThrow(
      /invalid-parser-output/u,
    );
  });

  it("abstains explicitly when the isolated L2 vector/raster adapter is not installed", async () => {
    const parser = new LocalPlanParserFake(() => new Date("2026-07-17T12:00:00.000Z"));
    const result = await parser.parse({
      coordinateSpace: "pixels",
      filePath: "/internal/not-persisted.png",
      heightSourceUnits: 1000,
      mode: "deterministic-raster",
      normalizers: [{ name: "sharp-grayscale-png", version: "1.0.0" }],
      request: { ...request, parserMode: "deterministic-raster" },
      sha256: request.normalizedInputSha256,
      widthSourceUnits: 1000,
    });
    expect(result).toMatchObject({
      code: "parser-unavailable",
      retryable: true,
      status: "abstained",
    });
  });
});
