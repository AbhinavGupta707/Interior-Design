import type { SceneManifest } from "@interior-design/contracts";
import { describe, expect, it } from "vitest";

import {
  inspectGlb,
  SceneIntegrityError,
} from "../../../apps/web/src/features/viewer-3d/scene-verification.js";

const id = (value: number): string =>
  `a2000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
const hash = "a".repeat(64);
const manifest: SceneManifest = {
  authority: "derived-visualisation-only",
  boundsMm: {
    maximum: { xMm: 1_000, yMm: 1_000, zMm: 1_000 },
    minimum: { xMm: 0, yMm: 0, zMm: 0 },
  },
  compiler: {
    configuration: {
      coordinateMapping: "c4-z-up-to-gltf-y-up-v1",
      geometryMode: "parametric-v1",
      materialMode: "status-aware-neutral-v1",
      purpose: "interactive-browser",
      unknownGeometryPolicy: "omit-and-report",
    },
    configurationSha256: hash,
    name: "interior-design-scene-compiler",
    version: "security-fixture",
  },
  coordinateSystem: {
    canonicalAxes: "+X east, +Y north, +Z up",
    gltfAxes: "+Y up, +Z forward, right-handed",
    mapping: "[Xmm/1000, Zmm/1000, -Ymm/1000]",
    outputLengthUnit: "metre",
  },
  counts: { materials: 1, meshes: 1, nodes: 1, triangles: 1, vertices: 3 },
  determinismKeySha256: hash,
  elementMappings: [
    {
      elementId: id(1),
      elementType: "wall",
      findingCodes: [],
      materialIndices: [0],
      meshIndices: [0],
      nodeIndices: [0],
      status: "mapped",
    },
  ],
  findings: [],
  gltf: { container: "GLB", specificationVersion: "2.0" },
  schemaVersion: "c10-scene-manifest-v1",
  sourceSnapshot: {
    modelId: id(2),
    profile: "existing",
    projectId: id(3),
    schemaVersion: "c4-canonical-home-v1",
    snapshotId: id(4),
    snapshotSha256: hash,
  },
};

function glb(extra: Record<string, unknown> = {}): ArrayBuffer {
  const json = {
    accessors: [{ count: 3 }],
    asset: { version: "2.0" },
    buffers: [{ byteLength: 4 }],
    materials: [{}],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }],
    ...extra,
  };
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(encoded.byteLength / 4) * 4;
  const bytes = new Uint8Array(12 + 8 + jsonLength + 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + jsonLength);
  bytes.set(encoded, 20);
  view.setUint32(20 + jsonLength, 4, true);
  view.setUint32(24 + jsonLength, 0x004e4942, true);
  return bytes.buffer;
}

describe("C10 hostile GLB and manifest boundary", () => {
  it.each([
    ["external URI", { images: [{ uri: "https://attacker.invalid/tracker.png" }] }, "EXTERNAL_URI"],
    [
      "data URI",
      { buffers: [{ byteLength: 4, uri: "data:application/octet-stream;base64,AAAA" }] },
      "EXTERNAL_URI",
    ],
    ["SVG active content", { images: [{ mimeType: "image/svg+xml" }] }, "ACTIVE_CONTENT"],
    ["script marker", { extras: { payload: "<script>alert(1)</script>" } }, "ACTIVE_CONTENT"],
    [
      "unsupported required extension",
      { extensionsRequired: ["KHR_draco_mesh_compression"] },
      "UNSUPPORTED_REQUIRED_EXTENSION",
    ],
  ])("rejects %s before GLTFLoader", (_name, extra, code) => {
    expect(() => inspectGlb(glb(extra as Record<string, unknown>), manifest)).toThrow(
      expect.objectContaining({ code }) as SceneIntegrityError,
    );
  });

  it("rejects corrupt length/chunk alignment and manifest count substitution", () => {
    const corruptLength = glb();
    new DataView(corruptLength).setUint32(8, corruptLength.byteLength + 4, true);
    expect(() => inspectGlb(corruptLength, manifest)).toThrow(/declared length/u);
    expect(() => inspectGlb(glb({ nodes: [{}, {}] }), manifest)).toThrow(/manifest counts/u);
  });
});
