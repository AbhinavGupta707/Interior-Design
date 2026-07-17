import { describe, expect, it } from "vitest";

import { evaluateWorkerLease, safeCaptureLog, type WorkerTransform } from "./reference-boundary.js";
import { alphaScope, validWorkerLease } from "./synthetic-security-fixtures.js";

describe("C7 worker fencing, geometry and resource security", () => {
  it("accepts only the exact scoped, rights-cleared current attempt", () => {
    expect(evaluateWorkerLease(validWorkerLease)).toEqual({
      accepted: true,
      maximumCpuMilliseconds: 60_000,
      maximumResidentSetMebibytes: 1_024,
    });
  });

  for (const [name, attack, code] of [
    ["tenant substitution", { packageTenantId: "foreign-tenant" }, "source-mismatch"],
    ["project substitution", { packageProjectId: "foreign-project" }, "source-mismatch"],
    ["session substitution", { packageCaptureSessionId: "foreign-session" }, "source-mismatch"],
    [
      "rights withdrawal",
      { rights: { serviceProcessingConsent: false, trainingUseConsent: "denied" } },
      "rights-not-permitted",
    ],
    [
      "training permission drift",
      { rights: { serviceProcessingConsent: true, trainingUseConsent: "allowed" } },
      "rights-not-permitted",
    ],
    ["cancel during processing", { cancelled: true }, "cancelled"],
    ["stale retry lease", { attempt: 1, expectedAttempt: 2 }, "stale-attempt"],
    [
      "incompatible structure space",
      { roomCount: 2, sharedWorldOrigin: false },
      "incompatible-world-space",
    ],
    ["room ceiling", { roomCount: 65 }, "resource-limit"],
    ["surface ceiling", { surfaceCount: 10_001 }, "resource-limit"],
    ["object ceiling", { objectCount: 10_001 }, "resource-limit"],
    ["package byte ceiling", { inputBytes: 2_147_483_649 }, "resource-limit"],
  ] as const) {
    it(`rejects ${name}`, () => {
      expect(evaluateWorkerLease({ ...validWorkerLease, ...attack })).toEqual({
        accepted: false,
        code,
      });
    });
  }

  it("rejects floating, non-finite, oversized and malformed transforms", () => {
    const identity = validWorkerLease.transforms[0];
    if (identity === undefined) throw new Error("Expected a synthetic transform.");
    const attacks: readonly (readonly WorkerTransform[])[] = [
      [{ ...identity, translationMicrometres: { x: 0.5, y: 0, z: 0 } }],
      [{ ...identity, translationMicrometres: { x: Infinity, y: 0, z: 0 } }],
      [
        {
          ...identity,
          translationMicrometres: { x: 1_000_000_001, y: 0, z: 0 },
        },
      ],
      [{ basisNanounits: [1_000_000_000], translationMicrometres: { x: 0, y: 0, z: 0 } }],
      [
        {
          ...identity,
          basisNanounits: [1_100_000_001, 0, 0, 0, 1, 0, 0, 0, 1],
        },
      ],
    ];
    for (const transforms of attacks) {
      expect(evaluateWorkerLease({ ...validWorkerLease, transforms })).toEqual({
        accepted: false,
        code: "invalid-normalized-input",
      });
    }
  });

  it("emits bounded logs with no IDs, tokens, URLs, object keys, paths or raw payloads", () => {
    const secrets = {
      objectKey: `tenant/${alphaScope.tenantId}/private/source`,
      rawJSON: '{"worldMap":"opaque-private-state"}',
      signedUrl: "https://storage.invalid/source?signature=super-secret",
      token: "bearer-super-secret-token",
    };
    const log = safeCaptureLog({
      actorRole: "owner",
      code: "INVALID_NORMALIZED_INPUT",
      correlationId: alphaScope.captureSessionId,
      raw: secrets,
      routeTemplate: "/v1/projects/:projectId/capture-sessions/:captureSessionId",
      status: 422,
    });
    const serialized = JSON.stringify(log);
    expect(log).toMatchObject({
      actorRole: "owner",
      code: "INVALID_NORMALIZED_INPUT",
      status: 422,
    });
    for (const secret of [
      alphaScope.captureSessionId,
      alphaScope.projectId,
      alphaScope.tenantId,
      ...Object.values(secrets),
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(Object.keys(log).sort()).toEqual([
      "actorRole",
      "code",
      "correlationSha256",
      "routeTemplate",
      "status",
    ]);
  });
});
