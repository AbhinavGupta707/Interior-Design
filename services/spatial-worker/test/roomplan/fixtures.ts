import {
  createCapturePackageRequestSchema,
  roomPlanNormalizedSchema,
  type CreateCapturePackageRequest,
  type RoomPlanNormalized,
} from "@interior-design/contracts";
import { createHash } from "node:crypto";

import { canonicalJson, sha256 } from "../../src/roomplan/canonical.js";
import type { LeasedCaptureArtifact, LeasedRoomPlanCapture } from "../../src/roomplan/types.js";

export const SYNTHETIC_IDS = Object.freeze({
  attempt: "a0000000-0000-4000-8000-000000000001",
  captureSession: "20000000-0000-4000-8000-000000000001",
  capturedRoomArtifact: "60000000-0000-4000-8000-000000000001",
  floor: "50000000-0000-4000-8000-000000000002",
  furnishing: "50000000-0000-4000-8000-000000000004",
  measurement: "70000000-0000-4000-8000-000000000001",
  normalizedArtifact: "60000000-0000-4000-8000-000000000002",
  opening: "50000000-0000-4000-8000-000000000003",
  package: "80000000-0000-4000-8000-000000000001",
  project: "10000000-0000-4000-8000-000000000001",
  proposal: "90000000-0000-4000-8000-000000000001",
  qualityArtifact: "60000000-0000-4000-8000-000000000003",
  room: "30000000-0000-4000-8000-000000000001",
  sourceRoom: "40000000-0000-4000-8000-000000000001",
  tenant: "b0000000-0000-4000-8000-000000000001",
  wall: "50000000-0000-4000-8000-000000000001",
});

const identityTransform = {
  basisNanounits: [1_000_000_000, 0, 0, 0, 1_000_000_000, 0, 0, 0, 1_000_000_000],
  translationMicrometres: { x: 0, y: 0, z: 0 },
} as const;

export const SYNTHETIC_QUALITY = Object.freeze({
  heuristicName: "c7-roomplan-quality" as const,
  heuristicVersion: "1.0.0",
  instructionCounts: {
    "low-texture": 0,
    "move-away-from-wall": 0,
    "move-close-to-wall": 0,
    normal: 3,
    "slow-down": 0,
    "turn-on-light": 0,
  },
  interruptionCount: 0,
  lowConfidenceObjectCount: 0,
  lowConfidenceSurfaceCount: 0,
  relocalisationAttemptCount: 0,
  relocalisationSuccessCount: 0,
  scanDurationMilliseconds: 60_000,
  worldMappingStatusAtFinish: "mapped" as const,
});

