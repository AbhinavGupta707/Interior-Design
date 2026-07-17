import {
  canonicalHomeSnapshotSchema,
  modelOperationRequestSchema,
  type CanonicalHomeSnapshot,
  type ModelOperationRequest,
} from "@interior-design/contracts";
import {
  canonicalizeHomeSnapshot,
  validateCanonicalHomeSnapshot,
} from "@interior-design/domain-model";
import { validateCanonicalGeometry, type GeometryFinding } from "@interior-design/geometry-kernel";

import { ModelOperationError } from "./errors.js";
import type { CanonicalOperationResult } from "./types.js";

type ElementCollectionName = keyof CanonicalHomeSnapshot["elements"];
type MutableElements = {
  -readonly [TKey in ElementCollectionName]: CanonicalHomeSnapshot["elements"][TKey][number][];
};
type MutableSnapshot = Omit<CanonicalHomeSnapshot, "elements"> & { elements: MutableElements };

const maximumFindingCount = 10_000;

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function findingKey(finding: GeometryFinding): string {
  return [
    finding.severity,
    finding.code,
    [...finding.affectedElementIds].sort(compareStrings).join(","),
    finding.location?.levelId ?? "",
    finding.location === undefined ? "" : String(finding.location.xMm),
    finding.location === undefined ? "" : String(finding.location.yMm),
    finding.message,
  ].join("\u0000");
}

function normalizeFindings(findings: readonly GeometryFinding[]): readonly GeometryFinding[] {
  if (findings.length > maximumFindingCount) {
    throw new ModelOperationError(
      "INVALID_OPERATION",
      "Geometry validation exceeded the bounded finding limit.",
    );
  }
  return Object.freeze(
    findings
      .map((finding) =>
        Object.freeze({
          ...finding,
          affectedElementIds: Object.freeze(
            [...new Set(finding.affectedElementIds)].sort(compareStrings),
          ),
          ...(finding.location === undefined
            ? {}
            : { location: Object.freeze({ ...finding.location }) }),
        }),
      )
      .sort((left, right) => compareStrings(findingKey(left), findingKey(right))),
  );
}

function allElements(elements: MutableElements): Array<{ readonly id: string }> {
  return Object.values(elements).flat() as Array<{ readonly id: string }>;
}

function assertNewElementId(elements: MutableElements, id: string, operationIndex: number): void {
  if (allElements(elements).some((element) => element.id === id)) {
    throw new ModelOperationError(
      "DUPLICATE_ELEMENT_ID",
      "A model element already uses the requested stable ID.",
      { operationIndex },
    );
  }
}

function requireLevel(elements: MutableElements, levelId: string, operationIndex: number): void {
  if (!elements.levels.some(({ id }) => id === levelId)) {
    throw new ModelOperationError(
      "INVALID_REFERENCE",
      "The operation references a level outside the current snapshot.",
      { operationIndex },
    );
  }
}

function requireWall(elements: MutableElements, wallId: string, operationIndex: number) {
  const wall = elements.walls.find(({ id }) => id === wallId);
  if (wall !== undefined) return wall;
  const other = allElements(elements).find(({ id }) => id === wallId);
  throw new ModelOperationError(
    other === undefined ? "TARGET_NOT_FOUND" : "TARGET_TYPE_MISMATCH",
    other === undefined
      ? "The target wall does not exist in the current snapshot."
      : "The target stable ID does not identify a wall.",
    { operationIndex },
  );
}

function requireSpace(elements: MutableElements, spaceId: string, operationIndex: number) {
  const space = elements.spaces.find(({ id }) => id === spaceId);
  if (space !== undefined) return space;
  const other = allElements(elements).find(({ id }) => id === spaceId);
  throw new ModelOperationError(
    other === undefined ? "TARGET_NOT_FOUND" : "TARGET_TYPE_MISMATCH",
    other === undefined
      ? "The target space does not exist in the current snapshot."
      : "The target stable ID does not identify a space.",
    { operationIndex },
  );
}

