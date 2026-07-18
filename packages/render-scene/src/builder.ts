import {
  c13CatalogPolicy,
  catalogAssetVersionSchema,
  catalogReleaseSchema,
  renderProfileSchema,
  renderSceneManifestSchema,
  sceneJobSchema,
  sceneRecordSchema,
  specificationSchema,
  type CanonicalHomeSnapshot,
  type CatalogAssetVersion,
  type CatalogRelease,
  type RenderCamera,
  type RenderSceneManifest,
  type SceneElementMapping,
  type SceneJob,
  type SceneRecord,
  type Specification,
  type SpecificationLine,
} from "@interior-design/contracts";
import {
  canonicalizeHomeSnapshot,
  parseIJson,
  type CanonicalHomeSnapshotDocument,
} from "@interior-design/domain-model";

import {
  compareRenderStrings,
  deepFreezeRenderValue,
  deterministicRenderUuid,
  exactKeys,
  isPlainRecord,
  renderSceneCanonicalBytes,
  renderSceneCanonicalJson,
  sha256Bytes,
  sha256Canonical,
  sha256Pattern,
  uuidPattern,
} from "./canonical.js";
import { deriveBlenderCamera, pointLightPowerWatts } from "./camera.js";
import { failRenderScene } from "./errors.js";
import { parseProtectedC10Glb, type ParsedRenderGlb } from "./glb.js";
import { segmentationPaletteForElementIds } from "./segmentation.js";
import {
  c14RenderSceneHashEnvelopeVersion,
  renderScenePackageVersion,
  type BuiltRenderScene,
  type RenderSceneBuildInput,
  type RenderSceneHashEnvelope,
} from "./types.js";

type RenderMaterial = RenderSceneManifest["materials"][number];
type RenderFinding = RenderSceneManifest["findings"][number];
type RenderLight = RenderSceneManifest["lights"][number];

const neutralFallback = Object.freeze({
  baseColourSrgb8: [153, 153, 153] as const,
  emissiveSrgb8: [0, 0, 0] as const,
  metallicBasisPoints: 0,
  roughnessBasisPoints: 8_000,
});
const safePinnedVersionPattern = /^[A-Za-z0-9][A-Za-z0-9 ._+-]{0,119}$/u;

function parseSceneJob(input: unknown): SceneJob {
  renderSceneCanonicalJson(input);
  const parsed = sceneJobSchema.safeParse(input);
  if (!parsed.success) return failRenderScene("INPUT_INVALID");
  return parsed.data;
}

function parseScene(input: unknown): SceneRecord {
  renderSceneCanonicalJson(input);
  const parsed = sceneRecordSchema.safeParse(input);
  if (!parsed.success) return failRenderScene("INPUT_INVALID");
  return parsed.data;
}

function parseSpecification(input: unknown): Specification {
  renderSceneCanonicalJson(input);
  const parsed = specificationSchema.safeParse(input);
  if (!parsed.success) return failRenderScene("INPUT_INVALID");
  return parsed.data;
}

function parseCatalogRelease(input: unknown): CatalogRelease {
  renderSceneCanonicalJson(input);
  const parsed = catalogReleaseSchema.safeParse(input);
  if (!parsed.success) return failRenderScene("INPUT_INVALID");
  return parsed.data;
}

