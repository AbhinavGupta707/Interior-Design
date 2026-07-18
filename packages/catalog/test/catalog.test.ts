import {
  CatalogError,
  assertExactC12StarterCoverage,
  buildCatalogRelease,
  c13CatalogPolicy,
  c13AlternativeAssetCatalog,
  c13CreatorOwnedAssetCatalog,
  catalogCanonicalBytes,
  isCatalogAssetSelectable,
  parseCatalogSourceManifest,
  pinnedKhronosValidatorVersion,
  sha256Bytes,
  validateAndCanonicalizePng,
  validateCatalogGlb,
  validateCatalogSourceAsset,
  type CatalogSourceArtifactRole,
  type CatalogSourceAsset,
  type CatalogSourceManifest,
  type CatalogValidatedAsset,
  type KhronosValidatorPort,
} from "../src/index.js";
import { creatorOwnedSyntheticAssetCatalog } from "@interior-design/interior-assets";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const fixtureRoot = resolve(import.meta.dirname, "../fixtures/source");
const validator: KhronosValidatorPort = {
  validate: () =>
    Promise.resolve({
      issueCodes: [],
      numErrors: 0,
      numWarnings: 0,
      validatorVersion: pinnedKhronosValidatorVersion,
    }),
};

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Synthetic catalog fixture is incomplete.");
  return value;
}

async function loadManifest(): Promise<CatalogSourceManifest> {
  return parseCatalogSourceManifest(await readFile(resolve(fixtureRoot, "release.json")));
}

async function bytesFor(
  source: CatalogSourceAsset,
): Promise<Map<CatalogSourceArtifactRole, Uint8Array>> {
  return new Map(
    await Promise.all(
      source.artifacts.map(
        async (artifact) =>
          [
            artifact.role,
            Uint8Array.from(await readFile(resolve(fixtureRoot, artifact.relativePath))),
          ] as const,
      ),
    ),
  );
}

async function validateAll(
  manifest: CatalogSourceManifest,
  selectedValidator: KhronosValidatorPort = validator,
): Promise<CatalogValidatedAsset[]> {
  return Promise.all(
    manifest.assets.map(async (source) =>
      validateCatalogSourceAsset({
        bytesByRole: await bytesFor(source),
        source,
        validator: selectedValidator,
      }),
    ),
  );
}

function mutateManifest(
  manifest: CatalogSourceManifest,
  mutation: (value: Record<string, unknown>) => void,
): Uint8Array {
  const value = structuredClone(manifest) as unknown as Record<string, unknown>;
  mutation(value);
  return catalogCanonicalBytes(value);
}

function rewriteGlbJson(
  bytes: Uint8Array,
  mutation: (json: Record<string, unknown>) => void,
): Uint8Array {
  const inputView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = inputView.getUint32(12, true);
  const jsonText = new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).trimEnd();
  const json = JSON.parse(jsonText) as Record<string, unknown>;
  mutation(json);
  const rawJson = new TextEncoder().encode(JSON.stringify(json));
  const paddedLength = (rawJson.byteLength + 3) & ~3;
  const binaryHeader = 20 + jsonLength;
  const binaryLength = inputView.getUint32(binaryHeader, true);
  const binary = bytes.subarray(binaryHeader + 8, binaryHeader + 8 + binaryLength);
  const output = new Uint8Array(12 + 8 + paddedLength + 8 + binaryLength);
  output.fill(0x20, 20, 20 + paddedLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, output.byteLength, true);
  view.setUint32(12, paddedLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  output.set(rawJson, 20);
  const newBinaryHeader = 20 + paddedLength;
  view.setUint32(newBinaryHeader, binaryLength, true);
  view.setUint32(newBinaryHeader + 4, 0x004e4942, true);
  output.set(binary, newBinaryHeader + 8);
  return output;
}