export function syntheticNormalized(): RoomPlanNormalized {
  return roomPlanNormalizedSchema.parse({
    captureSessionId: SYNTHETIC_IDS.captureSession,
    coordinateSystem: {
      handedness: "right",
      rotationUnit: "nanounit-basis",
      source: "roomplan-world",
      translationUnit: "micrometre",
    },
    objects: [
      {
        category: "bed",
        confidence: "high",
        dimensionsMicrometres: { x: 2_000_000, y: 500_000, z: 1_500_000 },
        roomId: SYNTHETIC_IDS.room,
        sourceIdentifier: SYNTHETIC_IDS.furnishing,
        story: 0,
        transform: {
          ...identityTransform,
          translationMicrometres: { x: 500_000, y: 250_000, z: 500_000 },
        },
      },
    ],
    projectId: SYNTHETIC_IDS.project,
    quality: SYNTHETIC_QUALITY,
    referenceMeasurements: [
      {
        distanceMillimetres: 4_000,
        fromSourceEntityId: SYNTHETIC_IDS.wall,
        measurementId: SYNTHETIC_IDS.measurement,
        method: "laser",
        toSourceEntityId: SYNTHETIC_IDS.floor,
      },
    ],
    rooms: [
      {
        capturedRoomVersion: 1,
        roomId: SYNTHETIC_IDS.room,
        sequence: 1,
        sourceRoomIdentifier: SYNTHETIC_IDS.sourceRoom,
        story: 0,
        userLabel: "Synthetic test room",
      },
    ],
    schemaVersion: "c7-roomplan-normalized-v1",
    surfaces: [
      {
        category: "wall",
        completedEdges: ["bottom", "left", "right", "top"],
        confidence: "high",
        dimensionsMicrometres: { x: 4_000_000, y: 2_500_000, z: 100_000 },
        polygonCornersMicrometres: [],
        roomId: SYNTHETIC_IDS.room,
        sourceIdentifier: SYNTHETIC_IDS.wall,
        story: 0,
        transform: {
          ...identityTransform,
          translationMicrometres: { x: 0, y: 1_250_000, z: -1_500_000 },
        },
      },
      {
        category: "floor",
        completedEdges: ["bottom", "left", "right", "top"],
        confidence: "high",
        dimensionsMicrometres: { x: 4_000_000, y: 100_000, z: 3_000_000 },
        polygonCornersMicrometres: [],
        roomId: SYNTHETIC_IDS.room,
        sourceIdentifier: SYNTHETIC_IDS.floor,
        story: 0,
        transform: identityTransform,
      },
      {
        category: "door-closed",
        completedEdges: ["bottom", "left", "right", "top"],
        confidence: "medium",
        dimensionsMicrometres: { x: 900_000, y: 2_000_000, z: 100_000 },
        parentSourceIdentifier: SYNTHETIC_IDS.wall,
        polygonCornersMicrometres: [],
        roomId: SYNTHETIC_IDS.room,
        sourceIdentifier: SYNTHETIC_IDS.opening,
        story: 0,
        transform: {
          ...identityTransform,
          translationMicrometres: { x: 1_000_000, y: 1_000_000, z: -1_500_000 },
        },
      },
    ],
  });
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface SyntheticSources {
  readonly artifacts: readonly LeasedCaptureArtifact[];
  readonly bytesByKey: ReadonlyMap<string, Uint8Array>;
  readonly manifest: CreateCapturePackageRequest;
  readonly normalized: RoomPlanNormalized;
}

export function syntheticSources(): SyntheticSources {
  const normalized = syntheticNormalized();
  const bytesById = new Map<string, Uint8Array>([
    [
      SYNTHETIC_IDS.capturedRoomArtifact,
      Buffer.from('{"fixture":"synthetic-captured-room","version":1}', "utf8"),
    ],
    [SYNTHETIC_IDS.normalizedArtifact, Buffer.from(canonicalJson(normalized), "utf8")],
    [SYNTHETIC_IDS.qualityArtifact, Buffer.from(canonicalJson(SYNTHETIC_QUALITY), "utf8")],
  ]);
  const descriptors = [
    {
      artifactId: SYNTHETIC_IDS.capturedRoomArtifact,
      kind: "captured-room-json" as const,
      roomId: SYNTHETIC_IDS.room,
    },
    {
      artifactId: SYNTHETIC_IDS.normalizedArtifact,
      kind: "roomplan-normalized-json" as const,
    },
    {
      artifactId: SYNTHETIC_IDS.qualityArtifact,
      kind: "quality-manifest-json" as const,
    },
  ];
  const artifacts = descriptors.map((descriptor) => {
    const bytes = bytesById.get(descriptor.artifactId);
    if (bytes === undefined) throw new Error("Synthetic artifact bytes are missing.");
    return {
      artifactId: descriptor.artifactId,
      byteSize: bytes.byteLength,
      contentType: "application/json" as const,
      kind: descriptor.kind,
      objectKey: `synthetic/c7/${descriptor.artifactId}`,
      ...(descriptor.roomId === undefined ? {} : { roomId: descriptor.roomId }),
      sha256: digest(bytes),
    };
  });
  const manifest = createCapturePackageRequestSchema.parse({
    artifacts: artifacts.map(({ artifactId, byteSize, contentType, kind, roomId, sha256 }) => ({
      artifactId,
      byteSize,
      contentType,
      kind,
      ...(roomId === undefined ? {} : { roomId }),
      sha256,
    })),
    captureSessionId: SYNTHETIC_IDS.captureSession,
    device: {
      appBuild: "synthetic.1",
      appVersion: "1.0.0-test",
      deviceModelIdentifier: "SyntheticDevice1,1",
      operatingSystemVersion: "synthetic-1.0",
      roomPlanSupported: true,
    },
    endedAt: "2026-01-01T12:01:00.000Z",
    mode: "single-room",
    projectId: SYNTHETIC_IDS.project,
    quality: SYNTHETIC_QUALITY,
    referenceMeasurements: normalized.referenceMeasurements,
    rights: {
      basis: "owned-by-user",
      serviceProcessingConsent: true,
      trainingUseConsent: "denied",
    },
    rooms: normalized.rooms,
    schemaVersion: "c7-capture-package-v1",
    sharedWorldOrigin: false,
    startedAt: "2026-01-01T12:00:00.000Z",
  });
  return {
    artifacts,
    bytesByKey: new Map(
      artifacts.map((artifact) => {
        const bytes = bytesById.get(artifact.artifactId);
        if (bytes === undefined) throw new Error("Synthetic artifact bytes are missing.");
        return [artifact.objectKey, bytes] as const;
      }),
    ),
    manifest,
    normalized,
  };
}

export function syntheticJob(): LeasedRoomPlanCapture {
  const sources = syntheticSources();
  return {
    artifacts: sources.artifacts,
    attempt: 1,
    attemptId: SYNTHETIC_IDS.attempt,
    captureSessionId: SYNTHETIC_IDS.captureSession,
    leaseExpiresAt: "2026-01-01T12:05:00.000Z",
    leaseToken: "c0000000-0000-4000-8000-000000000001",
    manifest: sources.manifest,
    packageId: SYNTHETIC_IDS.package,
    packageManifestSha256: sha256(sources.manifest),
    projectId: SYNTHETIC_IDS.project,
    tenantId: SYNTHETIC_IDS.tenant,
  };
}
