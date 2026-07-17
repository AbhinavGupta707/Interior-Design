export type CanonicalJsonErrorCode =
  | "CYCLIC_VALUE"
  | "DUPLICATE_OBJECT_KEY"
  | "INVALID_JSON"
  | "INVALID_UTF8"
  | "LONE_SURROGATE"
  | "NEGATIVE_ZERO"
  | "NON_FINITE_NUMBER"
  | "RESOURCE_LIMIT"
  | "UNSAFE_INTEGER"
  | "UNSUPPORTED_OBJECT"
  | "UNSUPPORTED_VALUE";

export class CanonicalJsonError extends Error {
  readonly code: CanonicalJsonErrorCode;
  readonly path: string | undefined;

  constructor(
    code: CanonicalJsonErrorCode,
    message: string,
    options?: ErrorOptions & { readonly path?: string },
  ) {
    super(message, options);
    this.name = "CanonicalJsonError";
    this.code = code;
    this.path = options?.path;
  }
}

export const MAX_CANONICAL_IJSON_INPUT_BYTES = 10_485_760;
const MAX_CANONICAL_IJSON_DEPTH = 128;

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assertUnicodeScalarString(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new CanonicalJsonError(
          "LONE_SURROGATE",
          "I-JSON strings must contain Unicode scalar values, not lone surrogates.",
          { path },
        );
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new CanonicalJsonError(
        "LONE_SURROGATE",
        "I-JSON strings must contain Unicode scalar values, not lone surrogates.",
        { path },
      );
    }
  }
}

function assertIJsonNumber(value: number, path: string): void {
  if (!Number.isFinite(value)) {
    throw new CanonicalJsonError(
      "NON_FINITE_NUMBER",
      "I-JSON does not support NaN or infinite numbers.",
      { path },
    );
  }
  if (Object.is(value, -0)) {
    throw new CanonicalJsonError(
      "NEGATIVE_ZERO",
      "Negative zero is rejected because canonical JSON serialises it as zero.",
      { path },
    );
  }
  if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
    throw new CanonicalJsonError(
      "UNSAFE_INTEGER",
      "Integer values must be exactly interoperable within the I-JSON safe range.",
      { path },
    );
  }
}

function childPath(parent: string, key: string | number): string {
  return typeof key === "number" ? `${parent}[${String(key)}]` : `${parent}.${key}`;
}

function serializeArray(
  value: readonly unknown[],
  ancestors: WeakSet<object>,
  path: string,
): string {
  const ownKeys = Reflect.ownKeys(value);
  for (const key of ownKeys) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key)) {
      throw new CanonicalJsonError(
        "UNSUPPORTED_VALUE",
        "JSON arrays cannot carry symbol or named properties.",
        { path },
      );
    }
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index < 0 || index >= value.length) {
      throw new CanonicalJsonError(
        "UNSUPPORTED_VALUE",
        "JSON arrays cannot carry out-of-range index properties.",
        { path },
      );
    }
  }

  const entries: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new CanonicalJsonError(
        "UNSUPPORTED_VALUE",
        "Sparse arrays are not valid canonical I-JSON values.",
        { path: childPath(path, index) },
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw new CanonicalJsonError(
        "UNSUPPORTED_VALUE",
        "Array entries must be enumerable data properties.",
        { path: childPath(path, index) },
      );
    }
    entries.push(serializeIJsonValue(descriptor.value, ancestors, childPath(path, index)));
  }
  return `[${entries.join(",")}]`;
}

function serializeObject(value: object, ancestors: WeakSet<object>, path: string): string {
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CanonicalJsonError(
      "UNSUPPORTED_OBJECT",
      "Canonical I-JSON accepts only plain objects and arrays.",
      { path },
    );
  }

  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key === "symbol")) {
    throw new CanonicalJsonError(
      "UNSUPPORTED_VALUE",
      "Canonical I-JSON objects cannot contain symbol keys.",
      { path },
    );
  }

  const keys = (ownKeys as string[]).toSorted(compareCodeUnits);
  const entries: string[] = [];
  for (const key of keys) {
    assertUnicodeScalarString(key, childPath(path, key));
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw new CanonicalJsonError(
        "UNSUPPORTED_VALUE",
        "Canonical I-JSON object members must be enumerable data properties.",
        { path: childPath(path, key) },
      );
    }
    entries.push(
      `${JSON.stringify(key)}:${serializeIJsonValue(
        descriptor.value,
        ancestors,
        childPath(path, key),
      )}`,
    );
  }
  return `{${entries.join(",")}}`;
}

