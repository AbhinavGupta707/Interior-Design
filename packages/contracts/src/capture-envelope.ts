import { z } from "zod";

import { reconstructionJobSchema } from "./c8.js";

export const captureEnvelopeSchemaVersion = "capture-envelope-v1" as const;
export const captureEnvelopeAcceptanceSchemaVersion = "capture-envelope-acceptance-v1" as const;
export const captureEnvelopeReconstructionSchemaVersion =
  "capture-envelope-reconstruction-v1" as const;

export const captureEnvelopePolicy = Object.freeze({
  automaticKeyframeIntervalMicroseconds: 2_000_000,
  maximumCameraSamples: 10_000,
  maximumCoordinateSegments: 256,
  maximumDepthSources: 256,
  maximumMediaSources: 512,
  maximumRoomKeyframes: 256,
  maximumRoomCount: 64,
  maximumRoomPlanSources: 64,
  maximumScanDurationMilliseconds: 21_600_000,
} as const);

// UUID identity is case-insensitive. Canonicalise every envelope UUID at the contract boundary so
// native encoders (Foundation emits uppercase) cannot disagree with database or route casing.
const uuidSchema = z.uuid().transform((value) => value.toLowerCase());
const assetIdSchema = uuidSchema;
const projectIdSchema = uuidSchema;
const userIdSchema = uuidSchema;
const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const assetRightsBasisSchema = z.enum([
  "owned-by-user",
  "permission-granted",
  "public-domain",
  "licensed",
]);
const boundedVersionSchema = z.string().trim().min(1).max(100);
const safeIdentifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._,-]{0,119}$/u);
const scoreSchema = z.int().min(0).max(1_000_000);
const captureEnvelopeTimestampSchema = z.iso.datetime({ offset: true, precision: 3 });
const timestampMicrosecondsSchema = z.int().nonnegative().max(21_600_000_000);
const quaternionNanounitSchema = z.int().min(-1_000_000_000).max(1_000_000_000);
const translationMicrometreSchema = z.int().min(-1_000_000_000).max(1_000_000_000);

export const captureEnvelopeIdSchema = uuidSchema;

export const captureRuntimeSchema = z.enum(["physical-device", "simulator-fixture"]);
export const captureQualityTierSchema = z.enum([
  "guided-rgb",
  "guided-rgb-depth",
  "guided-rgb-depth-roomplan",
  "simulator-fixture",
]);

export const captureCapabilityDeclarationSchema = z
  .object({
    appBuild: safeIdentifierSchema,
    appVersion: boundedVersionSchema,
    arWorldTracking: z.boolean(),
    cameraIntrinsics: z.boolean(),
    cameraPoses: z.boolean(),
    deviceModelIdentifier: safeIdentifierSchema,
    operatingSystemVersion: boundedVersionSchema,
    qualityTier: captureQualityTierSchema,
    rgbKeyframes: z.boolean(),
    rgbVideo: z.boolean(),
    roomPlan: z.boolean(),
    runtime: captureRuntimeSchema,
    sceneDepth: z.boolean(),
    schemaVersion: z.literal("capture-capabilities-v1"),
  })
  .strict()
  .superRefine((capability, context) => {
    if (capability.runtime === "simulator-fixture") {
      if (
        capability.qualityTier !== "simulator-fixture" ||
        capability.arWorldTracking ||
        capability.cameraIntrinsics ||
        capability.cameraPoses ||
        capability.sceneDepth ||
        capability.roomPlan
      ) {
        context.addIssue({
          code: "custom",
          message: "Simulator fixtures cannot declare physical sensor capability.",
        });
      }
      return;
    }
    if (
      capability.qualityTier === "simulator-fixture" ||
      !capability.arWorldTracking ||
      !capability.cameraIntrinsics ||
      !capability.cameraPoses ||
      !capability.rgbKeyframes
    ) {
      context.addIssue({
        code: "custom",
        message: "Physical guided capture requires RGB keyframes and ARKit camera evidence.",
      });
    }
    if (capability.qualityTier !== "guided-rgb" && !capability.sceneDepth) {
      context.addIssue({
        code: "custom",
        message: "A depth quality tier requires runtime scene depth.",
      });
    }
    if (capability.qualityTier === "guided-rgb-depth-roomplan" && !capability.roomPlan) {
      context.addIssue({
        code: "custom",
        message: "The RoomPlan tier requires runtime RoomPlan support.",
      });
    }
    if (
      (capability.qualityTier === "guided-rgb" && (capability.sceneDepth || capability.roomPlan)) ||
      (capability.qualityTier === "guided-rgb-depth" &&
        (!capability.sceneDepth || capability.roomPlan)) ||
      (capability.qualityTier === "guided-rgb-depth-roomplan" &&
        (!capability.sceneDepth || !capability.roomPlan))
    ) {
      context.addIssue({
        code: "custom",
        message: "The declared quality tier must exactly describe available optional evidence.",
      });
    }
  });
