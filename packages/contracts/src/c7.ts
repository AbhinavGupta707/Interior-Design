import { z } from "zod";

import { canonicalHomeSnapshotSchema, modelElementIdSchema } from "./c4.js";

export const c7CaptureSessionSchemaVersion = "c7-capture-session-v1" as const;
export const c7CapturePackageSchemaVersion = "c7-capture-package-v1" as const;
export const c7RoomPlanNormalizedSchemaVersion = "c7-roomplan-normalized-v1" as const;
export const c7CaptureProposalSchemaVersion = "c7-capture-proposal-v1" as const;

export const c7CapturePolicy = Object.freeze({
  maximumArtifactBytes: 536_870_912,
  maximumArtifactCount: 256,
  maximumObjectCount: 10_000,
  maximumPackageBytes: 2_147_483_648,
  maximumPolygonCorners: 256,
  maximumReferenceMeasurements: 100,
  maximumRoomCount: 64,
  maximumScanDurationMilliseconds: 21_600_000,
  maximumSurfaceCount: 10_000,
  maximumUploadPartCount: 10_000,
  minimumProposalConfidence: 60,
  uploadPartSizeBytes: 8_388_608,
} as const);

const uuidSchema = z.uuid();
const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const boundedVersionSchema = z.string().trim().min(1).max(100);
const safeCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/u);
const safeIdentifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._,-]{0,119}$/u);
const confidencePercentSchema = z.int().min(0).max(100);
const micrometreSchema = z.int().min(-1_000_000_000).max(1_000_000_000);
const positiveMicrometreSchema = z.int().positive().max(100_000_000);
const basisNanounitSchema = z.int().min(-1_100_000_000).max(1_100_000_000);

export const captureSessionIdSchema = uuidSchema;
export const capturePackageIdSchema = uuidSchema;
export const captureArtifactIdSchema = uuidSchema;
export const captureProposalIdSchema = uuidSchema;

export const captureModeSchema = z.enum(["single-room", "structure"]);
export type CaptureMode = z.infer<typeof captureModeSchema>;

export const captureRightsSchema = z
  .object({
    basis: z.enum(["owned-by-user", "permission-granted", "public-domain", "licensed"]),
    serviceProcessingConsent: z.literal(true),
    trainingUseConsent: z.literal("denied"),
  })
  .strict();

export const createCaptureSessionRequestSchema = z
  .object({
    captureLabel: z.string().trim().min(1).max(120),
    deviceCapability: z.literal("roomplan-lidar"),
    expectedRoomCount: z.int().min(1).max(c7CapturePolicy.maximumRoomCount).optional(),
    mode: captureModeSchema,
    rights: captureRightsSchema,
  })
  .strict();
export type CreateCaptureSessionRequest = z.infer<typeof createCaptureSessionRequestSchema>;

export const captureBriefSchema = z
  .object({
    captureLabel: z.string().trim().min(1).max(120),
    captureSessionId: captureSessionIdSchema,
    expiresAt: z.iso.datetime({ offset: true }),
    expectedRoomCount: z.int().min(1).max(c7CapturePolicy.maximumRoomCount).optional(),
    instructionsVersion: boundedVersionSchema,
    mode: captureModeSchema,
    projectId: uuidSchema,
    rights: captureRightsSchema,
    schemaVersion: z.literal(c7CaptureSessionSchemaVersion),
  })
  .strict();
export type CaptureBrief = z.infer<typeof captureBriefSchema>;

export const captureSessionStateSchema = z.enum([
  "created",
  "uploading",
  "uploaded",
  "processing",
  "proposed",
  "abstained",
  "cancel-requested",
  "cancelled",
  "failed",
]);
export type CaptureSessionState = z.infer<typeof captureSessionStateSchema>;

