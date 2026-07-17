import earcut from "earcut";

import type { CanonicalHomeSnapshot } from "@interior-design/contracts";

import { SceneCompileError } from "./errors.js";

type Elements = CanonicalHomeSnapshot["elements"];
export type Wall = Elements["walls"][number];
export type Opening = Elements["openings"][number];
export type Point2Mm = { readonly xMm: number; readonly yMm: number };
export type Point3Mm = { readonly xMm: number; readonly yMm: number; readonly zMm: number };

export interface FloatPoint3Mm {
  readonly xMm: number;
  readonly yMm: number;
  readonly zMm: number;
}

export interface MeshData {
  readonly indices: readonly number[];
  readonly normalsGltf: readonly number[];
  readonly positionsMm: readonly number[];
  readonly triangleCount: number;
  readonly vertexCount: number;
}

export interface WallPiece {
  readonly bottomMm: number;
  readonly end: Point2Mm;
  readonly start: Point2Mm;
  readonly topMm: number;
}

export interface SampledPathPoint {
  readonly point: Point2Mm;
  readonly tangent: Point2Mm;
}

type Attributed<TValue> =
  { readonly knowledge: "known"; readonly value: TValue } | { readonly knowledge: "unknown" };

export function knownValue<TValue>(value: Attributed<TValue>): TValue | undefined {
  return value.knowledge === "known" ? value.value : undefined;
}

function gltfPoint(point: FloatPoint3Mm): readonly [number, number, number] {
  return [point.xMm / 1_000, point.zMm / 1_000, -point.yMm / 1_000];
}

function normalizedCross(
  first: FloatPoint3Mm,
  second: FloatPoint3Mm,
  third: FloatPoint3Mm,
): readonly [number, number, number] {
  const a = gltfPoint(first);
  const b = gltfPoint(second);
  const c = gltfPoint(third);
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const;
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as const;
  const cross = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ] as const;
  const length = Math.hypot(cross[0], cross[1], cross[2]);
  if (!Number.isFinite(length) || length <= Number.EPSILON) {
    throw new SceneCompileError(
      "GEOMETRY_INVALID",
      "Generated geometry contains a degenerate face.",
    );
  }
  return [cross[0] / length, cross[1] / length, cross[2] / length];
}

export class MeshAccumulator {
  readonly #indices: number[] = [];
  readonly #normalsGltf: number[] = [];
  readonly #positionsMm: number[] = [];

  addQuad(points: readonly [FloatPoint3Mm, FloatPoint3Mm, FloatPoint3Mm, FloatPoint3Mm]): void {
    const normal = normalizedCross(points[0], points[1], points[2]);
    const base = this.#positionsMm.length / 3;
    for (const point of points) {
      this.#positionsMm.push(point.xMm, point.yMm, point.zMm);
      this.#normalsGltf.push(...normal);
    }
    this.#indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  addOrientedBox(input: {
    readonly bottomMm: number;
    readonly end: Point2Mm;
    readonly lateralMaximumMm: number;
    readonly lateralMinimumMm: number;
    readonly start: Point2Mm;
    readonly topMm: number;
  }): void {
    const deltaX = input.end.xMm - input.start.xMm;
    const deltaY = input.end.yMm - input.start.yMm;
    const length = Math.hypot(deltaX, deltaY);
    if (!Number.isFinite(length) || length <= 0 || input.topMm <= input.bottomMm) {
      throw new SceneCompileError("GEOMETRY_INVALID", "Generated box dimensions are invalid.");
    }
    const normalX = -deltaY / length;
    const normalY = deltaX / length;
    const at = (point: Point2Mm, lateralMm: number, zMm: number): FloatPoint3Mm => ({
      xMm: point.xMm + normalX * lateralMm,
      yMm: point.yMm + normalY * lateralMm,
      zMm,
    });
    const corners = [
      at(input.start, input.lateralMinimumMm, input.bottomMm),
      at(input.end, input.lateralMinimumMm, input.bottomMm),
      at(input.end, input.lateralMaximumMm, input.bottomMm),
      at(input.start, input.lateralMaximumMm, input.bottomMm),
      at(input.start, input.lateralMinimumMm, input.topMm),
      at(input.end, input.lateralMinimumMm, input.topMm),
      at(input.end, input.lateralMaximumMm, input.topMm),
      at(input.start, input.lateralMaximumMm, input.topMm),
    ] as const;
    this.addQuad([corners[0], corners[3], corners[2], corners[1]]);
    this.addQuad([corners[4], corners[5], corners[6], corners[7]]);
    this.addQuad([corners[0], corners[1], corners[5], corners[4]]);
    this.addQuad([corners[1], corners[2], corners[6], corners[5]]);
    this.addQuad([corners[2], corners[3], corners[7], corners[6]]);
    this.addQuad([corners[3], corners[0], corners[4], corners[7]]);
  }

  addPlacedBox(input: {
    readonly depthMm: number;
    readonly heightMm: number;
    readonly position: Point3Mm;
    readonly rotationMilliDegrees: number;
    readonly widthMm: number;
  }): void {
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
    const corners = [
      transform(-halfWidth, -halfDepth, 0),
      transform(halfWidth, -halfDepth, 0),
      transform(halfWidth, halfDepth, 0),
      transform(-halfWidth, halfDepth, 0),
      transform(-halfWidth, -halfDepth, input.heightMm),
      transform(halfWidth, -halfDepth, input.heightMm),
      transform(halfWidth, halfDepth, input.heightMm),
      transform(-halfWidth, halfDepth, input.heightMm),
    ] as const;
    this.addQuad([corners[0], corners[3], corners[2], corners[1]]);
    this.addQuad([corners[4], corners[5], corners[6], corners[7]]);
    this.addQuad([corners[0], corners[1], corners[5], corners[4]]);
    this.addQuad([corners[1], corners[2], corners[6], corners[5]]);
    this.addQuad([corners[2], corners[3], corners[7], corners[6]]);
    this.addQuad([corners[3], corners[0], corners[4], corners[7]]);
  }

  finish(): MeshData {
    return {
      indices: this.#indices,
      normalsGltf: this.#normalsGltf,
      positionsMm: this.#positionsMm,
      triangleCount: this.#indices.length / 3,
      vertexCount: this.#positionsMm.length / 3,
    };
  }
}

