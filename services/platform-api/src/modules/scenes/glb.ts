import {
  c10ScenePolicy,
  sceneManifestSchema,
  type SceneManifest,
} from "@interior-design/contracts";
import { createHash } from "node:crypto";

import { requestHash } from "../projects/idempotency.js";
import { sceneInvalid } from "./errors.js";
import type { SceneCompilerDescriptor } from "./types.js";

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const FLOAT = 5126;
const INDEX_COMPONENT_TYPES = new Set([5121, 5123, 5125]);
const MAX_JSON_VALUES = 1_000_000;
const MAX_JSON_DEPTH = 128;

interface GltfAccessor {
  readonly bufferView?: unknown;
  readonly byteOffset?: unknown;
  readonly componentType?: unknown;
  readonly count?: unknown;
  readonly sparse?: unknown;
  readonly type?: unknown;
}

interface GltfPrimitive {
  readonly attributes?: unknown;
  readonly indices?: unknown;
  readonly material?: unknown;
  readonly mode?: unknown;
}

interface GltfDocument {
  readonly accessors?: unknown;
  readonly asset?: unknown;
  readonly buffers?: unknown;
  readonly bufferViews?: unknown;
  readonly extensionsRequired?: unknown;
  readonly images?: unknown;
  readonly materials?: unknown;
  readonly meshes?: unknown;
  readonly nodes?: unknown;
  readonly scene?: unknown;
  readonly scenes?: unknown;
}

interface BufferViewInfo {
  readonly byteLength: number;
  readonly byteOffset: number;
  readonly byteStride: number | undefined;
}

interface AccessorInfo {
  readonly byteOffset: number;
  readonly componentOffsets: readonly number[];
  readonly componentSize: number;
  readonly componentType: number;
  readonly count: number;
  readonly elementSize: number;
  readonly stride: number;
  readonly type: string;
  readonly view: BufferViewInfo;
}

function fail(detail: string): never {
  throw sceneInvalid("SCENE_GLB_INVALID", detail);
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(`The GLB ${label} collection is missing or invalid.`);
  return value;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`The GLB ${label} value is invalid.`);
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail(`The GLB ${label} value is invalid.`);
  }
  return value as number;
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = integer(value, label);
  if (parsed < 1) fail(`The GLB ${label} value is invalid.`);
  return parsed;
}

function boundedDocumentWalk(value: unknown): void {
  const pending: { readonly depth: number; readonly value: unknown }[] = [{ depth: 0, value }];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    visited += 1;
    if (visited > MAX_JSON_VALUES || current.depth > MAX_JSON_DEPTH) {
      fail("The GLB JSON document exceeds bounded structural limits.");
    }
    if (typeof current.value === "number" && !Number.isFinite(current.value)) {
      fail("The GLB JSON document contains a non-finite number.");
    }
    if (current.value === null || typeof current.value !== "object") continue;
    if (Array.isArray(current.value)) {
      for (const entry of current.value) {
        pending.push({ depth: current.depth + 1, value: entry });
      }
      continue;
    }
    for (const [key, entry] of Object.entries(current.value)) {
      if (key === "uri") fail("Published GLB files cannot contain external or data URIs.");
      pending.push({ depth: current.depth + 1, value: entry });
    }
  }
}

function parseJsonChunk(bytes: Uint8Array): GltfDocument {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    let end = decoded.length;
    while (end > 0 && [0, 32].includes(decoded.charCodeAt(end - 1))) end -= 1;
    const text = decoded.slice(0, end);
    const parsed = JSON.parse(text) as unknown;
    return object(parsed, "JSON document");
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "ApiError") throw error;
    fail("The GLB JSON chunk is not bounded valid UTF-8 JSON.");
  }
}

function componentLayout(
  type: string,
  componentSize: number,
): {
  readonly elementSize: number;
  readonly offsets: readonly number[];
} {
  const dimensions: Readonly<Record<string, readonly [number, number]>> = {
    MAT2: [2, 2],
    MAT3: [3, 3],
    MAT4: [4, 4],
    SCALAR: [1, 1],
    VEC2: [1, 2],
    VEC3: [1, 3],
    VEC4: [1, 4],
  };
  const dimension = dimensions[type];
  if (dimension === undefined) fail("The GLB accessor type is unsupported or invalid.");
  const [columns, rows] = dimension;
  const unalignedColumnSize = rows * componentSize;
  const columnSize = columns === 1 ? unalignedColumnSize : (unalignedColumnSize + 3) & ~3;
  const offsets: number[] = [];
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      offsets.push(column * columnSize + row * componentSize);
    }
  }
  return { elementSize: columnSize * columns, offsets };
}

