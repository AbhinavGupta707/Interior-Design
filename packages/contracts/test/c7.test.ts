import { describe, expect, it } from "vitest";

import {
  c7CapturePolicy,
  c7RouteContract,
  captureProposalResultSchema,
  captureSessionSchema,
  createCaptureArtifactUploadRequestSchema,
  createCapturePackageRequestSchema,
  createCaptureSessionRequestSchema,
  roomPlanNormalizedSchema,
} from "../src/index.js";

const projectId = "10000000-0000-4000-8000-000000000001";
const captureSessionId = "20000000-0000-4000-8000-000000000001";
const roomId = "30000000-0000-4000-8000-000000000001";
const sourceRoomId = "40000000-0000-4000-8000-000000000001";
const sourceWallId = "50000000-0000-4000-8000-000000000001";
const packageId = "60000000-0000-4000-8000-000000000001";
const proposalId = "70000000-0000-4000-8000-000000000001";
const now = "2026-07-17T12:00:00.000Z";
const later = "2026-07-17T12:05:00.000Z";
const sha256 = "a".repeat(64);

const quality = {
  heuristicName: "c7-roomplan-quality",
  heuristicVersion: "1.0.0",
  instructionCounts: {
    "low-texture": 0,
    "move-away-from-wall": 1,
    "move-close-to-wall": 1,
    normal: 20,
    "slow-down": 2,
    "turn-on-light": 0,
  },
  interruptionCount: 0,
  lowConfidenceObjectCount: 0,
  lowConfidenceSurfaceCount: 0,
  relocalisationAttemptCount: 0,
  relocalisationSuccessCount: 0,
  scanDurationMilliseconds: 300_000,
  worldMappingStatusAtFinish: "mapped",
} as const;

const room = {
  capturedRoomVersion: 1,
  roomId,
  sequence: 1,
  sourceRoomIdentifier: sourceRoomId,
  story: 0,
  userLabel: "Synthetic room",
} as const;

const artifacts = [
  {
    artifactId: "80000000-0000-4000-8000-000000000001",
    byteSize: 2_048,
    contentType: "application/json",
    kind: "captured-room-json",
    roomId,
    sha256,
  },
  {
    artifactId: "80000000-0000-4000-8000-000000000002",
    byteSize: 4_096,
    contentType: "application/json",
    kind: "captured-structure-json",
    sha256: "b".repeat(64),
  },
  {
    artifactId: "80000000-0000-4000-8000-000000000003",
    byteSize: 3_072,
    contentType: "application/json",
    kind: "roomplan-normalized-json",
    sha256: "c".repeat(64),
  },
  {
    artifactId: "80000000-0000-4000-8000-000000000004",
    byteSize: 1_024,
    contentType: "application/json",
    kind: "quality-manifest-json",
    sha256: "d".repeat(64),
  },
] as const;

function capturePackage() {
  return {
    artifacts,
    captureSessionId,
    device: {
      appBuild: "42",
      appVersion: "1.0.0",
      deviceModelIdentifier: "iPhone17,1",
      operatingSystemVersion: "26.4",
      roomPlanSupported: true,
    },
    endedAt: later,
    mode: "structure",
    projectId,
    quality,
    referenceMeasurements: [],
    rights: {
      basis: "owned-by-user",
      serviceProcessingConsent: true,
      trainingUseConsent: "denied",
    },
    rooms: [room],
    schemaVersion: "c7-capture-package-v1",
    sharedWorldOrigin: true,
    startedAt: now,
  } as const;
}