export const captureSessionSchema = z
  .object({
    brief: captureBriefSchema,
    createdAt: z.iso.datetime({ offset: true }),
    id: captureSessionIdSchema,
    packageId: capturePackageIdSchema.optional(),
    projectId: uuidSchema,
    proposalId: captureProposalIdSchema.optional(),
    retryable: z.boolean(),
    safeCode: safeCodeSchema.optional(),
    schemaVersion: z.literal(c7CaptureSessionSchemaVersion),
    state: captureSessionStateSchema,
    updatedAt: z.iso.datetime({ offset: true }),
    version: z.int().positive(),
  })
  .strict()
  .superRefine((session, context) => {
    if (
      session.brief.captureSessionId !== session.id ||
      session.brief.projectId !== session.projectId
    ) {
      context.addIssue({
        code: "custom",
        message: "The capture brief must belong to the session.",
      });
    }
    const needsPackage = ["uploaded", "processing", "proposed", "abstained"].includes(
      session.state,
    );
    if (needsPackage !== (session.packageId !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "The capture state and package reference disagree.",
      });
    }
    if ((session.state === "proposed") !== (session.proposalId !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "Only a proposed session has a proposal reference.",
      });
    }
    const needsSafeCode = ["abstained", "failed"].includes(session.state);
    if (needsSafeCode !== (session.safeCode !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "Failure and abstention states require one safe code.",
      });
    }
  });
export type CaptureSession = z.infer<typeof captureSessionSchema>;

export const captureArtifactKindSchema = z.enum([
  "captured-room-json",
  "captured-room-data-json",
  "captured-structure-json",
  "roomplan-normalized-json",
  "quality-manifest-json",
  "structure-usdz",
]);
export type CaptureArtifactKind = z.infer<typeof captureArtifactKindSchema>;

export const captureArtifactContentTypeSchema = z.enum(["application/json", "model/vnd.usdz+zip"]);

export const createCaptureArtifactUploadRequestSchema = z
  .object({
    byteSize: z.int().positive().max(c7CapturePolicy.maximumArtifactBytes),
    contentType: captureArtifactContentTypeSchema,
    kind: captureArtifactKindSchema,
    roomId: uuidSchema.optional(),
    sha256: sha256HexSchema,
  })
  .strict()
  .superRefine((artifact, context) => {
    const roomScoped = ["captured-room-json", "captured-room-data-json"].includes(artifact.kind);
    if (roomScoped !== (artifact.roomId !== undefined)) {
      context.addIssue({ code: "custom", message: "Only room artifacts require a room ID." });
    }
    const expectedType =
      artifact.kind === "structure-usdz" ? "model/vnd.usdz+zip" : "application/json";
    if (artifact.contentType !== expectedType) {
      context.addIssue({ code: "custom", message: "The artifact kind and media type disagree." });
    }
  });

export const captureArtifactUploadSessionStateSchema = z.enum([
  "initiated",
  "uploading",
  "completed",
  "aborted",
  "expired",
]);

export const captureArtifactUploadSessionSchema = z
  .object({
    artifactId: captureArtifactIdSchema,
    captureSessionId: captureSessionIdSchema,
    expiresAt: z.iso.datetime({ offset: true }),
    maximumPartCount: z.literal(c7CapturePolicy.maximumUploadPartCount),
    minimumNonFinalPartSize: z.literal(5_242_880),
    partSize: z.literal(c7CapturePolicy.uploadPartSizeBytes),
    recordedPartNumbers: z
      .array(z.int().min(1).max(c7CapturePolicy.maximumUploadPartCount))
      .max(c7CapturePolicy.maximumUploadPartCount),
    state: captureArtifactUploadSessionStateSchema,
    uploadSessionId: uuidSchema,
  })
  .strict()
  .refine(({ recordedPartNumbers }) => {
    if (new Set(recordedPartNumbers).size !== recordedPartNumbers.length) {
      return false;
    }

    for (let index = 1; index < recordedPartNumbers.length; index += 1) {
      const current = recordedPartNumbers[index];
      const previous = recordedPartNumbers[index - 1];
      if (current === undefined || previous === undefined || current <= previous) {
        return false;
      }
    }

    return true;
  }, "Recorded artifact parts must be unique and sorted.");
export type CaptureArtifactUploadSession = z.infer<typeof captureArtifactUploadSessionSchema>;

const partChecksumSchema = z.string().regex(/^[A-Za-z0-9+/]{43}=$/u);

export const signCaptureArtifactPartRequestSchema = z
  .object({
    byteSize: z.int().positive().max(134_217_728),
    checksumSha256: partChecksumSchema,
    partNumber: z.int().min(1).max(c7CapturePolicy.maximumUploadPartCount),
  })
  .strict();

export const signedCaptureArtifactPartSchema = z
  .object({
    expiresAt: z.iso.datetime({ offset: true }),
    partNumber: z.int().min(1).max(c7CapturePolicy.maximumUploadPartCount),
    requiredHeaders: z.record(z.string().min(1).max(200), z.string().min(1).max(2_048)),
    url: z.url(),
  })
  .strict();

