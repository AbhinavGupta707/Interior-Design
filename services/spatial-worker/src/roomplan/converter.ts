import {
  c7CapturePolicy,
  canonicalHomeSnapshotSchema,
  captureProposalResultSchema,
  type CanonicalHomeSnapshot,
  type CaptureProposalResult,
  type RoomPlanNormalized,
} from "@interior-design/contracts";

import { deterministicUuid, sha256 } from "./canonical.js";

export const roomPlanConverterId = "c7-roomplan-canonical" as const;
export const roomPlanConverterVersion = "1.0.0" as const;

export interface RoomPlanConversionContext {
  readonly captureSessionId: string;
  readonly createdAt: string;
  readonly normalizedArtifactId: string;
  readonly normalizedInputSha256: string;
  readonly packageId: string;
  readonly packageManifestSha256: string;
  readonly projectId: string;
  readonly proposalId: string;
}

type ModelElements = CanonicalHomeSnapshot["elements"];
type ModelLevel = ModelElements["levels"][number];
type ModelOpening = ModelElements["openings"][number];
type ModelSpace = ModelElements["spaces"][number];
type ModelWall = ModelElements["walls"][number];
type ModelFixedObject = ModelElements["fixedObjects"][number];
type ModelFurnishing = ModelElements["furnishings"][number];
type Finding = Extract<CaptureProposalResult, { readonly status: "proposal" }>["findings"][number];
type ElementSource = Extract<
  CaptureProposalResult,
  { readonly status: "proposal" }
>["elementSources"][number];

interface IntegerPoint3 {
  readonly x: bigint;
  readonly y: bigint;
  readonly z: bigint;
}

interface WallGeometry {
  readonly end: IntegerPoint3;
  readonly modelElementId: string;
  readonly start: IntegerPoint3;
}

const BASIS_SCALE = 1_000_000_000n;
const MICROMETRES_PER_MILLIMETRE = 1_000n;
const FIXED_OBJECT_CATEGORIES = new Set([
  "bathtub",
  "dishwasher",
  "fireplace",
  "oven",
  "refrigerator",
  "sink",
  "toilet",
  "washer-dryer",
]);
const FURNISHING_CATEGORIES = new Set(["bed", "chair", "sofa", "storage", "table", "television"]);

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function roundDivideHalfAway(value: bigint, divisor: bigint): bigint {
  const quotient = value / divisor;
  const remainder = value % divisor;
  if (absolute(remainder) * 2n < divisor) return quotient;
  return quotient + (value < 0n ? -1n : 1n);
}

function integerSqrt(value: bigint): bigint {
  if (value < 0n) throw new Error("Integer square root rejects negative values.");
  if (value < 2n) return value;
  let left = 1n;
  let right = value;
  while (left <= right) {
    const middle = (left + right) / 2n;
    const square = middle * middle;
    if (square === value) return middle;
    if (square < value) left = middle + 1n;
    else right = middle - 1n;
  }
  return right;
}

function transformPoint(
  transform: RoomPlanNormalized["surfaces"][number]["transform"],
  local: IntegerPoint3,
): IntegerPoint3 {
  const basis = transform.basisNanounits.map(BigInt);
  const component = (row: number): bigint =>
    roundDivideHalfAway(
      (basis[row * 3] ?? 0n) * local.x +
        (basis[row * 3 + 1] ?? 0n) * local.y +
        (basis[row * 3 + 2] ?? 0n) * local.z,
      BASIS_SCALE,
    );
  return {
    x: BigInt(transform.translationMicrometres.x) + component(0),
    y: BigInt(transform.translationMicrometres.y) + component(1),
    z: BigInt(transform.translationMicrometres.z) + component(2),
  };
}

function canonicalPoint2(point: IntegerPoint3): { readonly xMm: number; readonly yMm: number } {
  return {
    xMm: Number(roundDivideHalfAway(point.x, MICROMETRES_PER_MILLIMETRE)),
    yMm: Number(roundDivideHalfAway(point.z, MICROMETRES_PER_MILLIMETRE)),
  };
}

