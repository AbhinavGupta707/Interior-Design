import { describe, expect, it } from "vitest";

import {
  captureEnvelopePolicy,
  captureEnvelopeRouteContract,
  createCaptureEnvelopeRequestSchema,
} from "../src/index.js";

const projectId = "14800000-0000-4000-8000-000000000001";
const captureSessionId = "14800000-0000-4000-8000-000000000002";
const roomId = "14800000-0000-4000-8000-000000000003";
const segmentId = "14800000-0000-4000-8000-000000000004";
const assetId = "14800000-0000-4000-8000-000000000005";
const sampleId = "14800000-0000-4000-8000-000000000006";
const horizontalSectors = [
  "north",
  "north-east",
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
] as const;
const verticalBands = ["lower", "middle", "upper"] as const;
const semanticLayers = [
  "structural-evidence",
  "fixed-fittings",
  "movable-furniture",
  "appearance",
  "temporary-clutter",
] as const;

function validEnvelope() {
  return {
    cameraSamples: [
      {
        ambientIntensity: 850,
        blurScoreMillionths: 120_000,
        cameraIntrinsicsMicropixels: {
          cx: 1_512_000_000,
          cy: 2_016_000_000,
          fx: 2_100_000_000,
          fy: 2_100_000_000,
          imageHeightPixels: 4_032,
          imageWidthPixels: 3_024,
        },
        exposureScoreMillionths: 800_000,
        intrinsicsModel: "pinhole-native-camera-raster",
        motionScoreMillionths: 90_000,
        orientation: "portrait",
        poseTransform: "camera-to-world",
        quaternionOrder: "x-y-z-w",
        quaternionNanounits: [0, 0, 0, 1_000_000_000],
        roomId,
        sampleId,
        segmentId,
        sourceAssetId: assetId,
        sourceTimestampMicroseconds: 1_000_000,
        timestampMicroseconds: 1_000_000,
        trackingState: "normal",
        translationMicrometres: { x: 0, y: 1_500_000, z: 0 },
      },
    ],
    capabilities: {
      appBuild: "148",
      appVersion: "1.0.0",
      arWorldTracking: true,
      cameraIntrinsics: true,
      cameraPoses: true,
      deviceModelIdentifier: "iPhone13,2",
      operatingSystemVersion: "26.0",
      qualityTier: "guided-rgb",
      rgbKeyframes: true,
      rgbVideo: false,
      roomPlan: false,
      runtime: "physical-device",
      sceneDepth: false,
      schemaVersion: "capture-capabilities-v1",
    },
    captureSessionId,
    coordinateSegments: [
      {
        coordinateSystem: "arkit-right-handed-y-up",
        endedAtMicroseconds: 5_000_000,
        reason: "initial",
        segmentId,
        startedAtMicroseconds: 0,
        translationUnit: "micrometres",
        worldOriginRelationship: "independent-unless-later-registered",
      },
    ],
    depthSources: [],
    endedAt: "2026-08-26T10:05:00.000Z",
    generator: { name: "ios-guided-capture", version: "1.0.0" },
    intent: "room-by-room",
    mediaSources: [
      {
        assetId,
        byteSize: 8_192,
        kind: "rgb-keyframe",
        mimeType: "image/jpeg",
        sha256: "a".repeat(64),
        transfer: {
          partCount: 1,
          reconciledAt: "2026-08-26T10:06:00.000Z",
          resumable: true,
          state: "complete",
        },
      },
    ],
    projectId,
    quality: {
      interruptionCount: 0,
      lowLightSampleCount: 0,
      missingCoverageCellCount: 23,
      motionWarningSampleCount: 0,
      occludedCoverageCellCount: 0,
      trackingLimitedSampleCount: 0,
      unusableBlurSampleCount: 0,
    },
    rights: {
      basis: "owned-by-user",
      serviceProcessingConsent: true,
      trainingUseConsent: "denied",
    },
    roomPlanSources: [],
    rooms: [
      {
        coordinateSegmentIds: [segmentId],
        coverage: horizontalSectors.flatMap((horizontalSector, horizontalIndex) =>
          verticalBands.map((verticalBand, verticalIndex) => ({
            horizontalSector,
            status: horizontalIndex === 0 && verticalIndex === 1 ? "observed" : "missing",
            verticalBand,
          })),
        ),
        label: "Living room",
        roomId,
        semanticDeclarations: semanticLayers.map((layer) => ({
          layer,
          provenance: "user-asserted",
          status: layer === "structural-evidence" ? "partially-observed" : "unknown",
        })),
        sequence: 1,
        story: 0,
      },
    ],
    schemaVersion: "capture-envelope-v1",
    startedAt: "2026-08-26T10:00:00.000Z",
    transferState: "complete",
  } as const;
}