describe("C13 creator-owned catalog kernel", () => {
  it("wraps all eight exact immutable C12 refs and adds one useful alternative per kind", () => {
    expect(creatorOwnedSyntheticAssetCatalog.assets).toHaveLength(8);
    expect(c13AlternativeAssetCatalog.assets).toHaveLength(3);
    expect(new Set(c13AlternativeAssetCatalog.assets.map(({ ref }) => ref.kind))).toEqual(
      new Set(["finish", "furnishing", "light"]),
    );
    expect(c13CreatorOwnedAssetCatalog.assets).toHaveLength(11);
    expect(() => {
      assertExactC12StarterCoverage(
        c13CreatorOwnedAssetCatalog.assets.map(({ ref }) => ({
          artifacts: [],
          c12Asset: ref,
          description: "synthetic",
          displayName: "synthetic",
          material: {
            baseColourSrgb8: [0, 0, 0],
            emissiveSrgb8: [0, 0, 0],
            metallicBasisPoints: 0,
            name: "synthetic",
            physicalRepeatMm: null,
            roughnessBasisPoints: 0,
          },
          rights: {} as never,
          slug: ref.category,
          tags: [],
        })),
      );
    }).not.toThrow();
    for (const starter of creatorOwnedSyntheticAssetCatalog.assets) {
      const wrapped = c13CreatorOwnedAssetCatalog.assets.find(
        ({ ref }) => ref.versionId === starter.ref.versionId,
      );
      expect(wrapped?.ref).toEqual(starter.ref);
    }
  });

  it("parses the bounded local manifest and validates real GLB/PNG/text bytes", async () => {
    const manifest = await loadManifest();
    expect(manifest.assets).toHaveLength(11);
    const validated = await validateAll(manifest);
    expect(validated).toHaveLength(11);
    for (const asset of validated) {
      expect(asset.record.artifacts.map(({ role }) => role).sort()).toEqual([
        "licence-text",
        "model",
        "source-receipt",
        "thumbnail",
      ]);
      expect(asset.record.commercialData).toEqual({
        delivery: "not-provided",
        liveAvailability: "not-provided",
        price: "not-provided",
        supplier: "not-provided",
      });
      expect(asset.record.rights.policy.trainingAllowed).toBe(false);
      expect(isCatalogAssetSelectable(asset.record)).toBe(true);
    }
  });

  it("reproduces the same sorted release bytes and hashes across input ordering", async () => {
    const manifest = await loadManifest();
    const validated = await validateAll(manifest);
    const first = buildCatalogRelease(manifest, validated);
    const second = buildCatalogRelease(
      { ...manifest, assets: [...manifest.assets].reverse() },
      [...validated].reverse(),
    );
    expect(second.release).toEqual(first.release);
    expect(second.manifestBytes).toEqual(first.manifestBytes);
    expect(first.assets).toHaveLength(11);
    expect(first.release.assetVersionIds).toEqual([...first.release.assetVersionIds].sort());
    expect(first.release.manifestSha256).toBe(sha256Bytes(first.manifestBytes));
  });

  it("reads strict floor-centred +Y-up/+Z-front geometry with exact envelope bounds", async () => {
    const manifest = await loadManifest();
    for (const source of manifest.assets) {
      const model = await readFile(
        resolve(
          fixtureRoot,
          required(source.artifacts.find(({ role }) => role === "model")).relativePath,
        ),
      );
      const result = validateCatalogGlb(model, source.c12Asset);
      expect(result).toMatchObject({
        materials: 1,
        meshes: 1,
        nodes: 1,
        triangles: 12,
        vertices: 24,
      });
      expect(result.boundsMetres.minimum[1]).toBe(0);
    }
  });

  it("rejects truncated, URI-bearing, negative-scale, non-finite and envelope-mismatched GLB", async () => {
    const source = required((await loadManifest()).assets[0]);
    const model = required((await bytesFor(source)).get("model"));
    expect(() =>
      validateCatalogGlb(model.subarray(0, model.byteLength - 1), source.c12Asset),
    ).toThrow(CatalogError);
    expect(() =>
      validateCatalogGlb(
        rewriteGlbJson(model, (json) => {
          const buffers = json.buffers as Array<Record<string, unknown>>;
          required(buffers[0]).uri = "https://invalid.example/model.bin";
        }),
        source.c12Asset,
      ),
    ).toThrow(CatalogError);
    expect(() =>
      validateCatalogGlb(
        rewriteGlbJson(model, (json) => {
          const nodes = json.nodes as Array<Record<string, unknown>>;
          required(nodes[0]).scale = [-1, 1, 1];
        }),
        source.c12Asset,
      ),
    ).toThrow(CatalogError);
    const nonFinite = Uint8Array.from(model);
    const jsonLength = new DataView(nonFinite.buffer).getUint32(12, true);
    const binaryOffset = 20 + jsonLength + 8;
    new DataView(nonFinite.buffer).setUint32(binaryOffset, 0x7fc00000, true);
    expect(() => validateCatalogGlb(nonFinite, source.c12Asset)).toThrow(CatalogError);
    expect(() =>
      validateCatalogGlb(model, {
        ...source.c12Asset,
        geometryEnvelopeMm: {
          ...source.c12Asset.geometryEnvelopeMm,
          widthMm: source.c12Asset.geometryEnvelopeMm.widthMm + 3,
        },
      }),
    ).toThrow(CatalogError);
  });

  it("rejects metadata/APNG PNGs, resource abuse, hostile manifest keys and changed bytes", async () => {
    const manifest = await loadManifest();
    const source = required(manifest.assets[0]);
    const sourceBytes = await bytesFor(source);
    const thumbnail = required(sourceBytes.get("thumbnail"));
    expect(validateAndCanonicalizePng(thumbnail).bytes).toEqual(thumbnail);
    const badSignature = Uint8Array.from(thumbnail);
    badSignature[0] = 0;
    expect(() => validateAndCanonicalizePng(badSignature)).toThrow(CatalogError);
    const bombHeader = Uint8Array.from(thumbnail);
    new DataView(bombHeader.buffer).setUint32(16, 4_097, false);
    expect(() => validateAndCanonicalizePng(bombHeader)).toThrow(CatalogError);
    const forgedManifest = mutateManifest(manifest, (value) => {
      value.catalogUrl = "https://invalid.example/catalog";
    });
    expect(() => parseCatalogSourceManifest(forgedManifest)).toThrow(CatalogError);
    const changed = new Map(sourceBytes);
    const changedReceipt = Uint8Array.from(required(changed.get("source-receipt")));
    changedReceipt[0] = (changedReceipt[0] ?? 0) ^ 1;
    changed.set("source-receipt", changedReceipt);
    await expect(
      validateCatalogSourceAsset({ bytesByRole: changed, source, validator }),
    ).rejects.toMatchObject({ safeCode: "CATALOG_ARTIFACT_HASH_MISMATCH" });
  });

  it("enforces frozen resource ceilings before allocating or traversing oversized content", async () => {
    const source = required((await loadManifest()).assets[0]);
    expect(() =>
      parseCatalogSourceManifest(new Uint8Array(c13CatalogPolicy.maximumReleaseManifestBytes + 1)),
    ).toThrow(expect.objectContaining({ safeCode: "CATALOG_RESOURCE_LIMIT" }));
    expect(() =>
      validateCatalogGlb(new Uint8Array(c13CatalogPolicy.maximumGlbBytes + 1), source.c12Asset),
    ).toThrow(expect.objectContaining({ safeCode: "CATALOG_GLB_RESOURCE_LIMIT" }));
    const model = required((await bytesFor(source)).get("model"));
    expect(() =>
      validateCatalogGlb(
        rewriteGlbJson(model, (json) => {
          json.nodes = Array.from({ length: c13CatalogPolicy.maximumGlbNodes + 1 }, () => ({}));
        }),
        source.c12Asset,
      ),
    ).toThrow(expect.objectContaining({ safeCode: "CATALOG_GLB_RESOURCE_LIMIT" }));
  });

  it("rejects sampled single-byte mutations for every fixture artifact before parsing", async () => {
    const source = required((await loadManifest()).assets[0]);
    const original = await bytesFor(source);
    for (const [role, bytes] of original) {
      for (const offset of new Set([0, Math.floor(bytes.byteLength / 2), bytes.byteLength - 1])) {
        const mutated = new Map(original);
        const attacked = Uint8Array.from(bytes);
        attacked[offset] = (attacked[offset] ?? 0) ^ 1;
        mutated.set(role, attacked);
        await expect(
          validateCatalogSourceAsset({ bytesByRole: mutated, source, validator }),
        ).rejects.toMatchObject({ safeCode: "CATALOG_ARTIFACT_HASH_MISMATCH" });
      }
    }
  });

  it("fails closed for changed rights, missing starter refs and non-clean/wrong validator", async () => {
    const manifest = await loadManifest();
    expect(() =>
      parseCatalogSourceManifest(
        mutateManifest(manifest, (value) => {
          const assets = value.assets as Array<Record<string, unknown>>;
          const rights = required(assets[0]).rights as Record<string, unknown>;
          const policy = rights.policy as Record<string, unknown>;
          policy.trainingAllowed = true;
        }),
      ),
    ).toThrow(CatalogError);
    const mismatchedMaterialManifest = parseCatalogSourceManifest(
      mutateManifest(manifest, (value) => {
        const assets = value.assets as Array<Record<string, unknown>>;
        const material = required(assets[0]).material as Record<string, unknown>;
        material.baseColourSrgb8 = [1, 2, 3];
      }),
    );
    const mismatchedMaterialSource = required(mismatchedMaterialManifest.assets[0]);
    await expect(
      validateCatalogSourceAsset({
        bytesByRole: await bytesFor(mismatchedMaterialSource),
        source: mismatchedMaterialSource,
        validator,
      }),
    ).rejects.toMatchObject({ safeCode: "CATALOG_GLB_INVALID" });
    const omittedStarterVersionId = required(creatorOwnedSyntheticAssetCatalog.assets[0]).ref
      .versionId;
    expect(() => {
      assertExactC12StarterCoverage(
        manifest.assets.filter(({ c12Asset }) => c12Asset.versionId !== omittedStarterVersionId),
      );
    }).toThrow(CatalogError);
    const source = required(manifest.assets[0]);
    await expect(
      validateCatalogSourceAsset({
        bytesByRole: await bytesFor(source),
        source,
        validator: {
          validate: () =>
            Promise.resolve({
              issueCodes: ["ACCESSOR_INVALID"],
              numErrors: 0,
              numWarnings: 1,
              validatorVersion: pinnedKhronosValidatorVersion,
            }),
        },
      }),
    ).rejects.toMatchObject({ safeCode: "CATALOG_VALIDATOR_FAILED" });
    await expect(
      validateCatalogSourceAsset({
        bytesByRole: await bytesFor(source),
        source,
        validator: {
          validate: () =>
            Promise.resolve({
              issueCodes: [],
              numErrors: 0,
              numWarnings: 0,
              validatorVersion: "unpinned",
            }),
        },
      }),
    ).rejects.toMatchObject({ safeCode: "CATALOG_VALIDATOR_FAILED" });
  });
});
