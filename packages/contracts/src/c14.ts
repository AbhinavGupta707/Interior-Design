import { z } from "zod";

import { modelElementIdSchema } from "./c4.js";
import { sceneArtifactIdSchema, sceneIdSchema, sceneJobIdSchema } from "./c10.js";

const uuidSchema = z.uuid();
const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const safeCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/u);
const boundedLabelSchema = z.string().trim().min(1).max(160);
const safeVersionSchema = z.string().trim().min(1).max(120);

export const c14RenderSceneManifestSchemaVersion = "c14-render-scene-manifest-v1" as const;
export const c14RenderJobSchemaVersion = "c14-render-job-v1" as const;
export const c14RenderArtifactSchemaVersion = "c14-render-artifact-v1" as const;
export const c14RenderOutputManifestSchemaVersion = "c14-render-output-manifest-v1" as const;
export const c14EnhancementResultSchemaVersion = "c14-enhancement-result-v1" as const;
export const c14GeometryGuardSchemaVersion = "c14-geometry-guard-v1" as const;

export const c14RenderPolicy = Object.freeze({
  accessTtlSeconds: 300,
  diskSafetyFloorBytes: 15 * 1024 * 1024 * 1024,
  diskAdmissionRule: "max-floor-plus-estimate-or-three-times-estimate-v1",
  diskSafetyJobMultiplier: 3,
  maximumArtifactBytes: 2 * 1024 * 1024 * 1024,
  maximumArtifactsPerResult: 32,
  maximumAttempts: 3,
  maximumCamerasPerJob: 8,
  maximumEstimatedJobBytes: 2 * 1024 * 1024 * 1024,
  maximumHeightPixels: 4_096,
  maximumLightsPerScene: 1_024,
  maximumPixels: 16_777_216,
  maximumSamples: 4_096,
  maximumWidthPixels: 4_096,
  minimumHeightPixels: 64,
  minimumWidthPixels: 64,
  workerTimeoutMilliseconds: 7_200_000,
} as const);

export const renderJobIdSchema = uuidSchema;
export const renderResultIdSchema = uuidSchema;
export const renderArtifactIdSchema = uuidSchema;

export const renderSpecificationReferenceSchema = z
  .object({
    catalogReleaseId: uuidSchema,
    catalogReleaseSha256: sha256HexSchema,
    specificationId: uuidSchema,
    specificationRevision: z.int().positive(),
    specificationRevisionSha256: sha256HexSchema,
  })
  .strict();

export const renderSourceReferenceSchema = z
  .object({
    projectId: uuidSchema,
    sceneArtifactId: sceneArtifactIdSchema,
    sceneGlbSha256: sha256HexSchema,
    sceneId: sceneIdSchema,
    sceneJobId: sceneJobIdSchema,
    sceneManifestSha256: sha256HexSchema,
    sourceSnapshotSha256: sha256HexSchema,
    specification: renderSpecificationReferenceSchema.optional(),
  })
  .strict();
export type RenderSourceReference = z.infer<typeof renderSourceReferenceSchema>;

const pointMmSchema = z
  .object({
    xMm: z.int().min(-10_000_000).max(10_000_000),
    yMm: z.int().min(-10_000_000).max(10_000_000),
    zMm: z.int().min(-10_000_000).max(10_000_000),
  })
  .strict();

export const renderCameraSchema = z
  .object({
    cameraId: modelElementIdSchema,
    clipEndMm: z.int().min(1_000).max(100_000_000),
    clipStartMm: z.int().min(1).max(10_000),
    position: pointMmSchema,
    target: pointMmSchema,
    verticalFovMilliDegrees: z.int().min(1_000).max(179_000),
  })
  .strict()
  .superRefine((camera, context) => {
    if (
      camera.position.xMm === camera.target.xMm &&
      camera.position.yMm === camera.target.yMm &&
      camera.position.zMm === camera.target.zMm
    ) {
      context.addIssue({
        code: "custom",
        message: "A render camera must look at a distinct point.",
      });
    }
    if (camera.clipStartMm >= camera.clipEndMm) {
      context.addIssue({
        code: "custom",
        message: "A render camera near clip plane must precede its far clip plane.",
      });
    }
  });
export type RenderCamera = z.infer<typeof renderCameraSchema>;