export type CaptureCapabilityDeclaration = z.infer<typeof captureCapabilityDeclarationSchema>;

export const captureEnvelopeRightsSchema = z
  .object({
    basis: assetRightsBasisSchema,
    serviceProcessingConsent: z.literal(true),
    trainingUseConsent: z.literal("denied"),
  })
  .strict();

export const captureHorizontalSectorSchema = z.enum([
  "north",
  "north-east",
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
]);
export const captureVerticalBandSchema = z.enum(["lower", "middle", "upper"]);
export const captureCoverageStatusSchema = z.enum(["observed", "missing", "occluded", "unknown"]);

export const captureCoverageCellSchema = z
  .object({
    horizontalSector: captureHorizontalSectorSchema,
    status: captureCoverageStatusSchema,
    verticalBand: captureVerticalBandSchema,
  })
  .strict();

export const captureZoneSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    status: z.enum(["observed", "missing", "occluded", "unknown"]),
    zoneId: uuidSchema,
  })
  .strict();

export const captureSemanticLayerSchema = z.enum([
  "structural-evidence",
  "fixed-fittings",
  "movable-furniture",
  "appearance",
  "temporary-clutter",
]);
export const captureSemanticStatusSchema = z.enum([
  "observed",
  "partially-observed",
  "occluded",
  "unknown",
]);

export const captureSemanticDeclarationSchema = z
  .object({
    layer: captureSemanticLayerSchema,
    provenance: z.literal("user-asserted"),
    status: captureSemanticStatusSchema,
  })
  .strict();

export const captureRoomEnvelopeSchema = z
  .object({
    coordinateSegmentIds: z.array(uuidSchema).min(1).max(256),
    coverage: z.array(captureCoverageCellSchema).length(24),
    label: z.string().trim().min(1).max(120),
    roomId: uuidSchema,
    semanticDeclarations: z.array(captureSemanticDeclarationSchema).length(5),
    sequence: z.int().min(1).max(captureEnvelopePolicy.maximumRoomCount),
    story: z.int().min(-20).max(200).optional(),
    zones: z.array(captureZoneSchema).min(1).max(32).optional(),
  })
  .strict()
  .superRefine((room, context) => {
    const coverageKeys = room.coverage.map(
      ({ horizontalSector, verticalBand }) => `${horizontalSector}:${verticalBand}`,
    );
    if (new Set(coverageKeys).size !== 24) {
      context.addIssue({
        code: "custom",
        message: "Every room must declare all 24 coverage cells exactly once.",
      });
    }
    const semanticLayers = room.semanticDeclarations.map(({ layer }) => layer);
    if (new Set(semanticLayers).size !== 5) {
      context.addIssue({
        code: "custom",
        message: "Every semantic evidence layer must be declared exactly once.",
      });
    }
    if (new Set(room.coordinateSegmentIds).size !== room.coordinateSegmentIds.length) {
      context.addIssue({ code: "custom", message: "Room coordinate segments must be unique." });
    }
    if (
      room.zones !== undefined &&
      new Set(room.zones.map(({ zoneId }) => zoneId)).size !== room.zones.length
    ) {
      context.addIssue({ code: "custom", message: "Room capture zones must be unique." });
    }
  });

export const captureCoordinateSegmentSchema = z
  .object({
    coordinateSystem: z.literal("arkit-right-handed-y-up"),
    endedAtMicroseconds: timestampMicrosecondsSchema,
    reason: z.enum(["initial", "room-transition", "interruption", "relaunch", "manual-restart"]),
    segmentId: uuidSchema,
    startedAtMicroseconds: timestampMicrosecondsSchema,
    translationUnit: z.literal("micrometres"),
    worldOriginRelationship: z.literal("independent-unless-later-registered"),
  })
  .strict()
  .refine(
    ({ endedAtMicroseconds, startedAtMicroseconds }) => endedAtMicroseconds > startedAtMicroseconds,
    "A coordinate segment must have positive duration.",
  );

