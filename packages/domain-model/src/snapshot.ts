/// <reference types="node" />

import { createHash } from "node:crypto";

import {
  canonicalHomeSnapshotSchema,
  modelProfileSchema,
  modelSnapshotRecordSchema,
} from "@interior-design/contracts";
import type {
  CanonicalHomeSnapshot,
  ModelProfile,
  ModelSnapshotRecord,
} from "@interior-design/contracts";
import { parseAttribution } from "@interior-design/provenance";

import {
  CanonicalJsonError,
  MAX_CANONICAL_IJSON_INPUT_BYTES,
  canonicalizeIJson,
  parseIJson,
} from "./canonical-json.js";

export type SnapshotCanonicalizationErrorCode =
  "INVALID_SNAPSHOT" | "PROFILE_MISMATCH" | "RECORD_INTEGRITY_MISMATCH" | "ROUND_TRIP_MISMATCH";

export class SnapshotCanonicalizationError extends Error {
  readonly code: SnapshotCanonicalizationErrorCode;

  constructor(code: SnapshotCanonicalizationErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SnapshotCanonicalizationError";
    this.code = code;
  }
}

export interface CanonicalHomeSnapshotDocument {
  readonly canonicalByteLength: number;
  readonly canonicalJson: string;
  readonly snapshot: CanonicalHomeSnapshot;
  readonly snapshotSha256: string;
  /** Returns a fresh copy so callers cannot mutate retained canonical bytes. */
  canonicalBytes(): Uint8Array;
}

export interface CanonicalHomeSnapshotDigest {
  readonly canonicalByteLength: number;
  readonly snapshotSha256: string;
}

export interface VerifiedModelSnapshotRecord {
  readonly canonical: CanonicalHomeSnapshotDocument;
  readonly record: ModelSnapshotRecord;
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isAttributionRecord(value: Record<string, unknown>): boolean {
  return (
    typeof value.claimId === "string" &&
    Array.isArray(value.evidenceIds) &&
    isRecord(value.method) &&
    typeof value.state === "string" &&
    isRecord(value.verification)
  );
}

function assertSnapshotAttributionInvariants(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) assertSnapshotAttributionInvariants(entry);
    return;
  }
  if (!isRecord(value)) return;
  if (isAttributionRecord(value)) parseAttribution(value);
  for (const child of Object.values(value)) assertSnapshotAttributionInvariants(child);
}

/**
 * Validates a JavaScript snapshot without mutating it. I-JSON validation runs
 * before Zod so symbols, accessors, unsupported objects, negative zero, and
 * other values that JSON would silently discard or collapse fail closed.
 */
export function validateCanonicalHomeSnapshot(input: unknown): CanonicalHomeSnapshot {
  canonicalizeIJson(input);
  const result = canonicalHomeSnapshotSchema.safeParse(input);
  if (!result.success) {
    throw new SnapshotCanonicalizationError(
      "INVALID_SNAPSHOT",
      "Snapshot violates the frozen C4 canonical-home contract.",
      { cause: result.error },
    );
  }
  assertSnapshotAttributionInvariants(result.data);
  // Zod returns a detached parsed value. Freezing it guarantees that downstream
  // hashing cannot race a mutation while preserving the caller's original.
  return deepFreeze(result.data);
}

export function parseCanonicalHomeSnapshotJson(input: string | Uint8Array): CanonicalHomeSnapshot {
  return validateCanonicalHomeSnapshot(parseIJson(input));
}

function compareLimitations(left: unknown, right: unknown): number {
  if (!isRecord(left) || !isRecord(right)) return 0;
  const codeComparison = compareCodeUnits(String(left.code), String(right.code));
  return codeComparison === 0
    ? compareCodeUnits(String(left.detail), String(right.detail))
    : codeComparison;
}

function normalizeDomainValue(value: unknown, path: readonly string[]): unknown {
  if (Array.isArray(value)) {
    const normalized = value.map((entry) => normalizeDomainValue(entry, path));
    const memberName = path.at(-1);
    if (memberName === "evidenceIds" || memberName === "boundedByElementIds") {
      return (normalized as string[]).toSorted(compareCodeUnits);
    }
    if (memberName === "limitations" && normalized.every((entry) => typeof entry === "string")) {
      return normalized.toSorted(compareCodeUnits);
    }
    if (memberName === "knownLimitations") return normalized.toSorted(compareLimitations);
    if (path.length === 2 && path[0] === "elements") {
      return normalized.toSorted((left, right) => {
        if (!isRecord(left) || !isRecord(right)) return 0;
        return compareCodeUnits(String(left.id), String(right.id));
      });
    }
    // JCS itself preserves arrays. In particular, polygon/polyline point order
    // and every unlisted sequence remain exactly as authored.
    return normalized;
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, normalizeDomainValue(entry, [...path, key])]),
  );
}

function normalizeCanonicalHomeSnapshot(snapshot: CanonicalHomeSnapshot): CanonicalHomeSnapshot {
  return normalizeDomainValue(snapshot, []) as CanonicalHomeSnapshot;
}

