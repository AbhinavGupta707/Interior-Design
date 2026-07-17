import type {
  SceneAccessResponse,
  SceneJob,
  SceneManifest,
  SceneRecord,
} from "@interior-design/contracts";

export const c10ClientSceneBudget = Object.freeze({
  byteSize: 20 * 1024 * 1024,
  nodes: 5_000,
  triangles: 750_000,
  vertices: 1_500_000,
});

export type SceneIntegrityCode =
  | "ACCESS_EXPIRED"
  | "ACTIVE_CONTENT"
  | "CONTENT_LENGTH_MISMATCH"
  | "CONTENT_TYPE_MISMATCH"
  | "EXTERNAL_URI"
  | "GLB_HASH_MISMATCH"
  | "GLB_INVALID"
  | "MANIFEST_HASH_MISMATCH"
  | "MANIFEST_SEMANTICS_MISMATCH"
  | "OVER_CLIENT_BUDGET"
  | "SCENE_TUPLE_MISMATCH"
  | "UNSUPPORTED_REQUIRED_EXTENSION";

export class SceneIntegrityError extends Error {
  constructor(
    readonly code: SceneIntegrityCode,
    message: string,
  ) {
    super(message);
    this.name = "SceneIntegrityError";
  }
}

export interface VerifiedGlb {
  readonly bytes: ArrayBuffer;
  readonly json: Readonly<Record<string, unknown>>;
}

export interface SceneLoadProgress {
  readonly loadedBytes: number;
  readonly phase: "downloading" | "inspecting" | "verifying";
  readonly totalBytes: number;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  throw new SceneIntegrityError("MANIFEST_HASH_MISMATCH", "The manifest is not canonical JSON.");
}

export async function sha256Hex(value: ArrayBuffer | string): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sameSource(
  left: SceneJob["request"]["sourceSnapshot"],
  right: SceneManifest["sourceSnapshot"],
): boolean {
  return (
    left.modelId === right.modelId &&
    left.profile === right.profile &&
    left.projectId === right.projectId &&
    left.snapshotId === right.snapshotId &&
    left.snapshotSha256 === right.snapshotSha256
  );
}

export async function verifySceneTuple(
  job: SceneJob,
  scene: SceneRecord,
  access: SceneAccessResponse,
  now = Date.now(),
): Promise<void> {
  await verifySceneRecord(job, scene);
  if (
    access.sceneId !== scene.id ||
    access.byteSize !== scene.artifact.byteSize ||
    access.glbSha256 !== scene.artifact.glbSha256 ||
    access.manifestSha256 !== scene.artifact.manifestSha256
  ) {
    throw new SceneIntegrityError(
      "SCENE_TUPLE_MISMATCH",
      "The short-lived access grant does not match the immutable scene artifact.",
    );
  }
  if (Date.parse(access.expiresAt) <= now + 1_000) {
    throw new SceneIntegrityError(
      "ACCESS_EXPIRED",
      "The short-lived scene access expired before the artifact could be verified.",
    );
  }
}

export async function verifySceneRecord(job: SceneJob, scene: SceneRecord): Promise<void> {
  if (
    job.state !== "succeeded" ||
    job.sceneId !== scene.id ||
    job.projectId !== scene.projectId ||
    !sameSource(job.request.sourceSnapshot, scene.manifest.sourceSnapshot)
  ) {
    throw new SceneIntegrityError(
      "SCENE_TUPLE_MISMATCH",
      "The job, scene and exact source snapshot do not match.",
    );
  }
  const manifestSha256 = await sha256Hex(canonicalJson(scene.manifest));
  if (manifestSha256 !== scene.artifact.manifestSha256) {
    throw new SceneIntegrityError(
      "MANIFEST_HASH_MISMATCH",
      "The immutable scene manifest checksum does not match its artifact record.",
    );
  }
}