const renderMaterialSchema = z
  .object({
    assetVersionSha256: sha256HexSchema.optional(),
    baseColourSrgb8: z.tuple([
      z.int().min(0).max(255),
      z.int().min(0).max(255),
      z.int().min(0).max(255),
    ]),
    elementId: modelElementIdSchema,
    emissiveSrgb8: z.tuple([
      z.int().min(0).max(255),
      z.int().min(0).max(255),
      z.int().min(0).max(255),
    ]),
    materialId: uuidSchema,
    metallicBasisPoints: z.int().min(0).max(10_000),
    representation: z.enum(["validated-catalog-material", "status-aware-neutral-fallback"]),
    rightsRecordSha256: sha256HexSchema.optional(),
    roughnessBasisPoints: z.int().min(0).max(10_000),
    textureArtifactSha256: z.array(sha256HexSchema).max(8),
  })
  .strict();

const renderLightSchema = z
  .object({
    colourTemperatureKelvin: z.int().min(1_000).max(20_000),
    conversionPolicy: z.literal("c14-photometric-to-blender-v1"),
    kind: z.enum(["point", "spot", "linear", "area"]),
    lightId: modelElementIdSchema,
    luminousFluxLumens: z.int().positive().max(10_000_000),
    position: pointMmSchema,
  })
  .strict();

export const renderEngineSchema = z.enum(["eevee", "cycles"]);
export const renderDeviceSchema = z.enum(["host-gpu", "cpu", "metal", "cuda", "optix"]);

export const renderProfileSchema = z
  .object({
    blenderBuildHash: safeVersionSchema,
    blenderVersion: safeVersionSchema,
    colourManagement: z
      .object({
        displayDevice: z.literal("sRGB"),
        look: z.literal("AgX - Medium High Contrast"),
        viewTransform: z.literal("AgX"),
      })
      .strict(),
    denoise: z.enum(["none", "open-image-denoise", "optix"]),
    device: renderDeviceSchema,
    engine: renderEngineSchema,
    heightPx: z
      .int()
      .min(c14RenderPolicy.minimumHeightPixels)
      .max(c14RenderPolicy.maximumHeightPixels),
    profileId: z.enum([
      "eevee-local-preview-v1",
      "cycles-cpu-geometry-safe-v1",
      "cycles-metal-geometry-safe-v1",
      "cycles-cuda-high-resolution-v1",
      "cycles-optix-high-resolution-v1",
    ]),
    samples: z.int().positive().max(c14RenderPolicy.maximumSamples),
    seed: z.int().min(0).max(2_147_483_647),
    threads: z.int().positive().max(256),
    transparentBackground: z.boolean(),
    widthPx: z
      .int()
      .min(c14RenderPolicy.minimumWidthPixels)
      .max(c14RenderPolicy.maximumWidthPixels),
  })
  .strict()
  .superRefine((profile, context) => {
    if (profile.widthPx * profile.heightPx > c14RenderPolicy.maximumPixels) {
      context.addIssue({ code: "custom", message: "Render resolution exceeds the pixel budget." });
    }
    const requiredEngine = profile.profileId.startsWith("eevee-") ? "eevee" : "cycles";
    if (profile.engine !== requiredEngine) {
      context.addIssue({ code: "custom", message: "Render profile and engine do not match." });
    }
    const deviceByProfile: Readonly<Record<typeof profile.profileId, typeof profile.device>> = {
      "cycles-cpu-geometry-safe-v1": "cpu",
      "cycles-cuda-high-resolution-v1": "cuda",
      "cycles-metal-geometry-safe-v1": "metal",
      "cycles-optix-high-resolution-v1": "optix",
      "eevee-local-preview-v1": "host-gpu",
    };
    if (profile.device !== deviceByProfile[profile.profileId]) {
      context.addIssue({ code: "custom", message: "Render profile and device do not match." });
    }
    if (profile.denoise === "optix" && profile.device !== "optix") {
      context.addIssue({ code: "custom", message: "OptiX denoise requires the OptiX profile." });
    }
  });
export type RenderProfile = z.infer<typeof renderProfileSchema>;

const renderSceneFindingSchema = z
  .object({
    affectedElementIds: z.array(modelElementIdSchema).max(256),
    code: safeCodeSchema,
    detail: z.string().trim().min(1).max(500),
    severity: z.enum(["information", "warning", "error"]),
  })
  .strict();

const segmentationEntrySchema = z
  .object({
    elementId: modelElementIdSchema,
    rgb8: z.tuple([z.int().min(1).max(255), z.int().min(0).max(255), z.int().min(0).max(255)]),
  })
  .strict();

