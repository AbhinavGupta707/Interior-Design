import type { CanonicalElementSelection } from "@interior-design/editor-core";
import type { ModelOperationRequest, ProvenanceState } from "@interior-design/contracts";

type AttributedValue =
  | {
      readonly attribution: { readonly state: ProvenanceState };
      readonly knowledge: "known";
      readonly value: unknown;
    }
  | { readonly attribution: { readonly state: "unknown" }; readonly knowledge: "unknown" };

export function truncateHash(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function operationLabel(operation: ModelOperationRequest): string {
  switch (operation.type) {
    case "level.create.v1":
      return "Create level";
    case "wall.create.v1":
      return "Create wall";
    case "wall.translate.v1":
      return `Translate wall ${operation.wallId.slice(0, 8)}`;
    case "opening.insert.v1":
      return `Insert ${operation.opening.kind}`;
    case "space.create.v1":
      return "Create space";
    case "space.rename.v1":
      return `Rename space ${operation.spaceId.slice(0, 8)}`;
    case "element.metadata.correct.v1":
      return `Correct ${operation.target.field}`;
    case "element.provenance.correct.v1":
      return `Correct ${operation.target.field} provenance`;
  }
}

export function selectionType(selection: CanonicalElementSelection): string {
  return selection.collection.replace(/([a-z])([A-Z])/gu, "$1 $2").replace(/s$/u, "");
}

export function attributedState(value: unknown): ProvenanceState | undefined {
  if (
    typeof value === "object" &&
    value !== null &&
    "knowledge" in value &&
    "attribution" in value
  ) {
    const attributed = value as AttributedValue;
    return attributed.attribution.state;
  }
  return undefined;
}

export function selectionProvenance(selection: CanonicalElementSelection) {
  const fields = Object.entries(selection.element)
    .map(([field, value]) => {
      const state = attributedState(value);
      return state ? { field, state } : undefined;
    })
    .filter((value): value is { field: string; state: ProvenanceState } => Boolean(value));
  return {
    method: selection.attribution.method.name,
    methodVersion: selection.attribution.method.version,
    originState: selection.attribution.state,
    reviewed: selection.attribution.verification.status,
    fields,
  };
}