function parseCatalogAssets(input: readonly unknown[]): readonly CatalogAssetVersion[] {
  renderSceneCanonicalJson(input);
  if (input.length > c13CatalogPolicy.maximumAssetsPerRelease) {
    return failRenderScene("INPUT_INVALID");
  }
  return input.map((candidate) => {
    const parsed = catalogAssetVersionSchema.safeParse(candidate);
    if (!parsed.success) return failRenderScene("INPUT_INVALID");
    return parsed.data;
  });
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function exactCanonicalEqual(left: unknown, right: unknown): boolean {
  return renderSceneCanonicalJson(left) === renderSceneCanonicalJson(right);
}

function verifyC10Source(input: {
  readonly canonical: CanonicalHomeSnapshotDocument;
  readonly glb: ParsedRenderGlb;
  readonly glbBytes: Uint8Array;
  readonly scene: SceneRecord;
  readonly sceneJob: SceneJob;
}): void {
  const { canonical, glb, glbBytes, scene, sceneJob } = input;
  if (
    sceneJob.state !== "succeeded" ||
    sceneJob.sceneId !== scene.id ||
    sceneJob.projectId !== scene.projectId ||
    !exactCanonicalEqual(sceneJob.request.sourceSnapshot, scene.manifest.sourceSnapshot)
  ) {
    return failRenderScene("C10_BINDING_MISMATCH");
  }
  const manifestBytes = renderSceneCanonicalBytes(scene.manifest);
  if (
    scene.artifact.byteSize !== glbBytes.byteLength ||
    scene.artifact.glbSha256 !== sha256Bytes(glbBytes) ||
    scene.artifact.manifestSha256 !== sha256Bytes(manifestBytes)
  ) {
    return failRenderScene("SOURCE_HASH_MISMATCH");
  }
  const source = scene.manifest.sourceSnapshot;
  if (
    canonical.snapshotSha256 !== source.snapshotSha256 ||
    canonical.snapshot.projectId !== source.projectId ||
    canonical.snapshot.modelId !== source.modelId ||
    canonical.snapshot.profile !== source.profile ||
    scene.projectId !== canonical.snapshot.projectId
  ) {
    return failRenderScene("CANONICAL_SOURCE_MISMATCH");
  }
  if (
    glb.counts.materials !== scene.manifest.counts.materials ||
    glb.counts.meshes !== scene.manifest.counts.meshes ||
    glb.counts.nodes !== scene.manifest.counts.nodes ||
    glb.counts.triangles !== scene.manifest.counts.triangles ||
    glb.counts.vertices !== scene.manifest.counts.vertices
  ) {
    return failRenderScene("C10_BINDING_MISMATCH");
  }
  const nodes: readonly unknown[] = Array.isArray(glb.json.nodes)
    ? (glb.json.nodes as readonly unknown[])
    : [];
  const ownedNodes = new Set<number>();
  for (const mapping of scene.manifest.elementMappings) {
    for (const nodeIndex of mapping.nodeIndices) {
      if (ownedNodes.has(nodeIndex)) return failRenderScene("C10_BINDING_MISMATCH");
      ownedNodes.add(nodeIndex);
      const node = nodes[nodeIndex];
      if (!isPlainRecord(node) || !isPlainRecord(node.extras)) {
        return failRenderScene("C10_BINDING_MISMATCH");
      }
      if (node.extras.canonicalElementId !== mapping.elementId) {
        return failRenderScene("C10_BINDING_MISMATCH");
      }
    }
  }
  if (ownedNodes.size !== glb.counts.nodes) return failRenderScene("C10_BINDING_MISMATCH");
}

interface ReleaseManifestAssetPin {
  readonly assetId: string;
  readonly versionId: string;
  readonly versionSha256: string;
}

function parseReleaseManifest(
  bytes: Uint8Array,
  release: CatalogRelease,
): readonly ReleaseManifestAssetPin[] {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength < 2 ||
    bytes.byteLength > c13CatalogPolicy.maximumReleaseManifestBytes ||
    sha256Bytes(bytes) !== release.manifestSha256
  ) {
    return failRenderScene("SOURCE_HASH_MISMATCH");
  }
  let parsed: unknown;
  try {
    parsed = parseIJson(bytes);
  } catch {
    return failRenderScene("INPUT_INVALID");
  }
  if (!isPlainRecord(parsed) || !bytesEqual(renderSceneCanonicalBytes(parsed), bytes)) {
    return failRenderScene("INPUT_INVALID");
  }
  if (
    !exactKeys(parsed, ["assets", "createdAt", "releaseVersion", "schemaVersion"]) ||
    parsed.schemaVersion !== "c13-catalog-release-manifest-v1" ||
    parsed.createdAt !== release.createdAt ||
    parsed.releaseVersion !== release.version ||
    !Array.isArray(parsed.assets)
  ) {
    return failRenderScene("C13_BINDING_MISMATCH");
  }
  const pins = parsed.assets.map((candidate) => {
    if (
      !isPlainRecord(candidate) ||
      !exactKeys(candidate, ["assetId", "versionId", "versionSha256"]) ||
      typeof candidate.assetId !== "string" ||
      typeof candidate.versionId !== "string" ||
      typeof candidate.versionSha256 !== "string" ||
      !uuidPattern.test(candidate.assetId) ||
      !uuidPattern.test(candidate.versionId) ||
      !sha256Pattern.test(candidate.versionSha256)
    ) {
      return failRenderScene("C13_BINDING_MISMATCH");
    }
    return {
      assetId: candidate.assetId,
      versionId: candidate.versionId,
      versionSha256: candidate.versionSha256,
    };
  });
  if (
    pins.length < 1 ||
    pins.length > c13CatalogPolicy.maximumAssetsPerRelease ||
    pins.some(({ versionId }, index) => {
      const previous = pins[index - 1];
      return previous !== undefined && previous.versionId >= versionId;
    }) ||
    release.assetVersionIds.length !== pins.length ||
    release.assetVersionIds.some((versionId, index) => versionId !== pins[index]?.versionId) ||
    release.releaseId !== deterministicRenderUuid(`c13:release:${release.manifestSha256}`)
  ) {
    return failRenderScene("C13_BINDING_MISMATCH");
  }
  return pins;
}