export const renderSceneManifestSchema = z
  .object({
    authority: z.literal("derived-visualisation-only"),
    camera: renderCameraSchema,
    coordinateMapping: z.literal("c4-z-up-to-blender-z-up-v1"),
    determinismKeySha256: sha256HexSchema,
    findings: z.array(renderSceneFindingSchema).max(10_000),
    lights: z.array(renderLightSchema).max(c14RenderPolicy.maximumLightsPerScene),
    materials: z.array(renderMaterialSchema).max(100_000),
    profile: renderProfileSchema,
    protectedElementIds: z.array(modelElementIdSchema).max(100_000),
    rendererScriptSha256: sha256HexSchema,
    schemaVersion: z.literal(c14RenderSceneManifestSchemaVersion),
    segmentationPalette: z.array(segmentationEntrySchema).max(100_000),
    source: renderSourceReferenceSchema,
    unknownPolicy: z.literal("omit-and-report"),
    worldAssumption: z.literal("neutral-studio-no-address-or-daylight-inference-v1"),
  })
  .strict()
  .superRefine((manifest, context) => {
    for (const field of [
      "lights",
      "materials",
      "protectedElementIds",
      "segmentationPalette",
    ] as const) {
      const values = manifest[field];
      const ids = values.map((value) =>
        typeof value === "string"
          ? value
          : "lightId" in value
            ? value.lightId
            : "elementId" in value
              ? value.elementId
              : "",
      );
      if (
        new Set(ids).size !== ids.length ||
        ids.some((id, index) => index > 0 && ids[index - 1]! >= id)
      ) {
        context.addIssue({ code: "custom", message: `${field} must be unique and sorted.` });
      }
    }
    const protectedIds = new Set(manifest.protectedElementIds);
    if (manifest.segmentationPalette.some(({ elementId }) => !protectedIds.has(elementId))) {
      context.addIssue({
        code: "custom",
        message: "Segmentation entries must reference protected canonical elements.",
      });
    }
    const colours = manifest.segmentationPalette.map(({ rgb8 }) => rgb8.join(","));
    if (new Set(colours).size !== colours.length) {
      context.addIssue({ code: "custom", message: "Segmentation colours must be collision-free." });
    }
  });
export type RenderSceneManifest = z.infer<typeof renderSceneManifestSchema>;

export const createRenderJobRequestSchema = z
  .object({
    cameraId: modelElementIdSchema,
    enhancement: z.enum(["disabled", "optional-provider"]),
    label: boundedLabelSchema,
    lightingPresetId: z.enum(["canonical-lights-neutral-world-v1"]),
    profileId: renderProfileSchema.shape.profileId,
    sourceSceneJobId: sceneJobIdSchema,
    specification: z
      .object({ specificationId: uuidSchema, specificationRevision: z.int().positive() })
      .strict()
      .optional(),
  })
  .strict();
export type CreateRenderJobRequest = z.infer<typeof createRenderJobRequestSchema>;

export const renderJobStateSchema = z.enum([
  "queued",
  "preparing",
  "rendering-safe",
  "validating-safe",
  "publishing-safe",
  "succeeded",
  "cancel-requested",
  "cancelled",
  "failed",
]);
export type RenderJobState = z.infer<typeof renderJobStateSchema>;

export const renderJobSchema = z
  .object({
    attempt: z.int().positive().max(c14RenderPolicy.maximumAttempts),
    createdAt: z.iso.datetime({ offset: true }),
    createdBy: uuidSchema,
    id: renderJobIdSchema,
    projectId: uuidSchema,
    request: createRenderJobRequestSchema,
    resultId: renderResultIdSchema.optional(),
    safeCode: safeCodeSchema.optional(),
    state: renderJobStateSchema,
    updatedAt: z.iso.datetime({ offset: true }),
    version: z.int().positive(),
  })
  .strict()
  .superRefine((job, context) => {
    const terminalSuccess = job.state === "succeeded";
    if ((job.resultId !== undefined) !== terminalSuccess) {
      context.addIssue({ code: "custom", message: "Only succeeded render jobs expose a result." });
    }
    if ((job.safeCode !== undefined) !== (job.state === "failed")) {
      context.addIssue({ code: "custom", message: "Only failed render jobs expose a safe code." });
    }
  });
export type RenderJob = z.infer<typeof renderJobSchema>;

export const renderArtifactRoleSchema = z.enum([
  "geometry-safe-png",
  "multilayer-exr",
  "depth-exr",
  "normal-exr",
  "segmentation-png",
  "illustrative-enhancement-png",
]);
export type RenderArtifactRole = z.infer<typeof renderArtifactRoleSchema>;

