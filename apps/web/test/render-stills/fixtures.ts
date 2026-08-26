import {
  enhancementResultSchema,
  projectSchema,
  renderEligibleSourcesResponseSchema,
  renderArtifactAccessSchema,
  renderArtifactSchema,
  renderJobSchema,
  renderResultSchema,
  renderHostCapabilitiesSchema,
  sessionSchema,
} from "@interior-design/contracts";
import type { RenderArtifactRole } from "@interior-design/contracts";

import { renderCapabilitiesSchema } from "../../src/features/render-stills/contracts.ts";

export function uuid(value: number): string {
  return `c1400000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

export function hash(digit: string): string {
  return digit.repeat(64);
}

export const ids = Object.freeze({
  artifactDepth: uuid(31),
  artifactEnhancement: uuid(36),
  artifactMultilayer: uuid(32),
  artifactNormal: uuid(33),
  artifactSafe: uuid(34),
  artifactSegmentation: uuid(35),
  camera: uuid(12),
  catalogRelease: uuid(14),
  enhancementJob: uuid(41),
  job: uuid(20),
  project: uuid(3),
  result: uuid(21),
  scene: uuid(10),
  sceneArtifact: uuid(11),
  sceneJob: uuid(9),
  specification: uuid(13),
  tenant: uuid(1),
  user: uuid(2),
  viewer: uuid(4),
});

export const project = projectSchema.parse({
  createdAt: "2026-07-19T08:00:00.000Z",
  id: ids.project,
  name: "Synthetic still study",
  status: "active",
  tenantId: ids.tenant,
  updatedAt: "2026-07-19T09:00:00.000Z",
  version: 2,
});

export const ownerSession = sessionSchema.parse({
  actor: {
    displayName: "Synthetic Render Owner",
    role: "owner",
    subject: "fixture:render-owner",
    tenantId: ids.tenant,
    userId: ids.user,
  },
  authMode: "local-fixture",
  expiresAt: "2027-07-19T09:00:00.000Z",
});

export const viewerSession = sessionSchema.parse({
  actor: {
    displayName: "Synthetic Render Viewer",
    role: "viewer",
    subject: "fixture:render-viewer",
    tenantId: ids.tenant,
    userId: ids.viewer,
  },
  authMode: "local-fixture",
  expiresAt: "2027-07-19T09:00:00.000Z",
});

export const capabilities = renderCapabilitiesSchema.parse({
  enhancementProvider: {
    reason: "External image enhancement is disabled by the C14 provider policy.",
    state: "disabled",
  },
  lightingPresets: [
    {
      label: "Canonical lights · neutral world",
      lightingPresetId: "canonical-lights-neutral-world-v1",
    },
  ],
  profiles: [
    {
      label: "Cycles CPU · geometry safe",
      profileId: "cycles-cpu-geometry-safe-v1",
      reason: "Defined for an authorised render host; not runnable on this Mac.",
      state: "deferred",
    },
    {
      label: "Eevee local preview",
      profileId: "eevee-local-preview-v1",
      reason: "Preview does not close the photoreal gate.",
      state: "disabled",
    },
  ],
  renderer: {
    hardwareGate: "deferred",
    reason: "The user prohibited Blender execution on this Mac; real rendering is deferred.",
    state: "deferred",
  },
  sources: [
    {
      cameras: [{ cameraId: ids.camera, label: "Living room · canonical eye level" }],
      label: "Exact C13-backed living-room scene",
      sourceSceneJobId: ids.sceneJob,
      specifications: [
        {
          label: "Selected design · specification revision 5",
          specificationId: ids.specification,
          specificationRevision: 5,
        },
      ],
    },
  ],
});

const source = {
  projectId: ids.project,
  sceneArtifactId: ids.sceneArtifact,
  sceneGlbSha256: hash("a"),
  sceneId: ids.scene,
  sceneJobId: ids.sceneJob,
  sceneManifestSha256: hash("b"),
  sourceSnapshotSha256: hash("c"),
  specification: {
    catalogReleaseId: ids.catalogRelease,
    catalogReleaseSha256: hash("d"),
    specificationId: ids.specification,
    specificationRevision: 5,
    specificationRevisionSha256: hash("e"),
  },
} as const;

export const hostCapabilities = renderHostCapabilitiesSchema.parse({
  acceptingNewJobs: true,
  enhancementProvider: "enabled",
  hardwareEvidence: "deferred",
  profiles: [
    {
      available: true,
      capability: "render.cycles.cpu.v1",
      profileId: "cycles-cpu-geometry-safe-v1",
      reason: "Synthetic lifecycle fixture only.",
    },
    {
      available: false,
      capability: "render.eevee.preview.v1",
      profileId: "eevee-local-preview-v1",
      reason: "Preview does not close the photoreal gate.",
    },
  ],
});

export const eligibleSources = renderEligibleSourcesResponseSchema.parse({
  projectId: ids.project,
  schemaVersion: "c14-render-eligible-sources-v1",
  sources: [
    {
      cameras: [{ cameraId: ids.camera, label: "Living room · canonical eye level" }],
      label: "Exact C13-backed living-room scene",
      source,
    },
  ],
});

export const availableCapabilities = renderCapabilitiesSchema.parse({
  ...capabilities,
  enhancementProvider: {
    reason: "The configured optional enhancement provider is available.",
    state: "available",
  },
  profiles: [
    {
      label: "Cycles CPU · geometry safe",
      profileId: "cycles-cpu-geometry-safe-v1",
      reason: "Synthetic lifecycle fixture only.",
      state: "available",
    },
    {
      label: "Eevee local preview",
      profileId: "eevee-local-preview-v1",
      reason: "Preview does not close the photoreal gate.",
      state: "deferred",
    },
  ],
  renderer: {
    hardwareGate: "deferred",
    reason: "The platform currently accepts new work for at least one frozen render profile.",
    state: "available",
  },
  sources: [
    {
      cameras: [{ cameraId: ids.camera, label: "Living room · canonical eye level" }],
      label: "Exact C13-backed living-room scene",
      sourceSceneJobId: ids.sceneJob,
      specifications: [
        {
          label: "Specification revision 5",
          specificationId: ids.specification,
          specificationRevision: 5,
        },
      ],
    },
  ],
});

function artifact(role: RenderArtifactRole, id: string, digit: string) {
  return renderArtifactSchema.parse({
    byteLength: 1_024,
    heightPx: 64,
    id,
    mediaType: role.endsWith("-png") ? "image/png" : "image/x-exr",
    role,
    schemaVersion: "c14-render-artifact-v1",
    sha256: hash(digit),
    widthPx: 96,
  });
}

export const safeArtifact = artifact("geometry-safe-png", ids.artifactSafe, "1");
export const multilayerArtifact = artifact("multilayer-exr", ids.artifactMultilayer, "2");
export const depthArtifact = artifact("depth-exr", ids.artifactDepth, "3");
export const normalArtifact = artifact("normal-exr", ids.artifactNormal, "4");
export const segmentationArtifact = artifact("segmentation-png", ids.artifactSegmentation, "5");
export const enhancementArtifact = artifact(
  "illustrative-enhancement-png",
  ids.artifactEnhancement,
  "6",
);

export const job = renderJobSchema.parse({
  attempt: 1,
  createdAt: "2026-07-19T09:00:00.000Z",
  createdBy: ids.user,
  id: ids.job,
  projectId: ids.project,
  request: {
    cameraId: ids.camera,
    enhancement: "optional-provider",
    label: "Living room review still",
    lightingPresetId: "canonical-lights-neutral-world-v1",
    profileId: "cycles-cpu-geometry-safe-v1",
    sourceSceneJobId: ids.sceneJob,
    specification: { specificationId: ids.specification, specificationRevision: 5 },
  },
  resultId: ids.result,
  state: "succeeded",
  updatedAt: "2026-07-19T09:05:00.000Z",
  version: 6,
});

export const queuedJob = renderJobSchema.parse({
  ...job,
  id: uuid(22),
  resultId: undefined,
  state: "queued",
  version: 1,
});

export const failedJob = renderJobSchema.parse({
  ...job,
  id: uuid(23),
  resultId: undefined,
  safeCode: "RENDER_HOST_UNAVAILABLE",
  state: "failed",
});

export const result = renderResultSchema.parse({
  createdAt: "2026-07-19T09:05:00.000Z",
  createdBy: ids.user,
  id: ids.result,
  jobId: ids.job,
  manifest: {
    artifacts: [
      safeArtifact,
      multilayerArtifact,
      depthArtifact,
      normalArtifact,
      segmentationArtifact,
    ],
    authority: "derived-visualisation-only",
    exactByteReplayScope: "same-host-build-script-profile-source",
    hostFingerprintSha256: hash("7"),
    renderSceneManifestSha256: hash("8"),
    renderer: {
      blenderBuildHash: "synthetic-fixture-no-blender",
      blenderVersion: "not-invoked",
      executableSha256: hash("9"),
      scriptSha256: hash("a"),
    },
    resultId: ids.result,
    schemaVersion: "c14-render-output-manifest-v1",
    source,
  },
  manifestSha256: hash("b"),
  projectId: ids.project,
});

export const enhancement = enhancementResultSchema.parse({
  artifact: enhancementArtifact,
  baseArtifactSha256: safeArtifact.sha256,
  conditioningSha256: {
    depth: depthArtifact.sha256,
    normal: normalArtifact.sha256,
    segmentation: segmentationArtifact.sha256,
  },
  geometryGuard: {
    accepted: true,
    allowedMaskSha256: hash("c"),
    baseArtifactSha256: safeArtifact.sha256,
    cameraLocked: true,
    changedOutsideAllowedMaskPixels: 0,
    changedPixelCount: 120,
    enhancedArtifactSha256: enhancementArtifact.sha256,
    protectedEdgeAgreementBasisPoints: 9_900,
    protectedGeometryMoved: false,
    schemaVersion: "c14-geometry-guard-v1",
    segmentationIoUBasisPoints: 9_850,
  },
  model: {
    name: "Deterministic test adapter",
    provider: "local-fixture-only",
    version: "1.0.0",
  },
  schemaVersion: "c14-enhancement-result-v1",
  state: "succeeded",
});

export const access = renderArtifactAccessSchema.parse({
  artifactId: safeArtifact.id,
  byteLength: safeArtifact.byteLength,
  expiresAt: "2027-07-19T09:05:00.000Z",
  manifestSha256: result.manifestSha256,
  mediaType: safeArtifact.mediaType,
  role: safeArtifact.role,
  sha256: safeArtifact.sha256,
  url: `http://127.0.0.1:4353/signed/${safeArtifact.id}?signature=synthetic`,
});
