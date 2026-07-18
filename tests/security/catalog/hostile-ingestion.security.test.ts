import {
  CatalogError,
  catalogCanonicalBytes,
  parseCatalogSourceManifest,
  pinnedKhronosValidatorVersion,
  safeCatalogDiagnostic,
  validateAndCanonicalizePng,
  validateCatalogGlb,
  validateCatalogSourceAsset,
  type CatalogSourceArtifactRole,
  type CatalogSourceAsset,
} from "@interior-design/catalog";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const fixtureRoot = resolve(process.cwd(), "packages/catalog/fixtures/source");

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Synthetic catalog security fixture is incomplete.");
  return value;
}

async function artifactBytes(
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

function hostileManifest(
  source: unknown,
  mutate: (manifest: Record<string, unknown>) => void,
): Uint8Array {
  const candidate = structuredClone(source) as Record<string, unknown>;
  mutate(candidate);
  return catalogCanonicalBytes(candidate);
}

function rewriteGlbJson(
  bytes: Uint8Array,
  mutate: (json: Record<string, unknown>) => void,
): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).trimEnd(),
  ) as Record<string, unknown>;
  mutate(json);
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const paddedLength = (encoded.byteLength + 3) & ~3;
  const binaryHeader = 20 + jsonLength;
  const binaryLength = view.getUint32(binaryHeader, true);
  const binary = bytes.subarray(binaryHeader + 8, binaryHeader + 8 + binaryLength);
  const output = new Uint8Array(12 + 8 + paddedLength + 8 + binaryLength);
  output.fill(0x20, 20, 20 + paddedLength);
  const outputView = new DataView(output.buffer);
  outputView.setUint32(0, 0x46546c67, true);
  outputView.setUint32(4, 2, true);
  outputView.setUint32(8, output.byteLength, true);
  outputView.setUint32(12, paddedLength, true);
  outputView.setUint32(16, 0x4e4f534a, true);
  output.set(encoded, 20);
  const outputBinaryHeader = 20 + paddedLength;
  outputView.setUint32(outputBinaryHeader, binaryLength, true);
  outputView.setUint32(outputBinaryHeader + 4, 0x004e4942, true);
  output.set(binary, outputBinaryHeader + 8);
  return output;
}

describe("C13 hostile catalog-ingestion boundary", () => {
  let rawManifest: Uint8Array;
  let manifest: ReturnType<typeof parseCatalogSourceManifest>;

  beforeAll(async () => {
    rawManifest = Uint8Array.from(await readFile(resolve(fixtureRoot, "release.json")));
    manifest = parseCatalogSourceManifest(rawManifest);
  });

  it.each([
    [
      "remote URL",
      (asset: Record<string, unknown>) => {
        const artifacts = asset.artifacts as Array<Record<string, unknown>>;
        required(artifacts[0]).relativePath = "https://attacker.invalid/model.glb";
      },
    ],
    [
      "path traversal",
      (asset: Record<string, unknown>) => {
        const artifacts = asset.artifacts as Array<Record<string, unknown>>;
        required(artifacts[0]).relativePath = "assets/../secret.txt";
      },
    ],
    [
      "fabricated price",
      (asset: Record<string, unknown>) => {
        asset.price = "9.99";
      },
    ],
    [
      "training permission",
      (asset: Record<string, unknown>) => {
        const rights = asset.rights as Record<string, Record<string, unknown>>;
        required(rights.policy).trainingAllowed = true;
      },
    ],
  ])("rejects a manifest containing %s with a stable non-reflective error", (_name, mutate) => {
    const bytes = hostileManifest(manifest, (candidate) => {
      mutate(required((candidate.assets as Array<Record<string, unknown>>)[0]));
    });
    expect(() => parseCatalogSourceManifest(bytes)).toThrow(CatalogError);
    try {
      parseCatalogSourceManifest(bytes);
    } catch (error) {
      expect(safeCatalogDiagnostic(error).message).not.toContain("attacker.invalid");
      expect(safeCatalogDiagnostic(error).message).not.toContain("9.99");
    }
  });

  it.each([
    [
      "withdrawn review",
      (asset: Record<string, unknown>) => {
        const rights = asset.rights as Record<string, Record<string, unknown>>;
        required(rights.review).state = "withdrawn";
      },
    ],
    [
      "commercial grant denied",
      (asset: Record<string, unknown>) => {
        const rights = asset.rights as Record<string, Record<string, unknown>>;
        required(rights.grants).commercialUse = false;
      },
    ],
    [
      "unpinned SPDX list",
      (asset: Record<string, unknown>) => {
        const rights = asset.rights as Record<string, unknown>;
        rights.spdxLicenseListVersion = "future-unreviewed";
      },
    ],
  ])("quarantines %s before producing an approved catalog record", async (_name, mutate) => {
    const parsed = parseCatalogSourceManifest(
      hostileManifest(manifest, (candidate) => {
        mutate(required((candidate.assets as Array<Record<string, unknown>>)[0]));
      }),
    );
    const source = required(parsed.assets[0]);
    await expect(
      validateCatalogSourceAsset({
        bytesByRole: await artifactBytes(source),
        source,
        validator: {
          validate: () =>
            Promise.resolve({
              issueCodes: [],
              numErrors: 0,
              numWarnings: 0,
              validatorVersion: pinnedKhronosValidatorVersion,
            }),
        },
      }),
    ).rejects.toMatchObject({ safeCode: "CATALOG_RIGHTS_INVALID" });
  });

  it("rejects validator warnings, wrong versions and exceptions without reflecting validator data", async () => {
    const source = required(manifest.assets[0]);
    const bytesByRole = await artifactBytes(source);
    for (const validator of [
      {
        validate: () =>
          Promise.resolve({
            issueCodes: ["SYNTHETIC_WARNING"],
            numErrors: 0,
            numWarnings: 1,
            validatorVersion: pinnedKhronosValidatorVersion,
          }),
      },
      {
        validate: () =>
          Promise.resolve({
            issueCodes: [],
            numErrors: 0,
            numWarnings: 0,
            validatorVersion: "wrong-validator-version",
          }),
      },
      {
        validate: () => Promise.reject(new Error("Bearer synthetic-validator-secret")),
      },
    ]) {
      const operation = validateCatalogSourceAsset({ bytesByRole, source, validator });
      await expect(operation).rejects.toMatchObject({ safeCode: "CATALOG_VALIDATOR_FAILED" });
      await operation.catch((error: unknown) => {
        expect(safeCatalogDiagnostic(error).message).not.toContain("synthetic-validator-secret");
      });
    }
  });

  it("rejects GLB external resources and PNG metadata/corruption before publication", async () => {
    const source = required(manifest.assets[0]);
    const bytes = await artifactBytes(source);
    const model = rewriteGlbJson(required(bytes.get("model")), (json) => {
      const buffers = json.buffers as Array<Record<string, unknown>>;
      required(buffers[0]).uri = "https://attacker.invalid/buffer.bin";
    });
    expect(() => validateCatalogGlb(model, source.c12Asset)).toThrow(CatalogError);

    const png = Uint8Array.from(required(bytes.get("thumbnail")));
    png.set(new TextEncoder().encode("tEXt"), 12);
    expect(() => validateAndCanonicalizePng(png)).toThrow(CatalogError);
  });
});
