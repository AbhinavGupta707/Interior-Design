import {
  c10ScenePolicy,
  canonicalHomeSnapshotSchema,
  sceneArtifactSchema,
  sceneCompileConfigurationSchema,
  sceneManifestSchema,
  sceneSnapshotReferenceSchema,
  type CanonicalHomeSnapshot,
  type SceneElementMapping,
  type SceneFinding,
} from "@interior-design/contracts";
import { validateCanonicalGeometry } from "@interior-design/geometry-kernel";
import { validateBytes, version as validatorVersion } from "gltf-validator";

import {
  assertPlainIJson,
  canonicalJsonBytes,
  canonicalSnapshotSha256,
  compareCanonicalValues,
  sha256Hex,
} from "./canonical.js";
import { SceneCompileError, throwIfCancelled } from "./errors.js";
import {
  MeshAccumulator,
  knownValue,
  pathLength,
  polygonMesh,
  samplePath,
  triangulatePolygon,
  wallLateralExtents,
  wallPieces,
  type FloatPoint3Mm,
  type MeshData,
  type Opening,
  type Point2Mm,
  type Point3Mm,
  type Wall,
} from "./geometry.js";
import { parseGlb } from "./glb-parser.js";
import { writeGlb, type GltfMeshInput } from "./glb-writer.js";
import { sceneCompilerVersion, type CompiledScene, type SceneCompileInput } from "./types.js";

type Elements = CanonicalHomeSnapshot["elements"];
type ModelElement = Elements[keyof Elements][number];
type Level = Elements["levels"][number];
type Finish = Elements["finishes"][number];

interface PlannedElement {
  readonly element: ModelElement;
  readonly omissionCode?: string;
  readonly omissionDetail?: string;
  readonly status: "mapped" | "omitted";
}

interface MaterialDefinition {
  readonly finishId?: string;
  readonly json: Readonly<Record<string, unknown>>;
  readonly key: string;
}

interface PlannedMesh {
  readonly build: () => MeshData;
  readonly elementId: string;
  readonly materialKey: string;
}

interface Counts {
  materials: number;
  meshes: number;
  nodes: number;
  triangles: number;
  vertices: number;
}

class FindingCollector {
  readonly #findings = new Map<string, SceneFinding>();

  add(finding: SceneFinding): void {
    const normalized: SceneFinding = {
      affectedElementIds: [...new Set(finding.affectedElementIds)].sort(compareStrings),
      code: finding.code,
      detail: finding.detail,
      severity: finding.severity,
    };
    const key = [
      normalized.code,
      normalized.affectedElementIds.join("\u0001"),
      normalized.severity,
      normalized.detail,
    ].join("\u0000");
    this.#findings.set(key, normalized);
    if (this.#findings.size > c10ScenePolicy.maximumFindings) {
      throw new SceneCompileError(
        "RESOURCE_LIMIT_EXCEEDED",
        "Scene findings exceed the frozen publication limit.",
      );
    }
  }

  finish(): readonly SceneFinding[] {
    return [...this.#findings.values()].sort((left, right) =>
      compareStrings(
        [left.code, left.affectedElementIds.join("\u0001"), left.severity, left.detail].join(
          "\u0000",
        ),
        [right.code, right.affectedElementIds.join("\u0001"), right.severity, right.detail].join(
          "\u0000",
        ),
      ),
    );
  }
}

class BoundsTracker {
  #hasPoint = false;
  #maximum = { xMm: 0, yMm: 0, zMm: 0 };
  #minimum = { xMm: 0, yMm: 0, zMm: 0 };

