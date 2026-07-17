import { z } from "zod";

export const c8ReconstructionJobSchemaVersion = "c8-reconstruction-job-v1" as const;
export const c8MediaPreparationSchemaVersion = "c8-media-preparation-v1" as const;
export const c8GeometryResultSchemaVersion = "c8-geometry-result-v1" as const;
export const c8AppearanceResultSchemaVersion = "c8-appearance-result-v1" as const;
export const c8ReconstructionResultSchemaVersion = "c8-reconstruction-result-v1" as const;

export const c8ReconstructionPolicy = Object.freeze({
  maximumArtifactBytes: 53_687_091_200,
  maximumArtifactCount: 64,
  maximumAttempts: 3,
  maximumDisconnectedComponents: 1_000,
  maximumFrameCount: 10_000,
  maximumFramePixels: 50_000_000,
  maximumRegistrationAnchors: 32,
  maximumSourceAssetBytes: 21_474_836_480,
  maximumSourceAssetCount: 512,
  maximumSourceBytes: 107_374_182_400,
  minimumSimilarityAlignmentAnchors: 3,
  workerTimeoutMilliseconds: 86_400_000,
} as const);

const uuidSchema = z.uuid();
const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const safeCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/u);
const safeAdapterIdSchema = z.string().regex(/^[a-z][a-z0-9.-]{2,79}$/u);
const boundedVersionSchema = z.string().trim().min(1).max(100);
const coordinateMicrometreSchema = z.int().min(-1_000_000_000).max(1_000_000_000);

export const reconstructionJobIdSchema = uuidSchema;
export const reconstructionResultIdSchema = uuidSchema;
export const reconstructionArtifactIdSchema = uuidSchema;

export const reconstructionRightsSchema = z
  .object({
    basis: z.enum(["owned-by-user", "permission-granted", "public-domain", "licensed"]),
    serviceProcessingConsent: z.literal(true),
    trainingUseConsent: z.literal("denied"),
  })
  .strict();

export const reconstructionModeSchema = z.enum(["rgb-sfm", "rgbd-tsdf", "hybrid"]);
export type ReconstructionMode = z.infer<typeof reconstructionModeSchema>;

export const reconstructionAppearanceModeSchema = z.enum(["disabled", "optional"]);
export type ReconstructionAppearanceMode = z.infer<typeof reconstructionAppearanceModeSchema>;

export const reconstructionSourceKindSchema = z.enum([
  "rgb-image",
  "rgb-video",
  "depth-sequence",
  "camera-calibration",
  "camera-poses",
]);

export const reconstructionSourceMimeTypeSchema = z.enum([
  "application/json",
  "application/octet-stream",
  "image/heic",
  "image/jpeg",
  "image/png",
  "video/mp4",
  "video/quicktime",
]);

export const reconstructionSourceSchema = z
  .object({
    assetId: uuidSchema,
    byteSize: z.int().positive().max(c8ReconstructionPolicy.maximumSourceAssetBytes),
    detectedMimeType: reconstructionSourceMimeTypeSchema,
    kind: reconstructionSourceKindSchema,
    sha256: sha256HexSchema,
  })
  .strict()
  .superRefine((source, context) => {
    const allowedTypes: Readonly<Record<typeof source.kind, readonly string[]>> = {
      "camera-calibration": ["application/json"],
      "camera-poses": ["application/json"],
      "depth-sequence": ["application/json", "application/octet-stream"],
      "rgb-image": ["image/heic", "image/jpeg", "image/png"],
      "rgb-video": ["video/mp4", "video/quicktime"],
    };
    if (!allowedTypes[source.kind].includes(source.detectedMimeType)) {
      context.addIssue({
        code: "custom",
        message: "The reconstruction source kind and detected media type disagree.",
      });
    }
  });
export type ReconstructionSource = z.infer<typeof reconstructionSourceSchema>;

export const reconstructionPointMicrometresSchema = z
  .object({
    x: coordinateMicrometreSchema,
    y: coordinateMicrometreSchema,
    z: coordinateMicrometreSchema,
  })
  .strict();

export const reconstructionRegistrationAnchorSchema = z
  .object({
    anchorId: uuidSchema,
    method: z.enum(["roomplan-correspondence", "survey-correspondence", "user-correspondence"]),
    sourcePointMicrometres: reconstructionPointMicrometresSchema,
    targetPointMicrometres: reconstructionPointMicrometresSchema,
  })
  .strict();