export const captureTransferReceiptSchema = z
  .object({
    partCount: z.int().positive().max(10_000),
    reconciledAt: captureEnvelopeTimestampSchema,
    resumable: z.literal(true),
    state: z.literal("complete"),
  })
  .strict();

export const captureMediaSourceSchema = z
  .object({
    assetId: assetIdSchema,
    byteSize: z.int().positive().max(21_474_836_480),
    kind: z.enum(["rgb-keyframe", "rgb-video"]),
    mimeType: z.enum(["image/heic", "image/jpeg", "image/png", "video/mp4", "video/quicktime"]),
    sha256: sha256HexSchema,
    transfer: captureTransferReceiptSchema,
  })
  .strict()
  .superRefine((source, context) => {
    const isVideo = source.mimeType === "video/mp4" || source.mimeType === "video/quicktime";
    if (isVideo !== (source.kind === "rgb-video")) {
      context.addIssue({ code: "custom", message: "RGB source kind and media type disagree." });
    }
  });

export const captureDepthSourceSchema = z
  .object({
    alignment: z.literal("arkit-scene-depth-image-plane"),
    artifactId: uuidSchema,
    byteSize: z.int().positive().max(536_870_912),
    format: z.enum(["float16-metres-little-endian", "float32-metres-little-endian"]),
    heightPixels: z.int().positive().max(4_096),
    sampleIds: z.array(uuidSchema).min(1).max(captureEnvelopePolicy.maximumCameraSamples),
    sha256: sha256HexSchema,
    transfer: captureTransferReceiptSchema,
    widthPixels: z.int().positive().max(4_096),
  })
  .strict()
  .superRefine((source, context) => {
    if (new Set(source.sampleIds).size !== source.sampleIds.length) {
      context.addIssue({
        code: "custom",
        message: "A depth artifact cannot repeat a camera sample.",
      });
    }
    const bytesPerPixel = source.format === "float16-metres-little-endian" ? 2 : 4;
    if (
      source.byteSize !==
      source.widthPixels * source.heightPixels * source.sampleIds.length * bytesPerPixel
    ) {
      context.addIssue({
        code: "custom",
        message: "Depth bytes must exactly match format, dimensions, and ordered sample count.",
      });
    }
  });

export const captureRoomPlanSourceSchema = z
  .object({
    captureSessionId: uuidSchema,
    packageId: uuidSchema,
    packageManifestSha256: sha256HexSchema,
  })
  .strict();

export const captureCameraSampleSchema = z
  .object({
    ambientIntensity: z.int().nonnegative().max(1_000_000).optional(),
    blurScoreMillionths: scoreSchema,
    cameraIntrinsicsMicropixels: z
      .object({
        cx: z.int().nonnegative().max(100_000_000_000),
        cy: z.int().nonnegative().max(100_000_000_000),
        fx: z.int().positive().max(10_000_000_000),
        fy: z.int().positive().max(10_000_000_000),
        imageHeightPixels: z.int().positive().max(100_000),
        imageWidthPixels: z.int().positive().max(100_000),
      })
      .strict(),
    connectedToPrevious: z.boolean().optional(),
    exposureScoreMillionths: scoreSchema,
    featurePointCount: z.int().nonnegative().max(1_000_000).optional(),
    intrinsicsModel: z.literal("pinhole-native-camera-raster"),
    loopClosureCandidate: z.boolean().optional(),
    motionScoreMillionths: scoreSchema,
    orientation: z.enum(["portrait", "portrait-upside-down", "landscape-left", "landscape-right"]),
    overlapScoreMillionths: scoreSchema.optional(),
    parallaxScoreMillionths: scoreSchema.optional(),
    poseTransform: z.literal("camera-to-world"),
    quaternionOrder: z.literal("x-y-z-w"),
    quaternionNanounits: z.array(quaternionNanounitSchema).length(4),
    roomId: uuidSchema,
    sampleId: uuidSchema,
    segmentId: uuidSchema,
    sourceAssetId: assetIdSchema,
    sourceTimestampMicroseconds: timestampMicrosecondsSchema,
    timestampMicroseconds: timestampMicrosecondsSchema,
    trackingState: z.enum([
      "normal",
      "limited-initializing",
      "limited-motion",
      "limited-features",
      "unavailable",
    ]),
    trajectoryTravelMicrometres: z.int().nonnegative().max(10_000_000_000).optional(),
    trajectorySpanMicrometres: z.int().nonnegative().max(2_000_000_000).optional(),
    translationFromPreviousMicrometres: z.int().nonnegative().max(2_000_000_000).optional(),
    translationMicrometres: z
      .object({
        x: translationMicrometreSchema,
        y: translationMicrometreSchema,
        z: translationMicrometreSchema,
      })
      .strict(),
    retentionMode: z.enum(["automatic", "manual"]).optional(),
    zoneId: uuidSchema.optional(),
  })
  .strict()
  .superRefine((sample, context) => {
    const intrinsics = sample.cameraIntrinsicsMicropixels;
    if (
      intrinsics.cx >= intrinsics.imageWidthPixels * 1_000_000 ||
      intrinsics.cy >= intrinsics.imageHeightPixels * 1_000_000
    ) {
      context.addIssue({ code: "custom", message: "The principal point must lie in the raster." });
    }
    const quaternionLength = Math.hypot(...sample.quaternionNanounits);
    if (quaternionLength < 990_000_000 || quaternionLength > 1_010_000_000) {
      context.addIssue({ code: "custom", message: "The camera quaternion must be normalized." });
    }
  });