function parseBufferViews(
  document: GltfDocument,
  binary: Uint8Array | undefined,
): {
  readonly accessors: readonly AccessorInfo[];
  readonly data: DataView;
} {
  const buffers = array(document.buffers ?? [], "buffers");
  const bufferViews = array(document.bufferViews ?? [], "bufferViews");
  const accessorValues = array(document.accessors ?? [], "accessors");
  if (buffers.length > 1) fail("Published GLB files must contain at most one binary buffer.");
  if (buffers.length === 0) {
    if (binary !== undefined || bufferViews.length > 0 || accessorValues.length > 0) {
      fail("The GLB binary chunk, buffer views and accessors are inconsistent.");
    }
    return { accessors: [], data: new DataView(new ArrayBuffer(0)) };
  }
  if (binary === undefined) fail("The GLB declares a buffer but has no binary chunk.");
  const declaredByteLength = integer(
    object(buffers[0], "buffer 0").byteLength,
    "buffer byteLength",
  );
  if (declaredByteLength > binary.byteLength || binary.byteLength - declaredByteLength > 3) {
    fail("The GLB binary chunk does not match its declared buffer length.");
  }
  for (let index = declaredByteLength; index < binary.byteLength; index += 1) {
    if (binary[index] !== 0) fail("The GLB binary padding is invalid.");
  }
  const views = bufferViews.map((value, index): BufferViewInfo => {
    const view = object(value, `bufferView ${String(index)}`);
    if (integer(view.buffer, "bufferView buffer") !== 0) {
      fail("Published GLB buffer views must use the embedded buffer.");
    }
    const byteOffset = integer(view.byteOffset ?? 0, "bufferView byteOffset");
    const byteLength = positiveInteger(view.byteLength, "bufferView byteLength");
    if (byteOffset + byteLength > declaredByteLength) {
      fail("A GLB buffer view exceeds the embedded binary buffer.");
    }
    const byteStride =
      view.byteStride === undefined
        ? undefined
        : positiveInteger(view.byteStride, "bufferView byteStride");
    if (byteStride !== undefined && (byteStride < 4 || byteStride > 252 || byteStride % 4 !== 0)) {
      fail("A GLB buffer view has an invalid byte stride.");
    }
    if (view.target !== undefined && ![34962, 34963].includes(integer(view.target, "target"))) {
      fail("A GLB buffer view has an unsupported target.");
    }
    return { byteLength, byteOffset, byteStride };
  });
  const componentSizes: Readonly<Record<number, number>> = {
    5120: 1,
    5121: 1,
    5122: 2,
    5123: 2,
    5125: 4,
    5126: 4,
  };
  const accessors = accessorValues.map((value, index): AccessorInfo => {
    const accessor = object(value, `accessor ${String(index)}`) as GltfAccessor;
    if (accessor.sparse !== undefined) {
      fail("Sparse GLB accessors are outside the reviewed scene profile.");
    }
    const viewIndex = integer(accessor.bufferView, "accessor bufferView");
    const view = views[viewIndex];
    if (view === undefined) fail("A GLB accessor references a missing buffer view.");
    const componentType = integer(accessor.componentType, "accessor componentType");
    const componentSize = componentSizes[componentType];
    if (componentSize === undefined) fail("A GLB accessor has an unsupported component type.");
    if (typeof accessor.type !== "string") fail("A GLB accessor type is missing or invalid.");
    const layout = componentLayout(accessor.type, componentSize);
    const byteOffset = integer(accessor.byteOffset ?? 0, "accessor byteOffset");
    const absoluteOffset = view.byteOffset + byteOffset;
    if (absoluteOffset % componentSize !== 0) {
      fail("A GLB accessor is not aligned to its component size.");
    }
    const count = positiveInteger(accessor.count, "accessor count");
    if (count > c10ScenePolicy.maximumTriangles * 3) {
      fail("A GLB accessor exceeds the frozen scene count limit.");
    }
    const stride = view.byteStride ?? layout.elementSize;
    if (stride < layout.elementSize) fail("A GLB accessor stride is smaller than one element.");
    const finalByte = byteOffset + (count - 1) * stride + layout.elementSize;
    if (finalByte > view.byteLength || !Number.isSafeInteger(finalByte)) {
      fail("A GLB accessor exceeds its buffer view.");
    }
    return {
      byteOffset,
      componentOffsets: layout.offsets,
      componentSize,
      componentType,
      count,
      elementSize: layout.elementSize,
      stride,
      type: accessor.type,
      view,
    };
  });
  const data = new DataView(binary.buffer, binary.byteOffset, declaredByteLength);
  for (const accessor of accessors) {
    if (accessor.componentType !== FLOAT) continue;
    for (let element = 0; element < accessor.count; element += 1) {
      const elementOffset =
        accessor.view.byteOffset + accessor.byteOffset + element * accessor.stride;
      for (const componentOffset of accessor.componentOffsets) {
        if (!Number.isFinite(data.getFloat32(elementOffset + componentOffset, true))) {
          fail("A GLB floating-point accessor contains NaN or infinity.");
        }
      }
    }
  }
  return { accessors, data };
}

