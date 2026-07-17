import { c4SchemaVersion } from "../src/index.js";

export const syntheticIds = Object.freeze({
  actor: "20000000-0000-4000-8000-000000000001",
  evidenceA: "81000000-0000-4000-8000-000000000001",
  evidenceB: "81000000-0000-4000-8000-000000000002",
  level: "92000000-0000-4000-8000-000000000010",
  model: "93000000-0000-4000-8000-000000000001",
  project: "30000000-0000-4000-8000-000000000001",
  space: "92000000-0000-4000-8000-000000000100",
  wallA: "92000000-0000-4000-8000-000000000201",
  wallB: "92000000-0000-4000-8000-000000000202",
});

function claimId(sequence: number): string {
  return `91000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

const manualMethod = Object.freeze({
  kind: "manual" as const,
  name: "Synthetic fixture author",
  version: "c4-v1",
});
const notReviewed = Object.freeze({ status: "not-reviewed" as const });

function userAttribution(sequence: number, reviewed = false) {
  return {
    actorUserId: syntheticIds.actor,
    claimId: claimId(sequence),
    evidenceIds: [syntheticIds.evidenceB, syntheticIds.evidenceA],
    method: manualMethod,
    state: "user-asserted" as const,
    verification: reviewed
      ? {
          limitations: ["Concept review excludes setting out.", "Accuracy remains source-limited."],
          purpose: "concept" as const,
          reviewedAt: "2026-07-17T10:00:00.000Z",
          reviewedBy: syntheticIds.actor,
          status: "reviewed-with-limitations" as const,
        }
      : notReviewed,
  };
}

function observedAttribution(sequence: number) {
  return {
    claimId: claimId(sequence),
    evidenceIds: [syntheticIds.evidenceB, syntheticIds.evidenceA],
    method: {
      kind: "fixture" as const,
      name: "Provider-free synthetic observation",
      version: "c4-v1",
    },
    observedAt: "2026-07-17T09:00:00.000Z",
    state: "observed" as const,
    verification: notReviewed,
  };
}

function known<T>(value: T, sequence: number, reviewed = false) {
  return {
    attribution: userAttribution(sequence, reviewed),
    knowledge: "known" as const,
    value,
  };
}

function observed<T>(value: T, sequence: number) {
  return {
    attribution: observedAttribution(sequence),
    knowledge: "known" as const,
    value,
  };
}

function unknown(sequence: number) {
  return {
    attribution: {
      claimId: claimId(sequence),
      evidenceIds: [syntheticIds.evidenceB, syntheticIds.evidenceA],
      method: {
        kind: "system" as const,
        name: "Unknown-preserving synthetic fixture",
        version: "c4-v1",
      },
      reason: "conflicting-evidence" as const,
      state: "unknown" as const,
      verification: notReviewed,
    },
    knowledge: "unknown" as const,
  };
}

export const syntheticCanonicalSnapshot = {
  coordinateSystem: {
    axes: { x: "east", y: "north", z: "up" },
    globalAnchor: { status: "not-established" },
    handedness: "right",
    kind: "local-cartesian",
    lengthUnit: "mm",
    originConvention: "project-local-model-origin",
  },
  elements: {
    cameras: [],
    finishes: [],
    fixedObjects: [],
    furnishings: [],
    levels: [
      {
        elementType: "level",
        elevationMm: known(0, 2),
        id: syntheticIds.level,
        name: known("Synthetic ground level", 1, true),
        origin: userAttribution(3),
        storeyHeightMm: unknown(4),
      },
    ],
    lights: [],
    openings: [],
    spaces: [
      {
        boundary: observed(
          [
            { xMm: 0, yMm: 0 },
            { xMm: 4_000, yMm: 0 },
            { xMm: 4_000, yMm: 3_000 },
            { xMm: 0, yMm: 3_000 },
          ],
          10,
        ),
        boundedByElementIds: [syntheticIds.wallB, syntheticIds.wallA],
        classification: known("Unassigned synthetic room", 11),
        elementType: "space",
        id: syntheticIds.space,
        levelId: syntheticIds.level,
        name: known("Synthetic room", 12),
        origin: userAttribution(13),
      },
    ],
    stairs: [],
    surfaces: [],
    walls: [
      {
        alignment: "centre",
        baseOffsetMm: known(0, 20),
        elementType: "wall",
        heightMm: unknown(21),
        id: syntheticIds.wallB,
        levelId: syntheticIds.level,
        name: known("Synthetic north wall", 22),
        origin: userAttribution(23),
        path: observed(
          [
            { xMm: 4_000, yMm: 3_000 },
            { xMm: 0, yMm: 3_000 },
          ],
          24,
        ),
        thicknessMm: unknown(25),
      },
      {
        alignment: "centre",
        baseOffsetMm: known(0, 30),
        elementType: "wall",
        heightMm: unknown(31),
        id: syntheticIds.wallA,
        levelId: syntheticIds.level,
        name: known("Synthetic south wall", 32),
        origin: userAttribution(33),
        path: observed(
          [
            { xMm: 0, yMm: 0 },
            { xMm: 4_000, yMm: 0 },
          ],
          34,
        ),
        thicknessMm: unknown(35),
      },
    ],
  },
  knownLimitations: [
    { code: "WALL_HEIGHT_UNKNOWN", detail: "No wall height is established." },
    { code: "INTERIOR_INCOMPLETE", detail: "The synthetic model is deliberately partial." },
  ],
  modelId: syntheticIds.model,
  profile: "existing",
  projectId: syntheticIds.project,
  schemaVersion: c4SchemaVersion,
} as const;

export function reverseObjectInsertionOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => reverseObjectInsertionOrder(entry));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .toReversed()
      .map(([key, entry]) => [key, reverseObjectInsertionOrder(entry)]),
  );
}