export const createReconstructionJobRequestSchema = z
  .object({
    appearanceMode: reconstructionAppearanceModeSchema,
    label: z.string().trim().min(1).max(120),
    mode: reconstructionModeSchema,
    registrationAnchors: z
      .array(reconstructionRegistrationAnchorSchema)
      .max(c8ReconstructionPolicy.maximumRegistrationAnchors),
    rights: reconstructionRightsSchema,
    sources: z
      .array(reconstructionSourceSchema)
      .min(1)
      .max(c8ReconstructionPolicy.maximumSourceAssetCount),
  })
  .strict()
  .superRefine((request, context) => {
    const sourceIds = request.sources.map(({ assetId }) => assetId);
    if (new Set(sourceIds).size !== sourceIds.length) {
      context.addIssue({ code: "custom", message: "Reconstruction source assets must be unique." });
    }
    const sourceBytes = request.sources.reduce((total, source) => total + source.byteSize, 0);
    if (sourceBytes > c8ReconstructionPolicy.maximumSourceBytes) {
      context.addIssue({
        code: "custom",
        message: "Reconstruction source bytes exceed the job limit.",
      });
    }
    if (!request.sources.some(({ kind }) => kind === "rgb-image" || kind === "rgb-video")) {
      context.addIssue({ code: "custom", message: "Reconstruction requires an RGB source." });
    }
    if (
      request.mode !== "rgb-sfm" &&
      !request.sources.some(({ kind }) => kind === "depth-sequence")
    ) {
      context.addIssue({
        code: "custom",
        message: "RGB-D and hybrid modes require depth evidence.",
      });
    }
    const anchorIds = request.registrationAnchors.map(({ anchorId }) => anchorId);
    if (new Set(anchorIds).size !== anchorIds.length) {
      context.addIssue({ code: "custom", message: "Registration anchors must be unique." });
    }
    if (
      request.registrationAnchors.length > 0 &&
      request.registrationAnchors.length < c8ReconstructionPolicy.minimumSimilarityAlignmentAnchors
    ) {
      context.addIssue({
        code: "custom",
        message: "Similarity alignment requires at least three independent correspondences.",
      });
    }
    const sourcePoints = request.registrationAnchors.map(({ sourcePointMicrometres }) =>
      JSON.stringify(sourcePointMicrometres),
    );
    const targetPoints = request.registrationAnchors.map(({ targetPointMicrometres }) =>
      JSON.stringify(targetPointMicrometres),
    );
    if (
      new Set(sourcePoints).size !== sourcePoints.length ||
      new Set(targetPoints).size !== targetPoints.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Registration correspondences require distinct source and target points.",
      });
    }
  });
export type CreateReconstructionJobRequest = z.infer<typeof createReconstructionJobRequestSchema>;

export const reconstructionJobStateSchema = z.enum([
  "created",
  "preparing",
  "ready-for-reconstruction",
  "reconstructing-geometry",
  "reconstructing-appearance",
  "completed",
  "abstained",
  "cancel-requested",
  "cancelled",
  "failed",
]);
export type ReconstructionJobState = z.infer<typeof reconstructionJobStateSchema>;

export const reconstructionJobSchema = z
  .object({
    attempt: z.int().min(1).max(c8ReconstructionPolicy.maximumAttempts),
    createdAt: z.iso.datetime({ offset: true }),
    id: reconstructionJobIdSchema,
    projectId: uuidSchema,
    request: createReconstructionJobRequestSchema,
    resultId: reconstructionResultIdSchema.optional(),
    retryable: z.boolean(),
    safeCode: safeCodeSchema.optional(),
    schemaVersion: z.literal(c8ReconstructionJobSchemaVersion),
    state: reconstructionJobStateSchema,
    updatedAt: z.iso.datetime({ offset: true }),
    version: z.int().positive(),
  })
  .strict()
  .superRefine((job, context) => {
    const hasResult = job.state === "completed" || job.state === "abstained";
    if (hasResult !== (job.resultId !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "Only terminal result states have a result ID.",
      });
    }
    const hasSafeCode = job.state === "abstained" || job.state === "failed";
    if (hasSafeCode !== (job.safeCode !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "Failure and abstention require one safe code.",
      });
    }
  });
