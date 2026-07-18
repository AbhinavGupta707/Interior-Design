import {
  c13CatalogPolicy,
  interiorAssetRefSchema,
  type InteriorAssetRef,
} from "@interior-design/contracts";
import { parseIJson } from "@interior-design/domain-model";

import {
  compareCatalogStrings,
  deepFreezeCatalogValue,
  exactObjectKeys,
  hasUnsafeCatalogText,
  isPlainRecord,
  sha256Pattern,
} from "./canonical.js";
import { CatalogError } from "./errors.js";
import {
  catalogSourceManifestSchemaVersion,
  type CatalogSourceArtifact,
  type CatalogSourceArtifactRole,
  type CatalogSourceAsset,
  type CatalogSourceManifest,
  type CatalogSourceMaterial,
  type CatalogSourceRights,
} from "./types.js";

const sourceArtifactRoles = new Set<CatalogSourceArtifactRole>([
  "licence-text",
  "model",
  "source-receipt",
  "thumbnail",
]);
const mediaTypes = new Set(["image/png", "model/gltf-binary", "text/plain; charset=utf-8"]);
const versionPattern = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const relativePathPattern = /^(?:[a-z0-9][a-z0-9._-]{0,79}\/){1,5}[a-z0-9][a-z0-9._-]{0,79}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const forbiddenKeyPattern =
  /(?:availability|bearer|credential|delivery|locator|password|price|secret|supplier|token|uri|url)/iu;

function malformed(): never {
  throw new CatalogError("CATALOG_INPUT_MALFORMED");
}

function rightsInvalid(): never {
  throw new CatalogError("CATALOG_RIGHTS_INVALID");
}

function text(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value !== value.trim() ||
    hasUnsafeCatalogText(value)
  ) {
    malformed();
  }
  return value;
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    malformed();
  }
  return value;
}

function tupleSrgb(value: unknown): readonly [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) malformed();
  return [integer(value[0], 0, 255), integer(value[1], 0, 255), integer(value[2], 0, 255)];
}

function assertNoForbiddenKeys(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoForbiddenKeys);
    return;
  }
  if (!isPlainRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeyPattern.test(key)) malformed();
    assertNoForbiddenKeys(child);
  }
}

function parseArtifact(value: unknown): CatalogSourceArtifact {
  if (
    !isPlainRecord(value) ||
    !exactObjectKeys(value, ["mediaType", "relativePath", "role", "sha256"])
  ) {
    malformed();
  }
  const role = value.role;
  const mediaType = value.mediaType;
  if (
    typeof role !== "string" ||
    !sourceArtifactRoles.has(role as CatalogSourceArtifactRole) ||
    typeof mediaType !== "string" ||
    !mediaTypes.has(mediaType) ||
    typeof value.sha256 !== "string" ||
    !sha256Pattern.test(value.sha256) ||
    typeof value.relativePath !== "string" ||
    !relativePathPattern.test(value.relativePath) ||
    value.relativePath.includes("..") ||
    value.relativePath.includes("\\")
  ) {
    malformed();
  }
  const expectedMediaType =
    role === "model"
      ? "model/gltf-binary"
      : role === "thumbnail"
        ? "image/png"
        : "text/plain; charset=utf-8";
  const expectedExtension = role === "model" ? ".glb" : role === "thumbnail" ? ".png" : ".txt";
  if (mediaType !== expectedMediaType || !value.relativePath.endsWith(expectedExtension))
    malformed();
  return {
    mediaType,
    relativePath: value.relativePath,
    role: role as CatalogSourceArtifactRole,
    sha256: value.sha256,
  };
}

