import {
  modelOperationRequestSchema,
  type DesignAssetBinding,
  type InteriorAssetRef,
  type KnownAttribution,
  type ModelOperationRequest,
} from "@interior-design/contracts";
import {
  InteriorAssetError,
  assetSha256,
  assertBoundedPlainJson,
  deepFreezeAssetValue,
  deterministicC12Uuid,
  safeInteriorAssetDiagnostic,
  validateAssetCatalog,
  type BoundedProxyMetadata,
  type CreatorOwnedAssetRecord,
  type ExactTargetFace,
  type ValidatedAssetCatalog,
} from "@interior-design/interior-assets";

import { parseAndNormalizePlacementRequest } from "./schema.js";
import {
  assetPlacementCandidateSchemaVersion,
  assetPlacementManifestSchemaVersion,
  assetPlacementResourcePolicy,
  deterministicAssetPlacementEngineVersion,
  type AssetPlacementAbstentionCode,
  type AssetPlacementManifest,
  type AssetPlacementProducerPort,
  type AssetPlacementProductionResult,
  type AssetPlacementRequest,
  type AssetPlacementTarget,
  type BoundsMm,
  type DoubledMillimetreBounds,
  type FinishPlacementTarget,
  type FurnishingPlacementTarget,
  type LightPlacementTarget,
  type PlacementCandidate,
  type Point2Mm,
} from "./types.js";

function assetBinding(asset: InteriorAssetRef): DesignAssetBinding {
  return {
    assetId: asset.id,
    assetVersionId: asset.versionId,
    contentSha256: asset.contentSha256,
    metadataSha256: asset.metadataSha256,
    placementPolicySha256: asset.placementPolicy.policySha256,
    rightsRecordSha256: asset.rights.rightsRecordSha256,
  };
}

function known<T>(value: T, attribution: KnownAttribution) {
  return { attribution, knowledge: "known" as const, value };
}

function targetAllowsAsset(target: AssetPlacementTarget, asset: InteriorAssetRef): boolean {
  return target.allowedAssetIds === undefined || target.allowedAssetIds.includes(asset.id);
}

function faceAllowed(metadata: BoundedProxyMetadata, face: ExactTargetFace): boolean {
  const faces: readonly ExactTargetFace[] = metadata.allowedTargetFaces;
  return faces.includes("all") || faces.includes(face);
}

function isCancelled(signal: AbortSignal): boolean {
  return signal.aborted;
}

function rotatedClearanceBounds2Mm(
  asset: InteriorAssetRef,
  anchor: Point2Mm,
  rotationMilliDegrees: number,
): DoubledMillimetreBounds {
  const { depthMm, widthMm } = asset.geometryEnvelopeMm;
  const { back, front, left, right } = asset.placementPolicy.clearanceMm;
  const localCorners = [
    { x2: -widthMm - 2 * left, y2: -depthMm - 2 * back },
    { x2: -widthMm - 2 * left, y2: depthMm + 2 * front },
    { x2: widthMm + 2 * right, y2: -depthMm - 2 * back },
    { x2: widthMm + 2 * right, y2: depthMm + 2 * front },
  ];
  const rotated = localCorners.map(({ x2, y2 }) => {
    switch (rotationMilliDegrees) {
      case 0:
        return { x2, y2 };
      case 90_000:
        return { x2: -y2, y2: x2 };
      case 180_000:
        return { x2: -x2, y2: -y2 };
      case 270_000:
        return { x2: y2, y2: -x2 };
      default:
        throw new InteriorAssetError("ASSET_ROTATIONS_INVALID");
    }
  });
  const xs = rotated.map(({ x2 }) => x2 + anchor.xMm * 2);
  const ys = rotated.map(({ y2 }) => y2 + anchor.yMm * 2);
  return {
    coordinateScale: "two-integer-units-per-millimetre",
    maximumX2Mm: Math.max(...xs),
    maximumY2Mm: Math.max(...ys),
    minimumX2Mm: Math.min(...xs),
    minimumY2Mm: Math.min(...ys),
  };
}

function containedBy(bounds: DoubledMillimetreBounds, target: BoundsMm): boolean {
  return (
    bounds.minimumX2Mm >= target.minimumXMm * 2 &&
    bounds.maximumX2Mm <= target.maximumXMm * 2 &&
    bounds.minimumY2Mm >= target.minimumYMm * 2 &&
    bounds.maximumY2Mm <= target.maximumYMm * 2
  );
}

