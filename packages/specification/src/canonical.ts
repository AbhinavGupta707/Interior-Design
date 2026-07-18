import { canonicalizeIJson } from "@interior-design/domain-model";
import { createHash } from "node:crypto";

export function compareIdentifiers(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function specificationSha256(value: unknown): string {
  return createHash("sha256").update(canonicalizeIJson(value), "utf8").digest("hex");
}

export function deterministicSpecificationUuid(
  namespace: string,
  ...parts: readonly string[]
): string {
  const bytes = createHash("sha256")
    .update(namespace, "utf8")
    .update("\u0000", "utf8")
    .update(parts.join("\u0000"), "utf8")
    .digest();
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
