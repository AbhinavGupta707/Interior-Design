import {
  buildCatalogRelease,
  parseCatalogSourceManifest,
  pinnedKhronosValidatorVersion,
  validateCatalogSourceAsset,
  type CatalogPublishedRelease,
  type CatalogSourceArtifactRole,
  type CatalogSourceAsset,
  type CatalogValidatedAsset,
} from "@interior-design/catalog";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const fixtureRoot = resolve(import.meta.dirname, "../../../../../packages/catalog/fixtures/source");

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

export interface CatalogApiFixture {
  readonly artifactBytes: ReadonlyMap<string, Uint8Array>;
  readonly publication: CatalogPublishedRelease;
}

export async function createCatalogApiFixture(): Promise<CatalogApiFixture> {
  const source = parseCatalogSourceManifest(await readFile(resolve(fixtureRoot, "release.json")));
  const validated: CatalogValidatedAsset[] = await Promise.all(
    source.assets.map(async (asset) =>
      validateCatalogSourceAsset({
        bytesByRole: await bytesFor(asset),
        source: asset,
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
    ),
  );
  return {
    artifactBytes: new Map(validated.flatMap(({ artifactBytes }) => [...artifactBytes])),
    publication: buildCatalogRelease(source, validated),
  };
}
