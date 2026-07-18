import type {
  CatalogAssetVersion,
  SpecificationLine,
  SubstitutionPreview,
} from "@interior-design/contracts";

export const commercialUnknowns = Object.freeze([
  "Price not provided",
  "Supplier not provided",
  "Stock not provided",
  "Delivery not provided",
]);

function isDeclaredMetreScale(value: number): boolean {
  return value === 1_000;
}

export function shortHash(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

export function formattedTime(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function sourceLabel(asset: CatalogAssetVersion): string {
  return asset.rights.sourceKind === "licensed-local"
    ? "Locally licensed asset"
    : "Creator-owned generic asset";
}

export function rightsLabel(asset: CatalogAssetVersion): string {
  if (asset.lifecycle === "quarantined") return "Quarantined — historical inspection only";
  if (asset.lifecycle === "withdrawn" || asset.rights.review.state === "withdrawn") {
    return "Rights withdrawn — cannot be newly selected";
  }
  if (asset.rights.review.state === "expired") {
    return "Rights review expired — cannot be newly selected";
  }
  if (asset.lifecycle !== "approved") return `${asset.lifecycle} — cannot be newly selected`;
  return "Rights reviewed and active";
}

export function assetSelectable(asset: CatalogAssetVersion): boolean {
  const roles = new Set(asset.artifacts.map(({ role }) => role));
  return (
    asset.lifecycle === "approved" &&
    asset.rights.review.state === "approved" &&
    asset.rights.policy.serviceProcessingAllowed &&
    roles.has("model") &&
    roles.has("thumbnail") &&
    isDeclaredMetreScale(asset.placementProjection.gltfMetresToInteriorMillimetres)
  );
}

export function artifactReadiness(asset: CatalogAssetVersion): readonly string[] {
  const roles = new Set(asset.artifacts.map(({ role }) => role));
  return [
    roles.has("model") ? "Validated local GLB" : "Model missing",
    roles.has("thumbnail") ? "Thumbnail available" : "Thumbnail missing",
    isDeclaredMetreScale(asset.placementProjection.gltfMetresToInteriorMillimetres)
      ? "Scale declared: metres → millimetres"
      : "Scale missing or invalid",
    "Placement remains a bounded proxy",
  ];
}

export function lineQuantity(line: SpecificationLine): string {
  return line.quantity.state === "counted"
    ? "1 per canonical element"
    : "Unknown — not derived in C13";
}

export function roomLabel(line: SpecificationLine): string {
  return line.roomAssignment.status === "assigned"
    ? `Explicit room · ${line.roomAssignment.spaceId}`
    : `Room review required · ${line.roomAssignment.reason}`;
}

export function previewTruth(preview?: SubstitutionPreview): string {
  return preview
    ? "Bounded catalog preview only — not canonical and not C10 scene evidence"
    : "Choose a same-kind candidate to prepare a bounded catalog preview";
}
