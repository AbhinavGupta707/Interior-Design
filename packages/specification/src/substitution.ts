import {
  c12DesignElementOperationSchemaVersion,
  replaceDesignElementOperationSchema,
  specificationLineSchema,
  type CanonicalHomeSnapshot,
  type CatalogAssetVersion,
  type DesignElement,
  type ModelOperationRequest,
  type SpecificationLine,
} from "@interior-design/contracts";
import { reduceModelOperations } from "@interior-design/model-operations";

import { deterministicSpecificationUuid } from "./canonical.js";
import { SpecificationDomainError } from "./errors.js";
import { assertSelectableCatalogAsset } from "./lines.js";

function findDesignElement(
  snapshot: CanonicalHomeSnapshot,
  elementId: string,
): DesignElement | undefined {
  return (
    snapshot.elements.furnishings.find(({ id }) => id === elementId) ??
    snapshot.elements.finishes.find(({ id }) => id === elementId) ??
    snapshot.elements.lights.find(({ id }) => id === elementId)
  );
}

function sourceReceiptEvidenceId(asset: CatalogAssetVersion): string {
  const receipt = asset.artifacts.find(({ role }) => role === "source-receipt");
  if (receipt === undefined) {
    throw new SpecificationDomainError(
      "ASSET_NOT_SELECTABLE",
      "The catalog source receipt is missing.",
    );
  }
  return receipt.artifactId;
}

function catalogAttribution(asset: CatalogAssetVersion, field: string) {
  return {
    attribution: {
      claimId: deterministicSpecificationUuid("c13-catalog-claim-v1", asset.versionId, field),
      evidenceIds: [sourceReceiptEvidenceId(asset)],
      method: { kind: "system" as const, name: "C13 exact catalog selection", version: "1" },
      state: "source-derived" as const,
      verification: { status: "not-reviewed" as const },
    },
    knowledge: "known" as const,
  };
}

function replacementElement(current: DesignElement, asset: CatalogAssetVersion): DesignElement {
  if (current.elementType !== asset.kind) {
    throw new SpecificationDomainError(
      "CROSS_KIND_REPLACEMENT",
      "Catalog substitutions must preserve the canonical design-element kind.",
    );
  }
  const projected = asset.placementProjection.c12Asset;
  switch (current.elementType) {
    case "furnishing":
      return {
        ...current,
        category: { ...catalogAttribution(asset, "category"), value: projected.category },
        dimensions: {
          ...catalogAttribution(asset, "dimensions"),
          value: projected.geometryEnvelopeMm,
        },
      };
    case "finish":
      return {
        ...current,
        material: { ...catalogAttribution(asset, "material"), value: projected.materialLabel },
      };
    case "light":
      // C13's frozen public catalog contract does not carry photometric values. The stable light
      // point/kind/photometry remain exact canonical placement truth while the exact catalog binding
      // changes. Adding inferred photometry here would fabricate a catalog claim.
      return current;
  }
}

