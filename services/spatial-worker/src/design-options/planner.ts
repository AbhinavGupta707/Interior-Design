import {
  designOptionSchema,
  designOptionSetSchema,
  type CanonicalHomeSnapshot,
  type DesignBrief,
  type DesignOption,
  type DesignOptionSet,
  type KnownAttribution,
} from "@interior-design/contracts";
import {
  deriveDeterministicDesignConstraints,
  deterministicSearchConfigurationVersion,
  runDeterministicDesignEngine,
  type DesignCandidateTemplate,
  type DeterministicDesignEngineSuccess,
} from "@interior-design/design-engine";
import {
  creatorOwnedSyntheticAssetCatalog,
  deterministicC12Uuid,
} from "@interior-design/interior-assets";
import {
  c12Sha256,
  deriveC12SystemPolicy,
  setSha256,
  type LeasedOptionAttempt,
} from "@interior-design/platform-api/design-options";

import { deterministicAssetPlacementProducer } from "../asset-placement/index.js";
import type {
  AssetPlacementTarget,
  PlacementCandidate,
  Point2Mm,
} from "../asset-placement/index.js";

export const c12DesignOptionPlannerVersion = "c12-design-option-planner-v1" as const;
export const c12DesignOptionCandidateBudget = 512;
export const c12BoundaryTouchPolicy = Object.freeze({
  keepOut: "forbid" as const,
  obstacle: "allow" as const,
  room: "allow" as const,
});

type PlannerFailureCode = "CONSTRAINTS_INFEASIBLE" | "RESOURCE_LIMIT" | "SOURCE_CHANGED";

export type DesignOptionPlanningResult =
  | {
      readonly optionSet: DesignOptionSet;
      readonly options: readonly DesignOption[];
      readonly status: "produced";
    }
  | { readonly safeCode: "NO_FEASIBLE_DIVERSE_SET"; readonly status: "abstained" }
  | {
      readonly retryable: boolean;
      readonly safeCode: PlannerFailureCode;
      readonly status: "failed";
    };

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function knownValue<T>(
  value: { readonly knowledge: "known"; readonly value: T } | { readonly knowledge: "unknown" },
): T | undefined {
  return value.knowledge === "known" ? value.value : undefined;
}

function allElements(snapshot: CanonicalHomeSnapshot) {
  return Object.values(snapshot.elements).flat();
}

function proposalEvidenceIds(brief: DesignBrief, snapshot: CanonicalHomeSnapshot): string[] {
  const ids = new Set<string>();
  brief.referenceBoard.forEach(({ assetId }) => {
    ids.add(assetId);
  });
  brief.entries.forEach(({ provenance }) => {
    if (provenance.assetId !== undefined) ids.add(provenance.assetId);
    if (provenance.sourceMessageId !== undefined) ids.add(provenance.sourceMessageId);
    if (provenance.sourceSnapshotId !== undefined) ids.add(provenance.sourceSnapshotId);
  });
  allElements(snapshot).forEach(({ origin }) => {
    origin.evidenceIds.forEach((id) => {
      ids.add(id);
    });
  });
  return [...ids].sort(compareStrings).slice(0, 50);
}

function proposalAttribution(lease: LeasedOptionAttempt): KnownAttribution | undefined {
  const evidenceIds = proposalEvidenceIds(lease.acceptedBrief, lease.workingSnapshot);
  if (evidenceIds.length === 0) return undefined;
  return {
    claimId: deterministicC12Uuid(
      `c12:design-proposal-claim:${lease.job.id}:${String(lease.attempt)}`,
    ),
    confidenceBasisPoints: 7_000,
    evidenceIds,
    method: {
      kind: "system",
      name: "Deterministic C12 design option planner",
      version: c12DesignOptionPlannerVersion,
    },
    state: "inferred",
    verification: { status: "not-reviewed" },
  };
}

function polygonBounds(points: readonly Point2Mm[]) {
  const xs = points.map(({ xMm }) => xMm);
  const ys = points.map(({ yMm }) => yMm);
  return {
    maximumXMm: Math.max(...xs),
    maximumYMm: Math.max(...ys),
    minimumXMm: Math.min(...xs),
    minimumYMm: Math.min(...ys),
  };
}