function serializeIJsonValue(value: unknown, ancestors: WeakSet<object>, path: string): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    assertUnicodeScalarString(value, path);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    assertIJsonNumber(value, path);
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new CanonicalJsonError(
      "UNSUPPORTED_VALUE",
      "Canonical I-JSON supports only null, booleans, strings, numbers, arrays, and objects.",
      { path },
    );
  }
  if (ancestors.has(value)) {
    throw new CanonicalJsonError("CYCLIC_VALUE", "Canonical I-JSON cannot contain cycles.", {
      path,
    });
  }

  ancestors.add(value);
  try {
    return Array.isArray(value)
      ? serializeArray(value, ancestors, path)
      : serializeObject(value, ancestors, path);
  } finally {
    ancestors.delete(value);
  }
}

/** RFC-8785-style ECMAScript serialisation over the validated I-JSON subset. */
export function canonicalizeIJson(value: unknown): string {
  return serializeIJsonValue(value, new WeakSet<object>(), "$");
}

export function canonicalizeIJsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalizeIJson(value));
}

class JsonInputScanner {
  readonly #text: string;
  #index = 0;

  constructor(text: string) {
    this.#text = text;
  }

  scan(): void {
    this.#skipWhitespace();
    this.#scanValue("$", 0);
    this.#skipWhitespace();
    if (this.#index !== this.#text.length) this.#fail("Unexpected trailing JSON input.");
  }

  #fail(message: string, code: CanonicalJsonErrorCode = "INVALID_JSON"): never {
    throw new CanonicalJsonError(code, `${message} (offset ${String(this.#index)})`);
  }