function verifyCatalogAsset(asset: CatalogAssetVersion): void {
  if (
    asset.lifecycle !== "approved" ||
    asset.rights.review.state !== "approved" ||
    !asset.rights.policy.serviceProcessingAllowed ||
    !asset.rights.grants.commercialUse ||
    !asset.rights.grants.derivatives ||
    !asset.rights.grants.renderedOutputDistribution
  ) {
    return failRenderScene("C13_RIGHTS_DENIED");
  }
  const { versionSha256, ...versionBody } = asset;
  const { projectionSha256, ...projectionBody } = asset.placementProjection;
  if (
    sha256Canonical(versionBody) !== versionSha256 ||
    sha256Canonical(projectionBody) !== projectionSha256 ||
    asset.placementProjection.c12Asset.versionId !== asset.versionId ||
    asset.placementProjection.c12Asset.id !== asset.assetId ||
    asset.placementProjection.c12Asset.kind !== asset.kind ||
    asset.placementProjection.c12Asset.rights.rightsRecordSha256 !== asset.rights.recordSha256
  ) {
    return failRenderScene("C13_BINDING_MISMATCH");
  }
  const artifactIds = asset.artifacts.map(({ artifactId }) => artifactId);
  if (new Set(artifactIds).size !== artifactIds.length) {
    return failRenderScene("C13_BINDING_MISMATCH");
  }
}

function verifyCatalogRelease(input: {
  readonly assets: readonly CatalogAssetVersion[];
  readonly manifestBytes: Uint8Array;
  readonly release: CatalogRelease;
}): ReadonlyMap<string, CatalogAssetVersion> {
  if (input.release.status !== "published") return failRenderScene("C13_RIGHTS_DENIED");
  const pins = parseReleaseManifest(input.manifestBytes, input.release);
  const assets = [...input.assets].sort((left, right) =>
    compareRenderStrings(left.versionId, right.versionId),
  );
  if (new Set(assets.map(({ versionId }) => versionId)).size !== assets.length) {
    return failRenderScene("C13_BINDING_MISMATCH");
  }
  if (assets.length !== pins.length) return failRenderScene("C13_BINDING_MISMATCH");
  assets.forEach((asset, index) => {
    verifyCatalogAsset(asset);
    const pin = pins[index];
    if (
      pin === undefined ||
      pin.assetId !== asset.assetId ||
      pin.versionId !== asset.versionId ||
      pin.versionSha256 !== asset.versionSha256
    ) {
      return failRenderScene("C13_BINDING_MISMATCH");
    }
  });
  return new Map(assets.map((asset) => [asset.versionId, asset]));
}

function expectedCatalogBinding(line: SpecificationLine): Readonly<Record<string, unknown>> {
  return Object.freeze({
    assetContentSha256: line.assetContentSha256,
    assetMetadataSha256: line.assetMetadataSha256,
    assetVersionId: line.assetVersionId,
    assetVersionSha256: line.assetVersionSha256,
    placementPolicySha256: line.placementPolicySha256,
    placementProjectionSha256: line.placementProjectionSha256,
    representation: "parametric-bounded-not-vendor-fidelity",
    rightsRecordSha256: line.rightsRecordSha256,
  });
}

