import { c10ScenePolicy } from "@interior-design/contracts";

import { exactKeys, hasUnsafeText, isPlainRecord, renderSceneCanonicalJson } from "./canonical.js";
import { failRenderScene } from "./errors.js";

const glbMagic = 0x46546c67;
const jsonChunkType = 0x4e4f534a;
const binaryChunkType = 0x004e4942;
const maximumJsonChunkBytes = 32 * 1024 * 1024;
const maximumJsonNodes = 2_000_000;
const maximumStringLength = 4_096;

const executableKeyPattern =
  /^(?:command|driver|env|environment|eval|exec|expression|filepath|filename|module|path|python|script|shell|uri|url)$/iu;
const executableTextPattern =
  /(?:\.blend(?:$|\W)|\bbpy\b|\bdriver\b|\bos\.environ\b|\bpython\b|\bscript\b|file:\/\/|https?:\/\/|[\\/]|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|%[A-Za-z_][A-Za-z0-9_]*%)/iu;

export interface ParsedRenderGlbCounts {
  readonly materials: number;
  readonly meshes: number;
  readonly nodes: number;
  readonly triangles: number;
  readonly vertices: number;
}

export interface ParsedRenderGlb {
  readonly catalogBindingsByElement: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  readonly counts: ParsedRenderGlbCounts;
  readonly json: Readonly<Record<string, unknown>>;
  readonly meshHasUv: readonly boolean[];
  readonly specificationBinding: Readonly<Record<string, unknown>>;
}

interface AccessorRange {
  readonly byteOffset: number;
  readonly byteStride: number;
  readonly componentCount: number;
  readonly componentType: number;
  readonly count: number;
}

function record(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) return failRenderScene("GLB_INVALID");
  return value;
}

function arrayMember(
  value: Readonly<Record<string, unknown>>,
  key: string,
  maximum = 2_000_000,
): readonly unknown[] {
  const member = value[key];
  if (member === undefined) return [];
  if (!Array.isArray(member)) return failRenderScene("GLB_INVALID");
  if (member.length > maximum) return failRenderScene("GLB_RESOURCE_LIMIT");
  return member;
}

function integer(value: unknown, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    return failRenderScene("GLB_INVALID");
  }
  return value as number;
}

function integerMember(
  value: Readonly<Record<string, unknown>>,
  key: string,
  defaultValue?: number,
): number {
  const member = value[key];
  if (member === undefined && defaultValue !== undefined) return defaultValue;
  return integer(member);
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
      return failRenderScene("GLB_INVALID");
  }
}

function componentCount(type: unknown): number {
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
      return failRenderScene("GLB_INVALID");
  }
}

function accessorRange(input: {
  readonly accessor: Readonly<Record<string, unknown>>;
  readonly binaryLength: number;
  readonly bufferViews: readonly unknown[];
}): AccessorRange {
  if (input.accessor.sparse !== undefined) return failRenderScene("GLB_UNSAFE_CONTENT");
  const bufferViewIndex = integerMember(input.accessor, "bufferView");
  const bufferView = record(input.bufferViews[bufferViewIndex]);
  if (integerMember(bufferView, "buffer") !== 0) return failRenderScene("GLB_INVALID");
  const viewOffset = integerMember(bufferView, "byteOffset", 0);
  const viewLength = integerMember(bufferView, "byteLength");
  if (viewLength <= 0 || viewOffset % 4 !== 0 || viewOffset + viewLength > input.binaryLength) {
    return failRenderScene("GLB_INVALID");
  }
  const accessorOffset = integerMember(input.accessor, "byteOffset", 0);
  const componentType = integerMember(input.accessor, "componentType");
  const count = integerMember(input.accessor, "count");
  const components = componentCount(input.accessor.type);
  const componentBytes = componentByteSize(componentType);
  const elementSize = componentBytes * components;
  const byteStride = integerMember(bufferView, "byteStride", elementSize);
  if (
    count <= 0 ||
    accessorOffset % componentBytes !== 0 ||
    byteStride < elementSize ||
    byteStride > 252 ||
    byteStride % componentBytes !== 0
  ) {
    return failRenderScene("GLB_INVALID");
  }
  const lastByte = accessorOffset + (count - 1) * byteStride + elementSize;
  if (!Number.isSafeInteger(lastByte) || lastByte > viewLength) {
    return failRenderScene("GLB_INVALID");
  }
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
      return failRenderScene("GLB_INVALID");
  }
}

