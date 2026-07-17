import {
  modelOperationRequestSchema,
  modelOperationTypeSchema,
  previewModelOperationsRequestSchema,
} from "../../../packages/contracts/src/index.js";
import { canonicalizeHomeSnapshot } from "../../../packages/domain-model/src/index.js";
import {
  canonicalFixtureIds,
  existingHomeSnapshot,
} from "../../../packages/test-fixtures/src/models/index.js";
import { describe, expect, it } from "vitest";

import {
  generatedRenameSequence,
  operationFixtureIds,
  publicOperationCatalog,
} from "./operation-fixtures.js";
import {
  ReferenceOperationError,
  reduceWithReference,
  referencePublicOperationTypes,
} from "./reference-reducer.js";

const snapshotHash = canonicalizeHomeSnapshot(existingHomeSnapshot).snapshotSha256;

function asMutable(value: unknown): Record<string, unknown> {
  return structuredClone(value) as Record<string, unknown>;
}

describe("C5 independent operation registry and reducer", () => {
  it("covers the exact eight public operations and excludes both internal operations", () => {
    expect(publicOperationCatalog().map(({ type }) => type)).toEqual(referencePublicOperationTypes);
    expect(modelOperationTypeSchema.options).toEqual([
      "snapshot.initialize.v1",
      "snapshot.restore.v1",
      ...referencePublicOperationTypes,
    ]);
  });

  it.each(publicOperationCatalog())(
    "reduces $type deterministically without mutating input",
    (operation) => {
      const before = structuredClone(existingHomeSnapshot);
      const first = reduceWithReference(existingHomeSnapshot, [operation]);
      const second = reduceWithReference(existingHomeSnapshot, [structuredClone(operation)]);

      expect(existingHomeSnapshot).toEqual(before);
      expect(first.snapshotSha256).toBe(second.snapshotSha256);
      expect(first.snapshot).toEqual(second.snapshot);
      expect(first.snapshotSha256).not.toBe(snapshotHash);
    },
  );

  it("rejects unknown versions, types, unsafe paths, loose properties, invalid IDs and units", () => {
    const translate = publicOperationCatalog()[2];
    const metadata = publicOperationCatalog()[6];
    if (
      translate?.type !== "wall.translate.v1" ||
      metadata?.type !== "element.metadata.correct.v1"
    ) {
      throw new Error("The retained operation catalog order changed.");
    }

    const invalidInputs = [
      { ...translate, schemaVersion: "c5-model-operation-v2" },
      { ...translate, type: "wall.delete.v1" },
      { ...translate, translation: { xMm: 0, yMm: 0 } },
      { ...translate, translation: { xMm: 1.5, yMm: 0 } },
      { ...translate, translation: { xMm: 1_000_001, yMm: 0 } },
      { ...translate, wallId: "../../tenant/other-wall" },
      { ...translate, tenantId: canonicalFixtureIds.project },
      {
        ...metadata,
        target: { ...metadata.target, collection: "__proto__" },
      },
      {
        ...metadata,
        target: { ...metadata.target, field: "constructor" },
      },
    ];

    for (const input of invalidInputs) {
      expect(modelOperationRequestSchema.safeParse(input).success).toBe(false);
    }
  });

  it("rejects unknown references and duplicate IDs before canonical output", () => {
    const catalog = publicOperationCatalog();
    const translate = asMutable(catalog[2]);
    translate.wallId = canonicalFixtureIds.missing.target;
    expect(() => reduceWithReference(existingHomeSnapshot, [translate])).toThrow(
      ReferenceOperationError,
    );

    const opening = asMutable(catalog[3]);
    (opening.opening as Record<string, unknown>).hostWallId = canonicalFixtureIds.missing.hostWall;
    expect(() => reduceWithReference(existingHomeSnapshot, [opening])).toThrow(/host wall/u);

    const space = asMutable(catalog[4]);
    (space.space as Record<string, unknown>).levelId = canonicalFixtureIds.missing.level;
    expect(() => reduceWithReference(existingHomeSnapshot, [space])).toThrow(/level/u);

    const wall = asMutable(catalog[1]);
    (wall.wall as Record<string, unknown>).id = canonicalFixtureIds.elements.wallGroundPartition;
    expect(() => reduceWithReference(existingHomeSnapshot, [wall])).toThrow(/already exists/u);
  });

  it("preserves operation order and never repairs a reordered dependency", () => {
    const catalog = publicOperationCatalog();
    const createLevel = structuredClone(catalog[0]);
    const createWall = asMutable(catalog[1]);
    (createWall.wall as Record<string, unknown>).levelId = operationFixtureIds.level;

    expect(() => reduceWithReference(existingHomeSnapshot, [createWall, createLevel])).toThrow(
      /does not exist/u,
    );
    const ordered = reduceWithReference(existingHomeSnapshot, [createLevel, createWall]);
    expect(
      ordered.snapshot.elements.levels.some(({ id }) => id === operationFixtureIds.level),
    ).toBe(true);
    expect(ordered.snapshot.elements.walls.some(({ id }) => id === operationFixtureIds.wall)).toBe(
      true,
    );
  });

  it("replays a fixed-seed generated sequence to the identical canonical hash", () => {
    const operations = generatedRenameSequence(50);
    const batch = reduceWithReference(existingHomeSnapshot, operations);
    let replaySnapshot = existingHomeSnapshot;
    for (const operation of operations) {
      replaySnapshot = reduceWithReference(replaySnapshot, [operation]).snapshot;
    }

    expect(canonicalizeHomeSnapshot(replaySnapshot).snapshotSha256).toBe(batch.snapshotSha256);
    const lastOperation = operations.at(-1);
    if (lastOperation?.type !== "space.rename.v1") {
      throw new Error("The generated rename sequence returned an unexpected operation.");
    }
    expect(
      batch.snapshot.elements.spaces.find(
        ({ id }) => id === canonicalFixtureIds.elements.spaceLiving,
      )?.name,
    ).toEqual(lastOperation.name);
  });

  it("enforces the bounded preview envelope and unique client operation IDs", () => {
    const operation = publicOperationCatalog()[5];
    expect(operation).toBeDefined();
    const valid = {
      expectedHeadSnapshotSha256: snapshotHash,
      expectedRevision: 0,
      operations: [operation],
    };
    expect(previewModelOperationsRequestSchema.safeParse(valid).success).toBe(true);
    expect(
      previewModelOperationsRequestSchema.safeParse({
        ...valid,
        operations: [operation, structuredClone(operation)],
      }).success,
    ).toBe(false);
    expect(() => reduceWithReference(existingHomeSnapshot, [])).toThrow(/between one and 50/u);
    expect(() => reduceWithReference(existingHomeSnapshot, generatedRenameSequence(51))).toThrow(
      /between one and 50/u,
    );
  });

  it("surfaces located geometry findings for unsafe edits instead of normalising geometry", () => {
    const translate = publicOperationCatalog()[2];
    expect(translate?.type).toBe("wall.translate.v1");
    const result = reduceWithReference(existingHomeSnapshot, [translate]);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(
      result.findings.some((finding) =>
        finding.affectedElementIds.includes(canonicalFixtureIds.elements.wallGroundPartition),
      ),
    ).toBe(true);
  });
});
