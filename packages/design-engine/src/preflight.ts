import type { CanonicalHomeSnapshot } from "@interior-design/contracts";
import { validateAndCanonicalizeSnapshot } from "@interior-design/model-operations";

import { compareStrings, sha256Canonical } from "./canonical.js";
import { deriveConstraints } from "./constraints.js";
import { validateAndScalePolygon, type ScaledPolygon } from "./geometry.js";
import { parseDesignConstraintRequest, parseFailure } from "./parse.js";
import {
  designEngineResourcePolicy,
  type DeterministicDesignConstraintResult,
  type DeterministicDesignEngineFailure,
  type ParsedDesignConstraintRequest,
} from "./types.js";

type CanonicalElement =
  CanonicalHomeSnapshot["elements"][keyof CanonicalHomeSnapshot["elements"]][number];
type CanonicalValidationResult = ReturnType<typeof validateAndCanonicalizeSnapshot>;

export interface ValidatedConstraintContext {
  readonly keepOutPolygons: ReadonlyMap<string, ScaledPolygon>;
  readonly request: ParsedDesignConstraintRequest;
  readonly sourceSnapshotSha256: string;
  readonly workingSnapshotSha256: string;
}

function knownValue<TValue>(
  value:
    { readonly knowledge: "known"; readonly value: TValue } | { readonly knowledge: "unknown" },
): TValue | undefined {
  return value.knowledge === "known" ? value.value : undefined;
}

function allElements(snapshot: CanonicalHomeSnapshot): readonly CanonicalElement[] {
  return Object.values(snapshot.elements).flat();
}

function acceptedBriefContentSha256(request: ParsedDesignConstraintRequest): string {
  const brief = request.acceptedBrief;
  const entries = brief.entries
    .map((entry) => ({
      ...entry,
      roomOrLevelElementIds: [...entry.roomOrLevelElementIds].sort(compareStrings),
    }))
    .sort((left, right) => compareStrings(left.id, right.id));
  const referenceBoard = [...brief.referenceBoard].sort((left, right) =>
    compareStrings(left.id, right.id),
  );
  return sha256Canonical({
    entries,
    id: brief.id,
    ...(brief.modelReference === undefined ? {} : { modelReference: brief.modelReference }),
    projectId: brief.projectId,
    referenceBoard,
    schemaVersion: brief.schemaVersion,
  });
}

function resourceLimitExceeded(request: ParsedDesignConstraintRequest): boolean {
  const elements = request.workingSnapshot.elements;
  return (
    elements.levels.length > designEngineResourcePolicy.maximumLevels ||
    elements.spaces.length > designEngineResourcePolicy.maximumSpaces ||
    elements.fixedObjects.length > designEngineResourcePolicy.maximumFixedObjects ||
    elements.furnishings.length > designEngineResourcePolicy.maximumExistingFurnishings
  );
}

