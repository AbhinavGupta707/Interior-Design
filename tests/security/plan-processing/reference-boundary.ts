import { createHash } from "node:crypto";

import type { PlanFixture } from "../../../packages/test-fixtures/src/plans/types.js";

export interface SourceLeaseClaim {
  readonly assetId: string;
  readonly objectKey: string;
  readonly projectId: string;
  readonly serviceProcessingConsent: boolean;
  readonly sourceSha256: string;
  readonly sourceStatus: "processing" | "quarantined" | "ready" | "rejected";
  readonly tenantId: string;
  readonly trainingUseConsent: "allowed" | "denied" | "unspecified";
}

export interface BoundaryDecision {
  readonly accepted: boolean;
  readonly code?:
    | "invalid-parser-output"
    | "resource-limit"
    | "rights-not-permitted"
    | "source-mismatch"
    | "source-not-ready"
    | "unsafe-content";
  readonly normalizedPrimitiveCount: number;
  readonly textPolicy: "discarded-untrusted-labels";
}

const forbiddenSvg = [
  /<!DOCTYPE/iu,
  /<!ENTITY/iu,
  /<script\b/iu,
  /<style\b/iu,
  /<foreignObject\b/iu,
  /\son[a-z]+\s*=/iu,
  /(?:href|xlink:href)\s*=\s*["']\s*(?:data|file|https?|ftp):/iu,
  /url\s*\(/iu,
];
const forbiddenPdf =
  /\/(?:AA|EmbeddedFile|EmbeddedFiles|JavaScript|JS|Launch|ObjStm|OpenAction|RichMedia|URI|XFA)\b/u;
const activePolyglot = /<(?:iframe|script|svg)\b|javascript\s*:/iu;

export function verifySourceLease(fixture: PlanFixture, claim: SourceLeaseClaim): BoundaryDecision {
  if (claim.tenantId !== fixture.scope.tenantId || claim.projectId !== fixture.scope.projectId) {
    return denied("source-mismatch");
  }
  if (claim.assetId !== fixture.scope.assetId || claim.sourceSha256 !== fixture.sha256) {
    return denied("source-mismatch");
  }
  if (claim.sourceStatus !== "ready") return denied("source-not-ready");
  if (!claim.serviceProcessingConsent || claim.trainingUseConsent !== "denied") {
    return denied("rights-not-permitted");
  }
  if (
    claim.objectKey !== fixture.scope.objectKey ||
    !/^tenant\/c6-synthetic\/[a-z0-9-]{3,200}$/u.test(claim.objectKey) ||
    claim.objectKey.includes("..")
  ) {
    return denied("source-mismatch");
  }
  return inspectSource(fixture);
}

export function inspectSource(fixture: PlanFixture): BoundaryDecision {
  if (fixture.mimeType === "image/svg+xml") return inspectSvg(fixture.bytes);
  if (fixture.mimeType === "application/pdf") return inspectPdf(fixture.bytes);
  if (fixture.mimeType === "image/png") return inspectPng(fixture.bytes);
  const bytes = fixture.bytes;
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return denied("invalid-parser-output");
  }
  return accepted(0);
}

export function isolatedParserEnvironment(generatedInputPath: string, generatedOutputPath: string) {
  if (!isGeneratedTemporaryPath(generatedInputPath)) {
    throw new Error("UNSAFE_INPUT_PATH");
  }
  if (!isGeneratedTemporaryPath(generatedOutputPath)) {
    throw new Error("UNSAFE_OUTPUT_PATH");
  }
  return Object.freeze({
    C6_INPUT_PATH: generatedInputPath,
    C6_NETWORK_POLICY: "deny-all",
    C6_OUTPUT_PATH: generatedOutputPath,
    LANG: "C",
  });
}

function isGeneratedTemporaryPath(value: string): boolean {
  return (
    /^\/tmp\/c6-[a-z0-9/._-]{1,180}$/u.test(value) && !value.includes("..") && !value.includes("//")
  );
}

export function assertNoEgress(target: string): never {
  void target;
  throw new Error("EGRESS_DENIED");
}

export function safeProcessingLog(input: {
  readonly code: string;
  readonly fixtureId: string;
  readonly parserVersion: string;
  readonly raw?: unknown;
}) {
  return Object.freeze({
    code: /^[A-Z][A-Z0-9_]{2,79}$/u.test(input.code) ? input.code : "UNSAFE_ERROR",
    fixtureIdSha256: createHash("sha256").update(input.fixtureId).digest("hex"),
    parserVersion: /^[a-zA-Z0-9._-]{1,100}$/u.test(input.parserVersion)
      ? input.parserVersion
      : "redacted",
  });
}

export const parserCapabilities = Object.freeze(["plan.proposal.emit"] as const);

export function requireParserCapability(action: string): void {
  if (!parserCapabilities.includes(action as (typeof parserCapabilities)[number])) {
    throw new Error("PARSER_CAPABILITY_DENIED");
  }
}

function inspectSvg(bytes: Uint8Array): BoundaryDecision {
  const source = new TextDecoder("utf8", { fatal: false }).decode(bytes);
  if (forbiddenSvg.some((pattern) => pattern.test(source))) return denied("unsafe-content");
  if (!source.trimStart().startsWith("<svg") && !source.trimStart().startsWith("<?xml")) {
    return denied("invalid-parser-output");
  }
  const normalizedPrimitiveCount = [...source.matchAll(/<(?:line|path|polygon|polyline|rect)\b/giu)]
    .length;
  return accepted(normalizedPrimitiveCount);
}

function inspectPdf(bytes: Uint8Array): BoundaryDecision {
  const source = new TextDecoder("latin1").decode(bytes);
  if (!source.startsWith("%PDF-") || !source.includes("%%EOF")) {
    return denied("invalid-parser-output");
  }
  if (forbiddenPdf.test(source)) return denied("unsafe-content");
  return accepted([...source.matchAll(/\b(?:m|l|re)\b/gu)].length);
}

function inspectPng(bytes: Uint8Array): BoundaryDecision {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 33 || signature.some((byte, index) => bytes[index] !== byte)) {
    return denied("invalid-parser-output");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0 || width * height > 20_000_000) {
    return denied("resource-limit");
  }
  const text = new TextDecoder("latin1").decode(bytes);
  if (activePolyglot.test(text)) return denied("unsafe-content");
  return accepted(0);
}

function accepted(normalizedPrimitiveCount: number): BoundaryDecision {
  return {
    accepted: true,
    normalizedPrimitiveCount,
    textPolicy: "discarded-untrusted-labels",
  };
}

function denied(code: NonNullable<BoundaryDecision["code"]>): BoundaryDecision {
  return {
    accepted: false,
    code,
    normalizedPrimitiveCount: 0,
    textPolicy: "discarded-untrusted-labels",
  };
}
