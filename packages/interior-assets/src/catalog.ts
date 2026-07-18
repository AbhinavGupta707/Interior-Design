import { interiorAssetRefSchema, type InteriorAssetRef } from "@interior-design/contracts";

import {
  assetSha256,
  assertBoundedPlainJson,
  deepFreezeAssetValue,
  maximumAssetCatalogBytes,
} from "./canonical.js";
import { InteriorAssetError } from "./errors.js";
import {
  boundedProxyContentSchemaVersion,
  boundedProxyMetadataSchemaVersion,
  creatorOwnedCatalogSchemaVersion,
  type BoundedProxyContent,
  type BoundedProxyMetadata,
  type CreatorOwnedAssetCatalog,
  type CreatorOwnedAssetRecord,
  type ExactTargetFace,
  type ValidatedAssetCatalog,
} from "./types.js";

export const interiorAssetCatalogPolicy = Object.freeze({
  maximumAssets: 128,
  maximumCatalogBytes: maximumAssetCatalogBytes,
  maximumClearanceMm: 10_000,
  maximumDimensionMm: 100_000,
  maximumMetadataLabelLength: 160,
} as const);

const sha256Pattern = /^[a-f0-9]{64}$/u;
const versionPattern = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const faceValues = new Set<ExactTargetFace>(["all", "bottom", "inside", "outside", "top"]);
const forbiddenMetadataKeys = new Set([
  "availability",
  "brand",
  "executable",
  "executableLocator",
  "locator",
  "price",
  "remoteLocator",
  "stock",
  "supplier",
  "uri",
  "url",
]);

const exactRecordKeys = ["content", "metadata", "ref"] as const;
const exactCatalogKeys = ["assets", "manifestSha256", "schemaVersion"] as const;
const exactContentKeys = [
  "assetId",
  "assetVersionId",
  "coordinateConvention",
  "geometryEnvelopeMm",
  "proxyPrimitive",
  "schemaVersion",
] as const;
const exactCoordinateKeys = [
  "forwardAxis",
  "handedness",
  "lengthUnit",
  "origin",
  "xAxis",
  "yAxis",
  "zAxis",
] as const;
const exactEnvelopeKeys = ["depthMm", "heightMm", "widthMm"] as const;
const metadataCoreKeys = [
  "allowedTargetFaces",
  "assetId",
  "assetVersionId",
  "category",
  "dimensionsSource",
  "displayName",
  "kind",
  "materialLabel",
  "representationStatus",
  "schemaVersion",
  "syntheticFixture",
  "version",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  safeCode: "ASSET_INPUT_MALFORMED" | "ASSET_METADATA_FORBIDDEN" = "ASSET_INPUT_MALFORMED",
): void {
  const keys = Object.keys(value).sort();
  const required = [...expected].sort();
  if (keys.length !== required.length || keys.some((key, index) => key !== required[index])) {
    throw new InteriorAssetError(safeCode);
  }
}

function assertNoForbiddenMetadataKeys(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoForbiddenMetadataKeys);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenMetadataKeys.has(key)) {
      throw new InteriorAssetError("ASSET_METADATA_FORBIDDEN");
    }
    assertNoForbiddenMetadataKeys(child);
  }
}

function classifyAssetRefFailure(paths: readonly (readonly PropertyKey[])[]): never {
  if (paths.some((path) => path[0] === "rights")) {
    throw new InteriorAssetError("ASSET_RIGHTS_INVALID");
  }
  if (paths.some((path) => path[0] === "geometryEnvelopeMm")) {
    throw new InteriorAssetError("ASSET_DIMENSIONS_INVALID");
  }
  if (paths.some((path) => path.includes("allowedRotationMilliDegrees"))) {
    throw new InteriorAssetError("ASSET_ROTATIONS_INVALID");
  }
  if (paths.some((path) => path.includes("clearanceMm"))) {
    throw new InteriorAssetError("ASSET_CLEARANCE_INVALID");
  }
  if (paths.some((path) => path.includes("forwardAxis") || path.includes("origin"))) {
    throw new InteriorAssetError("ASSET_COORDINATE_CONVENTION_INVALID");
  }
  if (paths.some((path) => path.some((part) => String(part).toLowerCase().includes("sha256")))) {
    throw new InteriorAssetError("ASSET_HASH_MISMATCH");
  }
  throw new InteriorAssetError("ASSET_INPUT_MALFORMED");
}