  add(point: FloatPoint3Mm): void {
    if (![point.xMm, point.yMm, point.zMm].every(Number.isFinite)) {
      throw new SceneCompileError(
        "GEOMETRY_INVALID",
        "Generated geometry contains a non-finite point.",
      );
    }
    const minimum = {
      xMm: Math.floor(point.xMm),
      yMm: Math.floor(point.yMm),
      zMm: Math.floor(point.zMm),
    };
    const maximum = {
      xMm: Math.ceil(point.xMm),
      yMm: Math.ceil(point.yMm),
      zMm: Math.ceil(point.zMm),
    };
    if (!this.#hasPoint) {
      this.#minimum = minimum;
      this.#maximum = maximum;
      this.#hasPoint = true;
    } else {
      this.#minimum = {
        xMm: Math.min(this.#minimum.xMm, minimum.xMm),
        yMm: Math.min(this.#minimum.yMm, minimum.yMm),
        zMm: Math.min(this.#minimum.zMm, minimum.zMm),
      };
      this.#maximum = {
        xMm: Math.max(this.#maximum.xMm, maximum.xMm),
        yMm: Math.max(this.#maximum.yMm, maximum.yMm),
        zMm: Math.max(this.#maximum.zMm, maximum.zMm),
      };
    }
    for (const coordinate of [...Object.values(this.#minimum), ...Object.values(this.#maximum)]) {
      if (!Number.isInteger(coordinate) || coordinate < -10_000_000 || coordinate > 10_000_000) {
        throw new SceneCompileError(
          "RESOURCE_LIMIT_EXCEEDED",
          "Generated scene bounds exceed the frozen integer-millimetre range.",
        );
      }
    }
  }

  finish(): {
    readonly maximum: { readonly xMm: number; readonly yMm: number; readonly zMm: number };
    readonly minimum: { readonly xMm: number; readonly yMm: number; readonly zMm: number };
  } {
    return { maximum: this.#maximum, minimum: this.#minimum };
  }
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedById<TElement extends { readonly id: string }>(
  elements: readonly TElement[],
): readonly TElement[] {
  return [...elements].sort((left, right) => compareStrings(left.id, right.id));
}

function allElements(elements: Elements): readonly ModelElement[] {
  return Object.values(elements)
    .flat()
    .sort((left, right) => compareStrings(left.id, right.id));
}

function preflightRawElementCount(snapshot: unknown): void {
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) return;
  const elements = (snapshot as Record<string, unknown>).elements;
  if (elements === null || typeof elements !== "object" || Array.isArray(elements)) return;
  let count = 0;
  for (const collection of Object.values(elements)) {
    if (!Array.isArray(collection)) continue;
    count += collection.length;
    if (!Number.isSafeInteger(count) || count > c10ScenePolicy.maximumElementMappings) {
      throw new SceneCompileError(
        "RESOURCE_LIMIT_EXCEEDED",
        "Canonical element mappings exceed the frozen publication limit.",
      );
    }
  }
}

function addCounts(counts: Counts, delta: Partial<Counts>): void {
  for (const key of Object.keys(delta) as (keyof Counts)[]) {
    const next = counts[key] + (delta[key] ?? 0);
    if (!Number.isSafeInteger(next)) {
      throw new SceneCompileError("RESOURCE_LIMIT_EXCEEDED", "Scene count arithmetic overflowed.");
    }
    counts[key] = next;
  }
  if (
    counts.materials > c10ScenePolicy.maximumMaterials ||
    counts.meshes > c10ScenePolicy.maximumNodes ||
    counts.nodes > c10ScenePolicy.maximumNodes ||
    counts.triangles > c10ScenePolicy.maximumTriangles ||
    counts.vertices > c10ScenePolicy.maximumVertices
  ) {
    throw new SceneCompileError(
      "RESOURCE_LIMIT_EXCEEDED",
      "Scene geometry or object counts exceed the frozen publication limits.",
    );
  }
}

function gltfPosition(point: Point3Mm): readonly [number, number, number] {
  return [
    Math.fround(point.xMm / 1_000),
    Math.fround(point.zMm / 1_000),
    Math.fround(-point.yMm / 1_000),
  ];
}

function levelElevation(
  levelsById: ReadonlyMap<string, Level>,
  levelId: string,
): number | undefined {
  const level = levelsById.get(levelId);
  return level === undefined ? undefined : knownValue(level.elevationMm);
}

function openingIsComplete(opening: Opening): boolean {
  return (
    knownValue(opening.heightMm) !== undefined &&
    knownValue(opening.offsetAlongHostMm) !== undefined &&
    knownValue(opening.sillHeightMm) !== undefined &&
    knownValue(opening.widthMm) !== undefined
  );
}

function planElements(snapshot: CanonicalHomeSnapshot): readonly PlannedElement[] {
  const levelsById = new Map(
    sortedById(snapshot.elements.levels).map((level) => [level.id, level]),
  );
  const openingsByHost = new Map<string, Opening[]>();
  for (const opening of sortedById(snapshot.elements.openings)) {
    const hosted = openingsByHost.get(opening.hostWallId) ?? [];
    hosted.push(opening);
    openingsByHost.set(opening.hostWallId, hosted);
  }
  const preliminary = new Map<string, PlannedElement>();
  for (const element of allElements(snapshot.elements)) {
    let mapped = false;
    let omissionCode = "ELEMENT_GEOMETRY_OMITTED";
    let omissionDetail = `The ${element.elementType} has unknown or unavailable geometry and was omitted without a proxy.`;
    switch (element.elementType) {
      case "level":
        mapped = knownValue(element.elevationMm) !== undefined;
        break;
      case "space":
        mapped =
          knownValue(element.boundary) !== undefined &&
          levelElevation(levelsById, element.levelId) !== undefined;
        break;
      case "surface":
        mapped = knownValue(element.boundary) !== undefined;
        break;
      case "wall":
        if ((openingsByHost.get(element.id) ?? []).some((opening) => !openingIsComplete(opening))) {
          omissionCode = "WALL_OMITTED_UNKNOWN_OPENING";
          omissionDetail =
            "The wall hosts an opening with unknown dimensions; the wall was omitted instead of filling that uncertainty.";
        }
        mapped =
          knownValue(element.baseOffsetMm) !== undefined &&
          knownValue(element.heightMm) !== undefined &&
          knownValue(element.path) !== undefined &&
          knownValue(element.thicknessMm) !== undefined &&
          levelElevation(levelsById, element.levelId) !== undefined &&
          (openingsByHost.get(element.id) ?? []).every(openingIsComplete);
        break;
      case "opening":
        mapped = openingIsComplete(element);
        break;
      case "stair":
        mapped =
          knownValue(element.path) !== undefined &&
          knownValue(element.riseMm) !== undefined &&
          knownValue(element.runMm) !== undefined &&
          knownValue(element.stepCount) !== undefined &&
          knownValue(element.widthMm) !== undefined &&
          levelElevation(levelsById, element.fromLevelId) !== undefined &&
          levelElevation(levelsById, element.toLevelId) !== undefined;
        break;
      case "fixed-object":
      case "furnishing":
        mapped =
          knownValue(element.dimensions) !== undefined &&
          knownValue(element.placement.position) !== undefined &&
          knownValue(element.placement.rotationMilliDegrees) !== undefined;
        break;
      case "finish":
        mapped = knownValue(element.material) !== undefined;
        break;
      case "light":
        mapped = knownValue(element.position) !== undefined;
        break;
      case "camera":
        mapped =
          knownValue(element.position) !== undefined &&
          knownValue(element.target) !== undefined &&
          knownValue(element.verticalFovMilliDegrees) !== undefined;
        break;
    }
    preliminary.set(element.id, {
      element,
      ...(mapped
        ? {}
        : {
            omissionCode,
            omissionDetail,
          }),
      status: mapped ? "mapped" : "omitted",
    });
  }

  // An opening is meaningful only when its exact host wall was compiled. This
  // also propagates the safe omission of a wall with any unknown opening.
  for (const opening of snapshot.elements.openings) {
    const plan = preliminary.get(opening.id);
    const host = preliminary.get(opening.hostWallId);
    if (
      plan?.status === "mapped" &&
      (host?.status !== "mapped" || host.element.elementType !== "wall")
    ) {
      preliminary.set(opening.id, {
        element: opening,
        omissionCode: "OPENING_HOST_OMITTED",
        omissionDetail: "The opening host wall was omitted, so no opening location was invented.",
        status: "omitted",
      });
    }
  }
  return [...preliminary.values()].sort((left, right) =>
    compareStrings(left.element.id, right.element.id),
  );
}

function baseColour(elementType: ModelElement["elementType"], state: string): readonly number[] {
  const palettes: Record<ModelElement["elementType"], readonly [number, number, number]> = {
    camera: [0.28, 0.38, 0.48],
    finish: [0.52, 0.5, 0.46],
    "fixed-object": [0.5, 0.46, 0.4],
    furnishing: [0.46, 0.5, 0.54],
    level: [0.62, 0.62, 0.62],
    light: [0.8, 0.72, 0.45],
    opening: [0.38, 0.52, 0.62],
    space: [0.56, 0.62, 0.64],
    stair: [0.54, 0.48, 0.42],
    surface: [0.6, 0.58, 0.54],
    wall: [0.68, 0.66, 0.62],
  };
  const base = palettes[elementType];
  const confidenceScale =
    state === "observed" || state === "user-asserted" ? 1 : state === "inferred" ? 0.78 : 0.9;
  return [base[0] * confidenceScale, base[1] * confidenceScale, base[2] * confidenceScale, 1];
}

function finishColour(materialSha256: string): readonly number[] {
  const channels = [0, 2, 4].map((offset) =>
    Number.parseInt(materialSha256.slice(offset, offset + 2), 16),
  );
  return channels.map((channel) => 0.35 + (channel / 255) * 0.4).concat(1);
}

function createMaterials(
  plans: readonly PlannedElement[],
  meshElementIds: ReadonlySet<string>,
): readonly MaterialDefinition[] {
  const selectedFinishIds = new Set(
    [...finishByTarget(plans).values()]
      .filter((finish) => meshElementIds.has(finish.targetElementId))
      .map(({ id }) => id),
  );
  const finishes = plans
    .filter(
      (plan): plan is PlannedElement & { readonly element: Finish } =>
        plan.status === "mapped" &&
        plan.element.elementType === "finish" &&
        selectedFinishIds.has(plan.element.id),
    )
    .map((plan) => {
      const material = knownValue(plan.element.material);
      if (material === undefined) {
        throw new SceneCompileError(
          "GEOMETRY_INVALID",
          "A planned finish is missing material metadata.",
        );
      }
      const materialSha256 = sha256Hex(material);
      return {
        finishId: plan.element.id,
        json: {
          doubleSided: true,
          extras: {
            authority: "derived-visualisation-only",
            canonicalElementId: plan.element.id,
            canonicalElementType: "finish",
            face: plan.element.face,
            materialSha256,
          },
          name: `finish:${plan.element.id}`,
          pbrMetallicRoughness: {
            baseColorFactor: finishColour(materialSha256),
            metallicFactor: 0,
            roughnessFactor: 0.8,
          },
        },
        key: `finish:${plan.element.id}`,
      } satisfies MaterialDefinition;
    });
  const finishTargets = new Set(
    plans
      .filter((plan) => plan.status === "mapped" && plan.element.elementType === "finish")
      .map((plan) => (plan.element as Finish).targetElementId),
  );
  const base = new Map<string, MaterialDefinition>();
  for (const plan of plans) {
    if (
      plan.status !== "mapped" ||
      !meshElementIds.has(plan.element.id) ||
      finishTargets.has(plan.element.id)
    ) {
      continue;
    }
    const key = `base:${plan.element.elementType}:${plan.element.origin.state}`;
    if (!base.has(key)) {
      base.set(key, {
        json: {
          doubleSided: true,
          extras: {
            authority: "derived-visualisation-only",
            canonicalElementType: plan.element.elementType,
            provenanceState: plan.element.origin.state,
          },
          name: key,
          pbrMetallicRoughness: {
            baseColorFactor: baseColour(plan.element.elementType, plan.element.origin.state),
            metallicFactor: 0,
            roughnessFactor: 0.82,
          },
        },
        key,
      });
    }
  }
  return [...base.values(), ...finishes].sort((left, right) => compareStrings(left.key, right.key));
}

function finishByTarget(plans: readonly PlannedElement[]): ReadonlyMap<string, Finish> {
  const result = new Map<string, Finish>();
  for (const plan of plans) {
    if (plan.status !== "mapped" || plan.element.elementType !== "finish") continue;
    const existing = result.get(plan.element.targetElementId);
    if (existing === undefined || compareStrings(plan.element.id, existing.id) < 0) {
      result.set(plan.element.targetElementId, plan.element);
    }
  }
  return result;
}

function materialKeyForElement(
  element: ModelElement,
  finishesByTarget: ReadonlyMap<string, Finish>,
): string {
  const finish = finishesByTarget.get(element.id);
  return finish === undefined
    ? `base:${element.elementType}:${element.origin.state}`
    : `finish:${finish.id}`;
}

function boxCorners(input: {
  readonly bottomMm: number;
  readonly end: Point2Mm;
  readonly lateralMaximumMm: number;
  readonly lateralMinimumMm: number;
  readonly start: Point2Mm;
  readonly topMm: number;
}): readonly FloatPoint3Mm[] {
  const deltaX = input.end.xMm - input.start.xMm;
  const deltaY = input.end.yMm - input.start.yMm;
  const length = Math.hypot(deltaX, deltaY);
  if (length <= 0)
    throw new SceneCompileError("GEOMETRY_INVALID", "A generated box has zero length.");
  const normalX = -deltaY / length;
  const normalY = deltaX / length;
  const at = (point: Point2Mm, lateral: number, zMm: number): FloatPoint3Mm => ({
    xMm: point.xMm + normalX * lateral,
    yMm: point.yMm + normalY * lateral,
    zMm,
  });
  return [
    at(input.start, input.lateralMinimumMm, input.bottomMm),
    at(input.end, input.lateralMinimumMm, input.bottomMm),
    at(input.end, input.lateralMaximumMm, input.bottomMm),
    at(input.start, input.lateralMaximumMm, input.bottomMm),
    at(input.start, input.lateralMinimumMm, input.topMm),
    at(input.end, input.lateralMinimumMm, input.topMm),
    at(input.end, input.lateralMaximumMm, input.topMm),
    at(input.start, input.lateralMaximumMm, input.topMm),
  ];
}

function placedBoxCorners(input: {
  readonly depthMm: number;
  readonly heightMm: number;
  readonly position: Point3Mm;
  readonly rotationMilliDegrees: number;
  readonly widthMm: number;
}): readonly FloatPoint3Mm[] {
  const radians = (input.rotationMilliDegrees * Math.PI) / 180_000;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const transform = (xMm: number, yMm: number, zMm: number): FloatPoint3Mm => ({
    xMm: input.position.xMm + xMm * cosine - yMm * sine,
    yMm: input.position.yMm + xMm * sine + yMm * cosine,
    zMm: input.position.zMm + zMm,
  });
  const halfWidth = input.widthMm / 2;
  const halfDepth = input.depthMm / 2;
  return [
    transform(-halfWidth, -halfDepth, 0),
    transform(halfWidth, -halfDepth, 0),
    transform(halfWidth, halfDepth, 0),
    transform(-halfWidth, halfDepth, 0),
    transform(-halfWidth, -halfDepth, input.heightMm),
    transform(halfWidth, -halfDepth, input.heightMm),
    transform(halfWidth, halfDepth, input.heightMm),
    transform(-halfWidth, halfDepth, input.heightMm),
  ];
}

function addBoxMetrics(
  counts: Counts,
  bounds: BoundsTracker,
  corners: readonly FloatPoint3Mm[],
): void {
  addCounts(counts, { triangles: 12, vertices: 24 });
  corners.forEach((point) => {
    bounds.add(point);
  });
}

function createMeshPlan(input: {
  readonly bounds: BoundsTracker;
  readonly counts: Counts;
  readonly levelsById: ReadonlyMap<string, Level>;
  readonly openingsByHost: ReadonlyMap<string, readonly Opening[]>;
  readonly plan: PlannedElement;
  readonly signal: AbortSignal | undefined;
}): PlannedMesh | undefined {
  const { element } = input.plan;
  if (input.plan.status !== "mapped") return undefined;
  const finishMap = new Map<string, Finish>();
  // Material key is replaced by the caller after all finish targets are known.
  const materialKey = materialKeyForElement(element, finishMap);
  switch (element.elementType) {
    case "space": {
      const boundary = knownValue(element.boundary);
      const elevation = levelElevation(input.levelsById, element.levelId);
      if (boundary === undefined || elevation === undefined) return undefined;
      const points = boundary.map((point) => ({ ...point, zMm: elevation }));
      const indices = triangulatePolygon(points);
      addCounts(input.counts, {
        meshes: 1,
        triangles: indices.length / 3,
        vertices: points.length,
      });
      points.forEach((point) => {
        input.bounds.add(point);
      });
      return { build: () => polygonMesh(points), elementId: element.id, materialKey };
    }
    case "surface": {
      const points = knownValue(element.boundary);
      if (points === undefined) return undefined;
      const indices = triangulatePolygon(points);
      addCounts(input.counts, {
        meshes: 1,
        triangles: indices.length / 3,
        vertices: points.length,
      });
      points.forEach((point) => {
        input.bounds.add(point);
      });
      return { build: () => polygonMesh(points), elementId: element.id, materialKey };
    }
    case "wall": {
      const path = knownValue(element.path);
      const height = knownValue(element.heightMm);
      const thickness = knownValue(element.thicknessMm);
      const offset = knownValue(element.baseOffsetMm);
      const elevation = levelElevation(input.levelsById, element.levelId);
      if (
        path === undefined ||
        height === undefined ||
        thickness === undefined ||
        offset === undefined ||
        elevation === undefined
      ) {
        return undefined;
      }
      const openings = input.openingsByHost.get(element.id) ?? [];
      const lateral = wallLateralExtents(element, thickness);
      let pieceCount = 0;
      for (const piece of wallPieces({
        baseMm: elevation + offset,
        heightMm: height,
        openings,
        path,
      })) {
        throwIfCancelled(input.signal);
        pieceCount += 1;
        addBoxMetrics(
          input.counts,
          input.bounds,
          boxCorners({
            ...piece,
            lateralMaximumMm: lateral[1],
            lateralMinimumMm: lateral[0],
          }),
        );
      }
      if (pieceCount === 0) return undefined;
      addCounts(input.counts, { meshes: 1 });
      return {
        build: () => wallMesh(element, path, elevation + offset, height, openings),
        elementId: element.id,
        materialKey,
      };
    }
    case "stair": {
      const path = knownValue(element.path);
      const rise = knownValue(element.riseMm);
      const run = knownValue(element.runMm);
      const stepCount = knownValue(element.stepCount);
      const width = knownValue(element.widthMm);
      const elevation = levelElevation(input.levelsById, element.fromLevelId);
      if (
        path === undefined ||
        rise === undefined ||
        run === undefined ||
        stepCount === undefined ||
        width === undefined ||
        elevation === undefined
      ) {
        return undefined;
      }
      const totalLength = pathLength(path);
      for (let step = 0; step < stepCount - 1; step += 1) {
        throwIfCancelled(input.signal);
        const start = samplePath(path, Math.min(totalLength, step * run)).point;
        const end = samplePath(path, Math.min(totalLength, (step + 1) * run)).point;
        addBoxMetrics(
          input.counts,
          input.bounds,
          boxCorners({
            bottomMm: elevation,
            end,
            lateralMaximumMm: width / 2,
            lateralMinimumMm: -width / 2,
            start,
            topMm: elevation + rise * (step + 1),
          }),
        );
      }
      addCounts(input.counts, { meshes: 1 });
      return {
        build: () => stairMesh(path, elevation, rise, run, stepCount, width),
        elementId: element.id,
        materialKey,
      };
    }
    case "fixed-object":
    case "furnishing": {
      const dimensions = knownValue(element.dimensions);
      const position = knownValue(element.placement.position);
      const rotation = knownValue(element.placement.rotationMilliDegrees);
      if (dimensions === undefined || position === undefined || rotation === undefined)
        return undefined;
      addBoxMetrics(
        input.counts,
        input.bounds,
        placedBoxCorners({ ...dimensions, position, rotationMilliDegrees: rotation }),
      );
      addCounts(input.counts, { meshes: 1 });
      return {
        build: () => placedObjectMesh(dimensions, position, rotation),
        elementId: element.id,
        materialKey,
      };
    }
    case "camera":
    case "finish":
    case "level":
    case "light":
    case "opening":
      return undefined;
  }
}

function wallMesh(
  wall: Wall,
  path: readonly Point2Mm[],
  baseMm: number,
  heightMm: number,
  openings: readonly Opening[],
): MeshData {
  const thickness = knownValue(wall.thicknessMm);
  if (thickness === undefined)
    throw new SceneCompileError("GEOMETRY_INVALID", "Wall thickness is unavailable.");
  const lateral = wallLateralExtents(wall, thickness);
  const accumulator = new MeshAccumulator();
  for (const piece of wallPieces({ baseMm, heightMm, openings, path })) {
    accumulator.addOrientedBox({
      ...piece,
      lateralMaximumMm: lateral[1],
      lateralMinimumMm: lateral[0],
    });
  }
  return accumulator.finish();
}

function stairMesh(
  path: readonly Point2Mm[],
  elevationMm: number,
  riseMm: number,
  runMm: number,
  stepCount: number,
  widthMm: number,
): MeshData {
  const accumulator = new MeshAccumulator();
  const totalLength = pathLength(path);
  for (let step = 0; step < stepCount - 1; step += 1) {
    accumulator.addOrientedBox({
      bottomMm: elevationMm,
      end: samplePath(path, Math.min(totalLength, (step + 1) * runMm)).point,
      lateralMaximumMm: widthMm / 2,
      lateralMinimumMm: -widthMm / 2,
      start: samplePath(path, Math.min(totalLength, step * runMm)).point,
      topMm: elevationMm + riseMm * (step + 1),
    });
  }
  return accumulator.finish();
}

function placedObjectMesh(
  dimensions: { readonly depthMm: number; readonly heightMm: number; readonly widthMm: number },
  position: Point3Mm,
  rotationMilliDegrees: number,
): MeshData {
  const accumulator = new MeshAccumulator();
  accumulator.addPlacedBox({ ...dimensions, position, rotationMilliDegrees });
  return accumulator.finish();
}

function quaternionFromBasis(
  x: readonly [number, number, number],
  y: readonly [number, number, number],
  z: readonly [number, number, number],
): readonly [number, number, number, number] {
  const m00 = x[0];
  const m01 = y[0];
  const m02 = z[0];
  const m10 = x[1];
  const m11 = y[1];
  const m12 = z[1];
  const m20 = x[2];
  const m21 = y[2];
  const m22 = z[2];
  const trace = m00 + m11 + m22;
  let qx: number;
  let qy: number;
  let qz: number;
  let qw: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    qw = 0.25 * s;
    qx = (m21 - m12) / s;
    qy = (m02 - m20) / s;
    qz = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    qw = (m21 - m12) / s;
    qx = 0.25 * s;
    qy = (m01 + m10) / s;
    qz = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    qw = (m02 - m20) / s;
    qx = (m01 + m10) / s;
    qy = 0.25 * s;
    qz = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    qw = (m10 - m01) / s;
    qx = (m02 + m20) / s;
    qy = (m12 + m21) / s;
    qz = 0.25 * s;
  }
  return [qx, qy, qz, qw].map(Math.fround) as unknown as readonly [number, number, number, number];
}

function cameraRotation(
  position: Point3Mm,
  target: Point3Mm,
): readonly [number, number, number, number] {
  const from = gltfPosition(position);
  const to = gltfPosition(target);
  const forwardRaw = [to[0] - from[0], to[1] - from[1], to[2] - from[2]] as const;
  const length = Math.hypot(...forwardRaw);
  const forward = forwardRaw.map((value) => value / length) as unknown as readonly [
    number,
    number,
    number,
  ];
  const z = forward.map((value) => -value) as unknown as readonly [number, number, number];
  let up: readonly [number, number, number] = [0, 1, 0];
  if (Math.abs(z[1]) > 0.999) up = [0, 0, 1];
  const xRaw = [
    up[1] * z[2] - up[2] * z[1],
    up[2] * z[0] - up[0] * z[2],
    up[0] * z[1] - up[1] * z[0],
  ] as const;
  const xLength = Math.hypot(...xRaw);
  const x = xRaw.map((value) => value / xLength) as unknown as readonly [number, number, number];
  const y = [
    z[1] * x[2] - z[2] * x[1],
    z[2] * x[0] - z[0] * x[2],
    z[0] * x[1] - z[1] * x[0],
  ] as const;
  return quaternionFromBasis(x, y, z);
}

function colourTemperature(kelvin: number): readonly [number, number, number] {
  const temperature = kelvin / 100;
  const red = temperature <= 66 ? 255 : 329.698727446 * (temperature - 60) ** -0.1332047592;
  const green =
    temperature <= 66
      ? 99.4708025861 * Math.log(temperature) - 161.1195681661
      : 288.1221695283 * (temperature - 60) ** -0.0755148492;
  const blue =
    temperature >= 66
      ? 255
      : temperature <= 19
        ? 0
        : 138.5177312231 * Math.log(temperature - 10) - 305.0447927307;
  return [red, green, blue].map((channel) =>
    Math.fround(Math.min(255, Math.max(0, channel)) / 255),
  ) as unknown as readonly [number, number, number];
}

function artifactUuid(hash: string): string {
  const bytes = hash.slice(0, 32).split("");
  bytes[12] = "5";
  bytes[16] = "8";
  const value = bytes.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

export async function compileCanonicalScene(input: SceneCompileInput): Promise<CompiledScene> {
  throwIfCancelled(input.signal);
  assertPlainIJson(input.sourceSnapshot);
  assertPlainIJson(input.configuration);
  assertPlainIJson(input.snapshot);
  preflightRawElementCount(input.snapshot);
  const sourceResult = sceneSnapshotReferenceSchema.safeParse(input.sourceSnapshot);
  const configurationResult = sceneCompileConfigurationSchema.safeParse(input.configuration);
  const snapshotResult = canonicalHomeSnapshotSchema.safeParse(input.snapshot);
  if (!sourceResult.success || !configurationResult.success || !snapshotResult.success) {
    throw new SceneCompileError(
      "INPUT_INVALID",
      "Scene compilation input violates a frozen schema.",
    );
  }
  const sourceSnapshot = sourceResult.data;
  const configuration = configurationResult.data;
  const snapshot = snapshotResult.data;
  throwIfCancelled(input.signal);

  if (
    snapshot.modelId !== sourceSnapshot.modelId ||
    snapshot.profile !== sourceSnapshot.profile ||
    snapshot.projectId !== sourceSnapshot.projectId ||
    canonicalSnapshotSha256(snapshot) !== sourceSnapshot.snapshotSha256
  ) {
    throw new SceneCompileError(
      "SOURCE_SNAPSHOT_MISMATCH",
      "The exact canonical snapshot does not match its immutable source reference.",
    );
  }

  const elements = allElements(snapshot.elements);
  if (elements.length > c10ScenePolicy.maximumElementMappings) {
    throw new SceneCompileError(
      "RESOURCE_LIMIT_EXCEEDED",
      "Canonical element mappings exceed the frozen publication limit.",
    );
  }
  const geometryFindings = validateCanonicalGeometry(snapshot);
  if (geometryFindings.some((finding) => finding.severity === "error")) {
    throw new SceneCompileError(
      "GEOMETRY_INVALID",
      "Canonical geometry validation reported a publication-blocking error.",
    );
  }
  const findings = new FindingCollector();
  for (const finding of geometryFindings) {
    findings.add({
      affectedElementIds: [...finding.affectedElementIds],
      code: finding.code,
      detail:
        finding.location === undefined
          ? finding.message
          : `${finding.message} Located on level ${finding.location.levelId} at (${String(finding.location.xMm)}, ${String(finding.location.yMm)}) mm.`,
      severity: finding.severity,
    });
  }

  const plans = planElements(snapshot);
  for (const plan of plans) {
    if (plan.status === "omitted") {
      findings.add({
        affectedElementIds: [plan.element.id],
        code: plan.omissionCode ?? "ELEMENT_GEOMETRY_OMITTED",
        detail: plan.omissionDetail ?? "Unknown geometry was omitted without a proxy.",
        severity: "warning",
      });
    }
  }
  const levelsById = new Map(
    sortedById(snapshot.elements.levels).map((level) => [level.id, level]),
  );
  const openingsByHost = new Map<string, Opening[]>();
  for (const opening of sortedById(snapshot.elements.openings)) {
    const hosted = openingsByHost.get(opening.hostWallId) ?? [];
    hosted.push(opening);
    openingsByHost.set(opening.hostWallId, hosted);
  }
  const counts: Counts = { materials: 0, meshes: 0, nodes: 0, triangles: 0, vertices: 0 };
  const bounds = new BoundsTracker();
  const rawMeshes: PlannedMesh[] = [];
  for (const plan of plans) {
    throwIfCancelled(input.signal);
    if (plan.status === "mapped" && plan.element.elementType !== "finish")
      addCounts(counts, { nodes: 1 });
    const mesh = createMeshPlan({
      bounds,
      counts,
      levelsById,
      openingsByHost,
      plan,
      signal: input.signal,
    });
    if (mesh !== undefined) rawMeshes.push(mesh);
  }
  const finishesByTarget = finishByTarget(plans);
  const plannedMeshes = rawMeshes.map((mesh) => {
    const plan = plans.find((candidate) => candidate.element.id === mesh.elementId);
    if (plan === undefined)
      throw new SceneCompileError("GEOMETRY_INVALID", "Mesh plan lost its canonical owner.");
    return {
      ...mesh,
      materialKey: materialKeyForElement(plan.element, finishesByTarget),
    };
  });
  const meshIds = new Set(plannedMeshes.map(({ elementId }) => elementId));
  const materials = createMaterials(plans, meshIds);
  addCounts(counts, { materials: materials.length });
  const materialFinishIds = new Set(
    materials.flatMap(({ finishId }) => (finishId === undefined ? [] : [finishId])),
  );
  for (const plan of plans) {
    if (
      plan.status === "mapped" &&
      plan.element.elementType === "finish" &&
      !materialFinishIds.has(plan.element.id)
    ) {
      addCounts(counts, { nodes: 1 });
    }
  }
  const estimatedBinaryBytes = counts.vertices * 24 + counts.triangles * 12;
  const estimatedContainerBytes =
    estimatedBinaryBytes +
    counts.nodes * 256 +
    counts.meshes * 192 +
    counts.materials * 512 +
    8_192;
  if (estimatedContainerBytes > c10ScenePolicy.maximumArtifactBytes) {
    throw new SceneCompileError(
      "RESOURCE_LIMIT_EXCEEDED",
      "Estimated GLB bytes exceed the frozen publication limit before mesh allocation.",
    );
  }

  const materialIndexByKey = new Map(materials.map((material, index) => [material.key, index]));
  const meshIndexByElement = new Map(plannedMeshes.map((mesh, index) => [mesh.elementId, index]));
  const materialIndicesByElement = new Map<string, number[]>();
  for (const mesh of plannedMeshes) {
    const materialIndex = materialIndexByKey.get(mesh.materialKey);
    if (materialIndex === undefined)
      throw new SceneCompileError("GEOMETRY_INVALID", "Mesh material is missing.");
    materialIndicesByElement.set(mesh.elementId, [materialIndex]);
  }
  for (const material of materials) {
    if (material.finishId === undefined) continue;
    const materialIndex = materialIndexByKey.get(material.key);
    if (materialIndex !== undefined)
      materialIndicesByElement.set(material.finishId, [materialIndex]);
  }

  const cameras: Record<string, unknown>[] = [];
  const lights: Record<string, unknown>[] = [];
  const nodeIndexByElement = new Map<string, number>();
  const nodes: Record<string, unknown>[] = [];
  for (const plan of plans) {
    if (
      plan.status !== "mapped" ||
      (plan.element.elementType === "finish" && materialIndicesByElement.has(plan.element.id))
    ) {
      continue;
    }
    const element = plan.element;
    const node: Record<string, unknown> = {
      extras: {
        authority: "derived-visualisation-only",
        canonicalElementId: element.id,
        canonicalElementType: element.elementType,
        provenanceState: element.origin.state,
      },
      name: `${element.elementType}:${element.id}`,
    };
    const meshIndex = meshIndexByElement.get(element.id);
    if (meshIndex !== undefined) node.mesh = meshIndex;
    switch (element.elementType) {
      case "level": {
        const elevation = knownValue(element.elevationMm);
        if (elevation !== undefined) node.translation = [0, Math.fround(elevation / 1_000), 0];
        break;
      }
      case "opening": {
        const host = snapshot.elements.walls.find((wall) => wall.id === element.hostWallId);
        const path = host === undefined ? undefined : knownValue(host.path);
        const offset = knownValue(element.offsetAlongHostMm);
        const width = knownValue(element.widthMm);
        const sill = knownValue(element.sillHeightMm);
        const height = knownValue(element.heightMm);
        const base = host === undefined ? undefined : knownValue(host.baseOffsetMm);
        const elevation = host === undefined ? undefined : levelElevation(levelsById, host.levelId);
        if (
          path !== undefined &&
          offset !== undefined &&
          width !== undefined &&
          sill !== undefined &&
          height !== undefined &&
          base !== undefined &&
          elevation !== undefined
        ) {
          const point = samplePath(path, offset + width / 2).point;
          node.translation = gltfPosition({
            xMm: point.xMm,
            yMm: point.yMm,
            zMm: elevation + base + sill + height / 2,
          });
          node.extras = {
            ...(node.extras as Record<string, unknown>),
            heightMm: height,
            hostWallId: element.hostWallId,
            kind: element.kind,
            offsetAlongHostMm: offset,
            sillHeightMm: sill,
            widthMm: width,
          };
          bounds.add({ xMm: point.xMm, yMm: point.yMm, zMm: elevation + base + sill + height / 2 });
        }
        break;
      }
      case "light": {
        const position = knownValue(element.position);
        if (position !== undefined) {
          node.translation = gltfPosition(position);
          bounds.add(position);
        }
        const flux = knownValue(element.luminousFluxLumens);
        const temperature = knownValue(element.colourTemperatureKelvin);
        if (element.kind === "point" && flux !== undefined && temperature !== undefined) {
          const lightIndex = lights.length;
          lights.push({
            color: colourTemperature(temperature),
            extras: {
              canonicalElementId: element.id,
              colourTemperatureKelvin: temperature,
              luminousFluxLumens: flux,
            },
            intensity: Math.fround(flux / (4 * Math.PI)),
            name: `light:${element.id}`,
            type: "point",
          });
          node.extensions = { KHR_lights_punctual: { light: lightIndex } };
        } else {
          findings.add({
            affectedElementIds: [element.id],
            code: "LIGHT_KIND_METADATA_ONLY",
            detail:
              "The light lacks a non-invented glTF punctual representation and remains mapped as metadata.",
            severity: "information",
          });
        }
        break;
      }
      case "camera": {
        const position = knownValue(element.position);
        const target = knownValue(element.target);
        const fov = knownValue(element.verticalFovMilliDegrees);
        if (position !== undefined && target !== undefined && fov !== undefined) {
          const cameraIndex = cameras.length;
          cameras.push({
            extras: { canonicalElementId: element.id, targetMm: target },
            name: `camera:${element.id}`,
            perspective: { yfov: Math.fround((fov * Math.PI) / 180_000), znear: 0.01 },
            type: "perspective",
          });
          node.camera = cameraIndex;
          node.rotation = cameraRotation(position, target);
          node.translation = gltfPosition(position);
          bounds.add(position);
          bounds.add(target);
        }
        break;
      }
      case "finish": {
        const material = knownValue(element.material);
        if (material !== undefined) {
          node.extras = {
            ...(node.extras as Record<string, unknown>),
            face: element.face,
            materialSha256: sha256Hex(material),
            targetElementId: element.targetElementId,
          };
        }
        break;
      }
      case "fixed-object":
      case "furnishing":
        node.extras = {
          ...(node.extras as Record<string, unknown>),
          geometryRole: "bounded-proxy",
        };
        findings.add({
          affectedElementIds: [element.id],
          code: "BOUNDED_PROXY_GEOMETRY",
          detail: "The element is represented only by its known canonical bounding dimensions.",
          severity: "information",
        });
        break;
      case "space":
      case "stair":
      case "surface":
      case "wall":
        break;
    }
    nodeIndexByElement.set(element.id, nodes.length);
    nodes.push(node);
  }
  const finalFindings = findings.finish();
  const findingCodesByElement = new Map<string, Set<string>>();
  for (const finding of finalFindings) {
    for (const elementId of finding.affectedElementIds) {
      const codes = findingCodesByElement.get(elementId) ?? new Set<string>();
      codes.add(finding.code);
      findingCodesByElement.set(elementId, codes);
    }
  }
  const elementMappings: SceneElementMapping[] = plans.map((plan) => {
    const nodeIndex = nodeIndexByElement.get(plan.element.id);
    const meshIndex = meshIndexByElement.get(plan.element.id);
    const materialIndices = materialIndicesByElement.get(plan.element.id) ?? [];
    return {
      elementId: plan.element.id,
      elementType: plan.element.elementType,
      findingCodes: [...(findingCodesByElement.get(plan.element.id) ?? new Set<string>())].sort(
        compareStrings,
      ),
      materialIndices,
      meshIndices: meshIndex === undefined ? [] : [meshIndex],
      nodeIndices: nodeIndex === undefined ? [] : [nodeIndex],
      status: plan.status,
    };
  });

  throwIfCancelled(input.signal);
  const gltfMeshes: GltfMeshInput[] = plannedMeshes.map((mesh) => {
    throwIfCancelled(input.signal);
    const materialIndex = materialIndexByKey.get(mesh.materialKey);
    if (materialIndex === undefined)
      throw new SceneCompileError("GEOMETRY_INVALID", "Mesh material index is absent.");
    return {
      data: mesh.build(),
      materialIndex,
      name: `mesh:${mesh.elementId}`,
    };
  });
  throwIfCancelled(input.signal);
  const written = writeGlb({
    cameras,
    ...(lights.length === 0
      ? {}
      : {
          extensions: { KHR_lights_punctual: { lights } },
          extensionsUsed: ["KHR_lights_punctual"],
        }),
    materials: materials.map(({ json }) => json),
    meshes: gltfMeshes,
    nodes,
  });
  const parsedGlb = parseGlb(written.glb);
  if (
    parsedGlb.counts.materials !== counts.materials ||
    parsedGlb.counts.meshes !== counts.meshes ||
    parsedGlb.counts.nodes !== counts.nodes ||
    parsedGlb.counts.triangles !== counts.triangles ||
    parsedGlb.counts.vertices !== counts.vertices
  ) {
    throw new SceneCompileError(
      "GLB_INVALID",
      "Independent GLB counts differ from the compilation plan.",
    );
  }

  const configurationSha256 = sha256Hex(canonicalJsonBytes(configuration));
  const manifest = sceneManifestSchema.parse({
    authority: "derived-visualisation-only",
    boundsMm: bounds.finish(),
    compiler: {
      configuration,
      configurationSha256,
      name: "interior-design-scene-compiler",
      version: sceneCompilerVersion,
    },
    coordinateSystem: {
      canonicalAxes: "+X east, +Y north, +Z up",
      gltfAxes: "+Y up, +Z forward, right-handed",
      mapping: "[Xmm/1000, Zmm/1000, -Ymm/1000]",
      outputLengthUnit: "metre",
    },
    counts,
    determinismKeySha256: sha256Hex(
      canonicalJsonBytes({
        compilerVersion: sceneCompilerVersion,
        configurationSha256,
        sourceSnapshot,
      }),
    ),
    elementMappings,
    findings: finalFindings,
    gltf: { container: "GLB", specificationVersion: "2.0" },
    schemaVersion: "c10-scene-manifest-v1",
    sourceSnapshot,
  });
  const manifestBytes = canonicalJsonBytes(manifest);
  const glbSha256 = sha256Hex(written.glb);
  const artifact = sceneArtifactSchema.parse({
    byteSize: written.glb.byteLength,
    glbSha256,
    id: artifactUuid(glbSha256),
    manifestSha256: sha256Hex(manifestBytes),
    mimeType: "model/gltf-binary",
    schemaVersion: "c10-scene-artifact-v1",
  });

  let report;
  try {
    report = await validateBytes(written.glb, {
      format: "glb",
      maxIssues: 10_000,
      uri: `${glbSha256}.glb`,
      writeTimestamp: false,
    });
  } catch (error) {
    throw new SceneCompileError(
      "GLB_VALIDATOR_FAILED",
      "Khronos glTF Validator could not parse the GLB.",
      {
        cause: error,
      },
    );
  }
  throwIfCancelled(input.signal);
  if (report.issues.numErrors !== 0 || report.issues.numWarnings !== 0) {
    throw new SceneCompileError(
      "GLB_VALIDATOR_FAILED",
      `Khronos glTF Validator reported ${String(report.issues.numErrors)} errors and ${String(report.issues.numWarnings)} warnings.`,
    );
  }
  if (!compareCanonicalValues(manifest.compiler.configuration, configuration)) {
    throw new SceneCompileError(
      "GLB_INVALID",
      "Manifest configuration changed during compilation.",
    );
  }
  return {
    artifact,
    findings: finalFindings,
    glb: written.glb,
    manifest,
    manifestBytes,
    validation: {
      issueCodes: report.issues.messages.map(({ code }) => code).sort(compareStrings),
      numErrors: report.issues.numErrors,
      numHints: report.issues.numHints,
      numInfos: report.issues.numInfos,
      numWarnings: report.issues.numWarnings,
      validatorVersion: validatorVersion(),
    },
  };
}