export const completedCaptureArtifactPartSchema = z
  .object({
    checksumSha256: partChecksumSchema,
    etag: z
      .string()
      .min(1)
      .max(512)
      .regex(/^[^\p{Cc}]+$/u),
    partNumber: z.int().min(1).max(c7CapturePolicy.maximumUploadPartCount),
  })
  .strict();

export const completeCaptureArtifactUploadRequestSchema = z
  .object({
    parts: z
      .array(completedCaptureArtifactPartSchema)
      .min(1)
      .max(c7CapturePolicy.maximumUploadPartCount),
  })
  .strict()
  .refine(
    ({ parts }) => parts.every(({ partNumber }, index) => partNumber === index + 1),
    "Artifact completion parts must be consecutive and ordered.",
  );

export const captureArtifactManifestSchema = createCaptureArtifactUploadRequestSchema.extend({
  artifactId: captureArtifactIdSchema,
});
export type CaptureArtifactManifest = z.infer<typeof captureArtifactManifestSchema>;

export const captureDeviceManifestSchema = z
  .object({
    appBuild: safeIdentifierSchema,
    appVersion: boundedVersionSchema,
    deviceModelIdentifier: safeIdentifierSchema,
    operatingSystemVersion: boundedVersionSchema,
    roomPlanSupported: z.literal(true),
  })
  .strict();

export const captureInstructionSchema = z.enum([
  "normal",
  "move-close-to-wall",
  "move-away-from-wall",
  "turn-on-light",
  "slow-down",
  "low-texture",
]);

export const captureQualityManifestSchema = z
  .object({
    heuristicName: z.literal("c7-roomplan-quality"),
    heuristicVersion: boundedVersionSchema,
    instructionCounts: z.record(captureInstructionSchema, z.int().nonnegative().max(1_000_000)),
    interruptionCount: z.int().nonnegative().max(10_000),
    lowConfidenceObjectCount: z.int().nonnegative().max(c7CapturePolicy.maximumObjectCount),
    lowConfidenceSurfaceCount: z.int().nonnegative().max(c7CapturePolicy.maximumSurfaceCount),
    relocalisationAttemptCount: z.int().nonnegative().max(10_000),
    relocalisationSuccessCount: z.int().nonnegative().max(10_000),
    scanDurationMilliseconds: z
      .int()
      .positive()
      .max(c7CapturePolicy.maximumScanDurationMilliseconds),
    worldMappingStatusAtFinish: z.enum(["not-available", "limited", "extending", "mapped"]),
  })
  .strict()
  .refine(
    ({ relocalisationAttemptCount, relocalisationSuccessCount }) =>
      relocalisationSuccessCount <= relocalisationAttemptCount,
    "Relocalisation successes cannot exceed attempts.",
  );

export const captureReferenceMeasurementSchema = z
  .object({
    distanceMillimetres: z.int().positive().max(100_000),
    fromSourceEntityId: uuidSchema,
    measurementId: uuidSchema,
    method: z.enum(["laser", "tape", "user-entered"]),
    toSourceEntityId: uuidSchema,
  })
  .strict()
  .refine(
    ({ fromSourceEntityId, toSourceEntityId }) => fromSourceEntityId !== toSourceEntityId,
    "A reference measurement needs two distinct source entities.",
  );

