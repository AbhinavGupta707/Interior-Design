import { createHash } from "node:crypto";

import {
  c10DefaultCompileConfiguration,
  catalogAssetVersionSchema,
  catalogReleaseSchema,
  sceneArtifactSchema,
  sceneJobSchema,
  sceneManifestSchema,
  sceneRecordSchema,
  specificationSchema,
  type CatalogArtifact,
  type CatalogAssetVersion,
  type CatalogMaterialDefinition,
  type RenderProfile,
  type SceneElementMapping,
} from "@interior-design/contracts";
import {
  canonicalizeHomeSnapshot,
  canonicalizeIJson,
  canonicalizeIJsonBytes,
} from "@interior-design/domain-model";

import type { RenderSceneBuildInput } from "../src/index.js";

export const ids = Object.freeze({
  actor: "60000000-0000-4000-8000-000000000001",
  areaLight: "60000000-0000-4000-8000-000000000005",
  asset: "60000000-0000-4000-8000-000000000010",
  assetVersion: "60000000-0000-4000-8000-000000000011",
  branch: "60000000-0000-4000-8000-000000000012",
  bundle: "60000000-0000-4000-8000-000000000013",
  camera: "60000000-0000-4000-8000-000000000003",
  claim: "60000000-0000-4000-8000-000000000014",
  commit: "60000000-0000-4000-8000-000000000015",
  confirmation: "60000000-0000-4000-8000-000000000016",
  daylight: "60000000-0000-4000-8000-000000000006",
  furnishing: "60000000-0000-4000-8000-000000000002",
  level: "60000000-0000-4000-8000-000000000001",
  line: "60000000-0000-4000-8000-000000000017",
  material: "60000000-0000-4000-8000-000000000018",
  model: "60000000-0000-4000-8000-000000000019",
  option: "60000000-0000-4000-8000-00000000001a",
  optionJob: "60000000-0000-4000-8000-00000000001b",
  pointLight: "60000000-0000-4000-8000-000000000004",
  project: "60000000-0000-4000-8000-00000000001c",
  scene: "60000000-0000-4000-8000-00000000001d",
  sceneArtifact: "60000000-0000-4000-8000-00000000001e",
  sceneJob: "60000000-0000-4000-8000-00000000001f",
  snapshot: "60000000-0000-4000-8000-000000000020",
  specification: "60000000-0000-4000-8000-000000000021",
});

export function hash(seed: string): string {
  return createHash("sha256").update(seed, "utf8").digest("hex");
}

