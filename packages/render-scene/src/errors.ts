export type RenderSceneErrorCode =
  | "CAMERA_INVALID"
  | "CANONICAL_SOURCE_MISMATCH"
  | "C10_BINDING_MISMATCH"
  | "C13_BINDING_MISMATCH"
  | "C13_RIGHTS_DENIED"
  | "GLB_EXTERNAL_RESOURCE"
  | "GLB_INVALID"
  | "GLB_RESOURCE_LIMIT"
  | "GLB_UNSAFE_CONTENT"
  | "INPUT_INVALID"
  | "MANIFEST_INVALID"
  | "PALETTE_EXHAUSTED"
  | "SOURCE_HASH_MISMATCH";

const safeMessages: Readonly<Record<RenderSceneErrorCode, string>> = Object.freeze({
  CAMERA_INVALID: "The selected canonical camera cannot produce a safe deterministic view.",
  CANONICAL_SOURCE_MISMATCH: "The canonical model does not match the exact scene source.",
  C10_BINDING_MISMATCH: "The C10 scene record, manifest, mappings, and GLB disagree.",
  C13_BINDING_MISMATCH: "The authoritative C13 pins and immutable GLB bindings disagree.",
  C13_RIGHTS_DENIED: "One or more selected catalog records cannot produce a new render.",
  GLB_EXTERNAL_RESOURCE: "The protected GLB contains an external resource reference.",
  GLB_INVALID: "The protected GLB is malformed or internally inconsistent.",
  GLB_RESOURCE_LIMIT: "The protected GLB exceeds a frozen render-scene resource limit.",
  GLB_UNSAFE_CONTENT: "The protected GLB contains unsupported or executable-like content.",
  INPUT_INVALID: "The render-scene input violates the frozen declarative boundary.",
  MANIFEST_INVALID: "The derived render-scene manifest violates the frozen contract.",
  PALETTE_EXHAUSTED: "The collision-free segmentation palette is exhausted.",
  SOURCE_HASH_MISMATCH: "An immutable source byte hash does not match its authoritative pin.",
});

/**
 * A deliberately privacy-minimised failure. Messages never interpolate IDs,
 * paths, catalog text, source bytes, or request content.
 */
export class RenderSceneError extends Error {
  readonly code: RenderSceneErrorCode;

  constructor(code: RenderSceneErrorCode) {
    super(safeMessages[code]);
    this.name = "RenderSceneError";
    this.code = code;
  }

  diagnostic(): Readonly<{ code: RenderSceneErrorCode; message: string }> {
    return Object.freeze({ code: this.code, message: this.message });
  }
}

export function failRenderScene(code: RenderSceneErrorCode): never {
  throw new RenderSceneError(code);
}
