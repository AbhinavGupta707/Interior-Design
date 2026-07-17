import type { CanonicalHomeSnapshot, KnownAttribution } from "@interior-design/contracts";

export type ProjectedElementKind = "opening" | "space" | "stair" | "wall";

export interface ProjectedPoint {
  readonly x: number;
  readonly y: number;
}

export interface ProjectedElement {
  readonly id: string;
  readonly kind: ProjectedElementKind;
  readonly label: string;
  readonly levelId: string;
  readonly points: readonly ProjectedPoint[];
  readonly selected: boolean;
  readonly strokeWidth: number;
}

export interface ProjectedLevel {
  readonly id: string;
  readonly label: string;
}

export interface ProjectedPlan {
  readonly elements: readonly ProjectedElement[];
  readonly levelId: string;
  readonly levels: readonly ProjectedLevel[];
  readonly selectedElementId?: string;
  readonly viewBox: Readonly<{ height: number; width: number; x: number; y: number }>;
}

export interface CanonicalElementSelection {
  readonly attribution: KnownAttribution;
  readonly collection:
    | "fixedObjects"
    | "furnishings"
    | "levels"
    | "lights"
    | "openings"
    | "spaces"
    | "stairs"
    | "surfaces"
    | "walls";
  readonly element: CanonicalHomeSnapshot["elements"][keyof CanonicalHomeSnapshot["elements"]][number];
  readonly id: string;
  readonly label: string;
}

type Attributed<T> =
  { readonly knowledge: "known"; readonly value: T } | { readonly knowledge: "unknown" };

function knownValue<T>(value: Attributed<T>): T | undefined {
  return value.knowledge === "known" ? value.value : undefined;
}

function labelOf(element: { readonly id: string; readonly name: Attributed<string> }): string {
  return knownValue(element.name) ?? `Unnamed ${element.id.slice(0, 8)}`;
}

function svgPoint(point: { readonly xMm: number; readonly yMm: number }): ProjectedPoint {
  return Object.freeze({ x: point.xMm, y: point.yMm === 0 ? 0 : -point.yMm });
}

function decimalBoundary(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function pointAlongPolyline(
  points: readonly { readonly xMm: number; readonly yMm: number }[],
  offsetMm: number,
): ProjectedPoint | undefined {
  let remaining = offsetMm;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    if (!start || !end) continue;
    const deltaX = end.xMm - start.xMm;
    const deltaY = end.yMm - start.yMm;
    const segmentLength = Math.hypot(deltaX, deltaY);
    if (remaining <= segmentLength || index === points.length - 1) {
      const ratio = segmentLength === 0 ? 0 : Math.min(1, Math.max(0, remaining / segmentLength));
      const projectedY = -(start.yMm + deltaY * ratio);
      return Object.freeze({
        x: decimalBoundary(start.xMm + deltaX * ratio),
        y: projectedY === 0 ? 0 : decimalBoundary(projectedY),
      });
    }
    remaining -= segmentLength;
  }
  return points[0] ? svgPoint(points[0]) : undefined;
}

function planViewBox(elements: readonly ProjectedElement[]) {
  const points = elements.flatMap(({ points: elementPoints }) => elementPoints);
  if (points.length === 0) return Object.freeze({ height: 1_000, width: 1_000, x: 0, y: 0 });
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minimumX = Math.min(minimumX, point.x);
    minimumY = Math.min(minimumY, point.y);
    maximumX = Math.max(maximumX, point.x);
    maximumY = Math.max(maximumY, point.y);
  }
  const extent = Math.max(maximumX - minimumX, maximumY - minimumY, 1_000);
  const padding = Math.max(250, Math.ceil(extent / 20));
  return Object.freeze({
    height: Math.ceil(maximumY - minimumY + padding * 2),
    width: Math.ceil(maximumX - minimumX + padding * 2),
    x: Math.floor(minimumX - padding),
    y: Math.floor(minimumY - padding),
  });
}

