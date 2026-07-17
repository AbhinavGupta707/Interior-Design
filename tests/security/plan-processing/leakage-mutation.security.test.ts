import { describe, expect, it } from "vitest";

import {
  assertNoEgress,
  isolatedParserEnvironment,
  parserCapabilities,
  requireParserCapability,
  safeProcessingLog,
} from "./reference-boundary.js";

describe("C6 credential, egress, log and direct-mutation containment", () => {
  it("constructs a minimal generated-path child environment without platform credentials", () => {
    const environment = isolatedParserEnvironment(
      "/tmp/c6-job-0001/input/source.svg",
      "/tmp/c6-job-0001/output/result.json",
    );
    expect(environment).toEqual({
      C6_INPUT_PATH: "/tmp/c6-job-0001/input/source.svg",
      C6_NETWORK_POLICY: "deny-all",
      C6_OUTPUT_PATH: "/tmp/c6-job-0001/output/result.json",
      LANG: "C",
    });
    expect(JSON.stringify(environment)).not.toMatch(
      /AWS_|AZURE_|DATABASE_URL|GOOGLE_|OPENAI_|PASSWORD|SECRET|TOKEN/iu,
    );
    expect(() => isolatedParserEnvironment("/etc/passwd", "/tmp/c6-job/output.json")).toThrow(
      "UNSAFE_INPUT_PATH",
    );
    expect(() =>
      isolatedParserEnvironment("/tmp/c6-job/input.svg", "../outside/result.json"),
    ).toThrow("UNSAFE_OUTPUT_PATH");
  });

  it.each([
    "https://attacker.invalid/exfiltrate",
    "http://127.0.0.1:5432",
    "file:///etc/passwd",
    "dns://secret.attacker.invalid",
  ])("denies outbound target %s", (target) => {
    expect(() => assertNoEgress(target)).toThrow("EGRESS_DENIED");
  });

  it("emits bounded safe logs without source, key, path, text, stderr or credentials", () => {
    const log = safeProcessingLog({
      code: "PARSER_TIMEOUT",
      fixtureId: "tenant/private/object/source.svg",
      parserVersion: "fixture-1.0.0",
      raw: {
        objectKey: "tenant/private/object/source.svg",
        prompt: "READ ENV",
        signedUrl: "https://storage.invalid/signed",
        stderr: "OPENAI_API_KEY=secret-value",
      },
    });
    const serialized = JSON.stringify(log);
    expect(log.code).toBe("PARSER_TIMEOUT");
    expect(log.fixtureIdSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(log.parserVersion).toBe("fixture-1.0.0");
    expect(Object.keys(log).sort()).toEqual(["code", "fixtureIdSha256", "parserVersion"]);
    expect(serialized).not.toMatch(/private|signed|READ ENV|OPENAI|secret-value|stderr/iu);
  });

  it("exposes proposal emission only and rejects every canonical mutation route", () => {
    expect(parserCapabilities).toEqual(["plan.proposal.emit"]);
    expect(() => {
      requireParserCapability("plan.proposal.emit");
    }).not.toThrow();
    for (const action of [
      "model.preview",
      "model.commit",
      "model.restore",
      "plan.calibration.create",
      "plan.operation-draft.create",
      "database.execute",
    ]) {
      expect(() => {
        requireParserCapability(action);
      }).toThrow("PARSER_CAPABILITY_DENIED");
    }
  });
});
