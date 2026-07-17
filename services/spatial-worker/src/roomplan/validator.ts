import {
  roomPlanNormalizedSchema,
  type CreateCapturePackageRequest,
  type RoomPlanNormalized,
} from "@interior-design/contracts";

import { canonicalJson } from "./canonical.js";

export type RoomPlanValidationCode =
  "incompatible-world-space" | "invalid-normalized-input" | "resource-limit" | "source-mismatch";

export class RoomPlanValidationError extends Error {
  readonly code: RoomPlanValidationCode;

  constructor(code: RoomPlanValidationCode, message: string) {
    super(message);
    this.name = "RoomPlanValidationError";
    this.code = code;
  }
}

export interface RoomPlanValidationContext {
  readonly actualNormalizedSha256: string;
  readonly captureSessionId: string;
  readonly expectedNormalizedSha256: string;
  readonly manifest: CreateCapturePackageRequest;
  readonly projectId: string;
}

const BASIS_SCALE = 1_000_000_000n;
const BASIS_NORM = BASIS_SCALE * BASIS_SCALE;
const BASIS_NORM_TOLERANCE = BASIS_NORM / 10_000n;
const BASIS_DETERMINANT = BASIS_NORM * BASIS_SCALE;
const BASIS_DETERMINANT_TOLERANCE = BASIS_DETERMINANT / 5_000n;

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function vectorDot(left: readonly bigint[], right: readonly bigint[]): bigint {
  return left.reduce((total, value, index) => total + value * (right[index] ?? 0n), 0n);
}

function validateBasis(basis: readonly number[]): boolean {
  if (basis.length !== 9) return false;
  const b = basis.map(BigInt);
  // The normalized contract stores a row-major local-to-world rotation matrix.
  const columns = [
    [b[0] ?? 0n, b[3] ?? 0n, b[6] ?? 0n],
    [b[1] ?? 0n, b[4] ?? 0n, b[7] ?? 0n],
    [b[2] ?? 0n, b[5] ?? 0n, b[8] ?? 0n],
  ];
  for (const column of columns) {
    if (absolute(vectorDot(column, column) - BASIS_NORM) > BASIS_NORM_TOLERANCE) return false;
  }
  if (
    absolute(vectorDot(columns[0] ?? [], columns[1] ?? [])) > BASIS_NORM_TOLERANCE ||
    absolute(vectorDot(columns[0] ?? [], columns[2] ?? [])) > BASIS_NORM_TOLERANCE ||
    absolute(vectorDot(columns[1] ?? [], columns[2] ?? [])) > BASIS_NORM_TOLERANCE
  ) {
    return false;
  }
  const [a, c, d, e, f, g, h, i, j] = b;
  if ([a, c, d, e, f, g, h, i, j].some((value) => value === undefined)) return false;
  const determinant =
    (a as bigint) * ((f as bigint) * (j as bigint) - (g as bigint) * (i as bigint)) -
    (c as bigint) * ((e as bigint) * (j as bigint) - (g as bigint) * (h as bigint)) +
    (d as bigint) * ((e as bigint) * (i as bigint) - (f as bigint) * (h as bigint));
  return absolute(determinant - BASIS_DETERMINANT) <= BASIS_DETERMINANT_TOLERANCE;
}

