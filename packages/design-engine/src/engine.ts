import {
  c12OperationBundleSchemaVersion,
  optionOperationBundleSchema,
  type CanonicalHomeSnapshot,
  type DesignConstraint,
  type InteriorAssetRef,
  type ModelOperationRequest,
  type OptionOperationBundle,
} from "@interior-design/contracts";
import { reduceModelOperations } from "@interior-design/model-operations";

import {
  canonicalJson,
  compareStrings,
  deterministicUuid,
  seedFromSha256,
  sha256Canonical,
} from "./canonical.js";
import { completePairwiseMatrix, paretoFrontier, selectDiverseCandidates } from "./diversity.js";
import {
  normalizedRotationMilliDegrees,
  polygonContainsPolygon,
  polygonsOverlap,
  convexPolygonsOverlap,
  rotatedRectangle,
  validateAndScalePolygon,
  type ClearanceBySideMm,
  type ScaledPolygon,
} from "./geometry.js";
import { parseDesignEngineRequest, parseFailure } from "./parse.js";
import { deriveDeterministicDesignConstraints, validateConstraintContext } from "./preflight.js";
import {
  designEngineResourcePolicy,
  deterministicLayoutEngineVersion,
  type CandidateEvaluationArtifacts,
  type CandidateRejectionSummary,
  type DesignCandidateDeclaration,
  type DesignCandidateTemplate,
  type DeterministicDesignConstraintRequest,
  type DesignEngineAbstentionCode,
  type DeterministicDesignEngineFailure,
  type DeterministicDesignEngineResult,
  type ParsedDesignEngineRequest,
} from "./types.js";

type CandidateRejectionCode = CandidateRejectionSummary["code"];
type ConstraintResult = OptionOperationBundle["constraintResults"][number];

interface GeometryEnvelope {
  readonly clearance: ScaledPolygon;
  readonly elementId: string;
  readonly levelId: string;
  readonly physical: ScaledPolygon;
}

interface CandidateEvaluationFailure {
  readonly code: CandidateRejectionCode;
  readonly ok: false;
}

interface CandidateEvaluationSuccess extends CandidateEvaluationArtifacts {
  readonly ok: true;
}

type CandidateEvaluation = CandidateEvaluationFailure | CandidateEvaluationSuccess;

