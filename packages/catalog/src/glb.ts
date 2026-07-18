import { c13CatalogPolicy, type InteriorAssetRef } from "@interior-design/contracts";
import { parseIJson } from "@interior-design/domain-model";

import { hasUnsafeCatalogText, isPlainRecord } from "./canonical.js";
import { CatalogError } from "./errors.js";
import type { ValidatedGlb } from "./types.js";

const glbMagic = 0x46546c67;
const jsonChunkType = 0x4e4f534a;
const binaryChunkType = 0x004e4942;
const maximumJsonChunkBytes = 2 * 1024 * 1024;
const componentByteLengths = new Map<number, number>([
  [5121, 1],
  [5123, 2],
  [5125, 4],
  [5126, 4],
]);
const typeComponents = new Map<string, number>([
  ["SCALAR", 1],
  ["VEC2", 2],
  ["VEC3", 3],
  ["VEC4", 4],
]);

interface GlbChunks {
  readonly binary: Uint8Array;
  readonly json: Record<string, unknown>;
}

interface AccessorReader {
  readonly count: number;
  readonly componentType: number;
  readonly read: (index: number, component: number) => number;
  readonly type: string;
}

interface GlbMaterial {
  readonly baseColourSrgb8: readonly [number, number, number];
  readonly emissiveSrgb8: readonly [number, number, number];
  readonly metallicBasisPoints: number;
  readonly name: string;
  readonly roughnessBasisPoints: number;
}

function glbInvalid(
  code: "CATALOG_GLB_INVALID" | "CATALOG_GLB_RESOURCE_LIMIT" = "CATALOG_GLB_INVALID",
): never {
  throw new CatalogError(code);
}

function geometryInvalid(): never {
  throw new CatalogError("CATALOG_GLB_GEOMETRY_INVALID");
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0);
}

function safeInteger(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

function array(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) glbInvalid("CATALOG_GLB_RESOURCE_LIMIT");
  return value;
}

function optionalArray(value: unknown, maximum: number): readonly unknown[] {
  return value === undefined ? [] : array(value, maximum);
}

function record(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) glbInvalid();
  return value;
}

function index(value: unknown, maximumExclusive: number): number {
  if (!safeInteger(value) || value >= maximumExclusive) glbInvalid();
  return value;
}

function readChunks(bytes: Uint8Array): GlbChunks {
  if (bytes.byteLength < 28 || bytes.byteLength > c13CatalogPolicy.maximumGlbBytes) {
    glbInvalid("CATALOG_GLB_RESOURCE_LIMIT");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== glbMagic || view.getUint32(4, true) !== 2) glbInvalid();
  if (view.getUint32(8, true) !== bytes.byteLength) glbInvalid();
  let offset = 12;
  let jsonBytes: Uint8Array | undefined;
  let binary: Uint8Array | undefined;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) glbInvalid();
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    if (chunkLength % 4 !== 0 || chunkLength < 4 || offset + 8 + chunkLength > bytes.byteLength) {
      glbInvalid();
    }
    const chunkBytes = bytes.subarray(offset + 8, offset + 8 + chunkLength);
    if (chunkType === jsonChunkType && jsonBytes === undefined && binary === undefined) {
      if (chunkLength > maximumJsonChunkBytes) glbInvalid("CATALOG_GLB_RESOURCE_LIMIT");
      jsonBytes = chunkBytes;
    } else if (chunkType === binaryChunkType && jsonBytes !== undefined && binary === undefined) {
      binary = chunkBytes;
    } else {
      glbInvalid();
    }
    offset += 8 + chunkLength;
  }
  if (offset !== bytes.byteLength || jsonBytes === undefined || binary === undefined) glbInvalid();
  let lastJsonByte = jsonBytes.byteLength - 1;
  while (lastJsonByte >= 0 && jsonBytes[lastJsonByte] === 0x20) lastJsonByte -= 1;
  if (lastJsonByte < 1) glbInvalid();
  let parsed: unknown;
  try {
    parsed = parseIJson(jsonBytes.subarray(0, lastJsonByte + 1));
  } catch (error) {
    throw new CatalogError("CATALOG_GLB_INVALID", { cause: error });
  }
  if (!isPlainRecord(parsed)) glbInvalid();
  return { binary, json: parsed };
}

