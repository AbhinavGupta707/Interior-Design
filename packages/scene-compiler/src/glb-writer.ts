import { c10ScenePolicy } from "@interior-design/contracts";

import { canonicalJson } from "./canonical.js";
import { SceneCompileError } from "./errors.js";
import type { MeshData } from "./geometry.js";

const glbMagic = 0x46546c67;
const jsonChunkType = 0x4e4f534a;
const binaryChunkType = 0x004e4942;

export interface GltfMeshInput {
  readonly data: MeshData;
  readonly materialIndex: number;
  readonly name: string;
}

export interface GltfDocumentInput {
  readonly cameras: readonly Readonly<Record<string, unknown>>[];
  readonly extensions?: Readonly<Record<string, unknown>>;
  readonly extensionsUsed?: readonly string[];
  readonly materials: readonly Readonly<Record<string, unknown>>[];
  readonly meshes: readonly GltfMeshInput[];
  readonly nodes: readonly Readonly<Record<string, unknown>>[];
}

export interface WrittenGlb {
  readonly glb: Uint8Array;
  readonly json: Readonly<Record<string, unknown>>;
}

class BinaryBuilder {
  #byteLength = 0;
  readonly #chunks: Uint8Array[] = [];

  get byteLength(): number {
    return this.#byteLength;
  }

  align(): void {
    const padding = (4 - (this.#byteLength % 4)) % 4;
    if (padding > 0) {
      this.#chunks.push(new Uint8Array(padding));
      this.#byteLength += padding;
    }
  }

  appendFloat32(values: readonly number[]): {
    readonly byteLength: number;
    readonly byteOffset: number;
  } {
    this.align();
    const byteOffset = this.#byteLength;
    const bytes = new Uint8Array(values.length * 4);
    const view = new DataView(bytes.buffer);
    values.forEach((value, index) => {
      const floatValue = Math.fround(value);
      const rounded = Object.is(floatValue, -0) ? 0 : floatValue;
      if (!Number.isFinite(rounded)) {
        throw new SceneCompileError("GEOMETRY_INVALID", "A generated Float32 value is non-finite.");
      }
      view.setFloat32(index * 4, rounded, true);
    });
    this.#chunks.push(bytes);
    this.#byteLength += bytes.byteLength;
    return { byteLength: bytes.byteLength, byteOffset };
  }

  appendUint32(values: readonly number[]): {
    readonly byteLength: number;
    readonly byteOffset: number;
  } {
    this.align();
    const byteOffset = this.#byteLength;
    const bytes = new Uint8Array(values.length * 4);
    const view = new DataView(bytes.buffer);
    values.forEach((value, index) => {
      if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
        throw new SceneCompileError("GEOMETRY_INVALID", "A generated mesh index is invalid.");
      }
      view.setUint32(index * 4, value, true);
    });
    this.#chunks.push(bytes);
    this.#byteLength += bytes.byteLength;
    return { byteLength: bytes.byteLength, byteOffset };
  }

  finish(): Uint8Array {
    this.align();
    const output = new Uint8Array(this.#byteLength);
    let offset = 0;
    for (const chunk of this.#chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  }
}

function paddedLength(byteLength: number): number {
  return Math.ceil(byteLength / 4) * 4;
}

function normalizeGeneratedNumbers(value: unknown): unknown {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new SceneCompileError(
        "GEOMETRY_INVALID",
        "Generated glTF JSON contains a non-finite number.",
      );
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(normalizeGeneratedNumbers);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, normalizeGeneratedNumbers(child)]),
    );
  }
  return value;
}

function finiteMinMax(values: readonly number[]): {
  readonly maximum: readonly [number, number, number];
  readonly minimum: readonly [number, number, number];
} {
  if (values.length === 0 || values.length % 3 !== 0) {
    throw new SceneCompileError(
      "GEOMETRY_INVALID",
      "A position stream must contain complete vertices.",
    );
  }
  const minimum: [number, number, number] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  const maximum: [number, number, number] = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  for (let index = 0; index < values.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const floatValue = Math.fround(values[index + axis] ?? Number.NaN);
      const value = Object.is(floatValue, -0) ? 0 : floatValue;
      if (!Number.isFinite(value)) {
        throw new SceneCompileError(
          "GEOMETRY_INVALID",
          "A position stream contains non-finite data.",
        );
      }
      minimum[axis] = Math.min(minimum[axis] ?? Number.POSITIVE_INFINITY, value);
      maximum[axis] = Math.max(maximum[axis] ?? Number.NEGATIVE_INFINITY, value);
    }
  }
  return { maximum, minimum };
}

function writeHeader(
  output: Uint8Array,
  jsonLength: number,
  binaryLength: number,
  totalLength: number,
): void {
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  view.setUint32(0, glbMagic, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, jsonChunkType, true);
  if (binaryLength > 0) {
    const binaryHeaderOffset = 20 + jsonLength;
    view.setUint32(binaryHeaderOffset, binaryLength, true);
    view.setUint32(binaryHeaderOffset + 4, binaryChunkType, true);
  }
}

