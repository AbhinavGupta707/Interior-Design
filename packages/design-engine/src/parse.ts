import {
  canonicalHomeSnapshotSchema,
  designBriefSchema,
  interiorAssetRefSchema,
  modelOperationRequestSchema,
  optionObjectiveSchema,
  optionSourceModelReferenceSchema,
  optionWorkingModelReferenceSchema,
  type DesignOption,
} from "@interior-design/contracts";

import { compareStrings } from "./canonical.js";
import {
  designEngineResourcePolicy,
  deterministicSearchConfigurationVersion,
  type BoundaryTouchPolicy,
  type BriefConstraintFact,
  type CandidateAssetPlacementInput,
  type DesignCandidateTemplate,
  type DesignEngineAbstentionCode,
  type DeterministicDesignConstraintRequest,
  type DeterministicDesignEngineFailure,
  type FinishFace,
  type FinishTargetDeclaration,
  type KeepOutDeclaration,
  type ParsedDesignConstraintRequest,
  type ParsedDesignEngineRequest,
} from "./types.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const assignmentKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u;
const directions = new Set<DesignOption["direction"]>([
  "circulation-first",
  "conversation-first",
  "daylight-first",
  "retention-first",
  "storage-first",
]);
const finishFaces = new Set<FinishFace>([
  "all",
  "bottom",
  "inside",
  "outside",
  "top",
  "unspecified",
]);

function failure(
  code: DesignEngineAbstentionCode,
  stage: DeterministicDesignEngineFailure["abstention"]["stage"],
): DeterministicDesignEngineFailure {
  const details: Record<DesignEngineAbstentionCode, string> = {
    CONTRADICTORY_REQUIREMENT: "Active requirements contradict one another.",
    INSUFFICIENT_GEOMETRY: "Required computational geometry is not known.",
    INVALID_INPUT: "The engine request violates its exact bounded input contract.",
    MALFORMED_GEOMETRY: "A supplied polygon is degenerate or self-intersecting.",
    NO_FEASIBLE_CANDIDATE: "No candidate passed every computational hard constraint.",
    NO_FEASIBLE_DIVERSE_SET: "No complete non-dominated and materially distinct option set exists.",
    NUMERIC_RANGE_EXCEEDED: "Integer geometry exceeds the supported exact numeric range.",
    OPERATION_REPLAY_FAILED: "A candidate operation bundle could not be replayed exactly.",
    RESOURCE_LIMIT: "The request exceeds a versioned deterministic resource ceiling.",
    SOURCE_PIN_MISMATCH: "A frozen brief, model, snapshot or asset pin does not match.",
    UNSUPPORTED_HARD_REQUIREMENT:
      "An active hard requirement cannot be proven by this computational engine.",
  };
  return {
    abstention: { code, detail: details[code], professionalReviewReasons: [], stage },
    ok: false,
  };
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Readonly<Record<string, unknown>>;
}

function hasExactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    Object.keys(value)
      .sort(compareStrings)
      .every((key, index) => key === [...keys].sort(compareStrings)[index])
  );
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isSafeBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function parseBoundaryTouch(value: unknown): BoundaryTouchPolicy | undefined {
  const candidate = record(value);
  if (candidate === undefined || !hasExactKeys(candidate, ["keepOut", "obstacle", "room"])) {
    return undefined;
  }
  if (
    (candidate.keepOut !== "allow" && candidate.keepOut !== "forbid") ||
    (candidate.obstacle !== "allow" && candidate.obstacle !== "forbid") ||
    (candidate.room !== "allow" && candidate.room !== "forbid")
  ) {
    return undefined;
  }
  return { keepOut: candidate.keepOut, obstacle: candidate.obstacle, room: candidate.room };
}

