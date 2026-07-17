import type { CanonicalHomeSnapshot } from "@interior-design/contracts";

export interface GeometryFinding {
  readonly affectedElementIds: readonly string[];
  readonly code: string;
  readonly location?: { readonly levelId: string; readonly xMm: number; readonly yMm: number };
  readonly message: string;
  readonly severity: "error" | "warning" | "information";
}

/** Frozen C4 boundary; C4-L2 replaces the placeholder implementation. */
export function validateCanonicalGeometry(
  _snapshot: CanonicalHomeSnapshot,
): readonly GeometryFinding[] {
  void _snapshot;
  return [];
}