const metadataFields = Object.freeze({
  finishes: ["material", "name"],
  fixedObjects: ["category", "name"],
  furnishings: ["category", "name"],
  levels: ["name"],
  lights: ["name"],
  openings: ["name"],
  spaces: ["classification", "name"],
  stairs: ["name"],
  surfaces: ["name"],
  walls: ["name"],
} as const);

const provenanceFields = Object.freeze({
  finishes: ["material", "name"],
  fixedObjects: ["category", "name"],
  furnishings: ["category", "name"],
  levels: ["name"],
  lights: ["name"],
  openings: ["heightMm", "name", "widthMm"],
  spaces: ["boundary", "classification", "name"],
  stairs: ["name", "path", "widthMm"],
  surfaces: ["boundary", "name"],
  walls: ["heightMm", "name", "path", "thicknessMm"],
} as const);

function collectionElement(
  elements: MutableElements,
  collection: ElementCollectionName,
  elementId: string,
  operationIndex: number,
): Record<string, unknown> {
  const element = (elements[collection] as Array<{ readonly id: string }>).find(
    ({ id }) => id === elementId,
  );
  if (element !== undefined) return element;
  const other = allElements(elements).find(({ id }) => id === elementId);
  throw new ModelOperationError(
    other === undefined ? "TARGET_NOT_FOUND" : "TARGET_TYPE_MISMATCH",
    other === undefined
      ? "The correction target does not exist in the current snapshot."
      : "The correction collection does not match the target element type.",
    { operationIndex },
  );
}

function isAttributedValue(value: unknown): value is Record<string, unknown> & {
  readonly attribution: Record<string, unknown>;
  readonly knowledge: "known" | "unknown";
} {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.knowledge === "known" || record.knowledge === "unknown") &&
    record.attribution !== null &&
    typeof record.attribution === "object" &&
    !Array.isArray(record.attribution)
  );
}

function correctMetadata(
  elements: MutableElements,
  operation: Extract<ModelOperationRequest, { readonly type: "element.metadata.correct.v1" }>,
  operationIndex: number,
): void {
  const { collection, elementId, field } = operation.target;
  const allowed = metadataFields[collection] as readonly string[];
  if (!allowed.includes(field)) {
    throw new ModelOperationError(
      "UNSUPPORTED_CORRECTION_TARGET",
      "That collection and metadata field pair is not registered for correction.",
      { operationIndex },
    );
  }
  const element = collectionElement(elements, collection, elementId, operationIndex);
  if (!isAttributedValue(element[field])) {
    throw new ModelOperationError(
      "UNSUPPORTED_CORRECTION_TARGET",
      "The registered metadata target is not an attributed field on this element.",
      { operationIndex },
    );
  }
  element[field] = structuredClone(operation.value);
}

function correctProvenance(
  elements: MutableElements,
  operation: Extract<ModelOperationRequest, { readonly type: "element.provenance.correct.v1" }>,
  operationIndex: number,
): void {
  const { collection, elementId, field } = operation.target;
  const allowed = provenanceFields[collection] as readonly string[];
  if (!allowed.includes(field)) {
    throw new ModelOperationError(
      "UNSUPPORTED_CORRECTION_TARGET",
      "That collection and provenance field pair is not registered for correction.",
      { operationIndex },
    );
  }
  const element = collectionElement(elements, collection, elementId, operationIndex);
  const value = element[field];
  if (!isAttributedValue(value)) {
    throw new ModelOperationError(
      "UNSUPPORTED_CORRECTION_TARGET",
      "The registered provenance target is not an attributed field on this element.",
      { operationIndex },
    );
  }
  const expectedKnowledge = operation.attribution.state === "unknown" ? "unknown" : "known";
  if (value.knowledge !== expectedKnowledge) {
    throw new ModelOperationError(
      "ATTRIBUTION_SHAPE_MISMATCH",
      "Provenance-only correction cannot invent or discard an attributed field value.",
      { operationIndex },
    );
  }
  element[field] = { ...value, attribution: structuredClone(operation.attribution) };
}

