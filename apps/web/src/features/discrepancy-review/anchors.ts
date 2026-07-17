import type { CreateFusionJobRequest, FusionSource } from "@interior-design/contracts";

export interface FusionAnchorDraft {
  readonly projectX: string;
  readonly projectY: string;
  readonly projectZ: string;
  readonly sourceX: string;
  readonly sourceY: string;
  readonly sourceZ: string;
}

export type FusionAnchorDrafts = Readonly<Record<string, readonly FusionAnchorDraft[]>>;
export type FusionAnchorGroups = CreateFusionJobRequest["anchorGroups"];

const coordinateMinimum = -10_000_000;
const coordinateMaximum = 10_000_000;

export function emptyFusionAnchorDraft(): FusionAnchorDraft {
  return {
    projectX: "",
    projectY: "",
    projectZ: "",
    sourceX: "",
    sourceY: "",
    sourceZ: "",
  };
}

export function minimumFusionAnchorDrafts(): readonly FusionAnchorDraft[] {
  return [emptyFusionAnchorDraft(), emptyFusionAnchorDraft(), emptyFusionAnchorDraft()];
}

function coordinate(value: string): number | undefined {
  if (!/^-?\d+$/u.test(value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= coordinateMinimum && parsed <= coordinateMaximum
    ? parsed
    : undefined;
}

function nonCollinear(
  points: readonly { readonly xMm: number; readonly yMm: number; readonly zMm: number }[],
): boolean {
  for (let first = 0; first < points.length - 2; first += 1) {
    for (let second = first + 1; second < points.length - 1; second += 1) {
      for (let third = second + 1; third < points.length; third += 1) {
        const a = points[first];
        const b = points[second];
        const c = points[third];
        if (!a || !b || !c) continue;
        const ab = { x: b.xMm - a.xMm, y: b.yMm - a.yMm, z: b.zMm - a.zMm };
        const ac = { x: c.xMm - a.xMm, y: c.yMm - a.yMm, z: c.zMm - a.zMm };
        const cross = {
          x: ab.y * ac.z - ab.z * ac.y,
          y: ab.z * ac.x - ab.x * ac.z,
          z: ab.x * ac.y - ab.y * ac.x,
        };
        if (cross.x !== 0 || cross.y !== 0 || cross.z !== 0) return true;
      }
    }
  }
  return false;
}

export function buildFusionAnchorGroups(
  sources: readonly FusionSource[],
  drafts: FusionAnchorDrafts,
  createId: () => string,
): FusionAnchorGroups | undefined {
  const groups: FusionAnchorGroups[number][] = [];
  for (const source of sources) {
    if (source.coordinateFrame === "project-local") continue;
    const rows = drafts[source.id];
    if (!rows || rows.length < 3 || rows.length > 256) return undefined;
    const anchors = rows.map((row) => {
      const sourceX = coordinate(row.sourceX);
      const sourceY = coordinate(row.sourceY);
      const sourceZ = coordinate(row.sourceZ);
      const projectX = coordinate(row.projectX);
      const projectY = coordinate(row.projectY);
      const projectZ = coordinate(row.projectZ);
      if (
        sourceX === undefined ||
        sourceY === undefined ||
        sourceZ === undefined ||
        projectX === undefined ||
        projectY === undefined ||
        projectZ === undefined
      ) {
        return undefined;
      }
      return {
        anchorId: createId(),
        confidenceBasisPoints: 7_500,
        method: "user-correspondence" as const,
        projectPoint: { xMm: projectX, yMm: projectY, zMm: projectZ },
        sourcePoint: { xMm: sourceX, yMm: sourceY, zMm: sourceZ },
      };
    });
    if (anchors.some((anchor) => anchor === undefined)) return undefined;
    const complete = anchors as Exclude<(typeof anchors)[number], undefined>[];
    if (
      !nonCollinear(complete.map(({ sourcePoint }) => sourcePoint)) ||
      !nonCollinear(complete.map(({ projectPoint }) => projectPoint))
    ) {
      return undefined;
    }
    groups.push({ anchors: complete, sourceId: source.id });
  }
  return groups;
}