function polygonNormal(points: readonly Point3Mm[]): readonly [number, number, number] {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (current === undefined || next === undefined) continue;
    x += (current.yMm - next.yMm) * (current.zMm + next.zMm);
    y += (current.zMm - next.zMm) * (current.xMm + next.xMm);
    z += (current.xMm - next.xMm) * (current.yMm + next.yMm);
  }
  const length = Math.hypot(x, y, z);
  if (!Number.isFinite(length) || length <= Number.EPSILON) {
    throw new SceneCompileError("GEOMETRY_INVALID", "A polygon has no stable plane normal.");
  }
  return [x / length, y / length, z / length];
}

export function triangulatePolygon(points: readonly Point3Mm[]): readonly number[] {
  const normal = polygonNormal(points);
  const absolute = normal.map(Math.abs);
  const droppedAxis =
    (absolute[0] ?? 0) >= (absolute[1] ?? 0) && (absolute[0] ?? 0) >= (absolute[2] ?? 0)
      ? "x"
      : (absolute[1] ?? 0) >= (absolute[2] ?? 0)
        ? "y"
        : "z";
  const coordinates = points.flatMap((point) => {
    if (droppedAxis === "x") return [point.yMm, point.zMm];
    if (droppedAxis === "y") return [point.xMm, point.zMm];
    return [point.xMm, point.yMm];
  });
  const raw = earcut(coordinates, null, 2);
  const filtered: number[] = [];
  for (let offset = 0; offset < raw.length; offset += 3) {
    const firstIndex = raw[offset];
    const secondIndex = raw[offset + 1];
    const thirdIndex = raw[offset + 2];
    if (firstIndex === undefined || secondIndex === undefined || thirdIndex === undefined) {
      throw new SceneCompileError("GEOMETRY_INVALID", "Polygon triangulation is incomplete.");
    }
    const first = points[firstIndex];
    const second = points[secondIndex];
    const third = points[thirdIndex];
    if (first === undefined || second === undefined || third === undefined) {
      throw new SceneCompileError(
        "GEOMETRY_INVALID",
        "Polygon triangulation references a missing point.",
      );
    }
    const a = gltfPoint(first);
    const b = gltfPoint(second);
    const c = gltfPoint(third);
    const areaVector = [
      (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
      (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
    ];
    if (Math.hypot(...areaVector) > Number.EPSILON)
      filtered.push(firstIndex, secondIndex, thirdIndex);
  }
  if (filtered.length === 0) {
    throw new SceneCompileError(
      "GEOMETRY_INVALID",
      "Polygon triangulation produced no finite faces.",
    );
  }
  return filtered;
}

export function polygonMesh(points: readonly Point3Mm[]): MeshData {
  const indices = triangulatePolygon(points);
  const canonicalNormal = polygonNormal(points);
  const gltfNormal = [canonicalNormal[0], canonicalNormal[2], -canonicalNormal[1]] as const;
  return {
    indices,
    normalsGltf: points.flatMap(() => gltfNormal),
    positionsMm: points.flatMap((point) => [point.xMm, point.yMm, point.zMm]),
    triangleCount: indices.length / 3,
    vertexCount: points.length,
  };
}

export function pathLength(path: readonly Point2Mm[]): number {
  let length = 0;
  for (let index = 0; index + 1 < path.length; index += 1) {
    const start = path[index];
    const end = path[index + 1];
    if (start === undefined || end === undefined) continue;
    length += Math.hypot(end.xMm - start.xMm, end.yMm - start.yMm);
  }
  return length;
}

export function samplePath(path: readonly Point2Mm[], distanceMm: number): SampledPathPoint {
  let consumed = 0;
  for (let index = 0; index + 1 < path.length; index += 1) {
    const start = path[index];
    const end = path[index + 1];
    if (start === undefined || end === undefined) continue;
    const deltaX = end.xMm - start.xMm;
    const deltaY = end.yMm - start.yMm;
    const length = Math.hypot(deltaX, deltaY);
    if (distanceMm <= consumed + length || index + 2 === path.length) {
      const local = Math.min(length, Math.max(0, distanceMm - consumed));
      const ratio = local / length;
      return {
        point: { xMm: start.xMm + deltaX * ratio, yMm: start.yMm + deltaY * ratio },
        tangent: { xMm: deltaX / length, yMm: deltaY / length },
      };
    }
    consumed += length;
  }
  throw new SceneCompileError("GEOMETRY_INVALID", "A path could not be sampled.");
}

function interpolate(start: Point2Mm, end: Point2Mm, distanceMm: number): Point2Mm {
  const deltaX = end.xMm - start.xMm;
  const deltaY = end.yMm - start.yMm;
  const length = Math.hypot(deltaX, deltaY);
  const ratio = distanceMm / length;
  return { xMm: start.xMm + deltaX * ratio, yMm: start.yMm + deltaY * ratio };
}

export function wallLateralExtents(wall: Wall, thicknessMm: number): readonly [number, number] {
  switch (wall.alignment) {
    case "centre":
      return [-thicknessMm / 2, thicknessMm / 2];
    case "left-face":
      return [-thicknessMm, 0];
    case "right-face":
      return [0, thicknessMm];
  }
}

export function* wallPieces(input: {
  readonly baseMm: number;
  readonly heightMm: number;
  readonly openings: readonly Opening[];
  readonly path: readonly Point2Mm[];
}): Generator<WallPiece> {
  const intervals = input.openings.map((opening) => {
    const startMm = knownValue(opening.offsetAlongHostMm);
    const widthMm = knownValue(opening.widthMm);
    const sillMm = knownValue(opening.sillHeightMm);
    const heightMm = knownValue(opening.heightMm);
    if (
      startMm === undefined ||
      widthMm === undefined ||
      sillMm === undefined ||
      heightMm === undefined
    ) {
      throw new SceneCompileError("GEOMETRY_INVALID", "A planned wall opening is incomplete.");
    }
    return { endMm: startMm + widthMm, heightMm, sillMm, startMm };
  });
  let consumed = 0;
  for (let index = 0; index + 1 < input.path.length; index += 1) {
    const start = input.path[index];
    const end = input.path[index + 1];
    if (start === undefined || end === undefined) continue;
    const segmentLength = Math.hypot(end.xMm - start.xMm, end.yMm - start.yMm);
    const segmentStart = consumed;
    const segmentEnd = consumed + segmentLength;
    const relevant = intervals.filter(
      (interval) => interval.startMm < segmentEnd && interval.endMm > segmentStart,
    );
    const breakpoints = [
      0,
      segmentLength,
      ...relevant.flatMap((interval) => [
        Math.max(0, interval.startMm - segmentStart),
        Math.min(segmentLength, interval.endMm - segmentStart),
      ]),
    ]
      .sort((left, right) => left - right)
      .filter(
        (value, breakpointIndex, values) =>
          breakpointIndex === 0 || value !== values[breakpointIndex - 1],
      );

    for (let breakpointIndex = 0; breakpointIndex + 1 < breakpoints.length; breakpointIndex += 1) {
      const localStart = breakpoints[breakpointIndex];
      const localEnd = breakpoints[breakpointIndex + 1];
      if (localStart === undefined || localEnd === undefined || localEnd <= localStart) continue;
      const midpoint = segmentStart + (localStart + localEnd) / 2;
      const active = relevant.find(
        (interval) => midpoint >= interval.startMm && midpoint < interval.endMm,
      );
      const pieceStart = interpolate(start, end, localStart);
      const pieceEnd = interpolate(start, end, localEnd);
      if (active === undefined) {
        yield {
          bottomMm: input.baseMm,
          end: pieceEnd,
          start: pieceStart,
          topMm: input.baseMm + input.heightMm,
        };
      } else {
        if (active.sillMm > 0) {
          yield {
            bottomMm: input.baseMm,
            end: pieceEnd,
            start: pieceStart,
            topMm: input.baseMm + active.sillMm,
          };
        }
        const openingTop = active.sillMm + active.heightMm;
        if (openingTop < input.heightMm) {
          yield {
            bottomMm: input.baseMm + openingTop,
            end: pieceEnd,
            start: pieceStart,
            topMm: input.baseMm + input.heightMm,
          };
        }
      }
    }
    consumed = segmentEnd;
  }
}
