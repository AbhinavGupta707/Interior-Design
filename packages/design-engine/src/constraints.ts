import {
  c12DesignConstraintSchemaVersion,
  c12OptionPolicy,
  designConstraintSchema,
  type CanonicalHomeSnapshot,
  type DesignConstraint,
} from "@interior-design/contracts";

import { compareStrings, deterministicUuid, sha256Canonical, sortedUnique } from "./canonical.js";
import type {
  DerivedConstraintSet,
  DesignEngineAbstention,
  DesignEngineAbstentionCode,
  ParsedDesignConstraintRequest,
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

function hasComputableCentre(snapshot: CanonicalHomeSnapshot, elementId: string): boolean {
  const furnishing = snapshot.elements.furnishings.find(({ id }) => id === elementId);
  if (furnishing !== undefined) return furnishing.placement.position.knowledge === "known";
  const fixed = snapshot.elements.fixedObjects.find(({ id }) => id === elementId);
  if (fixed !== undefined) return fixed.placement.position.knowledge === "known";
  const light = snapshot.elements.lights.find(({ id }) => id === elementId);
  return light?.position.knowledge === "known";
}

function systemRetainedElements(
  request: ParsedDesignConstraintRequest,
): readonly { readonly id: string }[] {
  const candidates = [
    ...request.workingSnapshot.elements.levels,
    ...request.workingSnapshot.elements.spaces,
    ...request.workingSnapshot.elements.fixedObjects,
  ];
  return [...new Map(candidates.map((element) => [element.id, element])).values()].sort(
    (left, right) => compareStrings(left.id, right.id),
  );
}

function systemPolicyLabel(request: ParsedDesignConstraintRequest): string {
  const touch = request.systemPolicy.boundaryTouch;
  return `room:${touch.room};obstacle:${touch.obstacle};keep-out:${touch.keepOut}`;
}

export function deriveConstraints(
  request: ParsedDesignConstraintRequest,
): ConstraintDerivationResult {
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
        if (
          fact.assetElementIds.some(
            (elementId) =>
              !request.workingSnapshot.elements.furnishings.some(({ id }) => id === elementId),
          )
        ) {
          return abstention("UNSUPPORTED_HARD_REQUIREMENT", ["insufficient-evidence"]);
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
        if (
          !hasComputableCentre(request.workingSnapshot, fact.assetElementId) ||
          !hasComputableCentre(request.workingSnapshot, fact.targetElementId)
        ) {
          return abstention("UNSUPPORTED_HARD_REQUIREMENT", ["insufficient-evidence"]);
        }
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
  for (const retained of systemRetainedElements(request)) {
    constraints.push(
      constraint({
        expectedElementSha256: sha256Canonical(retained),
        kind: "retain-element",
        label: `Retain exact common canonical geometry; ${systemPolicyLabel(request)}`,
        retainedElementId: retained.id,
        schemaVersion: c12DesignConstraintSchemaVersion,
        source: source("system-geometry-policy", [], [retained.id]),
        strength: "hard",
      }),
    );
  }
  for (const finishTarget of request.finishTargets) {
    const retained = elements.get(finishTarget.targetElementId);
    if (retained === undefined) return abstention("CONTRADICTORY_REQUIREMENT");
    constraints.push(
      constraint({
        expectedElementSha256: sha256Canonical(retained),
        kind: "retain-element",
        label: `Retain common finish host; allowed faces: ${finishTarget.allowedFaces.join(",")}`,
        retainedElementId: retained.id,
        schemaVersion: c12DesignConstraintSchemaVersion,
        source: source("system-geometry-policy", [], [retained.id]),
        strength: "hard",
      }),
    );
  }
  for (const keepOut of request.keepOuts) {
    constraints.push(
      constraint({
        kind: "keep-out-polygon",
        label: `Explicit immutable keep-out polygon; touch:${request.systemPolicy.boundaryTouch.keepOut}`,
        levelId: keepOut.levelId,
        polygon: keepOut.polygon.map((point) => ({ ...point })),
        schemaVersion: c12DesignConstraintSchemaVersion,
        source: source("system-geometry-policy", [], keepOut.sourceElementIds),
        sourceElementIds: [...keepOut.sourceElementIds],
        strength: "hard",
      }),
    );
  }
  const unique = new Map(constraints.map((entry) => [entry.id, entry]));
  const sorted = [...unique.values()].sort((left, right) => compareStrings(left.id, right.id));
  if (sorted.length < 1 || sorted.length > c12OptionPolicy.maximumConstraints) {
    return abstention("RESOURCE_LIMIT");
  }
  return { constraints: sorted, constraintsSha256: sha256Canonical(sorted), ok: true };
}
