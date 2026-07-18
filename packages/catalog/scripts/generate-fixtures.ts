import {
  c13CreatorOwnedAssetCatalog,
  catalogCanonicalBytes,
  catalogSourceManifestSchemaVersion,
  encodeDeterministicRgbaPng,
  sha256Bytes,
} from "../src/index.js";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = resolve(packageRoot, "fixtures/source");

const palette: Readonly<Record<string, readonly [number, number, number]>> = {
  "coffee-table": [154, 112, 74],
  "compact-armchair": [79, 111, 137],
  "floor-finish-mineral-tone": [142, 139, 132],
  "floor-finish-timber-tone": [166, 123, 77],
  "floor-light": [118, 114, 108],
  "lounge-chair": [134, 116, 101],
  "low-storage-console": [184, 178, 167],
  "pendant-light": [190, 158, 105],
  "three-seat-sofa": [158, 120, 91],
  "wall-finish-warm-neutral": [211, 199, 180],
  "wall-sconce": [173, 129, 72],
};

const licenceText = new TextEncoder().encode(
  [
    "LicenseRef-InteriorDesign-CreatorOwned-Synthetic",
    "",
    "These synthetic catalog fixtures were created for the Interior Design repository.",
    "Service processing, project design derivatives, thumbnail display, commercial service use, and rendered-output distribution are permitted.",
    "Raw fixture redistribution and model-training use are not permitted.",
    "No third-party product, brand, price, stock, delivery, or supplier claim is attached.",
    "",
  ].join("\n"),
);

function align4(value: number): number {
  return (value + 3) & ~3;
}

function pad(bytes: Uint8Array, byte: number): Uint8Array {
  const output = new Uint8Array(align4(bytes.byteLength));
  output.fill(byte);
  output.set(bytes);
  return output;
}

function writeFloat32(output: Uint8Array, offset: number, values: readonly number[]): void {
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  values.forEach((value, index) => view.setFloat32(offset + index * 4, value, true));
}

function writeUint16(output: Uint8Array, offset: number, values: readonly number[]): void {
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  values.forEach((value, index) => view.setUint16(offset + index * 2, value, true));
}