function projectedElements(
  snapshot: CanonicalHomeSnapshot,
  levelId: string,
  selectedElementId: string | undefined,
): ProjectedElement[] {
  const result: ProjectedElement[] = [];
  for (const space of snapshot.elements.spaces) {
    const boundary = knownValue(space.boundary);
    if (space.levelId === levelId && boundary) {
      result.push({
        id: space.id,
        kind: "space",
        label: labelOf(space),
        levelId,
        points: boundary.map(svgPoint),
        selected: space.id === selectedElementId,
        strokeWidth: 20,
      });
    }
  }
  for (const wall of snapshot.elements.walls) {
    const path = knownValue(wall.path);
    const thicknessMm = knownValue(wall.thicknessMm);
    if (wall.levelId === levelId && path) {
      result.push({
        id: wall.id,
        kind: "wall",
        label: labelOf(wall),
        levelId,
        points: path.map(svgPoint),
        selected: wall.id === selectedElementId,
        strokeWidth: thicknessMm ?? 100,
      });
    }
  }
  const visibleWalls = new Map(
    snapshot.elements.walls
      .filter((wall) => wall.levelId === levelId)
      .map((wall) => [wall.id, wall] as const),
  );
  for (const opening of snapshot.elements.openings) {
    const host = visibleWalls.get(opening.hostWallId);
    const path = host ? knownValue(host.path) : undefined;
    const offsetMm = knownValue(opening.offsetAlongHostMm);
    const position =
      path && offsetMm !== undefined ? pointAlongPolyline(path, offsetMm) : undefined;
    if (host && position) {
      result.push({
        id: opening.id,
        kind: "opening",
        label: labelOf(opening),
        levelId,
        points: [position],
        selected: opening.id === selectedElementId,
        strokeWidth: Math.max(80, knownValue(opening.widthMm) ?? 80),
      });
    }
  }
  for (const stair of snapshot.elements.stairs) {
    const path = knownValue(stair.path);
    if ((stair.fromLevelId === levelId || stair.toLevelId === levelId) && path) {
      result.push({
        id: stair.id,
        kind: "stair",
        label: labelOf(stair),
        levelId,
        points: path.map(svgPoint),
        selected: stair.id === selectedElementId,
        strokeWidth: Math.max(80, knownValue(stair.widthMm) ?? 80),
      });
    }
  }
  return result;
}

export function projectCanonicalSnapshotToPlan(
  snapshot: CanonicalHomeSnapshot,
  options: { readonly levelId?: string; readonly selectedElementId?: string } = {},
): ProjectedPlan {
  const levels = snapshot.elements.levels.map((level) => ({
    id: level.id,
    label: labelOf(level),
  }));
  const levelId =
    options.levelId && levels.some(({ id }) => id === options.levelId)
      ? options.levelId
      : levels[0]?.id;
  if (!levelId) throw new Error("The canonical snapshot has no visible level.");
  const elements = projectedElements(snapshot, levelId, options.selectedElementId);
  const selectionIsVisible = elements.some(({ id }) => id === options.selectedElementId);
  return Object.freeze({
    elements: Object.freeze(elements),
    levelId,
    levels: Object.freeze(levels),
    ...(selectionIsVisible && options.selectedElementId
      ? { selectedElementId: options.selectedElementId }
      : {}),
    viewBox: planViewBox(elements),
  });
}

export function selectCanonicalElement(
  snapshot: CanonicalHomeSnapshot,
  elementId: string | undefined,
): CanonicalElementSelection | undefined {
  if (!elementId) return undefined;
  const collections = [
    "levels",
    "walls",
    "openings",
    "spaces",
    "stairs",
    "surfaces",
    "fixedObjects",
    "furnishings",
    "lights",
  ] as const;
  for (const collection of collections) {
    const element = snapshot.elements[collection].find(({ id }) => id === elementId);
    if (element) {
      return Object.freeze({
        attribution: element.origin,
        collection,
        element,
        id: element.id,
        label: labelOf(element),
      });
    }
  }
  return undefined;
}