export function assertWithinClientBudget(manifest: SceneManifest, byteSize: number): void {
  if (
    byteSize > c10ClientSceneBudget.byteSize ||
    manifest.counts.nodes > c10ClientSceneBudget.nodes ||
    manifest.counts.triangles > c10ClientSceneBudget.triangles ||
    manifest.counts.vertices > c10ClientSceneBudget.vertices
  ) {
    throw new SceneIntegrityError(
      "OVER_CLIENT_BUDGET",
      "This scene exceeds the interactive device budget; the exact DOM summary remains available.",
    );
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function rejectUnsafeJson(value: unknown): void {
  const queue: unknown[] = [value];
  while (queue.length > 0) {
    const next = queue.pop();
    if (Array.isArray(next)) {
      for (const entry of next as unknown[]) queue.push(entry);
      continue;
    }
    const object = record(next);
    if (!object) continue;
    for (const [key, entry] of Object.entries(object)) {
      if (key === "uri" && typeof entry === "string") {
        throw new SceneIntegrityError(
          "EXTERNAL_URI",
          "Published GLB scenes cannot reference an external or data URI.",
        );
      }
      if (
        typeof entry === "string" &&
        /(?:<script|javascript:|text\/html|image\/svg\+xml|application\/xhtml\+xml)/iu.test(entry)
      ) {
        throw new SceneIntegrityError(
          "ACTIVE_CONTENT",
          "The GLB contains a scriptable or active-content marker.",
        );
      }
      queue.push(entry);
    }
  }
}

function primitiveTriangleCount(primitive: Record<string, unknown>, accessors: unknown[]): number {
  const attributes = record(primitive.attributes);
  const positionIndex = integer(attributes?.POSITION);
  const positionAccessor =
    positionIndex === undefined ? undefined : record(accessors[positionIndex]);
  const vertexCount = integer(positionAccessor?.count);
  if (vertexCount === undefined) {
    throw new SceneIntegrityError(
      "MANIFEST_SEMANTICS_MISMATCH",
      "Every scene primitive requires a bounded POSITION accessor.",
    );
  }
  const indicesIndex = integer(primitive.indices);
  const indicesAccessor = indicesIndex === undefined ? undefined : record(accessors[indicesIndex]);
  const indexCount = indicesIndex === undefined ? vertexCount : integer(indicesAccessor?.count);
  if (indexCount === undefined) {
    throw new SceneIntegrityError(
      "MANIFEST_SEMANTICS_MISMATCH",
      "The scene index accessor is missing or unbounded.",
    );
  }
  const mode = integer(primitive.mode) ?? 4;
  if (mode === 4) return Math.floor(indexCount / 3);
  if (mode === 5 || mode === 6) return Math.max(0, indexCount - 2);
  throw new SceneIntegrityError(
    "MANIFEST_SEMANTICS_MISMATCH",
    "The interactive scene contains a non-triangle primitive mode.",
  );
}

function assertManifestSemantics(json: Record<string, unknown>, manifest: SceneManifest): void {
  const asset = record(json.asset);
  if (asset?.version !== "2.0") {
    throw new SceneIntegrityError("GLB_INVALID", "The artifact is not a glTF 2.0 scene.");
  }
  const requiredExtensions = array(json.extensionsRequired);
  if (requiredExtensions.length > 0) {
    throw new SceneIntegrityError(
      "UNSUPPORTED_REQUIRED_EXTENSION",
      "The scene requires an extension outside the frozen browser profile.",
    );
  }
  rejectUnsafeJson(json);
  const nodes = array(json.nodes);
  const meshes = array(json.meshes);
  const materials = array(json.materials);
  const accessors = array(json.accessors);
  let vertices = 0;
  let triangles = 0;
  for (const mesh of meshes) {
    const primitives = array(record(mesh)?.primitives);
    for (const primitiveValue of primitives) {
      const primitive = record(primitiveValue);
      if (!primitive) {
        throw new SceneIntegrityError("GLB_INVALID", "The scene contains a malformed primitive.");
      }
      const positionIndex = integer(record(primitive.attributes)?.POSITION);
      const count =
        positionIndex === undefined ? undefined : integer(record(accessors[positionIndex])?.count);
      if (count === undefined) {
        throw new SceneIntegrityError(
          "MANIFEST_SEMANTICS_MISMATCH",
          "The scene vertex accessor is missing or unbounded.",
        );
      }
      vertices += count;
      triangles += primitiveTriangleCount(primitive, accessors);
    }
  }
  if (
    nodes.length !== manifest.counts.nodes ||
    meshes.length !== manifest.counts.meshes ||
    materials.length !== manifest.counts.materials ||
    vertices !== manifest.counts.vertices ||
    triangles !== manifest.counts.triangles
  ) {
    throw new SceneIntegrityError(
      "MANIFEST_SEMANTICS_MISMATCH",
      "The GLB structure does not match the immutable manifest counts.",
    );
  }
}

export function inspectGlb(bytes: ArrayBuffer, manifest: SceneManifest): VerifiedGlb {
  if (bytes.byteLength < 20) {
    throw new SceneIntegrityError("GLB_INVALID", "The GLB is too short to contain its header.");
  }
  const view = new DataView(bytes);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    throw new SceneIntegrityError("GLB_INVALID", "The artifact has an invalid GLB header.");
  }
  if (view.getUint32(8, true) !== bytes.byteLength) {
    throw new SceneIntegrityError(
      "GLB_INVALID",
      "The GLB declared length does not match its bytes.",
    );
  }
  let offset = 12;
  let json: Record<string, unknown> | undefined;
  let binaryChunks = 0;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) {
      throw new SceneIntegrityError("GLB_INVALID", "The GLB contains a truncated chunk header.");
    }
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + length;
    if (length % 4 !== 0 || end > bytes.byteLength) {
      throw new SceneIntegrityError("GLB_INVALID", "The GLB contains an invalid aligned chunk.");
    }
    if (type === 0x4e4f534a && json === undefined && offset === 12) {
      const text = new TextDecoder("utf-8", { fatal: true })
        .decode(new Uint8Array(bytes, start, length))
        .trimEnd();
      const parsed: unknown = JSON.parse(text);
      json = record(parsed);
      if (!json) {
        throw new SceneIntegrityError("GLB_INVALID", "The GLB JSON chunk is not an object.");
      }
    } else if (type === 0x004e4942 && json !== undefined && binaryChunks === 0) {
      binaryChunks += 1;
    } else {
      throw new SceneIntegrityError("GLB_INVALID", "The GLB contains an unexpected chunk.");
    }
    offset = end;
  }
  if (!json || binaryChunks !== 1 || offset !== bytes.byteLength) {
    throw new SceneIntegrityError("GLB_INVALID", "The GLB requires one JSON and one binary chunk.");
  }
  assertManifestSemantics(json, manifest);
  return { bytes, json };
}