function uniquePoints(points: readonly Point2Mm[]): Point2Mm[] {
  const byKey = new Map(
    points.map((point) => [`${String(point.xMm)}:${String(point.yMm)}`, point]),
  );
  return [...byKey.values()].sort((left, right) => left.xMm - right.xMm || left.yMm - right.yMm);
}

function anchorPoints(points: readonly Point2Mm[]): Point2Mm[] {
  const bounds = polygonBounds(points);
  const x25 = Math.round((bounds.minimumXMm * 3 + bounds.maximumXMm) / 4);
  const x50 = Math.round((bounds.minimumXMm + bounds.maximumXMm) / 2);
  const x75 = Math.round((bounds.minimumXMm + bounds.maximumXMm * 3) / 4);
  const y25 = Math.round((bounds.minimumYMm * 3 + bounds.maximumYMm) / 4);
  const y50 = Math.round((bounds.minimumYMm + bounds.maximumYMm) / 2);
  const y75 = Math.round((bounds.minimumYMm + bounds.maximumYMm * 3) / 4);
  const vertexAverage = {
    xMm: Math.round(points.reduce((sum, point) => sum + point.xMm, 0) / points.length),
    yMm: Math.round(points.reduce((sum, point) => sum + point.yMm, 0) / points.length),
  };
  return uniquePoints([
    vertexAverage,
    { xMm: x50, yMm: y50 },
    { xMm: x25, yMm: y25 },
    { xMm: x25, yMm: y50 },
    { xMm: x25, yMm: y75 },
    { xMm: x50, yMm: y25 },
    { xMm: x50, yMm: y75 },
    { xMm: x75, yMm: y25 },
    { xMm: x75, yMm: y50 },
    { xMm: x75, yMm: y75 },
  ]);
}

function knownLevels(snapshot: CanonicalHomeSnapshot) {
  return new Map(
    snapshot.elements.levels.flatMap((level) => {
      const elevationMm = knownValue(level.elevationMm);
      const storeyHeightMm = knownValue(level.storeyHeightMm);
      return elevationMm === undefined || storeyHeightMm === undefined
        ? []
        : [[level.id, { elevationMm, storeyHeightMm }] as const];
    }),
  );
}

function assetIds(kind: "finish" | "furnishing" | "light", category?: string): string[] {
  return creatorOwnedSyntheticAssetCatalog.assets
    .filter(({ ref }) => ref.kind === kind && (category === undefined || ref.category === category))
    .map(({ ref }) => ref.id)
    .sort(compareStrings);
}