export type ReconstructionJob = z.infer<typeof reconstructionJobSchema>;

export const reconstructionToolManifestSchema = z
  .object({
    adapterId: safeAdapterIdSchema,
    adapterVersion: boundedVersionSchema,
    configSha256: sha256HexSchema,
    containerImageDigest: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/u)
      .optional(),
    executableVersion: boundedVersionSchema,
  })
  .strict();

export const preparedFrameSchema = z
  .object({
    blurScoreMillionths: z.int().min(0).max(1_000_000),
    exposureScoreMillionths: z.int().min(0).max(1_000_000),
    frameId: uuidSchema,
    heightPixels: z.int().positive().max(100_000),
    metadataStripped: z.literal(true),
    overlapScoreMillionths: z.int().min(0).max(1_000_000),
    redactionStatus: z.enum(["not-required", "applied", "review-required"]),
    sanitizedSha256: sha256HexSchema,
    sourceAssetId: uuidSchema,
    timestampMicroseconds: z.int().nonnegative().max(86_400_000_000),
    widthPixels: z.int().positive().max(100_000),
  })
  .strict()
  .superRefine((frame, context) => {
    if (frame.widthPixels * frame.heightPixels > c8ReconstructionPolicy.maximumFramePixels) {
      context.addIssue({ code: "custom", message: "A prepared frame exceeds the pixel budget." });
    }
  });

export const mediaPreparationManifestSchema = z
  .object({
    frames: z.array(preparedFrameSchema).max(c8ReconstructionPolicy.maximumFrameCount),
    jobId: reconstructionJobIdSchema,
    manifestSha256: sha256HexSchema,
    privacyStatus: z.enum(["accepted", "review-required", "rejected"]),
    projectId: uuidSchema,
    schemaVersion: z.literal(c8MediaPreparationSchemaVersion),
    sourceManifestSha256: sha256HexSchema,
    tool: reconstructionToolManifestSchema,
  })
  .strict()
  .superRefine((manifest, context) => {
    const frameIds = manifest.frames.map(({ frameId }) => frameId);
    if (new Set(frameIds).size !== frameIds.length) {
      context.addIssue({ code: "custom", message: "Prepared frame IDs must be unique." });
    }
    if (
      manifest.privacyStatus === "accepted" &&
      manifest.frames.some(({ redactionStatus }) => redactionStatus === "review-required")
    ) {
      context.addIssue({
        code: "custom",
        message: "Privacy acceptance cannot retain a frame requiring redaction review.",
      });
    }
  });
export type MediaPreparationManifest = z.infer<typeof mediaPreparationManifestSchema>;

export const reconstructionArtifactKindSchema = z.enum([
  "sanitized-frame-manifest",
  "calibrated-cameras",
  "sparse-point-cloud",
  "dense-point-cloud",
  "triangle-mesh",
  "diagnostics",
  "nerfstudio-viewer",
  "gaussian-splat",
]);

export const reconstructionArtifactSchema = z
  .object({
    artifactId: reconstructionArtifactIdSchema,
    byteSize: z.int().positive().max(c8ReconstructionPolicy.maximumArtifactBytes),
    contentSha256: sha256HexSchema,
    dimensionalAuthority: z.enum(["proposal-only", "non-dimensional"]),
    kind: reconstructionArtifactKindSchema,
    mediaType: z.string().regex(/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/u),
    sourceManifestSha256: sha256HexSchema,
    toolManifestSha256: sha256HexSchema,
  })
  .strict()
  .superRefine((artifact, context) => {
    const appearanceArtifact =
      artifact.kind === "nerfstudio-viewer" || artifact.kind === "gaussian-splat";
    if (appearanceArtifact !== (artifact.dimensionalAuthority === "non-dimensional")) {
      context.addIssue({
        code: "custom",
        message: "Only appearance artifacts are non-dimensional.",
      });
    }
  });
export type ReconstructionArtifact = z.infer<typeof reconstructionArtifactSchema>;

