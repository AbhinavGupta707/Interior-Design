import {
  applyFixedSimilarityTransform,
  composeFixedSimilarityTransforms,
  identityFixedSimilarityTransform,
  invertFixedSimilarityTransform,
  validateFixedSimilarityTransform,
} from "./fixed-point.js";
import {
  compareText,
  deepFreeze,
  defaultCoordinateLimitMm,
  failure,
  hasOnlyKeys,
  isBoundedIdentifier,
  success,
} from "./internal.js";
import type {
  FixedSimilarityTransform,
  RegistrationComputation,
  RegistrationGraphComponent,
  RegistrationGraphConfig,
  RegistrationGraphEdge,
  RegistrationGraphEdgeDecision,
  RegistrationGraphFinding,
  RegistrationGraphFindingCode,
  RegistrationGraphNode,
  RegistrationGraphPathConstraint,
  RegistrationGraphResult,
  RegistrationGraphSourceResult,
} from "./types.js";
import { registrationKernelVersion } from "./types.js";

export const defaultRegistrationGraphConfig: RegistrationGraphConfig = deepFreeze({
  cycleRotationToleranceMilliDegrees: 1_000,
  cycleScaleTolerancePartsPerMillion: 10_000,
  cycleTranslationToleranceMm: 50,
  levelAlignmentToleranceMm: 100,
  maximumEdges: 1_024,
  maximumLevelsPerSource: 100,
  maximumNodes: 32,
  maximumReliableResidualMm: 500,
  maximumUncertainResidualMm: 100,
  metricScaleTolerancePartsPerMillion: 20_000,
  minimumUncertainConfidenceBasisPoints: 6_000,
  version: registrationKernelVersion,
});

interface MutableEdgeDecision {
  edgeId: string;
  reasonCode?: RegistrationGraphFindingCode;
  status: "conflict" | "pruned" | "redundant" | "selected";
}

interface ComponentState {
  anchorConflict: boolean;
  anchoredToProject: boolean;
  componentId: string;
  hasUncertainRegistration: boolean;
  levelConflict: boolean;
  reliableCycleConflict: boolean;
  sourceIds: string[];
}

const nodeKeys = new Set(["levels", "projectTransform", "scaleStatus", "sourceId"]);
const levelKeys = new Set(["elevationMm", "semanticLevelId"]);
const edgeKeys = new Set([
  "confidenceBasisPoints",
  "edgeId",
  "fromSourceId",
  "reliability",
  "residuals",
  "toSourceId",
  "transformFromTo",
]);
const residualKeys = new Set(["inlierCount", "maximumMm", "medianMm", "p90Mm", "sampleCount"]);

const graphConfigKeys = new Set<keyof RegistrationGraphConfig>([
  "cycleRotationToleranceMilliDegrees",
  "cycleScaleTolerancePartsPerMillion",
  "cycleTranslationToleranceMm",
  "levelAlignmentToleranceMm",
  "maximumEdges",
  "maximumLevelsPerSource",
  "maximumNodes",
  "maximumReliableResidualMm",
  "maximumUncertainResidualMm",
  "metricScaleTolerancePartsPerMillion",
  "minimumUncertainConfidenceBasisPoints",
  "version",
]);

