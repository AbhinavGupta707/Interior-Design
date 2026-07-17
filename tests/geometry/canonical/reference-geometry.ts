import type { CanonicalHomeSnapshot } from "../../../packages/contracts/src/index.js";
import type { ExpectedGeometryFinding } from "../../../packages/test-fixtures/src/models/index.js";

interface Point2 {
  readonly xMm: number;
  readonly yMm: number;
}

interface Segment {
  readonly end: Point2;
  readonly start: Point2;
}

const maximumSafeInteger = BigInt(Number.MAX_SAFE_INTEGER);

function knownValue<T>(attributed: {
  readonly knowledge: string;
  readonly value?: T;
}): T | undefined {
  return attributed.knowledge === "known" ? attributed.value : undefined;
}

const pointKey = (point: Point2): string => `${String(point.xMm)},${String(point.yMm)}`;

const segmentKey = (segment: Segment): string =>
  [pointKey(segment.start), pointKey(segment.end)].sort().join("|");

const segments = (points: readonly Point2[], close: boolean): Segment[] => {
  const result: Segment[] = [];
  const count = close ? points.length : points.length - 1;
  for (let index = 0; index < count; index++) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    if (start !== undefined && end !== undefined) result.push({ end, start });
  }
  return result;
};

export function twiceSignedArea(points: readonly Point2[]): bigint {
  return segments(points, true).reduce(
    (sum, segment) =>
      sum +
      BigInt(segment.start.xMm) * BigInt(segment.end.yMm) -
      BigInt(segment.start.yMm) * BigInt(segment.end.xMm),
    0n,
  );
}

const orientation = (first: Point2, second: Point2, third: Point2): bigint =>
  BigInt(second.xMm - first.xMm) * BigInt(third.yMm - first.yMm) -
  BigInt(second.yMm - first.yMm) * BigInt(third.xMm - first.xMm);

function properIntersection(left: Segment, right: Segment): boolean {
  const first = orientation(left.start, left.end, right.start);
  const second = orientation(left.start, left.end, right.end);
  const third = orientation(right.start, right.end, left.start);
  const fourth = orientation(right.start, right.end, left.end);
  return (
    ((first > 0n && second < 0n) || (first < 0n && second > 0n)) &&
    ((third > 0n && fourth < 0n) || (third < 0n && fourth > 0n))
  );
}

function intersectionPoint(left: Segment, right: Segment): Point2 {
  const x1 = left.start.xMm;
  const y1 = left.start.yMm;
  const x2 = left.end.xMm;
  const y2 = left.end.yMm;
  const x3 = right.start.xMm;
  const y3 = right.start.yMm;
  const x4 = right.end.xMm;
  const y4 = right.end.yMm;
  const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  const leftCross = x1 * y2 - y1 * x2;
  const rightCross = x3 * y4 - y3 * x4;
  return {
    xMm: Math.round((leftCross * (x3 - x4) - (x1 - x2) * rightCross) / denominator),
    yMm: Math.round((leftCross * (y3 - y4) - (y1 - y2) * rightCross) / denominator),
  };
}

function firstSelfIntersection(points: readonly Point2[], close: boolean): Point2 | undefined {
  const pathSegments = segments(points, close);
  for (let leftIndex = 0; leftIndex < pathSegments.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < pathSegments.length; rightIndex++) {
      const adjacent =
        Math.abs(leftIndex - rightIndex) <= 1 ||
        (close && leftIndex === 0 && rightIndex === pathSegments.length - 1);
      const left = pathSegments[leftIndex];
      const right = pathSegments[rightIndex];
      if (
        !adjacent &&
        left !== undefined &&
        right !== undefined &&
        properIntersection(left, right)
      ) {
        return intersectionPoint(left, right);
      }
    }
  }
  return undefined;
}

function minimumPoint(points: readonly Point2[]): Point2 {
  return (
    [...points].sort((left, right) => left.xMm - right.xMm || left.yMm - right.yMm)[0] ?? {
      xMm: 0,
      yMm: 0,
    }
  );
}

function hasRepeatedVertex(points: readonly Point2[]): boolean {
  return new Set(points.map(pointKey)).size !== points.length;
}

