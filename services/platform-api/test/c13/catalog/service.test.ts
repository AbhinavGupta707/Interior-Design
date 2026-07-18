import { describe, expect, it } from "vitest";

import { InMemoryCatalogRepository } from "../../../src/modules/catalog/memory.js";
import { CatalogService } from "../../../src/modules/catalog/service.js";
import { InMemoryCatalogArtifactStorage } from "../../../src/modules/catalog/storage.js";
import { alphaProjectId, alphaTenantId } from "../../c4/fixtures.js";
import { createCatalogApiFixture } from "./support.js";

const now = new Date("2026-07-18T12:00:00.000Z");

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Synthetic catalog API fixture is incomplete.");
  return value;
}

describe("C13 catalog service selection boundary", () => {
  it("allows an exact available published selection and rejects forged release or asset hashes", async () => {
    const fixture = await createCatalogApiFixture();
    const repository = new InMemoryCatalogRepository([
      { assets: fixture.publication.assets, release: fixture.publication.release },
    ]);
    const storage = new InMemoryCatalogArtifactStorage({ now: () => now });
    for (const asset of fixture.publication.assets) {
      for (const artifact of asset.artifacts) {
        storage.putForTest(artifact, required(fixture.artifactBytes.get(artifact.artifactId)));
      }
    }
    const service = new CatalogService({ repository, storage });
    const asset = required(fixture.publication.assets[0]);
    const input = {
      assetVersionId: asset.versionId,
      expectedReleaseSha256: fixture.publication.release.manifestSha256,
      expectedVersionSha256: asset.versionSha256,
      projectId: alphaProjectId,
      releaseId: fixture.publication.release.releaseId,
      tenantId: alphaTenantId,
    };
    await expect(service.requireSelectableAsset(input)).resolves.toEqual(asset);
    await expect(
      service.requireSelectableAsset({ ...input, expectedReleaseSha256: "0".repeat(64) }),
    ).rejects.toMatchObject({ code: "CATALOG_RELEASE_NOT_SELECTABLE", statusCode: 409 });
    await expect(
      service.requireSelectableAsset({ ...input, expectedVersionSha256: "0".repeat(64) }),
    ).rejects.toMatchObject({ code: "CATALOG_ASSET_NOT_SELECTABLE", statusCode: 409 });
  });

  it("keeps a withdrawn release readable while blocking it from every new selection", async () => {
    const fixture = await createCatalogApiFixture();
    const withdrawn = { ...fixture.publication.release, status: "withdrawn" as const };
    const repository = new InMemoryCatalogRepository([
      { assets: fixture.publication.assets, release: withdrawn },
    ]);
    const service = new CatalogService({
      repository,
      storage: new InMemoryCatalogArtifactStorage({ now: () => now }),
    });
    await expect(
      service.getRelease(alphaTenantId, alphaProjectId, withdrawn.releaseId),
    ).resolves.toEqual(withdrawn);
    const asset = required(fixture.publication.assets[0]);
    await expect(
      service.getAsset(alphaTenantId, alphaProjectId, withdrawn.releaseId, asset.versionId),
    ).resolves.toEqual(asset);
    await expect(
      service.requireSelectableAsset({
        assetVersionId: asset.versionId,
        expectedReleaseSha256: withdrawn.manifestSha256,
        expectedVersionSha256: asset.versionSha256,
        projectId: alphaProjectId,
        releaseId: withdrawn.releaseId,
        tenantId: alphaTenantId,
      }),
    ).rejects.toMatchObject({ code: "CATALOG_RELEASE_NOT_SELECTABLE", statusCode: 409 });
  });

  it("fails closed when one immutable artifact is absent or has the wrong bytes", async () => {
    const fixture = await createCatalogApiFixture();
    const repository = new InMemoryCatalogRepository([
      { assets: fixture.publication.assets, release: fixture.publication.release },
    ]);
    const storage = new InMemoryCatalogArtifactStorage({ now: () => now });
    const asset = required(fixture.publication.assets[0]);
    const missing = required(asset.artifacts[0]);
    for (const artifact of asset.artifacts.slice(1)) {
      storage.putForTest(artifact, required(fixture.artifactBytes.get(artifact.artifactId)));
    }
    const service = new CatalogService({ repository, storage });
    await expect(
      service.requireSelectableAsset({
        assetVersionId: asset.versionId,
        expectedReleaseSha256: fixture.publication.release.manifestSha256,
        expectedVersionSha256: asset.versionSha256,
        projectId: alphaProjectId,
        releaseId: fixture.publication.release.releaseId,
        tenantId: alphaTenantId,
      }),
    ).rejects.toMatchObject({ code: "CATALOG_ARTIFACT_MISSING", statusCode: 409 });
    expect(() => {
      storage.putForTest(missing, new Uint8Array(missing.byteLength));
    }).toThrow("The catalog artifact-storage operation failed.");
  });
});
