import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { deriveC12SystemPolicy } from "../src/c12-policy.js";
import { canonicalSnapshotFixture } from "./c4/fixtures.js";

describe("C12 deterministic system policy", () => {
  it("derives stable explicit finish hosts without inventing prose facts or keep-outs", () => {
    const snapshot = canonicalSnapshotFixture({ modelId: randomUUID(), projectId: randomUUID() });
    const reordered = {
      ...snapshot,
      elements: {
        ...snapshot.elements,
        surfaces: [...snapshot.elements.surfaces].reverse(),
        walls: [...snapshot.elements.walls].reverse(),
      },
    };

    const policy = deriveC12SystemPolicy(snapshot);
    expect(deriveC12SystemPolicy(reordered)).toEqual(policy);
    expect(policy.briefConstraintFacts).toEqual([]);
    expect(policy.keepOuts).toEqual([]);
    expect(policy.finishTargets).toHaveLength(
      snapshot.elements.surfaces.length + snapshot.elements.walls.length,
    );
    expect(policy.finishTargets).toEqual(
      [...policy.finishTargets].sort((left, right) =>
        left.targetElementId.localeCompare(right.targetElementId),
      ),
    );
  });

  it("maps only computationally valid canonical faces", () => {
    const snapshot = canonicalSnapshotFixture({ modelId: randomUUID(), projectId: randomUUID() });
    const policy = deriveC12SystemPolicy(snapshot);
    const byId = new Map(policy.finishTargets.map((target) => [target.targetElementId, target]));

    for (const wall of snapshot.elements.walls) {
      expect(byId.get(wall.id)?.allowedFaces).toEqual(["inside", "outside"]);
    }
    for (const surface of snapshot.elements.surfaces) {
      const expected =
        surface.kind === "floor"
          ? ["top"]
          : surface.kind === "ceiling"
            ? ["bottom"]
            : surface.kind === "wall-face"
              ? ["inside", "outside"]
              : surface.kind === "other"
                ? ["all"]
                : ["bottom", "top"];
      expect(byId.get(surface.id)?.allowedFaces).toEqual(expected);
    }
  });
});
