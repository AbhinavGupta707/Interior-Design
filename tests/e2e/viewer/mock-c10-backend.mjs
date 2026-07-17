import { createHash } from "node:crypto";
import http from "node:http";

const port = 4321;
const ids = Object.freeze({
  artifact: "b1000000-0000-4000-8000-000000000001",
  elementLevel: "b1000000-0000-4000-8000-000000000002",
  elementWall: "b1000000-0000-4000-8000-000000000003",
  job: "b1000000-0000-4000-8000-000000000004",
  model: "b1000000-0000-4000-8000-000000000005",
  owner: "b1000000-0000-4000-8000-000000000006",
  project: "b1000000-0000-4000-8000-000000000007",
  scene: "b1000000-0000-4000-8000-000000000008",
  snapshot: "b1000000-0000-4000-8000-000000000009",
  tenant: "b1000000-0000-4000-8000-000000000010",
  viewer: "b1000000-0000-4000-8000-000000000011",
});

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "number")
    return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function makeGlb() {
  const positions = new Float32Array([
    -1, 0, -1, 1, 0, -1, 1, 2, -1, -1, 2, -1, -1, 0, 1, 1, 0, 1, 1, 2, 1, -1, 2, 1,
  ]);
  const indices = new Uint16Array([
    0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 1, 5, 6, 1, 6, 2, 0, 3,
    7, 0, 7, 4,
  ]);
  const binary = Buffer.alloc(168);
  Buffer.from(positions.buffer).copy(binary, 0);
  Buffer.from(indices.buffer).copy(binary, 96);
  const json = {
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 8,
        max: [1, 2, 1],
        min: [-1, 0, -1],
        type: "VEC3",
      },
      { bufferView: 1, componentType: 5123, count: 36, type: "SCALAR" },
    ],
    asset: { generator: "C10 visibly synthetic fixture", version: "2.0" },
    bufferViews: [
      { buffer: 0, byteLength: 96, byteOffset: 0, target: 34962 },
      { buffer: 0, byteLength: 72, byteOffset: 96, target: 34963 },
    ],
    buffers: [{ byteLength: 168 }],
    materials: [
      {
        name: "Synthetic neutral",
        pbrMetallicRoughness: {
          baseColorFactor: [0.54, 0.66, 0.57, 1],
          metallicFactor: 0,
          roughnessFactor: 0.82,
        },
      },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    nodes: [
      {
        children: [1],
        extras: { canonicalElementId: ids.elementLevel },
        name: "Display name is not identity",
      },
      { extras: { canonicalElementId: ids.elementWall }, mesh: 0, name: "Duplicate display name" },
    ],
    scene: 0,
    scenes: [{ nodes: [0] }],
  };
  const jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
  const jsonLength = Math.ceil(jsonBytes.length / 4) * 4;
  const output = Buffer.alloc(12 + 8 + jsonLength + 8 + binary.length);
  output.writeUInt32LE(0x46546c67, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(jsonLength, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  output.fill(0x20, 20, 20 + jsonLength);
  jsonBytes.copy(output, 20);
  const binaryHeader = 20 + jsonLength;
  output.writeUInt32LE(binary.length, binaryHeader);
  output.writeUInt32LE(0x004e4942, binaryHeader + 4);
  binary.copy(output, binaryHeader + 8);
  return output;
}

const glb = makeGlb();
const glbSha256 = sha256(glb);
const sourceSnapshot = Object.freeze({
  modelId: ids.model,
  profile: "existing",
  projectId: ids.project,
  schemaVersion: "c4-canonical-home-v1",
  snapshotId: ids.snapshot,
  snapshotSha256: "a".repeat(64),
});
const configuration = Object.freeze({
  coordinateMapping: "c4-z-up-to-gltf-y-up-v1",
  geometryMode: "parametric-v1",
  materialMode: "status-aware-neutral-v1",
  purpose: "interactive-browser",
  unknownGeometryPolicy: "omit-and-report",
});
const baseManifest = Object.freeze({
  authority: "derived-visualisation-only",
  boundsMm: {
    maximum: { xMm: 5_000, yMm: 4_000, zMm: 2_700 },
    minimum: { xMm: 0, yMm: 0, zMm: 0 },
  },
  compiler: {
    configuration,
    configurationSha256: "b".repeat(64),
    name: "interior-design-scene-compiler",
    version: "fixture-only-1.0.0",
  },
  coordinateSystem: {
    canonicalAxes: "+X east, +Y north, +Z up",
    gltfAxes: "+Y up, +Z forward, right-handed",
    mapping: "[Xmm/1000, Zmm/1000, -Ymm/1000]",
    outputLengthUnit: "metre",
  },
  counts: { materials: 1, meshes: 1, nodes: 2, triangles: 12, vertices: 8 },
  determinismKeySha256: "c".repeat(64),
  elementMappings: [
    {
      elementId: ids.elementLevel,
      elementType: "level",
      findingCodes: [],
      materialIndices: [],
      meshIndices: [],
      nodeIndices: [0],
      status: "mapped",
    },
    {
      elementId: ids.elementWall,
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
      affectedElementIds: [ids.elementWall],
      code: "SYNTHETIC_FIXTURE_ONLY",
      detail: "This GLB is synthetic fixture presentation evidence only.",
      severity: "information",
    },
  ],
  gltf: { container: "GLB", specificationVersion: "2.0" },
  schemaVersion: "c10-scene-manifest-v1",
  sourceSnapshot,
});

let scenario = "succeeded";

function role(request) {
  const authorization = request.headers.authorization ?? "";
  return authorization.includes("viewer-token") ? "viewer" : "owner";
}

function foreign(request) {
  return (request.headers.authorization ?? "").includes("foreign-token");
}

function manifest() {
  return scenario === "over-budget"
    ? { ...baseManifest, counts: { ...baseManifest.counts, triangles: 750_001 } }
    : baseManifest;
}

function job(state = scenario) {
  const normalized = [
    "queued",
    "leased",
    "compiling",
    "publishing",
    "cancel-requested",
    "cancelled",
    "failed",
    "succeeded",
  ].includes(state)
    ? state
    : "succeeded";
  return {
    attempt: normalized === "failed" || normalized === "cancelled" ? 2 : 1,
    createdAt: "2026-07-17T20:00:00.000Z",
    createdBy: ids.owner,
    id: ids.job,
    projectId: ids.project,
    request: { configuration, label: "Synthetic compact two-level home", sourceSnapshot },
    ...(normalized === "failed" ? { safeCode: "SCENE_COMPILER_FAILED" } : {}),
    ...(normalized === "succeeded" ? { sceneId: ids.scene } : {}),
    state: normalized,
    updatedAt: "2026-07-17T20:01:00.000Z",
    version: 1,
  };
}

function sceneRecord() {
  const nextManifest = manifest();
  return {
    artifact: {
      byteSize: glb.length,
      glbSha256,
      id: ids.artifact,
      manifestSha256: sha256(Buffer.from(canonicalJson(nextManifest), "utf8")),
      mimeType: "model/gltf-binary",
      schemaVersion: "c10-scene-artifact-v1",
    },
    createdAt: "2026-07-17T20:01:00.000Z",
    createdBy: ids.owner,
    id: ids.scene,
    manifest: nextManifest,
    projectId: ids.project,
  };
}

function json(response, status = 200) {
  return {
    body: JSON.stringify(response),
    headers: { "cache-control": "no-store", "content-type": "application/json" },
    status,
  };
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"status":"ok"}');
    return;
  }
  if (url.pathname === "/__scenario") {
    scenario = url.searchParams.get("value") ?? "succeeded";
    response.writeHead(204);
    response.end();
    return;
  }
  if (url.pathname === "/artifacts/scene.glb") {
    const type = scenario === "content-type-mismatch" ? "text/html" : "model/gltf-binary";
    const bytes =
      scenario === "glb-hash-mismatch"
        ? Buffer.from(glb.map((byte, index) => (index === glb.length - 1 ? byte ^ 1 : byte)))
        : glb;
    response.writeHead(200, {
      "access-control-allow-origin": "http://127.0.0.1:4320",
      "cache-control": "no-store",
      "content-length": String(bytes.length),
      "content-type": type,
      "x-content-type-options": "nosniff",
    });
    response.end(bytes);
    return;
  }

  const route = url.pathname;
  let result;
  if (route === "/v1/session") {
    const actorRole = role(request);
    result = json({
      actor: {
        displayName: actorRole === "viewer" ? "Synthetic C10 viewer" : "Synthetic C10 owner",
        role: actorRole,
        subject: `fixture:c10-${actorRole}`,
        tenantId: ids.tenant,
        userId: actorRole === "viewer" ? ids.viewer : ids.owner,
      },
      authMode: "local-fixture",
      expiresAt: "2099-07-17T20:00:00.000Z",
    });
  } else if (foreign(request)) {
    result = json(
      { detail: "Not found", status: 404, title: "Not found", type: "about:blank" },
      404,
    );
  } else if (route === `/v1/projects/${ids.project}`) {
    result = json({
      createdAt: "2026-07-17T20:00:00.000Z",
      id: ids.project,
      name: "Synthetic C10 walkthrough",
      status: "active",
      tenantId: ids.tenant,
      updatedAt: "2026-07-17T20:00:00.000Z",
      version: 1,
    });
  } else if (route === `/v1/projects/${ids.project}/models`) {
    result = json({
      profiles: [
        {
          currentSnapshotId: ids.snapshot,
          currentSnapshotSha256: sourceSnapshot.snapshotSha256,
          modelId: ids.model,
          profile: "existing",
          status: "available",
          updatedAt: "2026-07-17T20:00:00.000Z",
          version: 1,
        },
        { profile: "proposed", status: "empty" },
        { profile: "as-built", status: "empty" },
      ],
      projectId: ids.project,
    });
  } else if (route === `/v1/projects/${ids.project}/scene-jobs` && request.method === "GET") {
    result = json({ jobs: scenario === "empty" ? [] : [job()] });
  } else if (route === `/v1/projects/${ids.project}/scene-jobs` && request.method === "POST") {
    await body(request);
    result =
      role(request) === "viewer"
        ? json({ code: "FORBIDDEN", detail: "Viewer role is read-only.", status: 403 }, 403)
        : json(job("queued"), 201);
  } else if (route === `/v1/projects/${ids.project}/scene-jobs/${ids.job}`) {
    result = json(job());
  } else if (route === `/v1/projects/${ids.project}/scene-jobs/${ids.job}/cancel`) {
    await body(request);
    result =
      role(request) === "viewer"
        ? json({ code: "FORBIDDEN", detail: "Viewer role is read-only.", status: 403 }, 403)
        : json(job("cancel-requested"));
  } else if (route === `/v1/projects/${ids.project}/scene-jobs/${ids.job}/retry`) {
    await body(request);
    result =
      role(request) === "viewer"
        ? json({ code: "FORBIDDEN", detail: "Viewer role is read-only.", status: 403 }, 403)
        : json({ ...job("queued"), attempt: 2, version: 2 });
  } else if (route === `/v1/projects/${ids.project}/scene-jobs/${ids.job}/scene`) {
    result = json(sceneRecord());
  } else if (route === `/v1/projects/${ids.project}/scene-jobs/${ids.job}/scene/access`) {
    if (scenario === "expired") {
      result = json(
        { code: "SCENE_ACCESS_EXPIRED", detail: "Request fresh access.", status: 410 },
        410,
      );
    } else {
      const scene = sceneRecord();
      result = json({
        byteSize: scene.artifact.byteSize,
        expiresAt: "2099-07-17T20:10:00.000Z",
        glbSha256: scenario === "tuple-mismatch" ? "f".repeat(64) : scene.artifact.glbSha256,
        manifestSha256: scene.artifact.manifestSha256,
        mimeType: "model/gltf-binary",
        sceneId: scene.id,
        url: `http://127.0.0.1:${port}/artifacts/scene.glb?signature=ephemeral-fixture`,
      });
    }
  } else {
    result = json({ detail: "Not found", status: 404 }, 404);
  }
  response.writeHead(result.status, result.headers);
  response.end(result.body);
});

server.listen(port, "127.0.0.1");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
