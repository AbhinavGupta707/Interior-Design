import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { createCaptureEnvelopeRequestSchema } from "../src/index.js";

type JsonObject = Record<string, unknown>;
type Mutation = {
  readonly from?: string;
  readonly operation: "append" | "append-copy" | "remove" | "set" | "uppercase-uuids";
  readonly path?: string;
  readonly value?: unknown;
};
type GoldenCase = {
  readonly expected: "invalid" | "valid";
  readonly id: string;
  readonly mutations: readonly Mutation[];
  readonly sameCanonicalAsBase?: boolean;
};
type Manifest = {
  readonly baseFile: string;
  readonly cases: readonly GoldenCase[];
  readonly expectedCanonicalByteLength: number;
  readonly expectedCanonicalSha256: string;
  readonly schemaVersion: "capture-envelope-golden-cases-v1";
};

const fixtureRoot = new URL("../fixtures/capture-envelope-v1/", import.meta.url);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return JSON.stringify(Object.is(value, -0) ? 0 : value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  throw new Error("Unsupported canonical JSON value");
}

function resolvePointer(
  root: unknown,
  pointer: string,
): { key: string; parent: JsonObject | unknown[] } {
  const tokens = pointer
    .split("/")
    .slice(1)
    .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));
  const key = tokens.pop();
  if (key === undefined) throw new Error(`Invalid JSON pointer ${pointer}`);
  let parent = root;
  for (const token of tokens) {
    if (Array.isArray(parent)) parent = parent[Number(token)];
    else parent = (parent as JsonObject)[token];
  }
  if (!Array.isArray(parent) && (typeof parent !== "object" || parent === null)) {
    throw new Error(`Pointer parent is not a container: ${pointer}`);
  }
  return { key, parent: parent as JsonObject | unknown[] };
}

function readPointer(root: unknown, pointer: string): unknown {
  const { key, parent } = resolvePointer(root, pointer);
  return Array.isArray(parent) ? parent[Number(key)] : parent[key];
}

function applyMutations(base: unknown, mutations: readonly Mutation[]): unknown {
  let value = clone(base);
  for (const mutation of mutations) {
    if (mutation.operation === "uppercase-uuids") {
      value = JSON.parse(
        JSON.stringify(value).replace(
          /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu,
          (uuid) => uuid.toUpperCase(),
        ),
      ) as unknown;
      continue;
    }
    if (mutation.path === undefined) throw new Error("Mutation path is required");
    if (mutation.operation === "append" || mutation.operation === "append-copy") {
      const target = readPointer(value, mutation.path);
      if (!Array.isArray(target))
        throw new Error(`Append target is not an array: ${mutation.path}`);
      const appended =
        mutation.operation === "append-copy"
          ? readPointer(value, mutation.from ?? "")
          : mutation.value;
      target.push(clone(appended));
      continue;
    }
    const { key, parent } = resolvePointer(value, mutation.path);
    if (mutation.operation === "remove") {
      if (Array.isArray(parent)) parent.splice(Number(key), 1);
      else Reflect.deleteProperty(parent, key);
    } else if (Array.isArray(parent)) parent[Number(key)] = clone(mutation.value);
    else parent[key] = clone(mutation.value);
  }
  return value;
}

describe("capture-envelope-v1 cross-language goldens", () => {
  it("freezes canonical UTF-8 bytes and matching adversarial verdicts", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("cases.json", fixtureRoot), "utf8"),
    ) as Manifest;
    const base = JSON.parse(
      await readFile(new URL(manifest.baseFile, fixtureRoot), "utf8"),
    ) as unknown;
    const parsedBase = createCaptureEnvelopeRequestSchema.parse(base);
    const baseBytes = Buffer.from(canonicalJson(parsedBase), "utf8");
    const baseHash = createHash("sha256").update(baseBytes).digest("hex");

    expect(manifest.schemaVersion).toBe("capture-envelope-golden-cases-v1");
    expect(baseBytes.byteLength).toBe(manifest.expectedCanonicalByteLength);
    expect(baseHash).toBe(manifest.expectedCanonicalSha256);

    for (const fixture of manifest.cases) {
      const input = applyMutations(base, fixture.mutations);
      const result = createCaptureEnvelopeRequestSchema.safeParse(input);
      expect(result.success, fixture.id).toBe(fixture.expected === "valid");
      if (result.success && fixture.sameCanonicalAsBase === true) {
        const bytes = Buffer.from(canonicalJson(result.data), "utf8");
        expect(bytes.equals(baseBytes), fixture.id).toBe(true);
        expect(createHash("sha256").update(bytes).digest("hex"), fixture.id).toBe(baseHash);
      }
    }
  });
});
