/// <reference types="node" />

import { createHash } from "node:crypto";

import type { CanonicalHomeSnapshot } from "@interior-design/contracts";

import { SceneCompileError } from "./errors.js";

const maximumDepth = 128;

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function failInput(message: string): never {
  throw new SceneCompileError("INPUT_INVALID", message);
}

function assertScalarString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        failInput("Scene inputs cannot contain lone Unicode surrogates.");
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      failInput("Scene inputs cannot contain lone Unicode surrogates.");
    }
  }
}

function assertPlainIJsonValue(value: unknown, ancestors: WeakSet<object>, depth: number): void {
  if (depth > maximumDepth) failInput("Scene input nesting exceeds the supported limit.");
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    assertScalarString(value);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) failInput("Scene inputs require finite numbers.");
    if (Object.is(value, -0)) failInput("Scene inputs reject negative zero.");
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      failInput("Scene input integers must be exactly representable.");
    }
    return;
  }
  if (typeof value !== "object") failInput("Scene inputs must be plain I-JSON values.");
  if (ancestors.has(value)) failInput("Scene inputs cannot contain cycles.");

  const prototype = Object.getPrototypeOf(value) as unknown;
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) failInput("Scene arrays must use the standard prototype.");
  } else if (prototype !== Object.prototype && prototype !== null) {
    failInput("Scene objects must be plain objects.");
  }

  ancestors.add(value);
  try {
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key === "symbol")) {
      failInput("Scene inputs cannot contain symbol properties.");
    }
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) failInput("Scene arrays cannot be sparse.");
      }
      for (const key of ownKeys) {
        if (key === "length") continue;
        if (
          typeof key !== "string" ||
          !/^(?:0|[1-9][0-9]*)$/u.test(key) ||
          Number(key) >= value.length
        ) {
          failInput("Scene arrays cannot contain named or out-of-range properties.");
        }
      }
    }
    for (const key of ownKeys) {
      if (key === "length" && Array.isArray(value)) continue;
      if (typeof key !== "string") failInput("Scene object keys must be strings.");
      assertScalarString(key);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        failInput("Scene inputs accept only enumerable data properties.");
      }
      assertPlainIJsonValue(descriptor.value, ancestors, depth + 1);
    }
  } finally {
    ancestors.delete(value);
  }
}

export function assertPlainIJson(value: unknown): void {
  assertPlainIJsonValue(value, new WeakSet<object>(), 0);
}

function serializeCanonical(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => serializeCanonical(entry)).join(",")}]`;
  if (typeof value !== "object") failInput("Canonical JSON received an unsupported value.");
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort(compareStrings)
    .map((key) => `${JSON.stringify(key)}:${serializeCanonical(object[key])}`)
    .join(",")}}`;
}

export function canonicalJson(value: unknown): string {
  assertPlainIJson(value);
  return serializeCanonical(value);
}

export function canonicalJsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJson(value));
}

export function sha256Hex(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareLimitations(left: unknown, right: unknown): number {
  if (!isRecord(left) || !isRecord(right)) return 0;
  return (
    compareStrings(String(left.code), String(right.code)) ||
    compareStrings(String(left.detail), String(right.detail))
  );
}

function normalizeSnapshotValue(value: unknown, path: readonly string[]): unknown {
  if (Array.isArray(value)) {
    const normalized = value.map((entry) => normalizeSnapshotValue(entry, path));
    const member = path.at(-1);
    if (member === "evidenceIds" || member === "boundedByElementIds") {
      return (normalized as string[]).toSorted(compareStrings);
    }
    if (member === "limitations" && normalized.every((entry) => typeof entry === "string")) {
      return normalized.toSorted(compareStrings);
    }
    if (member === "knownLimitations") return normalized.toSorted(compareLimitations);
    if (path.length === 2 && path[0] === "elements") {
      return normalized.toSorted((left, right) => {
        if (!isRecord(left) || !isRecord(right)) return 0;
        return compareStrings(String(left.id), String(right.id));
      });
    }
    return normalized;
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      normalizeSnapshotValue(child, [...path, key]),
    ]),
  );
}

export function canonicalSnapshotSha256(snapshot: CanonicalHomeSnapshot): string {
  const bytes = canonicalJsonBytes(normalizeSnapshotValue(snapshot, []));
  if (bytes.byteLength > 10_485_760) {
    throw new SceneCompileError(
      "RESOURCE_LIMIT_EXCEEDED",
      "Canonical snapshot bytes exceed the frozen C4 record limit.",
    );
  }
  return sha256Hex(bytes);
}

export function compareCanonicalValues(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}