export const captureRoomManifestSchema = z
  .object({
    capturedRoomVersion: z.int().nonnegative().max(1_000_000),
    roomId: uuidSchema,
    sequence: z.int().min(1).max(c7CapturePolicy.maximumRoomCount),
    sourceRoomIdentifier: uuidSchema,
    story: z.int().min(-20).max(200),
    userLabel: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const createCapturePackageRequestSchema = z
  .object({
    artifacts: z
      .array(captureArtifactManifestSchema)
      .min(3)
      .max(c7CapturePolicy.maximumArtifactCount),
    captureSessionId: captureSessionIdSchema,
    device: captureDeviceManifestSchema,
    endedAt: z.iso.datetime({ offset: true }),
    mode: captureModeSchema,
    projectId: uuidSchema,
    quality: captureQualityManifestSchema,
    referenceMeasurements: z
      .array(captureReferenceMeasurementSchema)
      .max(c7CapturePolicy.maximumReferenceMeasurements),
    rights: captureRightsSchema,
    rooms: z.array(captureRoomManifestSchema).min(1).max(c7CapturePolicy.maximumRoomCount),
    schemaVersion: z.literal(c7CapturePackageSchemaVersion),
    sharedWorldOrigin: z.boolean(),
    startedAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (Date.parse(manifest.endedAt) <= Date.parse(manifest.startedAt)) {
      context.addIssue({ code: "custom", message: "Capture end time must follow start time." });
    }
    const artifactIds = manifest.artifacts.map(({ artifactId }) => artifactId);
    const roomIds = manifest.rooms.map(({ roomId }) => roomId);
    const roomIdSet = new Set(roomIds);
    if (new Set(artifactIds).size !== artifactIds.length) {
      context.addIssue({ code: "custom", message: "Capture artifact IDs must be unique." });
    }
    if (roomIdSet.size !== roomIds.length) {
      context.addIssue({ code: "custom", message: "Capture room IDs must be unique." });
    }
    const totalBytes = manifest.artifacts.reduce((total, artifact) => total + artifact.byteSize, 0);
    if (totalBytes > c7CapturePolicy.maximumPackageBytes) {
      context.addIssue({ code: "custom", message: "The capture package exceeds its byte budget." });
    }
    for (const artifact of manifest.artifacts) {
      if (artifact.roomId !== undefined && !roomIdSet.has(artifact.roomId)) {
        context.addIssue({
          code: "custom",
          message: "A room artifact references an unknown room.",
        });
      }
    }
    for (const roomId of roomIds) {
      const roomArtifactCount = manifest.artifacts.filter(
        ({ kind, roomId: artifactRoomId }) =>
          kind === "captured-room-json" && artifactRoomId === roomId,
      ).length;
      if (roomArtifactCount !== 1) {
        context.addIssue({ code: "custom", message: "Every room needs one captured-room JSON." });
      }
    }
    for (const singletonKind of ["roomplan-normalized-json", "quality-manifest-json"] as const) {
      if (manifest.artifacts.filter(({ kind }) => kind === singletonKind).length !== 1) {
        context.addIssue({ code: "custom", message: `The package needs one ${singletonKind}.` });
      }
    }
    if (
      manifest.mode === "structure" &&
      manifest.artifacts.filter(({ kind }) => kind === "captured-structure-json").length !== 1
    ) {
      context.addIssue({
        code: "custom",
        message: "A structure package needs one structure JSON.",
      });
    }
    if (manifest.mode === "structure" && !manifest.sharedWorldOrigin) {
      context.addIssue({
        code: "custom",
        message: "A structure capture requires a shared world origin.",
      });
    }
  });
export type CreateCapturePackageRequest = z.infer<typeof createCapturePackageRequestSchema>;

export const capturePackageSchema = z
  .object({
    createdAt: z.iso.datetime({ offset: true }),
    id: capturePackageIdSchema,
    manifest: createCapturePackageRequestSchema,
    manifestSha256: sha256HexSchema,
    projectId: uuidSchema,
    schemaVersion: z.literal(c7CapturePackageSchemaVersion),
  })
  .strict()
  .superRefine((capturePackage, context) => {
    if (capturePackage.manifest.projectId !== capturePackage.projectId) {
      context.addIssue({
        code: "custom",
        message: "The package and manifest project IDs disagree.",
      });
    }
  });

export const roomPlanConfidenceSchema = z.enum(["low", "medium", "high"]);
export const roomPlanSurfaceCategorySchema = z.enum([
  "floor",
  "wall",
  "door-open",
  "door-closed",
  "opening",
  "window",
]);

export const roomPlanObjectCategorySchema = z.enum([
  "bathtub",
  "bed",
  "chair",
  "dishwasher",
  "fireplace",
  "oven",
  "refrigerator",
  "sink",
  "sofa",
  "stairs",
  "storage",
  "table",
  "television",
  "toilet",
  "washer-dryer",
  "unknown",
]);

export const roomPlanTransformSchema = z
  .object({
    basisNanounits: z.array(basisNanounitSchema).length(9),
    translationMicrometres: z
      .object({ x: micrometreSchema, y: micrometreSchema, z: micrometreSchema })
      .strict(),
  })
  .strict();

const roomPlanPointSchema = z
  .object({ x: micrometreSchema, y: micrometreSchema, z: micrometreSchema })
  .strict();
const roomPlanDimensionsSchema = z
  .object({
    x: positiveMicrometreSchema,
    y: positiveMicrometreSchema,
    z: positiveMicrometreSchema,
  })
  .strict();

export const normalizedRoomPlanSurfaceSchema = z
  .object({
    category: roomPlanSurfaceCategorySchema,
    completedEdges: z.array(z.enum(["top", "bottom", "left", "right"])).max(4),
    confidence: roomPlanConfidenceSchema,
    curve: z
      .object({
        centreXMicrometres: micrometreSchema,
        centreZMicrometres: micrometreSchema,
        endNanoradians: z.int().min(-7_000_000_000).max(7_000_000_000),
        radiusMicrometres: positiveMicrometreSchema,
        startNanoradians: z.int().min(-7_000_000_000).max(7_000_000_000),
      })
      .strict()
      .optional(),
    dimensionsMicrometres: roomPlanDimensionsSchema,
    parentSourceIdentifier: uuidSchema.optional(),
    polygonCornersMicrometres: z
      .array(roomPlanPointSchema)
      .max(c7CapturePolicy.maximumPolygonCorners),
    roomId: uuidSchema,
    sourceIdentifier: uuidSchema,
    story: z.int().min(-20).max(200),
    transform: roomPlanTransformSchema,
  })
  .strict();

export const normalizedRoomPlanObjectSchema = z
  .object({
    category: roomPlanObjectCategorySchema,
    confidence: roomPlanConfidenceSchema,
    dimensionsMicrometres: roomPlanDimensionsSchema,
    parentSourceIdentifier: uuidSchema.optional(),
    roomId: uuidSchema,
    sourceIdentifier: uuidSchema,
    story: z.int().min(-20).max(200),
    transform: roomPlanTransformSchema,
  })
  .strict();

export const roomPlanNormalizedSchema = z
  .object({
    captureSessionId: captureSessionIdSchema,
    coordinateSystem: z
      .object({
        handedness: z.literal("right"),
        source: z.literal("roomplan-world"),
        translationUnit: z.literal("micrometre"),
        rotationUnit: z.literal("nanounit-basis"),
      })
      .strict(),
    objects: z.array(normalizedRoomPlanObjectSchema).max(c7CapturePolicy.maximumObjectCount),
    projectId: uuidSchema,
    quality: captureQualityManifestSchema,
    referenceMeasurements: z
      .array(captureReferenceMeasurementSchema)
      .max(c7CapturePolicy.maximumReferenceMeasurements),
    rooms: z.array(captureRoomManifestSchema).min(1).max(c7CapturePolicy.maximumRoomCount),
    schemaVersion: z.literal(c7RoomPlanNormalizedSchemaVersion),
    structureIdentifier: uuidSchema.optional(),
    surfaces: z.array(normalizedRoomPlanSurfaceSchema).max(c7CapturePolicy.maximumSurfaceCount),
  })
  .strict()
  .superRefine((normalized, context) => {
    const roomIds = new Set(normalized.rooms.map(({ roomId }) => roomId));
    const entityIds = [
      ...normalized.surfaces.map(({ sourceIdentifier }) => sourceIdentifier),
      ...normalized.objects.map(({ sourceIdentifier }) => sourceIdentifier),
    ];
    if (new Set(entityIds).size !== entityIds.length) {
      context.addIssue({
        code: "custom",
        message: "Normalized RoomPlan entity IDs must be unique.",
      });
    }
    for (const entity of [...normalized.surfaces, ...normalized.objects]) {
      if (!roomIds.has(entity.roomId)) {
        context.addIssue({
          code: "custom",
          message: "A normalized entity references an unknown room.",
        });
      }
    }
    const entityIdSet = new Set(entityIds);
    for (const entity of [...normalized.surfaces, ...normalized.objects]) {
      if (
        entity.parentSourceIdentifier !== undefined &&
        !entityIdSet.has(entity.parentSourceIdentifier)
      ) {
        context.addIssue({
          code: "custom",
          message: "A parent identifier is absent from the normalized input.",
        });
      }
    }
    if (normalized.rooms.length > 1 && normalized.structureIdentifier === undefined) {
      context.addIssue({
        code: "custom",
        message: "Multi-room normalized input needs a structure ID.",
      });
    }
  });
export type RoomPlanNormalized = z.infer<typeof roomPlanNormalizedSchema>;

export const captureConverterManifestSchema = z
  .object({
    adapterId: z.string().regex(/^[a-z][a-z0-9.-]{2,79}$/u),
    adapterVersion: boundedVersionSchema,
    manifestSha256: sha256HexSchema,
    normalizedInputSha256: sha256HexSchema,
  })
  .strict();

export const captureProposalFindingSchema = z
  .object({
    affectedSourceEntityIds: z.array(uuidSchema).max(256),
    code: safeCodeSchema,
    message: z.string().trim().min(1).max(500),
    severity: z.enum(["information", "warning", "error"]),
  })
  .strict();

export const captureElementSourceSchema = z
  .object({
    confidence: confidencePercentSchema,
    modelElementId: modelElementIdSchema,
    sourceEntityIds: z.array(uuidSchema).min(1).max(100),
    state: z.enum(["observed", "source-derived"]),
  })
  .strict();

const captureProposalCoreShape = {
  captureSessionId: captureSessionIdSchema,
  converter: captureConverterManifestSchema,
  createdAt: z.iso.datetime({ offset: true }),
  packageId: capturePackageIdSchema,
  packageManifestSha256: sha256HexSchema,
  projectId: uuidSchema,
  proposalId: captureProposalIdSchema,
  schemaVersion: z.literal(c7CaptureProposalSchemaVersion),
};

export const captureModelProposalSchema = z
  .object({
    ...captureProposalCoreShape,
    elementSources: z.array(captureElementSourceSchema).max(10_000),
    findings: z.array(captureProposalFindingSchema).max(10_000),
    overallConfidence: confidencePercentSchema.min(c7CapturePolicy.minimumProposalConfidence),
    proposedSnapshot: canonicalHomeSnapshotSchema,
    status: z.literal("proposal"),
    unresolvedSourceEntityIds: z.array(uuidSchema).max(10_000),
  })
  .strict()
  .superRefine((proposal, context) => {
    if (
      proposal.proposedSnapshot.projectId !== proposal.projectId ||
      proposal.proposedSnapshot.profile !== "existing"
    ) {
      context.addIssue({
        code: "custom",
        message: "A capture proposal must target this existing project.",
      });
    }
    const modelIds = proposal.elementSources.map(({ modelElementId }) => modelElementId);
    if (new Set(modelIds).size !== modelIds.length) {
      context.addIssue({
        code: "custom",
        message: "Each proposed element needs one source mapping.",
      });
    }
  });

export const captureAbstentionSchema = z
  .object({
    ...captureProposalCoreShape,
    code: z.enum([
      "unsupported-package",
      "source-mismatch",
      "rights-not-permitted",
      "resource-limit",
      "invalid-normalized-input",
      "incompatible-world-space",
      "ambiguous-topology",
      "low-quality",
      "conversion-failed",
    ]),
    detail: z.string().trim().min(1).max(500),
    findings: z.array(captureProposalFindingSchema).max(10_000),
    nextActions: z
      .array(z.enum(["rescan-room", "add-reference-measurement", "use-plan", "edit-manually"]))
      .min(1)
      .max(4),
    retryable: z.boolean(),
    status: z.literal("abstained"),
  })
  .strict();

export const captureProposalResultSchema = z.discriminatedUnion("status", [
  captureModelProposalSchema,
  captureAbstentionSchema,
]);
export type CaptureProposalResult = z.infer<typeof captureProposalResultSchema>;

export const c7RouteContract = Object.freeze({
  cancelSession: "/v1/projects/:projectId/capture-sessions/:captureSessionId/cancel",
  completeArtifactUpload:
    "/v1/projects/:projectId/capture-sessions/:captureSessionId/artifact-upload-sessions/:uploadSessionId/complete",
  createArtifactUpload:
    "/v1/projects/:projectId/capture-sessions/:captureSessionId/artifact-upload-sessions",
  createSession: "/v1/projects/:projectId/capture-sessions",
  finalizePackage: "/v1/projects/:projectId/capture-sessions/:captureSessionId/packages",
  getArtifactUpload:
    "/v1/projects/:projectId/capture-sessions/:captureSessionId/artifact-upload-sessions/:uploadSessionId",
  getProposal: "/v1/projects/:projectId/capture-sessions/:captureSessionId/proposal",
  getSession: "/v1/projects/:projectId/capture-sessions/:captureSessionId",
  listSessions: "/v1/projects/:projectId/capture-sessions",
  retrySession: "/v1/projects/:projectId/capture-sessions/:captureSessionId/retry",
  signArtifactPart:
    "/v1/projects/:projectId/capture-sessions/:captureSessionId/artifact-upload-sessions/:uploadSessionId/parts",
});