function assertSafeTree(value: unknown, budget = { nodes: 0 }, depth = 0): void {
  budget.nodes += 1;
  if (budget.nodes > maximumJsonNodes || depth > 128) {
    return failRenderScene("GLB_RESOURCE_LIMIT");
  }
  if (value === null || typeof value === "boolean" || typeof value === "number") return;
  if (typeof value === "string") {
    if (
      value.length > maximumStringLength ||
      hasUnsafeText(value) ||
      (value !== "interior-design-scene-compiler/1.0.0" && executableTextPattern.test(value))
    ) {
      return failRenderScene("GLB_UNSAFE_CONTENT");
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) assertSafeTree(child, budget, depth + 1);
    return;
  }
  if (!isPlainRecord(value)) return failRenderScene("GLB_INVALID");
  for (const [key, child] of Object.entries(value)) {
    if (key.length > 160 || hasUnsafeText(key) || executableKeyPattern.test(key)) {
      return failRenderScene(
        key.toLowerCase() === "uri" ? "GLB_EXTERNAL_RESOURCE" : "GLB_UNSAFE_CONTENT",
      );
    }
    assertSafeTree(child, budget, depth + 1);
  }
}

function parseCanonicalJsonChunk(jsonChunk: Uint8Array): Record<string, unknown> {
  let end = jsonChunk.byteLength;
  while (end > 0 && jsonChunk[end - 1] === 0x20) end -= 1;
  if (end < 2 || end > maximumJsonChunkBytes) return failRenderScene("GLB_RESOURCE_LIMIT");
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(jsonChunk.subarray(0, end));
  } catch {
    return failRenderScene("GLB_INVALID");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded) as unknown;
  } catch {
    return failRenderScene("GLB_INVALID");
  }
  if (!isPlainRecord(parsed)) return failRenderScene("GLB_INVALID");
  if (renderSceneCanonicalJson(parsed) !== decoded) {
    // Canonical byte identity rejects duplicate keys, ambiguous number forms,
    // non-deterministic ordering, and unbounded whitespace in one check.
    return failRenderScene("GLB_INVALID");
  }
  assertSafeTree(parsed);
  return parsed;
}

function assertNoExtras(value: unknown): void {
  if (Array.isArray(value)) {
    for (const child of value) assertNoExtras(child);
    return;
  }
  if (!isPlainRecord(value)) return;
  if (Object.hasOwn(value, "extras")) return failRenderScene("GLB_UNSAFE_CONTENT");
  for (const child of Object.values(value)) assertNoExtras(child);
}

const catalogBindingKeys = [
  "assetContentSha256",
  "assetMetadataSha256",
  "assetVersionId",
  "assetVersionSha256",
  "placementPolicySha256",
  "placementProjectionSha256",
  "representation",
  "rightsRecordSha256",
] as const;

function catalogBinding(value: unknown): Readonly<Record<string, unknown>> {
  const binding = record(value);
  if (!exactKeys(binding, catalogBindingKeys)) return failRenderScene("GLB_UNSAFE_CONTENT");
  if (binding.representation !== "parametric-bounded-not-vendor-fidelity") {
    return failRenderScene("C13_BINDING_MISMATCH");
  }
  for (const key of catalogBindingKeys) {
    if (typeof binding[key] !== "string") return failRenderScene("C13_BINDING_MISMATCH");
  }
  return Object.freeze({ ...binding });
}

function assetSpecificationBinding(
  asset: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  if (!isPlainRecord(asset.extras)) return failRenderScene("C13_BINDING_MISMATCH");
  const extras = asset.extras;
  if (!exactKeys(extras, ["c13SpecificationBinding"])) {
    return failRenderScene("C13_BINDING_MISMATCH");
  }
  const binding = record(extras.c13SpecificationBinding);
  if (
    !exactKeys(binding, [
      "authority",
      "catalogReleaseId",
      "catalogReleaseSha256",
      "specificationId",
      "specificationRevision",
      "specificationRevisionSha256",
    ]) ||
    binding.authority !== "catalog-metadata-on-parametric-scene"
  ) {
    return failRenderScene("C13_BINDING_MISMATCH");
  }
  return Object.freeze({ ...binding });
}