function hasRepeatedSegment(points: readonly Point2[], close: boolean): boolean {
  const seen = new Set<string>();
  return segments(points, close).some((segment) => {
    const key = segmentKey(segment);
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
}

function located(levelId: string, point: Point2) {
  return { levelId, xMm: point.xMm, yMm: point.yMm };
}

function finding(
  code: string,
  severity: ExpectedGeometryFinding["severity"],
  affectedElementIds: readonly string[],
  location?: ExpectedGeometryFinding["location"],
): ExpectedGeometryFinding {
  return {
    affectedElementIds: [...affectedElementIds].sort(),
    code,
    ...(location === undefined ? {} : { location }),
    severity,
  };
}

function pathLength(points: readonly Point2[]): number {
  return segments(points, false).reduce(
    (sum, segment) =>
      sum + Math.hypot(segment.end.xMm - segment.start.xMm, segment.end.yMm - segment.start.yMm),
    0,
  );
}

function roomTopology(paths: readonly (readonly Point2[])[]): {
  readonly closed: boolean;
  readonly connected: boolean;
} {
  const adjacency = new Map<string, string[]>();
  for (const path of paths) {
    const start = path[0];
    const end = path.at(-1);
    if (start === undefined || end === undefined) return { closed: false, connected: false };
    const startKey = pointKey(start);
    const endKey = pointKey(end);
    adjacency.set(startKey, [...(adjacency.get(startKey) ?? []), endKey]);
    adjacency.set(endKey, [...(adjacency.get(endKey) ?? []), startKey]);
  }
  const closed = [...adjacency.values()].every((neighbours) => neighbours.length === 2);
  const first = adjacency.keys().next().value;
  if (first === undefined) return { closed: false, connected: false };
  const visited = new Set([first]);
  const queue = [first];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) continue;
    for (const neighbour of adjacency.get(current) ?? []) {
      if (!visited.has(neighbour)) {
        visited.add(neighbour);
        queue.push(neighbour);
      }
    }
  }
  return { closed, connected: visited.size === adjacency.size };
}

const findingKey = (value: ExpectedGeometryFinding): string =>
  `${value.code}\u0000${value.affectedElementIds.join(",")}`;

