import { createHash } from "node:crypto";

import { canonicalizeIJson, canonicalizeIJsonBytes } from "@interior-design/domain-model";

import { failRenderScene } from "./errors.js";

export const sha256Pattern = /^[a-f0-9]{64}$/u;
export const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function compareRenderStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function renderSceneCanonicalJson(value: unknown): string {
  try {
    return canonicalizeIJson(value);
  } catch {
    return failRenderScene("INPUT_INVALID");
  }
}

export function renderSceneCanonicalBytes(value: unknown): Uint8Array {
  try {
    return canonicalizeIJsonBytes(value);
  } catch {
    return failRenderScene("INPUT_INVALID");
  }
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256Canonical(value: unknown): string {
  return sha256Bytes(renderSceneCanonicalBytes(value));
}

export function deterministicRenderUuid(namespace: string): string {
  if (namespace.length < 1 || namespace.length > 2_000 || hasUnsafeText(namespace)) {
    return failRenderScene("INPUT_INVALID");
  }
  const bytes = Buffer.from(
    createHash("sha256").update(namespace, "utf8").digest().subarray(0, 16),
  );
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hexadecimal = bytes.toString("hex");
  return `${hexadecimal.slice(0, 8)}-${hexadecimal.slice(8, 12)}-${hexadecimal.slice(12, 16)}-${hexadecimal.slice(16, 20)}-${hexadecimal.slice(20)}`;
}

export function hasUnsafeText(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint === undefined ||
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    ) {
      return true;
    }
  }
  return false;
}

export function exactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort(compareRenderStrings);
  const sortedExpected = [...expected].sort(compareRenderStrings);
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function deepFreezeRenderValue<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreezeRenderValue(child);
  return Object.freeze(value);
}