function parseKeepOut(value: unknown): KeepOutDeclaration | undefined {
  const candidate = record(value);
  if (
    candidate === undefined ||
    !hasExactKeys(candidate, ["id", "levelId", "polygon", "sourceElementIds"]) ||
    !isUuid(candidate.id) ||
    !isUuid(candidate.levelId) ||
    !Array.isArray(candidate.polygon) ||
    candidate.polygon.length < 3 ||
    candidate.polygon.length > designEngineResourcePolicy.maximumPolygonVertices ||
    !Array.isArray(candidate.sourceElementIds) ||
    candidate.sourceElementIds.length > 50 ||
    !candidate.sourceElementIds.every(isUuid)
  ) {
    return undefined;
  }
  const points: Array<{ readonly xMm: number; readonly yMm: number }> = [];
  for (const pointInput of candidate.polygon) {
    const point = record(pointInput);
    if (
      point === undefined ||
      !hasExactKeys(point, ["xMm", "yMm"]) ||
      !Number.isSafeInteger(point.xMm) ||
      !Number.isSafeInteger(point.yMm)
    ) {
      return undefined;
    }
    points.push({ xMm: Number(point.xMm), yMm: Number(point.yMm) });
  }
  return {
    id: candidate.id,
    levelId: candidate.levelId,
    polygon: points,
    sourceElementIds: [...new Set(candidate.sourceElementIds)].sort(compareStrings),
  };
}

function parseFinishTarget(value: unknown): FinishTargetDeclaration | undefined {
  const candidate = record(value);
  if (
    candidate === undefined ||
    !hasExactKeys(candidate, ["allowedFaces", "targetElementId"]) ||
    !isUuid(candidate.targetElementId) ||
    !Array.isArray(candidate.allowedFaces) ||
    candidate.allowedFaces.length < 1 ||
    candidate.allowedFaces.length > finishFaces.size ||
    !candidate.allowedFaces.every(
      (face): face is FinishFace => typeof face === "string" && finishFaces.has(face as FinishFace),
    )
  ) {
    return undefined;
  }
  const allowedFaces = [...new Set(candidate.allowedFaces)].sort(compareStrings);
  if (allowedFaces.length !== candidate.allowedFaces.length) return undefined;
  return { allowedFaces, targetElementId: candidate.targetElementId };
}

function parseBriefFact(value: unknown): BriefConstraintFact | undefined {
  const candidate = record(value);
  if (candidate === undefined || !isUuid(candidate.briefEntryId)) return undefined;
  if (candidate.kind === "retain-element") {
    if (
      !hasExactKeys(candidate, ["briefEntryId", "kind", "retainedElementId"]) ||
      !isUuid(candidate.retainedElementId)
    ) {
      return undefined;
    }
    return {
      briefEntryId: candidate.briefEntryId,
      kind: candidate.kind,
      retainedElementId: candidate.retainedElementId,
    };
  }
  if (candidate.kind === "minimum-clearance") {
    if (
      !hasExactKeys(candidate, [
        "assetElementIds",
        "briefEntryId",
        "clearanceMm",
        "kind",
        "scope",
      ]) ||
      !Array.isArray(candidate.assetElementIds) ||
      candidate.assetElementIds.length < 1 ||
      candidate.assetElementIds.length > 50 ||
      !candidate.assetElementIds.every(isUuid) ||
      !isSafeBoundedInteger(candidate.clearanceMm, 0, 10_000) ||
      (candidate.scope !== "all-sides" &&
        candidate.scope !== "circulation-target" &&
        candidate.scope !== "front-access")
    ) {
      return undefined;
    }
    return {
      assetElementIds: [...new Set(candidate.assetElementIds)].sort(compareStrings),
      briefEntryId: candidate.briefEntryId,
      clearanceMm: candidate.clearanceMm,
      kind: candidate.kind,
      scope: candidate.scope,
    };
  }
  if (candidate.kind === "adjacency-objective") {
    if (
      !hasExactKeys(candidate, [
        "assetElementId",
        "briefEntryId",
        "kind",
        "maximumDistanceMm",
        "targetElementId",
      ]) ||
      !isUuid(candidate.assetElementId) ||
      !isUuid(candidate.targetElementId) ||
      !isSafeBoundedInteger(candidate.maximumDistanceMm, 1, 100_000)
    ) {
      return undefined;
    }
    return {
      assetElementId: candidate.assetElementId,
      briefEntryId: candidate.briefEntryId,
      kind: candidate.kind,
      maximumDistanceMm: candidate.maximumDistanceMm,
      targetElementId: candidate.targetElementId,
    };
  }
  return undefined;
}