function collectCatalogBindings(
  json: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, Readonly<Record<string, unknown>>> {
  const result = new Map<string, Readonly<Record<string, unknown>>>();
  const add = (elementId: unknown, candidate: unknown): void => {
    if (typeof elementId !== "string" || result.has(elementId)) {
      return failRenderScene("C13_BINDING_MISMATCH");
    }
    result.set(elementId, catalogBinding(candidate));
  };

  const extensions = json.extensions === undefined ? undefined : record(json.extensions);
  let punctualLightCount = 0;
  if (extensions !== undefined) {
    if (!exactKeys(extensions, ["KHR_lights_punctual"])) {
      return failRenderScene("GLB_UNSAFE_CONTENT");
    }
    const punctual = record(extensions.KHR_lights_punctual);
    if (!exactKeys(punctual, ["lights"])) return failRenderScene("GLB_UNSAFE_CONTENT");
    const rawLights = arrayMember(punctual, "lights", c10ScenePolicy.maximumNodes);
    punctualLightCount = rawLights.length;
    for (const rawLight of rawLights) {
      const light = record(rawLight);
      const extras = record(light.extras);
      if (
        !exactKeys(extras, ["canonicalElementId", "colourTemperatureKelvin", "luminousFluxLumens"])
      ) {
        return failRenderScene("GLB_UNSAFE_CONTENT");
      }
    }
  }

  for (const rawNode of arrayMember(json, "nodes", c10ScenePolicy.maximumNodes)) {
    const node = record(rawNode);
    const extras = record(node.extras);
    const allowed = [
      "authority",
      "c13CatalogBinding",
      "canonicalElementId",
      "canonicalElementType",
      "face",
      "geometryRole",
      "heightMm",
      "hostWallId",
      "kind",
      "levelId",
      "materialSha256",
      "offsetAlongHostMm",
      "provenanceState",
      "sillHeightMm",
      "targetElementId",
      "widthMm",
    ];
    if (Object.keys(extras).some((key) => !allowed.includes(key))) {
      return failRenderScene("GLB_UNSAFE_CONTENT");
    }
    if (
      extras.authority !== "derived-visualisation-only" ||
      typeof extras.canonicalElementId !== "string" ||
      typeof extras.canonicalElementType !== "string" ||
      typeof extras.provenanceState !== "string"
    ) {
      return failRenderScene("GLB_UNSAFE_CONTENT");
    }
    if (extras.c13CatalogBinding !== undefined) {
      add(extras.canonicalElementId, extras.c13CatalogBinding);
    }
    if (node.extensions !== undefined) {
      const nodeExtensions = record(node.extensions);
      if (!exactKeys(nodeExtensions, ["KHR_lights_punctual"])) {
        return failRenderScene("GLB_UNSAFE_CONTENT");
      }
      const punctual = record(nodeExtensions.KHR_lights_punctual);
      if (!exactKeys(punctual, ["light"]) || integer(punctual.light) >= punctualLightCount) {
        return failRenderScene("GLB_INVALID");
      }
    }
  }

  for (const rawMaterial of arrayMember(json, "materials", c10ScenePolicy.maximumMaterials)) {
    const material = record(rawMaterial);
    const extras = record(material.extras);
    const allowed = [
      "authority",
      "c13CatalogBinding",
      "canonicalElementId",
      "canonicalElementType",
      "face",
      "materialSha256",
      "provenanceState",
    ];
    if (Object.keys(extras).some((key) => !allowed.includes(key))) {
      return failRenderScene("GLB_UNSAFE_CONTENT");
    }
    if (extras.authority !== "derived-visualisation-only") {
      return failRenderScene("GLB_UNSAFE_CONTENT");
    }
    if (extras.c13CatalogBinding !== undefined) {
      add(extras.canonicalElementId, extras.c13CatalogBinding);
    }
  }

  for (const rawCamera of arrayMember(json, "cameras", 1_000)) {
    const camera = record(rawCamera);
    const extras = record(camera.extras);
    if (!exactKeys(extras, ["canonicalElementId", "targetMm"])) {
      return failRenderScene("GLB_UNSAFE_CONTENT");
    }
  }

  return result;
}

function assertExtensionPolicy(json: Readonly<Record<string, unknown>>): void {
  const required = arrayMember(json, "extensionsRequired", 1);
  if (required.length > 0) return failRenderScene("GLB_UNSAFE_CONTENT");
  const used = arrayMember(json, "extensionsUsed", 1);
  if (used.some((value) => value !== "KHR_lights_punctual")) {
    return failRenderScene("GLB_UNSAFE_CONTENT");
  }
  if ((json.extensions !== undefined) !== used.includes("KHR_lights_punctual")) {
    return failRenderScene("GLB_INVALID");
  }
  for (const key of ["animations", "images", "samplers", "skins", "textures"] as const) {
    if (arrayMember(json, key, 1).length > 0) return failRenderScene("GLB_UNSAFE_CONTENT");
  }
}

function parseChunks(bytes: Uint8Array): {
  readonly binaryChunk: Uint8Array;
  readonly json: Record<string, unknown>;
} {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > c10ScenePolicy.maximumArtifactBytes) {
    return failRenderScene("GLB_RESOURCE_LIMIT");
  }
  if (bytes.byteLength < 20 || bytes.byteLength % 4 !== 0) {
    return failRenderScene("GLB_INVALID");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(0, true) !== glbMagic ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.byteLength
  ) {
    return failRenderScene("GLB_INVALID");
  }
  let offset = 12;
  let jsonChunk: Uint8Array | undefined;
  let binaryChunk = new Uint8Array();
  let chunkIndex = 0;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) return failRenderScene("GLB_INVALID");
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    if (chunkLength % 4 !== 0 || offset + 8 + chunkLength > bytes.byteLength) {
      return failRenderScene("GLB_INVALID");
    }
    const chunk = bytes.slice(offset + 8, offset + 8 + chunkLength);
    if (chunkIndex === 0 && chunkType === jsonChunkType && chunkLength > 0) jsonChunk = chunk;
    else if (chunkIndex === 1 && chunkType === binaryChunkType) binaryChunk = chunk;
    else return failRenderScene("GLB_INVALID");
    offset += 8 + chunkLength;
    chunkIndex += 1;
  }
  if (offset !== bytes.byteLength || jsonChunk === undefined) {
    return failRenderScene("GLB_INVALID");
  }
  return { binaryChunk, json: parseCanonicalJsonChunk(jsonChunk) };
}

