import { describe, expect, it } from "vitest";

import {
  buildFusionAnchorGroups,
  emptyFusionAnchorDraft,
  minimumFusionAnchorDrafts,
} from "../../src/features/discrepancy-review/anchors";
import { fusionSources } from "./fixtures";

const ids = [
  "c9000000-0000-4000-8000-000000000001",
  "c9000000-0000-4000-8000-000000000002",
  "c9000000-0000-4000-8000-000000000003",
] as const;

function rows() {
  return [
    {
      ...emptyFusionAnchorDraft(),
      projectX: "100",
      projectY: "200",
      projectZ: "0",
      sourceX: "0",
      sourceY: "0",
      sourceZ: "0",
    },
    {
      ...emptyFusionAnchorDraft(),
      projectX: "1100",
      projectY: "200",
      projectZ: "0",
      sourceX: "1000",
      sourceY: "0",
      sourceZ: "0",
    },
    {
      ...emptyFusionAnchorDraft(),
      projectX: "100",
      projectY: "1200",
      projectZ: "0",
      sourceX: "0",
      sourceY: "1000",
      sourceZ: "0",
    },
  ];
}

describe("C9 explicit registration anchors", () => {
  it("builds bounded non-collinear anchor groups for every source-local input", () => {
    const source = fusionSources[0];
    if (!source) throw new Error("The source fixture is missing.");
    let index = 0;
    const groups = buildFusionAnchorGroups(
      [source],
      { [source.id]: rows() },
      () => ids[index++] ?? "c9000000-0000-4000-8000-000000000099",
    );
    expect(groups).toHaveLength(1);
    expect(groups?.[0]?.sourceId).toBe(source.id);
    expect(groups?.[0]?.anchors).toHaveLength(3);
    expect(groups?.[0]?.anchors[0]).toMatchObject({
      confidenceBasisPoints: 7_500,
      method: "user-correspondence",
      projectPoint: { xMm: 100, yMm: 200, zMm: 0 },
      sourcePoint: { xMm: 0, yMm: 0, zMm: 0 },
    });
  });

  it("fails closed for blank, non-integer, out-of-range or collinear correspondences", () => {
    const source = fusionSources[0];
    if (!source) throw new Error("The source fixture is missing.");
    expect(
      buildFusionAnchorGroups([source], { [source.id]: minimumFusionAnchorDrafts() }, () => ids[0]),
    ).toBeUndefined();
    expect(
      buildFusionAnchorGroups(
        [source],
        { [source.id]: rows().map((row) => ({ ...row, sourceX: "1.5" })) },
        () => ids[0],
      ),
    ).toBeUndefined();
    expect(
      buildFusionAnchorGroups(
        [source],
        { [source.id]: rows().map((row) => ({ ...row, projectX: "10000001" })) },
        () => ids[0],
      ),
    ).toBeUndefined();
    expect(
      buildFusionAnchorGroups(
        [source],
        {
          [source.id]: rows().map((row, index) => ({
            ...row,
            projectX: String(index * 1000),
            projectY: "0",
            sourceX: String(index * 1000),
            sourceY: "0",
          })),
        },
        () => ids[0],
      ),
    ).toBeUndefined();
  });

  it("does not request anchors for exact project-local sources", () => {
    const source = fusionSources[0];
    if (!source) throw new Error("The source fixture is missing.");
    expect(
      buildFusionAnchorGroups(
        [{ ...source, coordinateFrame: "project-local", scaleStatus: "metric-validated" }],
        {},
        () => ids[0],
      ),
    ).toEqual([]);
  });
});