function parseMaterial(value: unknown): CatalogSourceMaterial {
  if (
    !isPlainRecord(value) ||
    !exactObjectKeys(value, [
      "baseColourSrgb8",
      "emissiveSrgb8",
      "metallicBasisPoints",
      "name",
      "physicalRepeatMm",
      "roughnessBasisPoints",
    ])
  ) {
    malformed();
  }
  let physicalRepeatMm: CatalogSourceMaterial["physicalRepeatMm"] = null;
  if (value.physicalRepeatMm !== null) {
    if (
      !isPlainRecord(value.physicalRepeatMm) ||
      !exactObjectKeys(value.physicalRepeatMm, ["heightMm", "widthMm"])
    ) {
      malformed();
    }
    physicalRepeatMm = {
      heightMm: integer(value.physicalRepeatMm.heightMm, 1, 100_000),
      widthMm: integer(value.physicalRepeatMm.widthMm, 1, 100_000),
    };
  }
  return {
    baseColourSrgb8: tupleSrgb(value.baseColourSrgb8),
    emissiveSrgb8: tupleSrgb(value.emissiveSrgb8),
    metallicBasisPoints: integer(value.metallicBasisPoints, 0, 10_000),
    name: text(value.name, 160),
    physicalRepeatMm,
    roughnessBasisPoints: integer(value.roughnessBasisPoints, 0, 10_000),
  };
}

function parseRights(value: unknown): CatalogSourceRights {
  if (
    !isPlainRecord(value) ||
    !exactObjectKeys(value, [
      "concludedLicenceExpression",
      "creator",
      "declaredLicenceExpression",
      "grants",
      "policy",
      "review",
      "sourceKind",
      "spdxLicenseListVersion",
    ]) ||
    !isPlainRecord(value.grants) ||
    !exactObjectKeys(value.grants, [
      "commercialUse",
      "derivatives",
      "rawRedistribution",
      "renderedOutputDistribution",
      "thumbnailDisplay",
    ]) ||
    !isPlainRecord(value.policy) ||
    !exactObjectKeys(value.policy, ["serviceProcessingAllowed", "trainingAllowed"]) ||
    !isPlainRecord(value.review) ||
    !exactObjectKeys(value.review, ["reviewedAt", "reviewerUserId", "state"])
  ) {
    rightsInvalid();
  }
  const declared = text(value.declaredLicenceExpression, 160);
  const concluded = text(value.concludedLicenceExpression, 160);
  const expressionPattern =
    /^(?:[A-Za-z0-9.-]+|LicenseRef-[A-Za-z0-9.-]+)(?: (?:AND|OR) (?:[A-Za-z0-9.-]+|LicenseRef-[A-Za-z0-9.-]+))*$/u;
  if (
    !expressionPattern.test(declared) ||
    !expressionPattern.test(concluded) ||
    value.sourceKind !== "creator-owned-synthetic" ||
    value.grants.rawRedistribution !== false ||
    typeof value.grants.commercialUse !== "boolean" ||
    typeof value.grants.derivatives !== "boolean" ||
    typeof value.grants.renderedOutputDistribution !== "boolean" ||
    typeof value.grants.thumbnailDisplay !== "boolean" ||
    typeof value.policy.serviceProcessingAllowed !== "boolean" ||
    value.policy.trainingAllowed !== false ||
    typeof value.review.reviewedAt !== "string" ||
    Number.isNaN(Date.parse(value.review.reviewedAt)) ||
    !value.review.reviewedAt.endsWith("Z") ||
    typeof value.review.reviewerUserId !== "string" ||
    !uuidPattern.test(value.review.reviewerUserId) ||
    !["approved", "expired", "withdrawn"].includes(String(value.review.state))
  ) {
    rightsInvalid();
  }
  return {
    concludedLicenceExpression: concluded,
    creator: text(value.creator, 160),
    declaredLicenceExpression: declared,
    grants: {
      commercialUse: value.grants.commercialUse,
      derivatives: value.grants.derivatives,
      rawRedistribution: false,
      renderedOutputDistribution: value.grants.renderedOutputDistribution,
      thumbnailDisplay: value.grants.thumbnailDisplay,
    },
    policy: {
      serviceProcessingAllowed: value.policy.serviceProcessingAllowed,
      trainingAllowed: false,
    },
    review: {
      reviewedAt: value.review.reviewedAt,
      reviewerUserId: value.review.reviewerUserId,
      state: value.review.state as CatalogSourceRights["review"]["state"],
    },
    sourceKind: "creator-owned-synthetic",
    spdxLicenseListVersion: text(value.spdxLicenseListVersion, 160),
  };
}