function createBoxGlb(input: {
  readonly depthMm: number;
  readonly heightMm: number;
  readonly material: {
    readonly baseColourSrgb8: readonly [number, number, number];
    readonly emissiveSrgb8: readonly [number, number, number];
    readonly metallicBasisPoints: number;
    readonly name: string;
    readonly roughnessBasisPoints: number;
  };
  readonly name: string;
  readonly widthMm: number;
}): Uint8Array {
  const x = input.widthMm / 2_000;
  const y = input.heightMm / 1_000;
  const z = input.depthMm / 2_000;
  const faces = [
    {
      normal: [0, 0, 1],
      points: [
        [-x, 0, z],
        [x, 0, z],
        [x, y, z],
        [-x, y, z],
      ],
    },
    {
      normal: [0, 0, -1],
      points: [
        [x, 0, -z],
        [-x, 0, -z],
        [-x, y, -z],
        [x, y, -z],
      ],
    },
    {
      normal: [1, 0, 0],
      points: [
        [x, 0, z],
        [x, 0, -z],
        [x, y, -z],
        [x, y, z],
      ],
    },
    {
      normal: [-1, 0, 0],
      points: [
        [-x, 0, -z],
        [-x, 0, z],
        [-x, y, z],
        [-x, y, -z],
      ],
    },
    {
      normal: [0, 1, 0],
      points: [
        [-x, y, z],
        [x, y, z],
        [x, y, -z],
        [-x, y, -z],
      ],
    },
    {
      normal: [0, -1, 0],
      points: [
        [-x, 0, -z],
        [x, 0, -z],
        [x, 0, z],
        [-x, 0, z],
      ],
    },
  ] as const;
  const positions = faces.flatMap(({ points }) => points.flat());
  const normals = faces.flatMap(({ normal }) => [normal, normal, normal, normal].flat());
  const uvs = faces.flatMap(() => [0, 0, 1, 0, 1, 1, 0, 1]);
  const indices = faces.flatMap((_, face) => {
    const base = face * 4;
    return [base, base + 1, base + 2, base, base + 2, base + 3];
  });
  const positionOffset = 0;
  const positionLength = positions.length * 4;
  const normalOffset = positionOffset + positionLength;
  const normalLength = normals.length * 4;
  const uvOffset = normalOffset + normalLength;
  const uvLength = uvs.length * 4;
  const indexOffset = uvOffset + uvLength;
  const indexLength = indices.length * 2;
  const binary = new Uint8Array(align4(indexOffset + indexLength));
  writeFloat32(binary, positionOffset, positions);
  writeFloat32(binary, normalOffset, normals);
  writeFloat32(binary, uvOffset, uvs);
  writeUint16(binary, indexOffset, indices);
  const srgb8ToLinear = (component: number): number => {
    const srgb = component / 255;
    return srgb <= 0.040_45 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  const [red, green, blue] = input.material.baseColourSrgb8.map(srgb8ToLinear) as [
    number,
    number,
    number,
  ];
  const [emissiveRed, emissiveGreen, emissiveBlue] = input.material.emissiveSrgb8.map(
    srgb8ToLinear,
  ) as [number, number, number];
  const gltf = {
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 24,
        max: [x, y, z],
        min: [-x, 0, -z],
        type: "VEC3",
      },
      { bufferView: 1, componentType: 5126, count: 24, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: 24, type: "VEC2" },
      { bufferView: 3, componentType: 5123, count: 36, max: [23], min: [0], type: "SCALAR" },
    ],
    asset: {
      copyright:
        "Interior Design creator-authored synthetic fixture; metadata is not a rights conclusion",
      generator: "interior-design-c13-fixture-generator/1.0.0",
      version: "2.0",
    },
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: [
      { buffer: 0, byteLength: positionLength, byteOffset: positionOffset, target: 34962 },
      { buffer: 0, byteLength: normalLength, byteOffset: normalOffset, target: 34962 },
      { buffer: 0, byteLength: uvLength, byteOffset: uvOffset, target: 34962 },
      { buffer: 0, byteLength: indexLength, byteOffset: indexOffset, target: 34963 },
    ],
    materials: [
      {
        alphaMode: "OPAQUE",
        doubleSided: false,
        emissiveFactor: [emissiveRed, emissiveGreen, emissiveBlue],
        name: input.material.name,
        pbrMetallicRoughness: {
          baseColorFactor: [red, green, blue, 1],
          metallicFactor: input.material.metallicBasisPoints / 10_000,
          roughnessFactor: input.material.roughnessBasisPoints / 10_000,
        },
      },
    ],
    meshes: [
      {
        name: `${input.name} bounded catalog geometry`,
        primitives: [
          {
            attributes: { NORMAL: 1, POSITION: 0, TEXCOORD_0: 2 },
            indices: 3,
            material: 0,
            mode: 4,
          },
        ],
      },
    ],
    nodes: [{ mesh: 0, name: input.name }],
    scene: 0,
    scenes: [{ nodes: [0] }],
  };
  const json = pad(new TextEncoder().encode(JSON.stringify(gltf)), 0x20);
  const totalLength = 12 + 8 + json.byteLength + 8 + binary.byteLength;
  const output = new Uint8Array(totalLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, json.byteLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  output.set(json, 20);
  const binaryHeader = 20 + json.byteLength;
  view.setUint32(binaryHeader, binary.byteLength, true);
  view.setUint32(binaryHeader + 4, 0x004e4942, true);
  output.set(binary, binaryHeader + 8);
  return output;
}

function createThumbnail(
  colour: readonly [number, number, number],
  kind: "finish" | "furnishing" | "light",
): Uint8Array {
  const size = 512;
  const pixels = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const offset = (row * size + column) * 4;
      const border = row < 20 || column < 20 || row >= size - 20 || column >= size - 20;
      const grid = kind === "finish" && (row % 64 < 2 || column % 64 < 2);
      const glow = kind === "light" && Math.hypot(column - 256, row - 236) < 122;
      const scale = border ? 0.45 : grid ? 0.72 : glow ? 1.12 : 1;
      pixels[offset] = Math.min(255, Math.round(colour[0] * scale));
      pixels[offset + 1] = Math.min(255, Math.round(colour[1] * scale));
      pixels[offset + 2] = Math.min(255, Math.round(colour[2] * scale));
      pixels[offset + 3] = 255;
    }
  }
  return encodeDeterministicRgbaPng(pixels, size, size);
}