describe("C14.8 device-neutral capture envelope", () => {
  it("freezes one bounded, camera-first route and evidence boundary", () => {
    expect(captureEnvelopePolicy).toMatchObject({
      maximumCameraSamples: 10_000,
      maximumMediaSources: 512,
      maximumRoomCount: 64,
    });
    expect(captureEnvelopeRouteContract).toEqual({
      accept: "/v1/projects/:projectId/capture-sessions/:captureSessionId/envelope",
      get: "/v1/projects/:projectId/capture-sessions/:captureSessionId/envelope",
      startReconstruction:
        "/v1/projects/:projectId/capture-sessions/:captureSessionId/envelope/reconstruction",
    });
    expect(createCaptureEnvelopeRequestSchema.parse(validEnvelope())).toEqual(validEnvelope());
  });

  it("canonicalizes Foundation-style uppercase UUIDs before scope checks and hashing", () => {
    const uppercaseEnvelope: unknown = JSON.parse(
      JSON.stringify(validEnvelope()).replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu,
        (value) => value.toUpperCase(),
      ),
    );

    const parsed = createCaptureEnvelopeRequestSchema.parse(uppercaseEnvelope);
    const encoded = JSON.stringify(parsed);
    const parsedUUIDs =
      encoded.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu) ?? [];

    expect(parsedUUIDs.length).toBeGreaterThan(0);
    expect(parsedUUIDs.every((value) => value === value.toLowerCase())).toBe(true);
    expect(parsed.projectId).toBe(projectId);
    expect(parsed.captureSessionId).toBe(captureSessionId);
  });

  it("rejects simulated physical capability and depth without runtime support", () => {
    const envelope = validEnvelope();
    expect(
      createCaptureEnvelopeRequestSchema.safeParse({
        ...envelope,
        capabilities: { ...envelope.capabilities, runtime: "simulator-fixture" },
      }).success,
    ).toBe(false);
    expect(
      createCaptureEnvelopeRequestSchema.safeParse({
        ...envelope,
        capabilities: { ...envelope.capabilities, roomPlan: true },
      }).success,
    ).toBe(false);
    expect(
      createCaptureEnvelopeRequestSchema.safeParse({
        ...envelope,
        depthSources: [
          {
            alignment: "arkit-scene-depth-image-plane",
            artifactId: "14800000-0000-4000-8000-000000000007",
            byteSize: 98_304,
            format: "float16-metres-little-endian",
            heightPixels: 192,
            sampleIds: [sampleId],
            sha256: "b".repeat(64),
            transfer: envelope.mediaSources[0].transfer,
            widthPixels: 256,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts optional sample-bound depth without changing the RGB baseline", () => {
    const envelope = validEnvelope();
    const augmented = {
      ...envelope,
      capabilities: {
        ...envelope.capabilities,
        qualityTier: "guided-rgb-depth",
        sceneDepth: true,
      },
      depthSources: [
        {
          alignment: "arkit-scene-depth-image-plane",
          artifactId: "14800000-0000-4000-8000-000000000007",
          byteSize: 196_608,
          format: "float32-metres-little-endian",
          heightPixels: 192,
          sampleIds: [sampleId],
          sha256: "b".repeat(64),
          transfer: envelope.mediaSources[0].transfer,
          widthPixels: 256,
        },
      ],
    } as const;
    expect(createCaptureEnvelopeRequestSchema.safeParse(augmented).success).toBe(true);
    expect(
      createCaptureEnvelopeRequestSchema.safeParse({
        ...augmented,
        depthSources: [{ ...augmented.depthSources[0], byteSize: 196_607 }],
      }).success,
    ).toBe(false);
  });

  it("requires the claimed camera-first RGB keyframe baseline in the accepted source set", () => {
    const envelope = validEnvelope();
    expect(
      createCaptureEnvelopeRequestSchema.safeParse({
        ...envelope,
        capabilities: { ...envelope.capabilities, rgbVideo: true },
        mediaSources: [
          {
            ...envelope.mediaSources[0],
            kind: "rgb-video",
            mimeType: "video/mp4",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("binds optional RoomPlan only as a distinct immutable package reference", () => {
    const envelope = validEnvelope();
    const source = {
      captureSessionId: "14800000-0000-4000-8000-000000000088",
      packageId: "14800000-0000-4000-8000-000000000089",
      packageManifestSha256: "d".repeat(64),
    } as const;
    const augmented = {
      ...envelope,
      capabilities: {
        ...envelope.capabilities,
        qualityTier: "guided-rgb-depth-roomplan",
        roomPlan: true,
        sceneDepth: true,
      },
      roomPlanSources: [source],
    } as const;
    expect(createCaptureEnvelopeRequestSchema.safeParse(augmented).success).toBe(true);
    expect(
      createCaptureEnvelopeRequestSchema.safeParse({
        ...augmented,
        roomPlanSources: [source, source],
      }).success,
    ).toBe(false);
    expect(
      createCaptureEnvelopeRequestSchema.safeParse({
        ...augmented,
        roomPlanSources: [{ ...source, captureSessionId }],
      }).success,
    ).toBe(false);
  });

  it("keeps missing coverage, semantics, segments, and source scope explicit", () => {
    const envelope = validEnvelope();
    expect(
      createCaptureEnvelopeRequestSchema.safeParse({
        ...envelope,
        quality: { ...envelope.quality, missingCoverageCellCount: 0 },
      }).success,
    ).toBe(false);
    expect(
      createCaptureEnvelopeRequestSchema.safeParse({
        ...envelope,
        cameraSamples: [
          { ...envelope.cameraSamples[0], sourceAssetId: "14800000-0000-4000-8000-999999999999" },
        ],
      }).success,
    ).toBe(false);
    expect(
      createCaptureEnvelopeRequestSchema.safeParse({
        ...envelope,
        rooms: [
          {
            ...envelope.rooms[0],
            semanticDeclarations: envelope.rooms[0].semanticDeclarations.slice(0, 4),
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects ambiguous poses, timestamps, intrinsics, and summary evidence", () => {
    const envelope = validEnvelope();
    expect(
      createCaptureEnvelopeRequestSchema.safeParse({
        ...envelope,
        cameraSamples: [{ ...envelope.cameraSamples[0], timestampMicroseconds: 5_000_001 }],
      }).success,
    ).toBe(false);
    expect(
      createCaptureEnvelopeRequestSchema.safeParse({
        ...envelope,
        cameraSamples: [{ ...envelope.cameraSamples[0], quaternionNanounits: [0, 0, 0, 0] }],
      }).success,
    ).toBe(false);
    expect(
      createCaptureEnvelopeRequestSchema.safeParse({
        ...envelope,
        cameraSamples: [
          {
            ...envelope.cameraSamples[0],
            cameraIntrinsicsMicropixels: {
              ...envelope.cameraSamples[0].cameraIntrinsicsMicropixels,
              cx: 3_024_000_000,
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      createCaptureEnvelopeRequestSchema.safeParse({
        ...envelope,
        cameraSamples: [{ ...envelope.cameraSamples[0], trackingState: "limited-motion" }],
      }).success,
    ).toBe(false);
    expect(
      createCaptureEnvelopeRequestSchema.safeParse({
        ...envelope,
        cameraSamples: [
          envelope.cameraSamples[0],
          {
            ...envelope.cameraSamples[0],
            sampleId: "14800000-0000-4000-8000-000000000099",
            sourceAssetId: "14800000-0000-4000-8000-000000000098",
          },
        ],
        mediaSources: [
          envelope.mediaSources[0],
          {
            ...envelope.mediaSources[0],
            assetId: "14800000-0000-4000-8000-000000000098",
            sha256: "c".repeat(64),
          },
        ],
      }).success,
    ).toBe(false);
  });
});
