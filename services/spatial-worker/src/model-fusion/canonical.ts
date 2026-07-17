import {
  canonicalHomeSnapshotSchema,
  type CanonicalHomeSnapshot,
} from "@interior-design/contracts";
import { createHash } from "node:crypto";

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareLimitations(left: unknown, right: unknown): number {
  if (!isRecord(left) || !isRecord(right)) return 0;
  const code = compareCodeUnits(String(left.code), String(right.code));
  return code === 0 ? compareCodeUnits(String(left.detail), String(right.detail)) : code;
}

function normalizeDomainValue(value: unknown, path: readonly string[]): unknown {
  if (Array.isArray(value)) {
    const normalized = value.map((entry) => normalizeDomainValue(entry, path));
    const member = path.at(-1);
    if (member === "evidenceIds" || member === "boundedByElementIds") {
      return (normalized as string[]).toSorted(compareCodeUnits);
    }
    if (member === "limitations" && normalized.every((entry) => typeof entry === "string")) {
      return normalized.toSorted(compareCodeUnits);
    }
    if (member === "knownLimitations") return normalized.toSorted(compareLimitations);
    if (path.length === 2 && path[0] === "elements") {
      return normalized.toSorted((left, right) =>
        isRecord(left) && isRecord(right) ? compareCodeUnits(String(left.id), String(right.id)) : 0,
      );
    }
    return normalized;
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, normalizeDomainValue(entry, [...path, key])]),
  );
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0) || !Number.isSafeInteger(value)) {
      throw new TypeError("Canonical C9 snapshot numbers must be finite safe integers without -0.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .toSorted(compareCodeUnits)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("Canonical C9 snapshots must contain JSON values only.");
}

export function canonicalSnapshotSha256(value: CanonicalHomeSnapshot): string {
  const snapshot = canonicalHomeSnapshotSchema.parse(value);
  const normalized = normalizeDomainValue(snapshot, []);
  const bytes = Buffer.from(canonicalJson(normalized), "utf8");
  if (bytes.byteLength > 10_485_760) {
    throw new TypeError("Canonical C9 candidate snapshot exceeds 10 MiB.");
  }
  return createHash("sha256").update(bytes).digest("hex");
}