function verifySpecification(input: {
  readonly assetsByVersionId: ReadonlyMap<string, CatalogAssetVersion>;
  readonly canonical: CanonicalHomeSnapshotDocument;
  readonly glb: ParsedRenderGlb;
  readonly release: CatalogRelease;
  readonly specification: Specification;
}): readonly SpecificationLine[] {
  const { canonical, glb, release, specification } = input;
  const revision = specification.currentRevision;
  const { revisionSha256, ...revisionBody } = revision;
  if (
    specification.projectId !== canonical.snapshot.projectId ||
    revision.modelSnapshotSha256 !== canonical.snapshotSha256 ||
    revision.sourceConfirmation.resultSnapshotSha256 !== canonical.snapshotSha256 ||
    revision.sourceConfirmation.resultSnapshotId !== revision.modelSnapshotId ||
    revision.catalogReleaseId !== release.releaseId ||
    revision.catalogReleaseSha256 !== release.manifestSha256 ||
    sha256Canonical(revisionBody) !== revisionSha256
  ) {
    return failRenderScene("C13_BINDING_MISMATCH");
  }
  const lines = [...revision.lines];
  if (
    new Set(lines.map(({ elementId }) => elementId)).size !== lines.length ||
    lines.some(({ elementId }, index) => {
      const previous = lines[index - 1];
      return previous !== undefined && previous.elementId >= elementId;
    })
  ) {
    return failRenderScene("C13_BINDING_MISMATCH");
  }
  const elementKinds = new Map(
    Object.values(canonical.snapshot.elements)
      .flat()
      .map((element) => [element.id, element.elementType]),
  );
  for (const line of lines) {
    const asset = input.assetsByVersionId.get(line.assetVersionId);
    const c12Asset = asset?.placementProjection.c12Asset;
    const embeddedBinding = glb.catalogBindingsByElement.get(line.elementId);
    if (
      asset === undefined ||
      c12Asset === undefined ||
      embeddedBinding === undefined ||
      line.catalogReleaseId !== release.releaseId ||
      line.catalogReleaseSha256 !== release.manifestSha256 ||
      line.assetVersionSha256 !== asset.versionSha256 ||
      line.assetContentSha256 !== c12Asset.contentSha256 ||
      line.assetMetadataSha256 !== c12Asset.metadataSha256 ||
      line.placementPolicySha256 !== c12Asset.placementPolicy.policySha256 ||
      line.placementProjectionSha256 !== asset.placementProjection.projectionSha256 ||
      line.rightsRecordSha256 !== asset.rights.recordSha256 ||
      line.kind !== asset.kind ||
      elementKinds.get(line.elementId) !== line.kind ||
      !exactCanonicalEqual(embeddedBinding, expectedCatalogBinding(line))
    ) {
      return failRenderScene("C13_BINDING_MISMATCH");
    }
  }
  if (glb.catalogBindingsByElement.size !== lines.length) {
    return failRenderScene("C13_BINDING_MISMATCH");
  }
  const expectedSpecificationBinding = {
    authority: "catalog-metadata-on-parametric-scene",
    catalogReleaseId: release.releaseId,
    catalogReleaseSha256: release.manifestSha256,
    specificationId: specification.specificationId,
    specificationRevision: revision.revision,
    specificationRevisionSha256: revision.revisionSha256,
  };
  if (!exactCanonicalEqual(glb.specificationBinding, expectedSpecificationBinding)) {
    return failRenderScene("C13_BINDING_MISMATCH");
  }
  return lines;
}

function knownValue<TValue>(candidate: {
  readonly knowledge: "known" | "unknown";
  readonly value?: TValue;
}): TValue | undefined {
  return candidate.knowledge === "known" ? candidate.value : undefined;
}

function selectedCamera(
  snapshot: CanonicalHomeSnapshot,
  selection: RenderSceneBuildInput["camera"],
  mappingsByElement: ReadonlyMap<string, SceneElementMapping>,
): RenderCamera {
  if (
    !uuidPattern.test(selection.cameraId) ||
    !Number.isSafeInteger(selection.clipStartMm) ||
    !Number.isSafeInteger(selection.clipEndMm)
  ) {
    return failRenderScene("CAMERA_INVALID");
  }
  const candidate = snapshot.elements.cameras.find(({ id }) => id === selection.cameraId);
  const mapping = mappingsByElement.get(selection.cameraId);
  const position = candidate === undefined ? undefined : knownValue(candidate.position);
  const target = candidate === undefined ? undefined : knownValue(candidate.target);
  const verticalFovMilliDegrees =
    candidate === undefined ? undefined : knownValue(candidate.verticalFovMilliDegrees);
  if (
    candidate === undefined ||
    mapping?.status !== "mapped" ||
    mapping.nodeIndices.length !== 1 ||
    position === undefined ||
    target === undefined ||
    verticalFovMilliDegrees === undefined
  ) {
    return failRenderScene("CAMERA_INVALID");
  }
  const parsed: RenderCamera = {
    cameraId: candidate.id,
    clipEndMm: selection.clipEndMm,
    clipStartMm: selection.clipStartMm,
    position,
    target,
    verticalFovMilliDegrees,
  };
  deriveBlenderCamera(parsed);
  return parsed;
}