function uuid(namespace: string): string {
  const bytes = Buffer.from(
    createHash("sha256").update(namespace, "utf8").digest().subarray(0, 16),
  );
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const value = bytes.toString("hex");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function attribution() {
  return {
    actorUserId: ids.actor,
    claimId: ids.claim,
    evidenceIds: [],
    method: { kind: "fixture" as const, name: "c14-byte-fixture", version: "1" },
    state: "user-asserted" as const,
    verification: { status: "not-reviewed" as const },
  };
}

function known<T>(value: T) {
  return { attribution: attribution(), knowledge: "known" as const, value };
}

function snapshot(cameraTarget = { xMm: 1_000, yMm: 2_000, zMm: 1_200 }) {
  return {
    coordinateSystem: {
      axes: { x: "east" as const, y: "north" as const, z: "up" as const },
      globalAnchor: { status: "not-established" as const },
      handedness: "right" as const,
      kind: "local-cartesian" as const,
      lengthUnit: "mm" as const,
      originConvention: "project-local-model-origin" as const,
    },
    derivedFromSnapshotSha256: hash("existing-source"),
    elements: {
      cameras: [
        {
          elementType: "camera" as const,
          id: ids.camera,
          levelId: ids.level,
          name: known("Fixture camera"),
          origin: attribution(),
          position: known({ xMm: 1_000, yMm: 1_000, zMm: 1_600 }),
          target: known(cameraTarget),
          verticalFovMilliDegrees: known(60_000),
        },
      ],
      finishes: [],
      fixedObjects: [],
      furnishings: [
        {
          category: known("Fixture chair"),
          dimensions: known({ depthMm: 500, heightMm: 800, widthMm: 500 }),
          elementType: "furnishing" as const,
          id: ids.furnishing,
          levelId: ids.level,
          name: known("Fixture furnishing"),
          origin: attribution(),
          placement: {
            position: known({ xMm: 1_000, yMm: 1_000, zMm: 0 }),
            rotationMilliDegrees: known(0),
          },
        },
      ],
      levels: [
        {
          elementType: "level" as const,
          elevationMm: known(0),
          id: ids.level,
          name: known("Fixture level"),
          origin: attribution(),
          storeyHeightMm: known(2_700),
        },
      ],
      lights: [
        {
          colourTemperatureKelvin: known(3_000),
          elementType: "light" as const,
          id: ids.pointLight,
          kind: "point" as const,
          levelId: ids.level,
          luminousFluxLumens: known(800),
          name: known("Fixture point light"),
          origin: attribution(),
          position: known({ xMm: 2_000, yMm: 2_000, zMm: 2_400 }),
        },
        {
          colourTemperatureKelvin: known(3_000),
          elementType: "light" as const,
          id: ids.areaLight,
          kind: "area" as const,
          levelId: ids.level,
          luminousFluxLumens: known(500),
          name: known("Fixture area light"),
          origin: attribution(),
          position: known({ xMm: 1_000, yMm: 1_000, zMm: 2_300 }),
        },
        {
          colourTemperatureKelvin: known(6_500),
          elementType: "light" as const,
          id: ids.daylight,
          kind: "daylight-reference" as const,
          levelId: ids.level,
          luminousFluxLumens: known(1_000),
          name: known("Fixture daylight reference"),
          origin: attribution(),
          position: known({ xMm: 0, yMm: 0, zMm: 2_500 }),
        },
      ],
      openings: [],
      spaces: [],
      stairs: [],
      surfaces: [],
      walls: [],
    },
    knownLimitations: [
      { code: "SYNTHETIC_FIXTURE_ONLY", detail: "Byte-only deterministic fixture." },
    ],
    modelId: ids.model,
    profile: "proposed" as const,
    projectId: ids.project,
    schemaVersion: "c4-canonical-home-v1" as const,
  };
}

function artifact(
  role: CatalogArtifact["role"],
  seed: string,
  image?: NonNullable<CatalogArtifact["image"]>,
): CatalogArtifact {
  const sha256 = hash(seed);
  return {
    artifactId: uuid(`artifact:${seed}`),
    byteLength: 100,
    derivation: {
      configurationSha256: hash(`config:${seed}`),
      sourceSha256: [hash(`source:${seed}`)],
      tool: "c14-byte-fixture",
      toolVersion: "1.0.0",
    },
    ...(image === undefined ? {} : { image }),
    mediaType:
      role === "model"
        ? "model/gltf-binary"
        : role === "thumbnail" || role === "texture"
          ? "image/png"
          : "text/plain; charset=utf-8",
    objectKey: `catalog/sha256/${sha256.slice(0, 2)}/${sha256}`,
    role,
    schemaVersion: "c13-catalog-artifact-v1",
    sha256,
  };
}

function catalog(withTexture: boolean) {
  const rightsSha256 = hash("rights");
  const model = artifact("model", "model");
  const thumbnail = artifact("thumbnail", "thumbnail", {
    colourEncoding: "srgb",
    heightPx: 512,
    semantic: "thumbnail",
    widthPx: 512,
  });
  const licence = artifact("licence-text", "licence");
  const receipt = artifact("source-receipt", "receipt");
  const texture = artifact("texture", "texture", {
    colourEncoding: "srgb",
    heightPx: 512,
    semantic: "base-colour",
    widthPx: 512,
  });
  const artifacts = withTexture
    ? [model, thumbnail, licence, receipt, texture]
    : [model, thumbnail, licence, receipt];
  const c12Asset = {
    category: "Fixture chair",
    contentSha256: hash("asset-content"),
    geometryEnvelopeMm: { depthMm: 500, heightMm: 800, widthMm: 500 },
    id: ids.asset,
    kind: "furnishing" as const,
    materialLabel: "Fixture neutral",
    metadataSha256: hash("asset-metadata"),
    placementPolicy: {
      allowedRotationMilliDegrees: [0],
      clearanceMm: { back: 0, front: 500, left: 0, right: 0 },
      forwardAxis: "positive-y" as const,
      origin: "bounding-box-centre-floor" as const,
      policySha256: hash("placement-policy"),
    },
    representationStatus: "bounded-proxy" as const,
    rights: {
      attributionRequired: false as const,
      derivativesAllowed: true as const,
      licenceId: "LicenseRef-InteriorDesign-CreatorOwned-Synthetic" as const,
      redistributionAllowed: false as const,
      rightsRecordSha256: rightsSha256,
      serviceProcessingAllowed: true as const,
      sourceKind: "creator-owned-synthetic" as const,
      trainingAllowed: false as const,
      usage: "service-and-derived-designs" as const,
    },
    schemaVersion: "c12-interior-asset-ref-v1" as const,
    version: "1.0.0",
    versionId: ids.assetVersion,
  };
  const projectionBody = {
    c12Asset,
    coordinateTransform: "gltf-front-positive-z-to-interior-forward-positive-y-v1" as const,
    floorCentredPivot: true as const,
    gltfMetresToInteriorMillimetres: 1_000 as const,
    schemaVersion: "c13-placement-projection-v1" as const,
  };
  const material: CatalogMaterialDefinition = {
    baseColourSrgb8: [120, 110, 100],
    emissiveSrgb8: [0, 0, 0],
    materialId: ids.material,
    metallicBasisPoints: 0,
    name: "Fixture material",
    opaque: true,
    physicalRepeatMm: { heightMm: 500, widthMm: 500 },
    roughnessBasisPoints: 7_000,
    schemaVersion: "c13-material-definition-v1",
    textureArtifactIds: withTexture ? [texture.artifactId] : [],
    uvSet: 0,
  };
  const versionBody = {
    artifacts,
    assetId: ids.asset,
    category: "Fixture chair",
    commercialData: {
      delivery: "not-provided" as const,
      liveAvailability: "not-provided" as const,
      price: "not-provided" as const,
      supplier: "not-provided" as const,
    },
    description: "Creator-authored byte fixture.",
    displayName: "Fixture chair",
    kind: "furnishing" as const,
    lifecycle: "approved" as const,
    materials: [material],
    placementProjection: {
      ...projectionBody,
      projectionSha256: hashCanonical(projectionBody),
    },
    rights: {
      concludedLicenceExpression: "LicenseRef-InteriorDesign-CreatorOwned-Synthetic",
      creator: "Interior Design fixture",
      declaredLicenceExpression: "LicenseRef-InteriorDesign-CreatorOwned-Synthetic",
      grants: {
        commercialUse: true,
        derivatives: true,
        rawRedistribution: false,
        renderedOutputDistribution: true,
        thumbnailDisplay: true,
      },
      licenceTextArtifactSha256: licence.sha256,
      policy: { serviceProcessingAllowed: true, trainingAllowed: false as const },
      recordSha256: rightsSha256,
      review: {
        reviewedAt: "2026-07-18T12:00:00.000Z",
        reviewerUserId: ids.actor,
        state: "approved" as const,
      },
      schemaVersion: "c13-catalog-rights-record-v1" as const,
      sourceKind: "creator-owned-synthetic" as const,
      sourceReceiptArtifactSha256: receipt.sha256,
      spdxLicenseListVersion: "3.0.1",
    },
    schemaVersion: "c13-catalog-asset-version-v1" as const,
    tags: ["fixture"],
    version: "1.0.0",
    versionId: ids.assetVersion,
  };
  const asset = catalogAssetVersionSchema.parse({
    ...versionBody,
    versionSha256: hashCanonical(versionBody),
  });
  const releaseManifest = {
    assets: [
      { assetId: asset.assetId, versionId: asset.versionId, versionSha256: asset.versionSha256 },
    ],
    createdAt: "2026-07-18T12:00:00.000Z",
    releaseVersion: "1.0.0",
    schemaVersion: "c13-catalog-release-manifest-v1",
  };
  const releaseManifestBytes = canonicalizeIJsonBytes(releaseManifest);
  const manifestSha256 = hashBytes(releaseManifestBytes);
  const release = catalogReleaseSchema.parse({
    assetVersionIds: [asset.versionId],
    createdAt: releaseManifest.createdAt,
    manifestSha256,
    releaseId: uuid(`c13:release:${manifestSha256}`),
    schemaVersion: "c13-catalog-release-v1",
    status: "published",
    version: "1.0.0",
  });
  return { asset, release, releaseManifestBytes };
}

function hashCanonical(value: unknown): string {
  return createHash("sha256").update(canonicalizeIJson(value), "utf8").digest("hex");
}

function hashBytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function c13Binding(line: ReturnType<typeof specification>["currentRevision"]["lines"][number]) {
  return {
    assetContentSha256: line.assetContentSha256,
    assetMetadataSha256: line.assetMetadataSha256,
    assetVersionId: line.assetVersionId,
    assetVersionSha256: line.assetVersionSha256,
    placementPolicySha256: line.placementPolicySha256,
    placementProjectionSha256: line.placementProjectionSha256,
    representation: "parametric-bounded-not-vendor-fidelity",
    rightsRecordSha256: line.rightsRecordSha256,
  };
}

function specification(
  snapshotSha256: string,
  asset: CatalogAssetVersion,
  release: ReturnType<typeof catalog>["release"],
) {
  const c12 = asset.placementProjection.c12Asset;
  const line = {
    assetContentSha256: c12.contentSha256,
    assetMetadataSha256: c12.metadataSha256,
    assetVersionId: asset.versionId,
    assetVersionSha256: asset.versionSha256,
    catalogReleaseId: release.releaseId,
    catalogReleaseSha256: release.manifestSha256,
    decisionStatus: "selected" as const,
    elementId: ids.furnishing,
    kind: "furnishing" as const,
    levelId: ids.level,
    lineId: ids.line,
    notes: "",
    placementPolicySha256: c12.placementPolicy.policySha256,
    placementProjectionSha256: asset.placementProjection.projectionSha256,
    quantity: { count: 1 as const, state: "counted" as const },
    rightsRecordSha256: asset.rights.recordSha256,
    roomAssignment: {
      reason: "No room geometry in the byte fixture.",
      status: "review-required" as const,
    },
    schemaVersion: "c13-specification-line-v1" as const,
    selectionSource: { confirmationId: ids.confirmation, kind: "confirmed-option" as const },
  };
  const sourceConfirmation = {
    acceptedBrief: { briefId: uuid("brief"), contentSha256: hash("brief"), revision: 1 },
    assetManifestSha256: hash("c12-assets"),
    branchId: ids.branch,
    branchRevision: 1,
    bundleId: ids.bundle,
    bundleSha256: hash("bundle"),
    candidateSnapshotSha256: snapshotSha256,
    commitId: ids.commit,
    confirmationId: ids.confirmation,
    jobId: ids.optionJob,
    jobVersion: 1,
    modelId: ids.model,
    optionId: ids.option,
    optionSetSha256: hash("option-set"),
    profile: "proposed" as const,
    resultSnapshotId: ids.snapshot,
    resultSnapshotSha256: snapshotSha256,
    resultSnapshotVersion: 1,
  };
  const revisionBody = {
    branchId: ids.branch,
    branchRevision: 1,
    catalogReleaseId: release.releaseId,
    catalogReleaseSha256: release.manifestSha256,
    createdAt: "2026-07-18T12:01:00.000Z",
    createdBy: ids.actor,
    lines: [line],
    modelSnapshotId: ids.snapshot,
    modelSnapshotSha256: snapshotSha256,
    revision: 1,
    schemaVersion: "c13-specification-revision-v1" as const,
    sourceConfirmation,
  };
  return specificationSchema.parse({
    currentRevision: { ...revisionBody, revisionSha256: hashCanonical(revisionBody) },
    projectId: ids.project,
    schemaVersion: "c13-specification-v1",
    selectionBoard: {
      entries: [
        {
          assetVersionId: asset.versionId,
          elementId: ids.furnishing,
          note: "",
          state: "selected",
        },
      ],
      revision: 1,
      schemaVersion: "c13-selection-board-v1",
    },
    specificationId: ids.specification,
    status: "working",
  });
}

function commonExtras(elementId: string, elementType: string) {
  return {
    authority: "derived-visualisation-only",
    canonicalElementId: elementId,
    canonicalElementType: elementType,
    ...(elementType === "level" ? {} : { levelId: ids.level }),
    provenanceState: "user-asserted",
  };
}

export function glbFromJsonAndBinary(
  json: Readonly<Record<string, unknown>>,
  binary: Uint8Array,
): Uint8Array {
  return glbFromJsonText(canonicalizeIJson(json), binary);
}

export function glbFromJsonText(jsonText: string, binary: Uint8Array): Uint8Array {
  const rawJson = new TextEncoder().encode(jsonText);
  const jsonLength = Math.ceil(rawJson.byteLength / 4) * 4;
  const binaryLength = Math.ceil(binary.byteLength / 4) * 4;
  const total = 12 + 8 + jsonLength + (binaryLength === 0 ? 0 : 8 + binaryLength);
  const output = new Uint8Array(total);
  output.fill(0x20, 20, 20 + jsonLength);
  output.set(rawJson, 20);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  if (binaryLength > 0) {
    const offset = 20 + jsonLength;
    view.setUint32(offset, binaryLength, true);
    view.setUint32(offset + 4, 0x004e4942, true);
    output.set(binary, offset + 8);
  }
  return output;
}

function sceneGlb(spec: ReturnType<typeof specification>) {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const indices = new Uint32Array([0, 1, 2]);
  const binary = new Uint8Array(positions.byteLength + normals.byteLength + indices.byteLength);
  binary.set(new Uint8Array(positions.buffer), 0);
  binary.set(new Uint8Array(normals.buffer), positions.byteLength);
  binary.set(new Uint8Array(indices.buffer), positions.byteLength + normals.byteLength);
  const revision = spec.currentRevision;
  const line = revision.lines[0];
  if (line === undefined) throw new Error("C14 fixture requires one specification line.");
  const json = {
    accessors: [
      { bufferView: 0, componentType: 5_126, count: 3, type: "VEC3" },
      { bufferView: 1, componentType: 5_126, count: 3, type: "VEC3" },
      { bufferView: 2, componentType: 5_125, count: 3, type: "SCALAR" },
    ],
    asset: {
      extras: {
        c13SpecificationBinding: {
          authority: "catalog-metadata-on-parametric-scene",
          catalogReleaseId: revision.catalogReleaseId,
          catalogReleaseSha256: revision.catalogReleaseSha256,
          specificationId: spec.specificationId,
          specificationRevision: revision.revision,
          specificationRevisionSha256: revision.revisionSha256,
        },
      },
      generator: "interior-design-scene-compiler/1.0.0",
      version: "2.0",
    },
    bufferViews: [
      { buffer: 0, byteLength: positions.byteLength, byteOffset: 0, target: 34_962 },
      {
        buffer: 0,
        byteLength: normals.byteLength,
        byteOffset: positions.byteLength,
        target: 34_962,
      },
      {
        buffer: 0,
        byteLength: indices.byteLength,
        byteOffset: positions.byteLength + normals.byteLength,
        target: 34_963,
      },
    ],
    buffers: [{ byteLength: binary.byteLength }],
    cameras: [
      {
        extras: {
          canonicalElementId: ids.camera,
          targetMm: { xMm: 1_000, yMm: 2_000, zMm: 1_200 },
        },
        name: `camera:${ids.camera}`,
        perspective: { yfov: 1.0471975803375244, znear: 0.01 },
        type: "perspective",
      },
    ],
    extensions: {
      KHR_lights_punctual: {
        lights: [
          {
            color: [1, 0.6949030160903931, 0.43104803562164307],
            extras: {
              canonicalElementId: ids.pointLight,
              colourTemperatureKelvin: 3_000,
              luminousFluxLumens: 800,
            },
            intensity: 63.6619758605957,
            name: `light:${ids.pointLight}`,
            type: "point",
          },
        ],
      },
    },
    extensionsUsed: ["KHR_lights_punctual"],
    materials: [
      {
        doubleSided: true,
        extras: {
          authority: "derived-visualisation-only",
          canonicalElementType: "furnishing",
          provenanceState: "user-asserted",
        },
        name: "base:furnishing:user-asserted",
        pbrMetallicRoughness: {
          baseColorFactor: [0.46, 0.5, 0.54, 1],
          metallicFactor: 0,
          roughnessFactor: 0.82,
        },
      },
    ],
    meshes: [
      {
        name: `mesh:${ids.furnishing}`,
        primitives: [
          {
            attributes: { NORMAL: 1, POSITION: 0 },
            indices: 2,
            material: 0,
            mode: 4,
          },
        ],
      },
    ],
    nodes: [
      { extras: commonExtras(ids.level, "level"), name: `level:${ids.level}` },
      {
        extras: {
          ...commonExtras(ids.furnishing, "furnishing"),
          c13CatalogBinding: c13Binding(line),
          geometryRole: "bounded-proxy",
        },
        mesh: 0,
        name: `furnishing:${ids.furnishing}`,
      },
      {
        camera: 0,
        extras: commonExtras(ids.camera, "camera"),
        name: `camera:${ids.camera}`,
        rotation: [0, 0, 0, 1],
        translation: [1, 1.6, -1],
      },
      {
        extensions: { KHR_lights_punctual: { light: 0 } },
        extras: commonExtras(ids.pointLight, "light"),
        name: `light:${ids.pointLight}`,
        translation: [2, 2.4, -2],
      },
      {
        extras: commonExtras(ids.areaLight, "light"),
        name: `light:${ids.areaLight}`,
        translation: [1, 2.3, -1],
      },
      {
        extras: commonExtras(ids.daylight, "light"),
        name: `light:${ids.daylight}`,
        translation: [0, 2.5, 0],
      },
    ],
    scene: 0,
    scenes: [{ nodes: [0, 1, 2, 3, 4, 5] }],
  };
  return { binary, bytes: glbFromJsonAndBinary(json, binary), json };
}

function mapping(
  elementId: string,
  elementType: SceneElementMapping["elementType"],
  nodeIndex: number,
  extras: Partial<Pick<SceneElementMapping, "materialIndices" | "meshIndices">> = {},
): SceneElementMapping {
  return {
    elementId,
    elementType,
    findingCodes: [],
    materialIndices: extras.materialIndices ?? [],
    meshIndices: extras.meshIndices ?? [],
    nodeIndices: [nodeIndex],
    status: "mapped",
  };
}

export interface FixtureOptions {
  readonly cameraTarget?: { readonly xMm: number; readonly yMm: number; readonly zMm: number };
  readonly withTexture?: boolean;
}

export interface RenderFixture {
  readonly binary: Uint8Array;
  readonly glbJson: Readonly<Record<string, unknown>>;
  readonly input: RenderSceneBuildInput;
}

export function renderFixture(options: FixtureOptions = {}): RenderFixture {
  const canonicalSnapshot = snapshot(options.cameraTarget);
  const canonical = canonicalizeHomeSnapshot(canonicalSnapshot);
  const catalogData = catalog(options.withTexture ?? false);
  const specificationData = specification(
    canonical.snapshotSha256,
    catalogData.asset,
    catalogData.release,
  );
  const glb = sceneGlb(specificationData);
  const sourceSnapshot = {
    modelId: ids.model,
    profile: "proposed" as const,
    projectId: ids.project,
    schemaVersion: "c4-canonical-home-v1" as const,
    snapshotId: ids.snapshot,
    snapshotSha256: canonical.snapshotSha256,
  };
  const elementMappings = [
    mapping(ids.level, "level", 0),
    mapping(ids.furnishing, "furnishing", 1, { materialIndices: [0], meshIndices: [0] }),
    mapping(ids.camera, "camera", 2),
    mapping(ids.pointLight, "light", 3),
    mapping(ids.areaLight, "light", 4),
    mapping(ids.daylight, "light", 5),
  ].sort((left, right) =>
    left.elementId < right.elementId ? -1 : left.elementId > right.elementId ? 1 : 0,
  );
  const manifest = sceneManifestSchema.parse({
    authority: "derived-visualisation-only",
    boundsMm: {
      maximum: { xMm: 2_000, yMm: 2_000, zMm: 2_500 },
      minimum: { xMm: 0, yMm: 0, zMm: 0 },
    },
    compiler: {
      configuration: c10DefaultCompileConfiguration,
      configurationSha256: hashCanonical(c10DefaultCompileConfiguration),
      name: "interior-design-scene-compiler",
      version: "1.0.0",
    },
    coordinateSystem: {
      canonicalAxes: "+X east, +Y north, +Z up",
      gltfAxes: "+Y up, +Z forward, right-handed",
      mapping: "[Xmm/1000, Zmm/1000, -Ymm/1000]",
      outputLengthUnit: "metre",
    },
    counts: { materials: 1, meshes: 1, nodes: 6, triangles: 1, vertices: 3 },
    determinismKeySha256: hash("c10-determinism"),
    elementMappings,
    findings: [],
    gltf: { container: "GLB", specificationVersion: "2.0" },
    schemaVersion: "c10-scene-manifest-v1",
    sourceSnapshot,
  });
  const artifact = sceneArtifactSchema.parse({
    byteSize: glb.bytes.byteLength,
    glbSha256: hashBytes(glb.bytes),
    id: ids.sceneArtifact,
    manifestSha256: hashBytes(canonicalizeIJsonBytes(manifest)),
    mimeType: "model/gltf-binary",
    schemaVersion: "c10-scene-artifact-v1",
  });
  const scene = sceneRecordSchema.parse({
    artifact,
    createdAt: "2026-07-18T12:02:00.000Z",
    createdBy: ids.actor,
    id: ids.scene,
    manifest,
    projectId: ids.project,
  });
  const sceneJob = sceneJobSchema.parse({
    attempt: 1,
    createdAt: "2026-07-18T12:02:00.000Z",
    createdBy: ids.actor,
    id: ids.sceneJob,
    projectId: ids.project,
    request: {
      configuration: c10DefaultCompileConfiguration,
      label: "C14 fixture",
      sourceSnapshot,
    },
    sceneId: ids.scene,
    state: "succeeded",
    updatedAt: "2026-07-18T12:02:01.000Z",
    version: 1,
  });
  const profile: RenderProfile = {
    blenderBuildHash: "blender-build-fixture-v1",
    blenderVersion: "5.2.0-fixture",
    colourManagement: {
      displayDevice: "sRGB",
      look: "AgX - Medium High Contrast",
      viewTransform: "AgX",
    },
    denoise: "open-image-denoise",
    device: "cpu",
    engine: "cycles",
    heightPx: 512,
    profileId: "cycles-cpu-geometry-safe-v1",
    samples: 64,
    seed: 14,
    threads: 2,
    transparentBackground: false,
    widthPx: 512,
  };
  return {
    binary: glb.binary,
    glbJson: glb.json,
    input: {
      camera: { cameraId: ids.camera, clipEndMm: 100_000, clipStartMm: 10 },
      canonicalSnapshot,
      catalogAssetVersions: [catalogData.asset],
      catalogRelease: catalogData.release,
      catalogReleaseManifestBytes: catalogData.releaseManifestBytes,
      profile,
      rendererScriptSha256: hash("renderer-script"),
      scene,
      sceneGlb: glb.bytes,
      sceneJob,
      specification: specificationData,
    },
  };
}

export function replaceFixtureGlb(fixture: RenderFixture, bytes: Uint8Array): RenderFixture {
  const scene = structuredClone(fixture.input.scene);
  const mutableArtifact = scene.artifact as typeof scene.artifact & {
    byteSize: number;
    glbSha256: string;
  };
  mutableArtifact.byteSize = bytes.byteLength;
  mutableArtifact.glbSha256 = hashBytes(bytes);
  return {
    ...fixture,
    input: { ...fixture.input, scene, sceneGlb: bytes },
  };
}