export function writeGlb(input: GltfDocumentInput): WrittenGlb {
  const binary = new BinaryBuilder();
  const accessors: Record<string, unknown>[] = [];
  const bufferViews: Record<string, unknown>[] = [];
  const meshes: Record<string, unknown>[] = [];

  for (const mesh of input.meshes) {
    const positionsGltf = mesh.data.positionsMm.flatMap((value, index) => {
      const axis = index % 3;
      if (axis === 0) return [value / 1_000];
      if (axis === 1) return [-value / 1_000];
      return [value / 1_000];
    });
    // Canonical triples are [X,Y,Z]; reorder to glTF [X,Z,-Y].
    for (let index = 0; index < positionsGltf.length; index += 3) {
      const canonicalY = positionsGltf[index + 1];
      const canonicalZ = positionsGltf[index + 2];
      positionsGltf[index + 1] = canonicalZ ?? Number.NaN;
      positionsGltf[index + 2] = canonicalY ?? Number.NaN;
    }
    if (
      mesh.data.vertexCount !== mesh.data.positionsMm.length / 3 ||
      mesh.data.normalsGltf.length !== mesh.data.positionsMm.length ||
      mesh.data.triangleCount !== mesh.data.indices.length / 3
    ) {
      throw new SceneCompileError("GEOMETRY_INVALID", "Generated mesh counts are inconsistent.");
    }
    if (mesh.data.indices.some((index) => index >= mesh.data.vertexCount)) {
      throw new SceneCompileError(
        "GEOMETRY_INVALID",
        "Generated mesh indices exceed the vertex stream.",
      );
    }

    const positionSlice = binary.appendFloat32(positionsGltf);
    const positionView = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteLength: positionSlice.byteLength,
      byteOffset: positionSlice.byteOffset,
      target: 34_962,
    });
    const positionBounds = finiteMinMax(positionsGltf);
    const positionAccessor = accessors.length;
    accessors.push({
      bufferView: positionView,
      componentType: 5_126,
      count: mesh.data.vertexCount,
      max: positionBounds.maximum,
      min: positionBounds.minimum,
      type: "VEC3",
    });

    const normalSlice = binary.appendFloat32(mesh.data.normalsGltf);
    const normalView = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteLength: normalSlice.byteLength,
      byteOffset: normalSlice.byteOffset,
      target: 34_962,
    });
    const normalAccessor = accessors.length;
    accessors.push({
      bufferView: normalView,
      componentType: 5_126,
      count: mesh.data.vertexCount,
      type: "VEC3",
    });

    const indexSlice = binary.appendUint32(mesh.data.indices);
    const indexView = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteLength: indexSlice.byteLength,
      byteOffset: indexSlice.byteOffset,
      target: 34_963,
    });
    const indexAccessor = accessors.length;
    accessors.push({
      bufferView: indexView,
      componentType: 5_125,
      count: mesh.data.indices.length,
      type: "SCALAR",
    });

    meshes.push({
      name: mesh.name,
      primitives: [
        {
          attributes: { NORMAL: normalAccessor, POSITION: positionAccessor },
          indices: indexAccessor,
          material: mesh.materialIndex,
          mode: 4,
        },
      ],
    });
  }

  const binaryBytes = binary.finish();
  const rawDocument: Record<string, unknown> = {
    ...(accessors.length === 0 ? {} : { accessors }),
    asset: { generator: "interior-design-scene-compiler/1.0.0", version: "2.0" },
    ...(binaryBytes.byteLength === 0
      ? {}
      : { bufferViews, buffers: [{ byteLength: binaryBytes.byteLength }] }),
    ...(input.cameras.length === 0 ? {} : { cameras: input.cameras }),
    ...(input.extensions === undefined ? {} : { extensions: input.extensions }),
    ...(input.extensionsUsed === undefined || input.extensionsUsed.length === 0
      ? {}
      : { extensionsUsed: input.extensionsUsed }),
    ...(input.materials.length === 0 ? {} : { materials: input.materials }),
    ...(meshes.length === 0 ? {} : { meshes }),
    ...(input.nodes.length === 0 ? {} : { nodes: input.nodes }),
    scene: 0,
    scenes: [input.nodes.length === 0 ? {} : { nodes: input.nodes.map((_, index) => index) }],
  };
  const json = normalizeGeneratedNumbers(rawDocument) as Record<string, unknown>;
  const rawJson = new TextEncoder().encode(canonicalJson(json));
  const jsonLength = paddedLength(rawJson.byteLength);
  const binaryHeaderLength = binaryBytes.byteLength === 0 ? 0 : 8;
  const totalLength = 12 + 8 + jsonLength + binaryHeaderLength + binaryBytes.byteLength;
  if (totalLength > c10ScenePolicy.maximumArtifactBytes) {
    throw new SceneCompileError(
      "RESOURCE_LIMIT_EXCEEDED",
      "Compiled GLB exceeds the frozen public artifact byte limit.",
    );
  }
  const output = new Uint8Array(totalLength);
  output.fill(0x20, 20, 20 + jsonLength);
  output.set(rawJson, 20);
  if (binaryBytes.byteLength > 0) output.set(binaryBytes, 20 + jsonLength + 8);
  writeHeader(output, jsonLength, binaryBytes.byteLength, totalLength);
  return { glb: output, json };
}
