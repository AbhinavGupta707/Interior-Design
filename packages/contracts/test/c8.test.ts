import { describe, expect, it } from "vitest";

import {
  c8ReconstructionPolicy,
  c8RouteContract,
  createReconstructionJobRequestSchema,
  mediaPreparationManifestSchema,
  reconstructionAppearanceResultSchema,
  reconstructionGeometryResultSchema,
  reconstructionJobSchema,
  reconstructionResultSchema,
} from "../src/index.js";

const projectId = "10000000-0000-4000-8000-000000000001";
const jobId = "20000000-0000-4000-8000-000000000001";
const resultId = "30000000-0000-4000-8000-000000000001";
const sourceAssetId = "40000000-0000-4000-8000-000000000001";
const frameId = "50000000-0000-4000-8000-000000000001";
const now = "2026-07-17T12:00:00.000Z";
const shaA = "a".repeat(64);
const shaB = "b".repeat(64);
const shaC = "c".repeat(64);
const shaD = "d".repeat(64);

const rights = {
  basis: "owned-by-user",
  serviceProcessingConsent: true,
  trainingUseConsent: "denied",
} as const;

const source = {
  assetId: sourceAssetId,
  byteSize: 10_000_000,
  detectedMimeType: "video/mp4",
  kind: "rgb-video",
  sha256: shaA,
} as const;

const request = {
  appearanceMode: "optional",
  label: "Synthetic ground-floor reconstruction",
  mode: "rgb-sfm",
  registrationAnchors: [],
  rights,
  sources: [source],
} as const;

const tool = {
  adapterId: "colmap.cpu",
  adapterVersion: "1.0.0",
  configSha256: shaB,
  executableVersion: "3.13.0",
} as const;

const cameraArtifact = {
  artifactId: "60000000-0000-4000-8000-000000000001",
  byteSize: 2_048,
  contentSha256: shaA,
  dimensionalAuthority: "proposal-only",
  kind: "calibrated-cameras",
  mediaType: "application/json",
  sourceManifestSha256: shaB,
  toolManifestSha256: shaC,
} as const;

const sparseArtifact = {
  artifactId: "60000000-0000-4000-8000-000000000002",
  byteSize: 8_192,
  contentSha256: shaB,
  dimensionalAuthority: "proposal-only",
  kind: "sparse-point-cloud",
  mediaType: "application/octet-stream",
  sourceManifestSha256: shaB,
  toolManifestSha256: shaC,
} as const;

const geometry = {
  alignment: { anchorCount: 0 },
  artifacts: [cameraArtifact, sparseArtifact],
  componentCount: 1,
  coordinateSystem: "right-handed-local",
  inputFrameCount: 100,
  manifestSha256: shaC,
  registeredFrameCount: 85,
  scaleStatus: "unknown",
  schemaVersion: "c8-geometry-result-v1",
  tool,
  unit: "arbitrary-units",
} as const;