function parseC12Asset(value: unknown): InteriorAssetRef {
  const parsed = interiorAssetRefSchema.safeParse(value);
  if (!parsed.success) malformed();
  return parsed.data;
}

function parseAsset(value: unknown): CatalogSourceAsset {
  if (
    !isPlainRecord(value) ||
    !exactObjectKeys(value, [
      "artifacts",
      "c12Asset",
      "description",
      "displayName",
      "material",
      "rights",
      "slug",
      "tags",
    ]) ||
    !Array.isArray(value.artifacts) ||
    value.artifacts.length !== 4 ||
    !Array.isArray(value.tags) ||
    value.tags.length > 32
  ) {
    malformed();
  }
  const artifacts = value.artifacts
    .map(parseArtifact)
    .sort((left, right) => compareCatalogStrings(left.role, right.role));
  const roles = artifacts.map(({ role }) => role);
  if (
    new Set(roles).size !== roles.length ||
    !["licence-text", "model", "source-receipt", "thumbnail"].every((role) =>
      roles.includes(role as CatalogSourceArtifactRole),
    )
  ) {
    malformed();
  }
  const tags = value.tags.map((tag) => text(tag, 160)).sort(compareCatalogStrings);
  if (new Set(tags).size !== tags.length) malformed();
  return {
    artifacts,
    c12Asset: parseC12Asset(value.c12Asset),
    description: text(value.description, 2_000),
    displayName: text(value.displayName, 160),
    material: parseMaterial(value.material),
    rights: parseRights(value.rights),
    slug: text(value.slug, 80),
    tags,
  };
}

export function parseCatalogSourceManifest(bytes: Uint8Array): CatalogSourceManifest {
  if (bytes.byteLength < 1 || bytes.byteLength > c13CatalogPolicy.maximumReleaseManifestBytes) {
    throw new CatalogError("CATALOG_RESOURCE_LIMIT");
  }
  let value: unknown;
  try {
    value = parseIJson(bytes);
  } catch (error) {
    throw new CatalogError("CATALOG_INPUT_MALFORMED", { cause: error });
  }
  assertNoForbiddenKeys(value);
  if (
    !isPlainRecord(value) ||
    !exactObjectKeys(value, ["assets", "createdAt", "releaseVersion", "schemaVersion"]) ||
    value.schemaVersion !== catalogSourceManifestSchemaVersion ||
    !Array.isArray(value.assets) ||
    value.assets.length < 1 ||
    value.assets.length > c13CatalogPolicy.maximumAssetsPerRelease ||
    typeof value.createdAt !== "string" ||
    Number.isNaN(Date.parse(value.createdAt)) ||
    !value.createdAt.endsWith("Z") ||
    typeof value.releaseVersion !== "string" ||
    !versionPattern.test(value.releaseVersion)
  ) {
    malformed();
  }
  const assets = value.assets
    .map(parseAsset)
    .sort((left, right) =>
      compareCatalogStrings(left.c12Asset.versionId, right.c12Asset.versionId),
    );
  const assetIds = assets.map(({ c12Asset }) => c12Asset.id);
  const versionIds = assets.map(({ c12Asset }) => c12Asset.versionId);
  const slugs = assets.map(({ slug }) => slug);
  if (
    new Set(assetIds).size !== assetIds.length ||
    new Set(versionIds).size !== versionIds.length ||
    new Set(slugs).size !== slugs.length
  ) {
    malformed();
  }
  return deepFreezeCatalogValue({
    assets,
    createdAt: value.createdAt,
    releaseVersion: value.releaseVersion,
    schemaVersion: catalogSourceManifestSchemaVersion,
  });
}
