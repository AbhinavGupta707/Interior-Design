import {
  canonicalizeIJson,
  canonicalizeIJsonBytes,
  parseIJson,
} from "@interior-design/domain-model";
import { createHash } from "node:crypto";

import { CatalogError } from "./errors.js";

export const sha256Pattern = /^[a-f0-9]{64}$/u;

export function hasUnsafeCatalogText(value: string, allowTextWhitespace = false): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) return true;
    const allowedWhitespace = allowTextWhitespace && [0x09, 0x0a, 0x0d].includes(codePoint);
    if (
      (!allowedWhitespace && (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    ) {
      return true;
    }
  }
  return false;
}

export function catalogCanonicalJson(value: unknown): string {
  try {
    return canonicalizeIJson(value);
  } catch (error) {
    throw new CatalogError("CATALOG_INPUT_MALFORMED", { cause: error });
  }
}

export function catalogCanonicalBytes(value: unknown): Uint8Array {
  try {
    return canonicalizeIJsonBytes(value);
  } catch (error) {
    throw new CatalogError("CATALOG_INPUT_MALFORMED", { cause: error });
  }
}

export function parseCatalogCanonicalJson(bytes: Uint8Array): unknown {
  try {
    return parseIJson(bytes);
  } catch (error) {
    throw new CatalogError("CATALOG_INPUT_MALFORMED", { cause: error });
  }
}

export function catalogSha256(value: unknown): string {
  return sha256Bytes(catalogCanonicalBytes(value));
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function deterministicCatalogUuid(namespace: string): string {
  if (namespace.length < 1 || namespace.length > 2_000 || hasUnsafeCatalogText(namespace)) {
    throw new CatalogError("CATALOG_INPUT_MALFORMED");
  }
  const bytes = Buffer.from(
    createHash("sha256").update(namespace, "utf8").digest().subarray(0, 16),
  );
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hexadecimal = bytes.toString("hex");
  return `${hexadecimal.slice(0, 8)}-${hexadecimal.slice(8, 12)}-${hexadecimal.slice(12, 16)}-${hexadecimal.slice(16, 20)}-${hexadecimal.slice(20)}`;
}

export function compareCatalogStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function deepFreezeCatalogValue<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreezeCatalogValue(child);
  return Object.freeze(value);
}

export function exactObjectKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort(compareCatalogStrings);
  const required = [...expected].sort(compareCatalogStrings);
  return actual.length === required.length && actual.every((key, index) => key === required[index]);
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
