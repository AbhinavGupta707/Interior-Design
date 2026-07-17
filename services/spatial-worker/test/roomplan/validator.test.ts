import type { RoomPlanNormalized } from "@interior-design/contracts";
import { describe, expect, it } from "vitest";

import {
  RoomPlanValidationError,
  validateRoomPlanNormalized,
  type RoomPlanValidationContext,
} from "../../src/roomplan/validator.js";
import { SYNTHETIC_IDS, syntheticNormalized, syntheticSources } from "./fixtures.js";

type DeepMutable<T> = T extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
    : T;
type MutableNormalized = DeepMutable<RoomPlanNormalized>;
type Mutation = (value: MutableNormalized) => void;

function present<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("The synthetic validator fixture is incomplete.");
  return value;
}

function surface(value: MutableNormalized, index: number) {
  return present(value.surfaces[index]);
}

function object(value: MutableNormalized, index: number) {
  return present(value.objects[index]);
}

function room(value: MutableNormalized, index: number) {
  return present(value.rooms[index]);
}

function measurement(value: MutableNormalized, index: number) {
  return present(value.referenceMeasurements[index]);
}

function validationContext(): RoomPlanValidationContext {
  const sources = syntheticSources();
  const normalized = sources.artifacts.find(({ kind }) => kind === "roomplan-normalized-json");
  if (normalized === undefined) throw new Error("Synthetic normalized artifact is absent.");
  return {
    actualNormalizedSha256: normalized.sha256,
    captureSessionId: SYNTHETIC_IDS.captureSession,
    expectedNormalizedSha256: normalized.sha256,
    manifest: sources.manifest,
    projectId: SYNTHETIC_IDS.project,
  };
}

function mutableNormalized(): MutableNormalized {
  return structuredClone(syntheticNormalized());
}

function expectCode(
  input: unknown,
  code: RoomPlanValidationError["code"],
  context: RoomPlanValidationContext = validationContext(),
): void {
  try {
    validateRoomPlanNormalized(input, context);
    throw new Error("Expected normalized input rejection.");
  } catch (error) {
    expect(error).toBeInstanceOf(RoomPlanValidationError);
    expect((error as RoomPlanValidationError).code).toBe(code);
  }
}

