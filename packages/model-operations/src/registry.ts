import {
  c5OperationSchemaVersion,
  modelOperationIdSchema,
  modelOperationRequestSchema,
  modelOperationTypeSchema,
  modelSnapshotIdSchema,
  sha256HexSchema,
} from "@interior-design/contracts";

import { ModelOperationError } from "./errors.js";
import type {
  InternalSnapshotOperation,
  OperationRegistryEntry,
  RetainedModelOperation,
} from "./types.js";

export const operationRegistry = Object.freeze([
  { audience: "internal", type: "snapshot.initialize.v1" },
  { audience: "internal", type: "snapshot.restore.v1" },
  { audience: "public", type: "level.create.v1" },
  { audience: "public", type: "wall.create.v1" },
  { audience: "public", type: "wall.translate.v1" },
  { audience: "public", type: "opening.insert.v1" },
  { audience: "public", type: "space.create.v1" },
  { audience: "public", type: "space.rename.v1" },
  { audience: "public", type: "element.metadata.correct.v1" },
  { audience: "public", type: "element.provenance.correct.v1" },
] as const satisfies readonly OperationRegistryEntry[]);

export const registeredOperationTypes = Object.freeze(operationRegistry.map(({ type }) => type));

const internalSnapshotOperationKeys = Object.freeze([
  "clientOperationId",
  "reason",
  "schemaVersion",
  "sourceSnapshotId",
  "sourceSnapshotSha256",
  "type",
]);

function recordValue(input: unknown, key: string): unknown {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return undefined;
  try {
    return Reflect.get(input, key);
  } catch {
    return undefined;
  }
}

function parseInternalSnapshotOperation(input: unknown): InternalSnapshotOperation {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new ModelOperationError(
      "INVALID_OPERATION",
      "The retained internal model operation must be an exact object.",
    );
  }
  let keys: string[];
  try {
    keys = Object.keys(input).sort();
  } catch (cause) {
    throw new ModelOperationError(
      "INVALID_OPERATION",
      "The retained internal model operation cannot be inspected safely.",
      { cause },
    );
  }
  if (
    keys.length !== internalSnapshotOperationKeys.length ||
    keys.some((key, index) => key !== internalSnapshotOperationKeys[index])
  ) {
    throw new ModelOperationError(
      "INVALID_OPERATION",
      "The retained internal model operation contains missing or unknown fields.",
    );
  }

  const clientOperationId = modelOperationIdSchema.safeParse(
    recordValue(input, "clientOperationId"),
  );
  const sourceSnapshotId = modelSnapshotIdSchema.safeParse(recordValue(input, "sourceSnapshotId"));
  const sourceSnapshotSha256 = sha256HexSchema.safeParse(
    recordValue(input, "sourceSnapshotSha256"),
  );
  const rawReason = recordValue(input, "reason");
  const reason = typeof rawReason === "string" ? rawReason.trim() : "";
  const type = recordValue(input, "type");
  if (
    !clientOperationId.success ||
    !sourceSnapshotId.success ||
    !sourceSnapshotSha256.success ||
    reason.length < 1 ||
    reason.length > 500 ||
    recordValue(input, "schemaVersion") !== c5OperationSchemaVersion ||
    (type !== "snapshot.initialize.v1" && type !== "snapshot.restore.v1")
  ) {
    throw new ModelOperationError(
      "INVALID_OPERATION",
      "The retained internal model operation violates its exact v1 schema.",
    );
  }
  return {
    clientOperationId: clientOperationId.data,
    reason,
    schemaVersion: c5OperationSchemaVersion,
    sourceSnapshotId: sourceSnapshotId.data,
    sourceSnapshotSha256: sourceSnapshotSha256.data,
    type,
  };
}

/**
 * Upcast one retained operation envelope. V1 is intentionally identity-only:
 * unknown versions and unknown operation names fail closed rather than being
 * repaired or interpreted as a newer shape.
 */
export function upcastModelOperation(input: unknown): RetainedModelOperation {
  const schemaVersion = recordValue(input, "schemaVersion");
  if (schemaVersion !== c5OperationSchemaVersion) {
    throw new ModelOperationError(
      "UNKNOWN_OPERATION_VERSION",
      "The retained model operation uses an unsupported schema version.",
    );
  }
  const parsedType = modelOperationTypeSchema.safeParse(recordValue(input, "type"));
  if (!parsedType.success) {
    throw new ModelOperationError(
      "UNKNOWN_OPERATION_TYPE",
      "The retained model operation type is not registered.",
    );
  }
  if (parsedType.data.startsWith("snapshot.")) return parseInternalSnapshotOperation(input);
  const result = modelOperationRequestSchema.safeParse(input);
  if (!result.success) {
    throw new ModelOperationError(
      "INVALID_OPERATION",
      "The retained model operation violates its exact v1 schema.",
      { cause: result.error },
    );
  }
  return result.data;
}

export function createInternalSnapshotOperation(
  input: Omit<InternalSnapshotOperation, "schemaVersion">,
): InternalSnapshotOperation {
  return parseInternalSnapshotOperation({
    ...input,
    schemaVersion: c5OperationSchemaVersion,
  });
}