function validateSourcePins(request: ParsedDesignConstraintRequest):
  | DeterministicDesignEngineFailure
  | {
      readonly source: CanonicalValidationResult;
      readonly working: CanonicalValidationResult;
    } {
  if (
    request.acceptedBrief.status !== "accepted" ||
    request.acceptedBrief.projectId !== request.sourceSnapshot.projectId ||
    request.sourceSnapshot.projectId !== request.workingSnapshot.projectId
  ) {
    return parseFailure("SOURCE_PIN_MISMATCH", "validate");
  }
  let source: CanonicalValidationResult;
  let working: CanonicalValidationResult;
  try {
    source = validateAndCanonicalizeSnapshot(request.sourceSnapshot);
    working = validateAndCanonicalizeSnapshot(request.workingSnapshot);
  } catch {
    return parseFailure("MALFORMED_GEOMETRY", "validate");
  }
  if (source.hasBlockingFindings || working.hasBlockingFindings) {
    return parseFailure("MALFORMED_GEOMETRY", "validate");
  }
  if (
    acceptedBriefContentSha256(request) !== request.acceptedBriefContentSha256 ||
    request.sourceModel.modelId !== source.snapshot.modelId ||
    request.sourceModel.profile !== source.snapshot.profile ||
    request.sourceModel.snapshotSha256 !== source.snapshotSha256 ||
    request.workingModel.modelId !== working.snapshot.modelId ||
    working.snapshot.profile !== "proposed" ||
    request.workingModel.snapshotSha256 !== working.snapshotSha256 ||
    source.snapshot.projectId !== working.snapshot.projectId ||
    source.snapshot.modelId !== working.snapshot.modelId ||
    (source.snapshot.profile === "existing" &&
      working.snapshot.derivedFromSnapshotSha256 !== source.snapshotSha256) ||
    (source.snapshot.profile === "proposed" && source.snapshotSha256 !== working.snapshotSha256)
  ) {
    return parseFailure("SOURCE_PIN_MISMATCH", "validate");
  }
  const modelReference = request.acceptedBrief.modelReference;
  if (
    modelReference !== undefined &&
    (modelReference.modelId !== request.sourceModel.modelId ||
      modelReference.snapshotId !== request.sourceModel.snapshotId ||
      modelReference.snapshotSha256 !== request.sourceModel.snapshotSha256)
  ) {
    return parseFailure("SOURCE_PIN_MISMATCH", "validate");
  }
  return { source, working };
}

function validateKnownBaseGeometry(
  request: ParsedDesignConstraintRequest,
): DeterministicDesignEngineFailure | undefined {
  const elements = new Map(
    allElements(request.workingSnapshot).map((element) => [element.id, element]),
  );
  const finishHostUnknown = request.finishTargets.some(({ targetElementId }) => {
    const element = elements.get(targetElementId);
    if (element?.elementType === "surface") return knownValue(element.boundary) === undefined;
    if (element?.elementType === "wall") {
      return (
        knownValue(element.baseOffsetMm) === undefined ||
        knownValue(element.heightMm) === undefined ||
        knownValue(element.path) === undefined ||
        knownValue(element.thicknessMm) === undefined
      );
    }
    if (element?.elementType === "fixed-object") {
      return (
        knownValue(element.dimensions) === undefined ||
        knownValue(element.placement.position) === undefined ||
        knownValue(element.placement.rotationMilliDegrees) === undefined
      );
    }
    return false;
  });
  const missing =
    finishHostUnknown ||
    request.workingSnapshot.elements.levels.some(
      (level) =>
        knownValue(level.elevationMm) === undefined ||
        knownValue(level.storeyHeightMm) === undefined,
    ) ||
    request.workingSnapshot.elements.spaces.some(
      (space) => knownValue(space.boundary) === undefined,
    ) ||
    request.workingSnapshot.elements.fixedObjects.some(
      (object) =>
        knownValue(object.dimensions) === undefined ||
        knownValue(object.placement.position) === undefined ||
        knownValue(object.placement.rotationMilliDegrees) === undefined,
    ) ||
    request.workingSnapshot.elements.furnishings.some(
      (furnishing) =>
        knownValue(furnishing.dimensions) === undefined ||
        knownValue(furnishing.placement.position) === undefined ||
        knownValue(furnishing.placement.rotationMilliDegrees) === undefined,
    );
  return missing ? parseFailure("INSUFFICIENT_GEOMETRY", "validate") : undefined;
}

function computationalFinishFaces(element: CanonicalElement): ReadonlySet<string> {
  if (element.elementType === "wall") return new Set(["all", "inside", "outside"]);
  if (element.elementType === "fixed-object") {
    return new Set(["all", "inside", "outside", "top"]);
  }
  if (element.elementType !== "surface") return new Set();
  switch (element.kind) {
    case "floor":
      return new Set(["all", "top"]);
    case "ceiling":
      return new Set(["all", "bottom"]);
    case "slab":
    case "roof":
      return new Set(["all", "bottom", "top"]);
    case "wall-face":
      return new Set(["all", "inside", "outside"]);
    case "other":
      return new Set(["all"]);
  }
}

