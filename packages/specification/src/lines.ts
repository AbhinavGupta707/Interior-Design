import {
  c13SpecificationLineSchemaVersion,
  catalogAssetVersionSchema,
  catalogReleaseSchema,
  specificationLineSchema,
  type CanonicalHomeSnapshot,
  type CatalogAssetVersion,
  type CatalogRelease,
  type C12ConfirmationSource,
  type OptionOperationBundle,
  type SpecificationLine,
} from "@interior-design/contracts";

import { compareIdentifiers, deterministicSpecificationUuid } from "./canonical.js";
import { SpecificationDomainError } from "./errors.js";

export interface BuildInitialLinesInput {
  readonly assets: readonly CatalogAssetVersion[];
  readonly bundle: OptionOperationBundle;
  readonly catalogRelease: CatalogRelease;
  readonly catalogReleaseSha256: string;
  readonly snapshot: CanonicalHomeSnapshot;
  readonly source: C12ConfirmationSource;
  readonly specificationId: string;
}

function exactAssetProjectionMatches(
  placement: OptionOperationBundle["assetPlacements"][number],
  catalog: CatalogAssetVersion,
): boolean {
  const projected = catalog.placementProjection.c12Asset;
  return (
    projected.id === placement.asset.id &&
    projected.versionId === placement.asset.versionId &&
    projected.contentSha256 === placement.asset.contentSha256 &&
    projected.metadataSha256 === placement.asset.metadataSha256 &&
    projected.placementPolicy.policySha256 === placement.asset.placementPolicy.policySha256 &&
    projected.rights.rightsRecordSha256 === placement.asset.rights.rightsRecordSha256 &&
    catalog.rights.recordSha256 === placement.asset.rights.rightsRecordSha256
  );
}

export function assertSelectableCatalogAsset(assetInput: CatalogAssetVersion): CatalogAssetVersion {
  const asset = catalogAssetVersionSchema.parse(assetInput);
  if (
    asset.lifecycle !== "approved" ||
    asset.rights.review.state !== "approved" ||
    !asset.rights.policy.serviceProcessingAllowed ||
    !asset.rights.grants.derivatives ||
    !asset.rights.grants.renderedOutputDistribution ||
    !asset.rights.grants.thumbnailDisplay
  ) {
    throw new SpecificationDomainError(
      "ASSET_NOT_SELECTABLE",
      "The exact catalog version is not active and rights-cleared for a new selection.",
    );
  }
  return asset;
}

function elementLevelId(snapshot: CanonicalHomeSnapshot, elementId: string): string | undefined {
  const direct = [
    ...snapshot.elements.furnishings,
    ...snapshot.elements.lights,
    ...snapshot.elements.fixedObjects,
    ...snapshot.elements.spaces,
    ...snapshot.elements.surfaces,
    ...snapshot.elements.walls,
  ].find(({ id }) => id === elementId);
  if (direct !== undefined && "levelId" in direct) return direct.levelId;
  const finish = snapshot.elements.finishes.find(({ id }) => id === elementId);
  return finish === undefined ? undefined : elementLevelId(snapshot, finish.targetElementId);
}

