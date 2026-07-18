import { canonicalizeHomeSnapshot } from "@interior-design/domain-model";
import { describe, expect, it } from "vitest";

import {
  createInternalSnapshotOperation,
  operationRegistry,
  reduceModelOperations,
  registeredOperationTypes,
  replayModelOperationHistory,
  upcastModelOperation,
} from "../src/index.js";
import { attribution, baseSnapshot, known, levelId, spaceId, wallId } from "./fixtures.js";

const operationCore = (clientOperationId: string, reason = "Unit fixture correction") => ({
  clientOperationId,
  reason,
  schemaVersion: "c5-model-operation-v1" as const,
});

const designOperationCore = (clientOperationId: string, reason = "Unit fixture design") => ({
  clientOperationId,
  reason,
  schemaVersion: "c12-design-element-operation-v1" as const,
});

describe("the frozen C5 registry and upcaster", () => {
  it("registers exactly the eleven public and two internal operation types", () => {
    expect(registeredOperationTypes).toEqual([
      "snapshot.initialize.v1",
      "snapshot.restore.v1",
      "level.create.v1",
      "wall.create.v1",
      "wall.translate.v1",
      "opening.insert.v1",
      "space.create.v1",
      "space.rename.v1",
      "element.metadata.correct.v1",
      "element.provenance.correct.v1",
      "design.element.create.v1",
      "design.element.replace.v1",
      "design.element.remove.v1",
    ]);
    expect(operationRegistry.filter(({ audience }) => audience === "public")).toHaveLength(11);
  });

  it("fails closed for unknown schema versions and operation names", () => {
    expect(() =>
      upcastModelOperation({ schemaVersion: "c5-model-operation-v2", type: "wall.translate.v1" }),
    ).toThrow(expect.objectContaining({ code: "UNKNOWN_OPERATION_VERSION" }));
    expect(() =>
      upcastModelOperation({ schemaVersion: "c5-model-operation-v1", type: "wall.delete.v1" }),
    ).toThrow(expect.objectContaining({ code: "UNKNOWN_OPERATION_TYPE" }));
  });
});

