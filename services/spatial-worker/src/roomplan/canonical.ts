import { createHash } from "node:crypto";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("Canonical RoomPlan JSON rejects non-finite values.");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  throw new Error("Canonical RoomPlan JSON received an unsupported value.");
}

export function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function deterministicUuid(namespace: string, value: string): string {
  const hex = createHash("sha256").update(namespace).update("\0").update(value).digest("hex");
  const bytes = Uint8Array.from(Buffer.from(hex.slice(0, 32), "hex"));
  const versionByte = bytes[6];
  const variantByte = bytes[8];
  if (versionByte === undefined || variantByte === undefined)
    throw new Error("UUID digest is short.");
  bytes[6] = (versionByte & 0x0f) | 0x50;
  bytes[8] = (variantByte & 0x3f) | 0x80;
  const output = Buffer.from(bytes).toString("hex");
  return `${output.slice(0, 8)}-${output.slice(8, 12)}-${output.slice(12, 16)}-${output.slice(16, 20)}-${output.slice(20, 32)}`;
}
