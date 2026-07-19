export class RendererBoundaryError extends Error {
  readonly safeCode: string;

  constructor(safeCode: string) {
    super("The isolated render process did not produce an acceptable geometry-safe bundle.");
    this.name = "RendererBoundaryError";
    this.safeCode = safeCode;
  }
}

export function rendererFailure(safeCode: string): never {
  throw new RendererBoundaryError(safeCode);
}