function candidateFailure(code: CandidateRejectionCode): CandidateEvaluationFailure {
  return { code, ok: false };
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

type CanonicalElement =
  CanonicalHomeSnapshot["elements"][keyof CanonicalHomeSnapshot["elements"]][number];

function exactAssetBinding(
  operation: Extract<
    ModelOperationRequest,
    { readonly type: "design.element.create.v1" | "design.element.replace.v1" }
  >,
  asset: InteriorAssetRef,
): boolean {
  const binding = operation.assetBinding;
  return (
    binding.assetId === asset.id &&
    binding.assetVersionId === asset.versionId &&
    binding.contentSha256 === asset.contentSha256 &&
    binding.metadataSha256 === asset.metadataSha256 &&
    binding.placementPolicySha256 === asset.placementPolicy.policySha256 &&
    binding.rightsRecordSha256 === asset.rights.rightsRecordSha256
  );
}

function operationForElement(
  template: DesignCandidateTemplate,
  elementId: string,
):
  | Extract<
      ModelOperationRequest,
      { readonly type: "design.element.create.v1" | "design.element.replace.v1" }
    >
  | undefined {
  return template.operations.find(
    (
      operation,
    ): operation is Extract<
      ModelOperationRequest,
      { readonly type: "design.element.create.v1" | "design.element.replace.v1" }
    > =>
      (operation.type === "design.element.create.v1" ||
        operation.type === "design.element.replace.v1") &&
      operation.element.id === elementId,
  );
}

function candidateClearance(
  request: ParsedDesignEngineRequest,
  elementId: string,
  asset: InteriorAssetRef | undefined,
): ClearanceBySideMm {
  const clearance =
    asset === undefined
      ? { back: 0, front: 0, left: 0, right: 0 }
      : { ...asset.placementPolicy.clearanceMm };
  request.briefConstraintFacts.forEach((fact) => {
    if (fact.kind !== "minimum-clearance" || !fact.assetElementIds.includes(elementId)) return;
    if (fact.scope === "front-access")
      clearance.front = Math.max(clearance.front, fact.clearanceMm);
    else {
      clearance.back = Math.max(clearance.back, fact.clearanceMm);
      clearance.front = Math.max(clearance.front, fact.clearanceMm);
      clearance.left = Math.max(clearance.left, fact.clearanceMm);
      clearance.right = Math.max(clearance.right, fact.clearanceMm);
    }
  });
  return clearance;
}

function validateAssetOperations(
  request: ParsedDesignEngineRequest,
  template: DesignCandidateTemplate,
  candidateSnapshot: CanonicalHomeSnapshot,
):
  | CandidateEvaluationFailure
  | {
      readonly assetsByElement: ReadonlyMap<string, InteriorAssetRef>;
      readonly ok: true;
    } {
  const assetsByVersion = new Map(request.assets.map((asset) => [asset.versionId, asset]));
  const assetsByElement = new Map<string, InteriorAssetRef>();
  const createOrReplace = template.operations.filter(
    (
      operation,
    ): operation is Extract<
      ModelOperationRequest,
      { readonly type: "design.element.create.v1" | "design.element.replace.v1" }
    > =>
      operation.type === "design.element.create.v1" ||
      operation.type === "design.element.replace.v1",
  );
  if (createOrReplace.length !== template.assetPlacements.length) {
    return candidateFailure("ASSET_BINDING_INVALID");
  }
  const elements = new Map(allElements(candidateSnapshot).map((element) => [element.id, element]));
  const finishTargets = new Map(
    request.finishTargets.map((target) => [target.targetElementId, new Set(target.allowedFaces)]),
  );
  for (const placement of template.assetPlacements) {
    const operation = operationForElement(template, placement.elementId);
    const asset = assetsByVersion.get(placement.assetVersionId);
    if (operation === undefined || asset === undefined || !exactAssetBinding(operation, asset)) {
      return candidateFailure("ASSET_BINDING_INVALID");
    }
    if (
      (operation.element.elementType === "furnishing" && asset.kind !== "furnishing") ||
      (operation.element.elementType === "finish" && asset.kind !== "finish") ||
      (operation.element.elementType === "light" && asset.kind !== "light")
    ) {
      return candidateFailure("ASSET_BINDING_INVALID");
    }
    assetsByElement.set(operation.element.id, asset);
    switch (operation.element.elementType) {
      case "furnishing": {
        const dimensions = knownValue(operation.element.dimensions);
        const position = knownValue(operation.element.placement.position);
        const rotation = knownValue(operation.element.placement.rotationMilliDegrees);
        if (
          dimensions === undefined ||
          position === undefined ||
          rotation === undefined ||
          dimensions.widthMm !== asset.geometryEnvelopeMm.widthMm ||
          dimensions.depthMm !== asset.geometryEnvelopeMm.depthMm ||
          dimensions.heightMm !== asset.geometryEnvelopeMm.heightMm ||
          placement.spaceId === undefined ||
          !asset.placementPolicy.allowedRotationMilliDegrees.includes(
            normalizedRotationMilliDegrees(rotation),
          )
        ) {
          return candidateFailure("ASSET_BINDING_INVALID");
        }
        const space = candidateSnapshot.elements.spaces.find(({ id }) => id === placement.spaceId);
        if (space?.levelId !== operation.element.levelId) {
          return candidateFailure("CONTAINMENT");
        }
        break;
      }
      case "finish": {
        const allowed = finishTargets.get(operation.element.targetElementId);
        if (
          allowed === undefined ||
          !allowed.has(operation.element.face) ||
          !elements.has(operation.element.targetElementId)
        ) {
          return candidateFailure("FINISH_TARGET_INVALID");
        }
        break;
      }
      case "light":
        if (knownValue(operation.element.position) === undefined) {
          return candidateFailure("ASSET_BINDING_INVALID");
        }
        break;
    }
  }
  return { assetsByElement, ok: true };
}

function elementGeometry(
  request: ParsedDesignEngineRequest,
  snapshot: CanonicalHomeSnapshot,
  assetsByElement: ReadonlyMap<string, InteriorAssetRef>,
):
  | CandidateEvaluationFailure
  | { readonly envelopes: readonly GeometryEnvelope[]; readonly ok: true } {
  const envelopes: GeometryEnvelope[] = [];
  for (const furnishing of snapshot.elements.furnishings) {
    const dimensions = knownValue(furnishing.dimensions);
    const position = knownValue(furnishing.placement.position);
    const rotation = knownValue(furnishing.placement.rotationMilliDegrees);
    if (dimensions === undefined || position === undefined || rotation === undefined) {
      return candidateFailure("HARD_CONSTRAINT_FAILED");
    }
    const asset = assetsByElement.get(furnishing.id);
    const clearance = candidateClearance(request, furnishing.id, asset);
    envelopes.push({
      clearance: rotatedRectangle(
        position,
        dimensions.widthMm,
        dimensions.depthMm,
        rotation,
        clearance,
      ),
      elementId: furnishing.id,
      levelId: furnishing.levelId,
      physical: rotatedRectangle(position, dimensions.widthMm, dimensions.depthMm, rotation),
    });
  }
  for (const fixed of snapshot.elements.fixedObjects) {
    const dimensions = knownValue(fixed.dimensions);
    const position = knownValue(fixed.placement.position);
    const rotation = knownValue(fixed.placement.rotationMilliDegrees);
    if (dimensions === undefined || position === undefined || rotation === undefined) {
      return candidateFailure("HARD_CONSTRAINT_FAILED");
    }
    const physical = rotatedRectangle(position, dimensions.widthMm, dimensions.depthMm, rotation);
    envelopes.push({
      clearance: physical,
      elementId: fixed.id,
      levelId: fixed.levelId,
      physical,
    });
  }
  return { envelopes, ok: true };
}

function validateVerticalFit(
  snapshot: CanonicalHomeSnapshot,
  assetsByElement: ReadonlyMap<string, InteriorAssetRef>,
): boolean {
  const levels = new Map(snapshot.elements.levels.map((level) => [level.id, level]));
  for (const [elementId, asset] of assetsByElement) {
    if (asset.kind === "finish") continue;
    const furnishing = snapshot.elements.furnishings.find(({ id }) => id === elementId);
    const light = snapshot.elements.lights.find(({ id }) => id === elementId);
    const level = levels.get(furnishing?.levelId ?? light?.levelId ?? "");
    const position =
      furnishing === undefined
        ? light === undefined
          ? undefined
          : knownValue(light.position)
        : knownValue(furnishing.placement.position);
    const elevation = level === undefined ? undefined : knownValue(level.elevationMm);
    const height = level === undefined ? undefined : knownValue(level.storeyHeightMm);
    if (
      position === undefined ||
      elevation === undefined ||
      height === undefined ||
      position.zMm < elevation ||
      position.zMm + asset.geometryEnvelopeMm.heightMm > elevation + height
    ) {
      return false;
    }
  }
  return true;
}

function roomPolygons(snapshot: CanonicalHomeSnapshot):
  | CandidateEvaluationFailure
  | {
      readonly ok: true;
      readonly rooms: ReadonlyMap<string, ScaledPolygon>;
    } {
  const rooms = new Map<string, ScaledPolygon>();
  for (const space of snapshot.elements.spaces) {
    const boundary = knownValue(space.boundary);
    if (boundary === undefined) return candidateFailure("HARD_CONSTRAINT_FAILED");
    const parsed = validateAndScalePolygon(
      boundary,
      designEngineResourcePolicy.maximumPolygonVertices,
    );
    if (!parsed.ok) return candidateFailure("HARD_CONSTRAINT_FAILED");
    rooms.set(space.id, parsed.polygon);
  }
  return { ok: true, rooms };
}

function validateSpatialHardConstraints(
  request: ParsedDesignEngineRequest,
  template: DesignCandidateTemplate,
  snapshot: CanonicalHomeSnapshot,
  assetsByElement: ReadonlyMap<string, InteriorAssetRef>,
  keepOutPolygons: ReadonlyMap<string, ScaledPolygon>,
):
  | CandidateEvaluationFailure
  | {
      readonly collisionPassed: boolean;
      readonly containmentPassed: ReadonlySet<string>;
      readonly keepOutPassed: boolean;
    } {
  const geometry = elementGeometry(request, snapshot, assetsByElement);
  const rooms = roomPolygons(snapshot);
  if (!geometry.ok) return geometry;
  if (!rooms.ok) return rooms;
  const byId = new Map(geometry.envelopes.map((entry) => [entry.elementId, entry]));
  const containmentPassed = new Set<string>();
  for (const placement of template.assetPlacements) {
    const asset = assetsByElement.get(placement.elementId);
    if (asset?.kind !== "furnishing") continue;
    const envelope = byId.get(placement.elementId);
    const room = placement.spaceId === undefined ? undefined : rooms.rooms.get(placement.spaceId);
    if (
      envelope === undefined ||
      room === undefined ||
      !polygonContainsPolygon(room, envelope.clearance, request.configuration.boundaryTouch.room)
    ) {
      return candidateFailure("CONTAINMENT");
    }
    containmentPassed.add(placement.elementId);
  }
  const commonClearanceIds = new Set(
    request.briefConstraintFacts.flatMap((fact) =>
      fact.kind === "minimum-clearance" ? fact.assetElementIds : [],
    ),
  );
  for (const elementId of commonClearanceIds) {
    const envelope = byId.get(elementId);
    const contained =
      envelope !== undefined &&
      request.workingSnapshot.elements.spaces
        .filter(({ levelId }) => levelId === envelope.levelId)
        .some((space) => {
          const room = rooms.rooms.get(space.id);
          return (
            room !== undefined &&
            polygonContainsPolygon(
              room,
              envelope.clearance,
              request.configuration.boundaryTouch.room,
            )
          );
        });
    if (!contained) return candidateFailure("CONTAINMENT");
    containmentPassed.add(elementId);
  }
  for (let leftIndex = 0; leftIndex < geometry.envelopes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < geometry.envelopes.length; rightIndex += 1) {
      const left = geometry.envelopes[leftIndex];
      const right = geometry.envelopes[rightIndex];
      if (left === undefined || right === undefined || left.levelId !== right.levelId) continue;
      if (
        convexPolygonsOverlap(
          left.physical,
          right.physical,
          request.configuration.boundaryTouch.obstacle,
        ) ||
        ((assetsByElement.has(left.elementId) ||
          request.briefConstraintFacts.some(
            (fact) =>
              fact.kind === "minimum-clearance" && fact.assetElementIds.includes(left.elementId),
          )) &&
          convexPolygonsOverlap(
            left.clearance,
            right.physical,
            request.configuration.boundaryTouch.obstacle,
          )) ||
        ((assetsByElement.has(right.elementId) ||
          request.briefConstraintFacts.some(
            (fact) =>
              fact.kind === "minimum-clearance" && fact.assetElementIds.includes(right.elementId),
          )) &&
          convexPolygonsOverlap(
            right.clearance,
            left.physical,
            request.configuration.boundaryTouch.obstacle,
          ))
      ) {
        return candidateFailure("COLLISION");
      }
    }
  }
  for (const envelope of geometry.envelopes) {
    if (!assetsByElement.has(envelope.elementId)) continue;
    for (const keepOut of request.keepOuts) {
      const polygon = keepOutPolygons.get(keepOut.id);
      if (
        polygon !== undefined &&
        envelope.levelId === keepOut.levelId &&
        polygonsOverlap(envelope.physical, polygon, request.configuration.boundaryTouch.keepOut)
      ) {
        return candidateFailure("KEEP_OUT");
      }
    }
  }
  return { collisionPassed: true, containmentPassed, keepOutPassed: true };
}