function placementTargets(snapshot: CanonicalHomeSnapshot): AssetPlacementTarget[] {
  const levels = knownLevels(snapshot);
  const targets: AssetPlacementTarget[] = [];
  const spaces = snapshot.elements.spaces
    .filter((space) => knownValue(space.boundary) !== undefined && levels.has(space.levelId))
    .sort((left, right) => compareStrings(left.id, right.id))
    .slice(0, 4);
  for (const space of spaces) {
    const boundary = knownValue(space.boundary);
    const level = levels.get(space.levelId);
    if (boundary === undefined || level === undefined) continue;
    const bounds = polygonBounds(boundary);
    targets.push({
      allowedAssetIds: assetIds("furnishing"),
      anchorPointsMm: anchorPoints(boundary),
      boundsMm: bounds,
      exclusionsMm: [],
      floorZMm: level.elevationMm,
      kind: "furnishing-zone",
      levelId: space.levelId,
      maximumHeightMm: level.storeyHeightMm,
      spaceId: space.id,
      targetId: deterministicC12Uuid(`c12:furnishing-target:${space.id}`),
    });

    const floor = snapshot.elements.surfaces
      .filter(({ kind, levelId }) => kind === "floor" && levelId === space.levelId)
      .sort((left, right) => compareStrings(left.id, right.id))[0];
    const wall = snapshot.elements.walls
      .filter(({ levelId }) => levelId === space.levelId)
      .sort((left, right) => compareStrings(left.id, right.id))[0];
    if (floor !== undefined) {
      targets.push({
        allowedAssetIds: assetIds("finish", "floor-finish-timber-tone"),
        face: "top",
        kind: "finish-face",
        maximumApplicationThicknessMm: 100,
        spaceId: space.id,
        targetElementId: floor.id,
        targetId: deterministicC12Uuid(`c12:finish-target:${space.id}:${floor.id}:top`),
      });
    } else if (wall !== undefined) {
      targets.push({
        allowedAssetIds: assetIds("finish", "wall-finish-warm-neutral"),
        face: "inside",
        kind: "finish-face",
        maximumApplicationThicknessMm: 100,
        spaceId: space.id,
        targetElementId: wall.id,
        targetId: deterministicC12Uuid(`c12:finish-target:${space.id}:${wall.id}:inside`),
      });
    }

    const ceiling = snapshot.elements.surfaces
      .filter(({ kind, levelId }) => kind === "ceiling" && levelId === space.levelId)
      .sort((left, right) => compareStrings(left.id, right.id))[0];
    const centre = anchorPoints(boundary)[0];
    if (centre !== undefined && ceiling !== undefined) {
      targets.push({
        allowedAssetIds: assetIds("light", "pendant-light"),
        kind: "light-point",
        levelId: space.levelId,
        maximumEnvelopeHeightMm: level.storeyHeightMm,
        mountFace: "bottom",
        positionMm: {
          xMm: centre.xMm,
          yMm: centre.yMm,
          zMm: level.elevationMm + Math.max(0, level.storeyHeightMm - 500),
        },
        spaceId: space.id,
        targetElementId: ceiling.id,
        targetId: deterministicC12Uuid(`c12:light-target:${space.id}:${ceiling.id}:bottom`),
      });
    } else if (centre !== undefined && floor !== undefined) {
      targets.push({
        allowedAssetIds: assetIds("light", "floor-light"),
        kind: "light-point",
        levelId: space.levelId,
        maximumEnvelopeHeightMm: level.storeyHeightMm,
        mountFace: "top",
        positionMm: { xMm: centre.xMm, yMm: centre.yMm, zMm: level.elevationMm },
        spaceId: space.id,
        targetElementId: floor.id,
        targetId: deterministicC12Uuid(`c12:light-target:${space.id}:${floor.id}:top`),
      });
    }
  }
  return targets.slice(0, 64);
}

const primaryObjective = Object.freeze({
  "circulation-first": "circulation",
  "conversation-first": "conversation",
  "daylight-first": "daylight",
  "retention-first": "edit-distance",
  "storage-first": "storage",
} as const);

function furnishingCategory(candidate: PlacementCandidate): string {
  return candidate.asset.category;
}

function categoryPreference(direction: DesignOption["direction"]): readonly string[] {
  switch (direction) {
    case "circulation-first":
      return ["lounge-chair", "coffee-table", "three-seat-sofa", "low-storage-console"];
    case "conversation-first":
      return ["three-seat-sofa", "lounge-chair", "coffee-table", "low-storage-console"];
    case "storage-first":
      return ["low-storage-console", "lounge-chair", "three-seat-sofa", "coffee-table"];
    case "daylight-first":
    case "retention-first":
      return ["lounge-chair", "coffee-table", "low-storage-console", "three-seat-sofa"];
  }
}

function directionCandidates(
  candidates: readonly PlacementCandidate[],
  direction: DesignOption["direction"],
): PlacementCandidate[] {
  const rank = new Map(categoryPreference(direction).map((category, index) => [category, index]));
  return [...candidates].sort((left, right) => {
    const categoryOrder =
      (rank.get(furnishingCategory(left)) ?? 99) - (rank.get(furnishingCategory(right)) ?? 99);
    return categoryOrder || compareStrings(left.candidateSha256, right.candidateSha256);
  });
}