function buildLights(snapshot: CanonicalHomeSnapshot, findings: RenderFinding[]): RenderLight[] {
  const lights: RenderLight[] = [];
  for (const light of [...snapshot.elements.lights].sort((left, right) =>
    compareRenderStrings(left.id, right.id),
  )) {
    if (light.kind === "daylight-reference") {
      findings.push({
        affectedElementIds: [light.id],
        code: "DAYLIGHT_REFERENCE_OMITTED",
        detail:
          "A daylight reference cannot create a sun or environment without explicit evidence.",
        severity: "information",
      });
      continue;
    }
    if (light.kind !== "point") {
      findings.push({
        affectedElementIds: [light.id],
        code: "UNSUPPORTED_CANONICAL_LIGHT_KIND",
        detail: "The canonical light lacks the orientation or shape fields required for rendering.",
        severity: "warning",
      });
      continue;
    }
    const position = knownValue(light.position);
    const luminousFluxLumens = knownValue(light.luminousFluxLumens);
    const colourTemperatureKelvin = knownValue(light.colourTemperatureKelvin);
    if (
      position === undefined ||
      luminousFluxLumens === undefined ||
      colourTemperatureKelvin === undefined ||
      luminousFluxLumens <= 0 ||
      colourTemperatureKelvin < 1_000 ||
      colourTemperatureKelvin > 20_000
    ) {
      findings.push({
        affectedElementIds: [light.id],
        code: "CANONICAL_LIGHT_DATA_UNKNOWN",
        detail: "The canonical light is omitted because required photometric data is unknown.",
        severity: "warning",
      });
      continue;
    }
    pointLightPowerWatts(luminousFluxLumens);
    lights.push({
      colourTemperatureKelvin,
      conversionPolicy: "c14-photometric-to-blender-v1",
      kind: "point",
      lightId: light.id,
      luminousFluxLumens,
      position,
    });
  }
  return lights;
}

function elementHasUv(input: {
  readonly elementId: string;
  readonly glb: ParsedRenderGlb;
  readonly mappingsByElement: ReadonlyMap<string, SceneElementMapping>;
  readonly snapshot: CanonicalHomeSnapshot;
}): boolean {
  const finish = input.snapshot.elements.finishes.find(({ id }) => id === input.elementId);
  const renderedElementId = finish?.targetElementId ?? input.elementId;
  const mapping = input.mappingsByElement.get(renderedElementId);
  return (
    mapping !== undefined &&
    mapping.meshIndices.length > 0 &&
    mapping.meshIndices.every((meshIndex) => input.glb.meshHasUv[meshIndex] === true)
  );
}

function textureHashes(asset: CatalogAssetVersion): readonly string[] {
  const artifactById = new Map(asset.artifacts.map((artifact) => [artifact.artifactId, artifact]));
  const hashes = new Set<string>();
  for (const material of asset.materials) {
    for (const artifactId of material.textureArtifactIds) {
      const artifact = artifactById.get(artifactId);
      if (artifact?.role !== "texture" || artifact.mediaType !== "image/png") {
        return failRenderScene("C13_BINDING_MISMATCH");
      }
      hashes.add(artifact.sha256);
      if (hashes.size > 8) return failRenderScene("C13_BINDING_MISMATCH");
    }
  }
  return [...hashes].sort(compareRenderStrings);
}