function applyOperation(
  snapshot: MutableSnapshot,
  operation: ModelOperationRequest,
  operationIndex: number,
): void {
  const { elements } = snapshot;
  switch (operation.type) {
    case "level.create.v1":
      assertNewElementId(elements, operation.level.id, operationIndex);
      elements.levels.push(structuredClone(operation.level));
      return;
    case "wall.create.v1":
      assertNewElementId(elements, operation.wall.id, operationIndex);
      requireLevel(elements, operation.wall.levelId, operationIndex);
      elements.walls.push(structuredClone(operation.wall));
      return;
    case "wall.translate.v1": {
      const wall = requireWall(elements, operation.wallId, operationIndex);
      if (wall.path.knowledge !== "known") {
        throw new ModelOperationError(
          "ATTRIBUTION_SHAPE_MISMATCH",
          "A wall with an unknown path cannot be translated.",
          { operationIndex },
        );
      }
      wall.path = {
        attribution: structuredClone(operation.pathAttribution),
        knowledge: "known",
        value: wall.path.value.map(({ xMm, yMm }) => ({
          xMm: xMm + operation.translation.xMm,
          yMm: yMm + operation.translation.yMm,
        })),
      };
      return;
    }
    case "opening.insert.v1":
      assertNewElementId(elements, operation.opening.id, operationIndex);
      requireWall(elements, operation.opening.hostWallId, operationIndex);
      elements.openings.push(structuredClone(operation.opening));
      return;
    case "space.create.v1":
      assertNewElementId(elements, operation.space.id, operationIndex);
      requireLevel(elements, operation.space.levelId, operationIndex);
      elements.spaces.push(structuredClone(operation.space));
      return;
    case "space.rename.v1":
      requireSpace(elements, operation.spaceId, operationIndex).name = structuredClone(
        operation.name,
      );
      return;
    case "element.metadata.correct.v1":
      correctMetadata(elements, operation, operationIndex);
      return;
    case "element.provenance.correct.v1":
      correctProvenance(elements, operation, operationIndex);
      return;
  }
}

export function validateAndCanonicalizeSnapshot(input: unknown): CanonicalOperationResult {
  const canonical = canonicalizeHomeSnapshot(input);
  const findings = normalizeFindings(validateCanonicalGeometry(canonical.snapshot));
  return Object.freeze({
    canonicalByteLength: canonical.canonicalByteLength,
    canonicalJson: canonical.canonicalJson,
    findings,
    hasBlockingFindings: findings.some(({ severity }) => severity === "error"),
    snapshot: canonical.snapshot,
    snapshotSha256: canonical.snapshotSha256,
  });
}

/** Pure ordered reduction. The input snapshot and operation objects are never mutated. */
export function reduceModelOperations(
  baseSnapshot: unknown,
  operationInput: readonly unknown[],
): CanonicalOperationResult {
  const base = validateCanonicalHomeSnapshot(baseSnapshot);
  const operations = operationInput.map((input, operationIndex) => {
    const result = modelOperationRequestSchema.safeParse(input);
    if (!result.success) {
      throw new ModelOperationError(
        "INVALID_OPERATION",
        "A requested model operation violates its exact public v1 schema.",
        { cause: result.error, operationIndex },
      );
    }
    return result.data;
  });
  if (operations.length < 1 || operations.length > 50) {
    throw new ModelOperationError(
      "INVALID_OPERATION",
      "A reduction requires between one and fifty ordered operations.",
    );
  }

  const draft = structuredClone(base) as MutableSnapshot;
  operations.forEach((operation, index) => applyOperation(draft, operation, index));
  // Full schema parsing precedes the single final canonicalisation. This makes
  // arithmetic overflow and any incompatible attributed shape fail closed.
  const reparsed = canonicalHomeSnapshotSchema.safeParse(draft);
  if (!reparsed.success) {
    throw new ModelOperationError(
      "INVALID_OPERATION",
      "The ordered operation sequence does not produce a schema-valid canonical snapshot.",
      { cause: reparsed.error },
    );
  }
  return validateAndCanonicalizeSnapshot(reparsed.data);
}