function overlaps(bounds: DoubledMillimetreBounds, exclusion: BoundsMm): boolean {
  return (
    bounds.minimumX2Mm < exclusion.maximumXMm * 2 &&
    bounds.maximumX2Mm > exclusion.minimumXMm * 2 &&
    bounds.minimumY2Mm < exclusion.maximumYMm * 2 &&
    bounds.maximumY2Mm > exclusion.minimumYMm * 2
  );
}

function elementAndOperationId(
  request: AssetPlacementRequest,
  target: AssetPlacementTarget,
  record: CreatorOwnedAssetRecord,
  suffix: string,
): { elementId: string; operationId: string } {
  const namespace = [
    deterministicAssetPlacementEngineVersion,
    request.seedSha256,
    request.projectId,
    target.targetId,
    record.ref.id,
    record.ref.versionId,
    suffix,
  ].join(":");
  return {
    elementId:
      target.replaceElementId ?? deterministicC12Uuid(`c12:placement-element:${namespace}`),
    operationId: deterministicC12Uuid(`c12:placement-operation:${namespace}`),
  };
}

function createOrReplaceOperation(
  target: AssetPlacementTarget,
  element: Extract<ModelOperationRequest, { type: "design.element.create.v1" }>["element"],
  operationId: string,
  asset: InteriorAssetRef,
): ModelOperationRequest {
  const binding = assetBinding(asset);
  const raw =
    target.replaceElementId === undefined
      ? {
          assetBinding: binding,
          clientOperationId: operationId,
          element,
          reason: "Place a creator-owned synthetic bounded-proxy design candidate.",
          schemaVersion: "c12-design-element-operation-v1" as const,
          type: "design.element.create.v1" as const,
        }
      : {
          assetBinding: binding,
          clientOperationId: operationId,
          element,
          expectedElementId: target.replaceElementId,
          reason:
            "Replace a design element with a creator-owned synthetic bounded-proxy candidate.",
          schemaVersion: "c12-design-element-operation-v1" as const,
          type: "design.element.replace.v1" as const,
        };
  return modelOperationRequestSchema.parse(raw);
}

function finalizeCandidate(
  value: Omit<PlacementCandidate, "candidateSha256" | "schemaVersion">,
): PlacementCandidate {
  const hashable = { ...value, schemaVersion: assetPlacementCandidateSchemaVersion };
  return deepFreezeAssetValue({ ...hashable, candidateSha256: assetSha256(hashable) });
}

function furnishingCandidate(
  request: AssetPlacementRequest,
  target: FurnishingPlacementTarget,
  record: CreatorOwnedAssetRecord,
  anchor: Point2Mm,
  rotationMilliDegrees: number,
): PlacementCandidate | undefined {
  if (record.ref.kind !== "furnishing" || record.metadata.kind !== "furnishing") return undefined;
  if (record.ref.geometryEnvelopeMm.heightMm > target.maximumHeightMm) return undefined;
  const clearanceBounds2Mm = rotatedClearanceBounds2Mm(record.ref, anchor, rotationMilliDegrees);
  if (
    !containedBy(clearanceBounds2Mm, target.boundsMm) ||
    target.exclusionsMm.some((exclusion) => overlaps(clearanceBounds2Mm, exclusion))
  ) {
    return undefined;
  }
  const suffix = `${String(anchor.xMm)}:${String(anchor.yMm)}:${String(rotationMilliDegrees)}`;
  const { elementId, operationId } = elementAndOperationId(request, target, record, suffix);
  const attribution = request.proposalAttribution;
  const element = {
    category: known(record.ref.category, attribution),
    dimensions: known(record.ref.geometryEnvelopeMm, attribution),
    elementType: "furnishing" as const,
    id: elementId,
    levelId: target.levelId,
    name: known(record.metadata.displayName, attribution),
    origin: attribution,
    placement: {
      position: known({ xMm: anchor.xMm, yMm: anchor.yMm, zMm: target.floorZMm }, attribution),
      rotationMilliDegrees: known(rotationMilliDegrees, attribution),
    },
  };
  return finalizeCandidate({
    asset: record.ref,
    clearanceBounds2Mm,
    elementId,
    operation: createOrReplaceOperation(target, element, operationId, record.ref),
    rotationMilliDegrees,
    spaceId: target.spaceId,
    targetId: target.targetId,
  });
}

