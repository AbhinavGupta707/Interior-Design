import type { DesignOption, ModelOperationRequest } from "@interior-design/contracts";

export const optionDirectionLabels = Object.freeze({
  "circulation-first": "Circulation first",
  "conversation-first": "Conversation first",
  "daylight-first": "Daylight first",
  "retention-first": "Retention first",
  "storage-first": "Storage first",
} as const);

export const optionStageLabels = Object.freeze({
  complete: "Complete",
  "deriving-constraints": "Deriving constraints",
  generating: "Generating bounded candidates",
  publishing: "Publishing validated options",
  queued: "Queued",
  validating: "Validating hard constraints",
} as const);

export const optionSafeCodeCopy = Object.freeze({
  BRIEF_NOT_ACCEPTED: "The brief is not accepted.",
  CONSTRAINTS_INFEASIBLE: "The active constraints are computationally infeasible.",
  INTERNAL_FAILURE: "The local option service failed safely.",
  MODEL_NOT_PROPOSED: "A proposed working model could not be established.",
  NO_FEASIBLE_DIVERSE_SET: "No complete, genuinely different valid option set was found.",
  RESOURCE_LIMIT: "The bounded candidate or resource limit was reached.",
  SOURCE_CHANGED: "The accepted brief or source model changed.",
} as const);

function knownValue(value: unknown): unknown {
  if (typeof value !== "object" || value === null || !("knowledge" in value)) return undefined;
  const attributed = value as { readonly knowledge?: unknown; readonly value?: unknown };
  return attributed.knowledge === "known" ? attributed.value : "unknown";
}

function semanticOperation(operation: ModelOperationRequest): string {
  if (operation.type === "design.element.remove.v1") {
    return `remove:${operation.target.collection}:${operation.target.elementId}`;
  }
  if (
    operation.type !== "design.element.create.v1" &&
    operation.type !== "design.element.replace.v1"
  ) {
    return operation.type;
  }
  const action = operation.type === "design.element.create.v1" ? "create" : "replace";
  const replacementTarget =
    operation.type === "design.element.replace.v1" ? operation.expectedElementId : "new";
  const element = operation.element;
  const binding = operation.assetBinding.assetVersionId;
  if (element.elementType === "furnishing") {
    return JSON.stringify([
      action,
      replacementTarget,
      binding,
      element.elementType,
      element.levelId,
      knownValue(element.category),
      knownValue(element.dimensions),
      knownValue(element.placement.position),
      knownValue(element.placement.rotationMilliDegrees),
    ]);
  }
  if (element.elementType === "finish") {
    return JSON.stringify([
      action,
      replacementTarget,
      binding,
      element.elementType,
      element.targetElementId,
      element.face,
      knownValue(element.material),
    ]);
  }
  return JSON.stringify([
    action,
    replacementTarget,
    binding,
    element.elementType,
    element.levelId,
    element.kind,
    knownValue(element.position),
    knownValue(element.colourTemperatureKelvin),
    knownValue(element.luminousFluxLumens),
  ]);
}

function sortedSignature(values: readonly string[]): string {
  return [...values].sort((left, right) => left.localeCompare(right)).join("\n");
}

function placementSignature(option: DesignOption): string {
  return sortedSignature(
    option.operationBundle.operations.flatMap((operation) => {
      if (
        operation.type !== "design.element.create.v1" &&
        operation.type !== "design.element.replace.v1"
      ) {
        return [];
      }
      const element = operation.element;
      if (element.elementType === "furnishing") {
        return [
          JSON.stringify([
            operation.assetBinding.assetVersionId,
            element.levelId,
            knownValue(element.placement.position),
            knownValue(element.placement.rotationMilliDegrees),
            knownValue(element.dimensions),
          ]),
        ];
      }
      if (element.elementType === "light") {
        return [
          JSON.stringify([
            operation.assetBinding.assetVersionId,
            element.levelId,
            knownValue(element.position),
          ]),
        ];
      }
      return [];
    }),
  );
}

function materialSignature(option: DesignOption): string {
  const materials = option.operationBundle.assetPlacements.map(
    ({ asset }) => `${asset.kind}:${asset.materialLabel}:${asset.versionId}`,
  );
  for (const operation of option.operationBundle.operations) {
    if (
      (operation.type === "design.element.create.v1" ||
        operation.type === "design.element.replace.v1") &&
      operation.element.elementType === "finish"
    ) {
      materials.push(
        `finish:${operation.element.targetElementId}:${operation.element.face}:${String(knownValue(operation.element.material))}`,
      );
    }
  }
  return sortedSignature(materials);
}

export interface OptionSemanticDifference {
  readonly assetInventory: boolean;
  readonly assignment: boolean;
  readonly genuinelyDifferent: boolean;
  readonly material: boolean;
  readonly operationSignature: boolean;
  readonly placement: boolean;
}

export function semanticOptionDifference(
  left: DesignOption,
  right: DesignOption,
): OptionSemanticDifference {
  const assetInventory =
    sortedSignature(
      left.operationBundle.assetPlacements.map(
        ({ asset }) => `${asset.id}:${asset.versionId}:${asset.contentSha256}`,
      ),
    ) !==
    sortedSignature(
      right.operationBundle.assetPlacements.map(
        ({ asset }) => `${asset.id}:${asset.versionId}:${asset.contentSha256}`,
      ),
    );
  const assignment =
    sortedSignature(
      left.operationBundle.assetPlacements.map(
        ({ asset, spaceId }) => `${spaceId ?? "unassigned"}:${asset.id}:${asset.versionId}`,
      ),
    ) !==
    sortedSignature(
      right.operationBundle.assetPlacements.map(
        ({ asset, spaceId }) => `${spaceId ?? "unassigned"}:${asset.id}:${asset.versionId}`,
      ),
    );
  const placement = placementSignature(left) !== placementSignature(right);
  const material = materialSignature(left) !== materialSignature(right);
  const operationSignature =
    sortedSignature(left.operationBundle.operations.map(semanticOperation)) !==
    sortedSignature(right.operationBundle.operations.map(semanticOperation));
  return {
    assetInventory,
    assignment,
    genuinelyDifferent: assetInventory || assignment || placement || material || operationSignature,
    material,
    operationSignature,
    placement,
  };
}

export function basisPointsLabel(value: number): string {
  return `${(value / 100).toFixed(2)}%`;
}

export function millimetresLabel(value: number): string {
  return `${new Intl.NumberFormat("en-GB").format(value)} mm`;
}

export function shortHash(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}