export function parseProtectedC10Glb(bytes: Uint8Array): ParsedRenderGlb {
  const { binaryChunk, json } = parseChunks(bytes);
  const asset = record(json.asset);
  if (asset.version !== "2.0" || asset.generator !== "interior-design-scene-compiler/1.0.0") {
    return failRenderScene("C10_BINDING_MISMATCH");
  }
  assertExtensionPolicy(json);
  const specificationBinding = assetSpecificationBinding(asset);

  const buffers = arrayMember(json, "buffers", 1);
  if (binaryChunk.byteLength === 0) {
    if (buffers.length !== 0) return failRenderScene("GLB_INVALID");
  } else {
    if (buffers.length !== 1) return failRenderScene("GLB_INVALID");
    const buffer = record(buffers[0]);
    if (buffer.uri !== undefined) return failRenderScene("GLB_EXTERNAL_RESOURCE");
    const declaredLength = integerMember(buffer, "byteLength");
    if (declaredLength > binaryChunk.byteLength || binaryChunk.byteLength - declaredLength > 3) {
      return failRenderScene("GLB_INVALID");
    }
  }

  const bufferViews = arrayMember(json, "bufferViews", 200_000);
  const accessors = arrayMember(json, "accessors", 400_000);
  const ranges = accessors.map((candidate) =>
    accessorRange({
      accessor: record(candidate),
      binaryLength: binaryChunk.byteLength,
      bufferViews,
    }),
  );
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
        if (!Number.isFinite(value)) return failRenderScene("GLB_INVALID");
      }
    }
  }

  const materials = arrayMember(json, "materials", c10ScenePolicy.maximumMaterials);
  const meshes = arrayMember(json, "meshes", c10ScenePolicy.maximumNodes);
  let vertices = 0;
  let triangles = 0;
  const meshHasUv: boolean[] = [];
  for (const rawMesh of meshes) {
    const mesh = record(rawMesh);
    const primitives = arrayMember(mesh, "primitives", 2_000);
    if (primitives.length === 0 || mesh.weights !== undefined) {
      return failRenderScene("GLB_UNSAFE_CONTENT");
    }
    let allPrimitivesHaveUv = true;
    for (const rawPrimitive of primitives) {
      const primitive = record(rawPrimitive);
      if (integerMember(primitive, "mode", 4) !== 4 || primitive.targets !== undefined) {
        return failRenderScene("GLB_UNSAFE_CONTENT");
      }
      const attributes = record(primitive.attributes);
      const position = ranges[integerMember(attributes, "POSITION")];
      if (
        position === undefined ||
        position.componentType !== 5_126 ||
        position.componentCount !== 3
      ) {
        return failRenderScene("GLB_INVALID");
      }
      allPrimitivesHaveUv &&= attributes.TEXCOORD_0 !== undefined;
      for (const accessorIndex of Object.values(attributes)) {
        const attribute = ranges[integer(accessorIndex)];
        if (attribute === undefined || attribute.count !== position.count) {
          return failRenderScene("GLB_INVALID");
        }
      }
      if (primitive.material !== undefined && integer(primitive.material) >= materials.length) {
        return failRenderScene("GLB_INVALID");
      }
      const indices = ranges[integerMember(primitive, "indices")];
      if (indices === undefined || indices.componentCount !== 1 || indices.count % 3 !== 0) {
        return failRenderScene("GLB_INVALID");
      }
      for (let index = 0; index < indices.count; index += 1) {
        const value = readUnsignedIndex(
          binaryView,
          indices.byteOffset + index * indices.byteStride,
          indices.componentType,
        );
        if (value >= position.count) return failRenderScene("GLB_INVALID");
      }
      vertices += position.count;
      triangles += indices.count / 3;
      if (
        vertices > c10ScenePolicy.maximumVertices ||
        triangles > c10ScenePolicy.maximumTriangles
      ) {
        return failRenderScene("GLB_RESOURCE_LIMIT");
      }
    }
    meshHasUv.push(allPrimitivesHaveUv);
  }

  const cameras = arrayMember(json, "cameras", 1_000);
  const nodes = arrayMember(json, "nodes", c10ScenePolicy.maximumNodes);
  for (const rawNode of nodes) {
    const node = record(rawNode);
    if (node.mesh !== undefined && integer(node.mesh) >= meshes.length) {
      return failRenderScene("GLB_INVALID");
    }
    if (node.camera !== undefined && integer(node.camera) >= cameras.length) {
      return failRenderScene("GLB_INVALID");
    }
    if (node.matrix !== undefined || node.skin !== undefined || node.weights !== undefined) {
      return failRenderScene("GLB_UNSAFE_CONTENT");
    }
    for (const [key, expectedLength] of [
      ["rotation", 4],
      ["scale", 3],
      ["translation", 3],
    ] as const) {
      if (node[key] === undefined) continue;
      if (
        !Array.isArray(node[key]) ||
        node[key].length !== expectedLength ||
        node[key].some((value) => typeof value !== "number" || !Number.isFinite(value))
      ) {
        return failRenderScene("GLB_INVALID");
      }
    }
  }

  for (const scene of arrayMember(json, "scenes", 64)) {
    const roots = arrayMember(record(scene), "nodes", c10ScenePolicy.maximumNodes);
    for (const root of roots) {
      if (integer(root) >= nodes.length) return failRenderScene("GLB_INVALID");
    }
  }

  assertNoExtras(bufferViews);
  assertNoExtras(accessors);
  assertNoExtras(meshes);
  assertNoExtras(arrayMember(json, "scenes", 64));

  return Object.freeze({
    catalogBindingsByElement: collectCatalogBindings(json),
    counts: Object.freeze({
      materials: materials.length,
      meshes: meshes.length,
      nodes: nodes.length,
      triangles,
      vertices,
    }),
    json,
    meshHasUv: Object.freeze(meshHasUv),
    specificationBinding,
  });
}