function accessor(accessors: readonly AccessorInfo[], index: unknown, label: string): AccessorInfo {
  const accessorIndex = integer(index, `${label} accessor index`);
  const result = accessors[accessorIndex];
  if (result === undefined) fail(`The GLB ${label} references a missing accessor.`);
  return result;
}

function indexValue(data: DataView, info: AccessorInfo, index: number): number {
  const offset = info.view.byteOffset + info.byteOffset + index * info.stride;
  if (info.componentType === 5121) return data.getUint8(offset);
  if (info.componentType === 5123) return data.getUint16(offset, true);
  if (info.componentType === 5125) return data.getUint32(offset, true);
  fail("A GLB index accessor has an invalid component type.");
}

function independentCounts(
  document: GltfDocument,
  binary: Uint8Array | undefined,
  manifest: SceneManifest,
): SceneManifest["counts"] {
  const parsed = parseBufferViews(document, binary);
  const accessors = parsed.accessors;
  const materials = array(document.materials ?? [], "materials");
  const meshes = array(document.meshes ?? [], "meshes");
  const nodes = array(document.nodes ?? [], "nodes");
  let triangles = 0;
  let vertices = 0;
  for (const [meshIndex, meshValue] of meshes.entries()) {
    const mesh = object(meshValue, `mesh ${String(meshIndex)}`);
    const primitives = array(mesh.primitives, `mesh ${String(meshIndex)} primitives`);
    for (const [primitiveIndex, primitiveValue] of primitives.entries()) {
      const primitive = object(
        primitiveValue,
        `mesh ${String(meshIndex)} primitive ${String(primitiveIndex)}`,
      ) as GltfPrimitive;
      if (primitive.mode !== undefined && primitive.mode !== 4) {
        fail("Only triangle-list GLB primitives may be published.");
      }
      const attributes = object(primitive.attributes, "primitive attributes");
      const position = accessor(accessors, attributes.POSITION, "POSITION");
      if (position.componentType !== FLOAT || position.type !== "VEC3") {
        fail("The GLB POSITION accessor must contain three-component float vertices.");
      }
      for (let vertex = 0; vertex < position.count; vertex += 1) {
        const vertexOffset =
          position.view.byteOffset + position.byteOffset + vertex * position.stride;
        for (const componentOffset of position.componentOffsets) {
          if (Math.abs(parsed.data.getFloat32(vertexOffset + componentOffset, true)) > 10_000) {
            fail("A GLB position exceeds the canonical coordinate bounds.");
          }
        }
      }
      for (const [semantic, accessorIndex] of Object.entries(attributes)) {
        if (accessor(accessors, accessorIndex, semantic).count !== position.count) {
          fail("Every GLB vertex attribute must match the POSITION vertex count.");
        }
      }
      const indices =
        primitive.indices === undefined
          ? undefined
          : accessor(accessors, primitive.indices, "indices");
      if (
        indices !== undefined &&
        (indices.type !== "SCALAR" || !INDEX_COMPONENT_TYPES.has(indices.componentType))
      ) {
        fail("A GLB index accessor must contain unsigned scalar indices.");
      }
      const indexCount = indices?.count ?? position.count;
      if (indexCount % 3 !== 0) fail("A triangle-list GLB index count is not divisible by three.");
      if (indices !== undefined) {
        for (let index = 0; index < indices.count; index += 1) {
          if (indexValue(parsed.data, indices, index) >= position.count) {
            fail("A GLB primitive index is outside its POSITION accessor.");
          }
        }
      }
      if (
        primitive.material !== undefined &&
        integer(primitive.material, "primitive material") >= materials.length
      ) {
        fail("A GLB primitive references a missing material.");
      }
      vertices += position.count;
      triangles += indexCount / 3;
      if (
        vertices > c10ScenePolicy.maximumVertices ||
        triangles > c10ScenePolicy.maximumTriangles
      ) {
        fail("The GLB geometry exceeds the frozen public scene limits.");
      }
    }
  }
  for (const [nodeIndex, value] of nodes.entries()) {
    const node = object(value, `node ${String(nodeIndex)}`);
    if (node.mesh !== undefined && integer(node.mesh, "node mesh") >= meshes.length) {
      fail("A GLB node references a missing mesh.");
    }
    if (node.children !== undefined) {
      for (const child of array(node.children, "node children")) {
        if (integer(child, "node child") >= nodes.length) {
          fail("A GLB node references a missing child node.");
        }
      }
    }
  }
  for (const mapping of manifest.elementMappings) {
    for (const nodeIndex of mapping.nodeIndices) {
      const node = object(nodes[nodeIndex], `mapped node ${String(nodeIndex)}`);
      const extras = object(node.extras, `mapped node ${String(nodeIndex)} extras`);
      if (extras.canonicalElementId !== mapping.elementId) {
        fail("A mapped GLB node does not carry its stable canonical element ID.");
      }
    }
  }
  return {
    materials: materials.length,
    meshes: meshes.length,
    nodes: nodes.length,
    triangles,
    vertices,
  };
}