async function persist(relativePath: string, bytes: Uint8Array): Promise<void> {
  const absolutePath = resolve(fixtureRoot, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);
}

async function main(): Promise<void> {
  await persist("licence/creator-owned-synthetic.txt", licenceText);
  const rights = {
    concludedLicenceExpression: "LicenseRef-InteriorDesign-CreatorOwned-Synthetic",
    creator: "Interior Design synthetic fixture team",
    declaredLicenceExpression: "LicenseRef-InteriorDesign-CreatorOwned-Synthetic",
    grants: {
      commercialUse: true,
      derivatives: true,
      rawRedistribution: false,
      renderedOutputDistribution: true,
      thumbnailDisplay: true,
    },
    policy: { serviceProcessingAllowed: true, trainingAllowed: false },
    review: {
      reviewedAt: "2026-07-18T00:00:00.000Z",
      reviewerUserId: "4b0785cd-aeac-56e9-902b-811c19bf9231",
      state: "approved",
    },
    sourceKind: "creator-owned-synthetic",
    spdxLicenseListVersion: "3.0.1",
  } as const;
  const assets = [];
  for (const { ref } of c13CreatorOwnedAssetCatalog.assets) {
    const slug = ref.category;
    const colour = palette[slug];
    if (colour === undefined) throw new Error(`Missing deterministic palette for ${slug}`);
    const material = {
      baseColourSrgb8: colour,
      emissiveSrgb8: ref.kind === "light" ? ([255, 208, 142] as const) : ([0, 0, 0] as const),
      metallicBasisPoints: ref.kind === "light" ? 2_000 : 0,
      name: `${ref.materialLabel} material`,
      physicalRepeatMm: ref.kind === "finish" ? { heightMm: 1_000, widthMm: 1_000 } : null,
      roughnessBasisPoints: ref.kind === "finish" ? 8_200 : 7_200,
    };
    const model = createBoxGlb({ ...ref.geometryEnvelopeMm, material, name: ref.category });
    const thumbnail = createThumbnail(colour, ref.kind);
    const receipt = new TextEncoder().encode(
      [
        "C13 creator-owned synthetic source receipt",
        `asset-id: ${ref.id}`,
        `asset-version-id: ${ref.versionId}`,
        `category: ${ref.category}`,
        "created-by: Interior Design synthetic fixture team",
        "created-at: 2026-07-18T00:00:00.000Z",
        "external-network-used: false",
        "third-party-source-used: false",
        "training-allowed: false",
        "",
      ].join("\n"),
    );
    const modelPath = `assets/${slug}/model.glb`;
    const thumbnailPath = `assets/${slug}/thumbnail.png`;
    const receiptPath = `assets/${slug}/source-receipt.txt`;
    await persist(modelPath, model);
    await persist(thumbnailPath, thumbnail);
    await persist(receiptPath, receipt);
    assets.push({
      artifacts: [
        {
          mediaType: "text/plain; charset=utf-8",
          relativePath: "licence/creator-owned-synthetic.txt",
          role: "licence-text",
          sha256: sha256Bytes(licenceText),
        },
        {
          mediaType: "model/gltf-binary",
          relativePath: modelPath,
          role: "model",
          sha256: sha256Bytes(model),
        },
        {
          mediaType: "text/plain; charset=utf-8",
          relativePath: receiptPath,
          role: "source-receipt",
          sha256: sha256Bytes(receipt),
        },
        {
          mediaType: "image/png",
          relativePath: thumbnailPath,
          role: "thumbnail",
          sha256: sha256Bytes(thumbnail),
        },
      ],
      c12Asset: ref,
      description: `${ref.category} creator-authored generic synthetic asset with explicit integer envelope and bounded placement policy.`,
      displayName: ref.category
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" "),
      material,
      rights,
      slug,
      tags: ["creator-owned", "generic", ref.kind, "synthetic"].sort(),
    });
  }
  assets.sort((left, right) =>
    left.c12Asset.versionId < right.c12Asset.versionId
      ? -1
      : left.c12Asset.versionId > right.c12Asset.versionId
        ? 1
        : 0,
  );
  const manifest = catalogCanonicalBytes({
    assets,
    createdAt: "2026-07-18T00:00:00.000Z",
    releaseVersion: "1.0.0",
    schemaVersion: catalogSourceManifestSchemaVersion,
  });
  await persist("release.json", manifest);
}

await main();