function assertBoundedJson(value: unknown, depth = 0, budget = { nodes: 0 }): void {
  budget.nodes += 1;
  if (depth > 32 || budget.nodes > 50_000) glbInvalid("CATALOG_GLB_RESOURCE_LIMIT");
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (value.length > 10_000 || hasUnsafeCatalogText(value)) glbInvalid();
    return;
  }
  if (typeof value === "number") {
    if (!finite(value)) glbInvalid();
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 500_000) glbInvalid("CATALOG_GLB_RESOURCE_LIMIT");
    for (const child of value) assertBoundedJson(child, depth + 1, budget);
    return;
  }
  if (!isPlainRecord(value)) glbInvalid();
  for (const [key, child] of Object.entries(value)) {
    if (key === "extras" || key === "uri" || key.length > 160) glbInvalid();
    assertBoundedJson(child, depth + 1, budget);
  }
}

function createAccessorReader(
  accessorIndex: number,
  accessors: readonly unknown[],
  bufferViews: readonly unknown[],
  binary: Uint8Array,
): AccessorReader {
  const accessor = record(accessors[accessorIndex]);
  if (accessor.sparse !== undefined || accessor.normalized === true) glbInvalid();
  const componentType = accessor.componentType;
  const type = accessor.type;
  const count = accessor.count;
  if (
    !safeInteger(componentType) ||
    !componentByteLengths.has(componentType) ||
    typeof type !== "string" ||
    !typeComponents.has(type) ||
    !safeInteger(count, 1) ||
    count > c13CatalogPolicy.maximumGlbVertices * 3
  ) {
    glbInvalid("CATALOG_GLB_RESOURCE_LIMIT");
  }
  const bufferViewIndex = index(accessor.bufferView, bufferViews.length);
  const bufferView = record(bufferViews[bufferViewIndex]);
  if (bufferView.buffer !== 0) glbInvalid();
  const componentBytes = componentByteLengths.get(componentType);
  const components = typeComponents.get(type);
  if (componentBytes === undefined || components === undefined) glbInvalid();
  const elementBytes = componentBytes * components;
  const byteStride = bufferView.byteStride === undefined ? elementBytes : bufferView.byteStride;
  const viewOffset = bufferView.byteOffset === undefined ? 0 : bufferView.byteOffset;
  const accessorOffset = accessor.byteOffset === undefined ? 0 : accessor.byteOffset;
  const viewLength = bufferView.byteLength;
  if (
    !safeInteger(byteStride, elementBytes) ||
    byteStride > 252 ||
    byteStride % componentBytes !== 0 ||
    !safeInteger(viewOffset) ||
    !safeInteger(accessorOffset) ||
    accessorOffset % componentBytes !== 0 ||
    !safeInteger(viewLength, 1) ||
    viewOffset + viewLength > binary.byteLength ||
    accessorOffset + (count - 1) * byteStride + elementBytes > viewLength
  ) {
    glbInvalid();
  }
  const dataView = new DataView(binary.buffer, binary.byteOffset + viewOffset, viewLength);
  const read = (itemIndex: number, component: number): number => {
    if (itemIndex < 0 || itemIndex >= count || component < 0 || component >= components)
      glbInvalid();
    const offset = accessorOffset + itemIndex * byteStride + component * componentBytes;
    if (componentType === 5121) return dataView.getUint8(offset);
    if (componentType === 5123) return dataView.getUint16(offset, true);
    if (componentType === 5125) return dataView.getUint32(offset, true);
    const value = dataView.getFloat32(offset, true);
    if (!finite(value)) geometryInvalid();
    return value;
  };
  return { componentType, count, read, type };
}

function assertAccessorBounds(
  accessor: Record<string, unknown>,
  actualMinimum: readonly number[],
  actualMaximum: readonly number[],
): void {
  const declaredMinima = array(accessor.min, 16);
  const declaredMaxima = array(accessor.max, 16);
  if (
    declaredMinima.length !== actualMinimum.length ||
    declaredMaxima.length !== actualMaximum.length
  ) {
    geometryInvalid();
  }
  for (let component = 0; component < actualMinimum.length; component += 1) {
    const declaredMinimum = declaredMinima[component];
    const declaredMaximum = declaredMaxima[component];
    if (
      !finite(declaredMinimum) ||
      !finite(declaredMaximum) ||
      Math.abs(declaredMinimum - (actualMinimum[component] ?? 0)) > 0.000_001 ||
      Math.abs(declaredMaximum - (actualMaximum[component] ?? 0)) > 0.000_001
    ) {
      geometryInvalid();
    }
  }
}

