import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { registerRequestCorrelation } from "../../src/correlation.js";
import { registerErrorHandling } from "../../src/errors.js";
import { registerCaptureRoutes } from "../../src/modules/capture/routes.js";
import { ReconstructionService } from "../../src/modules/reconstruction/service.js";
import { FixtureProjectRepository, c6Project, fixtureIdentity, tokenFor } from "../c6/support.js";
import {
  MemoryCaptureBackend,
  c14_8EnvelopeId,
  c7ArtifactId,
  c7CaptureSessionId,
} from "../c7/support.js";
import { MemoryReconstructionRepository, imageAssetId, imageSha256 } from "../c8/support.js";

const roomId = "14800000-0000-4000-8000-000000000003";
const segmentId = "14800000-0000-4000-8000-000000000004";
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

function authorization(subject: Parameters<typeof tokenFor>[0]) {
  return { authorization: `Bearer ${tokenFor(subject)}` };
}

function mutationHeaders(subject: Parameters<typeof tokenFor>[0], key: string) {
  return { ...authorization(subject), "idempotency-key": key };
}

function envelope() {
  return {
    cameraSamples: [
      {
        ambientIntensity: 900,
        blurScoreMillionths: 900_000,
        cameraIntrinsicsMicropixels: {
          cx: 960_000_000,
          cy: 720_000_000,
          fx: 1_500_000_000,
          fy: 1_500_000_000,
          imageHeightPixels: 1_440,
          imageWidthPixels: 1_920,
        },
        exposureScoreMillionths: 900_000,
        intrinsicsModel: "pinhole-native-camera-raster",
        motionScoreMillionths: 10_000,
        orientation: "landscape-right",
        poseTransform: "camera-to-world",
        quaternionOrder: "x-y-z-w",
        quaternionNanounits: [0, 0, 0, 1_000_000_000],
        roomId,
        sampleId,
        segmentId,
        sourceAssetId: imageAssetId,
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
    captureSessionId: c7CaptureSessionId,
    coordinateSegments: [
      {
        coordinateSystem: "arkit-right-handed-y-up",
        endedAtMicroseconds: 2_000_000,
        reason: "initial",
        segmentId,
        startedAtMicroseconds: 0,
        translationUnit: "micrometres",
        worldOriginRelationship: "independent-unless-later-registered",
      },
    ],
    depthSources: [],
    endedAt: "2026-08-26T10:00:02.000Z",
    generator: { name: "ios-guided-capture", version: "1.0.0" },
    intent: "room-by-room",
    mediaSources: [
      {
        assetId: imageAssetId,
        byteSize: 1_024,
        kind: "rgb-keyframe",
        mimeType: "image/jpeg",
        sha256: imageSha256,
        transfer: {
          partCount: 1,
          reconciledAt: "2026-08-26T10:00:03.000Z",
          resumable: true,
          state: "complete",
        },
      },
    ],
    projectId: c6Project.id,
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

describe("C14.8 authenticated capture envelope routes", () => {
  let backend: MemoryCaptureBackend;
  let reconstruction: MemoryReconstructionRepository;
  let server: FastifyInstance;

  beforeEach(() => {
    server = Fastify({ logger: false });
    registerRequestCorrelation(server);
    registerErrorHandling(server);
    backend = new MemoryCaptureBackend();
    reconstruction = new MemoryReconstructionRepository();
    registerCaptureRoutes(
      server,
      fixtureIdentity(),
      new FixtureProjectRepository(),
      backend,
      new ReconstructionService(reconstruction, { record: () => undefined }),
    );
  });

  afterEach(async () => server.close());

  it("accepts and reads one actor/project-scoped immutable envelope with exact replay", async () => {
    const url = `/v1/projects/${c6Project.id}/capture-sessions/${c7CaptureSessionId}/envelope`;
    const request = {
      headers: mutationHeaders("fixture|owner-alpha", "c14-8-envelope-accept-0001"),
      method: "POST" as const,
      payload: envelope(),
      url,
    };
    const accepted = await server.inject(request);
    const replayed = await server.inject(request);
    expect(accepted.statusCode).toBe(201);
    expect(replayed.statusCode).toBe(201);
    expect(replayed.headers["idempotent-replay"]).toBe("true");
    expect(replayed.json()).toEqual(accepted.json());
    expect(accepted.json()).toMatchObject({
      acceptance: { envelopeId: c14_8EnvelopeId },
      envelope: { capabilities: { qualityTier: "guided-rgb" } },
    });

    const read = await server.inject({
      headers: authorization("fixture|viewer-alpha"),
      method: "GET",
      url,
    });
    expect(read.statusCode).toBe(200);
    const foreign = await server.inject({
      headers: authorization("fixture|owner-beta"),
      method: "GET",
      url,
    });
    expect(foreign.statusCode).toBe(404);
  });

  it("requires mutation authority and the exact accepted hash before creating C8 RGB-only work", async () => {
    const url = `/v1/projects/${c6Project.id}/capture-sessions/${c7CaptureSessionId}/envelope`;
    const accepted = await server.inject({
      headers: mutationHeaders("fixture|owner-alpha", "c14-8-envelope-accept-0002"),
      method: "POST",
      payload: envelope(),
      url,
    });
    const hash = accepted.json<{ acceptance: { envelopeSha256: string } }>().acceptance
      .envelopeSha256;
    const reconstructionURL = `${url}/reconstruction`;
    const denied = await server.inject({
      headers: mutationHeaders("fixture|viewer-alpha", "c14-8-viewer-reconstruct-1"),
      method: "POST",
      payload: { appearanceMode: "disabled", expectedEnvelopeSha256: hash },
      url: reconstructionURL,
    });
    expect(denied.statusCode).toBe(403);
    const stale = await server.inject({
      headers: mutationHeaders("fixture|editor-alpha", "c14-8-stale-reconstruct-01"),
      method: "POST",
      payload: { appearanceMode: "disabled", expectedEnvelopeSha256: "f".repeat(64) },
      url: reconstructionURL,
    });
    expect(stale.statusCode).toBe(409);
    expect(reconstruction.jobs.size).toBe(0);

    const created = await server.inject({
      headers: mutationHeaders("fixture|editor-alpha", "c14-8-reconstruct-0001"),
      method: "POST",
      payload: { appearanceMode: "optional", expectedEnvelopeSha256: hash },
      url: reconstructionURL,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      captureSessionId: c7CaptureSessionId,
      envelopeId: c14_8EnvelopeId,
      envelopeSha256: hash,
      reconstructionJob: { request: { mode: "rgb-sfm", registrationAnchors: [] } },
      schemaVersion: "capture-envelope-reconstruction-v1",
    });
    expect(reconstruction.lastCreate?.request).toMatchObject({
      appearanceMode: "optional",
      mode: "rgb-sfm",
      registrationAnchors: [],
      sources: [
        {
          assetId: imageAssetId,
          byteSize: 1_024,
          detectedMimeType: "image/jpeg",
          kind: "rgb-image",
          sha256: imageSha256,
        },
      ],
    });
    const replayed = await server.inject({
      headers: mutationHeaders("fixture|owner-alpha", "c14-8-reconstruct-0002"),
      method: "POST",
      payload: { appearanceMode: "optional", expectedEnvelopeSha256: hash },
      url: reconstructionURL,
    });
    expect(replayed.statusCode).toBe(200);
    expect(replayed.headers["idempotent-replay"]).toBe("true");
    expect(reconstruction.jobs.size).toBe(1);

    const changed = await server.inject({
      headers: mutationHeaders("fixture|owner-alpha", "c14-8-reconstruct-changed-01"),
      method: "POST",
      payload: { appearanceMode: "disabled", expectedEnvelopeSha256: hash },
      url: reconstructionURL,
    });
    expect(changed.statusCode).toBe(409);
    expect(changed.json()).toMatchObject({ code: "CAPTURE_RECONSTRUCTION_CHANGED" });
    expect(reconstruction.jobs.size).toBe(1);
  });

  it("allows only owner/editor access to exact depth bytes bound to the accepted envelope", async () => {
    const payload = {
      ...envelope(),
      capabilities: {
        ...envelope().capabilities,
        qualityTier: "guided-rgb-depth",
        sceneDepth: true,
      },
      depthSources: [
        {
          alignment: "arkit-scene-depth-image-plane",
          artifactId: c7ArtifactId,
          byteSize: 16,
          format: "float32-metres-little-endian",
          heightPixels: 2,
          sampleIds: [sampleId],
          sha256: "d".repeat(64),
          transfer: {
            partCount: 1,
            reconciledAt: "2026-08-26T10:00:03.000Z",
            resumable: true,
            state: "complete",
          },
          widthPixels: 2,
        },
      ],
    } as const;
    const envelopeUrl = `/v1/projects/${c6Project.id}/capture-sessions/${c7CaptureSessionId}/envelope`;
    expect(
      (
        await server.inject({
          headers: mutationHeaders("fixture|owner-alpha", "c14-9-envelope-depth-0001"),
          method: "POST",
          payload,
          url: envelopeUrl,
        })
      ).statusCode,
    ).toBe(201);
    const accessUrl = `/v1/projects/${c6Project.id}/capture-sessions/${c7CaptureSessionId}/artifacts/${c7ArtifactId}/access`;
    const denied = await server.inject({
      headers: authorization("fixture|viewer-alpha"),
      method: "POST",
      payload: {},
      url: accessUrl,
    });
    expect(denied.statusCode).toBe(403);
    const allowed = await server.inject({
      headers: authorization("fixture|editor-alpha"),
      method: "POST",
      payload: {},
      url: accessUrl,
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toEqual({
      artifactId: c7ArtifactId,
      byteSize: 16,
      contentType: "application/octet-stream",
      expiresAt: "2026-07-17T12:05:00.000Z",
      sha256: "d".repeat(64),
      url: "https://storage.invalid/synthetic-capture-export",
    });
    const foreign = await server.inject({
      headers: authorization("fixture|owner-beta"),
      method: "POST",
      payload: {},
      url: accessUrl,
    });
    expect(foreign.statusCode).toBe(404);
  });
});
