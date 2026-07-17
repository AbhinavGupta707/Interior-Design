export type SceneCompileErrorCode =
  | "COMPILATION_CANCELLED"
  | "GEOMETRY_INVALID"
  | "GLB_INVALID"
  | "GLB_VALIDATOR_FAILED"
  | "INPUT_INVALID"
  | "RESOURCE_LIMIT_EXCEEDED"
  | "SOURCE_SNAPSHOT_MISMATCH";

export class SceneCompileError extends Error {
  readonly code: SceneCompileErrorCode;

  constructor(code: SceneCompileErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SceneCompileError";
    this.code = code;
  }
}

export function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new SceneCompileError(
      "COMPILATION_CANCELLED",
      "Scene compilation was cancelled before publication.",
    );
  }
}
