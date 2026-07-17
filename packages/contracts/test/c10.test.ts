import { describe, expect, it } from "vitest";

import {
  c10DefaultCompileConfiguration,
  c10RouteContract,
  createSceneJobRequestSchema,
  sceneElementMappingSchema,
  sceneJobSchema,
  sceneManifestSchema,
} from "../src/index.js";

const ids = {
  element: "10000000-0000-4000-8000-000000000001",
  job: "10000000-0000-4000-8000-000000000002",
  model: "10000000-0000-4000-8000-000000000003",
  project: "10000000-0000-4000-8000-000000000004",
  scene: "10000000-0000-4000-8000-000000000005",
  snapshot: "10000000-0000-4000-8000-000000000006",
  user: "10000000-0000-4000-8000-000000000007",
} as const;
const hash = "a".repeat(64);

const sourceSnapshot = {
  modelId: ids.model,
  profile: "existing" as const,
  projectId: ids.project,
  schemaVersion: "c4-canonical-home-v1" as const,
  snapshotId: ids.snapshot,
  snapshotSha256: hash,
};

describe("C10 scene contracts", () => {
  it("freezes strict exact-snapshot compilation and route contracts", () => {
    expect(
      createSceneJobRequestSchema.parse({
        configuration: c10DefaultCompileConfiguration,
        label: "Exact existing home",
        sourceSnapshot,
      }),
    ).toMatchObject({ sourceSnapshot });
    expect(() =>
      createSceneJobRequestSchema.parse({
        configuration: c10DefaultCompileConfiguration,
        label: "Exact existing home",
        sourceSnapshot,
        untrustedLocator: "s3://hidden/key",
      }),
    ).toThrow();
    expect(c10RouteContract.createSceneAccess).toContain("/scene/access");
  });

  it("requires terminal scene and safe-code invariants", () => {
    const core = {
      attempt: 1,
      createdAt: "2026-07-17T20:00:00.000Z",
      createdBy: ids.user,
      id: ids.job,
      projectId: ids.project,
      request: {
        configuration: c10DefaultCompileConfiguration,
        label: "Exact existing home",
        sourceSnapshot,
      },
      updatedAt: "2026-07-17T20:00:00.000Z",
      version: 1,
    };
    expect(sceneJobSchema.parse({ ...core, sceneId: ids.scene, state: "succeeded" }).sceneId).toBe(
      ids.scene,
    );
    expect(() => sceneJobSchema.parse({ ...core, state: "succeeded" })).toThrow();
    expect(() =>
      sceneJobSchema.parse({ ...core, safeCode: "SCENE_FAILED", state: "queued" }),
    ).toThrow();
  });

  it("requires honest omission and one-to-one stable node mappings", () => {
    expect(() =>
      sceneElementMappingSchema.parse({
        elementId: ids.element,
        elementType: "wall",
        findingCodes: [],
        materialIndices: [],
        meshIndices: [],
        nodeIndices: [],
        status: "omitted",
      }),
    ).toThrow();

    const mapping = {
      elementId: ids.element,
      elementType: "wall" as const,
      findingCodes: [],
      materialIndices: [0],
      meshIndices: [0],
      nodeIndices: [0],
      status: "mapped" as const,
    };
    const manifest = {
      authority: "derived-visualisation-only" as const,
      boundsMm: {
        maximum: { xMm: 5_000, yMm: 4_000, zMm: 2_500 },
        minimum: { xMm: 0, yMm: 0, zMm: 0 },
      },
      compiler: {
        configuration: c10DefaultCompileConfiguration,
        configurationSha256: hash,
        name: "interior-design-scene-compiler" as const,
        version: "1.0.0",
      },
      coordinateSystem: {
        canonicalAxes: "+X east, +Y north, +Z up" as const,
        gltfAxes: "+Y up, +Z forward, right-handed" as const,
        mapping: "[Xmm/1000, Zmm/1000, -Ymm/1000]" as const,
        outputLengthUnit: "metre" as const,
      },
      counts: { materials: 1, meshes: 1, nodes: 1, triangles: 12, vertices: 8 },
      determinismKeySha256: hash,
      elementMappings: [mapping],
      findings: [],
      gltf: { container: "GLB" as const, specificationVersion: "2.0" as const },
      schemaVersion: "c10-scene-manifest-v1" as const,
      sourceSnapshot,
    };
    expect(sceneManifestSchema.parse(manifest).elementMappings).toHaveLength(1);
    expect(() =>
      sceneManifestSchema.parse({
        ...manifest,
        elementMappings: [mapping, { ...mapping, elementId: ids.model }],
      }),
    ).toThrow();
  });
});
