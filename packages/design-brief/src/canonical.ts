import { designBriefSchema, type DesignBrief } from "@interior-design/contracts";
import { createHash } from "node:crypto";

import { DesignBriefDomainError } from "./errors.js";

export const maximumCanonicalBriefBytes = 1_048_576;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new DesignBriefDomainError("BRIEF_INVALID_PATCH");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  throw new DesignBriefDomainError("BRIEF_INVALID_PATCH");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertUnique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) {
    throw new DesignBriefDomainError("BRIEF_INVALID_PATCH");
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function canonicalizeDesignBrief(value: unknown): DesignBrief {
  const parsed = designBriefSchema.safeParse(value);
  if (!parsed.success) throw new DesignBriefDomainError("BRIEF_INVALID_PATCH");
  const brief = parsed.data;
  const entries = brief.entries
    .map((entry) => {
      assertUnique(entry.roomOrLevelElementIds);
      return {
        ...entry,
        roomOrLevelElementIds: [...entry.roomOrLevelElementIds].sort((left, right) =>
          left.localeCompare(right),
        ),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  const referenceBoard = [...brief.referenceBoard].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  return deepFreeze(designBriefSchema.parse({ ...brief, entries, referenceBoard }));
}

export interface CanonicalBriefSnapshot {
  readonly brief: DesignBrief;
  readonly canonicalByteLength: number;
  readonly contentSha256: string;
  readonly snapshotSha256: string;
}

export function canonicalBriefSnapshot(value: unknown): CanonicalBriefSnapshot {
  const brief = canonicalizeDesignBrief(value);
  const content = {
    entries: brief.entries,
    id: brief.id,
    ...(brief.modelReference === undefined ? {} : { modelReference: brief.modelReference }),
    projectId: brief.projectId,
    referenceBoard: brief.referenceBoard,
    schemaVersion: brief.schemaVersion,
  };
  const contentJson = canonicalJson(content);
  const snapshotJson = canonicalJson(brief);
  const canonicalByteLength = Buffer.byteLength(snapshotJson, "utf8");
  if (canonicalByteLength > maximumCanonicalBriefBytes) {
    throw new DesignBriefDomainError("BRIEF_RESOURCE_LIMIT");
  }
  return Object.freeze({
    brief,
    canonicalByteLength,
    contentSha256: sha256(contentJson),
    snapshotSha256: sha256(snapshotJson),
  });
}

export function canonicalDesignBriefJson(value: unknown): string {
  return canonicalJson(canonicalizeDesignBrief(value));
}