function parseAssetRef(value: unknown): InteriorAssetRef {
  const parsed = interiorAssetRefSchema.safeParse(value);
  if (!parsed.success) classifyAssetRefFailure(parsed.error.issues.map(({ path }) => path));
  return parsed.data;
}

function assertPositiveBoundedInteger(value: unknown, maximum: number): asserts value is number {
  if (!Number.isSafeInteger(value) || typeof value !== "number" || value < 1 || value > maximum) {
    throw new InteriorAssetError("ASSET_DIMENSIONS_INVALID");
  }
}

function parseContent(value: unknown, ref: InteriorAssetRef): BoundedProxyContent {
  if (!isRecord(value)) throw new InteriorAssetError("ASSET_INPUT_MALFORMED");
  assertExactKeys(value, exactContentKeys);
  if (!isRecord(value.coordinateConvention)) {
    throw new InteriorAssetError("ASSET_COORDINATE_CONVENTION_INVALID");
  }
  assertExactKeys(value.coordinateConvention, exactCoordinateKeys);
  const convention = value.coordinateConvention;
  if (
    convention.forwardAxis !== "positive-y" ||
    convention.handedness !== "right" ||
    convention.lengthUnit !== "millimetre" ||
    convention.origin !== "bounding-box-centre-floor" ||
    convention.xAxis !== "right" ||
    convention.yAxis !== "forward" ||
    convention.zAxis !== "up"
  ) {
    throw new InteriorAssetError("ASSET_COORDINATE_CONVENTION_INVALID");
  }
  if (!isRecord(value.geometryEnvelopeMm)) {
    throw new InteriorAssetError("ASSET_DIMENSIONS_INVALID");
  }
  assertExactKeys(value.geometryEnvelopeMm, exactEnvelopeKeys);
  assertPositiveBoundedInteger(
    value.geometryEnvelopeMm.depthMm,
    interiorAssetCatalogPolicy.maximumDimensionMm,
  );
  assertPositiveBoundedInteger(
    value.geometryEnvelopeMm.heightMm,
    interiorAssetCatalogPolicy.maximumDimensionMm,
  );
  assertPositiveBoundedInteger(
    value.geometryEnvelopeMm.widthMm,
    interiorAssetCatalogPolicy.maximumDimensionMm,
  );
  if (
    value.assetId !== ref.id ||
    value.assetVersionId !== ref.versionId ||
    value.proxyPrimitive !== "axis-aligned-box" ||
    value.schemaVersion !== boundedProxyContentSchemaVersion ||
    value.geometryEnvelopeMm.depthMm !== ref.geometryEnvelopeMm.depthMm ||
    value.geometryEnvelopeMm.heightMm !== ref.geometryEnvelopeMm.heightMm ||
    value.geometryEnvelopeMm.widthMm !== ref.geometryEnvelopeMm.widthMm
  ) {
    throw new InteriorAssetError("ASSET_DIMENSIONS_INVALID");
  }
  return {
    assetId: ref.id,
    assetVersionId: ref.versionId,
    coordinateConvention: {
      forwardAxis: "positive-y",
      handedness: "right",
      lengthUnit: "millimetre",
      origin: "bounding-box-centre-floor",
      xAxis: "right",
      yAxis: "forward",
      zAxis: "up",
    },
    geometryEnvelopeMm: { ...ref.geometryEnvelopeMm },
    proxyPrimitive: "axis-aligned-box",
    schemaVersion: boundedProxyContentSchemaVersion,
  };
}

