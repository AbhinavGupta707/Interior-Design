import { describe, expect, it } from "vitest";

import {
  identityFixedSimilarityTransform,
  solveRegistrationConstraintGraph,
  type FixedSimilarityTransform,
  type RegistrationGraphEdge,
  type RegistrationGraphNode,
} from "../../src/index.js";

const residuals = {
  inlierCount: 8,
  maximumMm: 10,
  medianMm: 3,
  p90Mm: 8,
  sampleCount: 8,
} as const;

function translation(xMm: number, yMm = 0, zMm = 0): FixedSimilarityTransform {
  return {
    ...identityFixedSimilarityTransform,
    translationMm: { xMm, yMm, zMm },
  };
}

function node(
  sourceId: string,
  options: Partial<RegistrationGraphNode> = {},
): RegistrationGraphNode {
  return {
    levels: [],
    scaleStatus: "metric-estimated",
    sourceId,
    ...options,
  };
}

function edge(
  edgeId: string,
  fromSourceId: string,
  toSourceId: string,
  transformFromTo: FixedSimilarityTransform,
  options: Partial<RegistrationGraphEdge> = {},
): RegistrationGraphEdge {
  return {
    confidenceBasisPoints: 9_000,
    edgeId,
    fromSourceId,
    reliability: "reliable",
    residuals,
    toSourceId,
    transformFromTo,
    ...options,
  };
}

function valueOf<TValue>(result: { ok: false } | { ok: true; value: TValue }): TValue {
  if (!result.ok) throw new Error("Expected a solved registration constraint graph.");
  return result.value;
}