function objectiveVector(
  direction: DesignOption["direction"],
  furnishing: PlacementCandidate,
  operationCount: number,
): DesignOption["objectives"] {
  const envelope = furnishing.asset.geometryEnvelopeMm;
  const footprint = envelope.widthMm * envelope.depthMm;
  const circulation = Math.max(0, Math.min(10_000, 10_000 - Math.round(footprint / 250)));
  const conversation = ["three-seat-sofa", "lounge-chair"].includes(furnishing.asset.category)
    ? furnishing.asset.category === "three-seat-sofa"
      ? 9_000
      : 7_000
    : 3_000;
  const storage = furnishing.asset.category === "low-storage-console" ? 9_000 : 1_000;
  const values = {
    "brief-fit": 0,
    circulation,
    conversation,
    daylight: 0,
    "edit-distance": Math.max(0, 10_000 - operationCount * 1_000),
    "material-coherence": 5_000,
    retention: 10_000,
    storage,
  } as const;
  const rationales = {
    "brief-fit": "No typed preference score is inferred from C11 prose; zero means not measured.",
    circulation:
      "Bounding-proxy footprint reserve; exact containment and collisions are separate hard gates.",
    conversation: "A bounded furnishing-category proxy, not a behavioural guarantee.",
    daylight:
      "No daylight simulation or evidenced proximity metric was available; zero means not measured.",
    "edit-distance": "A deterministic inverse operation-count simplicity proxy.",
    "material-coherence": "A neutral creator-owned synthetic material-set proxy.",
    retention:
      "The option creates proposed elements and does not edit retained canonical geometry.",
    storage: "A bounded category proxy; capacity has not been measured.",
  } as const;
  const primary = primaryObjective[direction];
  return (Object.keys(values) as Array<keyof typeof values>)
    .map((id) => ({
      basisPoints: id === primary ? Math.max(values[id], 1) : values[id],
      id,
      rationale: rationales[id],
    }))
    .sort((left, right) => compareStrings(left.id, right.id));
}

function candidateTemplates(
  lease: LeasedOptionAttempt,
  candidates: readonly PlacementCandidate[],
): DesignCandidateTemplate[] {
  const furnishings = candidates.filter(({ asset }) => asset.kind === "furnishing");
  const finishes = candidates.filter(({ asset }) => asset.kind === "finish");
  const lights = candidates.filter(({ asset }) => asset.kind === "light");
  if (
    furnishings.length < lease.job.requestedDirections.length ||
    finishes.length === 0 ||
    lights.length === 0
  ) {
    return [];
  }
  const templates: DesignCandidateTemplate[] = [];
  const usedFurnishings = new Set<string>();
  for (const direction of [...lease.job.requestedDirections].sort(compareStrings)) {
    const ranked = directionCandidates(furnishings, direction);
    const choices = ranked.filter(({ candidateSha256 }) => !usedFurnishings.has(candidateSha256));
    const primary = choices[0];
    if (primary === undefined) return [];
    usedFurnishings.add(primary.candidateSha256);
    const variants = [primary, ...ranked.filter((candidate) => candidate !== primary).slice(0, 5)];
    variants.forEach((furnishing, variantIndex) => {
      const finish = finishes[variantIndex % finishes.length];
      const light = lights[variantIndex % lights.length];
      if (finish === undefined || light === undefined) return;
      const selected = direction === "retention-first" ? [furnishing] : [furnishing, finish, light];
      const operations = selected.map(({ operation }) => operation);
      templates.push({
        assetPlacements: selected.map((candidate) => ({
          assignmentKey: `${candidate.asset.kind}:${candidate.targetId}`,
          assetVersionId: candidate.asset.versionId,
          elementId: candidate.elementId,
          ...(candidate.spaceId === undefined ? {} : { spaceId: candidate.spaceId }),
        })),
        direction,
        objectives: objectiveVector(direction, furnishing, operations.length),
        operations,
        templateId: deterministicC12Uuid(
          `c12:design-template:${lease.job.id}:${direction}:${String(variantIndex)}:${selected
            .map(({ candidateSha256 }) => candidateSha256)
            .join(":")}`,
        ),
      });
    });
  }
  return templates;
}

