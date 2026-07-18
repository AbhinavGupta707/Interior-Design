import {
  c12DesignConstraintSchemaVersion,
  c12OptionPolicy,
  designConstraintSchema,
  type CanonicalHomeSnapshot,
  type DesignConstraint,
  type InteriorAssetRef,
} from "@interior-design/contracts";

import { compareStrings, deterministicUuid, sha256Canonical, sortedUnique } from "./canonical.js";
import type {
  DerivedConstraintSet,
  DesignEngineAbstention,
  DesignEngineAbstentionCode,
  DesignCandidateTemplate,
  ParsedDesignEngineRequest,
} from "./types.js";

export interface ConstraintDerivationFailure {
  readonly abstention: DesignEngineAbstention;
  readonly ok: false;
}

export interface ConstraintDerivationSuccess extends DerivedConstraintSet {
  readonly ok: true;
}

export type ConstraintDerivationResult = ConstraintDerivationFailure | ConstraintDerivationSuccess;

const professionalCategoryReasons = Object.freeze({
  accessibility: "accessibility-clinical",
  "budget-category": "cost-certainty",
  "disruption-timing": "professional-judgement",
  "professional-review": "professional-judgement",
  sustainability: "professional-judgement",
} as const);

function abstention(
  code: DesignEngineAbstentionCode,
  reasons: readonly DesignEngineAbstention["professionalReviewReasons"][number][] = [],
): ConstraintDerivationFailure {
  const detail =
    code === "CONTRADICTORY_REQUIREMENT"
      ? "Active requirements contradict one another."
      : code === "RESOURCE_LIMIT"
        ? "Derived computational constraints exceed their versioned resource ceiling."
        : "An active hard requirement cannot be proven by this computational engine.";
  return {
    abstention: {
      code,
      detail,
      professionalReviewReasons: [...new Set(reasons)].sort(compareStrings),
      stage: "derive",
    },
    ok: false,
  };
}

function allElements(snapshot: CanonicalHomeSnapshot): readonly { readonly id: string }[] {
  return Object.values(snapshot.elements).flat();
}

function source(
  kind: "accepted-brief" | "canonical-model" | "system-geometry-policy",
  briefEntryIds: readonly string[],
  modelElementIds: readonly string[],
): DesignConstraint["source"] {
  return {
    briefEntryIds: [...sortedUnique(briefEntryIds)],
    kind,
    modelElementIds: [...sortedUnique(modelElementIds)],
  };
}

type WithoutIdentity<TValue> = TValue extends unknown ? Omit<TValue, "id"> : never;
type ConstraintWithoutIdentity = WithoutIdentity<DesignConstraint>;

function constraint(value: ConstraintWithoutIdentity): DesignConstraint {
  const semanticSha256 = sha256Canonical(value);
  const parsed = designConstraintSchema.safeParse({
    ...value,
    id: deterministicUuid("c12-constraint", semanticSha256),
  });
  if (!parsed.success) throw new Error("Derived C12 constraint violates its frozen schema.");
  return parsed.data;
}

function assetForPlacement(
  template: DesignCandidateTemplate,
  elementId: string,
  assetsByVersion: ReadonlyMap<string, InteriorAssetRef>,
): InteriorAssetRef | undefined {
  const placement = template.assetPlacements.find((candidate) => candidate.elementId === elementId);
  return placement === undefined ? undefined : assetsByVersion.get(placement.assetVersionId);
}