function centreOfElement(
  snapshot: CanonicalHomeSnapshot,
  elementId: string,
): { readonly xMm: number; readonly yMm: number } | undefined {
  const furnishing = snapshot.elements.furnishings.find(({ id }) => id === elementId);
  if (furnishing !== undefined) return knownValue(furnishing.placement.position);
  const fixed = snapshot.elements.fixedObjects.find(({ id }) => id === elementId);
  if (fixed !== undefined) return knownValue(fixed.placement.position);
  const light = snapshot.elements.lights.find(({ id }) => id === elementId);
  if (light !== undefined) return knownValue(light.position);
  return undefined;
}

function constraintResults(
  constraints: readonly DesignConstraint[],
  snapshot: CanonicalHomeSnapshot,
  spatial: {
    readonly collisionPassed: boolean;
    readonly containmentPassed: ReadonlySet<string>;
    readonly keepOutPassed: boolean;
  },
): readonly ConstraintResult[] | undefined {
  const present = new Set(allElements(snapshot).map(({ id }) => id));
  const results: ConstraintResult[] = [];
  for (const constraint of constraints) {
    switch (constraint.kind) {
      case "space-containment": {
        if (!constraint.assetElementIds.every((id) => present.has(id))) return undefined;
        const passed = constraint.assetElementIds.every((id) => spatial.containmentPassed.has(id));
        results.push({
          constraintId: constraint.id,
          detail: "The exact clearance footprint was tested against the complete room polygon.",
          passed,
          strength: constraint.strength,
        });
        break;
      }
      case "minimum-clearance": {
        if (!constraint.assetElementIds.every((id) => present.has(id))) return undefined;
        const passed =
          spatial.collisionPassed &&
          constraint.assetElementIds.every((id) => spatial.containmentPassed.has(id));
        results.push({
          constraintId: constraint.id,
          detail: "The exact clearance envelope passed room containment and collision testing.",
          passed,
          strength: constraint.strength,
          thresholdValue: constraint.clearanceMm,
        });
        break;
      }
      case "no-overlap":
        if (!constraint.assetElementIds.every((id) => present.has(id))) return undefined;
        results.push({
          constraintId: constraint.id,
          detail: "All applicable furnishing and fixed-object footprints were pairwise tested.",
          passed: spatial.collisionPassed,
          strength: constraint.strength,
        });
        break;
      case "keep-out-polygon":
        results.push({
          constraintId: constraint.id,
          detail: "Every proposed furnishing footprint was tested against this keep-out polygon.",
          passed: spatial.keepOutPassed,
          strength: constraint.strength,
        });
        break;
      case "retain-element": {
        const retained = allElements(snapshot).find(
          ({ id }) => id === constraint.retainedElementId,
        );
        const passed =
          retained !== undefined && sha256Canonical(retained) === constraint.expectedElementSha256;
        results.push({
          constraintId: constraint.id,
          detail: "The retained canonical element hash was compared exactly.",
          passed,
          strength: constraint.strength,
        });
        break;
      }
      case "adjacency-objective": {
        const left = centreOfElement(snapshot, constraint.assetElementId);
        const right = centreOfElement(snapshot, constraint.targetElementId);
        if (left === undefined || right === undefined) return undefined;
        const distance = Math.abs(left.xMm - right.xMm) + Math.abs(left.yMm - right.yMm);
        results.push({
          constraintId: constraint.id,
          detail: "Manhattan proximity is an explicit deterministic objective proxy.",
          measuredValue: distance,
          passed: distance <= constraint.maximumDistanceMm,
          strength: constraint.strength,
          thresholdValue: constraint.maximumDistanceMm,
        });
        break;
      }
    }
  }
  const sorted = results.sort((left, right) =>
    compareStrings(left.constraintId, right.constraintId),
  );
  if (
    sorted.length !== constraints.length ||
    new Set(sorted.map(({ constraintId }) => constraintId)).size !== constraints.length ||
    sorted.some(({ passed, strength }) => strength === "hard" && !passed)
  ) {
    return undefined;
  }
  return sorted;
}

