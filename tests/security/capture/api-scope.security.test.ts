import { describe, expect, it } from "vitest";

import { createCaptureSessionRequestSchema } from "../../../packages/contracts/src/c7.js";

import {
  authorizeCaptureRequest,
  parseBoundedJSON,
  validateGeneratedObjectKey,
  validateSignedPartURL,
  type CaptureAction,
  type CaptureRole,
} from "./reference-boundary.js";
import { alphaScope, foreignScope } from "./synthetic-security-fixtures.js";

const mutationActions: readonly CaptureAction[] = [
  "cancel",
  "create-session",
  "finalize",
  "retry",
  "upload",
];
const readActions: readonly CaptureAction[] = ["read-proposal", "read-session"];

describe("C7 capture API tenant and disclosure-order security", () => {
  for (const role of [
    "owner",
    "editor",
    "viewer",
    "machine",
  ] as const satisfies readonly CaptureRole[]) {
    for (const action of [...mutationActions, ...readActions]) {
      it(`${role} receives the exact ${action} decision in an in-scope project`, () => {
        const decision = authorizeCaptureRequest({
          action,
          authenticated: true,
          bodyValid: true,
          principalScope: alphaScope,
          resourceExists: true,
          resourceScope: alphaScope,
          role,
        });
        const expected =
          role === "owner" ||
          role === "editor" ||
          ((role === "viewer" || role === "machine") && readActions.includes(action))
            ? 200
            : 403;
        expect(decision.status).toBe(expected);
      });
    }
  }

  it("denies authentication before all resource and validation detail", () => {
    expect(
      authorizeCaptureRequest({
        action: "upload",
        authenticated: false,
        bodyValid: false,
        principalScope: foreignScope,
        resourceExists: true,
        resourceScope: alphaScope,
        role: "owner",
      }),
    ).toEqual({ code: "AUTHENTICATION_REQUIRED", status: 401 });
  });

  it("returns the same not-found result for every foreign-tenant body and role", () => {
    for (const bodyValid of [false, true]) {
      for (const role of ["owner", "editor", "viewer", "machine"] as const) {
        expect(
          authorizeCaptureRequest({
            action: "finalize",
            authenticated: true,
            bodyValid,
            principalScope: foreignScope,
            resourceExists: true,
            resourceScope: alphaScope,
            role,
          }),
        ).toEqual({ code: "NOT_FOUND", status: 404 });
      }
    }
  });

  it("does not disclose whether an absent same-tenant session exists", () => {
    expect(
      authorizeCaptureRequest({
        action: "read-session",
        authenticated: true,
        bodyValid: true,
        principalScope: alphaScope,
        resourceExists: false,
        resourceScope: alphaScope,
        role: "owner",
      }),
    ).toEqual({ code: "NOT_FOUND", status: 404 });
  });

  it("rejects oversized, deeply nested, confusing-key and hostile-string JSON before use", () => {
    const options = { maximumBytes: 1_048_576, maximumDepth: 32, maximumString: 500 } as const;
    expect(() => parseBoundedJSON(new Uint8Array(1_048_577), options)).toThrow("JSON_SIZE_LIMIT");
    expect(() => parseBoundedJSON(new TextEncoder().encode("{".repeat(20)), options)).toThrow(
      "JSON_MALFORMED",
    );
    expect(() =>
      parseBoundedJSON(
        new TextEncoder().encode(JSON.stringify({ value: "x".repeat(501) })),
        options,
      ),
    ).toThrow("JSON_STRING_LIMIT");
    expect(() =>
      parseBoundedJSON(new TextEncoder().encode('{"__proto__":{"admin":true}}'), options),
    ).toThrow("JSON_CONFUSING_KEY");

    let nested: unknown = "leaf";
    for (let index = 0; index < 34; index += 1) nested = { nested };
    expect(() =>
      parseBoundedJSON(new TextEncoder().encode(JSON.stringify(nested)), options),
    ).toThrow("JSON_DEPTH_LIMIT");
  });

  it("lets the strict frozen schema reject object/path/URL fields and hostile labels", () => {
    const valid = {
      captureLabel: "Visibly synthetic ground floor",
      deviceCapability: "roomplan-lidar",
      expectedRoomCount: 2,
      mode: "structure",
      rights: {
        basis: "owned-by-user",
        serviceProcessingConsent: true,
        trainingUseConsent: "denied",
      },
    } as const;
    expect(createCaptureSessionRequestSchema.safeParse(valid).success).toBe(true);
    for (const attack of [
      { ...valid, captureLabel: "x".repeat(121) },
      { ...valid, objectKey: "../../tenant/other/source" },
      { ...valid, signedUrl: "file:///private/secret" },
      { ...valid, worldMap: { path: "/private/mobile/world.map" } },
    ]) {
      expect(createCaptureSessionRequestSchema.safeParse(attack).success).toBe(false);
    }
  });

  it("accepts only generated scoped object keys and bounded signed upload URLs", () => {
    const validKey = `tenant/${alphaScope.tenantId}/project/${alphaScope.projectId}/capture/${alphaScope.captureSessionId}/${"a".repeat(64)}/source`;
    expect(() => validateGeneratedObjectKey(validKey, alphaScope)).not.toThrow();
    for (const attack of [
      validKey.replace(alphaScope.tenantId, foreignScope.tenantId),
      `${validKey}/../../foreign`,
      validKey.replace("/source", "%2fsource"),
      `https://storage.invalid/${validKey}`,
    ]) {
      expect(() => validateGeneratedObjectKey(attack, alphaScope)).toThrow("OBJECT_KEY_REJECTED");
    }

    const now = Date.parse("2026-07-17T12:00:00.000Z");
    expect(() =>
      validateSignedPartURL(
        "https://storage.example.test/c7/part?signature=redacted",
        "storage.example.test",
        now,
        "2026-07-17T12:05:00.000Z",
      ),
    ).not.toThrow();
    for (const attack of [
      "file:///private/source",
      "data:application/json,secret",
      "https://storage.example.test@attacker.invalid/c7/part",
      "https://storage.example.test/c7/part#token",
    ]) {
      expect(() =>
        validateSignedPartURL(attack, "storage.example.test", now, "2026-07-17T12:05:00.000Z"),
      ).toThrow("SIGNED_URL_REJECTED");
    }
    expect(() =>
      validateSignedPartURL(
        "https://storage.example.test/c7/part",
        "storage.example.test",
        now,
        "2026-07-17T11:59:59.000Z",
      ),
    ).toThrow("SIGNED_URL_EXPIRED");
  });
});