function candidatePlacementConstraints(
  request: ParsedDesignEngineRequest,
): readonly DesignConstraint[] {
  const assetsByVersion = new Map(request.assets.map((asset) => [asset.versionId, asset]));
  const constraints: DesignConstraint[] = [];
  for (const template of request.candidateTemplates) {
    const furnishingIds: string[] = [];
    for (const placement of template.assetPlacements) {
      const asset = assetForPlacement(template, placement.elementId, assetsByVersion);
      if (asset?.kind === "finish") {
        const operation = template.operations.find(
          (
            candidate,
          ): candidate is Extract<
            (typeof template.operations)[number],
            { readonly type: "design.element.create.v1" | "design.element.replace.v1" }
          > =>
            (candidate.type === "design.element.create.v1" ||
              candidate.type === "design.element.replace.v1") &&
            candidate.element.id === placement.elementId &&
            candidate.element.elementType === "finish",
        );
        const targetElementId =
          operation?.element.elementType === "finish"
            ? operation.element.targetElementId
            : undefined;
        const target = allElements(request.workingSnapshot).find(
          ({ id }) => id === targetElementId,
        );
        if (target !== undefined && operation?.element.elementType === "finish") {
          constraints.push(
            constraint({
              expectedElementSha256: sha256Canonical(target),
              kind: "retain-element",
              label: "Retain exact valid finish target content",
              retainedElementId: target.id,
              schemaVersion: c12DesignConstraintSchemaVersion,
              source: source("system-geometry-policy", [], [target.id]),
              strength: "hard",
            }),
          );
        }
        continue;
      }
      if (asset?.kind === "light") {
        const operation = template.operations.find(
          (
            candidate,
          ): candidate is Extract<
            (typeof template.operations)[number],
            { readonly type: "design.element.create.v1" | "design.element.replace.v1" }
          > =>
            (candidate.type === "design.element.create.v1" ||
              candidate.type === "design.element.replace.v1") &&
            candidate.element.id === placement.elementId &&
            candidate.element.elementType === "light",
        );
        const levelId =
          operation?.element.elementType === "light" ? operation.element.levelId : undefined;
        const level = request.workingSnapshot.elements.levels.find(({ id }) => id === levelId);
        if (level !== undefined) {
          constraints.push(
            constraint({
              expectedElementSha256: sha256Canonical(level),
              kind: "retain-element",
              label: "Retain exact light host level content",
              retainedElementId: level.id,
              schemaVersion: c12DesignConstraintSchemaVersion,
              source: source("system-geometry-policy", [], [level.id]),
              strength: "hard",
            }),
          );
        }
        continue;
      }
      if (asset?.kind !== "furnishing" || placement.spaceId === undefined) continue;
      furnishingIds.push(placement.elementId);
      constraints.push(
        constraint({
          assetElementIds: [placement.elementId],
          kind: "space-containment",
          label: "Complete clearance footprint inside assigned room",
          schemaVersion: c12DesignConstraintSchemaVersion,
          source: source("system-geometry-policy", [], [placement.spaceId]),
          spaceId: placement.spaceId,
          strength: "hard",
        }),
      );
      const clearances = asset.placementPolicy.clearanceMm;
      constraints.push(
        constraint({
          assetElementIds: [placement.elementId],
          clearanceMm: Math.max(
            clearances.back,
            clearances.front,
            clearances.left,
            clearances.right,
          ),
          kind: "minimum-clearance",
          label: "Exact retained per-side placement-policy clearance",
          schemaVersion: c12DesignConstraintSchemaVersion,
          scope: "all-sides",
          source: source("system-geometry-policy", [], [placement.elementId]),
          strength: "hard",
        }),
      );
    }
    const collidableIds = sortedUnique([
      ...furnishingIds,
      ...request.workingSnapshot.elements.fixedObjects.map(({ id }) => id),
      ...request.workingSnapshot.elements.furnishings.map(({ id }) => id),
    ]);
    for (let offset = 0; offset < collidableIds.length; offset += 50) {
      const group = collidableIds.slice(offset, offset + 50);
      if (group.length < 2) continue;
      constraints.push(
        constraint({
          assetElementIds: group,
          kind: "no-overlap",
          label: "No furnishing or fixed-object footprint overlap",
          schemaVersion: c12DesignConstraintSchemaVersion,
          source: source("system-geometry-policy", [], group),
          strength: "hard",
        }),
      );
    }
  }
  return constraints;
}