function parseFaces(value: unknown): ExactTargetFace[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 5 ||
    value.some((face) => typeof face !== "string" || !faceValues.has(face as ExactTargetFace))
  ) {
    throw new InteriorAssetError("ASSET_INPUT_MALFORMED");
  }
  const faces = value as ExactTargetFace[];
  const sorted = [...faces].sort();
  if (new Set(faces).size !== faces.length || faces.some((face, index) => face !== sorted[index])) {
    throw new InteriorAssetError("ASSET_INPUT_MALFORMED");
  }
  return faces;
}

function parseMetadata(value: unknown, ref: InteriorAssetRef): BoundedProxyMetadata {
  if (!isRecord(value)) throw new InteriorAssetError("ASSET_INPUT_MALFORMED");
  assertNoForbiddenMetadataKeys(value);
  const lightKeys = [
    ...metadataCoreKeys,
    "colourTemperatureKelvin",
    "lightKind",
    "luminousFluxLumens",
  ];
  const finishKeys = [...metadataCoreKeys, "applicationThicknessMm"];
  assertExactKeys(
    value,
    ref.kind === "light" ? lightKeys : ref.kind === "finish" ? finishKeys : metadataCoreKeys,
    "ASSET_METADATA_FORBIDDEN",
  );
  const faces = parseFaces(value.allowedTargetFaces);
  if (
    value.assetId !== ref.id ||
    value.assetVersionId !== ref.versionId ||
    value.category !== ref.category ||
    value.dimensionsSource !== "explicit-creator-authored-integer-mm" ||
    typeof value.displayName !== "string" ||
    value.displayName.length < 1 ||
    value.displayName.length > interiorAssetCatalogPolicy.maximumMetadataLabelLength ||
    value.kind !== ref.kind ||
    value.materialLabel !== ref.materialLabel ||
    value.representationStatus !== "bounded-proxy" ||
    value.schemaVersion !== boundedProxyMetadataSchemaVersion ||
    value.syntheticFixture !== true ||
    value.version !== ref.version
  ) {
    throw new InteriorAssetError("ASSET_INPUT_MALFORMED");
  }
  const core = {
    allowedTargetFaces: faces,
    assetId: ref.id,
    assetVersionId: ref.versionId,
    category: ref.category,
    dimensionsSource: "explicit-creator-authored-integer-mm" as const,
    displayName: value.displayName,
    kind: ref.kind,
    materialLabel: ref.materialLabel,
    representationStatus: "bounded-proxy" as const,
    schemaVersion: boundedProxyMetadataSchemaVersion,
    syntheticFixture: true as const,
    version: ref.version,
  };
  if (ref.kind === "furnishing") {
    if (faces.length !== 1 || faces[0] !== "top") {
      throw new InteriorAssetError("ASSET_INPUT_MALFORMED");
    }
    return { ...core, allowedTargetFaces: ["top"], kind: "furnishing" };
  }
  if (ref.kind === "finish") {
    if (
      !Number.isSafeInteger(value.applicationThicknessMm) ||
      typeof value.applicationThicknessMm !== "number" ||
      value.applicationThicknessMm < 1 ||
      value.applicationThicknessMm >
        Math.min(
          ref.geometryEnvelopeMm.depthMm,
          ref.geometryEnvelopeMm.heightMm,
          ref.geometryEnvelopeMm.widthMm,
        )
    ) {
      throw new InteriorAssetError("ASSET_DIMENSIONS_INVALID");
    }
    return { ...core, applicationThicknessMm: value.applicationThicknessMm, kind: "finish" };
  }
  if (
    !Number.isSafeInteger(value.colourTemperatureKelvin) ||
    typeof value.colourTemperatureKelvin !== "number" ||
    value.colourTemperatureKelvin < 1_000 ||
    value.colourTemperatureKelvin > 20_000 ||
    !Number.isSafeInteger(value.luminousFluxLumens) ||
    typeof value.luminousFluxLumens !== "number" ||
    value.luminousFluxLumens < 1 ||
    value.luminousFluxLumens > 1_000_000 ||
    !["area", "linear", "point", "spot"].includes(String(value.lightKind))
  ) {
    throw new InteriorAssetError("ASSET_INPUT_MALFORMED");
  }
  return {
    ...core,
    allowedTargetFaces: faces,
    colourTemperatureKelvin: value.colourTemperatureKelvin,
    kind: "light",
    lightKind: value.lightKind as "area" | "linear" | "point" | "spot",
    luminousFluxLumens: value.luminousFluxLumens,
  };
}

