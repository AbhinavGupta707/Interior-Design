import {
  canonicalHomeSnapshotSchema,
  c4SchemaVersion,
  createModelSnapshotRequestSchema,
  modelProfileSchema,
} from "../src/index.js";
import { describe, expect, it } from "vitest";

const ids = {
  actor: "20000000-0000-4000-8000-000000000001",
  claim: "91000000-0000-4000-8000-000000000001",
  level: "92000000-0000-4000-8000-000000000001",
  model: "93000000-0000-4000-8000-000000000001",
  project: "30000000-0000-4000-8000-000000000001",
};

const method = { kind: "manual" as const, name: "Synthetic fixture author", version: "c4-v1" };
const verification = { status: "not-reviewed" as const };
const userAttribution = {
  actorUserId: ids.actor,
  claimId: ids.claim,
  evidenceIds: [],
  method,
  state: "user-asserted" as const,
  verification,
};
const known = <T>(value: T) => ({
  attribution: userAttribution,
  knowledge: "known" as const,
  value,
});
const unknown = (claimId: string) => ({
  attribution: {
    claimId,
    evidenceIds: [],
    method: { kind: "system" as const, name: "Unknown-preserving fixture", version: "c4-v1" },
    reason: "not-observed" as const,
    state: "unknown" as const,
    verification,
  },
  knowledge: "unknown" as const,
});

const baseSnapshot = {
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
        elevationMm: known(0),
        id: ids.level,
        name: known("Ground floor"),
        origin: userAttribution,
        storeyHeightMm: unknown("91000000-0000-4000-8000-000000000002"),
      },
    ],
    lights: [],
    openings: [],
    spaces: [],
    stairs: [],
    surfaces: [],
    walls: [],
  },
  knownLimitations: [
    { code: "INTERIOR_INCOMPLETE", detail: "No current wall geometry is established." },
  ],
  modelId: ids.model,
  profile: "existing",
  projectId: ids.project,
  schemaVersion: c4SchemaVersion,
};

describe("C4 frozen canonical-model contract", () => {
  it("accepts an explicit unknown without inventing a storey height", () => {
    const parsed = canonicalHomeSnapshotSchema.parse(baseSnapshot);
    expect(parsed.elements.levels[0]?.storeyHeightMm.knowledge).toBe("unknown");
  });

  it("keeps existing, proposed and as-built profiles distinct", () => {
    expect(modelProfileSchema.options).toEqual(["existing", "proposed", "as-built"]);
    expect(
      canonicalHomeSnapshotSchema.safeParse({
        ...baseSnapshot,
        derivedFromSnapshotSha256: "a".repeat(64),
      }).success,
    ).toBe(false);
    expect(
      canonicalHomeSnapshotSchema.safeParse({ ...baseSnapshot, profile: "proposed" }).success,
    ).toBe(false);
  });

  it("rejects fused or inferred values without bounded confidence and evidence", () => {
    const hostile = {
      ...baseSnapshot,
      elements: {
        ...baseSnapshot.elements,
        levels: [
          {
            ...baseSnapshot.elements.levels[0],
            elevationMm: {
              attribution: {
                claimId: ids.claim,
                evidenceIds: [],
                method,
                state: "inferred",
                verification,
              },
              knowledge: "known",
              value: 0,
            },
          },
        ],
      },
    };
    expect(canonicalHomeSnapshotSchema.safeParse(hostile).success).toBe(false);
  });

  it("rejects duplicate IDs across element collections", () => {
    const hostile = {
      ...baseSnapshot,
      elements: {
        ...baseSnapshot.elements,
        cameras: [
          {
            elementType: "camera",
            id: ids.level,
            levelId: ids.level,
            name: known("Duplicate camera"),
            origin: userAttribution,
            position: known({ xMm: 0, yMm: 0, zMm: 1_500 }),
            target: known({ xMm: 1_000, yMm: 0, zMm: 1_500 }),
            verticalFovMilliDegrees: known(60_000),
          },
        ],
      },
    };
    expect(canonicalHomeSnapshotSchema.safeParse(hostile).success).toBe(false);
  });

  it("requires explicit optimistic state when creating a snapshot", () => {
    expect(
      createModelSnapshotRequestSchema.parse({
        expectedCurrentSnapshotSha256: null,
        snapshot: baseSnapshot,
      }).expectedCurrentSnapshotSha256,
    ).toBeNull();
  });
});