export const renderArtifactSchema = z
  .object({
    byteLength: z.int().positive().max(c14RenderPolicy.maximumArtifactBytes),
    heightPx: z.int().positive().max(c14RenderPolicy.maximumHeightPixels).optional(),
    id: renderArtifactIdSchema,
    mediaType: z.enum(["image/png", "image/x-exr", "application/json"]),
    role: renderArtifactRoleSchema,
    schemaVersion: z.literal(c14RenderArtifactSchemaVersion),
    sha256: sha256HexSchema,
    widthPx: z.int().positive().max(c14RenderPolicy.maximumWidthPixels).optional(),
  })
  .strict()
  .superRefine((artifact, context) => {
    if (artifact.widthPx === undefined || artifact.heightPx === undefined) {
      context.addIssue({ code: "custom", message: "Image artifacts require exact dimensions." });
    }
    const expectedMediaType = artifact.role.endsWith("-png") ? "image/png" : "image/x-exr";
    if (artifact.mediaType !== expectedMediaType) {
      context.addIssue({ code: "custom", message: "Artifact role and media type do not match." });
    }
  });
export type RenderArtifact = z.infer<typeof renderArtifactSchema>;

export const geometryGuardReportSchema = z
  .object({
    accepted: z.boolean(),
    allowedMaskSha256: sha256HexSchema,
    baseArtifactSha256: sha256HexSchema,
    cameraLocked: z.boolean(),
    changedOutsideAllowedMaskPixels: z.int().nonnegative().max(c14RenderPolicy.maximumPixels),
    changedPixelCount: z.int().nonnegative().max(c14RenderPolicy.maximumPixels),
    enhancedArtifactSha256: sha256HexSchema,
    protectedEdgeAgreementBasisPoints: z.int().min(0).max(10_000),
    protectedGeometryMoved: z.boolean(),
    safeCode: safeCodeSchema.optional(),
    schemaVersion: z.literal(c14GeometryGuardSchemaVersion),
    segmentationIoUBasisPoints: z.int().min(0).max(10_000),
  })
  .strict()
  .superRefine((report, context) => {
    const passed =
      report.cameraLocked &&
      !report.protectedGeometryMoved &&
      report.changedOutsideAllowedMaskPixels === 0 &&
      report.protectedEdgeAgreementBasisPoints >= 9_800 &&
      report.segmentationIoUBasisPoints >= 9_800;
    if (report.accepted !== passed) {
      context.addIssue({
        code: "custom",
        message: "Geometry guard acceptance contradicts its metrics.",
      });
    }
    if ((report.safeCode !== undefined) !== !report.accepted) {
      context.addIssue({ code: "custom", message: "Rejected enhancements require one safe code." });
    }
  });
export type GeometryGuardReport = z.infer<typeof geometryGuardReportSchema>;

export const enhancementResultSchema = z
  .object({
    artifact: renderArtifactSchema.optional(),
    baseArtifactSha256: sha256HexSchema,
    conditioningSha256: z
      .object({ depth: sha256HexSchema, normal: sha256HexSchema, segmentation: sha256HexSchema })
      .strict(),
    geometryGuard: geometryGuardReportSchema.optional(),
    model: z
      .object({
        name: boundedLabelSchema,
        provider: boundedLabelSchema,
        version: safeVersionSchema,
      })
      .strict()
      .optional(),
    schemaVersion: z.literal(c14EnhancementResultSchemaVersion),
    state: z.enum(["not-requested", "disabled", "succeeded", "failed", "rejected"]),
  })
  .strict()
  .superRefine((enhancement, context) => {
    const succeeded = enhancement.state === "succeeded";
    if ((enhancement.artifact !== undefined) !== succeeded) {
      context.addIssue({
        code: "custom",
        message: "Only accepted enhancements expose an artifact.",
      });
    }
    if (enhancement.artifact && enhancement.artifact.role !== "illustrative-enhancement-png") {
      context.addIssue({ code: "custom", message: "Enhancement output must remain illustrative." });
    }
    if (
      (enhancement.geometryGuard !== undefined) !==
      ["succeeded", "rejected"].includes(enhancement.state)
    ) {
      context.addIssue({
        code: "custom",
        message: "Attempted enhancements require a geometry guard.",
      });
    }
    if (succeeded && enhancement.geometryGuard?.accepted !== true) {
      context.addIssue({ code: "custom", message: "Rejected geometry cannot be published." });
    }
  });