/** Independent, deliberately small oracle for the C4 evaluation fixtures, not production code. */
export function evaluateReferenceGeometry(
  snapshot: CanonicalHomeSnapshot,
): readonly ExpectedGeometryFinding[] {
  const findings: ExpectedGeometryFinding[] = [];
  const levelIds = new Set(snapshot.elements.levels.map((level) => level.id));
  const allElementIds = new Set(
    Object.values(snapshot.elements).flatMap((items) => items.map(({ id }) => id)),
  );
  const walls = new Map(snapshot.elements.walls.map((wall) => [wall.id, wall]));
  const invalidWallIds = new Set<string>();
  const invalidSpacePolygonIds = new Set<string>();

  for (const collection of [
    snapshot.elements.cameras,
    snapshot.elements.fixedObjects,
    snapshot.elements.furnishings,
    snapshot.elements.lights,
    snapshot.elements.spaces,
    snapshot.elements.surfaces,
    snapshot.elements.walls,
  ]) {
    for (const element of collection) {
      if (!levelIds.has(element.levelId)) {
        findings.push(finding("LEVEL_REFERENCE_MISSING", "error", [element.id, element.levelId]));
      }
    }
  }

  for (const finish of snapshot.elements.finishes) {
    if (!allElementIds.has(finish.targetElementId)) {
      findings.push(
        finding("TARGET_REFERENCE_MISSING", "error", [finish.id, finish.targetElementId]),
      );
    }
  }

  for (const space of snapshot.elements.spaces) {
    const boundary = knownValue<readonly Point2[]>(space.boundary);
    if (boundary === undefined) continue;
    const area = twiceSignedArea(boundary);
    const first = minimumPoint(boundary);
    if (area > maximumSafeInteger || area < -maximumSafeInteger) {
      findings.push(
        finding(
          "GEOMETRY_INTEGER_RANGE_EXCEEDED",
          "error",
          [space.id],
          located(space.levelId, first),
        ),
      );
      invalidSpacePolygonIds.add(space.id);
    }
    if (area === 0n) {
      findings.push(
        finding("SPACE_POLYGON_DEGENERATE", "error", [space.id], located(space.levelId, first)),
      );
      invalidSpacePolygonIds.add(space.id);
    }
    const intersection = firstSelfIntersection(boundary, true);
    const repeated = hasRepeatedVertex(boundary);
    if (repeated) {
      findings.push(
        finding(
          "SPACE_POLYGON_REPEATED_VERTEX",
          "error",
          [space.id],
          located(space.levelId, first),
        ),
      );
      invalidSpacePolygonIds.add(space.id);
    }
    if (intersection !== undefined || hasRepeatedSegment(boundary, true)) {
      findings.push(
        finding(
          "SPACE_POLYGON_SELF_INTERSECTION",
          "error",
          [space.id],
          located(space.levelId, first),
        ),
      );
      invalidSpacePolygonIds.add(space.id);
    }
  }

  for (const surface of snapshot.elements.surfaces) {
    const boundary = knownValue<readonly { xMm: number; yMm: number; zMm: number }[]>(
      surface.boundary,
    );
    if (boundary === undefined) continue;
    const area = twiceSignedArea(boundary);
    const first = minimumPoint(boundary);
    if (area === 0n) {
      findings.push(
        finding(
          "SURFACE_POLYGON_DEGENERATE",
          "error",
          [surface.id],
          located(surface.levelId, first),
        ),
      );
      continue;
    }
    const intersection = firstSelfIntersection(boundary, true);
    if (intersection !== undefined) {
      findings.push(
        finding(
          "SURFACE_POLYGON_SELF_INTERSECTION",
          "error",
          [surface.id],
          located(surface.levelId, first),
        ),
      );
    }
  }

  for (const wall of snapshot.elements.walls) {
    const path = knownValue<readonly Point2[]>(wall.path);
    if (path === undefined) continue;
    const wallSegments = segments(path, false);
    const zeroSegment = wallSegments.find(
      (segment) => pointKey(segment.start) === pointKey(segment.end),
    );
    const repeatedVertex = hasRepeatedVertex(path);
    if (zeroSegment !== undefined) {
      findings.push(
        finding(
          "WALL_PATH_ZERO_LENGTH_SEGMENT",
          "error",
          [wall.id],
          located(wall.levelId, zeroSegment.start),
        ),
      );
      invalidWallIds.add(wall.id);
    }
    if (repeatedVertex) {
      findings.push(
        finding(
          "WALL_PATH_REPEATED_VERTEX",
          "error",
          [wall.id],
          located(wall.levelId, minimumPoint(path)),
        ),
      );
      invalidWallIds.add(wall.id);
    }
    const intersection = firstSelfIntersection(path, false);
    if (intersection !== undefined || hasRepeatedSegment(path, false)) {
      findings.push(
        finding(
          "WALL_PATH_SELF_INTERSECTION",
          "error",
          [wall.id],
          located(wall.levelId, minimumPoint(path)),
        ),
      );
      invalidWallIds.add(wall.id);
    }
    const first = minimumPoint(path);
    if (wall.heightMm.knowledge === "unknown") {
      findings.push(
        finding("WALL_HEIGHT_UNKNOWN", "information", [wall.id], located(wall.levelId, first)),
      );
    }
    if (wall.thicknessMm.knowledge === "unknown") {
      findings.push(
        finding("WALL_THICKNESS_UNKNOWN", "information", [wall.id], located(wall.levelId, first)),
      );
    }
  }

  for (const opening of snapshot.elements.openings) {
    const host = walls.get(opening.hostWallId);
    if (host === undefined) {
      findings.push(
        finding("HOST_WALL_REFERENCE_MISSING", "error", [opening.id, opening.hostWallId]),
      );
      continue;
    }
    if (invalidWallIds.has(host.id)) continue;
    const path = knownValue<readonly Point2[]>(host.path);
    const offset = knownValue<number>(opening.offsetAlongHostMm);
    const width = knownValue<number>(opening.widthMm);
    if (path !== undefined && offset !== undefined && width !== undefined) {
      if (offset + width > pathLength(path)) {
        findings.push(
          finding(
            "OPENING_OUTSIDE_HOST_EXTENT",
            "error",
            [opening.id, host.id],
            located(host.levelId, minimumPoint(path)),
          ),
        );
      }
      const sill = knownValue<number>(opening.sillHeightMm);
      const height = knownValue<number>(opening.heightMm);
      const hostHeight = knownValue<number>(host.heightMm);
      if (
        sill !== undefined &&
        height !== undefined &&
        hostHeight !== undefined &&
        (sill < 0 || sill + height > hostHeight)
      ) {
        findings.push(
          finding(
            sill < 0 ? "OPENING_BELOW_HOST_BASE" : "OPENING_ABOVE_HOST_HEIGHT",
            "error",
            [opening.id, host.id],
            located(host.levelId, minimumPoint(path)),
          ),
        );
      }
    }
  }

  for (let leftIndex = 0; leftIndex < snapshot.elements.openings.length; leftIndex++) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < snapshot.elements.openings.length;
      rightIndex++
    ) {
      const left = snapshot.elements.openings[leftIndex];
      const right = snapshot.elements.openings[rightIndex];
      if (left === undefined || right === undefined || left.hostWallId !== right.hostWallId)
        continue;
      const host = walls.get(left.hostWallId);
      if (host === undefined || invalidWallIds.has(host.id)) continue;
      const leftOffset = knownValue<number>(left.offsetAlongHostMm);
      const leftWidth = knownValue<number>(left.widthMm);
      const rightOffset = knownValue<number>(right.offsetAlongHostMm);
      const rightWidth = knownValue<number>(right.widthMm);
      const path = knownValue<readonly Point2[]>(host.path);
      if (
        leftOffset !== undefined &&
        leftWidth !== undefined &&
        rightOffset !== undefined &&
        rightWidth !== undefined &&
        path !== undefined &&
        Math.max(leftOffset, rightOffset) <
          Math.min(leftOffset + leftWidth, rightOffset + rightWidth)
      ) {
        findings.push(
          finding(
            "OPENING_OVERLAP",
            "error",
            [host.id, left.id, right.id],
            located(host.levelId, minimumPoint(path)),
          ),
        );
      }
    }
  }

  for (const space of snapshot.elements.spaces) {
    if (invalidSpacePolygonIds.has(space.id)) continue;
    const boundary = knownValue<readonly Point2[]>(space.boundary);
    const boundaryWalls = space.boundedByElementIds.map((id) => walls.get(id));
    if (
      boundary === undefined ||
      boundaryWalls.some((wall) => wall === undefined || invalidWallIds.has(wall.id))
    ) {
      continue;
    }
    const paths = boundaryWalls.flatMap((wall) => {
      if (wall === undefined) return [];
      const path = knownValue<readonly Point2[]>(wall.path);
      return path === undefined ? [] : [path];
    });
    const first = boundary[0] ?? { xMm: 0, yMm: 0 };
    const topology = roomTopology(paths);
    const affectedIds = [space.id, ...space.boundedByElementIds];
    if (!topology.connected) {
      findings.push(
        finding("ROOM_BOUNDARY_DISCONNECTED", "error", affectedIds, located(space.levelId, first)),
      );
    }
    if (!topology.closed) {
      findings.push(
        finding("ROOM_BOUNDARY_NOT_CLOSED", "error", affectedIds, located(space.levelId, first)),
      );
    }
    const boundaryKeys = new Set(boundary.map(pointKey));
    const endpointKeys = new Set(
      paths
        .flatMap((path) => [path[0], path.at(-1)])
        .flatMap((point) => (point === undefined ? [] : [pointKey(point)])),
    );
    if (
      topology.connected &&
      topology.closed &&
      (boundaryKeys.size !== endpointKeys.size ||
        [...boundaryKeys].some((key) => !endpointKeys.has(key)))
    ) {
      findings.push(
        finding("ROOM_BOUNDARY_INCONSISTENT", "error", affectedIds, located(space.levelId, first)),
      );
    }
  }

  const levels = new Map(snapshot.elements.levels.map((level) => [level.id, level]));
  for (const stair of snapshot.elements.stairs) {
    const from = levels.get(stair.fromLevelId);
    const to = levels.get(stair.toLevelId);
    if (from === undefined || to === undefined) {
      const missingLevelId = from === undefined ? stair.fromLevelId : stair.toLevelId;
      findings.push(finding("LEVEL_REFERENCE_MISSING", "error", [stair.id, missingLevelId]));
      continue;
    }
    const path = knownValue<readonly Point2[]>(stair.path);
    const first = path === undefined ? { xMm: 0, yMm: 0 } : minimumPoint(path);
    if (stair.fromLevelId === stair.toLevelId) {
      findings.push(
        finding(
          "STAIR_LEVELS_IDENTICAL",
          "error",
          [stair.id, stair.fromLevelId],
          located(stair.fromLevelId, first),
        ),
      );
    }
    const rise = knownValue<number>(stair.riseMm);
    const run = knownValue<number>(stair.runMm);
    const count = knownValue<number>(stair.stepCount);
    const fromElevation = knownValue<number>(from.elevationMm);
    const toElevation = knownValue<number>(to.elevationMm);
    if (
      stair.fromLevelId !== stair.toLevelId &&
      rise !== undefined &&
      count !== undefined &&
      fromElevation !== undefined &&
      toElevation !== undefined &&
      rise * count !== Math.abs(toElevation - fromElevation)
    ) {
      findings.push(
        finding(
          "STAIR_RISE_LEVEL_MISMATCH",
          "error",
          [stair.id, stair.fromLevelId, stair.toLevelId],
          located(stair.fromLevelId, first),
        ),
      );
    }
    if (
      path !== undefined &&
      run !== undefined &&
      count !== undefined &&
      count > 0 &&
      run * (count - 1) !== pathLength(path)
    ) {
      findings.push(
        finding("STAIR_RUN_PATH_MISMATCH", "error", [stair.id], located(stair.fromLevelId, first)),
      );
    }
  }

  return findings.sort((left, right) => findingKey(left).localeCompare(findingKey(right)));
}
