import { c10ScenePolicy } from "@interior-design/contracts";

import { SceneCompileError } from "./errors.js";
import type { ParsedGlb } from "./types.js";

const glbMagic = 0x46546c67;
const jsonChunkType = 0x4e4f534a;
const binaryChunkType = 0x004e4942;

function invalid(message: string): never {
  throw new SceneCompileError("GLB_INVALID", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function arrayMember(value: Record<string, unknown>, key: string): readonly unknown[] {
  const member = value[key];
  if (member === undefined) return [];
  if (!Array.isArray(member)) invalid(`glTF ${key} must be an array.`);
  return member;
}

function integerMember(value: Record<string, unknown>, key: string, defaultValue?: number): number {
  const member = value[key];
  if (member === undefined && defaultValue !== undefined) return defaultValue;
  if (!Number.isSafeInteger(member) || (member as number) < 0) {
    invalid(`glTF ${key} must be a non-negative safe integer.`);
  }
  return member as number;
}

function stringMember(value: Record<string, unknown>, key: string): string {
  const member = value[key];
  if (typeof member !== "string") invalid(`glTF ${key} must be a string.`);
  return member;
}

function componentByteSize(componentType: number): number {
  switch (componentType) {
    case 5_120:
    case 5_121:
      return 1;
    case 5_122:
    case 5_123:
      return 2;
    case 5_125:
    case 5_126:
      return 4;
    default:
      return invalid("glTF accessor uses an unsupported component type.");
  }
}

function componentCount(type: string): number {
  switch (type) {
    case "SCALAR":
      return 1;
    case "VEC2":
      return 2;
    case "VEC3":
      return 3;
    case "VEC4":
    case "MAT2":
      return 4;
    case "MAT3":
      return 9;
    case "MAT4":
      return 16;
    default:
      return invalid("glTF accessor uses an unsupported element type.");
  }
}

interface AccessorRange {
  readonly byteOffset: number;
  readonly byteStride: number;
  readonly componentCount: number;
  readonly componentType: number;
  readonly count: number;
}

function accessorRange(input: {
  readonly accessor: Record<string, unknown>;
  readonly binaryLength: number;
  readonly bufferViews: readonly unknown[];
}): AccessorRange {
  if (input.accessor.sparse !== undefined)
    invalid("Sparse accessors are not accepted for publication.");
  const bufferViewIndex = integerMember(input.accessor, "bufferView");
  const bufferView = input.bufferViews[bufferViewIndex];
  if (!isRecord(bufferView)) invalid("An accessor references a missing buffer view.");
  if (integerMember(bufferView, "buffer") !== 0)
    invalid("Only the internal GLB buffer is supported.");
  const viewOffset = integerMember(bufferView, "byteOffset", 0);
  const viewLength = integerMember(bufferView, "byteLength");
  if (viewLength <= 0 || viewOffset % 4 !== 0 || viewOffset + viewLength > input.binaryLength) {
    invalid("A buffer view is unaligned or outside the GLB binary chunk.");
  }
  const accessorOffset = integerMember(input.accessor, "byteOffset", 0);
  const componentType = integerMember(input.accessor, "componentType");
  const count = integerMember(input.accessor, "count");
  const components = componentCount(stringMember(input.accessor, "type"));
  const elementSize = componentByteSize(componentType) * components;
  const byteStride = integerMember(bufferView, "byteStride", elementSize);
  if (
    count <= 0 ||
    accessorOffset % componentByteSize(componentType) !== 0 ||
    byteStride < elementSize ||
    byteStride % componentByteSize(componentType) !== 0
  ) {
    invalid("An accessor has an invalid count, offset, or stride.");
  }
  const lastByte = accessorOffset + (count - 1) * byteStride + elementSize;
  if (lastByte > viewLength) invalid("An accessor exceeds its buffer view.");
  return {
    byteOffset: viewOffset + accessorOffset,
    byteStride,
    componentCount: components,
    componentType,
    count,
  };
}

function readUnsignedIndex(view: DataView, offset: number, componentType: number): number {
  switch (componentType) {
    case 5_121:
      return view.getUint8(offset);
    case 5_123:
      return view.getUint16(offset, true);
    case 5_125:
      return view.getUint32(offset, true);
    default:
      return invalid("Triangle indices must use an unsigned integer component type.");
  }
}

function validateNoExternalResources(json: Record<string, unknown>): void {
  const required = arrayMember(json, "extensionsRequired");
  if (required.length > 0) invalid("Required glTF extensions are not accepted for publication.");
  for (const buffer of arrayMember(json, "buffers")) {
    if (!isRecord(buffer) || buffer.uri !== undefined) {
      invalid("GLB buffers must be internal and cannot reference a URI.");
    }
  }
  for (const image of arrayMember(json, "images")) {
    if (!isRecord(image) || image.uri !== undefined) {
      invalid("Published GLB images cannot reference an external URI.");
    }
  }
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (key.toLowerCase() === "uri") invalid("Published GLB content cannot contain a URI field.");
      visit(child);
    }
  };
  visit(json);
}