function parseAssetPlacement(value: unknown): CandidateAssetPlacementInput | undefined {
  const candidate = record(value);
  if (candidate === undefined) return undefined;
  const keys =
    candidate.spaceId === undefined
      ? ["assignmentKey", "assetVersionId", "elementId"]
      : ["assignmentKey", "assetVersionId", "elementId", "spaceId"];
  if (
    !hasExactKeys(candidate, keys) ||
    typeof candidate.assignmentKey !== "string" ||
    !assignmentKeyPattern.test(candidate.assignmentKey) ||
    !isUuid(candidate.assetVersionId) ||
    !isUuid(candidate.elementId) ||
    (candidate.spaceId !== undefined && !isUuid(candidate.spaceId))
  ) {
    return undefined;
  }
  return {
    assignmentKey: candidate.assignmentKey,
    assetVersionId: candidate.assetVersionId,
    elementId: candidate.elementId,
    ...(candidate.spaceId === undefined ? {} : { spaceId: candidate.spaceId }),
  };
}

function parseCandidateTemplate(value: unknown): DesignCandidateTemplate | undefined {
  const candidate = record(value);
  if (
    candidate === undefined ||
    !hasExactKeys(candidate, [
      "assetPlacements",
      "direction",
      "objectives",
      "operations",
      "templateId",
    ]) ||
    !isUuid(candidate.templateId) ||
    typeof candidate.direction !== "string" ||
    !directions.has(candidate.direction as DesignOption["direction"]) ||
    !Array.isArray(candidate.assetPlacements) ||
    candidate.assetPlacements.length > 50 ||
    !Array.isArray(candidate.operations) ||
    candidate.operations.length < 1 ||
    candidate.operations.length > 50 ||
    !Array.isArray(candidate.objectives) ||
    candidate.objectives.length < 1 ||
    candidate.objectives.length > 20
  ) {
    return undefined;
  }
  const placements: CandidateAssetPlacementInput[] = [];
  for (const placementInput of candidate.assetPlacements) {
    const placement = parseAssetPlacement(placementInput);
    if (placement === undefined) return undefined;
    placements.push(placement);
  }
  if (
    new Set(placements.map(({ assignmentKey }) => assignmentKey)).size !== placements.length ||
    new Set(placements.map(({ elementId }) => elementId)).size !== placements.length
  ) {
    return undefined;
  }
  const operations = candidate.operations.map((operation) =>
    modelOperationRequestSchema.safeParse(operation),
  );
  if (operations.some((result) => !result.success)) return undefined;
  const objectives = candidate.objectives.map((objective) =>
    optionObjectiveSchema.safeParse(objective),
  );
  if (objectives.some((result) => !result.success)) return undefined;
  const parsedObjectives = objectives.flatMap((result) => (result.success ? [result.data] : []));
  if (new Set(parsedObjectives.map(({ id }) => id)).size !== parsedObjectives.length)
    return undefined;
  return {
    assetPlacements: placements,
    direction: candidate.direction as DesignOption["direction"],
    objectives: parsedObjectives.sort((left, right) => compareStrings(left.id, right.id)),
    operations: operations.flatMap((result) => (result.success ? [result.data] : [])),
    templateId: candidate.templateId,
  };
}