function pointInPolygon(
  point: Readonly<{ xMm: number; yMm: number }>,
  polygon: readonly Readonly<{ xMm: number; yMm: number }>[],
): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const current = polygon[index];
    const prior = polygon[previous];
    if (current === undefined || prior === undefined) return false;
    const cross =
      (point.xMm - prior.xMm) * (current.yMm - prior.yMm) -
      (point.yMm - prior.yMm) * (current.xMm - prior.xMm);
    if (
      cross === 0 &&
      point.xMm >= Math.min(prior.xMm, current.xMm) &&
      point.xMm <= Math.max(prior.xMm, current.xMm) &&
      point.yMm >= Math.min(prior.yMm, current.yMm) &&
      point.yMm <= Math.max(prior.yMm, current.yMm)
    ) {
      return true;
    }
    if (
      current.yMm > point.yMm !== prior.yMm > point.yMm &&
      point.xMm <
        ((prior.xMm - current.xMm) * (point.yMm - current.yMm)) / (prior.yMm - current.yMm) +
          current.xMm
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function assertExactRoomContainment(
  line: SpecificationLine,
  element: DesignElement,
  asset: CatalogAssetVersion,
  snapshot: CanonicalHomeSnapshot,
): void {
  const assignment = line.roomAssignment;
  if (assignment.status !== "assigned") return;
  const room = snapshot.elements.spaces.find(({ id }) => id === assignment.spaceId);
  if (room?.boundary.knowledge !== "known") {
    throw new SpecificationDomainError(
      "GEOMETRY_INVALID",
      "An assigned substitution room requires exact known integer geometry.",
    );
  }
  const roomBoundary = room.boundary.value;
  if (element.elementType === "light") {
    if (
      element.position.knowledge !== "known" ||
      !pointInPolygon(element.position.value, roomBoundary)
    ) {
      throw new SpecificationDomainError(
        "GEOMETRY_INVALID",
        "The replacement light point is outside its exact assigned room.",
      );
    }
    return;
  }
  if (element.elementType !== "furnishing") return;
  if (
    element.placement.position.knowledge !== "known" ||
    element.placement.rotationMilliDegrees.knowledge !== "known"
  ) {
    throw new SpecificationDomainError(
      "GEOMETRY_INVALID",
      "A furnishing substitution requires exact known placement geometry.",
    );
  }
  const envelope = asset.placementProjection.c12Asset.geometryEnvelopeMm;
  const clearance = asset.placementProjection.c12Asset.placementPolicy.clearanceMm;
  const radians = (element.placement.rotationMilliDegrees.value * Math.PI) / 180_000;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const left = -(envelope.widthMm / 2 + clearance.left);
  const right = envelope.widthMm / 2 + clearance.right;
  const back = -(envelope.depthMm / 2 + clearance.back);
  const front = envelope.depthMm / 2 + clearance.front;
  const position = element.placement.position.value;
  const corners = [
    [left, back],
    [right, back],
    [right, front],
    [left, front],
  ] as const;
  if (
    corners.some(([localX, localY]) => {
      // Round outwards to the integer-millimetre grid. This is conservative at sub-mm rotations
      // and makes a 1 mm breach impossible to hide in floating-point interpolation.
      const exactX = position.xMm + localX * cosine - localY * sine;
      const exactY = position.yMm + localX * sine + localY * cosine;
      const point = {
        xMm: exactX < position.xMm ? Math.floor(exactX) : Math.ceil(exactX),
        yMm: exactY < position.yMm ? Math.floor(exactY) : Math.ceil(exactY),
      };
      return !pointInPolygon(point, roomBoundary);
    })
  ) {
    throw new SpecificationDomainError(
      "GEOMETRY_INVALID",
      "The replacement envelope or clearance crosses its exact room boundary.",
    );
  }
}

export interface BuildSubstitutionInput {
  readonly currentLine: SpecificationLine;
  readonly replacementAsset: CatalogAssetVersion;
  readonly snapshot: CanonicalHomeSnapshot;
}

export function buildCatalogReplacementOperation(
  input: BuildSubstitutionInput,
): Extract<ModelOperationRequest, { readonly type: "design.element.replace.v1" }> {
  const asset = assertSelectableCatalogAsset(input.replacementAsset);
  const current = findDesignElement(input.snapshot, input.currentLine.elementId);
  if (current === undefined) {
    throw new SpecificationDomainError(
      "ELEMENT_NOT_FOUND",
      "The exact specification element is not canonical.",
    );
  }
  const projected = asset.placementProjection.c12Asset;
  if (asset.kind !== input.currentLine.kind || projected.kind !== input.currentLine.kind) {
    throw new SpecificationDomainError(
      "CROSS_KIND_REPLACEMENT",
      "Cross-kind substitutions are forbidden.",
    );
  }
  return replaceDesignElementOperationSchema.parse({
    assetBinding: {
      assetId: projected.id,
      assetVersionId: projected.versionId,
      contentSha256: projected.contentSha256,
      metadataSha256: projected.metadataSha256,
      placementPolicySha256: projected.placementPolicy.policySha256,
      rightsRecordSha256: asset.rights.recordSha256,
    },
    clientOperationId: deterministicSpecificationUuid(
      "c13-substitution-operation-v1",
      input.currentLine.lineId,
      input.currentLine.selectionSource.kind,
      input.currentLine.selectionSource.confirmationId,
      asset.versionId,
    ),
    element: replacementElement(current, asset),
    expectedElementId: current.id,
    reason: "Confirm an exact rights-reviewed C13 catalog substitution.",
    schemaVersion: c12DesignElementOperationSchemaVersion,
    type: "design.element.replace.v1",
  });
}

export function previewCatalogReplacement(input: BuildSubstitutionInput) {
  const operation = buildCatalogReplacementOperation(input);
  assertExactRoomContainment(
    input.currentLine,
    operation.element,
    input.replacementAsset,
    input.snapshot,
  );
  const result = reduceModelOperations(input.snapshot, [operation]);
  if (result.hasBlockingFindings) {
    throw new SpecificationDomainError(
      "GEOMETRY_INVALID",
      "The exact catalog replacement has blocking integer geometry findings.",
    );
  }
  return Object.freeze({ operation, result });
}

export function substituteSpecificationLine(input: {
  readonly confirmationId: string;
  readonly current: SpecificationLine;
  readonly replacementAsset: CatalogAssetVersion;
}): SpecificationLine {
  const asset = assertSelectableCatalogAsset(input.replacementAsset);
  if (input.current.kind !== asset.kind) {
    throw new SpecificationDomainError(
      "CROSS_KIND_REPLACEMENT",
      "Cross-kind substitutions are forbidden.",
    );
  }
  const projected = asset.placementProjection.c12Asset;
  return specificationLineSchema.parse({
    ...input.current,
    assetContentSha256: projected.contentSha256,
    assetMetadataSha256: projected.metadataSha256,
    assetVersionId: asset.versionId,
    assetVersionSha256: asset.versionSha256,
    placementPolicySha256: projected.placementPolicy.policySha256,
    placementProjectionSha256: asset.placementProjection.projectionSha256,
    rightsRecordSha256: asset.rights.recordSha256,
    selectionSource: { confirmationId: input.confirmationId, kind: "confirmed-substitution" },
  });
}
