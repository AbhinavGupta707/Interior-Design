import {
  c6PlanPolicy,
  planParserResultSchema,
  type PlanParserResult,
} from "../../../packages/contracts/src/index.js";

export interface ExpectedParserScope {
  readonly assetId: string;
  readonly jobId: string;
  readonly normalizedInputSha256: string;
  readonly projectId: string;
  readonly sourceSha256: string;
}

const forbiddenFieldPattern =
  /^(?:accessToken|apiKey|authorization|canonicalMutation|cookie|databaseUrl|localPath|objectKey|password|prompt|secret|signedUrl|stderr)$/iu;

export function parseStrictParserOutput(
  raw: Uint8Array,
  expected: ExpectedParserScope,
): PlanParserResult {
  if (raw.byteLength > c6PlanPolicy.maximumParserOutputBytes) {
    throw new Error("PARSER_OUTPUT_TOO_LARGE");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new Error("PARSER_OUTPUT_MALFORMED");
  }
  assertNoForbiddenFields(decoded);
  const parsed = planParserResultSchema.safeParse(decoded);
  if (!parsed.success) throw new Error("PARSER_OUTPUT_SCHEMA_INVALID");
  const result = parsed.data;
  if (
    result.jobId !== expected.jobId ||
    result.projectId !== expected.projectId ||
    result.source.assetId !== expected.assetId ||
    result.source.projectId !== expected.projectId ||
    result.source.sha256 !== expected.sourceSha256 ||
    result.normalizedInputSha256 !== expected.normalizedInputSha256
  ) {
    throw new Error("PARSER_OUTPUT_SCOPE_MISMATCH");
  }
  return result;
}

function assertNoForbiddenFields(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) assertNoForbiddenFields(entry);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, entry] of Object.entries(value)) {
    if (forbiddenFieldPattern.test(key)) throw new Error("PARSER_OUTPUT_FORBIDDEN_FIELD");
    assertNoForbiddenFields(entry);
  }
}
