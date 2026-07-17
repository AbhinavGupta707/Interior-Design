import type {
  Project,
  SceneAccessResponse,
  SceneJob,
  SceneManifest,
  SceneRecord,
  Session,
} from "@interior-design/contracts";

export const uuid = (sequence: number): string =>
  `a1000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;

export const hash = (value: string): string => value.repeat(64).slice(0, 64);

export const project: Project = {
  createdAt: "2026-07-17T20:00:00.000Z",
  id: uuid(1),
  name: "Synthetic C10 viewer project",
  status: "active",
  tenantId: uuid(2),
  updatedAt: "2026-07-17T20:00:00.000Z",
  version: 1,
};

export const session: Session = {
  actor: {
    displayName: "Synthetic C10 owner",
    role: "owner",
    subject: "fixture:c10-owner",
    tenantId: project.tenantId,
    userId: uuid(3),
  },
  authMode: "local-fixture",
  expiresAt: "2099-07-17T20:00:00.000Z",
};

export const sourceSnapshot = {
  modelId: uuid(4),
  profile: "existing" as const,
  projectId: project.id,
  schemaVersion: "c4-canonical-home-v1" as const,
  snapshotId: uuid(5),
  snapshotSha256: hash("a"),
};

export const job: SceneJob = {
  attempt: 1,
  createdAt: "2026-07-17T20:01:00.000Z",
  createdBy: session.actor.userId,
  id: uuid(6),
  projectId: project.id,
  request: {
    configuration: {
      coordinateMapping: "c4-z-up-to-gltf-y-up-v1",
      geometryMode: "parametric-v1",
      materialMode: "status-aware-neutral-v1",
      purpose: "interactive-browser",
      unknownGeometryPolicy: "omit-and-report",
    },
    label: "Synthetic compact home",
    sourceSnapshot,
  },
  sceneId: uuid(7),
  state: "succeeded",
  updatedAt: "2026-07-17T20:02:00.000Z",
  version: 1,
};

export const manifest: SceneManifest = {
  authority: "derived-visualisation-only",
  boundsMm: {
    maximum: { xMm: 5_000, yMm: 4_000, zMm: 2_700 },
    minimum: { xMm: 0, yMm: 0, zMm: 0 },
  },
  compiler: {
    configuration: job.request.configuration,
    configurationSha256: hash("b"),
    name: "interior-design-scene-compiler",
    version: "1.0.0-fixture",
  },
  coordinateSystem: {
    canonicalAxes: "+X east, +Y north, +Z up",
    gltfAxes: "+Y up, +Z forward, right-handed",
    mapping: "[Xmm/1000, Zmm/1000, -Ymm/1000]",
    outputLengthUnit: "metre",
  },
  counts: { materials: 1, meshes: 1, nodes: 2, triangles: 12, vertices: 8 },
  determinismKeySha256: hash("c"),
  elementMappings: [
    {
      elementId: uuid(8),
      elementType: "level",
      findingCodes: [],
      materialIndices: [],
      meshIndices: [],
      nodeIndices: [0],
      status: "mapped",
    },
    {
      elementId: uuid(9),
      elementType: "wall",
      findingCodes: ["SYNTHETIC_FIXTURE_ONLY"],
      materialIndices: [0],
      meshIndices: [0],
      nodeIndices: [1],
      status: "mapped",
    },
  ],
  findings: [
    {
      affectedElementIds: [uuid(9)],
      code: "SYNTHETIC_FIXTURE_ONLY",
      detail: "This mapping is visibly synthetic presentation evidence.",
      severity: "information",
    },
  ],
  gltf: { container: "GLB", specificationVersion: "2.0" },
  schemaVersion: "c10-scene-manifest-v1",
  sourceSnapshot,
};

export const scene: SceneRecord = {
  artifact: {
    byteSize: 1_024,
    glbSha256: hash("d"),
    id: uuid(10),
    manifestSha256: hash("e"),
    mimeType: "model/gltf-binary",
    schemaVersion: "c10-scene-artifact-v1",
  },
  createdAt: "2026-07-17T20:02:00.000Z",
  createdBy: session.actor.userId,
  id: job.sceneId ?? uuid(7),
  manifest,
  projectId: project.id,
};

export const access: SceneAccessResponse = {
  byteSize: scene.artifact.byteSize,
  expiresAt: "2099-07-17T20:10:00.000Z",
  glbSha256: scene.artifact.glbSha256,
  manifestSha256: scene.artifact.manifestSha256,
  mimeType: "model/gltf-binary",
  sceneId: scene.id,
  url: "http://127.0.0.1:4321/artifacts/synthetic.glb?signature=never-log-this",
};

export function makeGlb(jsonOverride: Record<string, unknown> = {}): ArrayBuffer {
  const json = {
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: "VEC3" },
      { bufferView: 1, componentType: 5123, count: 36, type: "SCALAR" },
    ],
    asset: { generator: "C10 visibly synthetic fixture", version: "2.0" },
    bufferViews: [
      { buffer: 0, byteLength: 96, byteOffset: 0 },
      { buffer: 0, byteLength: 72, byteOffset: 96 },
    ],
    buffers: [{ byteLength: 168 }],
    materials: [{ name: "Synthetic neutral" }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    nodes: [{ children: [1] }, { mesh: 0 }],
    scene: 0,
    scenes: [{ nodes: [0] }],
    ...jsonOverride,
  };
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(encoded.byteLength / 4) * 4;
  const binaryLength = 168;
  const bytes = new Uint8Array(12 + 8 + jsonLength + 8 + binaryLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + jsonLength);
  bytes.set(encoded, 20);
  const binaryHeader = 20 + jsonLength;
  view.setUint32(binaryHeader, binaryLength, true);
  view.setUint32(binaryHeader + 4, 0x004e4942, true);
  return bytes.buffer;
}