async function responseBytes(
  response: Response,
  expectedBytes: number,
  onProgress?: (progress: SceneLoadProgress) => void,
): Promise<ArrayBuffer> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) !== expectedBytes) {
    throw new SceneIntegrityError(
      "CONTENT_LENGTH_MISMATCH",
      "The scene response length does not match the checksum-bound access grant.",
    );
  }
  if (!response.body) {
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== expectedBytes) {
      throw new SceneIntegrityError(
        "CONTENT_LENGTH_MISMATCH",
        "The scene response length does not match the checksum-bound access grant.",
      );
    }
    onProgress?.({
      loadedBytes: bytes.byteLength,
      phase: "downloading",
      totalBytes: expectedBytes,
    });
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loadedBytes = 0;
  let finished = false;
  while (!finished) {
    const { done, value } = await reader.read();
    if (done) {
      finished = true;
      continue;
    }
    loadedBytes += value.byteLength;
    if (loadedBytes > expectedBytes) {
      await reader.cancel();
      throw new SceneIntegrityError(
        "CONTENT_LENGTH_MISMATCH",
        "The scene response exceeded the checksum-bound byte length.",
      );
    }
    chunks.push(value);
    onProgress?.({ loadedBytes, phase: "downloading", totalBytes: expectedBytes });
  }
  if (loadedBytes !== expectedBytes) {
    throw new SceneIntegrityError(
      "CONTENT_LENGTH_MISMATCH",
      "The scene response ended before the checksum-bound byte length.",
    );
  }
  const combined = new Uint8Array(loadedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined.buffer;
}

export async function fetchVerifiedGlb(
  access: SceneAccessResponse,
  manifest: SceneManifest,
  options: {
    readonly onProgress?: (progress: SceneLoadProgress) => void;
    readonly transport?: typeof fetch;
  } = {},
): Promise<VerifiedGlb> {
  assertWithinClientBudget(manifest, access.byteSize);
  let response: Response;
  try {
    response = await (options.transport ?? fetch)(access.url, {
      cache: "no-store",
      credentials: "omit",
      headers: { accept: "model/gltf-binary" },
      redirect: "error",
    });
  } catch {
    throw new SceneIntegrityError(
      "ACCESS_EXPIRED",
      "The short-lived scene artifact could not be reached. Request fresh access and retry.",
    );
  }
  if (!response.ok) {
    throw new SceneIntegrityError(
      "ACCESS_EXPIRED",
      "The short-lived scene artifact is unavailable. Request fresh access and retry.",
    );
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "model/gltf-binary") {
    throw new SceneIntegrityError(
      "CONTENT_TYPE_MISMATCH",
      "The scene artifact did not use the required GLB content type.",
    );
  }
  const bytes = await responseBytes(response, access.byteSize, options.onProgress);
  options.onProgress?.({
    loadedBytes: bytes.byteLength,
    phase: "verifying",
    totalBytes: access.byteSize,
  });
  if ((await sha256Hex(bytes)) !== access.glbSha256) {
    throw new SceneIntegrityError(
      "GLB_HASH_MISMATCH",
      "The downloaded GLB checksum does not match the immutable artifact.",
    );
  }
  options.onProgress?.({
    loadedBytes: bytes.byteLength,
    phase: "inspecting",
    totalBytes: access.byteSize,
  });
  return inspectGlb(bytes, manifest);
}
