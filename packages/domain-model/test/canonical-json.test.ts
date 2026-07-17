import { describe, expect, it } from "vitest";

import { CanonicalJsonError, canonicalizeIJson, parseIJson } from "../src/index.js";

function expectCanonicalError(action: () => unknown, code: CanonicalJsonError["code"]): void {
  try {
    action();
    throw new Error("Expected canonical JSON validation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(CanonicalJsonError);
    expect((error as CanonicalJsonError).code).toBe(code);
  }
}

describe("RFC-8785-style I-JSON canonicalization", () => {
  it("uses ECMAScript primitive serialization and recursive property sorting", () => {
    const canonical = canonicalizeIJson({
      z: { y: true, x: null },
      numbers: [Number("333333333.33333329"), 4.5, 2e-3, 1e-27],
      a: "line\ntext",
    });
    expect(canonical).toBe(
      '{"a":"line\\ntext","numbers":[333333333.3333333,4.5,0.002,1e-27],"z":{"x":null,"y":true}}',
    );
  });

  it("sorts raw UTF-16 code units without locale or Unicode normalization", () => {
    const canonical = canonicalizeIJson({
      "\uE000": 5,
      "\u{10000}": 4,
      "\uD7FF": 3,
      é: 2,
      "e\u0301": 1,
    });
    expect(Object.keys(JSON.parse(canonical) as object)).toEqual([
      "e\u0301",
      "é",
      "\uD7FF",
      "\u{10000}",
      "\uE000",
    ]);
    expect(canonical).toContain('"é":1,"é":2');
  });

  it("rejects unsupported JavaScript values and object shapes instead of dropping them", () => {
    expectCanonicalError(() => canonicalizeIJson(undefined), "UNSUPPORTED_VALUE");
    expectCanonicalError(() => canonicalizeIJson(1n), "UNSUPPORTED_VALUE");
    expectCanonicalError(() => canonicalizeIJson(Symbol("synthetic")), "UNSUPPORTED_VALUE");
    expectCanonicalError(() => canonicalizeIJson(new Date(0)), "UNSUPPORTED_OBJECT");

    const sparse: unknown[] = [];
    sparse.length = 1;
    expectCanonicalError(() => canonicalizeIJson(sparse), "UNSUPPORTED_VALUE");

    const accessor = Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => 1,
    });
    expectCanonicalError(() => canonicalizeIJson(accessor), "UNSUPPORTED_VALUE");

    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expectCanonicalError(() => canonicalizeIJson(cyclic), "CYCLIC_VALUE");
  });

  it("rejects non-finite, unsafe, negative-zero, and lone-surrogate values", () => {
    expectCanonicalError(() => canonicalizeIJson(Number.NaN), "NON_FINITE_NUMBER");
    expectCanonicalError(() => canonicalizeIJson(Number.POSITIVE_INFINITY), "NON_FINITE_NUMBER");
    expectCanonicalError(() => canonicalizeIJson(Number.MAX_SAFE_INTEGER + 1), "UNSAFE_INTEGER");
    expectCanonicalError(() => canonicalizeIJson(-0), "NEGATIVE_ZERO");
    expectCanonicalError(() => canonicalizeIJson("\ud800"), "LONE_SURROGATE");
    expectCanonicalError(() => canonicalizeIJson({ "\udc00": true }), "LONE_SURROGATE");
  });

  it.each(["-0", "-0.0", "-0e0", "-0.000e+4"])(
    "rejects raw negative-zero token %s before it can collapse",
    (token) => {
      expectCanonicalError(() => parseIJson(token), "NEGATIVE_ZERO");
    },
  );

  it("rejects duplicate decoded keys, unsafe/non-finite JSON numbers, and invalid UTF-8", () => {
    expectCanonicalError(() => parseIJson('{"a":1,"\\u0061":2}'), "DUPLICATE_OBJECT_KEY");
    expectCanonicalError(() => parseIJson("9007199254740993"), "UNSAFE_INTEGER");
    expectCanonicalError(() => parseIJson("1e400"), "NON_FINITE_NUMBER");
    expectCanonicalError(() => parseIJson('"\\ud800"'), "LONE_SURROGATE");
    expectCanonicalError(() => parseIJson(Uint8Array.from([0xc3, 0x28])), "INVALID_UTF8");
    expectCanonicalError(
      () => parseIJson(Uint8Array.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d])),
      "INVALID_UTF8",
    );
  });

  it("bounds hostile input nesting before frozen-schema validation", () => {
    const nested = `${"[".repeat(130)}0${"]".repeat(130)}`;
    expectCanonicalError(() => parseIJson(nested), "RESOURCE_LIMIT");
  });
});