/**
 * Produces the exact snapshot-only canonical bytes, digest, and byte length.
 * Transport/persistence envelope fields never enter this function.
 */
export function canonicalizeHomeSnapshot(input: unknown): CanonicalHomeSnapshotDocument {
  const validated = validateCanonicalHomeSnapshot(input);
  const normalized = deepFreeze(normalizeCanonicalHomeSnapshot(validated));
  const canonicalJson = canonicalizeIJson(normalized);
  const retainedBytes = new TextEncoder().encode(canonicalJson);
  if (retainedBytes.byteLength > MAX_CANONICAL_IJSON_INPUT_BYTES) {
    throw new SnapshotCanonicalizationError(
      "INVALID_SNAPSHOT",
      "Canonical snapshot exceeds the frozen 10 MiB record boundary.",
    );
  }
  const snapshotSha256 = createHash("sha256").update(retainedBytes).digest("hex");
  const document: CanonicalHomeSnapshotDocument = {
    canonicalByteLength: retainedBytes.byteLength,
    canonicalBytes: () => retainedBytes.slice(),
    canonicalJson,
    snapshot: normalized,
    snapshotSha256,
  };
  return Object.freeze(document);
}

export function hashCanonicalHomeSnapshot(input: unknown): CanonicalHomeSnapshotDigest {
  const canonical = canonicalizeHomeSnapshot(input);
  return Object.freeze({
    canonicalByteLength: canonical.canonicalByteLength,
    snapshotSha256: canonical.snapshotSha256,
  });
}

export function canonicalHomeSnapshotBytes(input: unknown): Uint8Array {
  return canonicalizeHomeSnapshot(input).canonicalBytes();
}

export function roundTripCanonicalHomeSnapshot(input: unknown): CanonicalHomeSnapshot {
  const original = canonicalizeHomeSnapshot(input);
  const parsed = parseCanonicalHomeSnapshotJson(original.canonicalBytes());
  const roundTripped = canonicalizeHomeSnapshot(parsed);
  if (
    original.snapshotSha256 !== roundTripped.snapshotSha256 ||
    original.canonicalByteLength !== roundTripped.canonicalByteLength ||
    original.canonicalJson !== roundTripped.canonicalJson
  ) {
    throw new SnapshotCanonicalizationError(
      "ROUND_TRIP_MISMATCH",
      "Canonical snapshot did not survive an exact JSON round trip.",
    );
  }
  return roundTripped.snapshot;
}

/**
 * Recomputes integrity strictly from `record.snapshot`; actor/time/id/version
 * and every other record-envelope field are validated but excluded from hash.
 */
export function verifyModelSnapshotRecord(input: unknown): VerifiedModelSnapshotRecord {
  canonicalizeIJson(input);
  const result = modelSnapshotRecordSchema.safeParse(input);
  if (!result.success) {
    throw new SnapshotCanonicalizationError(
      "INVALID_SNAPSHOT",
      "Snapshot record violates the frozen C4 record contract.",
      { cause: result.error },
    );
  }
  const canonical = canonicalizeHomeSnapshot(result.data.snapshot);
  if (
    canonical.snapshotSha256 !== result.data.snapshotSha256 ||
    canonical.canonicalByteLength !== result.data.canonicalByteLength
  ) {
    throw new SnapshotCanonicalizationError(
      "RECORD_INTEGRITY_MISMATCH",
      "Stored snapshot hash or canonical byte length does not match the snapshot bytes.",
    );
  }
  return deepFreeze({ canonical, record: result.data });
}

export function assertCanonicalHomeSnapshotProfile(
  input: unknown,
  expectedProfile: ModelProfile,
): CanonicalHomeSnapshot {
  const parsedProfile = modelProfileSchema.parse(expectedProfile);
  const snapshot = validateCanonicalHomeSnapshot(input);
  if (snapshot.profile !== parsedProfile) {
    throw new SnapshotCanonicalizationError(
      "PROFILE_MISMATCH",
      `Expected the ${parsedProfile} profile but received ${snapshot.profile}.`,
    );
  }
  return snapshot;
}

/**
 * Selects an explicitly requested profile without falling back to another
 * profile. Every populated slot is checked against its map key first.
 */
export function selectCanonicalHomeSnapshotForProfile(
  profiles: Readonly<Partial<Record<ModelProfile, unknown>>>,
  requestedProfile: ModelProfile,
): CanonicalHomeSnapshot | undefined {
  const profile = modelProfileSchema.parse(requestedProfile);
  for (const candidateProfile of modelProfileSchema.options) {
    const candidate = profiles[candidateProfile];
    if (candidate !== undefined) {
      assertCanonicalHomeSnapshotProfile(candidate, candidateProfile);
    }
  }
  const selected = profiles[profile];
  return selected === undefined ? undefined : assertCanonicalHomeSnapshotProfile(selected, profile);
}

export function isCanonicalJsonError(error: unknown): error is CanonicalJsonError {
  return error instanceof CanonicalJsonError;
}
