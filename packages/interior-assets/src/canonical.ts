/// <reference types="node" />

import { createHash } from "node:crypto";

import { InteriorAssetError } from "./errors.js";

export interface BoundedJsonLimits {
  readonly maximumArrayLength: number;
  readonly maximumDepth: number;
  readonly maximumNodes: number;
  readonly maximumProperties: number;
  readonly maximumStringCodeUnits: number;
}

export const assetJsonLimits = Object.freeze({
  maximumArrayLength: 2_048,
  maximumDepth: 24,
  maximumNodes: 25_000,
  maximumProperties: 50_000,
  maximumStringCodeUnits: 160_000,
} satisfies BoundedJsonLimits);

export const maximumAssetCatalogBytes = 524_288;

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertSafeScalarString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (
      codeUnit <= 0x1f ||
      (codeUnit >= 0x7f && codeUnit <= 0x9f) ||
      (codeUnit >= 0x202a && codeUnit <= 0x202e) ||
      (codeUnit >= 0x2066 && codeUnit <= 0x2069)
    ) {
      throw new InteriorAssetError("ASSET_METADATA_HOSTILE");
    }
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new InteriorAssetError("ASSET_METADATA_HOSTILE");
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new InteriorAssetError("ASSET_METADATA_HOSTILE");
    }
  }
}

interface JsonBudget {
  nodes: number;
  properties: number;
  stringCodeUnits: number;
}

function assertPlainJsonValue(
  value: unknown,
  ancestors: WeakSet<object>,
  depth: number,
  budget: JsonBudget,
  limits: BoundedJsonLimits,
): void {
  budget.nodes += 1;
  if (depth > limits.maximumDepth || budget.nodes > limits.maximumNodes) {
    throw new InteriorAssetError("ASSET_RESOURCE_LIMIT");
  }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    budget.stringCodeUnits += value.length;
    if (budget.stringCodeUnits > limits.maximumStringCodeUnits) {
      throw new InteriorAssetError("ASSET_RESOURCE_LIMIT");
    }
    assertSafeScalarString(value);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0) || !Number.isSafeInteger(value)) {
      throw new InteriorAssetError("ASSET_INPUT_MALFORMED");
    }
    return;
  }
  if (typeof value !== "object") {
    throw new InteriorAssetError("ASSET_INPUT_MALFORMED");
  }
  if (ancestors.has(value)) throw new InteriorAssetError("ASSET_INPUT_MALFORMED");

  const prototype: unknown = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype || value.length > limits.maximumArrayLength) {
      throw new InteriorAssetError("ASSET_RESOURCE_LIMIT");
    }
  } else if (prototype !== Object.prototype && prototype !== null) {
    throw new InteriorAssetError("ASSET_INPUT_MALFORMED");
  }

  ancestors.add(value);
  try {
    const ownKeys = Reflect.ownKeys(value);
    budget.properties += ownKeys.length;
    if (budget.properties > limits.maximumProperties) {
      throw new InteriorAssetError("ASSET_RESOURCE_LIMIT");
    }
    if (ownKeys.some((key) => typeof key === "symbol")) {
      throw new InteriorAssetError("ASSET_INPUT_MALFORMED");
    }
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw new InteriorAssetError("ASSET_INPUT_MALFORMED");
      }
      for (const key of ownKeys) {
        if (key === "length") continue;
        if (
          typeof key !== "string" ||
          !/^(?:0|[1-9][0-9]*)$/u.test(key) ||
          Number(key) >= value.length
        ) {
          throw new InteriorAssetError("ASSET_INPUT_MALFORMED");
        }
      }
    }
    for (const key of ownKeys) {
      if (Array.isArray(value) && key === "length") continue;
      if (typeof key !== "string") throw new InteriorAssetError("ASSET_INPUT_MALFORMED");
      assertSafeScalarString(key);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        throw new InteriorAssetError("ASSET_INPUT_MALFORMED");
      }
      assertPlainJsonValue(descriptor.value, ancestors, depth + 1, budget, limits);
    }
  } finally {
    ancestors.delete(value);
  }
}

export function assertBoundedPlainJson(
  value: unknown,
  limits: BoundedJsonLimits = assetJsonLimits,
): void {
  assertPlainJsonValue(
    value,
    new WeakSet<object>(),
    0,
    { nodes: 0, properties: 0, stringCodeUnits: 0 },
    limits,
  );
}

function serializeCanonical(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(serializeCanonical).join(",")}]`;
  if (typeof value !== "object") throw new InteriorAssetError("ASSET_INPUT_MALFORMED");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort(compareStrings)
    .map((key) => `${JSON.stringify(key)}:${serializeCanonical(record[key])}`)
    .join(",")}}`;
}

export function canonicalAssetJson(value: unknown): string {
  assertBoundedPlainJson(value);
  return serializeCanonical(value);
}

export function assetSha256(value: unknown): string {
  return createHash("sha256").update(canonicalAssetJson(value), "utf8").digest("hex");
}

export function deterministicC12Uuid(namespace: string): string {
  assertSafeScalarString(namespace);
  const bytes = Buffer.from(
    createHash("sha256").update(namespace, "utf8").digest().subarray(0, 16),
  );
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function deepFreezeAssetValue<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreezeAssetValue(child);
  return Object.freeze(value);
}