function canonicalPoint3(point: IntegerPoint3): {
  readonly xMm: number;
  readonly yMm: number;
  readonly zMm: number;
} {
  return {
    xMm: Number(roundDivideHalfAway(point.x, MICROMETRES_PER_MILLIMETRE)),
    yMm: Number(roundDivideHalfAway(point.z, MICROMETRES_PER_MILLIMETRE)),
    zMm: Number(roundDivideHalfAway(point.y, MICROMETRES_PER_MILLIMETRE)),
  };
}

interface CanonicalPoint2 {
  readonly xMm: number;
  readonly yMm: number;
}

function orientation(a: CanonicalPoint2, b: CanonicalPoint2, c: CanonicalPoint2): bigint {
  return (
    (BigInt(b.xMm) - BigInt(a.xMm)) * (BigInt(c.yMm) - BigInt(a.yMm)) -
    (BigInt(b.yMm) - BigInt(a.yMm)) * (BigInt(c.xMm) - BigInt(a.xMm))
  );
}

function between(value: number, first: number, second: number): boolean {
  return value >= Math.min(first, second) && value <= Math.max(first, second);
}

function onSegment(a: CanonicalPoint2, b: CanonicalPoint2, point: CanonicalPoint2): boolean {
  return (
    orientation(a, b, point) === 0n &&
    between(point.xMm, a.xMm, b.xMm) &&
    between(point.yMm, a.yMm, b.yMm)
  );
}

function segmentsIntersect(
  firstStart: CanonicalPoint2,
  firstEnd: CanonicalPoint2,
  secondStart: CanonicalPoint2,
  secondEnd: CanonicalPoint2,
): boolean {
  const firstSecondStart = orientation(firstStart, firstEnd, secondStart);
  const firstSecondEnd = orientation(firstStart, firstEnd, secondEnd);
  const secondFirstStart = orientation(secondStart, secondEnd, firstStart);
  const secondFirstEnd = orientation(secondStart, secondEnd, firstEnd);
  if (
    ((firstSecondStart < 0n && firstSecondEnd > 0n) ||
      (firstSecondStart > 0n && firstSecondEnd < 0n)) &&
    ((secondFirstStart < 0n && secondFirstEnd > 0n) ||
      (secondFirstStart > 0n && secondFirstEnd < 0n))
  ) {
    return true;
  }
  return (
    (firstSecondStart === 0n && onSegment(firstStart, firstEnd, secondStart)) ||
    (firstSecondEnd === 0n && onSegment(firstStart, firstEnd, secondEnd)) ||
    (secondFirstStart === 0n && onSegment(secondStart, secondEnd, firstStart)) ||
    (secondFirstEnd === 0n && onSegment(secondStart, secondEnd, firstEnd))
  );
}

function isSimpleNonDegeneratePolygon(points: readonly CanonicalPoint2[]): boolean {
  if (points.length < 3) return false;
  let doubledArea = 0n;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (current === undefined || next === undefined) return false;
    if (current.xMm === next.xMm && current.yMm === next.yMm) return false;
    doubledArea += BigInt(current.xMm) * BigInt(next.yMm) - BigInt(current.yMm) * BigInt(next.xMm);
  }
  if (doubledArea === 0n) return false;
  for (let first = 0; first < points.length; first += 1) {
    const firstStart = points[first];
    const firstEnd = points[(first + 1) % points.length];
    if (firstStart === undefined || firstEnd === undefined) return false;
    for (let second = first + 1; second < points.length; second += 1) {
      const adjacent = second === first + 1 || (first === 0 && second === points.length - 1);
      if (adjacent) continue;
      const secondStart = points[second];
      const secondEnd = points[(second + 1) % points.length];
      if (
        secondStart === undefined ||
        secondEnd === undefined ||
        segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)
      ) {
        return false;
      }
    }
  }
  return true;
}

function dimensionMm(micrometres: number): number | undefined {
  const result = Number(roundDivideHalfAway(BigInt(micrometres), MICROMETRES_PER_MILLIMETRE));
  return result > 0 ? result : undefined;
}

function confidenceScore(confidence: "high" | "low" | "medium"): number {
  if (confidence === "high") return 90;
  if (confidence === "medium") return 70;
  return 40;
}

