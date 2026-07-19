import {
  c14RenderArtifactSchemaVersion,
  c14RenderPolicy,
  renderArtifactSchema,
  renderOutputManifestSchema,
  type RenderArtifact,
  type RenderArtifactRole,
  type RenderSceneManifest,
} from "@interior-design/contracts";
import { rendererFailure } from "./errors.js";
import { sha256 } from "./hash.js";
import type { ExrInspectionPort, GlbInspection, RenderExecutionInput } from "./types.js";

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const exrMagic = 20_000_630;

export function inspectPng(bytes: Uint8Array): {
  readonly heightPx: number;
  readonly widthPx: number;
} {
  const buffer = Buffer.from(bytes);
  if (
    buffer.byteLength < 33 ||
    !buffer.subarray(0, 8).equals(pngSignature) ||
    buffer.toString("ascii", 12, 16) !== "IHDR"
  ) {
    rendererFailure("RENDER_PNG_INVALID");
  }
  const widthPx = buffer.readUInt32BE(16);
  const heightPx = buffer.readUInt32BE(20);
  if (widthPx < 1 || heightPx < 1 || widthPx * heightPx > c14RenderPolicy.maximumPixels) {
    rendererFailure("RENDER_IMAGE_DIMENSIONS_INVALID");
  }
  return { heightPx, widthPx };
}

export function assertExrMagic(bytes: Uint8Array): void {
  const buffer = Buffer.from(bytes);
  if (buffer.byteLength < 16 || buffer.readUInt32LE(0) !== exrMagic) {
    rendererFailure("RENDER_EXR_INVALID");
  }
}

function requiredChannels(role: "depth-exr" | "multilayer-exr" | "normal-exr") {
  if (role === "depth-exr") return ["Z"] as const;
  if (role === "normal-exr") return ["Normal.X", "Normal.Y", "Normal.Z"] as const;
  return ["Combined.R", "Combined.G", "Combined.B", "CryptoObject00.R"] as const;
}

export async function validateArtifactBytes(input: {
  readonly artifactId: string;
  readonly bytes: Uint8Array;
  readonly expectedHeightPx: number;
  readonly expectedWidthPx: number;
  readonly exrInspector: ExrInspectionPort;
  readonly role: Exclude<RenderArtifactRole, "illustrative-enhancement-png">;
}): Promise<RenderArtifact> {
  if (input.bytes.byteLength < 1 || input.bytes.byteLength > c14RenderPolicy.maximumArtifactBytes) {
    rendererFailure("RENDER_ARTIFACT_SIZE_INVALID");
  }
  let dimensions: { readonly heightPx: number; readonly widthPx: number };
  if (input.role === "geometry-safe-png" || input.role === "segmentation-png") {
    dimensions = inspectPng(input.bytes);
  } else {
    const exrRole = input.role;
    assertExrMagic(input.bytes);
    const inspection = await input.exrInspector.inspect(exrRole, input.bytes);
    if (!inspection.allFinite) rendererFailure("RENDER_EXR_NON_FINITE");
    if (requiredChannels(exrRole).some((channel) => !inspection.channels.includes(channel))) {
      rendererFailure("RENDER_EXR_CHANNELS_MISSING");
    }
    dimensions = inspection;
  }
  if (
    dimensions.widthPx !== input.expectedWidthPx ||
    dimensions.heightPx !== input.expectedHeightPx
  ) {
    rendererFailure("RENDER_IMAGE_DIMENSIONS_MISMATCH");
  }
  return renderArtifactSchema.parse({
    byteLength: input.bytes.byteLength,
    heightPx: dimensions.heightPx,
    id: input.artifactId,
    mediaType:
      input.role === "geometry-safe-png" || input.role === "segmentation-png"
        ? "image/png"
        : "image/x-exr",
    role: input.role,
    schemaVersion: c14RenderArtifactSchemaVersion,
    sha256: sha256(input.bytes),
    widthPx: dimensions.widthPx,
  });
}

function specificationMatches(manifest: RenderSceneManifest, inspection: GlbInspection): boolean {
  const expected = manifest.source.specification;
  const actual = inspection.c13SpecificationBinding;
  if (expected === undefined) return actual === undefined;
  return (
    actual !== undefined &&
    actual.catalogReleaseId === expected.catalogReleaseId &&
    actual.catalogReleaseSha256 === expected.catalogReleaseSha256 &&
    actual.specificationId === expected.specificationId &&
    actual.specificationRevision === expected.specificationRevision &&
    actual.specificationRevisionSha256 === expected.specificationRevisionSha256
  );
}

export function validateProtectedGlb(input: {
  readonly actualSha256: string;
  readonly expectedSha256: string;
  readonly inspection: GlbInspection;
  readonly manifest: RenderSceneManifest;
}): void {
  if (input.actualSha256 !== input.expectedSha256) rendererFailure("RENDER_GLB_HASH_MISMATCH");
  if (
    input.inspection.externalResourceCount !== 0 ||
    input.inspection.containsDriversOrScripts ||
    input.inspection.unsafeExtensionNames.length > 0
  ) {
    rendererFailure("RENDER_GLB_UNSAFE");
  }
  const ids = [...input.inspection.objectIds].sort();
  const boundIds = input.inspection.objectBounds.map(({ elementId }) => elementId).sort();
  if (
    new Set(ids).size !== ids.length ||
    new Set(boundIds).size !== boundIds.length ||
    input.manifest.protectedElementIds.length !== ids.length ||
    input.manifest.protectedElementIds.some((id, index) => id !== ids[index]) ||
    ids.some((id, index) => id !== boundIds[index])
  ) {
    rendererFailure("RENDER_GLB_OBJECT_SET_MISMATCH");
  }
  if (
    input.inspection.objectBounds.some(({ maximumMetres, minimumMetres }) => {
      const coordinates = [...maximumMetres, ...minimumMetres];
      return (
        coordinates.some((value) => !Number.isFinite(value) || Math.abs(value) > 10_000) ||
        minimumMetres.some((minimum, index) => {
          const maximum = maximumMetres[index];
          return maximum === undefined || minimum > maximum;
        })
      );
    })
  ) {
    rendererFailure("RENDER_GLB_BOUNDS_INVALID");
  }
  if (!specificationMatches(input.manifest, input.inspection)) {
    rendererFailure("RENDER_C13_BINDING_MISMATCH");
  }
}

export function createOutputManifest(input: {
  readonly artifacts: readonly RenderArtifact[];
  readonly executableSha256: string;
  readonly hostFingerprintSha256: string;
  readonly renderInput: RenderExecutionInput;
}) {
  return renderOutputManifestSchema.parse({
    artifacts: input.artifacts,
    authority: "derived-visualisation-only",
    exactByteReplayScope: "same-host-build-script-profile-source",
    hostFingerprintSha256: input.hostFingerprintSha256,
    renderSceneManifestSha256: input.renderInput.renderSceneManifestSha256,
    renderer: {
      blenderBuildHash: input.renderInput.renderSceneManifest.profile.blenderBuildHash,
      blenderVersion: input.renderInput.renderSceneManifest.profile.blenderVersion,
      executableSha256: input.executableSha256,
      scriptSha256: input.renderInput.renderSceneManifest.rendererScriptSha256,
    },
    resultId: input.renderInput.resultId,
    schemaVersion: "c14-render-output-manifest-v1",
    source: input.renderInput.renderSceneManifest.source,
  });
}