describe("pure schema-safe operation reduction", () => {
  it("translates a known wall deterministically without mutating either input", () => {
    const snapshot = baseSnapshot();
    const operation = {
      ...operationCore("30000000-0000-4000-8000-000000000001"),
      pathAttribution: attribution(),
      translation: { xMm: 50, yMm: -25 },
      type: "wall.translate.v1" as const,
      wallId,
    };
    const before = structuredClone(snapshot);
    const operationBefore = structuredClone(operation);
    const left = reduceModelOperations(snapshot, [operation]);
    const right = reduceModelOperations(snapshot, [operation]);

    expect(snapshot).toEqual(before);
    expect(operation).toEqual(operationBefore);
    expect(left.snapshotSha256).toBe(right.snapshotSha256);
    expect(left.snapshot.elements.walls[0]?.path).toMatchObject({
      knowledge: "known",
      value: [
        { xMm: 50, yMm: -25 },
        { xMm: 4050, yMm: -25 },
      ],
    });
  });

  it("supports level and wall creation with stable-ID and reference checks", () => {
    const secondLevelId = "30000000-0000-4000-8000-000000000002";
    const secondWallId = "30000000-0000-4000-8000-000000000003";
    const result = reduceModelOperations(baseSnapshot(), [
      {
        ...operationCore("30000000-0000-4000-8000-000000000004"),
        level: {
          elementType: "level",
          elevationMm: known(2600),
          id: secondLevelId,
          name: known("First"),
          origin: attribution(),
          storeyHeightMm: known(2400),
        },
        type: "level.create.v1",
      },
      {
        ...operationCore("30000000-0000-4000-8000-000000000005"),
        type: "wall.create.v1",
        wall: {
          alignment: "centre",
          baseOffsetMm: known(0),
          elementType: "wall",
          heightMm: known(2200),
          id: secondWallId,
          levelId: secondLevelId,
          name: known("First floor wall"),
          origin: attribution(),
          path: known([
            { xMm: 0, yMm: 0 },
            { xMm: 3000, yMm: 0 },
          ]),
          thicknessMm: known(100),
        },
      },
    ]);
    expect(result.snapshot.elements.levels.map(({ id }) => id)).toContain(secondLevelId);
    expect(result.snapshot.elements.walls.map(({ id }) => id)).toContain(secondWallId);
  });

  it("inserts an opening only onto an existing wall", () => {
    const openingId = "30000000-0000-4000-8000-000000000006";
    const result = reduceModelOperations(baseSnapshot(), [
      {
        ...operationCore("30000000-0000-4000-8000-000000000007"),
        opening: {
          elementType: "opening",
          heightMm: known(2000),
          hostWallId: wallId,
          id: openingId,
          kind: "door",
          name: known("Door"),
          offsetAlongHostMm: known(500),
          origin: attribution(),
          sillHeightMm: known(0),
          swing: known("left" as const),
          widthMm: known(900),
        },
        type: "opening.insert.v1",
      },
    ]);
    expect(result.snapshot.elements.openings[0]?.id).toBe(openingId);
  });

  it("creates and renames a space with an attributed value", () => {
    const result = reduceModelOperations(baseSnapshot(), [
      {
        ...operationCore("30000000-0000-4000-8000-000000000008"),
        space: {
          boundary: known([
            { xMm: 0, yMm: 0 },
            { xMm: 4000, yMm: 0 },
            { xMm: 4000, yMm: 3000 },
            { xMm: 0, yMm: 3000 },
          ]),
          boundedByElementIds: [],
          classification: known("living-room"),
          elementType: "space",
          id: spaceId,
          levelId,
          name: known("Living"),
          origin: attribution(),
        },
        type: "space.create.v1",
      },
      {
        ...operationCore("30000000-0000-4000-8000-000000000009"),
        name: known("Family room"),
        spaceId,
        type: "space.rename.v1",
      },
    ]);
    expect(result.snapshot.elements.spaces[0]?.name).toMatchObject({
      knowledge: "known",
      value: "Family room",
    });
  });

  it("allows only registered attributed metadata pairs", () => {
    const renamed = reduceModelOperations(baseSnapshot(), [
      {
        ...operationCore("30000000-0000-4000-8000-000000000010"),
        target: { collection: "walls", elementId: wallId, field: "name" },
        type: "element.metadata.correct.v1",
        value: known("Corrected wall"),
      },
    ]);
    expect(renamed.snapshot.elements.walls[0]?.name).toMatchObject({ value: "Corrected wall" });

    expect(() =>
      reduceModelOperations(baseSnapshot(), [
        {
          ...operationCore("30000000-0000-4000-8000-000000000011"),
          target: { collection: "walls", elementId: wallId, field: "material" },
          type: "element.metadata.correct.v1",
          value: known("Unsafe dynamic target"),
        },
      ]),
    ).toThrow(expect.objectContaining({ code: "UNSUPPORTED_CORRECTION_TARGET" }));
  });

  it("corrects provenance without inventing or discarding the attributed value", () => {
    const newAttribution = attribution();
    const corrected = reduceModelOperations(baseSnapshot(), [
      {
        ...operationCore("30000000-0000-4000-8000-000000000012"),
        attribution: newAttribution,
        target: { collection: "walls", elementId: wallId, field: "path" },
        type: "element.provenance.correct.v1",
      },
    ]);
    expect(corrected.snapshot.elements.walls[0]?.path.attribution).toEqual(newAttribution);
  });

  it("creates, replaces and removes proposed design elements while preserving stable IDs", () => {
    const snapshot = {
      ...baseSnapshot(),
      derivedFromSnapshotSha256: "f".repeat(64),
      profile: "proposed" as const,
    };
    const furnishingId = "30000000-0000-4000-8000-000000000101";
    const furnishing = {
      category: known("sofa"),
      dimensions: known({ depthMm: 900, heightMm: 800, widthMm: 2100 }),
      elementType: "furnishing" as const,
      id: furnishingId,
      levelId,
      name: known("Creator-owned synthetic sofa"),
      origin: attribution(),
      placement: {
        position: known({ xMm: 1200, yMm: 900, zMm: 0 }),
        rotationMilliDegrees: known(0),
      },
    };
    const assetBinding = {
      assetId: "30000000-0000-4000-8000-000000000107",
      assetVersionId: "30000000-0000-4000-8000-000000000108",
      contentSha256: "a".repeat(64),
      metadataSha256: "b".repeat(64),
      placementPolicySha256: "c".repeat(64),
      rightsRecordSha256: "d".repeat(64),
    };
    const created = reduceModelOperations(snapshot, [
      {
        ...designOperationCore("30000000-0000-4000-8000-000000000102"),
        assetBinding,
        element: furnishing,
        type: "design.element.create.v1",
      },
    ]);
    expect(created.snapshot.elements.furnishings[0]?.id).toBe(furnishingId);

    const replaced = reduceModelOperations(created.snapshot, [
      {
        ...designOperationCore("30000000-0000-4000-8000-000000000103"),
        assetBinding,
        element: {
          ...furnishing,
          placement: {
            ...furnishing.placement,
            position: known({ xMm: 1600, yMm: 900, zMm: 0 }),
          },
        },
        expectedElementId: furnishingId,
        type: "design.element.replace.v1",
      },
    ]);
    expect(replaced.snapshot.elements.furnishings[0]?.placement.position).toMatchObject({
      value: { xMm: 1600 },
    });

    const removed = reduceModelOperations(replaced.snapshot, [
      {
        ...designOperationCore("30000000-0000-4000-8000-000000000104"),
        target: { collection: "furnishings", elementId: furnishingId },
        type: "design.element.remove.v1",
      },
    ]);
    expect(removed.snapshot.elements.furnishings).toEqual([]);
  });

  it("rejects design-element operations outside the proposed profile", () => {
    expect(() =>
      reduceModelOperations(baseSnapshot(), [
        {
          ...designOperationCore("30000000-0000-4000-8000-000000000105"),
          target: {
            collection: "furnishings",
            elementId: "30000000-0000-4000-8000-000000000106",
          },
          type: "design.element.remove.v1",
        },
      ]),
    ).toThrow(expect.objectContaining({ code: "INVALID_OPERATION" }));
  });

  it("rejects duplicate IDs and wrong target types while accepting bounded integer movement", () => {
    const existingLevel = baseSnapshot().elements.levels[0];
    if (existingLevel === undefined) throw new Error("Fixture level is missing.");
    const duplicate = {
      ...operationCore("30000000-0000-4000-8000-000000000013"),
      level: structuredClone(existingLevel),
      type: "level.create.v1" as const,
    };
    expect(() => reduceModelOperations(baseSnapshot(), [duplicate])).toThrow(
      expect.objectContaining({ code: "DUPLICATE_ELEMENT_ID" }),
    );
    expect(() =>
      reduceModelOperations(baseSnapshot(), [
        {
          ...operationCore("30000000-0000-4000-8000-000000000014"),
          name: known("Wrong target"),
          spaceId: wallId,
          type: "space.rename.v1",
        },
      ]),
    ).toThrow(expect.objectContaining({ code: "TARGET_TYPE_MISMATCH" }));
    expect(() =>
      reduceModelOperations(baseSnapshot(), [
        {
          ...operationCore("30000000-0000-4000-8000-000000000015"),
          pathAttribution: attribution(),
          translation: { xMm: 1_000_000, yMm: 0 },
          type: "wall.translate.v1",
          wallId,
        },
      ]),
    ).not.toThrow();
  });

  it("returns blocking geometry findings without persisting or repairing the result", () => {
    const invalidWallId = "30000000-0000-4000-8000-000000000016";
    const result = reduceModelOperations(baseSnapshot(), [
      {
        ...operationCore("30000000-0000-4000-8000-000000000017"),
        type: "wall.create.v1",
        wall: {
          ...structuredClone(baseSnapshot().elements.walls[0]),
          id: invalidWallId,
          name: known("Self-intersecting wall"),
          origin: attribution(),
          path: known([
            { xMm: 0, yMm: 0 },
            { xMm: 1000, yMm: 1000 },
            { xMm: 0, yMm: 1000 },
            { xMm: 1000, yMm: 0 },
          ]),
        },
      },
    ]);
    expect(result.hasBlockingFindings).toBe(true);
    expect(result.findings.map(({ code }) => code)).toContain("WALL_PATH_SELF_INTERSECTION");
  });
});

