export {
  assertPlainIJson,
  canonicalJson,
  canonicalJsonBytes,
  canonicalSnapshotSha256,
  sha256Hex,
} from "./canonical.js";
export { compileCanonicalScene } from "./compiler.js";
export { SceneCompileError } from "./errors.js";
export { parseGlb } from "./glb-parser.js";
export { sceneCompilerVersion } from "./types.js";
export type {
  CompiledScene,
  ParsedGlb,
  ParsedGlbCounts,
  SceneCompileInput,
  SceneValidatorEvidence,
} from "./types.js";

export const c10SceneCompilerPrelude = "c10-scene-compiler-prelude-v1" as const;