describe("C8 media reconstruction contracts", () => {
  it("freezes budgets and the exact public route inventory", () => {
    expect(c8ReconstructionPolicy).toMatchObject({
      maximumAttempts: 3,
      maximumFrameCount: 10_000,
      maximumSourceAssetCount: 512,
      minimumSimilarityAlignmentAnchors: 3,
    });
    expect(c8RouteContract).toEqual({
      cancelJob: "/v1/projects/:projectId/reconstruction-jobs/:reconstructionJobId/cancel",
      createJob: "/v1/projects/:projectId/reconstruction-jobs",
      getJob: "/v1/projects/:projectId/reconstruction-jobs/:reconstructionJobId",
      getResult: "/v1/projects/:projectId/reconstruction-jobs/:reconstructionJobId/result",
      listJobs: "/v1/projects/:projectId/reconstruction-jobs",
      retryJob: "/v1/projects/:projectId/reconstruction-jobs/:reconstructionJobId/retry",
    });
  });

  it("requires immutable RGB evidence, processing consent and denied training use", () => {
    expect(createReconstructionJobRequestSchema.parse(request)).toEqual(request);
    expect(
      createReconstructionJobRequestSchema.safeParse({
        ...request,
        rights: { ...rights, trainingUseConsent: "granted" },
      }).success,
    ).toBe(false);
    expect(
      createReconstructionJobRequestSchema.safeParse({
        ...request,
        mode: "rgbd-tsdf",
      }).success,
    ).toBe(false);
    expect(
      createReconstructionJobRequestSchema.safeParse({
        ...request,
        sources: [{ ...source, detectedMimeType: "image/jpeg" }],
      }).success,
    ).toBe(false);
  });

  it("requires three independent correspondences whenever alignment is requested", () => {
    const anchor = {
      anchorId: "70000000-0000-4000-8000-000000000001",
      method: "user-correspondence",
      sourcePointMicrometres: { x: 0, y: 0, z: 0 },
      targetPointMicrometres: { x: 1, y: 2, z: 3 },
    } as const;
    expect(
      createReconstructionJobRequestSchema.safeParse({
        ...request,
        registrationAnchors: [anchor],
      }).success,
    ).toBe(false);
  });

  it("keeps terminal job state, result and safe-code references consistent", () => {
    const job = {
      attempt: 1,
      createdAt: now,
      id: jobId,
      projectId,
      request,
      retryable: false,
      schemaVersion: "c8-reconstruction-job-v1",
      state: "created",
      updatedAt: now,
      version: 1,
    } as const;
    expect(reconstructionJobSchema.parse(job)).toEqual(job);
    expect(
      reconstructionJobSchema.safeParse({ ...job, resultId, state: "completed" }).success,
    ).toBe(true);
    expect(reconstructionJobSchema.safeParse({ ...job, state: "failed" }).success).toBe(false);
  });

  it("accepts only stripped, bounded frames with honest privacy review state", () => {
    const frame = {
      blurScoreMillionths: 900_000,
      exposureScoreMillionths: 800_000,
      frameId,
      heightPixels: 1_080,
      metadataStripped: true,
      overlapScoreMillionths: 700_000,
      redactionStatus: "not-required",
      sanitizedSha256: shaD,
      sourceAssetId,
      timestampMicroseconds: 1_000_000,
      widthPixels: 1_920,
    } as const;
    const manifest = {
      frames: [frame],
      jobId,
      manifestSha256: shaC,
      privacyStatus: "accepted",
      projectId,
      schemaVersion: "c8-media-preparation-v1",
      sourceManifestSha256: shaA,
      tool,
    } as const;
    expect(mediaPreparationManifestSchema.parse(manifest)).toEqual(manifest);
    expect(
      mediaPreparationManifestSchema.safeParse({
        ...manifest,
        frames: [{ ...frame, redactionStatus: "review-required" }],
      }).success,
    ).toBe(false);
  });

  it("keeps unknown scale explicit and requires evidence for metric validation", () => {
    expect(reconstructionGeometryResultSchema.parse(geometry)).toEqual(geometry);
    expect(
      reconstructionGeometryResultSchema.safeParse({
        ...geometry,
        scaleStatus: "metric-validated",
        unit: "micrometres",
      }).success,
    ).toBe(false);
  });

  it("separates non-dimensional appearance from proposal-only geometry", () => {
    const appearanceArtifact = {
      ...sparseArtifact,
      artifactId: "60000000-0000-4000-8000-000000000003",
      dimensionalAuthority: "non-dimensional",
      kind: "gaussian-splat",
    } as const;
    const appearance = {
      artifacts: [appearanceArtifact],
      geometryManifestSha256: geometry.manifestSha256,
      manifestSha256: shaD,
      method: "gsplat",
      schemaVersion: "c8-appearance-result-v1",
      tool: { ...tool, adapterId: "gsplat.cuda" },
    } as const;
    expect(reconstructionAppearanceResultSchema.parse(appearance)).toEqual(appearance);
    expect(
      reconstructionResultSchema.parse({
        appearance,
        createdAt: now,
        findings: [],
        geometry,
        jobId,
        projectId,
        resultId,
        schemaVersion: "c8-reconstruction-result-v1",
        sourceManifestSha256: shaA,
        status: "completed",
      }),
    ).toBeDefined();
    expect(
      reconstructionAppearanceResultSchema.safeParse({
        ...appearance,
        artifacts: [{ ...appearanceArtifact, dimensionalAuthority: "proposal-only" }],
      }).success,
    ).toBe(false);
  });
});