export type EnhancementResult = z.infer<typeof enhancementResultSchema>;

export const renderOutputManifestSchema = z
  .object({
    artifacts: z.array(renderArtifactSchema).min(5).max(c14RenderPolicy.maximumArtifactsPerResult),
    authority: z.literal("derived-visualisation-only"),
    exactByteReplayScope: z.literal("same-host-build-script-profile-source"),
    hostFingerprintSha256: sha256HexSchema,
    renderSceneManifestSha256: sha256HexSchema,
    renderer: z
      .object({
        blenderBuildHash: safeVersionSchema,
        blenderVersion: safeVersionSchema,
        executableSha256: sha256HexSchema,
        scriptSha256: sha256HexSchema,
      })
      .strict(),
    resultId: renderResultIdSchema,
    schemaVersion: z.literal(c14RenderOutputManifestSchemaVersion),
    source: renderSourceReferenceSchema,
  })
  .strict()
  .superRefine((manifest, context) => {
    const roles = manifest.artifacts.map(({ role }) => role);
    const required: readonly RenderArtifactRole[] = [
      "geometry-safe-png",
      "multilayer-exr",
      "depth-exr",
      "normal-exr",
      "segmentation-png",
    ];
    if (required.some((role) => !roles.includes(role)) || new Set(roles).size !== roles.length) {
      context.addIssue({
        code: "custom",
        message: "Safe render bundles require one of every frozen role.",
      });
    }
    if (roles.includes("illustrative-enhancement-png")) {
      context.addIssue({
        code: "custom",
        message:
          "Optional enhancements are child products and cannot delay or mutate a safe bundle.",
      });
    }
  });
export type RenderOutputManifest = z.infer<typeof renderOutputManifestSchema>;

export const renderResultSchema = z
  .object({
    createdAt: z.iso.datetime({ offset: true }),
    createdBy: uuidSchema,
    id: renderResultIdSchema,
    jobId: renderJobIdSchema,
    manifest: renderOutputManifestSchema,
    manifestSha256: sha256HexSchema,
    projectId: uuidSchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (
      result.id !== result.manifest.resultId ||
      result.projectId !== result.manifest.source.projectId
    ) {
      context.addIssue({
        code: "custom",
        message: "Render result scope must match its immutable manifest.",
      });
    }
  });
export type RenderResult = z.infer<typeof renderResultSchema>;

export const renderArtifactAccessSchema = z
  .object({
    artifactId: renderArtifactIdSchema,
    byteLength: z.int().positive().max(c14RenderPolicy.maximumArtifactBytes),
    expiresAt: z.iso.datetime({ offset: true }),
    manifestSha256: sha256HexSchema,
    mediaType: z.enum(["image/png", "image/x-exr", "application/json"]),
    role: renderArtifactRoleSchema,
    sha256: sha256HexSchema,
    url: z.url().max(8_192),
  })
  .strict();

export const renderEnhancementJobSchema = z
  .object({
    attempt: z.int().positive().max(c14RenderPolicy.maximumAttempts),
    baseArtifactSha256: sha256HexSchema,
    createdAt: z.iso.datetime({ offset: true }),
    createdBy: uuidSchema,
    id: uuidSchema,
    projectId: uuidSchema,
    renderJobId: renderJobIdSchema,
    safeCode: safeCodeSchema.optional(),
    state: z.enum([
      "queued",
      "running",
      "succeeded",
      "disabled",
      "rejected",
      "failed",
      "cancelled",
    ]),
    updatedAt: z.iso.datetime({ offset: true }),
    version: z.int().positive(),
  })
  .strict();

export const c14RouteContract = Object.freeze({
  cancelJob: "/v1/projects/:projectId/render-jobs/:jobId/cancel",
  createJob: "/v1/projects/:projectId/render-jobs",
  getArtifactAccess: "/v1/projects/:projectId/render-jobs/:jobId/artifacts/:artifactId/access",
  getCapabilities: "/v1/projects/:projectId/render-capabilities",
  getJob: "/v1/projects/:projectId/render-jobs/:jobId",
  getResult: "/v1/projects/:projectId/render-jobs/:jobId/result",
  getEnhancement: "/v1/projects/:projectId/render-jobs/:jobId/enhancement",
  listJobs: "/v1/projects/:projectId/render-jobs",
  retryJob: "/v1/projects/:projectId/render-jobs/:jobId/retry",
  requestEnhancement: "/v1/projects/:projectId/render-jobs/:jobId/enhancement",
} as const);