function knownAttribution(claimKey: string, evidenceId: string) {
  return {
    claimId: deterministicUuid("c7-claim", claimKey),
    evidenceIds: [evidenceId],
    method: {
      kind: "room-capture" as const,
      name: roomPlanConverterId,
      version: roomPlanConverterVersion,
    },
    state: "source-derived" as const,
    verification: { status: "not-reviewed" as const },
  };
}

function known<T>(value: T, claimKey: string, evidenceId: string) {
  return {
    attribution: knownAttribution(claimKey, evidenceId),
    knowledge: "known" as const,
    value,
  };
}

function unknown(claimKey: string, evidenceId: string, reason: "not-observed" | "unsupported") {
  return {
    attribution: {
      claimId: deterministicUuid("c7-claim", claimKey),
      evidenceIds: [evidenceId],
      method: {
        kind: "room-capture" as const,
        name: roomPlanConverterId,
        version: roomPlanConverterVersion,
      },
      reason,
      state: "unknown" as const,
      verification: { status: "not-reviewed" as const },
    },
    knowledge: "unknown" as const,
  };
}

function modelId(kind: string, sourceId: string): string {
  return deterministicUuid(`c7-model-${kind}`, sourceId);
}

function finding(
  code: string,
  message: string,
  severity: "error" | "information" | "warning",
  sourceIds: readonly string[],
): Finding {
  return {
    affectedSourceEntityIds: [...sourceIds].sort(),
    code,
    message,
    severity,
  };
}

function sortedFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((left, right) =>
    `${left.code}:${left.affectedSourceEntityIds.join(",")}:${left.message}`.localeCompare(
      `${right.code}:${right.affectedSourceEntityIds.join(",")}:${right.message}`,
    ),
  );
}

function converterManifest(normalizedInputSha256: string) {
  const core = {
    adapterId: roomPlanConverterId,
    adapterVersion: roomPlanConverterVersion,
    normalizedInputSha256,
  };
  return { ...core, manifestSha256: sha256(core) };
}

export function createRoomPlanAbstention(
  context: RoomPlanConversionContext,
  code:
    | "ambiguous-topology"
    | "conversion-failed"
    | "incompatible-world-space"
    | "invalid-normalized-input"
    | "low-quality"
    | "resource-limit"
    | "rights-not-permitted"
    | "source-mismatch"
    | "unsupported-package",
  detail: string,
  findings: readonly Finding[] = [],
): CaptureProposalResult {
  return captureProposalResultSchema.parse({
    captureSessionId: context.captureSessionId,
    code,
    converter: converterManifest(context.normalizedInputSha256),
    createdAt: context.createdAt,
    detail,
    findings: sortedFindings(findings),
    nextActions:
      code === "low-quality"
        ? ["rescan-room", "add-reference-measurement", "use-plan", "edit-manually"]
        : ["use-plan", "edit-manually"],
    packageId: context.packageId,
    packageManifestSha256: context.packageManifestSha256,
    projectId: context.projectId,
    proposalId: context.proposalId,
    retryable: false,
    schemaVersion: "c7-capture-proposal-v1",
    status: "abstained",
  });
}