export const reconstructionGeometryResultSchema = z
  .object({
    alignment: z
      .object({
        anchorCount: z.int().nonnegative().max(c8ReconstructionPolicy.maximumRegistrationAnchors),
        residualP90Micrometres: z.int().nonnegative().max(100_000_000).optional(),
      })
      .strict(),
    artifacts: z
      .array(reconstructionArtifactSchema)
      .min(2)
      .max(c8ReconstructionPolicy.maximumArtifactCount),
    componentCount: z.int().positive().max(c8ReconstructionPolicy.maximumDisconnectedComponents),
    coordinateSystem: z.literal("right-handed-local"),
    inputFrameCount: z.int().positive().max(c8ReconstructionPolicy.maximumFrameCount),
    manifestSha256: sha256HexSchema,
    registeredFrameCount: z.int().positive().max(c8ReconstructionPolicy.maximumFrameCount),
    scaleStatus: z.enum(["metric-validated", "metric-estimated", "unknown"]),
    schemaVersion: z.literal(c8GeometryResultSchemaVersion),
    tool: reconstructionToolManifestSchema,
    unit: z.enum(["micrometres", "arbitrary-units"]),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.registeredFrameCount > result.inputFrameCount) {
      context.addIssue({ code: "custom", message: "Registered frames cannot exceed inputs." });
    }
    if ((result.scaleStatus === "unknown") !== (result.unit === "arbitrary-units")) {
      context.addIssue({
        code: "custom",
        message: "Unknown scale must remain in arbitrary units.",
      });
    }
    if (
      result.scaleStatus === "metric-validated" &&
      (result.alignment.anchorCount < c8ReconstructionPolicy.minimumSimilarityAlignmentAnchors ||
        result.alignment.residualP90Micrometres === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Validated metric alignment requires three anchors and a residual.",
      });
    }
    if (
      !result.artifacts.some(({ kind }) => kind === "calibrated-cameras") ||
      !result.artifacts.some(({ kind }) =>
        ["sparse-point-cloud", "dense-point-cloud", "triangle-mesh"].includes(kind),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Geometry results require cameras and at least one geometry artifact.",
      });
    }
  });
export type ReconstructionGeometryResult = z.infer<typeof reconstructionGeometryResultSchema>;

export const reconstructionAppearanceResultSchema = z
  .object({
    artifacts: z
      .array(reconstructionArtifactSchema)
      .min(1)
      .max(c8ReconstructionPolicy.maximumArtifactCount),
    geometryManifestSha256: sha256HexSchema,
    manifestSha256: sha256HexSchema,
    method: z.enum(["nerfstudio", "gsplat"]),
    schemaVersion: z.literal(c8AppearanceResultSchemaVersion),
    tool: reconstructionToolManifestSchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (
      result.artifacts.some(
        ({ dimensionalAuthority }) => dimensionalAuthority !== "non-dimensional",
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Appearance outputs never carry dimensional authority.",
      });
    }
  });
export type ReconstructionAppearanceResult = z.infer<typeof reconstructionAppearanceResultSchema>;

const reconstructionResultCoreSchema = z
  .object({
    createdAt: z.iso.datetime({ offset: true }),
    jobId: reconstructionJobIdSchema,
    projectId: uuidSchema,
    resultId: reconstructionResultIdSchema,
    schemaVersion: z.literal(c8ReconstructionResultSchemaVersion),
    sourceManifestSha256: sha256HexSchema,
  })
  .strict();

export const reconstructionResultSchema = z.discriminatedUnion("status", [
  reconstructionResultCoreSchema.extend({
    appearance: reconstructionAppearanceResultSchema.optional(),
    findings: z.array(safeCodeSchema).max(100),
    geometry: reconstructionGeometryResultSchema,
    status: z.literal("completed"),
  }),
  reconstructionResultCoreSchema.extend({
    diagnosticArtifact: reconstructionArtifactSchema,
    findings: z.array(safeCodeSchema).min(1).max(100),
    safeCode: safeCodeSchema,
    status: z.literal("abstained"),
  }),
]);
export type ReconstructionResult = z.infer<typeof reconstructionResultSchema>;

export const c8RouteContract = Object.freeze({
  cancelJob: "/v1/projects/:projectId/reconstruction-jobs/:reconstructionJobId/cancel",
  createJob: "/v1/projects/:projectId/reconstruction-jobs",
  getJob: "/v1/projects/:projectId/reconstruction-jobs/:reconstructionJobId",
  getResult: "/v1/projects/:projectId/reconstruction-jobs/:reconstructionJobId/result",
  listJobs: "/v1/projects/:projectId/reconstruction-jobs",
  retryJob: "/v1/projects/:projectId/reconstruction-jobs/:reconstructionJobId/retry",
});