export function parseGlb(bytes: Uint8Array): ParsedGlb {
  if (bytes.byteLength > c10ScenePolicy.maximumArtifactBytes) {
    invalid("GLB exceeds the frozen public artifact byte limit.");
  }
  if (bytes.byteLength < 20 || bytes.byteLength % 4 !== 0) {
    invalid("GLB length is too small or not four-byte aligned.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== glbMagic) invalid("GLB magic is invalid.");
  if (view.getUint32(4, true) !== 2) invalid("Only GLB version 2 is supported.");
  if (view.getUint32(8, true) !== bytes.byteLength)
    invalid("GLB declared length does not match its bytes.");

  let offset = 12;
  let jsonChunk: Uint8Array | undefined;
  let binaryChunk = new Uint8Array();
  let chunkIndex = 0;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) invalid("GLB has a truncated chunk header.");
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    if (chunkLength % 4 !== 0 || offset + 8 + chunkLength > bytes.byteLength) {
      invalid("GLB chunk length is unaligned or outside the container.");
    }
    const chunk = bytes.slice(offset + 8, offset + 8 + chunkLength);
    if (chunkIndex === 0) {
      if (chunkType !== jsonChunkType || chunkLength === 0)
        invalid("GLB must begin with one JSON chunk.");
      jsonChunk = chunk;
    } else if (chunkIndex === 1) {
      if (chunkType !== binaryChunkType) invalid("The optional second GLB chunk must be BIN data.");
      binaryChunk = chunk;
    } else {
      invalid("GLB contains unsupported additional chunks.");
    }
    offset += 8 + chunkLength;
    chunkIndex += 1;
  }
  if (offset !== bytes.byteLength || jsonChunk === undefined)
    invalid("GLB chunk table is incomplete.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(jsonChunk)) as unknown;
  } catch (error) {
    throw new SceneCompileError("GLB_INVALID", "GLB JSON is invalid UTF-8 or JSON.", {
      cause: error,
    });
  }
  if (!isRecord(parsed)) invalid("GLB JSON root must be an object.");
  const asset = parsed.asset;
  if (!isRecord(asset) || asset.version !== "2.0")
    invalid("GLB asset.version must be exactly 2.0.");
  validateNoExternalResources(parsed);

  const buffers = arrayMember(parsed, "buffers");
  if (binaryChunk.byteLength === 0) {
    if (buffers.length !== 0) invalid("A JSON-only GLB cannot declare an internal buffer.");
  } else {
    if (buffers.length !== 1 || !isRecord(buffers[0]))
      invalid("GLB must declare exactly one internal buffer.");
    const declaredLength = integerMember(buffers[0], "byteLength");
    if (declaredLength > binaryChunk.byteLength || binaryChunk.byteLength - declaredLength > 3) {
      invalid("GLB buffer length does not match its binary chunk.");
    }
  }

  const accessors = arrayMember(parsed, "accessors");
  const bufferViews = arrayMember(parsed, "bufferViews");
  const ranges = accessors.map((accessor) => {
    if (!isRecord(accessor)) invalid("glTF accessors must be objects.");
    return accessorRange({ accessor, binaryLength: binaryChunk.byteLength, bufferViews });
  });
  const binaryView = new DataView(
    binaryChunk.buffer,
    binaryChunk.byteOffset,
    binaryChunk.byteLength,
  );
  for (const range of ranges) {
    if (range.componentType !== 5_126) continue;
    for (let element = 0; element < range.count; element += 1) {
      for (let component = 0; component < range.componentCount; component += 1) {
        const value = binaryView.getFloat32(
          range.byteOffset + element * range.byteStride + component * 4,
          true,
        );
        if (!Number.isFinite(value)) invalid("A Float32 accessor contains NaN or infinity.");
      }
    }
  }

  const meshes = arrayMember(parsed, "meshes");
  const materials = arrayMember(parsed, "materials");
  let vertices = 0;
  let triangles = 0;
  for (const mesh of meshes) {
    if (!isRecord(mesh)) invalid("glTF meshes must be objects.");
    const primitives = arrayMember(mesh, "primitives");
    if (primitives.length === 0) invalid("A glTF mesh must contain at least one primitive.");
    for (const primitive of primitives) {
      if (!isRecord(primitive) || integerMember(primitive, "mode", 4) !== 4) {
        invalid("Only indexed triangle primitives are accepted.");
      }
      const attributes = primitive.attributes;
      if (!isRecord(attributes)) invalid("A triangle primitive requires attributes.");
      const positionIndex = integerMember(attributes, "POSITION");
      const positionRange = ranges[positionIndex];
      if (
        positionRange === undefined ||
        positionRange.componentType !== 5_126 ||
        positionRange.componentCount !== 3
      ) {
        invalid("POSITION must reference a finite Float32 VEC3 accessor.");
      }
      if (attributes.NORMAL !== undefined) {
        const normalRange = ranges[integerMember(attributes, "NORMAL")];
        if (
          normalRange === undefined ||
          normalRange.componentType !== 5_126 ||
          normalRange.componentCount !== 3 ||
          normalRange.count !== positionRange.count
        ) {
          invalid("NORMAL must reference a matching finite Float32 VEC3 accessor.");
        }
      }
      if (
        primitive.material !== undefined &&
        integerMember(primitive, "material") >= materials.length
      ) {
        invalid("A triangle primitive references a missing material.");
      }
      const indexAccessor = ranges[integerMember(primitive, "indices")];
      if (
        indexAccessor === undefined ||
        indexAccessor.componentCount !== 1 ||
        indexAccessor.count % 3 !== 0
      ) {
        invalid("Triangle indices must reference a complete scalar accessor.");
      }
      for (let index = 0; index < indexAccessor.count; index += 1) {
        const value = readUnsignedIndex(
          binaryView,
          indexAccessor.byteOffset + index * indexAccessor.byteStride,
          indexAccessor.componentType,
        );
        if (value >= positionRange.count)
          invalid("A triangle index exceeds the POSITION accessor.");
      }
      vertices += positionRange.count;
      triangles += indexAccessor.count / 3;
    }
  }
  if (vertices > c10ScenePolicy.maximumVertices || triangles > c10ScenePolicy.maximumTriangles) {
    invalid("GLB geometry exceeds the frozen vertex or triangle limit.");
  }

  const cameras = arrayMember(parsed, "cameras");
  const nodes = arrayMember(parsed, "nodes");
  for (const node of nodes) {
    if (!isRecord(node)) invalid("glTF nodes must be objects.");
    if (node.mesh !== undefined && integerMember(node, "mesh") >= meshes.length) {
      invalid("A glTF node references a missing mesh.");
    }
    if (node.camera !== undefined && integerMember(node, "camera") >= cameras.length) {
      invalid("A glTF node references a missing camera.");
    }
  }
  for (const scene of arrayMember(parsed, "scenes")) {
    if (!isRecord(scene)) invalid("glTF scenes must be objects.");
    for (const nodeIndex of arrayMember(scene, "nodes")) {
      if (
        !Number.isSafeInteger(nodeIndex) ||
        (nodeIndex as number) < 0 ||
        (nodeIndex as number) >= nodes.length
      ) {
        invalid("A glTF scene references a missing node.");
      }
    }
  }

  const counts = {
    accessors: accessors.length,
    bufferViews: bufferViews.length,
    materials: materials.length,
    meshes: meshes.length,
    nodes: nodes.length,
    triangles,
    vertices,
  };
  if (
    counts.materials > c10ScenePolicy.maximumMaterials ||
    counts.meshes > c10ScenePolicy.maximumNodes ||
    counts.nodes > c10ScenePolicy.maximumNodes
  ) {
    invalid("GLB object counts exceed frozen scene limits.");
  }
  return { binaryChunk, counts, json: parsed, jsonChunk };
}