function semanticOperation(
  operation: ModelOperationRequest,
  template: DesignCandidateTemplate,
): unknown {
  if (operation.type === "design.element.remove.v1") {
    return { target: operation.target, type: operation.type };
  }
  if (
    operation.type !== "design.element.create.v1" &&
    operation.type !== "design.element.replace.v1"
  ) {
    return { type: operation.type };
  }
  const placement = template.assetPlacements.find(
    ({ elementId }) => elementId === operation.element.id,
  );
  const binding = operation.assetBinding;
  const core = {
    asset: {
      assetId: binding.assetId,
      assetVersionId: binding.assetVersionId,
      contentSha256: binding.contentSha256,
      metadataSha256: binding.metadataSha256,
      placementPolicySha256: binding.placementPolicySha256,
      rightsRecordSha256: binding.rightsRecordSha256,
    },
    assignmentKey: placement?.assignmentKey ?? "unbound",
    elementType: operation.element.elementType,
    operationKind: operation.type,
    spaceId: placement?.spaceId ?? null,
  };
  switch (operation.element.elementType) {
    case "furnishing":
      return {
        ...core,
        dimensions: knownValue(operation.element.dimensions) ?? null,
        levelId: operation.element.levelId,
        position: knownValue(operation.element.placement.position) ?? null,
        rotationMilliDegrees: knownValue(operation.element.placement.rotationMilliDegrees) ?? null,
      };
    case "finish":
      return {
        ...core,
        face: operation.element.face,
        targetElementId: operation.element.targetElementId,
      };
    case "light":
      return {
        ...core,
        colourTemperatureKelvin: knownValue(operation.element.colourTemperatureKelvin) ?? null,
        kind: operation.element.kind,
        levelId: operation.element.levelId,
        luminousFluxLumens: knownValue(operation.element.luminousFluxLumens) ?? null,
        position: knownValue(operation.element.position) ?? null,
      };
  }
}

