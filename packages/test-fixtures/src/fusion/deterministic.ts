import { createHash } from "node:crypto";

export function fusionFixtureUuid(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > 999_999_999_999) {
    throw new Error("C9_FIXTURE_UUID_SEQUENCE_INVALID");
  }
  return `c9000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

export function deterministicSha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new Error("C9_FIXTURE_NON_FINITE_OR_NON_INTEGER");
    }
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (typeof value !== "object") throw new Error("C9_FIXTURE_VALUE_INVALID");
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(",")}}`;
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