function rejectDuplicateStrings(values: readonly string[], message: string): void {
  if (new Set(values).size !== values.length) {
    throw new RoomPlanValidationError("invalid-normalized-input", message);
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export function validateRoomPlanNormalized(
  input: unknown,
  context: RoomPlanValidationContext,
): RoomPlanNormalized {
  if (context.actualNormalizedSha256 !== context.expectedNormalizedSha256) {
    throw new RoomPlanValidationError(
      "source-mismatch",
      "The normalized source bytes do not match the package hash.",
    );
  }
  const parsed = roomPlanNormalizedSchema.safeParse(input);
  if (!parsed.success) {
    throw new RoomPlanValidationError(
      "invalid-normalized-input",
      "The normalized RoomPlan payload does not satisfy c7-roomplan-normalized-v1.",
    );
  }
  const normalized = parsed.data;
  if (
    normalized.quality.lowConfidenceSurfaceCount > normalized.surfaces.length ||
    normalized.quality.lowConfidenceObjectCount > normalized.objects.length
  ) {
    throw new RoomPlanValidationError(
      "invalid-normalized-input",
      "Quality counts cannot exceed the normalized observations they summarize.",
    );
  }
  if (
    normalized.projectId !== context.projectId ||
    normalized.captureSessionId !== context.captureSessionId ||
    context.manifest.projectId !== context.projectId ||
    context.manifest.captureSessionId !== context.captureSessionId
  ) {
    throw new RoomPlanValidationError(
      "source-mismatch",
      "The normalized input, package, project, and session identities disagree.",
    );
  }
  if (
    !sameJson(normalized.rooms, context.manifest.rooms) ||
    !sameJson(normalized.quality, context.manifest.quality) ||
    !sameJson(normalized.referenceMeasurements, context.manifest.referenceMeasurements)
  ) {
    throw new RoomPlanValidationError(
      "source-mismatch",
      "Normalized room, quality, or measurement metadata differs from the package manifest.",
    );
  }
  if (
    (context.manifest.mode === "single-room" &&
      (normalized.rooms.length !== 1 || normalized.structureIdentifier !== undefined)) ||
    (context.manifest.mode === "structure" &&
      (!context.manifest.sharedWorldOrigin || normalized.structureIdentifier === undefined))
  ) {
    throw new RoomPlanValidationError(
      "incompatible-world-space",
      "RoomPlan rooms do not share the world-space contract required by this capture mode.",
    );
  }
  rejectDuplicateStrings(
    normalized.rooms.map(({ sourceRoomIdentifier }) => sourceRoomIdentifier),
    "Room source identifiers must be unique.",
  );
  const sequences = [...normalized.rooms.map(({ sequence }) => sequence)].sort((a, b) => a - b);
  if (!sequences.every((sequence, index) => sequence === index + 1)) {
    throw new RoomPlanValidationError(
      "invalid-normalized-input",
      "Room sequence numbers must be unique and consecutive.",
    );
  }
  const rooms = new Map(normalized.rooms.map((room) => [room.roomId, room]));
  const entities = [...normalized.surfaces, ...normalized.objects];
  const byId = new Map(entities.map((entity) => [entity.sourceIdentifier, entity]));
  for (const entity of entities) {
    if (!validateBasis(entity.transform.basisNanounits)) {
      throw new RoomPlanValidationError(
        "invalid-normalized-input",
        "Every transform basis must be a bounded right-handed orthonormal rotation.",
      );
    }
    if (rooms.get(entity.roomId)?.story !== entity.story) {
      throw new RoomPlanValidationError(
        "source-mismatch",
        "An entity story does not match its room manifest.",
      );
    }
    if (entity.parentSourceIdentifier === entity.sourceIdentifier) {
      throw new RoomPlanValidationError(
        "invalid-normalized-input",
        "A RoomPlan entity cannot parent itself.",
      );
    }
  }
  for (const surface of normalized.surfaces) {
    rejectDuplicateStrings(surface.completedEdges, "Completed surface edges must be unique.");
    const cornerKeys = surface.polygonCornersMicrometres.map(
      ({ x, y, z }) => `${String(x)}:${String(y)}:${String(z)}`,
    );
    rejectDuplicateStrings(cornerKeys, "Polygon corners must not contain duplicates.");
    if (
      surface.curve !== undefined &&
      surface.curve.startNanoradians === surface.curve.endNanoradians
    ) {
      throw new RoomPlanValidationError(
        "invalid-normalized-input",
        "A curve must span a non-zero angular interval.",
      );
    }
    if (
      ["door-open", "door-closed", "opening", "window"].includes(surface.category) &&
      (surface.parentSourceIdentifier === undefined ||
        byId.get(surface.parentSourceIdentifier)?.category !== "wall")
    ) {
      throw new RoomPlanValidationError(
        "invalid-normalized-input",
        "Opening-like surfaces require a valid wall parent.",
      );
    }
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (id: string): void => {
    if (active.has(id)) {
      throw new RoomPlanValidationError(
        "invalid-normalized-input",
        "Parent references must not contain cycles.",
      );
    }
    if (visited.has(id)) return;
    active.add(id);
    const parent = byId.get(id)?.parentSourceIdentifier;
    if (parent !== undefined) visit(parent);
    active.delete(id);
    visited.add(id);
  };
  for (const id of byId.keys()) visit(id);
  rejectDuplicateStrings(
    normalized.referenceMeasurements.map(({ measurementId }) => measurementId),
    "Reference measurement identifiers must be unique.",
  );
  for (const measurement of normalized.referenceMeasurements) {
    if (!byId.has(measurement.fromSourceEntityId) || !byId.has(measurement.toSourceEntityId)) {
      throw new RoomPlanValidationError(
        "invalid-normalized-input",
        "Reference measurements must bind two present source entities.",
      );
    }
  }
  return normalized;
}