function templateSearchKey(template: DesignCandidateTemplate): string {
  return sha256Canonical({
    direction: template.direction,
    operations: template.operations.map((operation) => semanticOperation(operation, template)),
  });
}

function candidateTokens(
  template: DesignCandidateTemplate,
  assetsByElement: ReadonlyMap<string, InteriorAssetRef>,
): Omit<CandidateEvaluationArtifacts, "candidate"> {
  const assetInventoryTokens: string[] = [];
  const assignmentTokens: string[] = [];
  const materialTokens: string[] = [];
  const operationSignatures = template.operations.map((operation) =>
    sha256Canonical(semanticOperation(operation, template)),
  );
  const placementsByAssignment = new Map<
    string,
    { readonly rotationMilliDegrees: number; readonly xMm: number; readonly yMm: number }
  >();
  for (const placement of template.assetPlacements) {
    const asset = assetsByElement.get(placement.elementId);
    const operation = operationForElement(template, placement.elementId);
    if (asset === undefined || operation === undefined) continue;
    const identity = `${asset.id}:${asset.versionId}:${asset.contentSha256}`;
    assetInventoryTokens.push(identity);
    assignmentTokens.push(`${placement.assignmentKey}:${identity}:${placement.spaceId ?? ""}`);
    materialTokens.push(`${asset.kind}:${asset.metadataSha256}:${asset.contentSha256}`);
    if (operation.element.elementType === "furnishing") {
      const position = knownValue(operation.element.placement.position);
      const rotation = knownValue(operation.element.placement.rotationMilliDegrees);
      if (position !== undefined && rotation !== undefined) {
        placementsByAssignment.set(placement.assignmentKey, {
          rotationMilliDegrees: normalizedRotationMilliDegrees(rotation),
          xMm: position.xMm,
          yMm: position.yMm,
        });
      }
    } else if (operation.element.elementType === "light") {
      const position = knownValue(operation.element.position);
      if (position !== undefined) {
        placementsByAssignment.set(placement.assignmentKey, {
          rotationMilliDegrees: 0,
          xMm: position.xMm,
          yMm: position.yMm,
        });
      }
    }
  }
  return {
    assignmentTokens: assignmentTokens.sort(compareStrings),
    assetInventoryTokens: assetInventoryTokens.sort(compareStrings),
    materialTokens: materialTokens.sort(compareStrings),
    operationSignatures: operationSignatures.sort(compareStrings),
    placementsByAssignment,
  };
}