describe("multi-source registration constraint graph", () => {
  it("keeps anchored, relative and isolated connected components visible", () => {
    const nodes = [
      node("plan", { projectTransform: identityFixedSimilarityTransform }),
      node("roomplan"),
      node("photos"),
      node("measurements"),
      node("assertions"),
    ];
    const edges = [
      edge("control-plan-room", "roomplan", "plan", translation(1_000)),
      edge("overlap-photo-measure", "photos", "measurements", translation(250), {
        reliability: "uncertain",
      }),
    ];

    const result = valueOf(solveRegistrationConstraintGraph(nodes, edges));

    expect(result.config.version).toBe("c9-registration-kernel-v1");
    expect(result.components).toEqual([
      {
        anchoredToProject: false,
        componentId: "component:assertions",
        sourceIds: ["assertions"],
        status: "unregistered",
      },
      {
        anchoredToProject: false,
        componentId: "component:measurements",
        sourceIds: ["measurements", "photos"],
        status: "partial",
      },
      {
        anchoredToProject: true,
        componentId: "component:plan",
        sourceIds: ["plan", "roomplan"],
        status: "registered",
      },
    ]);
    expect(result.sources.find(({ sourceId }) => sourceId === "roomplan")).toMatchObject({
      status: "registered",
      transformToProject: translation(1_000),
    });
    const photoSource = result.sources.find(({ sourceId }) => sourceId === "photos");
    expect(photoSource).toMatchObject({ status: "partial" });
    expect(photoSource?.transformToComponent).toBeDefined();
    expect(photoSource).not.toHaveProperty("transformToProject");
    expect(result.sources.find(({ sourceId }) => sourceId === "assertions")).not.toHaveProperty(
      "transformToProject",
    );
    expect(result.findings.filter(({ code }) => code === "DISCONNECTED_COMPONENT")).toHaveLength(2);
  });

  it("prunes weak uncertain constraints and rejects validated metric scale conflicts", () => {
    const nodes = [
      node("a", {
        projectTransform: identityFixedSimilarityTransform,
        scaleStatus: "metric-validated",
      }),
      node("b", { scaleStatus: "metric-validated" }),
      node("c"),
    ];
    const scaleConflict: FixedSimilarityTransform = {
      ...identityFixedSimilarityTransform,
      scalePartsPerMillion: 1_100_000,
    };
    const result = valueOf(
      solveRegistrationConstraintGraph(nodes, [
        edge("scale-conflict", "b", "a", scaleConflict),
        edge("weak-loop", "c", "a", translation(0), {
          confidenceBasisPoints: 5_999,
          reliability: "uncertain",
        }),
      ]),
    );

    expect(result.edgeDecisions).toEqual([
      {
        edgeId: "scale-conflict",
        reasonCode: "SCALE_ALIGNMENT_CONFLICT",
        status: "conflict",
      },
      { edgeId: "weak-loop", reasonCode: "UNCERTAIN_EDGE_PRUNED", status: "pruned" },
    ]);
    expect(result.sources.map(({ status }) => status)).toEqual([
      "registered",
      "unregistered",
      "unregistered",
    ]);
    expect(result.findings.map(({ code }) => code)).toContain("SCALE_ALIGNMENT_CONFLICT");
  });

  it("selects a deterministic spanning solution and exposes reliable cycle conflicts", () => {
    const nodes = [
      node("a", { projectTransform: identityFixedSimilarityTransform }),
      node("b"),
      node("c"),
    ];
    const edges = [
      edge("ab", "b", "a", translation(1_000)),
      edge("bc", "c", "b", translation(1_000)),
      edge("ac-conflict", "c", "a", translation(2_500), { confidenceBasisPoints: 8_000 }),
    ];

    const result = valueOf(solveRegistrationConstraintGraph(nodes, edges));

    expect(result.edgeDecisions).toEqual([
      { edgeId: "ab", status: "selected" },
      {
        edgeId: "ac-conflict",
        reasonCode: "CONSTRAINT_CYCLE_CONFLICT",
        status: "conflict",
      },
      { edgeId: "bc", status: "selected" },
    ]);
    expect(result.components[0]?.status).toBe("conflicted");
    expect(result.sources.every(({ status }) => status === "partial")).toBe(true);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: "CONSTRAINT_CYCLE_CONFLICT", magnitude: 500 }),
    );
  });

  it("surfaces level drift independently of relative pose registration", () => {
    const result = valueOf(
      solveRegistrationConstraintGraph(
        [
          node("a", {
            levels: [{ elevationMm: 0, semanticLevelId: "ground" }],
            projectTransform: identityFixedSimilarityTransform,
          }),
          node("b", { levels: [{ elevationMm: 0, semanticLevelId: "ground" }] }),
        ],
        [edge("level-edge", "b", "a", translation(0, 0, 350))],
      ),
    );

    expect(result.components[0]?.status).toBe("conflicted");
    expect(result.sources.every(({ status }) => status === "partial")).toBe(true);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: "LEVEL_ALIGNMENT_CONFLICT", magnitude: 350 }),
    );
  });

  it("is deterministic under node/edge shuffles and records uncertain-edge selection", () => {
    const nodes = [
      node("a", { projectTransform: identityFixedSimilarityTransform }),
      node("b"),
      node("c"),
    ];
    const edges = [
      edge("ab", "b", "a", translation(1_000)),
      edge("bc", "c", "b", translation(500), { reliability: "uncertain" }),
    ];
    const first = solveRegistrationConstraintGraph(nodes, edges);
    const second = solveRegistrationConstraintGraph([...nodes].reverse(), [...edges].reverse());

    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    if (first.ok) {
      expect(first.value.edgeDecisions).toContainEqual({ edgeId: "bc", status: "selected" });
      expect(first.value.components[0]?.status).toBe("partial");
      expect(first.value.sources.find(({ sourceId }) => sourceId === "c")?.status).toBe("partial");
      expect(first.value.sources.find(({ sourceId }) => sourceId === "c")?.constraintPath).toEqual([
        expect.objectContaining({ edgeId: "bc", reliability: "uncertain", residuals }),
        expect.objectContaining({ edgeId: "ab", reliability: "reliable", residuals }),
      ]);
      expect(Object.isFrozen(first.value.components)).toBe(true);
    }
    expect(Object.isFrozen(nodes[0])).toBe(false);
    expect(Object.isFrozen(edges[0])).toBe(false);
  });

  it("fails closed on malformed graphs, residuals and transform overflow", () => {
    expect(
      solveRegistrationConstraintGraph([node("duplicate"), node("duplicate")], []),
    ).toMatchObject({ error: { code: "INVALID_IDENTIFIER" }, ok: false });
    expect(
      solveRegistrationConstraintGraph([node("a")], [edge("self", "a", "a", translation(0))]),
    ).toMatchObject({ error: { code: "INVALID_CONFIGURATION" }, ok: false });
    expect(
      solveRegistrationConstraintGraph(
        [node("a"), node("b")],
        [
          edge("bad-residual", "b", "a", translation(0), {
            residuals: { ...residuals, medianMm: 20 },
          }),
        ],
      ),
    ).toMatchObject({ error: { code: "INVALID_CONFIGURATION" }, ok: false });
    expect(
      solveRegistrationConstraintGraph(
        [
          node("a", {
            projectTransform: {
              ...identityFixedSimilarityTransform,
              translationMm: { xMm: 10_000_000, yMm: 0, zMm: 0 },
            },
          }),
          node("b"),
        ],
        [edge("overflow", "b", "a", translation(1))],
      ),
    ).toMatchObject({ error: { code: "OUTPUT_OVERFLOW" }, ok: false });
  });
});