function buildMaterials(input: {
  readonly assetsByVersionId: ReadonlyMap<string, CatalogAssetVersion>;
  readonly findings: RenderFinding[];
  readonly glb: ParsedRenderGlb;
  readonly lines: readonly SpecificationLine[];
  readonly mappingsByElement: ReadonlyMap<string, SceneElementMapping>;
  readonly snapshot: CanonicalHomeSnapshot;
}): RenderMaterial[] {
  return input.lines.map((line) => {
    const asset = input.assetsByVersionId.get(line.assetVersionId);
    if (asset === undefined) return failRenderScene("C13_BINDING_MISMATCH");
    const hashes = textureHashes(asset);
    const material = asset.materials.length === 1 ? asset.materials[0] : undefined;
    const uvAvailable = elementHasUv({
      elementId: line.elementId,
      glb: input.glb,
      mappingsByElement: input.mappingsByElement,
      snapshot: input.snapshot,
    });
    let fallbackCode: string | undefined;
    let fallbackDetail: string | undefined;
    if (material === undefined) {
      fallbackCode = "UNSUPPORTED_CATALOG_MATERIAL_SET";
      fallbackDetail =
        "The catalog material set is not representable by the frozen single-material mapping.";
    } else if (material.uvSet !== 0) {
      fallbackCode = "UNSUPPORTED_CATALOG_UV_SET";
      fallbackDetail =
        "The catalog material requires an unsupported UV set and uses a neutral fallback.";
    } else if (hashes.length > 0 && !uvAvailable) {
      fallbackCode = "MATERIAL_UV_UNAVAILABLE";
      fallbackDetail =
        "The protected C10 geometry has no supported UV coordinates for the pinned texture.";
    }
    if (fallbackCode !== undefined && fallbackDetail !== undefined) {
      input.findings.push({
        affectedElementIds: [line.elementId],
        code: fallbackCode,
        detail: fallbackDetail,
        severity: "warning",
      });
    }
    const usesFallback = fallbackCode !== undefined;
    const selectedMaterial = usesFallback || material === undefined ? neutralFallback : material;
    return {
      assetVersionSha256: asset.versionSha256,
      baseColourSrgb8: [...selectedMaterial.baseColourSrgb8],
      elementId: line.elementId,
      emissiveSrgb8: [...selectedMaterial.emissiveSrgb8],
      materialId:
        usesFallback || material === undefined
          ? deterministicRenderUuid(`c14:neutral-material:${line.elementId}:${asset.versionSha256}`)
          : material.materialId,
      metallicBasisPoints: selectedMaterial.metallicBasisPoints,
      representation: usesFallback ? "status-aware-neutral-fallback" : "validated-catalog-material",
      rightsRecordSha256: asset.rights.recordSha256,
      roughnessBasisPoints: selectedMaterial.roughnessBasisPoints,
      textureArtifactSha256: [...hashes],
    };
  });
}

function buildProtectedElementIds(mappings: readonly SceneElementMapping[]): readonly string[] {
  return mappings
    .filter(({ status }) => status === "mapped")
    .map(({ elementId }) => elementId)
    .sort(compareRenderStrings);
}

function buildSegmentationPalette(
  mappings: readonly SceneElementMapping[],
): RenderSceneManifest["segmentationPalette"] {
  const visible = mappings
    .filter(({ meshIndices, status }) => status === "mapped" && meshIndices.length > 0)
    .map(({ elementId }) => elementId)
    .sort(compareRenderStrings);
  return segmentationPaletteForElementIds(visible);
}

function sortFindings(findings: readonly RenderFinding[]): RenderFinding[] {
  const unique = new Map<string, RenderFinding>();
  for (const finding of findings) {
    const normalized = {
      ...finding,
      affectedElementIds: [...new Set(finding.affectedElementIds)].sort(compareRenderStrings),
    };
    const key = renderSceneCanonicalJson(normalized);
    unique.set(key, normalized);
  }
  return [...unique.values()].sort((left, right) =>
    compareRenderStrings(renderSceneCanonicalJson(left), renderSceneCanonicalJson(right)),
  );
}

