import type {
  KnownAttribution,
  ModelOperationRequest,
} from "../../../packages/contracts/src/index.js";
import {
  canonicalFixtureIds,
  existingHomeSnapshot,
  userAttribution,
} from "../../../packages/test-fixtures/src/models/index.js";

const operationId = (sequence: number): string =>
  `c5000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;

const elementId = (sequence: number): string =>
  `c5100000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;

const attribution = (sequence: number): KnownAttribution => userAttribution(2_000 + sequence);

const attributed = <T>(value: T, sequence: number) => ({
  attribution: attribution(sequence),
  knowledge: "known" as const,
  value,
});

const core = (sequence: number, reason: string) => ({
  clientOperationId: operationId(sequence),
  reason,
  schemaVersion: "c5-model-operation-v1" as const,
});

export const operationFixtureIds = Object.freeze({
  level: elementId(1),
  opening: elementId(3),
  space: elementId(4),
  wall: elementId(2),
});

export function publicOperationCatalog(): readonly ModelOperationRequest[] {
  const sourceLevel = structuredClone(existingHomeSnapshot.elements.levels[0]);
  const sourceOpening = structuredClone(existingHomeSnapshot.elements.openings[0]);
  const sourceSpace = structuredClone(existingHomeSnapshot.elements.spaces[0]);
  const sourceWall = structuredClone(existingHomeSnapshot.elements.walls[0]);
  if (
    sourceLevel === undefined ||
    sourceOpening === undefined ||
    sourceSpace === undefined ||
    sourceWall === undefined
  ) {
    throw new Error("The retained C4 fixture lost an operation source element.");
  }

  return [
    {
      ...core(1, "Create a deterministic evaluation level"),
      level: {
        ...sourceLevel,
        elevationMm: attributed(5_400, 1),
        id: operationFixtureIds.level,
        name: attributed("Evaluation attic", 2),
        origin: attribution(3),
        storeyHeightMm: attributed(2_400, 4),
      },
      type: "level.create.v1",
    },
    {
      ...core(2, "Create a bounded evaluation wall"),
      type: "wall.create.v1",
      wall: {
        ...sourceWall,
        id: operationFixtureIds.wall,
        levelId: canonicalFixtureIds.elements.levelGround,
        name: attributed("Evaluation wall", 5),
        origin: attribution(6),
        path: attributed(
          [
            { xMm: 1_000, yMm: 1_000 },
            { xMm: 2_000, yMm: 1_000 },
          ],
          7,
        ),
      },
    },
    {
      ...core(3, "Move the ground partition by exact millimetres"),
      pathAttribution: attribution(8),
      translation: { xMm: 50, yMm: -25 },
      type: "wall.translate.v1",
      wallId: canonicalFixtureIds.elements.wallGroundPartition,
    },
    {
      ...core(4, "Insert a synthetic opening into an existing wall"),
      opening: {
        ...sourceOpening,
        heightMm: attributed(2_100, 9),
        hostWallId: canonicalFixtureIds.elements.wallGroundSouthLiving,
        id: operationFixtureIds.opening,
        kind: "door",
        name: attributed("Evaluation opening", 10),
        offsetAlongHostMm: attributed(3_500, 11),
        origin: attribution(12),
        sillHeightMm: attributed(0, 13),
        swing: attributed("left" as const, 14),
        widthMm: attributed(800, 15),
      },
      type: "opening.insert.v1",
    },
    {
      ...core(5, "Create a schema-valid evaluation space"),
      space: {
        ...sourceSpace,
        boundary: attributed(
          [
            { xMm: 1_000, yMm: 1_000 },
            { xMm: 2_000, yMm: 1_000 },
            { xMm: 2_000, yMm: 2_000 },
            { xMm: 1_000, yMm: 2_000 },
          ],
          16,
        ),
        boundedByElementIds: [],
        classification: attributed("evaluation", 17),
        id: operationFixtureIds.space,
        levelId: canonicalFixtureIds.elements.levelGround,
        name: attributed("Evaluation space", 18),
        origin: attribution(19),
      },
      type: "space.create.v1",
    },
    {
      ...core(6, "Rename a room without changing its geometry"),
      name: attributed("Living room revised", 20),
      spaceId: canonicalFixtureIds.elements.spaceLiving,
      type: "space.rename.v1",
    },
    {
      ...core(7, "Correct an enumerated metadata field"),
      target: {
        collection: "walls",
        elementId: canonicalFixtureIds.elements.wallGroundPartition,
        field: "name",
      },
      type: "element.metadata.correct.v1",
      value: attributed("Partition wall revised", 21),
    },
    {
      ...core(8, "Correct provenance on an enumerated attributed field"),
      attribution: attribution(22),
      target: {
        collection: "walls",
        elementId: canonicalFixtureIds.elements.wallGroundPartition,
        field: "path",
      },
      type: "element.provenance.correct.v1",
    },
  ];
}

export function generatedRenameSequence(
  count: number,
  seed = 0x5c5,
  startIndex = 0,
): ModelOperationRequest[] {
  let state = seed >>> 0;
  const next = (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };

  return Array.from({ length: count }, (_unused, offset) => {
    const index = startIndex + offset;
    return {
      ...core(100 + index, `Generated deterministic rename ${String(index + 1)}`),
      name: attributed(`Living room option ${String(next() % 10_000)}`, 100 + index),
      spaceId: canonicalFixtureIds.elements.spaceLiving,
      type: "space.rename.v1" as const,
    };
  });
}
