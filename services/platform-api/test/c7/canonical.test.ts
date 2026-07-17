import { describe, expect, it } from "vitest";

import { canonicalCaptureJson, captureSha256 } from "../../src/modules/capture/canonical.js";

describe("canonical capture JSON", () => {
  it("sorts object keys recursively while preserving array order", () => {
    expect(canonicalCaptureJson({ z: [{ b: 2, a: 1 }], a: true })).toBe(
      '{"a":true,"z":[{"a":1,"b":2}]}',
    );
  });

  it("omits undefined properties and normalizes negative zero", () => {
    expect(canonicalCaptureJson({ absent: undefined, zero: -0 })).toBe('{"zero":0}');
  });

  it("rejects non-finite and unsupported values", () => {
    expect(() => canonicalCaptureJson({ value: Infinity })).toThrow(/non-finite/u);
    expect(() => canonicalCaptureJson({ value: 1n })).toThrow(/unsupported/u);
  });

  it("produces stable lowercase SHA-256 bindings", () => {
    expect(captureSha256({ b: 2, a: 1 })).toBe(captureSha256({ a: 1, b: 2 }));
    expect(captureSha256({ a: 1 })).toMatch(/^[0-9a-f]{64}$/u);
    expect(captureSha256({ a: 1 })).not.toBe(captureSha256({ a: 2 }));
  });
});