  #skipWhitespace(): void {
    while (
      this.#text[this.#index] === " " ||
      this.#text[this.#index] === "\n" ||
      this.#text[this.#index] === "\r" ||
      this.#text[this.#index] === "\t"
    ) {
      this.#index += 1;
    }
  }

  #scanValue(path: string, depth: number): void {
    if (depth > MAX_CANONICAL_IJSON_DEPTH) {
      this.#fail("JSON nesting exceeds the canonical input limit.", "RESOURCE_LIMIT");
    }
    const character = this.#text[this.#index];
    if (character === '"') {
      this.#scanString(path);
      return;
    }
    if (character === "{") {
      this.#scanObject(path, depth);
      return;
    }
    if (character === "[") {
      this.#scanArray(path, depth);
      return;
    }
    if (character === "t") {
      this.#scanLiteral("true");
      return;
    }
    if (character === "f") {
      this.#scanLiteral("false");
      return;
    }
    if (character === "n") {
      this.#scanLiteral("null");
      return;
    }
    if (character === "-" || (character !== undefined && /[0-9]/u.test(character))) {
      this.#scanNumber(path);
      return;
    }
    this.#fail("Expected a JSON value.");
  }

  #scanLiteral(literal: "false" | "null" | "true"): void {
    if (this.#text.slice(this.#index, this.#index + literal.length) !== literal) {
      this.#fail(`Invalid ${literal} literal.`);
    }
    this.#index += literal.length;
  }

  #scanNumber(path: string): void {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(
      this.#text.slice(this.#index),
    );
    if (match === null) this.#fail("Invalid JSON number.");
    const token = match[0];
    const number = Number(token);
    try {
      assertIJsonNumber(number, path);
    } catch (error) {
      if (error instanceof CanonicalJsonError) {
        throw new CanonicalJsonError(
          error.code,
          `${error.message} (offset ${String(this.#index)})`,
          { path },
        );
      }
      throw error;
    }
    this.#index += token.length;
  }

  #scanString(path: string): string {
    const start = this.#index;
    this.#index += 1;
    while (this.#index < this.#text.length) {
      const codeUnit = this.#text.charCodeAt(this.#index);
      if (codeUnit === 0x22) {
        this.#index += 1;
        const token = this.#text.slice(start, this.#index);
        const decoded = JSON.parse(token) as unknown;
        if (typeof decoded !== "string") this.#fail("Invalid JSON string.");
        assertUnicodeScalarString(decoded, path);
        return decoded;
      }
      if (codeUnit === 0x5c) {
        const escape = this.#text[this.#index + 1];
        if (escape === "u") {
          const hexadecimal = this.#text.slice(this.#index + 2, this.#index + 6);
          if (!/^[0-9A-Fa-f]{4}$/u.test(hexadecimal)) this.#fail("Invalid Unicode escape.");
          this.#index += 6;
          continue;
        }
        if (escape === undefined || !/["\\/bfnrt]/u.test(escape)) {
          this.#fail("Invalid JSON string escape.");
        }
        this.#index += 2;
        continue;
      }
      if (codeUnit <= 0x1f) this.#fail("Unescaped control character in JSON string.");
      this.#index += 1;
    }
    this.#fail("Unterminated JSON string.");
  }

  #scanObject(path: string, depth: number): void {
    this.#index += 1;
    this.#skipWhitespace();
    if (this.#text[this.#index] === "}") {
      this.#index += 1;
      return;
    }

    const keys = new Set<string>();
    for (;;) {
      if (this.#text[this.#index] !== '"') this.#fail("Expected an object member name.");
      const key = this.#scanString(path);
      if (keys.has(key)) {
        this.#fail(
          "I-JSON objects must not contain duplicate member names.",
          "DUPLICATE_OBJECT_KEY",
        );
      }
      keys.add(key);
      this.#skipWhitespace();
      if (this.#text[this.#index] !== ":") this.#fail("Expected ':' after object member name.");
      this.#index += 1;
      this.#skipWhitespace();
      this.#scanValue(childPath(path, key), depth + 1);
      this.#skipWhitespace();
      if (this.#text[this.#index] === "}") {
        this.#index += 1;
        return;
      }
      if (this.#text[this.#index] !== ",") this.#fail("Expected ',' or '}' in object.");
      this.#index += 1;
      this.#skipWhitespace();
    }
  }

  #scanArray(path: string, depth: number): void {
    this.#index += 1;
    this.#skipWhitespace();
    if (this.#text[this.#index] === "]") {
      this.#index += 1;
      return;
    }

    let index = 0;
    for (;;) {
      this.#scanValue(childPath(path, index), depth + 1);
      index += 1;
      this.#skipWhitespace();
      if (this.#text[this.#index] === "]") {
        this.#index += 1;
        return;
      }
      if (this.#text[this.#index] !== ",") this.#fail("Expected ',' or ']' in array.");
      this.#index += 1;
      this.#skipWhitespace();
    }
  }
}

function decodeUtf8(input: string | Uint8Array): string {
  if (typeof input === "string") return input;
  if (input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf) {
    throw new CanonicalJsonError("INVALID_UTF8", "A UTF-8 BOM is not canonical JSON input.");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch (error) {
    throw new CanonicalJsonError("INVALID_UTF8", "JSON bytes must be valid UTF-8.", {
      cause: error,
    });
  }
}

/** Parses JSON while preserving I-JSON's duplicate-key and scalar constraints. */
export function parseIJson(input: string | Uint8Array): unknown {
  const inputByteLength =
    typeof input === "string" ? new TextEncoder().encode(input).byteLength : input.byteLength;
  if (inputByteLength > MAX_CANONICAL_IJSON_INPUT_BYTES) {
    throw new CanonicalJsonError(
      "RESOURCE_LIMIT",
      "Canonical JSON input exceeds the 10 MiB snapshot boundary.",
    );
  }
  const text = decodeUtf8(input);
  new JsonInputScanner(text).scan();
  const parsed = JSON.parse(text) as unknown;
  // Re-check the JavaScript representation to keep value and byte entry points
  // subject to exactly the same restrictions.
  canonicalizeIJson(parsed);
  return parsed;
}