describe("deterministic replay", () => {
  it("replays ordered public commits to the exact retained hash", async () => {
    const source = baseSnapshot();
    const sourceCanonical = canonicalizeHomeSnapshot(source);
    const operation = {
      ...operationCore("30000000-0000-4000-8000-000000000018"),
      pathAttribution: attribution(),
      translation: { xMm: 100, yMm: 0 },
      type: "wall.translate.v1" as const,
      wallId,
    };
    const committed = reduceModelOperations(source, [operation]);
    const replay = await replayModelOperationHistory(
      {
        id: "30000000-0000-4000-8000-000000000019",
        snapshot: sourceCanonical.snapshot,
        snapshotSha256: sourceCanonical.snapshotSha256,
      },
      [
        {
          operations: [{ operation, ordinal: 0, revision: 1 }],
          revision: 1,
          snapshotSha256: committed.snapshotSha256,
        },
      ],
      () => undefined,
    );
    expect(replay.finalSnapshotSha256).toBe(committed.snapshotSha256);
  });

  it("replays initialize and restore as registered internal history", async () => {
    const source = baseSnapshot();
    const canonical = canonicalizeHomeSnapshot(source);
    const snapshotId = "30000000-0000-4000-8000-000000000020";
    const initialize = createInternalSnapshotOperation({
      clientOperationId: "30000000-0000-4000-8000-000000000021",
      reason: "Initialize fixture",
      sourceSnapshotId: snapshotId,
      sourceSnapshotSha256: canonical.snapshotSha256,
      type: "snapshot.initialize.v1",
    });
    const restore = createInternalSnapshotOperation({
      clientOperationId: "30000000-0000-4000-8000-000000000022",
      reason: "Restore fixture",
      sourceSnapshotId: snapshotId,
      sourceSnapshotSha256: canonical.snapshotSha256,
      type: "snapshot.restore.v1",
    });
    const replay = await replayModelOperationHistory(
      { id: snapshotId, snapshot: source, snapshotSha256: canonical.snapshotSha256 },
      [
        {
          operations: [{ operation: initialize, ordinal: 0, revision: 1 }],
          revision: 1,
          snapshotSha256: canonical.snapshotSha256,
        },
        {
          operations: [{ operation: restore, ordinal: 0, revision: 2 }],
          revision: 2,
          snapshotSha256: canonical.snapshotSha256,
        },
      ],
      () => ({ id: snapshotId, snapshot: source, snapshotSha256: canonical.snapshotSha256 }),
    );
    expect(replay.revisions).toHaveLength(2);
  });

  it("fails closed on revision, ordinal, source and hash tampering", async () => {
    const source = baseSnapshot();
    const canonical = canonicalizeHomeSnapshot(source);
    await expect(
      replayModelOperationHistory(
        {
          id: "30000000-0000-4000-8000-000000000023",
          snapshot: source,
          snapshotSha256: canonical.snapshotSha256,
        },
        [{ operations: [], revision: 2, snapshotSha256: canonical.snapshotSha256 }],
        () => undefined,
      ),
    ).rejects.toMatchObject({ code: "HISTORY_REVISION_GAP" });
    await expect(
      replayModelOperationHistory(
        {
          id: "30000000-0000-4000-8000-000000000024",
          snapshot: source,
          snapshotSha256: "0".repeat(64),
        },
        [],
        () => undefined,
      ),
    ).rejects.toMatchObject({ code: "HISTORY_HASH_MISMATCH" });
  });
});
