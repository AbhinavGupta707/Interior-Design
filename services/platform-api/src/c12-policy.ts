import type { CanonicalHomeSnapshot } from "@interior-design/contracts";
import type {
  BriefConstraintFact,
  FinishTargetDeclaration,
  KeepOutDeclaration,
} from "@interior-design/design-engine";

export interface C12SystemPolicyInputs {
  readonly briefConstraintFacts: readonly BriefConstraintFact[];
  readonly finishTargets: readonly FinishTargetDeclaration[];
  readonly keepOuts: readonly KeepOutDeclaration[];
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function surfaceFaces(
  kind: CanonicalHomeSnapshot["elements"]["surfaces"][number]["kind"],
): FinishTargetDeclaration["allowedFaces"] {
  switch (kind) {
    case "floor":
      return ["top"];
    case "ceiling":
      return ["bottom"];
    case "roof":
    case "slab":
      return ["bottom", "top"];
    case "wall-face":
      return ["inside", "outside"];
    case "other":
      return ["all"];
  }
}

/**
 * Derives only facts that are explicit in the canonical model and frozen system policy.
 *
 * C11 prose is never converted into geometry here. The current canonical model has no typed
 * keep-out primitive, so this adapter returns none instead of inferring door swings, circulation
 * zones or regulatory clearances. Those can be added only through a future typed evidence-backed
 * contract. Candidate collision, containment, asset clearance and vertical fit remain mandatory
 * checks inside the deterministic design engine.
 */
export function deriveC12SystemPolicy(snapshot: CanonicalHomeSnapshot): C12SystemPolicyInputs {
  const finishTargets: FinishTargetDeclaration[] = [
    ...snapshot.elements.walls.map(({ id }) => ({
      allowedFaces: ["inside", "outside"] as const,
      targetElementId: id,
    })),
    ...snapshot.elements.surfaces.map(({ id, kind }) => ({
      allowedFaces: surfaceFaces(kind),
      targetElementId: id,
    })),
  ];
  finishTargets.sort((left, right) => compareStrings(left.targetElementId, right.targetElementId));

  return Object.freeze({
    briefConstraintFacts: Object.freeze([]),
    finishTargets: Object.freeze(finishTargets),
    keepOuts: Object.freeze([]),
  });
}
