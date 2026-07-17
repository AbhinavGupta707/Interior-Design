import {
  canonicalHomeSnapshotSchema,
  type CanonicalHomeSnapshot,
} from "@interior-design/contracts";

type JsonPrimitive = boolean | null | number | string;
type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

const entityCollectionNames = new Set([
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

const referenceSetNames = new Set(["boundedByElementIds", "evidenceIds"]);

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

function asJsonObject(value: JsonValue): { readonly [key: string]: JsonValue } | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as { readonly [key: string]: JsonValue })
    : undefined;
}

function asJsonString(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function normaliseArray(values: readonly JsonValue[], path: readonly string[]): JsonValue[] {
  const normalised = values.map((value, index) => normaliseJson(value, [...path, String(index)]));
  const parent = path.at(-1);
  if (parent !== undefined && referenceSetNames.has(parent)) {
    return normalised.sort((left, right) => compareText(asJsonString(left), asJsonString(right)));
  }
  if (path.length === 2 && path[0] === "elements" && entityCollectionNames.has(parent ?? "")) {
    return normalised.sort((left, right) => {
      const leftId = asJsonString(asJsonObject(left)?.id);
      const rightId = asJsonString(asJsonObject(right)?.id);
      return compareText(leftId, rightId);
    });
  }
  if (path.length === 1 && parent === "knownLimitations") {
    return normalised.sort((left, right) => {
      const leftObject = asJsonObject(left);
      const rightObject = asJsonObject(right);
      const leftKey = `${asJsonString(leftObject?.code)}\u0000${asJsonString(leftObject?.detail)}`;
      const rightKey = `${asJsonString(rightObject?.code)}\u0000${asJsonString(rightObject?.detail)}`;
      return compareText(leftKey, rightKey);
    });
  }
  return normalised;
}

function normaliseJson(value: JsonValue, path: readonly string[]): JsonValue {
  if (Array.isArray(value)) {
    return normaliseArray(value, path);
  }
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, JsonValue> = {};
    const objectValue = value as { readonly [key: string]: JsonValue };
    for (const key of Object.keys(objectValue).sort(compareText)) {
      const child = objectValue[key];
      if (child !== undefined) {
        sorted[key] = normaliseJson(child, [...path, key]);
      }
    }
    return sorted;
  }
  return value;
}

/**
 * Independent fixture oracle for the frozen C4 canonical ordering contract.
 * Production code must not import this evaluator implementation.
 */
export function referenceCanonicalSnapshot(snapshot: CanonicalHomeSnapshot): CanonicalHomeSnapshot {
  const validated = canonicalHomeSnapshotSchema.parse(snapshot);
  return normaliseJson(validated as unknown as JsonValue, []) as CanonicalHomeSnapshot;
}

export function referenceCanonicalJson(snapshot: CanonicalHomeSnapshot): string {
  return JSON.stringify(referenceCanonicalSnapshot(snapshot));
}

export async function referenceSnapshotSha256(snapshot: CanonicalHomeSnapshot): Promise<string> {
  const bytes = new TextEncoder().encode(referenceCanonicalJson(snapshot));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function referenceCanonicalByteLength(snapshot: CanonicalHomeSnapshot): number {
  return new TextEncoder().encode(referenceCanonicalJson(snapshot)).byteLength;
}