function validateNodes(json: Record<string, unknown>, meshesLength: number): number {
  const nodes = optionalArray(json.nodes, c13CatalogPolicy.maximumGlbNodes);
  if (nodes.length < 1) glbInvalid();
  const parents = new Int32Array(nodes.length).fill(-1);
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    const node = record(nodes[nodeIndex]);
    if (
      node.camera !== undefined ||
      node.skin !== undefined ||
      node.weights !== undefined ||
      node.scale !== undefined ||
      node.translation !== undefined ||
      node.rotation !== undefined ||
      node.matrix !== undefined
    ) {
      glbInvalid();
    }
    if (node.mesh !== undefined) index(node.mesh, meshesLength);
    const children = optionalArray(node.children, nodes.length);
    if (new Set(children).size !== children.length) glbInvalid();
    for (const childValue of children) {
      const child = index(childValue, nodes.length);
      if (child === nodeIndex || parents[child] !== -1) glbInvalid();
      parents[child] = nodeIndex;
    }
  }
  const scenes = array(json.scenes, 64);
  const sceneIndex = index(json.scene, scenes.length);
  const roots = array(record(scenes[sceneIndex]).nodes, nodes.length);
  if (roots.length < 1 || new Set(roots).size !== roots.length) glbInvalid();
  const visited = new Set<number>();
  const visiting = new Set<number>();
  const visit = (nodeIndex: number): void => {
    if (visiting.has(nodeIndex)) glbInvalid();
    if (visited.has(nodeIndex)) return;
    visiting.add(nodeIndex);
    const children = optionalArray(record(nodes[nodeIndex]).children, nodes.length);
    for (const child of children) visit(index(child, nodes.length));
    visiting.delete(nodeIndex);
    visited.add(nodeIndex);
  };
  for (const root of roots) visit(index(root, nodes.length));
  if (visited.size !== nodes.length) glbInvalid();
  return nodes.length;
}

function linearToSrgb8(value: number): number {
  const srgb = value <= 0.003_130_8 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.round(Math.max(0, Math.min(1, srgb)) * 255);
}

function materialColour(value: unknown, expectedLength: 3 | 4): readonly number[] {
  const colour = array(value, expectedLength);
  if (
    colour.length !== expectedLength ||
    colour.some((component) => !finite(component) || component < 0 || component > 1)
  ) {
    glbInvalid();
  }
  return colour as readonly number[];
}

function validateMaterials(json: Record<string, unknown>): GlbMaterial {
  const materials = optionalArray(json.materials, c13CatalogPolicy.maximumGlbMaterials);
  if (materials.length !== 1) glbInvalid();
  for (const rawMaterial of materials) {
    const material = record(rawMaterial);
    if (
      material.extensions !== undefined ||
      (material.alphaMode !== undefined && material.alphaMode !== "OPAQUE") ||
      material.doubleSided === true ||
      material.normalTexture !== undefined ||
      material.occlusionTexture !== undefined ||
      material.emissiveTexture !== undefined
    ) {
      glbInvalid();
    }
    if (
      typeof material.name !== "string" ||
      material.name.length < 1 ||
      material.name.length > 160
    ) {
      glbInvalid();
    }
    const emissive = materialColour(material.emissiveFactor, 3);
    const pbr = record(material.pbrMetallicRoughness);
    if (pbr.baseColorTexture !== undefined || pbr.metallicRoughnessTexture !== undefined) {
      glbInvalid();
    }
    const colour = materialColour(pbr.baseColorFactor, 4);
    if (colour[3] !== 1 || !finite(pbr.metallicFactor) || !finite(pbr.roughnessFactor))
      glbInvalid();
    return {
      baseColourSrgb8: [
        linearToSrgb8(colour[0] ?? 0),
        linearToSrgb8(colour[1] ?? 0),
        linearToSrgb8(colour[2] ?? 0),
      ],
      emissiveSrgb8: [
        linearToSrgb8(emissive[0] ?? 0),
        linearToSrgb8(emissive[1] ?? 0),
        linearToSrgb8(emissive[2] ?? 0),
      ],
      metallicBasisPoints: Math.round(pbr.metallicFactor * 10_000),
      name: material.name,
      roughnessBasisPoints: Math.round(pbr.roughnessFactor * 10_000),
    };
  }
  glbInvalid();
}