export const captureQualitySummarySchema = z
  .object({
    interruptionCount: z.int().nonnegative().max(10_000),
    lowLightSampleCount: z.int().nonnegative().max(captureEnvelopePolicy.maximumCameraSamples),
    missingCoverageCellCount: z.int().nonnegative().max(1_536),
    motionWarningSampleCount: z.int().nonnegative().max(captureEnvelopePolicy.maximumCameraSamples),
    occludedCoverageCellCount: z.int().nonnegative().max(1_536),
    trackingLimitedSampleCount: z
      .int()
      .nonnegative()
      .max(captureEnvelopePolicy.maximumCameraSamples),
    unusableBlurSampleCount: z.int().nonnegative().max(captureEnvelopePolicy.maximumCameraSamples),
    spatialEvidence: z
      .object({
        automaticallySelectedSampleCount: z
          .int()
          .nonnegative()
          .max(captureEnvelopePolicy.maximumCameraSamples),
        connectedSampleCount: z.int().nonnegative().max(captureEnvelopePolicy.maximumCameraSamples),
        loopClosureSampleCount: z
          .int()
          .nonnegative()
          .max(captureEnvelopePolicy.maximumCameraSamples),
        unresolvedRoomCount: z.int().nonnegative().max(captureEnvelopePolicy.maximumRoomCount),
        unresolvedZoneCount: z.int().nonnegative().max(2_048),
      })
      .strict()
      .optional(),
  })
  .strict();

