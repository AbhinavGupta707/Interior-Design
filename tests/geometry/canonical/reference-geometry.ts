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

function pointAlongPath(points: readonly Point2[], distance: number): Point2 {
  let remaining = distance;
  for (const segment of segments(points, false)) {
    const length = Math.hypot(
      segment.end.xMm - segment.start.xMm,
      segment.end.yMm - segment.start.yMm,
    );
    if (remaining <= length) {
      const ratio = length === 0 ? 0 : remaining / length;
      return {
        xMm: Math.round(segment.start.xMm + (segment.end.xMm - segment.start.xMm) * ratio),
        yMm: Math.round(segment.start.yMm + (segment.end.yMm - segment.start.yMm) * ratio),
      };
    }
    remaining -= length;
  }
  return points.at(-1) ?? { xMm: 0, yMm: 0 };
}

function isConnectedCycle(paths: readonly (readonly Point2[])[]): boolean {
  const adjacency = new Map<string, string[]>();
  for (const path of paths) {
    const start = path[0];
    const end = path.at(-1);
    if (start === undefined || end === undefined) return false;
    const startKey = pointKey(start);
    const endKey = pointKey(end);
    adjacency.set(startKey, [...(adjacency.get(startKey) ?? []), endKey]);
    adjacency.set(endKey, [...(adjacency.get(endKey) ?? []), startKey]);
  }
  if ([...adjacency.values()].some((neighbours) => neighbours.length !== 2)) return false;
  const first = adjacency.keys().next().value;
  if (first === undefined) return false;
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
  return visited.size === adjacency.size;
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
        findings.push(finding("LEVEL_REFERENCE_MISSING", "error", [element.id]));
      }
    }
  }

  for (const finish of snapshot.elements.finishes) {
    if (!allElementIds.has(finish.targetElementId)) {
      findings.push(finding("TARGET_ELEMENT_REFERENCE_MISSING", "error", [finish.id]));
    }
  }

  for (const space of snapshot.elements.spaces) {
    const boundary = knownValue<readonly Point2[]>(space.boundary);
    if (boundary === undefined) continue;
    const area = twiceSignedArea(boundary);
    const first = boundary[0] ?? { xMm: 0, yMm: 0 };
    if (area > maximumSafeInteger || area < -maximumSafeInteger) {
      findings.push(
        finding("ARITHMETIC_RANGE_UNSAFE", "error", [space.id], located(space.levelId, first)),
      );
      invalidSpacePolygonIds.add(space.id);
      continue;
    }
    if (area === 0n) {
      findings.push(
        finding("SPACE_POLYGON_DEGENERATE", "error", [space.id], located(space.levelId, first)),
      );
      invalidSpacePolygonIds.add(space.id);
      continue;
    }
    const intersection = firstSelfIntersection(boundary, true);
    if (intersection !== undefined) {
      findings.push(
        finding(
          "SPACE_POLYGON_SELF_INTERSECTS",
          "error",
          [space.id],
          located(space.levelId, intersection),
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
    const first = boundary[0] ?? { xMm: 0, yMm: 0 };
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
          "SURFACE_POLYGON_SELF_INTERSECTS",
          "error",
          [surface.id],
          located(surface.levelId, intersection),
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
    const seenSegments = new Set<string>();
    const repeatedSegment = wallSegments.find((segment) => {
      const key = segmentKey(segment);
      if (seenSegments.has(key)) return true;
      seenSegments.add(key);
      return false;
    });
    if (zeroSegment !== undefined) {
      findings.push(
        finding(
          "WALL_PATH_ZERO_LENGTH",
          "error",
          [wall.id],
          located(wall.levelId, zeroSegment.start),
        ),
      );
      invalidWallIds.add(wall.id);
    }
    if (repeatedSegment !== undefined) {
      findings.push(
        finding(
          "WALL_PATH_SEGMENT_REPEATED",
          "error",
          [wall.id],
          located(wall.levelId, path[0] ?? repeatedSegment.start),
        ),
      );
      invalidWallIds.add(wall.id);
    }
    if (zeroSegment === undefined && repeatedSegment === undefined) {
      const intersection = firstSelfIntersection(path, false);
      if (intersection !== undefined) {
        findings.push(
          finding(
            "WALL_PATH_SELF_INTERSECTS",
            "error",
            [wall.id],
            located(wall.levelId, intersection),
          ),
        );
        invalidWallIds.add(wall.id);
      }
    }
    const first = path[0] ?? { xMm: 0, yMm: 0 };
    if (wall.heightMm.knowledge === "unknown") {
      findings.push(
        finding("WALL_HEIGHT_UNKNOWN", "warning", [wall.id], located(wall.levelId, first)),
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
      findings.push(finding("HOST_WALL_REFERENCE_MISSING", "error", [opening.id]));
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
            "OPENING_OUTSIDE_HOST",
            "error",
            [opening.id],
            located(host.levelId, path.at(-1) ?? { xMm: 0, yMm: 0 }),
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
            "OPENING_VERTICAL_EXTENT_INVALID",
            "error",
            [opening.id],
            located(host.levelId, pointAlongPath(path, offset)),
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
            "OPENINGS_OVERLAP",
            "error",
            [left.id, right.id],
            located(host.levelId, pointAlongPath(path, Math.max(leftOffset, rightOffset))),
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
    if (!isConnectedCycle(paths)) {
      findings.push(
        finding("ROOM_BOUNDARY_DISCONNECTED", "error", [space.id], located(space.levelId, first)),
      );
    }
    const boundaryKeys = new Set(boundary.map(pointKey));
    const endpointKeys = new Set(
      paths
        .flatMap((path) => [path[0], path.at(-1)])
        .flatMap((point) => (point === undefined ? [] : [pointKey(point)])),
    );
    if (
      boundaryKeys.size !== endpointKeys.size ||
      [...boundaryKeys].some((key) => !endpointKeys.has(key))
    ) {
      findings.push(
        finding("ROOM_BOUNDARY_INCONSISTENT", "error", [space.id], located(space.levelId, first)),
      );
    }
  }

  const levels = new Map(snapshot.elements.levels.map((level) => [level.id, level]));
  for (const stair of snapshot.elements.stairs) {
    const from = levels.get(stair.fromLevelId);
    const to = levels.get(stair.toLevelId);
    if (from === undefined || to === undefined) {
      findings.push(finding("STAIR_LEVEL_REFERENCE_MISSING", "error", [stair.id]));
      continue;
    }
    const path = knownValue<readonly Point2[]>(stair.path);
    const first = path?.[0] ?? { xMm: 0, yMm: 0 };
    const last = path?.at(-1) ?? first;
    if (stair.fromLevelId === stair.toLevelId) {
      findings.push(finding("STAIR_LEVELS_IDENTICAL", "error", [stair.id]));
    }
    const rise = knownValue<number>(stair.riseMm);
    const run = knownValue<number>(stair.runMm);
    const count = knownValue<number>(stair.stepCount);
    if (rise !== undefined && run !== undefined && rise > run) {
      findings.push(
        finding(
          "STAIR_RISE_RUN_RELATION_INVALID",
          "error",
          [stair.id],
          located(stair.fromLevelId, first),
        ),
      );
    }
    const fromElevation = knownValue<number>(from.elevationMm);
    const toElevation = knownValue<number>(to.elevationMm);
    if (
      rise !== undefined &&
      count !== undefined &&
      fromElevation !== undefined &&
      toElevation !== undefined &&
      rise * count !== Math.abs(toElevation - fromElevation)
    ) {
      findings.push(
        finding("STAIR_ELEVATION_MISMATCH", "error", [stair.id], located(stair.fromLevelId, last)),
      );
    }
  }

  return findings.sort((left, right) => findingKey(left).localeCompare(findingKey(right)));
}