function evaluateCandidate(
  request: ParsedDesignEngineRequest,
  constraints: readonly DesignConstraint[],
  template: DesignCandidateTemplate,
  keepOutPolygons: ReadonlyMap<string, ScaledPolygon>,
): CandidateEvaluation {
  let reduced: ReturnType<typeof reduceModelOperations>;
  try {
    reduced = reduceModelOperations(request.workingSnapshot, template.operations);
  } catch {
    return candidateFailure("OPERATION_INVALID");
  }
  if (reduced.hasBlockingFindings) return candidateFailure("OPERATION_INVALID");
  const assetValidation = validateAssetOperations(request, template, reduced.snapshot);
  if (!assetValidation.ok) return assetValidation;
  if (!validateVerticalFit(reduced.snapshot, assetValidation.assetsByElement)) {
    return candidateFailure("VERTICAL_FIT");
  }
  const spatial = validateSpatialHardConstraints(
    request,
    template,
    reduced.snapshot,
    assetValidation.assetsByElement,
    keepOutPolygons,
  );
  if (!("containmentPassed" in spatial)) return spatial;
  const results = constraintResults(constraints, reduced.snapshot, spatial);
  if (results === undefined) return candidateFailure("HARD_CONSTRAINT_FAILED");
  const assetPlacements = template.assetPlacements
    .map((placement) => {
      const asset = assetValidation.assetsByElement.get(placement.elementId);
      return asset === undefined
        ? undefined
        : {
            asset,
            elementId: placement.elementId,
            ...(placement.spaceId === undefined ? {} : { spaceId: placement.spaceId }),
          };
    })
    .filter((placement) => placement !== undefined)
    .sort((left, right) => compareStrings(left.elementId, right.elementId));
  const bundlePayload = {
    assetPlacements,
    baseModel: request.workingModel,
    candidateSnapshotSha256: reduced.snapshotSha256,
    constraintResults: results,
    operations: template.operations,
    projectId: request.workingSnapshot.projectId,
    schemaVersion: c12OperationBundleSchemaVersion,
  };
  const bundleIdentitySha256 = sha256Canonical(bundlePayload);
  const id = deterministicUuid("c12-operation-bundle", bundleIdentitySha256);
  const bundleSha256 = sha256Canonical({ ...bundlePayload, id });
  const parsedBundle = optionOperationBundleSchema.safeParse({
    ...bundlePayload,
    bundleSha256,
    id,
  });
  if (!parsedBundle.success) return candidateFailure("OPERATION_INVALID");
  const tokens = candidateTokens(template, assetValidation.assetsByElement);
  const semanticSha256 = sha256Canonical({
    assignmentTokens: tokens.assignmentTokens,
    assetInventoryTokens: tokens.assetInventoryTokens,
    materialTokens: tokens.materialTokens,
    operationSignatures: tokens.operationSignatures,
    placements: [...tokens.placementsByAssignment.entries()].sort(([left], [right]) =>
      compareStrings(left, right),
    ),
  });
  const objectiveVectorSha256 = sha256Canonical(
    template.objectives.map(({ basisPoints, id: objectiveId }) => ({
      basisPoints,
      id: objectiveId,
    })),
  );
  const candidateIdentitySha256 = sha256Canonical({
    bundleSha256,
    objectiveVectorSha256,
    semanticSha256,
  });
  const candidateId = deterministicUuid("c12-design-candidate", candidateIdentitySha256);
  const declarationWithoutHash = {
    candidateId,
    candidateSnapshot: reduced.snapshot,
    direction: template.direction,
    objectiveVectorSha256,
    objectives: template.objectives,
    operationBundle: parsedBundle.data,
    operationSignatureSha256: sha256Canonical(tokens.operationSignatures),
    paretoNonDominated: true as const,
    semanticSha256,
    templateId: template.templateId,
  };
  const candidate: DesignCandidateDeclaration = {
    ...declarationWithoutHash,
    candidateDeclarationSha256: sha256Canonical(declarationWithoutHash),
  };
  return { ...tokens, candidate, ok: true };
}