function pointInPolygon(
  point: Readonly<{ xMm: number; yMm: number }>,
  polygon: readonly Readonly<{ xMm: number; yMm: number }>[],
): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    if (currentPoint === undefined || previousPoint === undefined) return false;
    const onSegment =
      (point.xMm - previousPoint.xMm) * (currentPoint.yMm - previousPoint.yMm) ===
        (point.yMm - previousPoint.yMm) * (currentPoint.xMm - previousPoint.xMm) &&
      point.xMm >= Math.min(previousPoint.xMm, currentPoint.xMm) &&
      point.xMm <= Math.max(previousPoint.xMm, currentPoint.xMm) &&
      point.yMm >= Math.min(previousPoint.yMm, currentPoint.yMm) &&
      point.yMm <= Math.max(previousPoint.yMm, currentPoint.yMm);
    if (onSegment) return true;
    if (
      currentPoint.yMm > point.yMm !== previousPoint.yMm > point.yMm &&
      point.xMm <
        ((previousPoint.xMm - currentPoint.xMm) * (point.yMm - currentPoint.yMm)) /
          (previousPoint.yMm - currentPoint.yMm) +
          currentPoint.xMm
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function exactRoomAssignment(
  snapshot: CanonicalHomeSnapshot,
  elementId: string,
  declaredSpaceId: string | undefined,
): SpecificationLine["roomAssignment"] {
  const levelId = elementLevelId(snapshot, elementId);
  if (declaredSpaceId !== undefined) {
    const declared = snapshot.elements.spaces.find(({ id }) => id === declaredSpaceId);
    if (declared === undefined || declared.levelId !== levelId) {
      throw new SpecificationDomainError(
        "SOURCE_MISMATCH",
        "The exact C12 room assignment is absent from the confirmed result snapshot.",
      );
    }
    return { spaceId: declared.id, status: "assigned" };
  }
  const furnishing = snapshot.elements.furnishings.find(({ id }) => id === elementId);
  const light = snapshot.elements.lights.find(({ id }) => id === elementId);
  const position = furnishing?.placement.position ?? light?.position;
  if (position?.knowledge !== "known") {
    return {
      reason: "No exact C12 space assignment or uniquely provable known point is available.",
      status: "review-required",
    };
  }
  const candidates = snapshot.elements.spaces.filter(
    (space) =>
      space.levelId === levelId &&
      space.boundary.knowledge === "known" &&
      pointInPolygon(position.value, space.boundary.value),
  );
  const uniqueCandidate = candidates.length === 1 ? candidates[0] : undefined;
  return uniqueCandidate !== undefined
    ? { spaceId: uniqueCandidate.id, status: "assigned" }
    : {
        reason: "Room inference is ambiguous or unsupported by exact confirmed geometry.",
        status: "review-required",
      };
}

export function buildInitialSpecificationLines(
  input: BuildInitialLinesInput,
): readonly SpecificationLine[] {
  const release = catalogReleaseSchema.parse(input.catalogRelease);
  if (!/^[a-f0-9]{64}$/u.test(input.catalogReleaseSha256)) {
    throw new SpecificationDomainError("SOURCE_MISMATCH", "The catalog release pin is invalid.");
  }
  if (release.status !== "published" || release.manifestSha256 !== input.catalogReleaseSha256) {
    throw new SpecificationDomainError(
      "ASSET_NOT_SELECTABLE",
      "Initial specification creation requires the exact published catalog release.",
    );
  }
  const assets = new Map(
    input.assets.map((candidate) => {
      const asset = assertSelectableCatalogAsset(candidate);
      return [asset.versionId, asset] as const;
    }),
  );
  const elementIds = input.bundle.assetPlacements.map(({ elementId }) => elementId);
  if (new Set(elementIds).size !== elementIds.length) {
    throw new SpecificationDomainError(
      "DUPLICATE_ELEMENT",
      "A specification cannot contain duplicate stable element IDs.",
    );
  }
  const lines = input.bundle.assetPlacements.map((placement) => {
    const asset = assets.get(placement.asset.versionId);
    if (
      asset === undefined ||
      !release.assetVersionIds.includes(asset.versionId) ||
      !exactAssetProjectionMatches(placement, asset)
    ) {
      throw new SpecificationDomainError(
        "ASSET_BINDING_MISMATCH",
        "A C12 placement does not exactly match the pinned C13 catalog version and release.",
      );
    }
    const levelId = elementLevelId(input.snapshot, placement.elementId);
    if (levelId === undefined) {
      throw new SpecificationDomainError(
        "ELEMENT_NOT_FOUND",
        "A C12 placement element is absent from the confirmed result snapshot.",
      );
    }
    return specificationLineSchema.parse({
      assetContentSha256: placement.asset.contentSha256,
      assetMetadataSha256: placement.asset.metadataSha256,
      assetVersionId: asset.versionId,
      assetVersionSha256: asset.versionSha256,
      catalogReleaseId: release.releaseId,
      catalogReleaseSha256: input.catalogReleaseSha256,
      decisionStatus: "selected",
      elementId: placement.elementId,
      kind: placement.asset.kind,
      levelId,
      lineId: deterministicSpecificationUuid(
        "c13-specification-line-v1",
        input.specificationId,
        placement.elementId,
      ),
      notes: "",
      placementPolicySha256: placement.asset.placementPolicy.policySha256,
      placementProjectionSha256: asset.placementProjection.projectionSha256,
      quantity:
        placement.asset.kind === "finish"
          ? { reason: "not-derived-in-c13", state: "unknown" }
          : { count: 1, state: "counted" },
      rightsRecordSha256: asset.rights.recordSha256,
      roomAssignment: exactRoomAssignment(input.snapshot, placement.elementId, placement.spaceId),
      schemaVersion: c13SpecificationLineSchemaVersion,
      selectionSource: {
        confirmationId: input.source.confirmationId,
        kind: "confirmed-option",
      },
    });
  });
  return Object.freeze(
    lines.toSorted((left, right) => compareIdentifiers(left.elementId, right.elementId)),
  );
}

export function assertOneLinePerElement(
  linesInput: readonly SpecificationLine[],
): readonly SpecificationLine[] {
  const lines = linesInput.map((line) => specificationLineSchema.parse(line));
  if (new Set(lines.map(({ elementId }) => elementId)).size !== lines.length) {
    throw new SpecificationDomainError(
      "DUPLICATE_ELEMENT",
      "Specification elements must be unique.",
    );
  }
  return Object.freeze(
    lines.toSorted((left, right) => compareIdentifiers(left.elementId, right.elementId)),
  );
}
