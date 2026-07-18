import {
  c5RouteContract,
  correctElementMetadataOperationSchema,
  createModelBranchRequestSchema,
  modelOperationRequestSchema,
  modelOperationTypeSchema,
  previewModelOperationsRequestSchema,
} from "../src/index.js";
import { describe, expect, it } from "vitest";

const hash = "a".repeat(64);
const attribution = {
  actorUserId: "00000000-0000-4000-8000-000000000001",
  claimId: "00000000-0000-4000-8000-000000000002",
  evidenceIds: [],
  method: { kind: "manual", name: "C5 contract test", version: "1" },
  state: "user-asserted",
  verification: { status: "not-reviewed" },
} as const;
const rename = {
  clientOperationId: "00000000-0000-4000-8000-000000000003",
  name: { attribution, knowledge: "known", value: "Kitchen" },
  reason: "Correct the synthetic room label.",
  schemaVersion: "c5-model-operation-v1",
  spaceId: "00000000-0000-4000-8000-000000000004",
  type: "space.rename.v1",
} as const;

describe("C5 frozen contracts", () => {
  it("freezes a bounded, versioned registry including internal initialise and restore operations", () => {
    expect(modelOperationTypeSchema.options).toEqual([
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
    expect(modelOperationRequestSchema.parse(rename)).toEqual(rename);
  });

  it("requires both the expected revision and exact head hash for preview", () => {
    expect(
      previewModelOperationsRequestSchema.parse({
        expectedHeadSnapshotSha256: hash,
        expectedRevision: 0,
        operations: [rename],
      }),
    ).toBeDefined();
    expect(
      previewModelOperationsRequestSchema.safeParse({ expectedRevision: 0, operations: [rename] })
        .success,
    ).toBe(false);
  });

  it("rejects duplicate client operation IDs inside one atomic preview group", () => {
    expect(
      previewModelOperationsRequestSchema.safeParse({
        expectedHeadSnapshotSha256: hash,
        expectedRevision: 0,
        operations: [rename, rename],
      }).success,
    ).toBe(false);
  });

  it("rejects zero wall translations and arbitrary metadata paths", () => {
    expect(
      modelOperationRequestSchema.safeParse({
        clientOperationId: "00000000-0000-4000-8000-000000000005",
        pathAttribution: attribution,
        reason: "No-op movement must fail.",
        schemaVersion: "c5-model-operation-v1",
        translation: { xMm: 0, yMm: 0 },
        type: "wall.translate.v1",
        wallId: "00000000-0000-4000-8000-000000000006",
      }).success,
    ).toBe(false);
    expect(
      correctElementMetadataOperationSchema.safeParse({
        clientOperationId: "00000000-0000-4000-8000-000000000007",
        reason: "Arbitrary paths are forbidden.",
        schemaVersion: "c5-model-operation-v1",
        target: {
          collection: "walls",
          elementId: "00000000-0000-4000-8000-000000000006",
          field: "__proto__",
        },
        type: "element.metadata.correct.v1",
        value: { attribution, knowledge: "known", value: "unsafe" },
      }).success,
    ).toBe(false);
  });

  it("requires branch creation to pin an immutable source snapshot and hash", () => {
    expect(
      createModelBranchRequestSchema.safeParse({
        name: "Option A",
        sourceSnapshotId: crypto.randomUUID(),
      }).success,
    ).toBe(false);
    expect(
      createModelBranchRequestSchema.parse({
        name: "Option A",
        sourceSnapshotId: crypto.randomUUID(),
        sourceSnapshotSha256: hash,
      }),
    ).toBeDefined();
  });

  it("freezes branch, preview, commit, history, compare and restore route boundaries", () => {
    expect(Object.keys(c5RouteContract).sort()).toEqual([
      "commitOperations",
      "compareBranch",
      "createBranch",
      "getBranch",
      "listBranches",
      "listOperations",
      "previewOperations",
      "restoreBranch",
    ]);
  });
});