describe("validateRoomPlanNormalized", () => {
  it("accepts the complete visibly synthetic fixture", () => {
    const value = validateRoomPlanNormalized(syntheticNormalized(), validationContext());
    expect(value.schemaVersion).toBe("c7-roomplan-normalized-v1");
    expect(value.surfaces).toHaveLength(3);
  });

  it("binds the normalized source bytes, project, session, rooms, quality, and measurements", () => {
    const hashContext = validationContext();
    expect(() =>
      validateRoomPlanNormalized(syntheticNormalized(), {
        ...hashContext,
        actualNormalizedSha256: "0".repeat(64),
      }),
    ).toThrow(/source bytes/u);

    const mutations: Mutation[] = [
      (value) => {
        value.projectId = "10000000-0000-4000-8000-000000000099";
      },
      (value) => {
        room(value, 0).userLabel = "Substituted room";
      },
      (value) => {
        value.quality.scanDurationMilliseconds = 1;
      },
      (value) => {
        value.referenceMeasurements = [];
      },
    ];
    for (const mutate of mutations) {
      const input = mutableNormalized();
      mutate(input);
      expectCode(input, "source-mismatch");
    }
  });

  it("rejects floats, non-finite values, excessive counts, and out-of-range coordinates", () => {
    const mutations: Mutation[] = [
      (value) => {
        surface(value, 0).transform.translationMicrometres.x = 0.5;
      },
      (value) => {
        surface(value, 0).transform.translationMicrometres.x = Infinity;
      },
      (value) => {
        surface(value, 0).transform.translationMicrometres.x = 1_000_000_001;
      },
      (value) => {
        surface(value, 1).polygonCornersMicrometres = Array.from({ length: 257 }, (_, index) => ({
          x: index,
          y: 0,
          z: 0,
        }));
      },
      (value) => {
        value.quality.lowConfidenceSurfaceCount = value.surfaces.length + 1;
      },
      (value) => {
        value.quality.lowConfidenceObjectCount = value.objects.length + 1;
      },
    ];
    for (const mutate of mutations) {
      const input = mutableNormalized();
      mutate(input);
      expectCode(input, "invalid-normalized-input");
    }
  });

  it("rejects duplicate entities, source rooms, edges, corners, and measurement identifiers", () => {
    const mutations: Mutation[] = [
      (value) => {
        object(value, 0).sourceIdentifier = surface(value, 0).sourceIdentifier;
      },
      (value) => {
        surface(value, 0).completedEdges.push("top");
      },
      (value) => {
        surface(value, 1).polygonCornersMicrometres = [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 0, y: 0, z: 0 },
        ];
      },
    ];
    for (const mutate of mutations) {
      const input = mutableNormalized();
      mutate(input);
      expectCode(input, "invalid-normalized-input");
    }

    const duplicateRooms = mutableNormalized();
    duplicateRooms.rooms.push({
      ...room(duplicateRooms, 0),
      roomId: SYNTHETIC_IDS.tenant,
      sequence: 2,
    });
    duplicateRooms.structureIdentifier = SYNTHETIC_IDS.tenant;
    const roomContext = validationContext();
    expectCode(duplicateRooms, "invalid-normalized-input", {
      ...roomContext,
      manifest: {
        ...roomContext.manifest,
        mode: "structure",
        rooms: duplicateRooms.rooms,
        sharedWorldOrigin: true,
      },
    });

    const duplicateMeasurements = mutableNormalized();
    duplicateMeasurements.referenceMeasurements.push(measurement(duplicateMeasurements, 0));
    const measurementContext = validationContext();
    expectCode(duplicateMeasurements, "invalid-normalized-input", {
      ...measurementContext,
      manifest: {
        ...measurementContext.manifest,
        referenceMeasurements: duplicateMeasurements.referenceMeasurements,
      },
    });
  });

  it("rejects broken, self, cyclic, and incompatible opening parent references", () => {
    const mutations: Mutation[] = [
      (value) => {
        object(value, 0).parentSourceIdentifier = SYNTHETIC_IDS.tenant;
      },
      (value) => {
        object(value, 0).parentSourceIdentifier = object(value, 0).sourceIdentifier;
      },
      (value) => {
        surface(value, 0).parentSourceIdentifier = object(value, 0).sourceIdentifier;
        object(value, 0).parentSourceIdentifier = surface(value, 0).sourceIdentifier;
      },
      (value) => {
        surface(value, 2).parentSourceIdentifier = surface(value, 1).sourceIdentifier;
      },
    ];
    for (const mutate of mutations) {
      const input = mutableNormalized();
      mutate(input);
      expectCode(input, "invalid-normalized-input");
    }
  });

  it("rejects reflected, scaled, and non-orthogonal bases", () => {
    for (const basis of [
      [-1_000_000_000, 0, 0, 0, 1_000_000_000, 0, 0, 0, 1_000_000_000],
      [900_000_000, 0, 0, 0, 1_000_000_000, 0, 0, 0, 1_000_000_000],
      [999_000_000, 0, 0, 0, 1_000_000_000, 0, 0, 0, 1_000_000_000],
      [1_000_000_000, 100_000_000, 0, 0, 1_000_000_000, 0, 0, 0, 1_000_000_000],
    ]) {
      const input = mutableNormalized();
      surface(input, 0).transform.basisNanounits = basis;
      expectCode(input, "invalid-normalized-input");
    }
  });

  it("rejects story, sequence, curve, and measurement-reference inconsistencies", () => {
    const story = mutableNormalized();
    surface(story, 0).story = 1;
    expectCode(story, "source-mismatch");

    const curve = mutableNormalized();
    surface(curve, 0).curve = {
      centreXMicrometres: 0,
      centreZMicrometres: 0,
      endNanoradians: 1,
      radiusMicrometres: 1,
      startNanoradians: 1,
    };
    expectCode(curve, "invalid-normalized-input");

    const reference = mutableNormalized();
    measurement(reference, 0).toSourceEntityId = SYNTHETIC_IDS.tenant;
    const measurementContext = validationContext();
    expectCode(reference, "invalid-normalized-input", {
      ...measurementContext,
      manifest: {
        ...measurementContext.manifest,
        referenceMeasurements: reference.referenceMeasurements,
      },
    });

    const sequence = mutableNormalized();
    room(sequence, 0).sequence = 2;
    const sequenceContext = validationContext();
    expectCode(sequence, "invalid-normalized-input", {
      ...sequenceContext,
      manifest: { ...sequenceContext.manifest, rooms: sequence.rooms },
    });
  });

  it("requires mode-compatible world origins", () => {
    const input = mutableNormalized();
    input.structureIdentifier = SYNTHETIC_IDS.tenant;
    expectCode(input, "incompatible-world-space");

    const context = validationContext();
    expect(() =>
      validateRoomPlanNormalized(syntheticNormalized(), {
        ...context,
        manifest: { ...context.manifest, mode: "structure", sharedWorldOrigin: false },
      }),
    ).toThrow(RoomPlanValidationError);
  });
});
