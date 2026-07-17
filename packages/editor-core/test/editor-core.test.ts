import type {
  CanonicalHomeSnapshot,
  KnownAttribution,
  ModelOperationRequest,
  ModelOperationsPreview,
} from "@interior-design/contracts";
import { describe, expect, it } from "vitest";

import {
  attributedUserValue,
  buildRenameSpaceOperation,
  buildTranslateWallOperation,
  createEditorSession,
  createUserAttribution,
  defaultEditorSnapGridMm,
  editorCanCommit,
  editorSessionReducer,
  editorSnapGridsMm,
  maximumPendingEditorCommands,
  projectCanonicalSnapshotToPlan,
  selectCanonicalElement,
  snapIntegerMm,
  snapTranslationMm,
} from "../src/index.js";

const uuid = (sequence: number): string =>
  `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;
let claimSequence = 100;

function userAttribution(): KnownAttribution {
  claimSequence += 1;
  return createUserAttribution({ actorUserId: uuid(1), claimId: uuid(claimSequence) });
}

function known<T>(value: T) {
  return attributedUserValue(value, userAttribution());
}

function snapshot(): CanonicalHomeSnapshot {
  return {
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
          id: uuid(10),
          name: known("Ground"),
          origin: userAttribution(),
          storeyHeightMm: known(2_800),
        },
        {
          elementType: "level",
          elevationMm: known(2_800),
          id: uuid(11),
          name: known("First"),
          origin: userAttribution(),
          storeyHeightMm: known(2_600),
        },
      ],
      lights: [],
      openings: [
        {
          elementType: "opening",
          heightMm: known(2_100),
          hostWallId: uuid(20),
          id: uuid(30),
          kind: "door",
          name: known("Door"),
          offsetAlongHostMm: known(1_000),
          origin: userAttribution(),
          sillHeightMm: known(0),
          swing: known("left"),
          widthMm: known(900),
        },
      ],
      spaces: [
        {
          boundary: known([
            { xMm: 0, yMm: 0 },
            { xMm: 4_000, yMm: 0 },
            { xMm: 4_000, yMm: 3_000 },
            { xMm: 0, yMm: 3_000 },
          ]),
          boundedByElementIds: [uuid(20)],
          classification: known("living-room"),
          elementType: "space",
          id: uuid(40),
          levelId: uuid(10),
          name: known("Living room"),
          origin: userAttribution(),
        },
      ],
      stairs: [],
      surfaces: [],
      walls: [
        {
          alignment: "centre",
          baseOffsetMm: known(0),
          elementType: "wall",
          heightMm: known(2_600),
          id: uuid(20),
          levelId: uuid(10),
          name: known("Ground wall"),
          origin: userAttribution(),
          path: known([
            { xMm: 0, yMm: 0 },
            { xMm: 4_000, yMm: 0 },
          ]),
          thicknessMm: known(180),
        },
        {
          alignment: "centre",
          baseOffsetMm: known(0),
          elementType: "wall",
          heightMm: known(2_600),
          id: uuid(21),
          levelId: uuid(11),
          name: known("First wall"),
          origin: userAttribution(),
          path: known([
            { xMm: 100, yMm: 200 },
            { xMm: 3_100, yMm: 200 },
          ]),
          thicknessMm: known(150),
        },
      ],
    },
    knownLimitations: [{ code: "TEST_ONLY", detail: "Synthetic editor-core test." }],
    modelId: uuid(4),
    profile: "existing",
    projectId: uuid(5),
    schemaVersion: "c4-canonical-home-v1",
  };
}

function translate(sequence: number): ModelOperationRequest {
  return buildTranslateWallOperation(
    { clientOperationId: uuid(1_000 + sequence), reason: `Move ${String(sequence)}` },
    {
      pathAttribution: userAttribution(),
      translation: { xMm: 50, yMm: 0 },
      wallId: uuid(20),
    },
  );
}

function preview(operation: ModelOperationRequest): ModelOperationsPreview {
  return {
    baseHeadSnapshotSha256: "a".repeat(64),
    baseRevision: 2,
    branchId: uuid(60),
    canonicalByteLength: 1_234,
    expiresAt: "2030-01-01T00:00:00.000Z",
    findings: [
      {
        affectedElementIds: [uuid(20)],
        code: "STRUCTURAL_STATUS_UNKNOWN",
        message: "Structural status remains unknown.",
        severity: "warning",
      },
    ],
    hasBlockingFindings: false,
    id: uuid(61),
    operations: [operation],
    projectId: uuid(5),
    resultSnapshotSha256: "b".repeat(64),
  };
}

describe("C5 editor projection", () => {
  it("projects only the selected level while preserving stable canonical IDs", () => {
    const plan = projectCanonicalSnapshotToPlan(snapshot(), {
      levelId: uuid(10),
      selectedElementId: uuid(20),
    });
    expect(plan.levels.map(({ label }) => label)).toEqual(["Ground", "First"]);
    expect(plan.elements.map(({ id }) => id)).toContain(uuid(20));
    expect(plan.elements.map(({ id }) => id)).not.toContain(uuid(21));
    expect(plan.selectedElementId).toBe(uuid(20));
    expect(plan.elements.find(({ id }) => id === uuid(20))?.points).toEqual([
      { x: 0, y: 0 },
      { x: 4_000, y: 0 },
    ]);
  });

  it("converts north-positive millimetres to SVG coordinates only at projection", () => {
    const plan = projectCanonicalSnapshotToPlan(snapshot(), { levelId: uuid(11) });
    expect(plan.elements[0]?.points).toEqual([
      { x: 100, y: -200 },
      { x: 3_100, y: -200 },
    ]);
  });

  it("resolves stable-ID selection to exact provenance", () => {
    const selection = selectCanonicalElement(snapshot(), uuid(40));
    expect(selection).toMatchObject({ collection: "spaces", id: uuid(40), label: "Living room" });
    expect(selection?.attribution.state).toBe("user-asserted");
  });
});

describe("C5 editor snapping and command builders", () => {
  it("freezes the exact snap choices and 50 mm default", () => {
    expect(editorSnapGridsMm).toEqual([10, 25, 50, 100]);
    expect(defaultEditorSnapGridMm).toBe(50);
    expect(snapIntegerMm(126, 50)).toBe(150);
    expect(snapTranslationMm({ xMm: -76, yMm: 24 }, 25)).toEqual({ xMm: -75, yMm: 25 });
  });

  it("builds schema-valid wall and space commands with exact integer values", () => {
    expect(translate(1)).toMatchObject({
      schemaVersion: "c5-model-operation-v1",
      translation: { xMm: 50, yMm: 0 },
      type: "wall.translate.v1",
    });
    const renamed = buildRenameSpaceOperation(
      { clientOperationId: uuid(90), reason: "Correct name" },
      { name: known("Sitting room"), spaceId: uuid(40) },
    );
    expect(renamed.type).toBe("space.rename.v1");
  });

  it("rejects an authoritative floating input and zero translation", () => {
    expect(() => snapIntegerMm(1.5, 50)).toThrow(/integer millimetres/u);
    expect(() =>
      buildTranslateWallOperation(
        { clientOperationId: uuid(91), reason: "No movement" },
        {
          pathAttribution: userAttribution(),
          translation: { xMm: 0, yMm: 0 },
          wallId: uuid(20),
        },
      ),
    ).toThrow();
  });
});

describe("C5 bounded local session", () => {
  it("supports local append, undo, redo and discard without touching history", () => {
    const base = createEditorSession({ headSnapshotSha256: "a".repeat(64), revision: 2 });
    const appended = editorSessionReducer(base, {
      operation: translate(1),
      type: "command.append",
    });
    const undone = editorSessionReducer(appended, { type: "command.undo" });
    const redone = editorSessionReducer(undone, { type: "command.redo" });
    const discarded = editorSessionReducer(redone, { type: "session.discard" });
    expect([appended.pending.length, undone.pending.length, undone.redo.length]).toEqual([1, 0, 1]);
    expect(redone.pending).toHaveLength(1);
    expect(discarded).toMatchObject({ pending: [], redo: [], phase: "clean", base: base.base });
  });

  it("enforces the frozen 50-command bound", () => {
    let state = createEditorSession({ headSnapshotSha256: "a".repeat(64), revision: 0 });
    for (let index = 0; index < maximumPendingEditorCommands; index += 1) {
      state = editorSessionReducer(state, { operation: translate(index), type: "command.append" });
    }
    expect(state.pending).toHaveLength(50);
    expect(() =>
      editorSessionReducer(state, { operation: translate(51), type: "command.append" }),
    ).toThrow(/50 pending/u);
  });

  it("requires warning acknowledgement before commit", () => {
    const operation = translate(1);
    let state = editorSessionReducer(
      createEditorSession({ headSnapshotSha256: "a".repeat(64), revision: 2 }),
      { operation, type: "command.append" },
    );
    state = editorSessionReducer(state, { preview: preview(operation), type: "preview.received" });
    expect(editorCanCommit(state, Date.parse("2029-01-01T00:00:00.000Z"))).toBe(false);
    const finding = state.findings[0];
    if (!finding) throw new Error("Missing warning fixture.");
    const key = [finding.severity, finding.code, ...finding.affectedElementIds, "", "", ""].join(
      ":",
    );
    state = editorSessionReducer(state, { findingKey: key, type: "warning.acknowledge" });
    expect(editorCanCommit(state, Date.parse("2029-01-01T00:00:00.000Z"))).toBe(true);
  });

  it("retains uncommitted intent through a revision conflict and explicit reapply", () => {
    const operation = translate(1);
    let state = editorSessionReducer(
      createEditorSession({ headSnapshotSha256: "a".repeat(64), revision: 2 }),
      { operation, type: "command.append" },
    );
    state = editorSessionReducer(state, {
      conflict: {
        currentHeadSnapshotSha256: "c".repeat(64),
        currentRevision: 3,
        detail: "Stale branch head.",
      },
      type: "conflict.received",
    });
    expect(state).toMatchObject({ phase: "conflict", pending: [operation] });
    state = editorSessionReducer(state, {
      base: { headSnapshotSha256: "c".repeat(64), revision: 3 },
      type: "conflict.reapply",
    });
    expect(state).toMatchObject({ phase: "editing", pending: [operation], base: { revision: 3 } });
  });
});