function finishCandidate(
  request: AssetPlacementRequest,
  target: FinishPlacementTarget,
  record: CreatorOwnedAssetRecord,
): PlacementCandidate | undefined {
  if (record.ref.kind !== "finish" || record.metadata.kind !== "finish") return undefined;
  if (
    !faceAllowed(record.metadata, target.face) ||
    record.metadata.applicationThicknessMm > target.maximumApplicationThicknessMm
  ) {
    return undefined;
  }
  const { elementId, operationId } = elementAndOperationId(request, target, record, target.face);
  const attribution = request.proposalAttribution;
  const element = {
    elementType: "finish" as const,
    face: target.face,
    id: elementId,
    material: known(record.ref.materialLabel, attribution),
    name: known(record.metadata.displayName, attribution),
    origin: attribution,
    targetElementId: target.targetElementId,
  };
  return finalizeCandidate({
    asset: record.ref,
    elementId,
    operation: createOrReplaceOperation(target, element, operationId, record.ref),
    ...(target.spaceId === undefined ? {} : { spaceId: target.spaceId }),
    targetElementId: target.targetElementId,
    targetFace: target.face,
    targetId: target.targetId,
  });
}

function lightCandidate(
  request: AssetPlacementRequest,
  target: LightPlacementTarget,
  record: CreatorOwnedAssetRecord,
): PlacementCandidate | undefined {
  if (record.ref.kind !== "light" || record.metadata.kind !== "light") return undefined;
  if (
    !faceAllowed(record.metadata, target.mountFace) ||
    record.ref.geometryEnvelopeMm.heightMm > target.maximumEnvelopeHeightMm
  ) {
    return undefined;
  }
  const { elementId, operationId } = elementAndOperationId(
    request,
    target,
    record,
    target.mountFace,
  );
  const attribution = request.proposalAttribution;
  const element = {
    colourTemperatureKelvin: known(record.metadata.colourTemperatureKelvin, attribution),
    elementType: "light" as const,
    id: elementId,
    kind: record.metadata.lightKind,
    levelId: target.levelId,
    luminousFluxLumens: known(record.metadata.luminousFluxLumens, attribution),
    name: known(record.metadata.displayName, attribution),
    origin: attribution,
    position: known(target.positionMm, attribution),
  };
  return finalizeCandidate({
    asset: record.ref,
    elementId,
    operation: createOrReplaceOperation(target, element, operationId, record.ref),
    ...(target.spaceId === undefined ? {} : { spaceId: target.spaceId }),
    targetElementId: target.targetElementId,
    targetFace: target.mountFace,
    targetId: target.targetId,
  });
}

function estimatedEvaluations(
  request: AssetPlacementRequest,
  catalog: ValidatedAssetCatalog,
): number {
  let count = 0;
  for (const target of request.targets) {
    const records = catalog.assets.filter(({ ref }) => targetAllowsAsset(target, ref));
    if (target.kind === "furnishing-zone") {
      count += records
        .filter(({ ref }) => ref.kind === "furnishing")
        .reduce(
          (total, { ref }) =>
            total +
            ref.placementPolicy.allowedRotationMilliDegrees.length * target.anchorPointsMm.length,
          0,
        );
    } else {
      const kind = target.kind === "finish-face" ? "finish" : "light";
      count += records.filter(({ ref }) => ref.kind === kind).length;
    }
    if (count > assetPlacementResourcePolicy.maximumCandidateEvaluations) return count;
  }
  return count;
}

function requestHash(request: AssetPlacementRequest, catalog: ValidatedAssetCatalog): string {
  return assetSha256({
    catalogManifestSha256: catalog.manifestSha256,
    jobId: request.jobId,
    projectId: request.projectId,
    proposalAttribution: request.proposalAttribution,
    requestedMaximumCandidates: request.requestedMaximumCandidates,
    schemaVersion: request.schemaVersion,
    seedSha256: request.seedSha256,
    sourcePins: request.sourcePins,
    targets: request.targets,
  });
}

function createManifest(input: {
  abstentionCode?: AssetPlacementAbstentionCode;
  candidates: readonly PlacementCandidate[];
  catalog: ValidatedAssetCatalog;
  evaluatedCombinations: number;
  request: AssetPlacementRequest;
  requestSha256: string;
}): AssetPlacementManifest {
  const hashable = {
    ...(input.abstentionCode === undefined ? {} : { abstentionCode: input.abstentionCode }),
    candidateLimit: input.request.requestedMaximumCandidates,
    candidateSha256s: input.candidates.map(({ candidateSha256 }) => candidateSha256),
    candidatesProduced: input.candidates.length,
    catalogManifestSha256: input.catalog.manifestSha256,
    engineVersion: deterministicAssetPlacementEngineVersion,
    evaluatedCombinations: input.evaluatedCombinations,
    externalNetworkUsed: false as const,
    requestSha256: input.requestSha256,
    schemaVersion: assetPlacementManifestSchemaVersion,
    status: input.abstentionCode === undefined ? ("produced" as const) : ("abstained" as const),
  };
  return deepFreezeAssetValue({ ...hashable, manifestSha256: assetSha256(hashable) });
}

