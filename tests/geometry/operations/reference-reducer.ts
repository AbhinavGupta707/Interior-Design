import {
  canonicalHomeSnapshotSchema,
  modelOperationRequestSchema,
  type CanonicalHomeSnapshot,
  type ModelOperationRequest,
} from "../../../packages/contracts/src/index.js";
import { canonicalizeHomeSnapshot } from "../../../packages/domain-model/src/index.js";
import {
  validateCanonicalGeometry,
  type GeometryFinding,
} from "../../../packages/geometry-kernel/src/index.js";

export const referencePublicOperationTypes = Object.freeze([
  "level.create.v1",
  "wall.create.v1",
  "wall.translate.v1",
  "opening.insert.v1",
  "space.create.v1",
  "space.rename.v1",
  "element.metadata.correct.v1",
  "element.provenance.correct.v1",
] as const);

type ReferenceOperationErrorCode =
  | "DUPLICATE_ELEMENT_ID"
  | "DUPLICATE_OPERATION_ID"
  | "INVALID_OPERATION_COUNT"
  | "INVALID_REFERENCE"
  | "INVALID_TARGET"
  | "MISSING_ATTRIBUTED_VALUE"
  | "UNKNOWN_ELEMENT";

export class ReferenceOperationError extends Error {
  readonly code: ReferenceOperationErrorCode;

  constructor(code: ReferenceOperationErrorCode, message: string) {
    super(message);
    this.name = "ReferenceOperationError";
    this.code = code;
  }
}

export interface ReferenceReduction {
  readonly canonicalByteLength: number;
  readonly findings: readonly GeometryFinding[];
  readonly snapshot: CanonicalHomeSnapshot;
  readonly snapshotSha256: string;
}

type MutableRecord = Record<string, unknown>;
type ElementCollection = keyof CanonicalHomeSnapshot["elements"];

function allElements(snapshot: CanonicalHomeSnapshot): readonly { readonly id: string }[] {
  return Object.values(snapshot.elements).flat();
}

function assertNewId(snapshot: CanonicalHomeSnapshot, id: string): void {
  if (allElements(snapshot).some((element) => element.id === id)) {
    throw new ReferenceOperationError("DUPLICATE_ELEMENT_ID", `Element ${id} already exists.`);
  }
}

function findElement(
  snapshot: CanonicalHomeSnapshot,
  collection: ElementCollection,
  id: string,
): MutableRecord {
  const found = snapshot.elements[collection].find((element) => element.id === id);
  if (found === undefined) {
    throw new ReferenceOperationError(
      "UNKNOWN_ELEMENT",
      `Element ${id} was not found in ${collection}.`,
    );
  }
  return found;
}

function hasLevel(snapshot: CanonicalHomeSnapshot, levelId: string): boolean {
  return snapshot.elements.levels.some((level) => level.id === levelId);
}

function assertAttributedValue(value: unknown, field: string): asserts value is MutableRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    !("knowledge" in value) ||
    !("attribution" in value)
  ) {
    throw new ReferenceOperationError(
      "INVALID_TARGET",
      `Target field ${field} is not an attributed value.`,
    );
  }
}