function hashablePolicy(ref: InteriorAssetRef): unknown {
  return {
    allowedRotationMilliDegrees: ref.placementPolicy.allowedRotationMilliDegrees,
    clearanceMm: ref.placementPolicy.clearanceMm,
    forwardAxis: ref.placementPolicy.forwardAxis,
    origin: ref.placementPolicy.origin,
  };
}

function hashableRights(ref: InteriorAssetRef): unknown {
  return {
    attributionRequired: ref.rights.attributionRequired,
    derivativesAllowed: ref.rights.derivativesAllowed,
    licenceId: ref.rights.licenceId,
    redistributionAllowed: ref.rights.redistributionAllowed,
    serviceProcessingAllowed: ref.rights.serviceProcessingAllowed,
    sourceKind: ref.rights.sourceKind,
    trainingAllowed: ref.rights.trainingAllowed,
    usage: ref.rights.usage,
  };
}

function validatePlacementPolicy(ref: InteriorAssetRef): void {
  const rotations = ref.placementPolicy.allowedRotationMilliDegrees;
  const sorted = [...rotations].sort((left, right) => left - right);
  if (
    rotations.length > 4 ||
    rotations.some((rotation, index) => rotation % 90_000 !== 0 || rotation !== sorted[index])
  ) {
    throw new InteriorAssetError("ASSET_ROTATIONS_INVALID");
  }
  for (const clearance of Object.values(ref.placementPolicy.clearanceMm)) {
    if (
      !Number.isSafeInteger(clearance) ||
      clearance < 0 ||
      clearance > interiorAssetCatalogPolicy.maximumClearanceMm
    ) {
      throw new InteriorAssetError("ASSET_CLEARANCE_INVALID");
    }
  }
}

function parseRecord(value: unknown): CreatorOwnedAssetRecord {
  if (!isRecord(value)) throw new InteriorAssetError("ASSET_INPUT_MALFORMED");
  assertExactKeys(value, exactRecordKeys, "ASSET_METADATA_FORBIDDEN");
  assertNoForbiddenMetadataKeys(value);
  const ref = parseAssetRef(value.ref);
  if (!versionPattern.test(ref.version)) throw new InteriorAssetError("ASSET_INPUT_MALFORMED");
  validatePlacementPolicy(ref);
  const content = parseContent(value.content, ref);
  const metadata = parseMetadata(value.metadata, ref);
  if (
    assetSha256(content) !== ref.contentSha256 ||
    assetSha256(metadata) !== ref.metadataSha256 ||
    assetSha256(hashablePolicy(ref)) !== ref.placementPolicy.policySha256 ||
    assetSha256(hashableRights(ref)) !== ref.rights.rightsRecordSha256
  ) {
    throw new InteriorAssetError("ASSET_HASH_MISMATCH");
  }
  return { content, metadata, ref };
}

function compareRecords(left: CreatorOwnedAssetRecord, right: CreatorOwnedAssetRecord): number {
  if (left.ref.id !== right.ref.id) return left.ref.id < right.ref.id ? -1 : 1;
  if (left.ref.versionId === right.ref.versionId) return 0;
  return left.ref.versionId < right.ref.versionId ? -1 : 1;
}

