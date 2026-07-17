import { createHash } from "node:crypto";

function canonicalValue(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("Canonical capture JSON rejects non-finite numbers.");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalValue(entry)}`)
      .join(",")}}`;
  }
  throw new Error("Canonical capture JSON received an unsupported value.");
}

export function canonicalCaptureJson(value: unknown): string {
  return canonicalValue(value);
}

export function captureSha256(value: unknown): string {
  return createHash("sha256").update(canonicalCaptureJson(value), "utf8").digest("hex");
}