function hasApplicableAssets(
  request: AssetPlacementRequest,
  catalog: ValidatedAssetCatalog,
): boolean {
  return request.targets.some((target) =>
    catalog.assets.some(({ ref }) => {
      if (!targetAllowsAsset(target, ref)) return false;
      if (target.kind === "furnishing-zone") return ref.kind === "furnishing";
      if (target.kind === "finish-face") return ref.kind === "finish";
      return ref.kind === "light";
    }),
  );
}

async function produceValidated(
  request: AssetPlacementRequest,
  catalog: ValidatedAssetCatalog,
  signal: AbortSignal,
): Promise<AssetPlacementProductionResult> {
  const estimated = estimatedEvaluations(request, catalog);
  if (estimated > assetPlacementResourcePolicy.maximumCandidateEvaluations) {
    return { safeCode: "PLACEMENT_RESOURCE_LIMIT", status: "failed" };
  }
  await Promise.resolve();
  if (isCancelled(signal)) return { safeCode: "PLACEMENT_CANCELLED", status: "cancelled" };
  const candidates: PlacementCandidate[] = [];
  let evaluatedCombinations = 0;
  outer: for (const target of request.targets) {
    for (const record of catalog.assets) {
      if (!targetAllowsAsset(target, record.ref)) continue;
      if (target.kind === "furnishing-zone" && record.ref.kind === "furnishing") {
        for (const anchor of target.anchorPointsMm) {
          for (const rotation of record.ref.placementPolicy.allowedRotationMilliDegrees) {
            evaluatedCombinations += 1;
            const candidate = furnishingCandidate(request, target, record, anchor, rotation);
            if (candidate !== undefined) candidates.push(candidate);
            if (candidates.length >= request.requestedMaximumCandidates) break outer;
          }
        }
      } else if (target.kind === "finish-face" && record.ref.kind === "finish") {
        evaluatedCombinations += 1;
        const candidate = finishCandidate(request, target, record);
        if (candidate !== undefined) candidates.push(candidate);
      } else if (target.kind === "light-point" && record.ref.kind === "light") {
        evaluatedCombinations += 1;
        const candidate = lightCandidate(request, target, record);
        if (candidate !== undefined) candidates.push(candidate);
      }
      if (candidates.length >= request.requestedMaximumCandidates) break outer;
      if (isCancelled(signal)) return { safeCode: "PLACEMENT_CANCELLED", status: "cancelled" };
    }
  }
  const requestSha256 = requestHash(request, catalog);
  if (candidates.length === 0) {
    const safeCode: AssetPlacementAbstentionCode = hasApplicableAssets(request, catalog)
      ? "NO_FEASIBLE_PLACEMENTS"
      : "NO_APPLICABLE_ASSETS";
    return {
      manifest: createManifest({
        abstentionCode: safeCode,
        candidates,
        catalog,
        evaluatedCombinations,
        request,
        requestSha256,
      }),
      safeCode,
      status: "abstained",
    };
  }
  return {
    candidates: deepFreezeAssetValue(candidates),
    manifest: createManifest({
      candidates,
      catalog,
      evaluatedCombinations,
      request,
      requestSha256,
    }),
    status: "produced",
  };
}

export class DeterministicAssetPlacementProducer implements AssetPlacementProducerPort {
  async produce(
    requestInput: unknown,
    signal: AbortSignal,
  ): Promise<AssetPlacementProductionResult> {
    if (isCancelled(signal)) return { safeCode: "PLACEMENT_CANCELLED", status: "cancelled" };
    try {
      assertBoundedPlainJson(requestInput);
      const request = parseAndNormalizePlacementRequest(requestInput);
      if (request === undefined) return { safeCode: "PLACEMENT_INPUT_INVALID", status: "failed" };
      const catalog = validateAssetCatalog(request.catalog);
      return await produceValidated(request, catalog, signal);
    } catch (error) {
      if (isCancelled(signal)) return { safeCode: "PLACEMENT_CANCELLED", status: "cancelled" };
      if (error instanceof InteriorAssetError) {
        return { ...safeInteriorAssetDiagnostic(error), status: "failed" };
      }
      return { safeCode: "PLACEMENT_INTERNAL_FAILURE", status: "failed" };
    }
  }
}

export const deterministicAssetPlacementProducer = new DeterministicAssetPlacementProducer();