export const createCaptureEnvelopeRequestSchema = z
  .object({
    cameraSamples: z
      .array(captureCameraSampleSchema)
      .min(1)
      .max(captureEnvelopePolicy.maximumCameraSamples),
    capabilities: captureCapabilityDeclarationSchema,
    captureSessionId: uuidSchema,
    coordinateSegments: z
      .array(captureCoordinateSegmentSchema)
      .min(1)
      .max(captureEnvelopePolicy.maximumCoordinateSegments),
    depthSources: z.array(captureDepthSourceSchema).max(captureEnvelopePolicy.maximumDepthSources),
    endedAt: captureEnvelopeTimestampSchema,
    generator: z
      .object({ name: z.literal("ios-guided-capture"), version: boundedVersionSchema })
      .strict(),
    intent: z.enum(["room-by-room", "small-apartment"]),
    mediaSources: z
      .array(captureMediaSourceSchema)
      .min(1)
      .max(captureEnvelopePolicy.maximumMediaSources),
    projectId: projectIdSchema,
    quality: captureQualitySummarySchema,
    rights: captureEnvelopeRightsSchema,
    roomPlanSources: z
      .array(captureRoomPlanSourceSchema)
      .max(captureEnvelopePolicy.maximumRoomPlanSources),
    rooms: z.array(captureRoomEnvelopeSchema).min(1).max(captureEnvelopePolicy.maximumRoomCount),
    schemaVersion: z.literal(captureEnvelopeSchemaVersion),
    startedAt: captureEnvelopeTimestampSchema,
    transferState: z.literal("complete"),
  })
  .strict()
  .superRefine((envelope, context) => {
    const startedAt = Date.parse(envelope.startedAt);
    const endedAt = Date.parse(envelope.endedAt);
    if (
      endedAt <= startedAt ||
      endedAt - startedAt > captureEnvelopePolicy.maximumScanDurationMilliseconds
    ) {
      context.addIssue({
        code: "custom",
        message: "Capture duration must be positive and no longer than six hours.",
      });
    }
    const unique = (values: readonly string[], message: string): void => {
      if (new Set(values).size !== values.length) context.addIssue({ code: "custom", message });
    };
    unique(
      envelope.rooms.map(({ roomId }) => roomId),
      "Capture room IDs must be unique.",
    );
    unique(
      envelope.rooms.map(({ sequence }) => String(sequence)),
      "Capture room sequences must be unique.",
    );
    unique(
      envelope.coordinateSegments.map(({ segmentId }) => segmentId),
      "Coordinate segment IDs must be unique.",
    );
    unique(
      envelope.mediaSources.map(({ assetId }) => assetId),
      "RGB source asset IDs must be unique.",
    );
    unique(
      envelope.cameraSamples.map(({ sampleId }) => sampleId),
      "Camera sample IDs must be unique.",
    );
    unique(
      envelope.cameraSamples.map(
        ({ segmentId, timestampMicroseconds }) => `${segmentId}:${String(timestampMicroseconds)}`,
      ),
      "Camera timestamps must be unique within a coordinate segment.",
    );
    unique(
      envelope.depthSources.map(({ artifactId }) => artifactId),
      "Depth artifact IDs must be unique.",
    );
    unique(
      envelope.roomPlanSources.map(
        ({ captureSessionId, packageId }) => `${captureSessionId}:${packageId}`,
      ),
      "RoomPlan package references must be unique.",
    );
    const roomIds = new Set(envelope.rooms.map(({ roomId }) => roomId));
    const segmentIds = new Set(envelope.coordinateSegments.map(({ segmentId }) => segmentId));
    const segmentsById = new Map(
      envelope.coordinateSegments.map((segment) => [segment.segmentId, segment]),
    );
    const assetIds = new Set(envelope.mediaSources.map(({ assetId }) => assetId));
    const sampleIds = new Set(envelope.cameraSamples.map(({ sampleId }) => sampleId));
    const roomById = new Map(envelope.rooms.map((room) => [room.roomId, room]));
    const elapsedMicroseconds = (endedAt - startedAt) * 1_000;
    const orderedSequences = envelope.rooms.map(({ sequence }) => sequence).sort((a, b) => a - b);
    if (!orderedSequences.every((sequence, index) => sequence === index + 1)) {
      context.addIssue({ code: "custom", message: "Room sequences must be contiguous from one." });
    }
    for (const segment of envelope.coordinateSegments) {
      if (
        segment.endedAtMicroseconds > elapsedMicroseconds ||
        !envelope.rooms.some(({ coordinateSegmentIds }) =>
          coordinateSegmentIds.includes(segment.segmentId),
        )
      ) {
        context.addIssue({
          code: "custom",
          message: "Every coordinate segment must fit the capture and belong to a room.",
        });
      }
    }
    for (const room of envelope.rooms) {
      if (room.coordinateSegmentIds.some((segmentId) => !segmentIds.has(segmentId))) {
        context.addIssue({ code: "custom", message: "A room references an unknown segment." });
      }
      if (
        envelope.cameraSamples.filter(({ roomId }) => roomId === room.roomId).length >
        captureEnvelopePolicy.maximumRoomKeyframes
      ) {
        context.addIssue({
          code: "custom",
          message: "A room exceeds the bounded retained-keyframe budget.",
        });
      }
      const roomSegments = room.coordinateSegmentIds
        .map((segmentId) => segmentsById.get(segmentId))
        .filter((segment): segment is NonNullable<typeof segment> => segment !== undefined)
        .sort((left, right) => left.startedAtMicroseconds - right.startedAtMicroseconds);
      for (let index = 1; index < roomSegments.length; index += 1) {
        const previous = roomSegments[index - 1];
        const current = roomSegments[index];
        if (
          previous !== undefined &&
          current !== undefined &&
          previous.endedAtMicroseconds > current.startedAtMicroseconds
        ) {
          context.addIssue({
            code: "custom",
            message: "Independent coordinate segments cannot overlap in one room timeline.",
          });
        }
      }
    }
    for (const sample of envelope.cameraSamples) {
      const segment = segmentsById.get(sample.segmentId);
      const room = roomById.get(sample.roomId);
      if (
        !roomIds.has(sample.roomId) ||
        segment === undefined ||
        !assetIds.has(sample.sourceAssetId) ||
        room === undefined ||
        !room.coordinateSegmentIds.includes(sample.segmentId) ||
        sample.timestampMicroseconds < segment.startedAtMicroseconds ||
        sample.timestampMicroseconds > segment.endedAtMicroseconds
      ) {
        context.addIssue({
          code: "custom",
          message: "A camera sample has an invalid source, room, segment, or timestamp scope.",
        });
      }
      const declaredZones = room?.zones;
      if (
        sample.zoneId !== undefined &&
        (declaredZones === undefined ||
          !declaredZones.some(({ zoneId }) => zoneId === sample.zoneId))
      ) {
        context.addIssue({
          code: "custom",
          message: "A camera sample references an unknown room zone.",
        });
      }
      const spatialValues = [
        sample.connectedToPrevious,
        sample.featurePointCount,
        sample.loopClosureCandidate,
        sample.overlapScoreMillionths,
        sample.parallaxScoreMillionths,
        sample.retentionMode,
        sample.trajectorySpanMicrometres,
        sample.trajectoryTravelMicrometres,
        sample.translationFromPreviousMicrometres,
        sample.zoneId,
      ];
      if (
        spatialValues.some((value) => value !== undefined) &&
        spatialValues.some((value) => value === undefined)
      ) {
        context.addIssue({
          code: "custom",
          message: "C14.10 spatial sample evidence must be complete when present.",
        });
      }
    }
    const automaticSamplesBySegment = new Map<string, (typeof envelope.cameraSamples)[number][]>();
    for (const sample of envelope.cameraSamples) {
      if (sample.retentionMode !== "automatic") continue;
      const segmentSamples = automaticSamplesBySegment.get(sample.segmentId) ?? [];
      segmentSamples.push(sample);
      automaticSamplesBySegment.set(sample.segmentId, segmentSamples);
    }
    for (const samples of automaticSamplesBySegment.values()) {
      const ordered = [...samples].sort(
        (left, right) => left.timestampMicroseconds - right.timestampMicroseconds,
      );
      if (
        ordered
          .slice(1)
          .some(
            (sample, index) =>
              sample.timestampMicroseconds - (ordered[index]?.timestampMicroseconds ?? 0) <
              captureEnvelopePolicy.automaticKeyframeIntervalMicroseconds,
          )
      ) {
        context.addIssue({
          code: "custom",
          message: "Automatic retained keyframes must respect the bounded selection interval.",
        });
      }
    }
    for (const source of envelope.mediaSources) {
      const sourceSampleCount = envelope.cameraSamples.filter(
        ({ sourceAssetId }) => sourceAssetId === source.assetId,
      ).length;
      if (source.kind === "rgb-keyframe" && sourceSampleCount !== 1) {
        context.addIssue({
          code: "custom",
          message: "Every RGB keyframe must bind exactly one camera sample.",
        });
      }
    }
    if (
      envelope.capabilities.rgbVideo !==
      envelope.mediaSources.some(({ kind }) => kind === "rgb-video")
    ) {
      context.addIssue({
        code: "custom",
        message: "The RGB video capability must match the accepted source set.",
      });
    }
    if (
      envelope.capabilities.rgbKeyframes !==
      envelope.mediaSources.some(({ kind }) => kind === "rgb-keyframe")
    ) {
      context.addIssue({
        code: "custom",
        message: "The RGB keyframe capability must match the accepted source set.",
      });
    }
    const depthSampleIds = envelope.depthSources.flatMap(({ sampleIds }) => sampleIds);
    unique(depthSampleIds, "A camera sample cannot bind more than one depth artifact.");
    for (const depth of envelope.depthSources) {
      if (depth.sampleIds.some((sampleId) => !sampleIds.has(sampleId))) {
        context.addIssue({ code: "custom", message: "Depth references an unknown camera sample." });
      }
    }
    if (envelope.depthSources.length > 0 && !envelope.capabilities.sceneDepth) {
      context.addIssue({
        code: "custom",
        message: "Depth evidence requires declared scene depth.",
      });
    }
    if (envelope.roomPlanSources.length > 0 && !envelope.capabilities.roomPlan) {
      context.addIssue({ code: "custom", message: "RoomPlan evidence requires declared support." });
    }
    if (
      envelope.roomPlanSources.some(
        ({ captureSessionId }) => captureSessionId === envelope.captureSessionId,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "RoomPlan evidence must come from a separate RoomPlan capture session.",
      });
    }
    const missing = envelope.rooms.reduce(
      (total, room) => total + room.coverage.filter(({ status }) => status === "missing").length,
      0,
    );
    const occluded = envelope.rooms.reduce(
      (total, room) => total + room.coverage.filter(({ status }) => status === "occluded").length,
      0,
    );
    if (
      envelope.quality.missingCoverageCellCount !== missing ||
      envelope.quality.occludedCoverageCellCount !== occluded ||
      envelope.quality.interruptionCount !==
        envelope.coordinateSegments.filter(({ reason }) => reason === "interruption").length ||
      envelope.quality.trackingLimitedSampleCount !==
        envelope.cameraSamples.filter(({ trackingState }) => trackingState !== "normal").length ||
      [
        envelope.quality.lowLightSampleCount,
        envelope.quality.motionWarningSampleCount,
        envelope.quality.unusableBlurSampleCount,
      ].some((count) => count > envelope.cameraSamples.length)
    ) {
      context.addIssue({
        code: "custom",
        message: "The quality summary must match declared coverage, interruptions, and tracking.",
      });
    }
    const spatialSummary = envelope.quality.spatialEvidence;
    const spatialSamples = envelope.cameraSamples.filter(
      ({ retentionMode }) => retentionMode !== undefined,
    );
    if (spatialSummary !== undefined) {
      const roomReadiness = envelope.rooms.map((room) => {
        const roomSamples = spatialSamples.filter(({ roomId }) => roomId === room.roomId);
        const samplesBySegment = new Map<string, typeof roomSamples>();
        for (const sample of roomSamples) {
          const segmentSamples = samplesBySegment.get(sample.segmentId) ?? [];
          segmentSamples.push(sample);
          samplesBySegment.set(sample.segmentId, segmentSamples);
        }
        const segmentReadiness = [...samplesBySegment.values()].map((unorderedSamples) => {
          const segmentSamples = [...unorderedSamples].sort(
            (left, right) => left.timestampMicroseconds - right.timestampMicroseconds,
          );
          const edges = segmentSamples.slice(1);
          const connectedEdges = edges.filter(
            ({ connectedToPrevious }) => connectedToPrevious,
          ).length;
          const connectedRatio =
            edges.length === 0 ? 0 : Math.floor((connectedEdges * 1_000_000) / edges.length);
          return (
            segmentSamples.length >= 8 &&
            connectedRatio >= 750_000 &&
            segmentSamples[0]?.connectedToPrevious === false &&
            segmentSamples.every(({ featurePointCount }) => (featurePointCount ?? 0) >= 60) &&
            edges.every(
              ({ connectedToPrevious, loopClosureCandidate, overlapScoreMillionths }) =>
                connectedToPrevious === true &&
                (overlapScoreMillionths ?? 0) >= 180_000 &&
                (loopClosureCandidate === true || (overlapScoreMillionths ?? 0) < 940_000),
            ) &&
            Math.max(
              0,
              ...segmentSamples.map(
                ({ trajectorySpanMicrometres }) => trajectorySpanMicrometres ?? 0,
              ),
            ) >= 1_200_000 &&
            Math.max(
              0,
              ...segmentSamples.map(
                ({ trajectoryTravelMicrometres }) => trajectoryTravelMicrometres ?? 0,
              ),
            ) >= 2_400_000 &&
            segmentSamples.filter(
              ({ translationFromPreviousMicrometres }) =>
                (translationFromPreviousMicrometres ?? 0) >= 120_000,
            ).length >= 3 &&
            segmentSamples.filter(
              ({ parallaxScoreMillionths }) => (parallaxScoreMillionths ?? 0) >= 80_000,
            ).length >= 3 &&
            segmentSamples.some(({ loopClosureCandidate }) => loopClosureCandidate)
          );
        });
        const unresolvedZones = (room.zones ?? []).filter((zone) => {
          if (zone.status === "occluded") return false;
          return roomSamples.filter(({ zoneId }) => zoneId === zone.zoneId).length < 2;
        }).length;
        const ready =
          segmentReadiness.length > 0 && segmentReadiness.every(Boolean) && unresolvedZones === 0;
        return { ready, unresolvedZones };
      });
      const unresolvedRooms = roomReadiness.filter(({ ready }) => !ready).length;
      const unresolvedZones = roomReadiness.reduce(
        (total, room) => total + room.unresolvedZones,
        0,
      );
      if (
        spatialSummary.automaticallySelectedSampleCount !==
          spatialSamples.filter(({ retentionMode }) => retentionMode === "automatic").length ||
        spatialSummary.connectedSampleCount !==
          spatialSamples.filter(({ connectedToPrevious }) => connectedToPrevious).length ||
        spatialSummary.loopClosureSampleCount !==
          spatialSamples.filter(({ loopClosureCandidate }) => loopClosureCandidate).length ||
        spatialSummary.unresolvedRoomCount !== unresolvedRooms ||
        spatialSummary.unresolvedZoneCount !== unresolvedZones
      ) {
        context.addIssue({
          code: "custom",
          message: "The spatial quality summary must match complete sample and zone evidence.",
        });
      }
    } else if (
      spatialSamples.length > 0 ||
      envelope.rooms.some(({ zones }) => zones !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Spatial sample or zone evidence requires its quality summary.",
      });
    }
  });