function resolveGraphConfig(
  input: Partial<RegistrationGraphConfig> | undefined,
): RegistrationComputation<RegistrationGraphConfig> {
  if (input !== undefined) {
    const unknown = Object.keys(input).find(
      (key) => !graphConfigKeys.has(key as keyof RegistrationGraphConfig),
    );
    if (unknown !== undefined) {
      return failure(
        "INVALID_CONFIGURATION",
        `Unknown registration graph configuration field: ${unknown}.`,
      );
    }
  }
  const config = { ...defaultRegistrationGraphConfig, ...input };
  if (!isRegistrationVersion(config.version)) {
    return failure(
      "INVALID_CONFIGURATION",
      "The registration graph configuration version is unsupported.",
    );
  }
  const values = [
    config.cycleRotationToleranceMilliDegrees,
    config.cycleScaleTolerancePartsPerMillion,
    config.cycleTranslationToleranceMm,
    config.levelAlignmentToleranceMm,
    config.maximumEdges,
    config.maximumLevelsPerSource,
    config.maximumNodes,
    config.maximumReliableResidualMm,
    config.maximumUncertainResidualMm,
    config.metricScaleTolerancePartsPerMillion,
    config.minimumUncertainConfidenceBasisPoints,
  ];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    return failure(
      "INVALID_CONFIGURATION",
      "Registration graph bounds must be non-negative safe integers.",
    );
  }
  if (
    config.maximumNodes < 1 ||
    config.maximumNodes > 32 ||
    config.maximumEdges < 0 ||
    config.maximumEdges > 4_096 ||
    config.maximumLevelsPerSource > 1_000 ||
    config.minimumUncertainConfidenceBasisPoints > 10_000
  ) {
    return failure(
      "INVALID_CONFIGURATION",
      "Registration graph configuration exceeds bounded limits.",
    );
  }
  return success(deepFreeze(config));
}

function isRegistrationVersion(value: unknown): boolean {
  return value === registrationKernelVersion;
}

function validateResiduals(edge: RegistrationGraphEdge): boolean {
  const residual = edge.residuals;
  return (
    [
      residual.inlierCount,
      residual.maximumMm,
      residual.medianMm,
      residual.p90Mm,
      residual.sampleCount,
    ].every((value) => Number.isSafeInteger(value) && value >= 0) &&
    residual.inlierCount <= residual.sampleCount &&
    residual.medianMm <= residual.p90Mm &&
    residual.p90Mm <= residual.maximumMm
  );
}