export function parseDesignEngineRequest(
  input: unknown,
): DeterministicDesignEngineFailure | ParsedDesignEngineRequest {
  const candidate = record(input);
  if (
    candidate === undefined ||
    !hasExactKeys(candidate, [
      "acceptedBrief",
      "acceptedBriefContentSha256",
      "assetManifestSha256",
      "assets",
      "briefConstraintFacts",
      "candidateTemplates",
      "configuration",
      "finishTargets",
      "keepOuts",
      "requestedDirections",
      "requestedOptionCount",
      "sourceModel",
      "sourceSnapshot",
      "workingModel",
      "workingSnapshot",
    ]) ||
    !Array.isArray(candidate.assets) ||
    !Array.isArray(candidate.briefConstraintFacts) ||
    !Array.isArray(candidate.candidateTemplates) ||
    !Array.isArray(candidate.finishTargets) ||
    !Array.isArray(candidate.keepOuts)
  ) {
    return failure("INVALID_INPUT", "parse");
  }
  if (
    candidate.assets.length > designEngineResourcePolicy.maximumAssets ||
    candidate.briefConstraintFacts.length >
      designEngineResourcePolicy.maximumBriefConstraintFacts ||
    candidate.candidateTemplates.length > designEngineResourcePolicy.maximumCandidateTemplates ||
    candidate.finishTargets.length > designEngineResourcePolicy.maximumFinishTargets ||
    candidate.keepOuts.length > designEngineResourcePolicy.maximumKeepOuts
  ) {
    return failure("RESOURCE_LIMIT", "parse");
  }
  const configuration = record(candidate.configuration);
  const boundaryTouch = parseBoundaryTouch(configuration?.boundaryTouch);
  if (
    configuration === undefined ||
    !hasExactKeys(configuration, ["boundaryTouch", "candidateBudget", "schemaVersion"]) ||
    boundaryTouch === undefined ||
    configuration.schemaVersion !== deterministicSearchConfigurationVersion ||
    !isSafeBoundedInteger(
      configuration.candidateBudget,
      1,
      designEngineResourcePolicy.maximumCandidateBudget,
    )
  ) {
    return failure("INVALID_INPUT", "parse");
  }
  const constraintRequest = parseDesignConstraintRequest({
    acceptedBrief: candidate.acceptedBrief,
    acceptedBriefContentSha256: candidate.acceptedBriefContentSha256,
    briefConstraintFacts: candidate.briefConstraintFacts,
    finishTargets: candidate.finishTargets,
    keepOuts: candidate.keepOuts,
    sourceModel: candidate.sourceModel,
    sourceSnapshot: candidate.sourceSnapshot,
    systemPolicy: {
      boundaryTouch: configuration.boundaryTouch,
      schemaVersion: configuration.schemaVersion,
    },
    workingModel: candidate.workingModel,
    workingSnapshot: candidate.workingSnapshot,
  });
  if (
    "abstention" in constraintRequest ||
    typeof candidate.assetManifestSha256 !== "string" ||
    !sha256Pattern.test(candidate.assetManifestSha256)
  ) {
    return failure("INVALID_INPUT", "parse");
  }
  const assets = candidate.assets.map((asset) => interiorAssetRefSchema.safeParse(asset));
  const templates = candidate.candidateTemplates.map(parseCandidateTemplate);
  if (
    assets.some((asset) => !asset.success) ||
    templates.some((template) => template === undefined)
  ) {
    return failure("INVALID_INPUT", "parse");
  }
  if (
    !Array.isArray(candidate.requestedDirections) ||
    candidate.requestedDirections.length < 2 ||
    candidate.requestedDirections.length > 5 ||
    !candidate.requestedDirections.every(
      (direction): direction is DesignOption["direction"] =>
        typeof direction === "string" && directions.has(direction as DesignOption["direction"]),
    ) ||
    new Set(candidate.requestedDirections).size !== candidate.requestedDirections.length ||
    !isSafeBoundedInteger(candidate.requestedOptionCount, 2, 8) ||
    candidate.requestedOptionCount < candidate.requestedDirections.length
  ) {
    return failure("INVALID_INPUT", "parse");
  }
  const parsedAssets = assets.flatMap((asset) => (asset.success ? [asset.data] : []));
  if (
    new Set(parsedAssets.map(({ versionId }) => versionId)).size !== parsedAssets.length ||
    new Set(parsedAssets.map(({ id, versionId }) => `${id}:${versionId}`)).size !==
      parsedAssets.length
  ) {
    return failure("INVALID_INPUT", "parse");
  }
  return {
    acceptedBrief: constraintRequest.acceptedBrief,
    acceptedBriefContentSha256: constraintRequest.acceptedBriefContentSha256,
    assetManifestSha256: candidate.assetManifestSha256,
    assets: parsedAssets,
    briefConstraintFacts: constraintRequest.briefConstraintFacts,
    candidateTemplates: templates.flatMap((template) => (template === undefined ? [] : [template])),
    configuration: {
      boundaryTouch,
      candidateBudget: configuration.candidateBudget,
      schemaVersion: deterministicSearchConfigurationVersion,
    },
    finishTargets: constraintRequest.finishTargets,
    keepOuts: constraintRequest.keepOuts,
    requestedDirections: candidate.requestedDirections,
    requestedOptionCount: candidate.requestedOptionCount,
    sourceModel: constraintRequest.sourceModel,
    sourceSnapshot: constraintRequest.sourceSnapshot,
    workingModel: constraintRequest.workingModel,
    workingSnapshot: constraintRequest.workingSnapshot,
  };
}