export type CreateCaptureEnvelopeRequest = z.infer<typeof createCaptureEnvelopeRequestSchema>;

export const captureEnvelopeAcceptanceSchema = z
  .object({
    acceptedAt: z.iso.datetime({ offset: true }),
    acceptedBy: userIdSchema,
    captureSessionId: uuidSchema,
    envelopeId: captureEnvelopeIdSchema,
    envelopeSha256: sha256HexSchema,
    projectId: projectIdSchema,
    schemaVersion: z.literal(captureEnvelopeAcceptanceSchemaVersion),
  })
  .strict();
export type CaptureEnvelopeAcceptance = z.infer<typeof captureEnvelopeAcceptanceSchema>;

export const captureEnvelopeRecordSchema = z
  .object({
    acceptance: captureEnvelopeAcceptanceSchema,
    envelope: createCaptureEnvelopeRequestSchema,
  })
  .strict()
  .superRefine((record, context) => {
    if (
      record.acceptance.captureSessionId !== record.envelope.captureSessionId ||
      record.acceptance.projectId !== record.envelope.projectId
    ) {
      context.addIssue({
        code: "custom",
        message: "Envelope acceptance scope must match its payload.",
      });
    }
  });
export type CaptureEnvelopeRecord = z.infer<typeof captureEnvelopeRecordSchema>;

export const startCaptureEnvelopeReconstructionRequestSchema = z
  .object({
    appearanceMode: z.enum(["disabled", "optional"]),
    expectedEnvelopeSha256: sha256HexSchema,
  })
  .strict();

export const captureEnvelopeReconstructionSchema = z
  .object({
    captureSessionId: uuidSchema,
    envelopeId: captureEnvelopeIdSchema,
    envelopeSha256: sha256HexSchema,
    projectId: projectIdSchema,
    reconstructionJob: reconstructionJobSchema,
    schemaVersion: z.literal(captureEnvelopeReconstructionSchemaVersion),
  })
  .strict();
export type CaptureEnvelopeReconstruction = z.infer<typeof captureEnvelopeReconstructionSchema>;

export const captureEnvelopeRouteContract = Object.freeze({
  accept: "/v1/projects/:projectId/capture-sessions/:captureSessionId/envelope",
  get: "/v1/projects/:projectId/capture-sessions/:captureSessionId/envelope",
  startReconstruction:
    "/v1/projects/:projectId/capture-sessions/:captureSessionId/envelope/reconstruction",
});
