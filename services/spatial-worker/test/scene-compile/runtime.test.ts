/// <reference types="node" />

import { createHash } from "node:crypto";

import {
  c10DefaultCompileConfiguration,
  canonicalHomeSnapshotSchema,
  sceneArtifactSchema,
  sceneManifestSchema,
  sceneSnapshotReferenceSchema,
  type CanonicalHomeSnapshot,
} from "@interior-design/contracts";
import { describe, expect, it, vi } from "vitest";

import { runSceneCompilation } from "../../src/scene-compile/index.js";
import type {
  SceneCompilationRuntimePorts,
  SceneCompilationTask,
  SceneCompilerOutput,
  SceneWorkState,
} from "../../src/scene-compile/index.js";

const ids = Object.freeze({
  actor: "40000000-0000-4000-8000-000000000001",
  artifact: "40000000-0000-4000-8000-000000000002",
  claim: "40000000-0000-4000-8000-000000000003",
  job: "40000000-0000-4000-8000-000000000004",
  level: "40000000-0000-4000-8000-000000000005",
  model: "40000000-0000-4000-8000-000000000006",
  project: "40000000-0000-4000-8000-000000000007",
  snapshot: "40000000-0000-4000-8000-000000000008",
});

function known<TValue>(value: TValue) {
  return {
    attribution: {
      actorUserId: ids.actor,
      claimId: ids.claim,
      evidenceIds: [],
      method: { kind: "fixture" as const, name: "scene-runtime-fixture", version: "1" },
      state: "user-asserted" as const,
      verification: { status: "not-reviewed" as const },
    },
    knowledge: "known" as const,
    value,
  };
}

function snapshot(): CanonicalHomeSnapshot {
  return canonicalHomeSnapshotSchema.parse({
    coordinateSystem: {
      axes: { x: "east", y: "north", z: "up" },
      globalAnchor: { status: "not-established" },
      handedness: "right",
      kind: "local-cartesian",
      lengthUnit: "mm",
      originConvention: "project-local-model-origin",
    },
    elements: {
      cameras: [],
      finishes: [],
      fixedObjects: [],
      furnishings: [],
      levels: [
        {
          elementType: "level",
          elevationMm: known(0),
          id: ids.level,
          name: known("Ground"),
          origin: known(0).attribution,
          storeyHeightMm: known(2_700),
        },
      ],
      lights: [],
      openings: [],
      spaces: [],
      stairs: [],
      surfaces: [],
      walls: [],
    },
    knownLimitations: [{ code: "SYNTHETIC_ONLY", detail: "Synthetic runtime fixture." }],
    modelId: ids.model,
    profile: "existing",
    projectId: ids.project,
    schemaVersion: "c4-canonical-home-v1",
  });
}

const source = sceneSnapshotReferenceSchema.parse({
  modelId: ids.model,
  profile: "existing",
  projectId: ids.project,
  schemaVersion: "c4-canonical-home-v1",
  snapshotId: ids.snapshot,
  snapshotSha256: "a".repeat(64),
});

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function minimalGlb(): Uint8Array {
  const document = new TextEncoder().encode(
    JSON.stringify({ asset: { version: "2.0" }, scene: 0, scenes: [{}] }),
  );
  const jsonLength = Math.ceil(document.byteLength / 4) * 4;
  const bytes = new Uint8Array(20 + jsonLength);
  bytes.fill(0x20, 20);
  bytes.set(document, 20);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  return bytes;
}

function compilerOutput(): SceneCompilerOutput {
  const glb = minimalGlb();
  const manifest = sceneManifestSchema.parse({
    authority: "derived-visualisation-only",
    boundsMm: {
      maximum: { xMm: 0, yMm: 0, zMm: 0 },
      minimum: { xMm: 0, yMm: 0, zMm: 0 },
    },
    compiler: {
      configuration: c10DefaultCompileConfiguration,
      configurationSha256: "b".repeat(64),
      name: "interior-design-scene-compiler",
      version: "1.0.0",
    },
    coordinateSystem: {
      canonicalAxes: "+X east, +Y north, +Z up",
      gltfAxes: "+Y up, +Z forward, right-handed",
      mapping: "[Xmm/1000, Zmm/1000, -Ymm/1000]",
      outputLengthUnit: "metre",
    },
    counts: { materials: 0, meshes: 0, nodes: 1, triangles: 0, vertices: 0 },
    determinismKeySha256: "c".repeat(64),
    elementMappings: [
      {
        elementId: ids.level,
        elementType: "level",
        findingCodes: [],
        materialIndices: [],
        meshIndices: [],
        nodeIndices: [0],
        status: "mapped",
      },
    ],
    findings: [],
    gltf: { container: "GLB", specificationVersion: "2.0" },
    schemaVersion: "c10-scene-manifest-v1",
    sourceSnapshot: source,
  });
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  const artifact = sceneArtifactSchema.parse({
    byteSize: glb.byteLength,
    glbSha256: sha256(glb),
    id: ids.artifact,
    manifestSha256: sha256(manifestBytes),
    mimeType: "model/gltf-binary",
    schemaVersion: "c10-scene-artifact-v1",
  });
  return { artifact, glb, manifest, manifestBytes };
}

