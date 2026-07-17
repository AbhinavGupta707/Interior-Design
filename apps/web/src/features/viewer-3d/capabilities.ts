export interface ViewerCapabilities {
  readonly reducedMotion: boolean;
  readonly webgl: boolean;
}

export function detectViewerCapabilities(): ViewerCapabilities {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canvas = document.createElement("canvas");
  try {
    const context =
      canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: true }) ??
      canvas.getContext("webgl", { failIfMajorPerformanceCaveat: true });
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    return Object.freeze({ reducedMotion, webgl: context !== null });
  } catch {
    return Object.freeze({ reducedMotion, webgl: false });
  }
}