export function validatePolicyGeometry(
  request: ParsedDesignConstraintRequest,
): DeterministicDesignEngineFailure | ReadonlyMap<string, ScaledPolygon> {
  const levels = new Set(request.workingSnapshot.elements.levels.map(({ id }) => id));
  const polygons = new Map<string, ScaledPolygon>();
  for (const space of request.workingSnapshot.elements.spaces) {
    const boundary = knownValue(space.boundary);
    if (boundary === undefined) return parseFailure("INSUFFICIENT_GEOMETRY", "validate");
    const validated = validateAndScalePolygon(
      boundary,
      designEngineResourcePolicy.maximumPolygonVertices,
    );
    if (!validated.ok) return parseFailure(validated.code, "validate");
  }
  for (const keepOut of request.keepOuts) {
    if (!levels.has(keepOut.levelId)) return parseFailure("INVALID_INPUT", "validate");
    const validated = validateAndScalePolygon(
      keepOut.polygon,
      designEngineResourcePolicy.maximumPolygonVertices,
    );
    if (!validated.ok) return parseFailure(validated.code, "validate");
    polygons.set(keepOut.id, validated.polygon);
  }
  const targetIds = request.finishTargets.map(({ targetElementId }) => targetElementId);
  if (new Set(targetIds).size !== targetIds.length) {
    return parseFailure("INVALID_INPUT", "validate");
  }
  const elements = new Map(
    allElements(request.workingSnapshot).map((element) => [element.id, element]),
  );
  for (const target of request.finishTargets) {
    const element = elements.get(target.targetElementId);
    if (element === undefined) return parseFailure("INVALID_INPUT", "validate");
    const validFaces = computationalFinishFaces(element);
    if (target.allowedFaces.some((face) => !validFaces.has(face))) {
      return parseFailure("INVALID_INPUT", "validate");
    }
  }
  return polygons;
}

export function validateConstraintContext(
  request: ParsedDesignConstraintRequest,
): DeterministicDesignEngineFailure | ValidatedConstraintContext {
  if (resourceLimitExceeded(request)) return parseFailure("RESOURCE_LIMIT", "validate");
  const pins = validateSourcePins(request);
  if ("abstention" in pins) return pins;
  const canonicalRequest: ParsedDesignConstraintRequest = {
    ...request,
    sourceSnapshot: pins.source.snapshot,
    workingSnapshot: pins.working.snapshot,
  };
  const missingGeometry = validateKnownBaseGeometry(canonicalRequest);
  if (missingGeometry !== undefined) return missingGeometry;
  const keepOutPolygons = validatePolicyGeometry(canonicalRequest);
  if ("abstention" in keepOutPolygons) return keepOutPolygons;
  return {
    keepOutPolygons,
    request: canonicalRequest,
    sourceSnapshotSha256: pins.source.snapshotSha256,
    workingSnapshotSha256: pins.working.snapshotSha256,
  };
}

function deriveValidatedConstraints(input: unknown): DeterministicDesignConstraintResult {
  const parsed = parseDesignConstraintRequest(input);
  if ("abstention" in parsed) return parsed;
  const validated = validateConstraintContext(parsed);
  if ("abstention" in validated) return validated;
  const derived = deriveConstraints(validated.request);
  return derived.ok ? derived : { abstention: derived.abstention, ok: false };
}

/**
 * Freezes the exact candidate-independent C12 constraint set for a job. The function is pure,
 * bounded and runtime-validates an exact input shape; it has no candidate, clock or provider port.
 */
export function deriveDeterministicDesignConstraints(
  input: unknown,
): DeterministicDesignConstraintResult {
  try {
    return deriveValidatedConstraints(input);
  } catch {
    return parseFailure("INVALID_INPUT", "parse");
  }
}