function summarizeRejections(
  rejections: ReadonlyMap<CandidateRejectionCode, number>,
): readonly CandidateRejectionSummary[] {
  return [...rejections.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((left, right) => compareStrings(left.code, right.code));
}

function deduplicateCandidates(
  candidates: readonly CandidateEvaluationArtifacts[],
): DeterministicDesignEngineFailure | readonly CandidateEvaluationArtifacts[] {
  const groups = new Map<string, CandidateEvaluationArtifacts[]>();
  candidates.forEach((candidate) => {
    const current = groups.get(candidate.candidate.semanticSha256) ?? [];
    groups.set(candidate.candidate.semanticSha256, [...current, candidate]);
  });
  const unique: CandidateEvaluationArtifacts[] = [];
  for (const group of groups.values()) {
    if (new Set(group.map(({ candidate }) => candidate.objectiveVectorSha256)).size > 1) {
      return parseFailure("CONTRADICTORY_REQUIREMENT", "search");
    }
    const selected = [...group].sort((left, right) =>
      compareStrings(
        left.candidate.candidateDeclarationSha256,
        right.candidate.candidateDeclarationSha256,
      ),
    )[0];
    if (selected !== undefined) unique.push(selected);
  }
  return unique.sort((left, right) =>
    compareStrings(left.candidate.candidateId, right.candidate.candidateId),
  );
}

function candidateFailureResult(
  code: DesignEngineAbstentionCode,
  truncated: boolean,
): DeterministicDesignEngineFailure {
  return parseFailure(truncated ? "RESOURCE_LIMIT" : code, "search");
}

function constraintRequest(
  request: ParsedDesignEngineRequest,
): DeterministicDesignConstraintRequest {
  return {
    acceptedBrief: request.acceptedBrief,
    acceptedBriefContentSha256: request.acceptedBriefContentSha256,
    briefConstraintFacts: request.briefConstraintFacts,
    finishTargets: request.finishTargets,
    keepOuts: request.keepOuts,
    sourceModel: request.sourceModel,
    sourceSnapshot: request.sourceSnapshot,
    systemPolicy: {
      boundaryTouch: request.configuration.boundaryTouch,
      schemaVersion: request.configuration.schemaVersion,
    },
    workingModel: request.workingModel,
    workingSnapshot: request.workingSnapshot,
  };
}

function runValidatedDesignEngine(input: unknown): DeterministicDesignEngineResult {
  const parsed = parseDesignEngineRequest(input);
  if ("abstention" in parsed) return parsed;
  const frozenInput = constraintRequest(parsed);
  const derived = deriveDeterministicDesignConstraints(frozenInput);
  if (!derived.ok) return derived;
  const validated = validateConstraintContext(frozenInput);
  if ("abstention" in validated) return validated;
  const request: ParsedDesignEngineRequest = {
    ...parsed,
    sourceSnapshot: validated.request.sourceSnapshot,
    workingSnapshot: validated.request.workingSnapshot,
  };
  const templates = [...request.candidateTemplates].sort((left, right) => {
    const semantic = compareStrings(templateSearchKey(left), templateSearchKey(right));
    return semantic === 0
      ? compareStrings(sha256Canonical(left), sha256Canonical(right))
      : semantic;
  });
  const searchTruncated = templates.length > request.configuration.candidateBudget;
  const evaluatedTemplates = templates.slice(0, request.configuration.candidateBudget);
  const searchRequest = { ...request, candidateTemplates: evaluatedTemplates };
  const assetSetSha256 = sha256Canonical(
    [...request.assets].sort((left, right) => compareStrings(left.versionId, right.versionId)),
  );
  const configurationSha256 = sha256Canonical({
    assetManifestSha256: request.assetManifestSha256,
    assetSetSha256,
    boundaryTouch: request.configuration.boundaryTouch,
    candidateBudget: request.configuration.candidateBudget,
    constraintsSha256: derived.constraintsSha256,
    requestedDirections: [...request.requestedDirections].sort(compareStrings),
    requestedOptionCount: request.requestedOptionCount,
    schemaVersion: request.configuration.schemaVersion,
    workingSnapshotSha256: validated.workingSnapshotSha256,
  });
  const rejections = new Map<CandidateRejectionCode, number>();
  const valid: CandidateEvaluationArtifacts[] = [];
  for (const template of evaluatedTemplates) {
    const evaluated = evaluateCandidate(
      searchRequest,
      derived.constraints,
      template,
      validated.keepOutPolygons,
    );
    if (evaluated.ok) valid.push(evaluated);
    else rejections.set(evaluated.code, (rejections.get(evaluated.code) ?? 0) + 1);
  }
  if (valid.length === 0) {
    return candidateFailureResult("NO_FEASIBLE_CANDIDATE", searchTruncated);
  }
  const unique = deduplicateCandidates(valid);
  if ("abstention" in unique) return unique;
  const frontier = paretoFrontier(unique);
  const selected = selectDiverseCandidates(
    frontier,
    request.requestedDirections,
    request.requestedOptionCount,
  );
  if (selected.length !== request.requestedOptionCount) {
    return candidateFailureResult("NO_FEASIBLE_DIVERSE_SET", searchTruncated);
  }
  const pairwiseDiversity = completePairwiseMatrix(selected);
  const expectedPairs = (selected.length * (selected.length - 1)) / 2;
  if (pairwiseDiversity.length !== expectedPairs) {
    return candidateFailureResult("NO_FEASIBLE_DIVERSE_SET", searchTruncated);
  }
  const providerManifest = {
    adapter: "deterministic-local-design-v1" as const,
    candidateBudget: request.configuration.candidateBudget,
    engineVersion: deterministicLayoutEngineVersion,
    externalNetworkUsed: false as const,
    seed: seedFromSha256(configurationSha256),
  };
  const candidates = selected.map(({ candidate }) => candidate);
  const declarationSha256 = sha256Canonical({
    assetSetSha256,
    candidateDeclarationSha256: candidates.map(
      ({ candidateDeclarationSha256 }) => candidateDeclarationSha256,
    ),
    constraintsSha256: derived.constraintsSha256,
    pairwiseDiversity,
    providerManifest,
  });
  // Canonicalisation here is an explicit final guard against unsupported values in declarations.
  canonicalJson({ candidates, pairwiseDiversity });
  return {
    assetSetSha256,
    candidates,
    constraints: derived.constraints,
    constraintsSha256: derived.constraintsSha256,
    declarationSha256,
    evaluatedCandidateCount: evaluatedTemplates.length,
    ok: true,
    pairwiseDiversity,
    providerManifest,
    rejectionSummary: summarizeRejections(rejections),
    searchTruncated,
  };
}

/**
 * Runs the pure, proposal-only C12 baseline. The input is never mutated. The function performs no
 * I/O and consults no clock, random source, provider, GPU or thread ordering.
 */
export function runDeterministicDesignEngine(input: unknown): DeterministicDesignEngineResult {
  try {
    return runValidatedDesignEngine(input);
  } catch {
    return parseFailure("INVALID_INPUT", "parse");
  }
}