function hashableCatalog(assets: readonly CreatorOwnedAssetRecord[]): unknown {
  return { assets, schemaVersion: creatorOwnedCatalogSchemaVersion };
}

export function validateAssetCatalog(value: unknown): ValidatedAssetCatalog {
  assertBoundedPlainJson(value);
  if (!isRecord(value)) throw new InteriorAssetError("ASSET_INPUT_MALFORMED");
  assertExactKeys(value, exactCatalogKeys, "ASSET_METADATA_FORBIDDEN");
  if (
    value.schemaVersion !== creatorOwnedCatalogSchemaVersion ||
    !Array.isArray(value.assets) ||
    value.assets.length < 1
  ) {
    throw new InteriorAssetError("ASSET_INPUT_MALFORMED");
  }
  if (value.assets.length > interiorAssetCatalogPolicy.maximumAssets) {
    throw new InteriorAssetError("ASSET_RESOURCE_LIMIT");
  }
  if (typeof value.manifestSha256 !== "string" || !sha256Pattern.test(value.manifestSha256)) {
    throw new InteriorAssetError("ASSET_HASH_MISMATCH");
  }
  const assets = value.assets.map(parseRecord).sort(compareRecords);
  const identities = assets.map(({ ref }) => `${ref.id}:${ref.versionId}`);
  const versionIds = assets.map(({ ref }) => ref.versionId);
  const idAndVersions = assets.map(({ ref }) => `${ref.id}:${ref.version}`);
  if (
    new Set(identities).size !== identities.length ||
    new Set(versionIds).size !== versionIds.length ||
    new Set(idAndVersions).size !== idAndVersions.length
  ) {
    throw new InteriorAssetError("ASSET_DUPLICATE");
  }
  if (assetSha256(hashableCatalog(assets)) !== value.manifestSha256) {
    throw new InteriorAssetError("ASSET_HASH_MISMATCH");
  }
  return deepFreezeAssetValue({
    assets,
    manifestSha256: value.manifestSha256,
    schemaVersion: creatorOwnedCatalogSchemaVersion,
  });
}

export function parseAssetCatalogJson(input: string | Uint8Array): ValidatedAssetCatalog {
  let json: string;
  if (typeof input === "string") {
    if (Buffer.byteLength(input, "utf8") > interiorAssetCatalogPolicy.maximumCatalogBytes) {
      throw new InteriorAssetError("ASSET_RESOURCE_LIMIT");
    }
    json = input;
  } else {
    if (input.byteLength > interiorAssetCatalogPolicy.maximumCatalogBytes) {
      throw new InteriorAssetError("ASSET_RESOURCE_LIMIT");
    }
    try {
      json = new TextDecoder("utf-8", { fatal: true }).decode(input);
    } catch (error) {
      throw new InteriorAssetError("ASSET_INPUT_MALFORMED", { cause: error });
    }
  }
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch (error) {
    throw new InteriorAssetError("ASSET_INPUT_MALFORMED", { cause: error });
  }
  return validateAssetCatalog(value);
}

export function createValidatedAssetCatalog(
  records: readonly CreatorOwnedAssetRecord[],
): ValidatedAssetCatalog {
  const assets = [...records].sort(compareRecords);
  const catalog: CreatorOwnedAssetCatalog = {
    assets,
    manifestSha256: assetSha256(hashableCatalog(assets)),
    schemaVersion: creatorOwnedCatalogSchemaVersion,
  };
  return validateAssetCatalog(catalog);
}

export function findAssetRecord(
  catalog: ValidatedAssetCatalog,
  assetId: string,
  assetVersionId?: string,
): CreatorOwnedAssetRecord | undefined {
  return catalog.assets.find(
    ({ ref }) =>
      ref.id === assetId && (assetVersionId === undefined || ref.versionId === assetVersionId),
  );
}