function validateGraph(
  nodes: readonly RegistrationGraphNode[],
  edges: readonly RegistrationGraphEdge[],
  config: RegistrationGraphConfig,
): RegistrationComputation<{
  readonly edges: readonly RegistrationGraphEdge[];
  readonly nodes: readonly RegistrationGraphNode[];
}> {
  if (
    nodes.length < 1 ||
    nodes.length > config.maximumNodes ||
    edges.length > config.maximumEdges
  ) {
    return failure(
      "RESOURCE_LIMIT_EXCEEDED",
      "Registration graph node or edge count is outside configured bounds.",
    );
  }
  const orderedNodes = [...nodes].sort((left, right) => compareText(left.sourceId, right.sourceId));
  const nodeIds = new Set<string>();
  const checkedNodes: RegistrationGraphNode[] = [];
  for (const node of orderedNodes) {
    if (
      !hasOnlyKeys(node, nodeKeys) ||
      !isBoundedIdentifier(node.sourceId) ||
      nodeIds.has(node.sourceId)
    ) {
      return failure(
        "INVALID_IDENTIFIER",
        "Registration graph source identifiers must be unique and bounded.",
      );
    }
    nodeIds.add(node.sourceId);
    if (
      !(["metric-estimated", "metric-validated", "unknown"] as const).includes(node.scaleStatus)
    ) {
      return failure("INVALID_CONFIGURATION", "Registration graph source scale status is invalid.");
    }
    if (node.levels.length > config.maximumLevelsPerSource) {
      return failure(
        "RESOURCE_LIMIT_EXCEEDED",
        "A registration source exceeds the configured level bound.",
      );
    }
    const levelIds = new Set<string>();
    for (const level of node.levels) {
      if (
        !hasOnlyKeys(level, levelKeys) ||
        !isBoundedIdentifier(level.semanticLevelId) ||
        levelIds.has(level.semanticLevelId) ||
        !Number.isSafeInteger(level.elevationMm) ||
        Math.abs(level.elevationMm) > defaultCoordinateLimitMm
      ) {
        return failure(
          "INVALID_CONFIGURATION",
          "Registration graph levels must be unique, bounded integer observations.",
        );
      }
      levelIds.add(level.semanticLevelId);
    }
    if (node.projectTransform !== undefined) {
      const checked = validateFixedSimilarityTransform(node.projectTransform);
      if (!checked.ok) return checked;
      checkedNodes.push({
        levels: node.levels.map((level) => ({ ...level })),
        projectTransform: checked.value,
        scaleStatus: node.scaleStatus,
        sourceId: node.sourceId,
      });
    } else {
      checkedNodes.push({
        levels: node.levels.map((level) => ({ ...level })),
        scaleStatus: node.scaleStatus,
        sourceId: node.sourceId,
      });
    }
  }
  const orderedEdges = [...edges].sort((left, right) => compareText(left.edgeId, right.edgeId));
  const edgeIds = new Set<string>();
  const checkedEdges: RegistrationGraphEdge[] = [];
  for (const edge of orderedEdges) {
    if (
      !hasOnlyKeys(edge, edgeKeys) ||
      !hasOnlyKeys(edge.residuals, residualKeys) ||
      !isBoundedIdentifier(edge.edgeId) ||
      edgeIds.has(edge.edgeId)
    ) {
      return failure(
        "INVALID_IDENTIFIER",
        "Registration graph edge identifiers must be unique and bounded.",
      );
    }
    edgeIds.add(edge.edgeId);
    if (
      !nodeIds.has(edge.fromSourceId) ||
      !nodeIds.has(edge.toSourceId) ||
      edge.fromSourceId === edge.toSourceId ||
      !(["reliable", "uncertain"] as const).includes(edge.reliability) ||
      !Number.isSafeInteger(edge.confidenceBasisPoints) ||
      edge.confidenceBasisPoints < 0 ||
      edge.confidenceBasisPoints > 10_000 ||
      !validateResiduals(edge)
    ) {
      return failure("INVALID_CONFIGURATION", "Registration graph edge metadata is invalid.");
    }
    const checked = validateFixedSimilarityTransform(edge.transformFromTo);
    if (!checked.ok) return checked;
    checkedEdges.push({
      confidenceBasisPoints: edge.confidenceBasisPoints,
      edgeId: edge.edgeId,
      fromSourceId: edge.fromSourceId,
      reliability: edge.reliability,
      residuals: { ...edge.residuals },
      toSourceId: edge.toSourceId,
      transformFromTo: checked.value,
    });
  }
  return success({ nodes: checkedNodes, edges: checkedEdges });
}

class DisjointSet {
  readonly #parent = new Map<string, string>();

  public constructor(ids: readonly string[]) {
    for (const id of ids) this.#parent.set(id, id);
  }

  public find(id: string): string {
    const parent = this.#parent.get(id);
    if (parent === undefined) throw new Error("Unknown disjoint-set identifier.");
    if (parent === id) return id;
    const root = this.find(parent);
    this.#parent.set(id, root);
    return root;
  }

  public union(left: string, right: string): boolean {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) return false;
    const [first, second] = [leftRoot, rightRoot].sort(compareText) as [string, string];
    this.#parent.set(second, first);
    return true;
  }
}

function finding(
  code: RegistrationGraphFindingCode,
  detail: string,
  severity: "error" | "information" | "warning",
  sourceIds: readonly string[],
  edgeIds: readonly string[],
  magnitude?: number,
): RegistrationGraphFinding {
  return {
    code,
    detail,
    edgeIds: [...edgeIds].sort(compareText),
    ...(magnitude === undefined ? {} : { magnitude }),
    severity,
    sourceIds: [...sourceIds].sort(compareText),
  };
}

function edgeOrder(left: RegistrationGraphEdge, right: RegistrationGraphEdge): number {
  if (left.reliability !== right.reliability) return left.reliability === "reliable" ? -1 : 1;
  if (left.confidenceBasisPoints !== right.confidenceBasisPoints) {
    return right.confidenceBasisPoints - left.confidenceBasisPoints;
  }
  if (left.residuals.medianMm !== right.residuals.medianMm) {
    return left.residuals.medianMm - right.residuals.medianMm;
  }
  return compareText(left.edgeId, right.edgeId);
}

