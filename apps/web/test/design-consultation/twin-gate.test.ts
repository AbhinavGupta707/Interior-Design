import { describe, expect, it } from "vitest";

import { consultationTwinGate } from "../../src/features/design-consultation/twin-gate";
import { branch, snapshotRecord, uuid } from "../editor-2d/fixtures";
import { brief } from "./fixtures";

describe("C14.3 consultation-to-options twin gate", () => {
  it("accepts only a changed branch whose head is the exact current snapshot", () => {
    expect(consultationTwinGate(brief, snapshotRecord, [branch])).toMatchObject({
      kind: "stale",
    });
    expect(
      consultationTwinGate(brief, snapshotRecord, [
        { ...branch, revision: 2, sourceSnapshotId: uuid(51) },
      ]),
    ).toEqual({ kind: "ready" });
    expect(
      consultationTwinGate(brief, snapshotRecord, [
        { ...branch, headSnapshotId: uuid(52), revision: 2, sourceSnapshotId: uuid(51) },
      ]),
    ).toMatchObject({ kind: "stale" });
  });

  it("fails closed when an accepted brief carries an older model reference", () => {
    const gate = consultationTwinGate(
      {
        ...brief,
        modelReference: {
          modelId: snapshotRecord.modelId,
          snapshotId: uuid(53),
          snapshotSha256: "b".repeat(64),
        },
      },
      snapshotRecord,
      [{ ...branch, revision: 2, sourceSnapshotId: uuid(51) }],
    );
    expect(gate).toMatchObject({ kind: "stale" });
    if (gate.kind === "stale") expect(gate.message).toContain("older model snapshot");
  });
});