function task(): SceneCompilationTask {
  return {
    attempt: 1,
    configuration: c10DefaultCompileConfiguration,
    jobId: ids.job,
    publicationFence: "private-fence-do-not-return",
    sourceSnapshot: source,
  };
}

function ports(
  states: readonly SceneWorkState[] = ["current", "current", "current"],
  beforeCompile?: () => void,
): {
  readonly ports: SceneCompilationRuntimePorts;
  readonly publish: ReturnType<typeof vi.fn>;
  readonly compile: ReturnType<typeof vi.fn>;
  readonly load: ReturnType<typeof vi.fn>;
} {
  const queue = [...states];
  const load = vi.fn(() => Promise.resolve(snapshot()));
  const compile = vi.fn(() => {
    beforeCompile?.();
    return Promise.resolve(compilerOutput());
  });
  const publish = vi.fn(() => Promise.resolve("published" as const));
  return {
    compile,
    load,
    ports: {
      compiler: { compile },
      publisher: { publishIfCurrent: publish },
      snapshots: { loadExactSnapshot: load },
      workState: { check: vi.fn(() => Promise.resolve(queue.shift() ?? "current")) },
    },
    publish,
  };
}

describe("isolated scene compilation runtime", () => {
  it("publishes checksum-bound bytes through the atomic content-addressed port", async () => {
    const harness = ports();
    const result = await runSceneCompilation(task(), harness.ports, new AbortController().signal);
    expect(result).toMatchObject({ status: "published" });
    expect(harness.load).toHaveBeenCalledOnce();
    expect(harness.compile).toHaveBeenCalledOnce();
    expect(harness.publish).toHaveBeenCalledOnce();
    expect(harness.publish.mock.calls[0]?.[0]).toMatchObject({
      attempt: 1,
      contentAddress: {
        glbSha256: compilerOutput().artifact.glbSha256,
        manifestSha256: compilerOutput().artifact.manifestSha256,
      },
      jobId: ids.job,
      publicationFence: "private-fence-do-not-return",
    });
    const publicKeys = collectKeys(result);
    expect(publicKeys).not.toEqual(
      expect.arrayContaining([
        "publicationFence",
        "path",
        "locator",
        "credential",
        "signedUrl",
        "glb",
        "manifestBytes",
      ]),
    );
  });

  it("does no work when already cancelled", async () => {
    const harness = ports();
    const controller = new AbortController();
    controller.abort();
    const result = await runSceneCompilation(task(), harness.ports, controller.signal);
    expect(result).toEqual({ safeCode: "SCENE_COMPILATION_CANCELLED", status: "cancelled" });
    expect(harness.load).not.toHaveBeenCalled();
    expect(harness.compile).not.toHaveBeenCalled();
    expect(harness.publish).not.toHaveBeenCalled();
  });

  it("does not compile stale work", async () => {
    const harness = ports(["stale"]);
    const result = await runSceneCompilation(task(), harness.ports, new AbortController().signal);
    expect(result).toEqual({ safeCode: "SCENE_COMPILATION_STALE", status: "stale" });
    expect(harness.load).not.toHaveBeenCalled();
    expect(harness.compile).not.toHaveBeenCalled();
    expect(harness.publish).not.toHaveBeenCalled();
  });

  it("does not publish when cancellation arrives during compilation", async () => {
    const controller = new AbortController();
    const harness = ports(undefined, () => {
      controller.abort();
    });
    const result = await runSceneCompilation(task(), harness.ports, controller.signal);
    expect(result).toEqual({ safeCode: "SCENE_COMPILATION_CANCELLED", status: "cancelled" });
    expect(harness.publish).not.toHaveBeenCalled();
  });

  it("honours the publisher's atomic stale fence", async () => {
    const harness = ports();
    harness.publish.mockResolvedValueOnce("stale");
    const result = await runSceneCompilation(task(), harness.ports, new AbortController().signal);
    expect(result).toEqual({ safeCode: "SCENE_COMPILATION_STALE", status: "stale" });
    expect(harness.publish).toHaveBeenCalledOnce();
  });

  it("fails closed and never publishes corrupt compiler hashes", async () => {
    const harness = ports();
    const corrupt = compilerOutput();
    harness.compile.mockResolvedValueOnce({
      ...corrupt,
      artifact: { ...corrupt.artifact, glbSha256: "0".repeat(64) },
    });
    const result = await runSceneCompilation(task(), harness.ports, new AbortController().signal);
    expect(result).toEqual({ safeCode: "SCENE_COMPILATION_FAILED", status: "failed" });
    expect(harness.publish).not.toHaveBeenCalled();
  });

  it("fails closed when the snapshot port crosses project scope", async () => {
    const harness = ports();
    harness.load.mockResolvedValueOnce({ ...snapshot(), projectId: ids.actor });
    const result = await runSceneCompilation(task(), harness.ports, new AbortController().signal);
    expect(result).toEqual({ safeCode: "SCENE_COMPILATION_FAILED", status: "failed" });
    expect(harness.compile).not.toHaveBeenCalled();
    expect(harness.publish).not.toHaveBeenCalled();
  });
});

function collectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectKeys);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...collectKeys(child)]);
}
