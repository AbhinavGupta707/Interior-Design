export type ModelOperationErrorCode =
  | "ATTRIBUTION_SHAPE_MISMATCH"
  | "DUPLICATE_ELEMENT_ID"
  | "HISTORY_HASH_MISMATCH"
  | "HISTORY_ORDINAL_GAP"
  | "HISTORY_REVISION_GAP"
  | "INVALID_OPERATION"
  | "INVALID_REFERENCE"
  | "SNAPSHOT_BOUNDARY_MISMATCH"
  | "TARGET_NOT_FOUND"
  | "TARGET_TYPE_MISMATCH"
  | "UNKNOWN_OPERATION_TYPE"
  | "UNKNOWN_OPERATION_VERSION"
  | "UNSUPPORTED_CORRECTION_TARGET";

export class ModelOperationError extends Error {
  readonly code: ModelOperationErrorCode;
  readonly operationIndex: number | undefined;

  constructor(
    code: ModelOperationErrorCode,
    message: string,
    options: ErrorOptions & { readonly operationIndex?: number } = {},
  ) {
    super(message, options);
    this.name = "ModelOperationError";
    this.code = code;
    this.operationIndex = options.operationIndex;
  }
}