function applyOperation(snapshot: CanonicalHomeSnapshot, operation: ModelOperationRequest): void {
  switch (operation.type) {
    case "level.create.v1": {
      assertNewId(snapshot, operation.level.id);
      snapshot.elements.levels.push(operation.level);
      return;
    }
    case "wall.create.v1": {
      assertNewId(snapshot, operation.wall.id);
      if (!hasLevel(snapshot, operation.wall.levelId)) {
        throw new ReferenceOperationError(
          "INVALID_REFERENCE",
          `Wall level ${operation.wall.levelId} does not exist.`,
        );
      }
      snapshot.elements.walls.push(operation.wall);
      return;
    }
    case "wall.translate.v1": {
      const wall = snapshot.elements.walls.find(({ id }) => id === operation.wallId);
      if (wall === undefined) {
        throw new ReferenceOperationError(
          "UNKNOWN_ELEMENT",
          `Wall ${operation.wallId} is unknown.`,
        );
      }
      if (wall.path.knowledge !== "known") {
        throw new ReferenceOperationError(
          "MISSING_ATTRIBUTED_VALUE",
          `Wall ${operation.wallId} has no known path to translate.`,
        );
      }
      wall.path = {
        attribution: operation.pathAttribution,
        knowledge: "known",
        value: wall.path.value.map(({ xMm, yMm }) => ({
          xMm: xMm + operation.translation.xMm,
          yMm: yMm + operation.translation.yMm,
        })),
      };
      return;
    }
    case "opening.insert.v1": {
      assertNewId(snapshot, operation.opening.id);
      if (!snapshot.elements.walls.some(({ id }) => id === operation.opening.hostWallId)) {
        throw new ReferenceOperationError(
          "INVALID_REFERENCE",
          `Opening host wall ${operation.opening.hostWallId} does not exist.`,
        );
      }
      snapshot.elements.openings.push(operation.opening);
      return;
    }
    case "space.create.v1": {
      assertNewId(snapshot, operation.space.id);
      if (!hasLevel(snapshot, operation.space.levelId)) {
        throw new ReferenceOperationError(
          "INVALID_REFERENCE",
          `Space level ${operation.space.levelId} does not exist.`,
        );
      }
      for (const wallId of operation.space.boundedByElementIds) {
        const wall = snapshot.elements.walls.find(({ id }) => id === wallId);
        if (wall === undefined || wall.levelId !== operation.space.levelId) {
          throw new ReferenceOperationError(
            "INVALID_REFERENCE",
            `Space boundary wall ${wallId} is missing or belongs to another level.`,
          );
        }
      }
      snapshot.elements.spaces.push(operation.space);
      return;
    }
    case "space.rename.v1": {
      const space = snapshot.elements.spaces.find(({ id }) => id === operation.spaceId);
      if (space === undefined) {
        throw new ReferenceOperationError(
          "UNKNOWN_ELEMENT",
          `Space ${operation.spaceId} is unknown.`,
        );
      }
      space.name = operation.name;
      return;
    }
    case "element.metadata.correct.v1": {
      const element = findElement(
        snapshot,
        operation.target.collection,
        operation.target.elementId,
      );
      const current = element[operation.target.field];
      assertAttributedValue(current, operation.target.field);
      element[operation.target.field] = operation.value;
      return;
    }
    case "element.provenance.correct.v1": {
      const element = findElement(
        snapshot,
        operation.target.collection,
        operation.target.elementId,
      );
      const current = element[operation.target.field];
      assertAttributedValue(current, operation.target.field);
      if (operation.attribution.state === "unknown") {
        element[operation.target.field] = {
          attribution: operation.attribution,
          knowledge: "unknown",
        };
        return;
      }
      if (current.knowledge !== "known" || !("value" in current)) {
        throw new ReferenceOperationError(
          "MISSING_ATTRIBUTED_VALUE",
          `Known provenance cannot be attached to unknown ${operation.target.field} without a value.`,
        );
      }
      element[operation.target.field] = {
        attribution: operation.attribution,
        knowledge: "known",
        value: current.value,
      };
      return;
    }
  }
}

export function reduceWithReference(
  input: CanonicalHomeSnapshot,
  unparsedOperations: readonly unknown[],
): ReferenceReduction {
  if (unparsedOperations.length < 1 || unparsedOperations.length > 50) {
    throw new ReferenceOperationError(
      "INVALID_OPERATION_COUNT",
      "A reduction requires between one and 50 operations.",
    );
  }
  const operations = unparsedOperations.map((operation) =>
    modelOperationRequestSchema.parse(operation),
  );
  const operationIds = operations.map(({ clientOperationId }) => clientOperationId);
  if (new Set(operationIds).size !== operationIds.length) {
    throw new ReferenceOperationError(
      "DUPLICATE_OPERATION_ID",
      "Client operation IDs must be unique within one ordered reduction.",
    );
  }

  const snapshot = canonicalHomeSnapshotSchema.parse(structuredClone(input));
  for (const operation of operations) applyOperation(snapshot, operation);
  const parsed = canonicalHomeSnapshotSchema.parse(snapshot);
  const canonical = canonicalizeHomeSnapshot(parsed);
  return Object.freeze({
    canonicalByteLength: canonical.canonicalByteLength,
    findings: Object.freeze(validateCanonicalGeometry(canonical.snapshot)),
    snapshot: canonical.snapshot,
    snapshotSha256: canonical.snapshotSha256,
  });
}
