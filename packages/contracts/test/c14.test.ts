import { describe, expect, it } from "vitest";

import {
  c14RenderPolicy,
  c14RouteContract,
  enhancementResultSchema,
  geometryGuardReportSchema,
  renderArtifactSchema,
  renderCameraSchema,
  renderJobSchema,
  renderProfileSchema,
} from "../src/index.js";

const hash = (character: string) => character.repeat(64);

describe("C14 frozen shared contracts", () => {
  it("freezes the disk multiplier, artifact ceiling and project-scoped routes", () => {
    expect(c14RenderPolicy.diskSafetyFloorBytes).toBe(15 * 1024 * 1024 * 1024);
    expect(c14RenderPolicy.diskSafetyJobMultiplier).toBe(3);
    expect(Object.values(c14RouteContract)).toHaveLength(10);
    expect(
      Object.values(c14RouteContract).every((route) => route.startsWith("/v1/projects/")),
    ).toBe(true);
  });

  it("rejects degenerate cameras and contradictory render profiles", () => {
    const camera = {
      cameraId: "14000000-0000-4000-8000-000000000001",
      clipEndMm: 100_000,
      clipStartMm: 10,
      position: { xMm: 0, yMm: 0, zMm: 1_600 },
      target: { xMm: 2_000, yMm: 0, zMm: 1_200 },
      verticalFovMilliDegrees: 60_000,
    };
    expect(renderCameraSchema.parse(camera)).toEqual(camera);
    expect(renderCameraSchema.safeParse({ ...camera, target: camera.position }).success).toBe(
      false,
    );

    const profile = {
      blenderBuildHash: "fbe6228777e7",
      blenderVersion: "5.2.0 LTS",
      colourManagement: {
        displayDevice: "sRGB" as const,
        look: "AgX - Medium High Contrast" as const,
        viewTransform: "AgX" as const,
      },
      denoise: "open-image-denoise" as const,
      device: "cpu" as const,
      engine: "cycles" as const,
      heightPx: 512,
      profileId: "cycles-cpu-geometry-safe-v1" as const,
      samples: 32,
      seed: 14,
      threads: 4,
      transparentBackground: false,
      widthPx: 512,
    };
    expect(renderProfileSchema.parse(profile)).toEqual(profile);
    expect(renderProfileSchema.safeParse({ ...profile, device: "metal" }).success).toBe(false);
  });

  it("requires geometry guard thresholds before an enhancement can be published", () => {
    const report = {
      accepted: true,
      allowedMaskSha256: hash("f"),
      baseArtifactSha256: hash("a"),
      cameraLocked: true,
      changedOutsideAllowedMaskPixels: 0,
      changedPixelCount: 512,
      enhancedArtifactSha256: hash("b"),
      protectedEdgeAgreementBasisPoints: 9_950,
      protectedGeometryMoved: false,
      schemaVersion: "c14-geometry-guard-v1" as const,
      segmentationIoUBasisPoints: 9_900,
    };
    expect(geometryGuardReportSchema.parse(report)).toEqual(report);
    expect(
      geometryGuardReportSchema.safeParse({ ...report, changedOutsideAllowedMaskPixels: 1 })
        .success,
    ).toBe(false);

    const artifact = {
      byteLength: 128,
      heightPx: 512,
      id: "14000000-0000-4000-8000-000000000002",
      mediaType: "image/png" as const,
      role: "illustrative-enhancement-png" as const,
      schemaVersion: "c14-render-artifact-v1" as const,
      sha256: hash("b"),
      widthPx: 512,
    };
    expect(renderArtifactSchema.parse(artifact)).toEqual(artifact);
    expect(
      enhancementResultSchema.parse({
        artifact,
        baseArtifactSha256: hash("a"),
        conditioningSha256: { depth: hash("c"), normal: hash("d"), segmentation: hash("e") },
        geometryGuard: report,
        model: { name: "Deterministic fixture", provider: "local-test", version: "1.0.0" },
        schemaVersion: "c14-enhancement-result-v1",
        state: "succeeded",
      }),
    ).toBeDefined();
  });

  it("does not expose a result or safe code from a non-terminal job", () => {
    const job = {
      attempt: 1,
      createdAt: "2026-07-18T12:00:00.000Z",
      createdBy: "14000000-0000-4000-8000-000000000003",
      id: "14000000-0000-4000-8000-000000000004",
      projectId: "14000000-0000-4000-8000-000000000005",
      request: {
        cameraId: "14000000-0000-4000-8000-000000000006",
        enhancement: "disabled" as const,
        label: "Living room geometry-safe render",
        lightingPresetId: "canonical-lights-neutral-world-v1" as const,
        profileId: "cycles-cpu-geometry-safe-v1" as const,
        sourceSceneJobId: "14000000-0000-4000-8000-000000000007",
      },
      state: "queued" as const,
      updatedAt: "2026-07-18T12:00:00.000Z",
      version: 1,
    };
    expect(renderJobSchema.parse(job)).toEqual(job);
    expect(renderJobSchema.safeParse({ ...job, resultId: job.id }).success).toBe(false);
  });
});