export function deriveConstraints(request: ParsedDesignEngineRequest): ConstraintDerivationResult {
  const elements = new Map(
    allElements(request.workingSnapshot).map((element) => [element.id, element]),
  );
  const entries = new Map(request.acceptedBrief.entries.map((entry) => [entry.id, entry]));
  const factsByEntry = new Map<string, typeof request.briefConstraintFacts>();
  request.briefConstraintFacts.forEach((fact) => {
    const current = factsByEntry.get(fact.briefEntryId) ?? [];
    factsByEntry.set(fact.briefEntryId, [...current, fact]);
  });
  if (
    request.acceptedBrief.entries.some(
      ({ classification, status }) =>
        status === "active" && classification === "unresolved-conflict",
    )
  ) {
    return abstention("CONTRADICTORY_REQUIREMENT");
  }
  if (
    request.briefConstraintFacts.some((fact) => {
      const entry = entries.get(fact.briefEntryId);
      return (
        entry === undefined ||
        entry.status !== "active" ||
        (fact.kind !== "adjacency-objective" && entry.classification !== "hard-constraint")
      );
    })
  ) {
    return abstention("CONTRADICTORY_REQUIREMENT");
  }
  const reviewReasons: DesignEngineAbstention["professionalReviewReasons"][number][] = [];
  for (const entry of request.acceptedBrief.entries) {
    if (entry.status !== "active" || entry.classification !== "hard-constraint") continue;
    if (
      factsByEntry
        .get(entry.id)
        ?.some((fact) => fact.kind === "minimum-clearance" || fact.kind === "retain-element") ===
      true
    ) {
      continue;
    }
    if (Object.hasOwn(professionalCategoryReasons, entry.category)) {
      reviewReasons.push(
        professionalCategoryReasons[entry.category as keyof typeof professionalCategoryReasons],
      );
    } else reviewReasons.push("insufficient-evidence");
  }
  if (reviewReasons.length > 0) {
    return abstention("UNSUPPORTED_HARD_REQUIREMENT", reviewReasons);
  }
  const constraints: DesignConstraint[] = [];
  for (const fact of request.briefConstraintFacts) {
    const entry = entries.get(fact.briefEntryId);
    if (entry === undefined) return abstention("CONTRADICTORY_REQUIREMENT");
    switch (fact.kind) {
      case "retain-element": {
        const retained = elements.get(fact.retainedElementId);
        if (retained === undefined) return abstention("CONTRADICTORY_REQUIREMENT");
        constraints.push(
          constraint({
            expectedElementSha256: sha256Canonical(retained),
            kind: "retain-element",
            label: "Retain exact canonical element content",
            retainedElementId: fact.retainedElementId,
            schemaVersion: c12DesignConstraintSchemaVersion,
            source: source("accepted-brief", [entry.id], [fact.retainedElementId]),
            strength: "hard",
          }),
        );
        break;
      }
      case "minimum-clearance":
        if (fact.assetElementIds.some((elementId) => !elements.has(elementId))) {
          const candidateElementIds = new Set(
            request.candidateTemplates.flatMap((template) =>
              template.assetPlacements.map(({ elementId }) => elementId),
            ),
          );
          if (fact.assetElementIds.some((elementId) => !candidateElementIds.has(elementId))) {
            return abstention("CONTRADICTORY_REQUIREMENT");
          }
        }
        constraints.push(
          constraint({
            assetElementIds: [...fact.assetElementIds],
            clearanceMm: fact.clearanceMm,
            kind: fact.kind,
            label: "Typed accepted-brief minimum clearance",
            schemaVersion: c12DesignConstraintSchemaVersion,
            scope: fact.scope,
            source: source("accepted-brief", [entry.id], fact.assetElementIds),
            strength: "hard",
          }),
        );
        break;
      case "adjacency-objective":
        if (!elements.has(fact.targetElementId)) return abstention("CONTRADICTORY_REQUIREMENT");
        constraints.push(
          constraint({
            assetElementId: fact.assetElementId,
            kind: fact.kind,
            label: "Typed accepted-brief adjacency objective",
            maximumDistanceMm: fact.maximumDistanceMm,
            schemaVersion: c12DesignConstraintSchemaVersion,
            source: source(
              "accepted-brief",
              [entry.id],
              [fact.assetElementId, fact.targetElementId],
            ),
            strength: "objective",
            targetElementId: fact.targetElementId,
          }),
        );
        break;
    }
  }
  for (const keepOut of request.keepOuts) {
    constraints.push(
      constraint({
        kind: "keep-out-polygon",
        label: "Explicit immutable keep-out polygon",
        levelId: keepOut.levelId,
        polygon: keepOut.polygon.map((point) => ({ ...point })),
        schemaVersion: c12DesignConstraintSchemaVersion,
        source: source("system-geometry-policy", [], keepOut.sourceElementIds),
        sourceElementIds: [...keepOut.sourceElementIds],
        strength: "hard",
      }),
    );
  }
  constraints.push(...candidatePlacementConstraints(request));
  const unique = new Map(constraints.map((entry) => [entry.id, entry]));
  const sorted = [...unique.values()].sort((left, right) => compareStrings(left.id, right.id));
  if (sorted.length < 1 || sorted.length > c12OptionPolicy.maximumConstraints) {
    return abstention("RESOURCE_LIMIT");
  }
  return { constraints: sorted, constraintsSha256: sha256Canonical(sorted), ok: true };
}