export function buildRenderScene(input: RenderSceneBuildInput): BuiltRenderScene {
  if (
    !(input.sceneGlb instanceof Uint8Array) ||
    !(input.catalogReleaseManifestBytes instanceof Uint8Array) ||
    !sha256Pattern.test(input.rendererScriptSha256)
  ) {
    return failRenderScene("INPUT_INVALID");
  }
  renderSceneCanonicalJson(input.camera);
  renderSceneCanonicalJson(input.profile);
  const sceneJob = parseSceneJob(input.sceneJob);
  const scene = parseScene(input.scene);
  const specification = parseSpecification(input.specification);
  const release = parseCatalogRelease(input.catalogRelease);
  const assets = parseCatalogAssets(input.catalogAssetVersions);
  let canonical: CanonicalHomeSnapshotDocument;
  try {
    canonical = canonicalizeHomeSnapshot(input.canonicalSnapshot);
  } catch {
    return failRenderScene("INPUT_INVALID");
  }
  const glb = parseProtectedC10Glb(input.sceneGlb);
  verifyC10Source({ canonical, glb, glbBytes: input.sceneGlb, scene, sceneJob });
  const assetsByVersionId = verifyCatalogRelease({
    assets,
    manifestBytes: input.catalogReleaseManifestBytes,
    release,
  });
  const lines = verifySpecification({
    assetsByVersionId,
    canonical,
    glb,
    release,
    specification,
  });
  const profileResult = renderProfileSchema.safeParse(input.profile);
  if (
    !profileResult.success ||
    !safePinnedVersionPattern.test(profileResult.data.blenderBuildHash) ||
    !safePinnedVersionPattern.test(profileResult.data.blenderVersion)
  ) {
    return failRenderScene("INPUT_INVALID");
  }
  const mappingsByElement = new Map(
    scene.manifest.elementMappings.map((mapping) => [mapping.elementId, mapping]),
  );
  const findings: RenderFinding[] = [];
  const camera = selectedCamera(canonical.snapshot, input.camera, mappingsByElement);
  const lights = buildLights(canonical.snapshot, findings);
  const materials = buildMaterials({
    assetsByVersionId,
    findings,
    glb,
    lines,
    mappingsByElement,
    snapshot: canonical.snapshot,
  });
  const protectedElementIds = buildProtectedElementIds(scene.manifest.elementMappings);
  const segmentationPalette = buildSegmentationPalette(scene.manifest.elementMappings);
  const source = {
    projectId: scene.projectId,
    sceneArtifactId: scene.artifact.id,
    sceneGlbSha256: scene.artifact.glbSha256,
    sceneId: scene.id,
    sceneJobId: sceneJob.id,
    sceneManifestSha256: scene.artifact.manifestSha256,
    sourceSnapshotSha256: canonical.snapshotSha256,
    specification: {
      catalogReleaseId: release.releaseId,
      catalogReleaseSha256: release.manifestSha256,
      specificationId: specification.specificationId,
      specificationRevision: specification.currentRevision.revision,
      specificationRevisionSha256: specification.currentRevision.revisionSha256,
    },
  } as const;
  const manifestCore = {
    authority: "derived-visualisation-only" as const,
    camera,
    coordinateMapping: "c4-z-up-to-blender-z-up-v1" as const,
    findings: sortFindings(findings),
    lights,
    materials,
    profile: profileResult.data,
    protectedElementIds,
    rendererScriptSha256: input.rendererScriptSha256,
    schemaVersion: "c14-render-scene-manifest-v1" as const,
    segmentationPalette,
    source,
    unknownPolicy: "omit-and-report" as const,
    worldAssumption: "neutral-studio-no-address-or-daylight-inference-v1" as const,
  };
  const determinismKeySha256 = sha256Canonical({
    builder: { name: "interior-design-render-scene", version: renderScenePackageVersion },
    manifest: manifestCore,
  });
  const parsedManifest = renderSceneManifestSchema.safeParse({
    ...manifestCore,
    determinismKeySha256,
  });
  if (!parsedManifest.success) return failRenderScene("MANIFEST_INVALID");
  const manifest = deepFreezeRenderValue(parsedManifest.data);
  const canonicalJson = renderSceneCanonicalJson(manifest);
  const retainedBytes = new TextEncoder().encode(canonicalJson);
  const envelope: RenderSceneHashEnvelope = deepFreezeRenderValue({
    byteLength: retainedBytes.byteLength,
    manifestSchemaVersion: "c14-render-scene-manifest-v1",
    schemaVersion: c14RenderSceneHashEnvelopeVersion,
    sha256: sha256Bytes(retainedBytes),
  });
  return Object.freeze({
    canonicalBytes: () => retainedBytes.slice(),
    canonicalJson,
    envelope,
    manifest,
  });
}