function optionCopy(
  lease: LeasedOptionAttempt,
  engine: DeterministicDesignEngineSuccess,
): { readonly optionSet: DesignOptionSet; readonly options: readonly DesignOption[] } {
  const createdAt = lease.job.updatedAt;
  const expiresAt = new Date(Date.parse(createdAt) + 3_600_000).toISOString();
  const options = engine.candidates
    .map((candidate) =>
      designOptionSchema.parse({
        assumptions: [
          "All placed items are creator-owned synthetic bounded proxies, not purchasable products.",
          "Computational validity is limited to the frozen geometry and asset policies.",
        ],
        baseBrief: lease.job.baseBrief,
        createdAt,
        direction: candidate.direction,
        expiresAt,
        id: candidate.candidateId,
        jobId: lease.job.id,
        objectives: candidate.objectives,
        operationBundle: candidate.operationBundle,
        paretoNonDominated: true,
        professionalReview: [
          {
            question:
              "Review construction, compliance, accessibility, cost and procurement implications before implementation.",
            reason: "professional-judgement",
            status: "review-required",
          },
          {
            question:
              "Replace synthetic proxies with verified products and current availability before purchase.",
            reason: "product-availability",
            status: "review-required",
          },
        ],
        projectId: lease.job.projectId,
        providerManifest: engine.providerManifest,
        schemaVersion: "c12-design-option-v1",
        status: "pending",
        summary:
          "A deterministic proposal-only layout using exact bounded proxy operations and explicit review routes.",
        title: `${candidate.direction.replaceAll("-", " ")} option`,
        tradeoffs: [
          "Objective values are deterministic proxies and remain separate rather than an overall quality score.",
        ],
        unknowns: [
          "Structural, regulatory, clinical-accessibility, cost, availability and professional approval are not established.",
          "Human design quality and household comprehension are not measured by this option job.",
        ],
      }),
    )
    .sort((left, right) => compareStrings(left.id, right.id));
  const withoutHash = {
    createdAt,
    jobId: lease.job.id,
    optionIds: options.map(({ id }) => id),
    pairwiseDiversity: [...engine.pairwiseDiversity],
    projectId: lease.job.projectId,
    schemaVersion: "c12-design-option-set-v1" as const,
  };
  const optionSet = designOptionSetSchema.parse({
    ...withoutHash,
    setSha256: setSha256(withoutHash),
  });
  return { optionSet, options };
}

function engineFailure(code: string): DesignOptionPlanningResult {
  if (code === "NO_FEASIBLE_CANDIDATE" || code === "NO_FEASIBLE_DIVERSE_SET") {
    return { safeCode: "NO_FEASIBLE_DIVERSE_SET", status: "abstained" };
  }
  if (code === "RESOURCE_LIMIT" || code === "NUMERIC_RANGE_EXCEEDED") {
    return { retryable: false, safeCode: "RESOURCE_LIMIT", status: "failed" };
  }
  if (code === "SOURCE_PIN_MISMATCH") {
    return { retryable: true, safeCode: "SOURCE_CHANGED", status: "failed" };
  }
  return { retryable: false, safeCode: "CONSTRAINTS_INFEASIBLE", status: "failed" };
}