function quaternionAngleMilliDegrees(
  left: FixedSimilarityTransform,
  right: FixedSimilarityTransform,
): number {
  const a = left.rotationQuaternionE9;
  const b = right.rotationQuaternionE9;
  const leftNorm = Math.hypot(a.w, a.x, a.y, a.z);
  const rightNorm = Math.hypot(b.w, b.x, b.y, b.z);
  const cosine = Math.min(
    1,
    Math.abs((a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z) / (leftNorm * rightNorm)),
  );
  return Math.round(2 * Math.acos(cosine) * (180_000 / Math.PI));
}

function transformDeltas(
  left: FixedSimilarityTransform,
  right: FixedSimilarityTransform,
): { rotationMilliDegrees: number; scalePpm: number; translationMm: number } {
  return {
    rotationMilliDegrees: quaternionAngleMilliDegrees(left, right),
    scalePpm: Math.abs(left.scalePartsPerMillion - right.scalePartsPerMillion),
    translationMm: Math.round(
      Math.hypot(
        left.translationMm.xMm - right.translationMm.xMm,
        left.translationMm.yMm - right.translationMm.yMm,
        left.translationMm.zMm - right.translationMm.zMm,
      ),
    ),
  };
}

function componentId(sourceIds: readonly string[]): string {
  return `component:${sourceIds[0] ?? "unknown"}`;
}

