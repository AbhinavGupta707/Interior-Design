import { describe, expect, it } from "vitest";

import { c6PlanPolicy } from "../../../packages/contracts/src/index.js";

import { encodeParserOutput, parserScope, validParserProposal } from "./parser-output-fixture.js";
import { parseStrictParserOutput } from "./strict-parser-output.js";

describe("C6 malformed, oversized and cross-scope parser JSON", () => {
  it("accepts one exact strict source-pinned proposal", () => {
    expect(
      parseStrictParserOutput(encodeParserOutput(validParserProposal()), parserScope),
    ).toMatchObject({
      normalizedInputSha256: parserScope.normalizedInputSha256,
      projectId: parserScope.projectId,
      status: "proposal",
    });
  });

  it("rejects malformed and oversized output before publication", () => {
    expect(() => parseStrictParserOutput(new TextEncoder().encode("{"), parserScope)).toThrow(
      "PARSER_OUTPUT_MALFORMED",
    );
    expect(() =>
      parseStrictParserOutput(
        new Uint8Array(c6PlanPolicy.maximumParserOutputBytes + 1),
        parserScope,
      ),
    ).toThrow("PARSER_OUTPUT_TOO_LARGE");
  });

  it.each([
    [
      "unknown schema version",
      (value: Record<string, unknown>) => (value.schemaVersion = "c6-plan-proposal-v999"),
    ],
    ["unknown top-level field", (value: Record<string, unknown>) => (value.unexpected = true)],
    [
      "direct mutation field",
      (value: Record<string, unknown>) => (value.canonicalMutation = { commit: true }),
    ],
    [
      "raw object key",
      (value: Record<string, unknown>) => (value.objectKey = "tenant/private/source"),
    ],
    [
      "signed URL",
      (value: Record<string, unknown>) => (value.signedUrl = "https://storage.invalid/signed"),
    ],
    [
      "parser stderr",
      (value: Record<string, unknown>) => (value.stderr = "AWS_SECRET_ACCESS_KEY=x"),
    ],
  ])("rejects %s", (_label, mutate) => {
    const value = validParserProposal();
    mutate(value);
    expect(() => parseStrictParserOutput(encodeParserOutput(value), parserScope)).toThrow(
      /PARSER_OUTPUT_(?:FORBIDDEN_FIELD|SCHEMA_INVALID)/u,
    );
  });

  it.each([
    ["jobId", "c6000000-0000-4000-8000-999999999991"],
    ["projectId", "c6000000-0000-4000-8000-999999999992"],
    ["normalizedInputSha256", "e".repeat(64)],
  ])("rejects a mismatched %s", (field, replacement) => {
    const value = validParserProposal();
    value[field] = replacement;
    expect(() => parseStrictParserOutput(encodeParserOutput(value), parserScope)).toThrow(
      "PARSER_OUTPUT_SCOPE_MISMATCH",
    );
  });

  it("rejects source asset/hash/project mismatches and excessive candidate output", () => {
    for (const field of ["assetId", "projectId", "sha256"] as const) {
      const value = validParserProposal();
      const source = value.source as Record<string, unknown>;
      source[field] = field === "sha256" ? "d".repeat(64) : "c6000000-0000-4000-8000-999999999993";
      expect(() => parseStrictParserOutput(encodeParserOutput(value), parserScope)).toThrow(
        "PARSER_OUTPUT_SCOPE_MISMATCH",
      );
    }

    const value = validParserProposal();
    const original = value.candidates as unknown[];
    value.candidates = Array.from(
      { length: c6PlanPolicy.maximumCandidates + 1 },
      () => original[0],
    );
    expect(() => parseStrictParserOutput(encodeParserOutput(value), parserScope)).toThrow(
      "PARSER_OUTPUT_SCHEMA_INVALID",
    );
  });
});