export function validateCatalogGlb(bytes: Uint8Array, c12Asset: InteriorAssetRef): ValidatedGlb {
  const { binary, json } = readChunks(bytes);
  assertBoundedJson(json);
  const asset = record(json.asset);
  if (asset.version !== "2.0" || asset.minVersion !== undefined) glbInvalid();
  const requiredExtensions = optionalArray(json.extensionsRequired, 32);
  const usedExtensions = optionalArray(json.extensionsUsed, 32);
  if (requiredExtensions.length > 0 || usedExtensions.length > 0 || json.extensions !== undefined) {
    glbInvalid();
  }
  for (const forbidden of [
    "animations",
    "cameras",
    "images",
    "samplers",
    "skins",
    "textures",
  ] as const) {
    if (optionalArray(json[forbidden], c13CatalogPolicy.maximumGlbTextures).length > 0)
      glbInvalid();
  }
  const buffers = array(json.buffers, 1);
  if (buffers.length !== 1) glbInvalid();
  const buffer = record(buffers[0]);
  if (
    buffer.uri !== undefined ||
    !safeInteger(buffer.byteLength, 1) ||
    buffer.byteLength > binary.byteLength ||
    binary.byteLength - buffer.byteLength > 3
  ) {
    glbInvalid();
  }
  const bufferViews = array(json.bufferViews, 2_048);
  const accessors = array(json.accessors, 4_096);
  const meshes = array(json.meshes, c13CatalogPolicy.maximumGlbMeshes);
  if (meshes.length < 1) glbInvalid();
  const material = validateMaterials(json);
  const nodes = validateNodes(json, meshes.length);
  let vertices = 0;
  let triangles = 0;
  const aggregateMinimum = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  const aggregateMaximum = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  let forwardNormalFound = false;
  for (const rawMesh of meshes) {
    const mesh = record(rawMesh);
    if (mesh.weights !== undefined) glbInvalid();
    const primitives = array(mesh.primitives, 512);
    if (primitives.length < 1) glbInvalid();
    for (const rawPrimitive of primitives) {
      const primitive = record(rawPrimitive);
      if (primitive.targets !== undefined || (primitive.mode !== undefined && primitive.mode !== 4))
        glbInvalid();
      index(primitive.material, 1);
      const attributes = record(primitive.attributes);
      const attributeKeys = Object.keys(attributes).sort();
      if (attributeKeys.join(",") !== "NORMAL,POSITION,TEXCOORD_0") geometryInvalid();
      const positionIndex = index(attributes.POSITION, accessors.length);
      const normalIndex = index(attributes.NORMAL, accessors.length);
      const uvIndex = index(attributes.TEXCOORD_0, accessors.length);
      const indicesIndex = index(primitive.indices, accessors.length);
      const position = createAccessorReader(positionIndex, accessors, bufferViews, binary);
      const normal = createAccessorReader(normalIndex, accessors, bufferViews, binary);
      const uv = createAccessorReader(uvIndex, accessors, bufferViews, binary);
      const indices = createAccessorReader(indicesIndex, accessors, bufferViews, binary);
      if (
        position.type !== "VEC3" ||
        position.componentType !== 5126 ||
        normal.type !== "VEC3" ||
        normal.componentType !== 5126 ||
        uv.type !== "VEC2" ||
        uv.componentType !== 5126 ||
        indices.type !== "SCALAR" ||
        ![5121, 5123, 5125].includes(indices.componentType) ||
        position.count !== normal.count ||
        position.count !== uv.count ||
        indices.count % 3 !== 0
      ) {
        geometryInvalid();
      }
      vertices += position.count;
      triangles += indices.count / 3;
      if (
        vertices > c13CatalogPolicy.maximumGlbVertices ||
        triangles > c13CatalogPolicy.maximumGlbTriangles
      ) {
        glbInvalid("CATALOG_GLB_RESOURCE_LIMIT");
      }
      const primitiveMinimum = [
        Number.POSITIVE_INFINITY,
        Number.POSITIVE_INFINITY,
        Number.POSITIVE_INFINITY,
      ];
      const primitiveMaximum = [
        Number.NEGATIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
      ];
      const positions: Array<readonly [number, number, number]> = [];
      for (let item = 0; item < position.count; item += 1) {
        const point = [
          position.read(item, 0),
          position.read(item, 1),
          position.read(item, 2),
        ] as const;
        positions.push(point);
        for (let component = 0; component < 3; component += 1) {
          primitiveMinimum[component] = Math.min(
            primitiveMinimum[component] ?? 0,
            point[component] ?? 0,
          );
          primitiveMaximum[component] = Math.max(
            primitiveMaximum[component] ?? 0,
            point[component] ?? 0,
          );
          aggregateMinimum[component] = Math.min(
            aggregateMinimum[component] ?? 0,
            point[component] ?? 0,
          );
          aggregateMaximum[component] = Math.max(
            aggregateMaximum[component] ?? 0,
            point[component] ?? 0,
          );
        }
        const normalVector = [
          normal.read(item, 0),
          normal.read(item, 1),
          normal.read(item, 2),
        ] as const;
        const normalLength = Math.hypot(...normalVector);
        if (normalLength < 0.999 || normalLength > 1.001) geometryInvalid();
        if (normalVector[2] > 0.999) forwardNormalFound = true;
        const u = uv.read(item, 0);
        const v = uv.read(item, 1);
        if (u < 0 || u > 1 || v < 0 || v > 1) geometryInvalid();
      }
      assertAccessorBounds(record(accessors[positionIndex]), primitiveMinimum, primitiveMaximum);
      for (let triangle = 0; triangle < indices.count; triangle += 3) {
        const aIndex = indices.read(triangle, 0);
        const bIndex = indices.read(triangle + 1, 0);
        const cIndex = indices.read(triangle + 2, 0);
        if (
          ![aIndex, bIndex, cIndex].every(Number.isInteger) ||
          aIndex >= position.count ||
          bIndex >= position.count ||
          cIndex >= position.count
        ) {
          geometryInvalid();
        }
        const a = positions[aIndex];
        const b = positions[bIndex];
        const c = positions[cIndex];
        if (a === undefined || b === undefined || c === undefined) geometryInvalid();
        const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const cross = [
          (ab[1] ?? 0) * (ac[2] ?? 0) - (ab[2] ?? 0) * (ac[1] ?? 0),
          (ab[2] ?? 0) * (ac[0] ?? 0) - (ab[0] ?? 0) * (ac[2] ?? 0),
          (ab[0] ?? 0) * (ac[1] ?? 0) - (ab[1] ?? 0) * (ac[0] ?? 0),
        ];
        if (Math.hypot(...cross) < 0.000_000_001) geometryInvalid();
      }
    }
  }
  if (!forwardNormalFound) geometryInvalid();
  const toleranceMetres = c13CatalogPolicy.modelBoundsToleranceMm / 1_000;
  const expected = {
    depth: c12Asset.geometryEnvelopeMm.depthMm / 1_000,
    height: c12Asset.geometryEnvelopeMm.heightMm / 1_000,
    width: c12Asset.geometryEnvelopeMm.widthMm / 1_000,
  };
  const actual = {
    depth: (aggregateMaximum[2] ?? 0) - (aggregateMinimum[2] ?? 0),
    height: (aggregateMaximum[1] ?? 0) - (aggregateMinimum[1] ?? 0),
    width: (aggregateMaximum[0] ?? 0) - (aggregateMinimum[0] ?? 0),
  };
  if (
    Math.abs(actual.depth - expected.depth) > toleranceMetres ||
    Math.abs(actual.height - expected.height) > toleranceMetres ||
    Math.abs(actual.width - expected.width) > toleranceMetres ||
    Math.abs(aggregateMinimum[1] ?? 0) > toleranceMetres ||
    Math.abs(((aggregateMinimum[0] ?? 0) + (aggregateMaximum[0] ?? 0)) / 2) > toleranceMetres ||
    Math.abs(((aggregateMinimum[2] ?? 0) + (aggregateMaximum[2] ?? 0)) / 2) > toleranceMetres
  ) {
    geometryInvalid();
  }
  return {
    boundsMetres: {
      maximum: aggregateMaximum as [number, number, number],
      minimum: aggregateMinimum as [number, number, number],
    },
    material,
    materials: 1,
    meshes: meshes.length,
    nodes,
    triangles,
    vertices,
  };
}