export function solveRegistrationConstraintGraph(
  nodesInput: readonly RegistrationGraphNode[],
  edgesInput: readonly RegistrationGraphEdge[],
  configInput?: Partial<RegistrationGraphConfig>,
): RegistrationComputation<RegistrationGraphResult> {
  const configResult = resolveGraphConfig(configInput);
  if (!configResult.ok) return configResult;
  const config = configResult.value;
  const graph = validateGraph(nodesInput, edgesInput, config);
  if (!graph.ok) return graph;
  const { edges, nodes } = graph.value;
  const nodesById = new Map(nodes.map((node) => [node.sourceId, node]));
  const findings: RegistrationGraphFinding[] = [];
  const decisions = new Map<string, MutableEdgeDecision>();
  const eligible: RegistrationGraphEdge[] = [];

  for (const edge of edges) {
    const from = nodesById.get(edge.fromSourceId);
    const to = nodesById.get(edge.toSourceId);
    if (from === undefined || to === undefined) {
      return failure("INVALID_CONFIGURATION", "Registration graph references an unknown source.");
    }
    if (
      from.scaleStatus === "metric-validated" &&
      to.scaleStatus === "metric-validated" &&
      Math.abs(edge.transformFromTo.scalePartsPerMillion - 1_000_000) >
        config.metricScaleTolerancePartsPerMillion
    ) {
      decisions.set(edge.edgeId, {
        edgeId: edge.edgeId,
        reasonCode: "SCALE_ALIGNMENT_CONFLICT",
        status: "conflict",
      });
      findings.push(
        finding(
          "SCALE_ALIGNMENT_CONFLICT",
          "Two metric-validated sources require an incompatible scale change; the edge was not applied.",
          "error",
          [edge.fromSourceId, edge.toSourceId],
          [edge.edgeId],
          Math.abs(edge.transformFromTo.scalePartsPerMillion - 1_000_000),
        ),
      );
      continue;
    }
    if (
      edge.reliability === "reliable" &&
      edge.residuals.maximumMm > config.maximumReliableResidualMm
    ) {
      decisions.set(edge.edgeId, {
        edgeId: edge.edgeId,
        reasonCode: "RELIABLE_EDGE_RESIDUAL_EXCEEDED",
        status: "conflict",
      });
      findings.push(
        finding(
          "RELIABLE_EDGE_RESIDUAL_EXCEEDED",
          "A reliable constraint exceeded its severe residual bound and was not applied.",
          "error",
          [edge.fromSourceId, edge.toSourceId],
          [edge.edgeId],
          edge.residuals.maximumMm,
        ),
      );
      continue;
    }
    if (
      edge.reliability === "uncertain" &&
      (edge.confidenceBasisPoints < config.minimumUncertainConfidenceBasisPoints ||
        edge.residuals.maximumMm > config.maximumUncertainResidualMm)
    ) {
      decisions.set(edge.edgeId, {
        edgeId: edge.edgeId,
        reasonCode: "UNCERTAIN_EDGE_PRUNED",
        status: "pruned",
      });
      findings.push(
        finding(
          "UNCERTAIN_EDGE_PRUNED",
          "An uncertain constraint did not meet confidence/residual admission bounds.",
          "warning",
          [edge.fromSourceId, edge.toSourceId],
          [edge.edgeId],
        ),
      );
      continue;
    }
    eligible.push(edge);
  }

  const disjoint = new DisjointSet(nodes.map(({ sourceId }) => sourceId));
  const selected: RegistrationGraphEdge[] = [];
  for (const edge of [...eligible].sort(edgeOrder)) {
    if (disjoint.union(edge.fromSourceId, edge.toSourceId)) {
      selected.push(edge);
      decisions.set(edge.edgeId, { edgeId: edge.edgeId, status: "selected" });
    } else {
      decisions.set(edge.edgeId, { edgeId: edge.edgeId, status: "redundant" });
    }
  }

  const sourceGroups = new Map<string, string[]>();
  for (const node of nodes) {
    const root = disjoint.find(node.sourceId);
    const group = sourceGroups.get(root) ?? [];
    group.push(node.sourceId);
    sourceGroups.set(root, group);
  }
  const componentStates = [...sourceGroups.values()]
    .map((sourceIds): ComponentState => {
      sourceIds.sort(compareText);
      return {
        anchorConflict: false,
        anchoredToProject: sourceIds.some(
          (sourceId) => nodesById.get(sourceId)?.projectTransform !== undefined,
        ),
        componentId: componentId(sourceIds),
        hasUncertainRegistration: false,
        levelConflict: false,
        reliableCycleConflict: false,
        sourceIds,
      };
    })
    .sort((left, right) => compareText(left.componentId, right.componentId));
  const componentBySource = new Map<string, ComponentState>();
  for (const component of componentStates) {
    for (const sourceId of component.sourceIds) componentBySource.set(sourceId, component);
    if (!component.anchoredToProject) {
      findings.push(
        finding(
          "DISCONNECTED_COMPONENT",
          component.sourceIds.length === 1
            ? "The source has no admitted constraint or validated project anchor."
            : "The relative component has no validated path into project coordinates.",
          "warning",
          component.sourceIds,
          [],
        ),
      );
    }
  }

  const selectedAdjacency = new Map<string, RegistrationGraphEdge[]>();
  for (const node of nodes) selectedAdjacency.set(node.sourceId, []);
  for (const edge of selected) {
    selectedAdjacency.get(edge.fromSourceId)?.push(edge);
    selectedAdjacency.get(edge.toSourceId)?.push(edge);
  }
  for (const adjacency of selectedAdjacency.values())
    adjacency.sort((left, right) => compareText(left.edgeId, right.edgeId));

  const transforms = new Map<string, FixedSimilarityTransform>();
  const uncertainPath = new Map<string, boolean>();
  const constraintPaths = new Map<string, readonly RegistrationGraphPathConstraint[]>();
  for (const component of componentStates) {
    const anchors = component.sourceIds.filter(
      (sourceId) => nodesById.get(sourceId)?.projectTransform !== undefined,
    );
    const rootId = anchors[0] ?? component.sourceIds[0];
    if (rootId === undefined) continue;
    const rootTransform =
      nodesById.get(rootId)?.projectTransform ?? identityFixedSimilarityTransform;
    transforms.set(rootId, rootTransform);
    uncertainPath.set(rootId, false);
    constraintPaths.set(rootId, []);
    const queue = [rootId];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const currentId = queue[cursor];
      if (currentId === undefined) continue;
      const currentTransform = transforms.get(currentId);
      if (currentTransform === undefined) continue;
      for (const edge of selectedAdjacency.get(currentId) ?? []) {
        const nextId = edge.fromSourceId === currentId ? edge.toSourceId : edge.fromSourceId;
        if (transforms.has(nextId)) continue;
        let nextTransform: RegistrationComputation<FixedSimilarityTransform>;
        if (edge.fromSourceId === currentId) {
          const inverseEdge = invertFixedSimilarityTransform(edge.transformFromTo);
          if (!inverseEdge.ok) return inverseEdge;
          nextTransform = composeFixedSimilarityTransforms(currentTransform, inverseEdge.value);
        } else {
          nextTransform = composeFixedSimilarityTransforms(currentTransform, edge.transformFromTo);
        }
        if (!nextTransform.ok) return nextTransform;
        transforms.set(nextId, nextTransform.value);
        uncertainPath.set(
          nextId,
          (uncertainPath.get(currentId) ?? false) || edge.reliability === "uncertain",
        );
        constraintPaths.set(nextId, [
          ...(constraintPaths.get(currentId) ?? []),
          {
            edgeId: edge.edgeId,
            reliability: edge.reliability,
            residuals: { ...edge.residuals },
          },
        ]);
        queue.push(nextId);
      }
    }
    for (const anchorId of anchors.slice(1)) {
      const declared = nodesById.get(anchorId)?.projectTransform;
      const predicted = transforms.get(anchorId);
      if (declared === undefined || predicted === undefined) continue;
      const delta = transformDeltas(declared, predicted);
      if (
        delta.translationMm > config.cycleTranslationToleranceMm ||
        delta.rotationMilliDegrees > config.cycleRotationToleranceMilliDegrees ||
        delta.scalePpm > config.cycleScaleTolerancePartsPerMillion
      ) {
        component.anchorConflict = true;
        findings.push(
          finding(
            "ANCHOR_CONFLICT",
            "Independent project anchors disagree beyond the fixed project-alignment tolerances.",
            "error",
            [rootId, anchorId],
            [],
            Math.max(delta.translationMm, delta.scalePpm),
          ),
        );
      }
    }
    component.hasUncertainRegistration = component.sourceIds.some(
      (sourceId) => uncertainPath.get(sourceId) === true,
    );
  }

  for (const edge of eligible.filter(
    (candidate) => decisions.get(candidate.edgeId)?.status === "redundant",
  )) {
    const fromProject = transforms.get(edge.fromSourceId);
    const toProject = transforms.get(edge.toSourceId);
    if (fromProject === undefined || toProject === undefined) continue;
    const inverseTo = invertFixedSimilarityTransform(toProject);
    if (!inverseTo.ok) return inverseTo;
    const predicted = composeFixedSimilarityTransforms(inverseTo.value, fromProject);
    if (!predicted.ok) return predicted;
    const delta = transformDeltas(predicted.value, edge.transformFromTo);
    if (
      delta.translationMm > config.cycleTranslationToleranceMm ||
      delta.rotationMilliDegrees > config.cycleRotationToleranceMilliDegrees ||
      delta.scalePpm > config.cycleScaleTolerancePartsPerMillion
    ) {
      decisions.set(edge.edgeId, {
        edgeId: edge.edgeId,
        reasonCode: "CONSTRAINT_CYCLE_CONFLICT",
        status: "conflict",
      });
      const component = componentBySource.get(edge.fromSourceId);
      if (edge.reliability === "reliable" && component !== undefined) {
        component.reliableCycleConflict = true;
      }
      findings.push(
        finding(
          "CONSTRAINT_CYCLE_CONFLICT",
          "A redundant constraint conflicts with the deterministic selected registration path.",
          edge.reliability === "reliable" ? "error" : "warning",
          [edge.fromSourceId, edge.toSourceId],
          [edge.edgeId],
          Math.max(delta.translationMm, delta.scalePpm),
        ),
      );
    }
  }

  for (const component of componentStates) {
    const levelGroups = new Map<string, { elevationMm: number; sourceId: string }[]>();
    for (const sourceId of component.sourceIds) {
      const node = nodesById.get(sourceId);
      const transform = transforms.get(sourceId);
      if (node === undefined || transform === undefined) continue;
      for (const level of node.levels) {
        const point = applyFixedSimilarityTransform(transform, {
          xMm: 0,
          yMm: 0,
          zMm: level.elevationMm,
        });
        if (!point.ok) return point;
        const observations = levelGroups.get(level.semanticLevelId) ?? [];
        observations.push({ elevationMm: point.value.zMm, sourceId });
        levelGroups.set(level.semanticLevelId, observations);
      }
    }
    for (const observations of levelGroups.values()) {
      observations.sort((left, right) => compareText(left.sourceId, right.sourceId));
      const minimum = Math.min(...observations.map(({ elevationMm }) => elevationMm));
      const maximum = Math.max(...observations.map(({ elevationMm }) => elevationMm));
      const magnitude = maximum - minimum;
      if (observations.length >= 2 && magnitude > config.levelAlignmentToleranceMm) {
        component.levelConflict = true;
        findings.push(
          finding(
            "LEVEL_ALIGNMENT_CONFLICT",
            "Sources place the same semantic level at incompatible project elevations.",
            "warning",
            observations.map(({ sourceId }) => sourceId),
            [],
            magnitude,
          ),
        );
      }
    }
  }

  const components: RegistrationGraphComponent[] = componentStates.map((component) => ({
    anchoredToProject: component.anchoredToProject,
    componentId: component.componentId,
    sourceIds: component.sourceIds,
    status:
      component.anchorConflict || component.levelConflict || component.reliableCycleConflict
        ? "conflicted"
        : component.anchoredToProject && !component.hasUncertainRegistration
          ? "registered"
          : component.sourceIds.length > 1 || component.anchoredToProject
            ? "partial"
            : "unregistered",
  }));
  const sources: RegistrationGraphSourceResult[] = nodes.map((node) => {
    const component = componentBySource.get(node.sourceId);
    if (component === undefined) throw new Error("Registration component assignment is missing.");
    const status =
      component.anchorConflict || component.levelConflict || component.reliableCycleConflict
        ? "partial"
        : component.anchoredToProject && uncertainPath.get(node.sourceId) !== true
          ? "registered"
          : component.sourceIds.length > 1
            ? "partial"
            : "unregistered";
    const transform = transforms.get(node.sourceId);
    return {
      componentId: component.componentId,
      constraintPath: [...(constraintPaths.get(node.sourceId) ?? [])].reverse(),
      sourceId: node.sourceId,
      status,
      ...(status === "unregistered" || transform === undefined
        ? {}
        : component.anchoredToProject
          ? { transformToProject: transform }
          : { transformToComponent: transform }),
    };
  });
  const edgeDecisions: RegistrationGraphEdgeDecision[] = edges.map((edge) => {
    const decision = decisions.get(edge.edgeId);
    if (decision === undefined) throw new Error("Registration edge decision is missing.");
    return decision;
  });
  findings.sort((left, right) => {
    const codeOrder = compareText(left.code, right.code);
    if (codeOrder !== 0) return codeOrder;
    return compareText(left.sourceIds.join(":"), right.sourceIds.join(":"));
  });
  return success(
    deepFreeze({
      components,
      config,
      edgeDecisions,
      findings,
      sources,
      version: registrationKernelVersion,
    }),
  );
}