/** Runtime-validates the exact candidate-independent constraint-freezing port. */
export function parseDesignConstraintRequest(
  input: unknown,
): DeterministicDesignEngineFailure | ParsedDesignConstraintRequest {
  const candidate = record(input);
  if (
    candidate === undefined ||
    !hasExactKeys(candidate, [
      "acceptedBrief",
      "acceptedBriefContentSha256",
      "briefConstraintFacts",
      "finishTargets",
      "keepOuts",
      "sourceModel",
      "sourceSnapshot",
      "systemPolicy",
      "workingModel",
      "workingSnapshot",
    ]) ||
    !Array.isArray(candidate.briefConstraintFacts) ||
    !Array.isArray(candidate.finishTargets) ||
    !Array.isArray(candidate.keepOuts)
  ) {
    return failure("INVALID_INPUT", "parse");
  }
  if (
    candidate.briefConstraintFacts.length >
      designEngineResourcePolicy.maximumBriefConstraintFacts ||
    candidate.finishTargets.length > designEngineResourcePolicy.maximumFinishTargets ||
    candidate.keepOuts.length > designEngineResourcePolicy.maximumKeepOuts
  ) {
    return failure("RESOURCE_LIMIT", "parse");
  }
  const brief = designBriefSchema.safeParse(candidate.acceptedBrief);
  const systemPolicy = record(candidate.systemPolicy);
  const boundaryTouch = parseBoundaryTouch(systemPolicy?.boundaryTouch);
  const sourceModel = optionSourceModelReferenceSchema.safeParse(candidate.sourceModel);
  const workingModel = optionWorkingModelReferenceSchema.safeParse(candidate.workingModel);
  const sourceSnapshot = canonicalHomeSnapshotSchema.safeParse(candidate.sourceSnapshot);
  const workingSnapshot = canonicalHomeSnapshotSchema.safeParse(candidate.workingSnapshot);
  const facts = candidate.briefConstraintFacts.map(parseBriefFact);
  const finishTargets = candidate.finishTargets.map(parseFinishTarget);
  const keepOuts = candidate.keepOuts.map(parseKeepOut);
  if (
    !brief.success ||
    !sourceModel.success ||
    !workingModel.success ||
    !sourceSnapshot.success ||
    !workingSnapshot.success ||
    systemPolicy === undefined ||
    !hasExactKeys(systemPolicy, ["boundaryTouch", "schemaVersion"]) ||
    boundaryTouch === undefined ||
    systemPolicy.schemaVersion !== deterministicSearchConfigurationVersion ||
    typeof candidate.acceptedBriefContentSha256 !== "string" ||
    !sha256Pattern.test(candidate.acceptedBriefContentSha256) ||
    facts.some((fact) => fact === undefined) ||
    finishTargets.some((target) => target === undefined) ||
    keepOuts.some((keepOut) => keepOut === undefined)
  ) {
    return failure("INVALID_INPUT", "parse");
  }
  const parsedKeepOuts = keepOuts.flatMap((keepOut) => (keepOut === undefined ? [] : [keepOut]));
  if (new Set(parsedKeepOuts.map(({ id }) => id)).size !== parsedKeepOuts.length) {
    return failure("INVALID_INPUT", "parse");
  }
  const parsed: DeterministicDesignConstraintRequest = {
    acceptedBrief: brief.data,
    acceptedBriefContentSha256: candidate.acceptedBriefContentSha256,
    briefConstraintFacts: facts.flatMap((fact) => (fact === undefined ? [] : [fact])),
    finishTargets: finishTargets.flatMap((target) => (target === undefined ? [] : [target])),
    keepOuts: parsedKeepOuts,
    sourceModel: sourceModel.data,
    sourceSnapshot: sourceSnapshot.data,
    systemPolicy: {
      boundaryTouch,
      schemaVersion: deterministicSearchConfigurationVersion,
    },
    workingModel: workingModel.data,
    workingSnapshot: workingSnapshot.data,
  };
  return parsed;
}

export function parseFailure(
  code: DesignEngineAbstentionCode,
  stage: DeterministicDesignEngineFailure["abstention"]["stage"],
): DeterministicDesignEngineFailure {
  return failure(code, stage);
}
