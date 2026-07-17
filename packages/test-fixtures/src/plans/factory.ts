import { sha256Hex, syntheticUuid } from "./bytes.js";
import type {
  PlanFixture,
  PlanFixtureCategory,
  PlanFixtureExpectation,
  PlanFixtureMimeType,
  PlanFixtureSplit,
  PlanFixtureTruth,
} from "./types.js";

export interface CreatePlanFixtureInput {
  readonly bytes: Uint8Array;
  readonly category: PlanFixtureCategory;
  readonly description: string;
  readonly expected: PlanFixtureExpectation;
  readonly id: string;
  readonly mimeType: PlanFixtureMimeType;
  readonly sequence: number;
  readonly split: PlanFixtureSplit;
  readonly title: string;
  readonly truth?: PlanFixtureTruth;
}

export function createPlanFixture(input: CreatePlanFixtureInput): PlanFixture {
  return Object.freeze({
    bytes: input.bytes,
    category: input.category,
    description: input.description,
    expected: Object.freeze(input.expected),
    id: input.id,
    mimeType: input.mimeType,
    rights: Object.freeze({
      allowedPurpose: Object.freeze([
        "local-ci-evaluation",
        "security-testing",
        "ui-acceptance",
      ] as const),
      creator: "Interior Design C6 synthetic QA lane",
      licence: "CC0-1.0",
      origin: "generated-in-repository",
      right: "creator-dedicated",
      serviceProcessingConsent: true,
      split: input.split,
      synthetic: true,
      trainingUseConsent: "denied",
    }),
    scope: Object.freeze({
      assetId: syntheticUuid(10_000 + input.sequence),
      objectKey: `tenant/c6-synthetic/${input.id}`,
      projectId: syntheticUuid(20_000 + input.sequence),
      sourceStatus: "ready",
      tenantId: syntheticUuid(30_000 + input.sequence),
    }),
    sha256: sha256Hex(input.bytes),
    title: input.title,
    ...(input.truth === undefined ? {} : { truth: input.truth }),
  });
}

export function rectangularTruth(seed: number, sourceUnitsPerMillimetre = 1): PlanFixtureTruth {
  const width = 5_000 + seed * 20;
  const height = 4_000 + seed * 10;
  const wallIds = [
    syntheticUuid(40_000 + seed * 10),
    syntheticUuid(40_001 + seed * 10),
    syntheticUuid(40_002 + seed * 10),
    syntheticUuid(40_003 + seed * 10),
  ] as const;
  return Object.freeze({
    calibrationResidualMillimetres: 4 + (seed % 5) * 3,
    levelCount: 1,
    openings: Object.freeze([
      Object.freeze({
        centre: Object.freeze({ xMillimetres: Math.round(width / 2), yMillimetres: 0 }),
        hostWallId: wallIds[0],
        id: syntheticUuid(50_000 + seed),
      }),
    ]),
    roomsAreClosedAndSimple: true,
    sourceUnitsPerMillimetre,
    walls: Object.freeze([
      wall(wallIds[0], 0, 0, width, 0),
      wall(wallIds[1], width, 0, width, height),
      wall(wallIds[2], width, height, 0, height),
      wall(wallIds[3], 0, height, 0, 0),
    ]),
  });
}

function wall(id: string, x1: number, y1: number, x2: number, y2: number) {
  return Object.freeze({
    end: Object.freeze({ xMillimetres: x2, yMillimetres: y2 }),
    id,
    start: Object.freeze({ xMillimetres: x1, yMillimetres: y1 }),
  });
}
