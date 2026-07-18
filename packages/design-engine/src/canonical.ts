import { createHash } from "node:crypto";

const maximumCanonicalDepth = 64;
const maximumCanonicalBytes = 16 * 1_048_576;

export class CanonicalDeclarationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CanonicalDeclarationError";
  }
}

function assertUnicodeScalarString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        throw new CanonicalDeclarationError("Canonical strings cannot contain lone surrogates.");
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new CanonicalDeclarationError("Canonical strings cannot contain lone surrogates.");
    }
  }
}

function encode(value: unknown, depth: number, ancestors: ReadonlySet<object>): string {
  if (depth > maximumCanonicalDepth) {
    throw new CanonicalDeclarationError("Canonical declaration depth exceeds its bound.");
  }
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") {
    assertUnicodeScalarString(value);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      throw new CanonicalDeclarationError(
        "Canonical numbers must be safe non-negative-zero integers.",
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new CanonicalDeclarationError("Canonical values cannot cycle.");
    const next = new Set(ancestors).add(value);
    return `[${value.map((entry) => encode(entry, depth + 1, next)).join(",")}]`;
  }
  if (typeof value === "object") {
    if (ancestors.has(value)) throw new CanonicalDeclarationError("Canonical values cannot cycle.");
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new CanonicalDeclarationError("Canonical declarations require plain objects.");
    }
    const next = new Set(ancestors).add(value);
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort(compareStrings);
    return `{${keys
      .filter((key) => record[key] !== undefined)
      .map((key) => {
        assertUnicodeScalarString(key);
        return `${JSON.stringify(key)}:${encode(record[key], depth + 1, next)}`;
      })
      .join(",")}}`;
  }
  throw new CanonicalDeclarationError("Canonical declarations contain an unsupported value.");
}

export function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function canonicalJson(value: unknown): string {
  const encoded = encode(value, 0, new Set());
  if (Buffer.byteLength(encoded, "utf8") > maximumCanonicalBytes) {
    throw new CanonicalDeclarationError("Canonical declaration bytes exceed their bound.");
  }
  return encoded;
}

export function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function deterministicUuid(namespace: string, contentSha256: string): string {
  const bytes = createHash("sha256").update(namespace).update(":").update(contentSha256).digest();
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function seedFromSha256(contentSha256: string): number {
  return Number(BigInt(`0x${contentSha256.slice(0, 16)}`) % 2_147_483_648n);
}

export function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareStrings);
}
