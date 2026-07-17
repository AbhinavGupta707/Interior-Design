import {
  canonicalHomeSnapshotSchema,
  type CanonicalHomeSnapshot,
} from "@interior-design/contracts";
import { createHash } from "node:crypto";

import type { CanonicalSnapshotCodec, CanonicalSnapshotEncoding } from "./types.js";

const entityCollectionKeys = new Set([
  "cameras",
  "finishes",
  "fixedObjects",
  "furnishings",
  "levels",
  "lights",
  "openings",
  "spaces",
  "stairs",
  "surfaces",
  "walls",
]);
const stringSetKeys = new Set(["boundedByElementIds", "evidenceIds", "limitations"]);

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

function assertUnicodeScalarString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new Error("Canonical JSON rejects unpaired UTF-16 surrogate code units.");
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error("Canonical JSON rejects unpaired UTF-16 surrogate code units.");
    }
  }
}

function normalizeArray(parentKey: string | undefined, value: readonly unknown[]): unknown[] {
  const normalized = value.map((entry) => normalizeCanonicalValue(entry));
  if (parentKey !== undefined && entityCollectionKeys.has(parentKey)) {
    return normalized.sort((left, right) => {
      const leftId =
        typeof left === "object" && left !== null && "id" in left ? String(left.id) : "";
      const rightId =
        typeof right === "object" && right !== null && "id" in right ? String(right.id) : "";
      return compareStrings(leftId, rightId);
    });
  }
  if (parentKey !== undefined && stringSetKeys.has(parentKey)) {
    return normalized.sort((left, right) => compareStrings(String(left), String(right)));
  }
  if (parentKey === "knownLimitations") {
    return normalized.sort((left, right) => {
      const leftKey =
        typeof left === "object" && left !== null && "code" in left
          ? `${String(left.code)}\u0000${"detail" in left ? String(left.detail) : ""}`
          : "";
      const rightKey =
        typeof right === "object" && right !== null && "code" in right
          ? `${String(right.code)}\u0000${"detail" in right ? String(right.detail) : ""}`
          : "";
      return compareStrings(leftKey, rightKey);
    });
  }
  return normalized;
}

function normalizeCanonicalValue(value: unknown, parentKey?: string): unknown {
  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new Error("Canonical JSON accepts only finite safe integers in C4 snapshots.");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "string") {
    assertUnicodeScalarString(value);
    return value;
  }
  if (Array.isArray(value)) {
    return normalizeArray(parentKey, value);
  }
  if (typeof value === "object") {
    const normalized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      assertUnicodeScalarString(key);
      if (entry !== undefined) {
        normalized[key] = normalizeCanonicalValue(entry, key);
      }
    }
    return normalized;
  }
  throw new Error("Canonical JSON contains an unsupported value.");
}

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalStringify(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) => compareStrings(left, right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalStringify(entry)}`)
      .join(",")}}`;
  }
  throw new Error("Canonical JSON contains an unsupported value.");
}

/** Temporary C4-L3 fallback until the C4-L1 public codec is integrated. */
export class LocalCanonicalSnapshotCodec implements CanonicalSnapshotCodec {
  encode(snapshot: CanonicalHomeSnapshot): CanonicalSnapshotEncoding {
    const validated = canonicalHomeSnapshotSchema.parse(snapshot);
    const normalized = normalizeCanonicalValue(validated);
    const canonicalJson = canonicalStringify(normalized);
    const canonicalSnapshot = canonicalHomeSnapshotSchema.parse(
      JSON.parse(canonicalJson) as unknown,
    );
    return {
      canonicalByteLength: Buffer.byteLength(canonicalJson, "utf8"),
      canonicalJson,
      snapshot: canonicalSnapshot,
      snapshotSha256: createHash("sha256").update(canonicalJson, "utf8").digest("hex"),
    };
  }
}