describe("C7 native capture contracts", () => {
  it("freezes the physical-capture budgets and exact route inventory", () => {
    expect(c7CapturePolicy).toMatchObject({
      maximumArtifactCount: 256,
      maximumPackageBytes: 2_147_483_648,
      maximumRoomCount: 64,
      uploadPartSizeBytes: 8_388_608,
    });
    expect(c7RouteContract).toEqual({
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
  });

  it("creates only rights-cleared supported-device capture sessions", () => {
    const request = {
      captureLabel: "Ground floor",
      deviceCapability: "roomplan-lidar",
      expectedRoomCount: 4,
      mode: "structure",
      rights: {
        basis: "owned-by-user",
        serviceProcessingConsent: true,
        trainingUseConsent: "denied",
      },
    } as const;
    expect(createCaptureSessionRequestSchema.parse(request)).toEqual(request);
    expect(
      createCaptureSessionRequestSchema.safeParse({
        ...request,
        rights: { ...request.rights, trainingUseConsent: "granted" },
      }).success,
    ).toBe(false);
  });

  it("keeps server session terminal references internally consistent", () => {
    const session = {
      brief: {
        captureLabel: "Ground floor",
        captureSessionId,
        expiresAt: "2026-07-24T12:00:00.000Z",
        instructionsVersion: "1.0.0",
        mode: "structure",
        projectId,
        rights: {
          basis: "owned-by-user",
          serviceProcessingConsent: true,
          trainingUseConsent: "denied",
        },
        schemaVersion: "c7-capture-session-v1",
      },
      createdAt: now,
      id: captureSessionId,
      projectId,
      retryable: false,
      schemaVersion: "c7-capture-session-v1",
      state: "created",
      updatedAt: now,
      version: 1,
    } as const;
    expect(captureSessionSchema.parse(session)).toEqual(session);
    expect(
      captureSessionSchema.safeParse({
        ...session,
        packageId,
        proposalId,
        state: "proposed",
      }).success,
    ).toBe(true);
    expect(captureSessionSchema.safeParse({ ...session, state: "failed" }).success).toBe(false);
  });

  it("binds every upload to an exact kind, media type, size and source hash", () => {
    const upload = {
      byteSize: 1_024,
      contentType: "application/json",
      kind: "captured-room-data-json",
      roomId,
      sha256,
    } as const;
    expect(createCaptureArtifactUploadRequestSchema.parse(upload)).toEqual(upload);
    expect(
      createCaptureArtifactUploadRequestSchema.safeParse({
        ...upload,
        contentType: "model/vnd.usdz+zip",
      }).success,
    ).toBe(false);
  });

  it("requires complete, unique, bounded structure package manifests", () => {
    const manifest = capturePackage();
    expect(createCapturePackageRequestSchema.parse(manifest)).toEqual(manifest);
    expect(
      createCapturePackageRequestSchema.safeParse({
        ...manifest,
        artifacts: manifest.artifacts.filter(({ kind }) => kind !== "captured-structure-json"),
      }).success,
    ).toBe(false);
    expect(
      createCapturePackageRequestSchema.safeParse({ ...manifest, sharedWorldOrigin: false })
        .success,
    ).toBe(false);
  });

  it("normalizes RoomPlan floats into bounded integer coordinates with valid references", () => {
    const normalized = {
      captureSessionId,
      coordinateSystem: {
        handedness: "right",
        rotationUnit: "nanounit-basis",
        source: "roomplan-world",
        translationUnit: "micrometre",
      },
      objects: [],
      projectId,
      quality,
      referenceMeasurements: [],
      rooms: [room],
      schemaVersion: "c7-roomplan-normalized-v1",
      surfaces: [
        {
          category: "wall",
          completedEdges: ["top", "bottom", "left", "right"],
          confidence: "high",
          dimensionsMicrometres: { x: 4_000_000, y: 2_500_000, z: 100_000 },
          polygonCornersMicrometres: [],
          roomId,
          sourceIdentifier: sourceWallId,
          story: 0,
          transform: {
            basisNanounits: [1_000_000_000, 0, 0, 0, 1_000_000_000, 0, 0, 0, 1_000_000_000],
            translationMicrometres: { x: 0, y: 1_250_000, z: 0 },
          },
        },
      ],
    } as const;
    expect(roomPlanNormalizedSchema.parse(normalized)).toEqual(normalized);
    expect(
      roomPlanNormalizedSchema.safeParse({
        ...normalized,
        surfaces: [{ ...normalized.surfaces[0], parentSourceIdentifier: proposalId }],
      }).success,
    ).toBe(false);
  });

  it("publishes a source-pinned abstention without creating canonical state", () => {
    const result = {
      captureSessionId,
      code: "low-quality",
      converter: {
        adapterId: "roomplan-canonical-proposal",
        adapterVersion: "1.0.0",
        manifestSha256: "e".repeat(64),
        normalizedInputSha256: "c".repeat(64),
      },
      createdAt: later,
      detail: "The capture requires another pass before geometry can be proposed.",
      findings: [],
      nextActions: ["rescan-room", "add-reference-measurement"],
      packageId,
      packageManifestSha256: "f".repeat(64),
      projectId,
      proposalId,
      retryable: false,
      schemaVersion: "c7-capture-proposal-v1",
      status: "abstained",
    } as const;
    expect(captureProposalResultSchema.parse(result)).toEqual(result);
    expect(captureProposalResultSchema.safeParse({ ...result, proposedSnapshot: {} }).success).toBe(
      false,
    );
  });
});