export async function planDesignOptions(
  lease: LeasedOptionAttempt,
  signal: AbortSignal,
): Promise<DesignOptionPlanningResult> {
  if (lease.job.assetManifestSha256 !== creatorOwnedSyntheticAssetCatalog.manifestSha256) {
    return { retryable: true, safeCode: "SOURCE_CHANGED", status: "failed" };
  }
  const attribution = proposalAttribution(lease);
  if (attribution === undefined) {
    return { retryable: false, safeCode: "CONSTRAINTS_INFEASIBLE", status: "failed" };
  }
  const policy = deriveC12SystemPolicy(lease.workingSnapshot);
  const preflight = deriveDeterministicDesignConstraints({
    acceptedBrief: lease.acceptedBrief,
    acceptedBriefContentSha256: lease.job.baseBrief.contentSha256,
    briefConstraintFacts: policy.briefConstraintFacts,
    finishTargets: policy.finishTargets,
    keepOuts: policy.keepOuts,
    sourceModel: lease.job.sourceModel,
    sourceSnapshot: lease.sourceSnapshot.snapshot,
    systemPolicy: {
      boundaryTouch: c12BoundaryTouchPolicy,
      schemaVersion: deterministicSearchConfigurationVersion,
    },
    workingModel: lease.job.workingModel,
    workingSnapshot: lease.workingSnapshot,
  });
  if (!preflight.ok) return engineFailure(preflight.abstention.code);
  if (
    preflight.constraintsSha256 !== lease.job.constraintsSha256 ||
    c12Sha256(preflight.constraints) !== c12Sha256(lease.constraints)
  ) {
    return { retryable: true, safeCode: "SOURCE_CHANGED", status: "failed" };
  }
  const targets = placementTargets(lease.workingSnapshot);
  if (targets.length === 0) return { safeCode: "NO_FEASIBLE_DIVERSE_SET", status: "abstained" };
  const placement = await deterministicAssetPlacementProducer.produce(
    {
      catalog: creatorOwnedSyntheticAssetCatalog,
      jobId: lease.job.id,
      projectId: lease.job.projectId,
      proposalAttribution: attribution,
      requestedMaximumCandidates: c12DesignOptionCandidateBudget,
      schemaVersion: "c12-asset-placement-request-v1",
      seedSha256: c12Sha256({
        assetManifestSha256: lease.job.assetManifestSha256,
        baseBrief: lease.job.baseBrief,
        constraintsSha256: lease.job.constraintsSha256,
        sourceModel: lease.job.sourceModel,
        workingModel: lease.job.workingModel,
      }),
      sourcePins: {
        acceptedBriefContentSha256: lease.job.baseBrief.contentSha256,
        constraintsSha256: lease.job.constraintsSha256,
        workingSnapshotSha256: lease.job.workingModel.snapshotSha256,
      },
      targets,
    },
    signal,
  );
  if (placement.status === "cancelled") {
    return { retryable: true, safeCode: "SOURCE_CHANGED", status: "failed" };
  }
  if (placement.status === "failed") {
    return placement.safeCode === "PLACEMENT_RESOURCE_LIMIT"
      ? { retryable: false, safeCode: "RESOURCE_LIMIT", status: "failed" }
      : { retryable: false, safeCode: "CONSTRAINTS_INFEASIBLE", status: "failed" };
  }
  if (placement.status === "abstained") {
    return { safeCode: "NO_FEASIBLE_DIVERSE_SET", status: "abstained" };
  }
  const templates = candidateTemplates(lease, placement.candidates);
  if (templates.length === 0) return { safeCode: "NO_FEASIBLE_DIVERSE_SET", status: "abstained" };
  const engine = runDeterministicDesignEngine({
    acceptedBrief: lease.acceptedBrief,
    acceptedBriefContentSha256: lease.job.baseBrief.contentSha256,
    assetManifestSha256: lease.job.assetManifestSha256,
    assets: creatorOwnedSyntheticAssetCatalog.assets.map(({ ref }) => ref),
    briefConstraintFacts: policy.briefConstraintFacts,
    candidateTemplates: templates,
    configuration: {
      boundaryTouch: c12BoundaryTouchPolicy,
      candidateBudget: Math.min(c12DesignOptionCandidateBudget, templates.length),
      schemaVersion: deterministicSearchConfigurationVersion,
    },
    finishTargets: policy.finishTargets,
    keepOuts: policy.keepOuts,
    requestedDirections: lease.job.requestedDirections,
    requestedOptionCount: lease.job.requestedOptionCount,
    sourceModel: lease.job.sourceModel,
    sourceSnapshot: lease.sourceSnapshot.snapshot,
    workingModel: lease.job.workingModel,
    workingSnapshot: lease.workingSnapshot,
  });
  return engine.ok
    ? { ...optionCopy(lease, engine), status: "produced" }
    : engineFailure(engine.abstention.code);
}