export function convertRoomPlanToProposal(
  normalized: RoomPlanNormalized,
  context: RoomPlanConversionContext,
): CaptureProposalResult {
  const evidenceId = context.normalizedArtifactId;
  const findings: Finding[] = [];
  const unresolved = new Set<string>();
  const elementSources: ElementSource[] = [];
  const levels: ModelLevel[] = [];
  const walls: ModelWall[] = [];
  const openings: ModelOpening[] = [];
  const spaces: ModelSpace[] = [];
  const fixedObjects: ModelFixedObject[] = [];
  const furnishings: ModelFurnishing[] = [];
  const levelByStory = new Map<number, string>();
  const wallBySource = new Map<string, WallGeometry>();
  const sortedRooms = [...normalized.rooms].sort(
    (left, right) =>
      left.story - right.story ||
      left.sequence - right.sequence ||
      left.roomId.localeCompare(right.roomId),
  );
  const roomsByStory = new Map<number, typeof sortedRooms>();
  for (const room of sortedRooms) {
    const collection = roomsByStory.get(room.story) ?? [];
    collection.push(room);
    roomsByStory.set(room.story, collection);
  }
  for (const [story, rooms] of [...roomsByStory.entries()].sort(
    ([left], [right]) => left - right,
  )) {
    const sourceIds = rooms.map(({ sourceRoomIdentifier }) => sourceRoomIdentifier).sort();
    const id = modelId("level", `story:${String(story)}`);
    levelByStory.set(story, id);
    const key = `level:${String(story)}`;
    levels.push({
      elementType: "level",
      elevationMm: unknown(`${key}:elevation`, evidenceId, "not-observed"),
      id,
      name: known(`Captured storey ${String(story)}`, `${key}:name`, evidenceId),
      origin: knownAttribution(`${key}:origin`, evidenceId),
      storeyHeightMm: unknown(`${key}:height`, evidenceId, "not-observed"),
    });
    elementSources.push({
      confidence: 70,
      modelElementId: id,
      sourceEntityIds: sourceIds,
      state: "source-derived",
    });
  }

  const surfaces = [...normalized.surfaces].sort((left, right) =>
    left.sourceIdentifier.localeCompare(right.sourceIdentifier),
  );
  for (const surface of surfaces.filter(({ category }) => category === "wall")) {
    const levelId = levelByStory.get(surface.story);
    const width = BigInt(surface.dimensionsMicrometres.x);
    const heightMm = dimensionMm(surface.dimensionsMicrometres.y);
    if (levelId === undefined || heightMm === undefined || surface.curve !== undefined) {
      unresolved.add(surface.sourceIdentifier);
      findings.push(
        finding(
          surface.curve === undefined ? "WALL_DIMENSION_UNSUPPORTED" : "CURVED_WALL_UNRESOLVED",
          "This wall observation cannot be represented as a straight bounded canonical wall without invention.",
          "warning",
          [surface.sourceIdentifier],
        ),
      );
      continue;
    }
    const localStart = { x: -(width / 2n), y: 0n, z: 0n };
    const localEnd = { x: localStart.x + width, y: 0n, z: 0n };
    const start = transformPoint(surface.transform, localStart);
    const end = transformPoint(surface.transform, localEnd);
    const startMm = canonicalPoint2(start);
    const endMm = canonicalPoint2(end);
    if (startMm.xMm === endMm.xMm && startMm.yMm === endMm.yMm) {
      unresolved.add(surface.sourceIdentifier);
      findings.push(
        finding(
          "WALL_COLLAPSED_AT_MM_PRECISION",
          "The wall becomes zero-length at canonical millimetre precision.",
          "error",
          [surface.sourceIdentifier],
        ),
      );
      continue;
    }
    const id = modelId("wall", surface.sourceIdentifier);
    const key = `wall:${surface.sourceIdentifier}`;
    const baseOffsetMm = Number(
      roundDivideHalfAway(
        BigInt(surface.transform.translationMicrometres.y) -
          BigInt(surface.dimensionsMicrometres.y) / 2n,
        MICROMETRES_PER_MILLIMETRE,
      ),
    );
    walls.push({
      alignment: "centre",
      baseOffsetMm: known(baseOffsetMm, `${key}:base`, evidenceId),
      elementType: "wall",
      heightMm: known(heightMm, `${key}:height`, evidenceId),
      id,
      levelId,
      name: known("RoomPlan wall", `${key}:name`, evidenceId),
      origin: knownAttribution(`${key}:origin`, evidenceId),
      path: known([startMm, endMm], `${key}:path`, evidenceId),
      thicknessMm: unknown(`${key}:thickness`, evidenceId, "not-observed"),
    });
    wallBySource.set(surface.sourceIdentifier, { end, modelElementId: id, start });
    elementSources.push({
      confidence: confidenceScore(surface.confidence),
      modelElementId: id,
      sourceEntityIds: [surface.sourceIdentifier],
      state: "source-derived",
    });
    if (surface.completedEdges.length < 4) {
      findings.push(
        finding(
          "WALL_EDGES_INCOMPLETE",
          "RoomPlan did not mark every wall edge complete; review the proposed extent.",
          "warning",
          [surface.sourceIdentifier],
        ),
      );
    }
  }

  for (const surface of surfaces.filter(({ category }) => category === "floor")) {
    const levelId = levelByStory.get(surface.story);
    const width = BigInt(surface.dimensionsMicrometres.x);
    const depth = BigInt(surface.dimensionsMicrometres.z);
    const localCorners: IntegerPoint3[] =
      surface.polygonCornersMicrometres.length >= 3
        ? surface.polygonCornersMicrometres.map(({ x, y, z }) => ({
            x: BigInt(x),
            y: BigInt(y),
            z: BigInt(z),
          }))
        : [
            { x: -(width / 2n), y: 0n, z: -(depth / 2n) },
            { x: -(width / 2n) + width, y: 0n, z: -(depth / 2n) },
            { x: -(width / 2n) + width, y: 0n, z: -(depth / 2n) + depth },
            { x: -(width / 2n), y: 0n, z: -(depth / 2n) + depth },
          ];
    const boundary = localCorners.map((point) =>
      canonicalPoint2(transformPoint(surface.transform, point)),
    );
    const unique = new Set(boundary.map(({ xMm, yMm }) => `${String(xMm)}:${String(yMm)}`));
    if (levelId === undefined || unique.size < 3 || !isSimpleNonDegeneratePolygon(boundary)) {
      unresolved.add(surface.sourceIdentifier);
      findings.push(
        finding(
          "FLOOR_BOUNDARY_UNRESOLVED",
          "The floor observation does not provide a non-degenerate canonical room boundary.",
          "warning",
          [surface.sourceIdentifier],
        ),
      );
      continue;
    }
    const room = sortedRooms.find(({ roomId }) => roomId === surface.roomId);
    const id = modelId("space", surface.sourceIdentifier);
    const key = `space:${surface.sourceIdentifier}`;
    spaces.push({
      boundary: known(boundary, `${key}:boundary`, evidenceId),
      boundedByElementIds: surfaces
        .filter(({ category, roomId }) => category === "wall" && roomId === surface.roomId)
        .map(({ sourceIdentifier }) => wallBySource.get(sourceIdentifier)?.modelElementId)
        .filter((value): value is string => value !== undefined)
        .sort(),
      classification:
        room?.userLabel === undefined
          ? unknown(`${key}:classification`, evidenceId, "not-observed")
          : known(room.userLabel, `${key}:classification`, evidenceId),
      elementType: "space",
      id,
      levelId,
      name:
        room?.userLabel === undefined
          ? known("Captured room", `${key}:name`, evidenceId)
          : known(room.userLabel, `${key}:name`, evidenceId),
      origin: knownAttribution(`${key}:origin`, evidenceId),
    });
    elementSources.push({
      confidence: confidenceScore(surface.confidence),
      modelElementId: id,
      sourceEntityIds: [surface.sourceIdentifier],
      state: "source-derived",
    });
  }

  for (const surface of surfaces.filter(({ category }) =>
    ["door-open", "door-closed", "opening", "window"].includes(category),
  )) {
    const parent =
      surface.parentSourceIdentifier === undefined
        ? undefined
        : wallBySource.get(surface.parentSourceIdentifier);
    const widthMm = dimensionMm(surface.dimensionsMicrometres.x);
    const heightMm = dimensionMm(surface.dimensionsMicrometres.y);
    if (parent === undefined || widthMm === undefined || heightMm === undefined) {
      unresolved.add(surface.sourceIdentifier);
      findings.push(
        finding(
          "OPENING_PARENT_UNRESOLVED",
          "The opening cannot be positioned because its canonical host wall or dimensions are unavailable.",
          "warning",
          [surface.sourceIdentifier],
        ),
      );
      continue;
    }
    const centre = transformPoint(surface.transform, { x: 0n, y: 0n, z: 0n });
    const wallX = parent.end.x - parent.start.x;
    const wallZ = parent.end.z - parent.start.z;
    const wallLength = integerSqrt(wallX * wallX + wallZ * wallZ);
    if (wallLength === 0n) {
      unresolved.add(surface.sourceIdentifier);
      continue;
    }
    const projection = roundDivideHalfAway(
      (centre.x - parent.start.x) * wallX + (centre.z - parent.start.z) * wallZ,
      wallLength,
    );
    const halfWidth = BigInt(surface.dimensionsMicrometres.x) / 2n;
    const openingStart = projection - halfWidth;
    const openingEnd = projection + halfWidth;
    const offsetAlongHostMm = Number(roundDivideHalfAway(openingStart, MICROMETRES_PER_MILLIMETRE));
    const wallLengthMm = Number(roundDivideHalfAway(wallLength, MICROMETRES_PER_MILLIMETRE));
    if (
      openingStart <= 0n ||
      openingEnd > wallLength ||
      offsetAlongHostMm <= 0 ||
      offsetAlongHostMm + widthMm > wallLengthMm
    ) {
      unresolved.add(surface.sourceIdentifier);
      findings.push(
        finding(
          "OPENING_OFFSET_UNRESOLVED",
          "The opening interval is not wholly contained by its host wall at canonical millimetre precision.",
          "warning",
          [surface.sourceIdentifier],
        ),
      );
      continue;
    }
    const id = modelId("opening", surface.sourceIdentifier);
    const key = `opening:${surface.sourceIdentifier}`;
    const sillHeightMm = Number(
      roundDivideHalfAway(
        BigInt(surface.transform.translationMicrometres.y) -
          BigInt(surface.dimensionsMicrometres.y) / 2n,
        MICROMETRES_PER_MILLIMETRE,
      ),
    );
    openings.push({
      elementType: "opening",
      heightMm: known(heightMm, `${key}:height`, evidenceId),
      hostWallId: parent.modelElementId,
      id,
      kind:
        surface.category === "window"
          ? "window"
          : surface.category === "opening"
            ? "opening"
            : "door",
      name: known(`RoomPlan ${surface.category}`, `${key}:name`, evidenceId),
      offsetAlongHostMm: known(offsetAlongHostMm, `${key}:offset`, evidenceId),
      origin: knownAttribution(`${key}:origin`, evidenceId),
      sillHeightMm: known(sillHeightMm, `${key}:sill`, evidenceId),
      swing: unknown(`${key}:swing`, evidenceId, "not-observed"),
      widthMm: known(widthMm, `${key}:width`, evidenceId),
    });
    elementSources.push({
      confidence: confidenceScore(surface.confidence),
      modelElementId: id,
      sourceEntityIds: [surface.sourceIdentifier],
      state: "source-derived",
    });
  }

  for (const object of [...normalized.objects].sort((left, right) =>
    left.sourceIdentifier.localeCompare(right.sourceIdentifier),
  )) {
    const levelId = levelByStory.get(object.story);
    const widthMm = dimensionMm(object.dimensionsMicrometres.x);
    const heightMm = dimensionMm(object.dimensionsMicrometres.y);
    const depthMm = dimensionMm(object.dimensionsMicrometres.z);
    const target = FIXED_OBJECT_CATEGORIES.has(object.category)
      ? fixedObjects
      : FURNISHING_CATEGORIES.has(object.category)
        ? furnishings
        : undefined;
    if (
      target === undefined ||
      levelId === undefined ||
      widthMm === undefined ||
      heightMm === undefined ||
      depthMm === undefined
    ) {
      unresolved.add(object.sourceIdentifier);
      findings.push(
        finding(
          object.category === "stairs" ? "STAIR_CONNECTIVITY_UNKNOWN" : "OBJECT_UNRESOLVED",
          "This RoomPlan object category or dimension cannot be proposed without unsupported assumptions.",
          "information",
          [object.sourceIdentifier],
        ),
      );
      continue;
    }
    const elementKind = target === fixedObjects ? "fixed-object" : "furnishing";
    const id = modelId(elementKind, object.sourceIdentifier);
    const key = `${elementKind}:${object.sourceIdentifier}`;
    target.push({
      category: known(object.category, `${key}:category`, evidenceId),
      dimensions: known({ depthMm, heightMm, widthMm }, `${key}:dimensions`, evidenceId),
      elementType: elementKind,
      id,
      levelId,
      name: known(`RoomPlan ${object.category}`, `${key}:name`, evidenceId),
      origin: knownAttribution(`${key}:origin`, evidenceId),
      placement: {
        position: known(
          canonicalPoint3(transformPoint(object.transform, { x: 0n, y: 0n, z: 0n })),
          `${key}:position`,
          evidenceId,
        ),
        rotationMilliDegrees: unknown(`${key}:rotation`, evidenceId, "unsupported"),
      },
    } as ModelFixedObject & ModelFurnishing);
    elementSources.push({
      confidence: confidenceScore(object.confidence),
      modelElementId: id,
      sourceEntityIds: [object.sourceIdentifier],
      state: "source-derived",
    });
  }

  if (walls.length === 0 && spaces.length === 0) {
    return createRoomPlanAbstention(
      context,
      "ambiguous-topology",
      "The capture contains no bounded wall or floor geometry that can be proposed safely.",
      findings,
    );
  }
  const confidence = Math.floor(
    elementSources.reduce((total, source) => total + source.confidence, 0) /
      Math.max(1, elementSources.length),
  );
  if (
    confidence < c7CapturePolicy.minimumProposalConfidence ||
    normalized.quality.worldMappingStatusAtFinish === "not-available" ||
    normalized.quality.lowConfidenceSurfaceCount > normalized.surfaces.length / 2
  ) {
    return createRoomPlanAbstention(
      context,
      "low-quality",
      "The bounded quality signals are insufficient for a canonical-shaped proposal.",
      findings,
    );
  }
  const snapshot = canonicalHomeSnapshotSchema.parse({
    coordinateSystem: {
      axes: { x: "east", y: "north", z: "up" },
      globalAnchor: { status: "not-established" },
      handedness: "right",
      kind: "local-cartesian",
      lengthUnit: "mm",
      originConvention: "project-local-model-origin",
    },
    elements: {
      cameras: [],
      finishes: [],
      fixedObjects: fixedObjects.sort((left, right) => left.id.localeCompare(right.id)),
      furnishings: furnishings.sort((left, right) => left.id.localeCompare(right.id)),
      levels: levels.sort((left, right) => left.id.localeCompare(right.id)),
      lights: [],
      openings: openings.sort((left, right) => left.id.localeCompare(right.id)),
      spaces: spaces.sort((left, right) => left.id.localeCompare(right.id)),
      stairs: [],
      surfaces: [],
      walls: walls.sort((left, right) => left.id.localeCompare(right.id)),
    },
    knownLimitations: [
      {
        code: "ROOMPLAN_PROPOSAL_UNVERIFIED",
        detail:
          "RoomPlan evidence is an unreviewed existing-state proposal; hidden construction, structure, global position and survey accuracy remain unknown.",
      },
      ...(unresolved.size === 0
        ? []
        : [
            {
              code: "ROOMPLAN_ENTITIES_UNRESOLVED",
              detail: `${String(unresolved.size)} source observations remain explicitly unresolved.`,
            },
          ]),
    ],
    modelId: deterministicUuid("c7-model", context.captureSessionId),
    profile: "existing",
    projectId: context.projectId,
    schemaVersion: "c4-canonical-home-v1",
  });
  return captureProposalResultSchema.parse({
    captureSessionId: context.captureSessionId,
    converter: converterManifest(context.normalizedInputSha256),
    createdAt: context.createdAt,
    elementSources: elementSources.sort((left, right) =>
      left.modelElementId.localeCompare(right.modelElementId),
    ),
    findings: sortedFindings(findings),
    overallConfidence: confidence,
    packageId: context.packageId,
    packageManifestSha256: context.packageManifestSha256,
    projectId: context.projectId,
    proposalId: context.proposalId,
    proposedSnapshot: snapshot,
    schemaVersion: "c7-capture-proposal-v1",
    status: "proposal",
    unresolvedSourceEntityIds: [...unresolved].sort(),
  });
}