export interface VerifiedGlb {
  readonly byteSize: number;
  readonly glbSha256: string;
}

export function verifyGlb(bytes: Uint8Array, manifest: SceneManifest): VerifiedGlb {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 20) {
    fail("A published scene must contain real GLB bytes.");
  }
  if (bytes.byteLength > c10ScenePolicy.maximumArtifactBytes) {
    fail("The GLB exceeds the frozen public artifact limit.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== GLB_VERSION) {
    fail("The scene artifact is not a GLB 2.0 container.");
  }
  if (view.getUint32(8, true) !== bytes.byteLength) {
    fail("The GLB declared byte length does not match the uploaded bytes.");
  }

  let offset = 12;
  let jsonDocument: GltfDocument | undefined;
  let binaryChunk: Uint8Array | undefined;
  let chunkCount = 0;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) fail("The GLB contains a truncated chunk header.");
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    offset += 8;
    if (chunkLength % 4 !== 0 || offset + chunkLength > bytes.byteLength) {
      fail("The GLB contains a misaligned or truncated chunk.");
    }
    const chunk = bytes.subarray(offset, offset + chunkLength);
    if (chunkCount === 0 && chunkType !== JSON_CHUNK) {
      fail("The first GLB chunk must be JSON.");
    }
    if (chunkType === JSON_CHUNK) {
      if (jsonDocument !== undefined) fail("The GLB contains more than one JSON chunk.");
      jsonDocument = parseJsonChunk(chunk);
    } else if (chunkType === BIN_CHUNK) {
      if (binaryChunk !== undefined) fail("The GLB contains more than one binary chunk.");
      binaryChunk = chunk;
    } else {
      fail("The GLB contains an unsupported chunk type.");
    }
    chunkCount += 1;
    offset += chunkLength;
  }
  if (offset !== bytes.byteLength || jsonDocument === undefined || chunkCount > 2) {
    fail("The GLB chunk structure is invalid.");
  }
  const asset = object(jsonDocument.asset, "asset");
  if (asset.version !== "2.0") fail("The GLB asset version must be exactly 2.0.");
  boundedDocumentWalk(jsonDocument);
  if (
    jsonDocument.extensionsRequired !== undefined &&
    array(jsonDocument.extensionsRequired, "extensionsRequired").length > 0
  ) {
    fail("Published GLB files cannot require unreviewed extensions.");
  }
  if (array(jsonDocument.images ?? [], "images").length > 0) {
    fail("Published C10 GLB files cannot embed unreviewed image content.");
  }
  const counts = independentCounts(jsonDocument, binaryChunk, manifest);
  for (const key of Object.keys(counts) as (keyof typeof counts)[]) {
    if (counts[key] !== manifest.counts[key]) {
      fail(`The GLB ${key} count does not match the immutable manifest.`);
    }
  }
  return {
    byteSize: bytes.byteLength,
    glbSha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function configurationSha256(
  configuration: SceneManifest["compiler"]["configuration"],
): string {
  return requestHash(configuration);
}

export function sceneDeterminismKey(input: {
  readonly compiler: SceneCompilerDescriptor;
  readonly configurationSha256: string;
  readonly snapshotSha256: string;
}): string {
  return requestHash({
    compiler: input.compiler,
    configurationSha256: input.configurationSha256,
    snapshotSha256: input.snapshotSha256,
  });
}

export function manifestSha256(manifest: SceneManifest): string {
  return requestHash(sceneManifestSchema.parse(manifest));
}
