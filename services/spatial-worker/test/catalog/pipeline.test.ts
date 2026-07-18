import {
  catalogCanonicalBytes,
  parseCatalogSourceManifest,
  type CatalogSourceManifest,
} from "@interior-design/catalog";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { PinnedKhronosValidator } from "../../src/catalog/khronos-validator.js";
import { FileSystemCatalogPublicationStore } from "../../src/catalog/filesystem-publication.js";
import { CatalogIngestionPipeline } from "../../src/catalog/pipeline.js";
import { InMemoryCatalogPublicationStore } from "../../src/catalog/publication.js";
import { RepositoryCatalogSource, type CatalogSourceReader } from "../../src/catalog/source.js";

const fixtureRoot = resolve(import.meta.dirname, "../../../../packages/catalog/fixtures/source");

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Synthetic catalog fixture is incomplete.");
  return value;
}

async function createPipeline(
  options: {
    readonly hooks?: ConstructorParameters<typeof CatalogIngestionPipeline>[0]["hooks"];
    readonly publication?: InMemoryCatalogPublicationStore;
    readonly source?: CatalogSourceReader;
  } = {},
) {
  const publication = options.publication ?? new InMemoryCatalogPublicationStore();
  const source = options.source ?? (await RepositoryCatalogSource.create(fixtureRoot));
  return {
    pipeline: new CatalogIngestionPipeline({
      ...(options.hooks === undefined ? {} : { hooks: options.hooks }),
      publication,
      source,
      validator: new PinnedKhronosValidator(),
    }),
    publication,
  };
}

async function fixtureManifest(): Promise<CatalogSourceManifest> {
  return parseCatalogSourceManifest(await readFile(resolve(fixtureRoot, "release.json")));
}

describe("C13 deterministic catalog ingestion pipeline", () => {
  it("uses the real pinned validator and atomically publishes all eleven real assets", async () => {
    const { pipeline, publication } = await createPipeline();
    const result = await pipeline.ingest();
    expect(result.replayed).toBe(false);
    expect(result.publication.assets).toHaveLength(11);
    expect(publication.listVisibleReleases()).toEqual([result.publication.release]);
    expect(publication.findVisibleAssets(result.publication.release.releaseId)).toHaveLength(11);
    expect(publication.readObjectForTest(result.publication.release.manifestSha256)).toEqual(
      result.publication.manifestBytes,
    );
    for (const asset of result.publication.assets) {
      expect(asset.artifacts).toHaveLength(4);
      for (const artifact of asset.artifacts) {
        expect(publication.readObjectForTest(artifact.sha256)?.byteLength).toBe(
          artifact.byteLength,
        );
      }
    }
  });

  it("replays exactly and concurrent publishers expose one complete release head", async () => {
    const publication = new InMemoryCatalogPublicationStore();
    const first = await createPipeline({ publication });
    const second = await createPipeline({ publication });
    const [left, right] = await Promise.all([first.pipeline.ingest(), second.pipeline.ingest()]);
    expect([left.replayed, right.replayed].sort()).toEqual([false, true]);
    expect(left.publication.release).toEqual(right.publication.release);
    expect(publication.listVisibleReleases()).toHaveLength(1);
    const replay = await first.pipeline.ingest();
    expect(replay.replayed).toBe(true);
    expect(replay.publication.manifestBytes).toEqual(left.publication.manifestBytes);
  });

  it("uses an immutable filesystem head so concurrent processes expose no partial release", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "c13-catalog-publication-"));
    const leftStore = await FileSystemCatalogPublicationStore.create(temporary);
    const rightStore = await FileSystemCatalogPublicationStore.create(temporary);
    const source = await RepositoryCatalogSource.create(fixtureRoot);
    const left = new CatalogIngestionPipeline({
      publication: leftStore,
      source,
      validator: new PinnedKhronosValidator(),
    });
    const right = new CatalogIngestionPipeline({
      publication: rightStore,
      source,
      validator: new PinnedKhronosValidator(),
    });
    const [first, second] = await Promise.all([left.ingest(), right.ingest()]);
    expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
    expect(await leftStore.listVisibleReleases()).toEqual([first.publication.release]);
    expect(await rightStore.findVisibleAssets(first.publication.release.releaseId)).toHaveLength(
      11,
    );
  });

  it("keeps staged content invisible after crash or cancellation before the atomic head", async () => {
    const crashStore = new InMemoryCatalogPublicationStore();
    const crashing = await createPipeline({
      hooks: {
        afterStage(stage) {
          if (stage === "before-release-head") throw new Error("synthetic crash");
        },
      },
      publication: crashStore,
    });
    const crashed = await crashing.pipeline.execute();
    expect(crashed).toMatchObject({
      diagnostic: { code: "CATALOG_INTERNAL_FAILURE" },
      ok: false,
    });
    expect(crashStore.listVisibleReleases()).toEqual([]);
    expect(crashStore.objectCountForTest()).toBeGreaterThan(0);

    const controller = new AbortController();
    const cancelStore = new InMemoryCatalogPublicationStore();
    const cancelling = await createPipeline({
      hooks: {
        afterStage(stage) {
          if (stage === "before-release-head") controller.abort();
        },
      },
      publication: cancelStore,
    });
    await expect(cancelling.pipeline.ingest({ signal: controller.signal })).rejects.toMatchObject({
      safeCode: "CATALOG_CANCELLED",
    });
    expect(cancelStore.listVisibleReleases()).toEqual([]);
  });

  it("interrupts a stalled source read on cancellation without publishing anything", async () => {
    const controller = new AbortController();
    const publication = new InMemoryCatalogPublicationStore();
    const stalledSource: CatalogSourceReader = {
      read: () =>
        new Promise<Uint8Array>(() => {
          // Intentionally unresolved to exercise AbortSignal cancellation.
        }),
    };
    const pipeline = new CatalogIngestionPipeline({
      publication,
      source: stalledSource,
      validator: new PinnedKhronosValidator(),
    });
    const operation = pipeline.ingest({ signal: controller.signal });
    queueMicrotask(() => {
      controller.abort();
    });
    await expect(operation).rejects.toMatchObject({ safeCode: "CATALOG_CANCELLED" });
    expect(publication.listVisibleReleases()).toEqual([]);
    expect(publication.objectCountForTest()).toBe(0);
  });

  it("rejects changed bytes and same-version/different-body publication without partial state", async () => {
    const baseSource = await RepositoryCatalogSource.create(fixtureRoot);
    const manifest = await fixtureManifest();
    const changedSource: CatalogSourceReader = {
      async read(relativePath, maximumBytes) {
        const bytes = await baseSource.read(relativePath, maximumBytes);
        if (relativePath !== required(required(manifest.assets[0]).artifacts[0]).relativePath) {
          return bytes;
        }
        const changed = Uint8Array.from(bytes);
        changed[0] = (changed[0] ?? 0) ^ 1;
        return changed;
      },
    };
    const changedStore = new InMemoryCatalogPublicationStore();
    const changed = await createPipeline({ publication: changedStore, source: changedSource });
    await expect(changed.pipeline.ingest()).rejects.toMatchObject({
      safeCode: "CATALOG_ARTIFACT_HASH_MISMATCH",
    });
    expect(changedStore.listVisibleReleases()).toEqual([]);

    const conflictStore = new InMemoryCatalogPublicationStore();
    const initial = await createPipeline({ publication: conflictStore });
    await initial.pipeline.ingest();
    const conflictingManifest = catalogCanonicalBytes({
      ...manifest,
      createdAt: "2026-07-18T00:00:01.000Z",
    });
    const conflictSource: CatalogSourceReader = {
      read(relativePath, maximumBytes) {
        return relativePath === "release.json"
          ? Promise.resolve(conflictingManifest)
          : baseSource.read(relativePath, maximumBytes);
      },
    };
    const conflict = await createPipeline({ publication: conflictStore, source: conflictSource });
    await expect(conflict.pipeline.ingest()).rejects.toMatchObject({
      safeCode: "CATALOG_RELEASE_CONFLICT",
    });
    expect(conflictStore.listVisibleReleases()).toHaveLength(1);
  });

  it("rejects forged asset and release-manifest identities before installing a head", async () => {
    const sourceStore = new InMemoryCatalogPublicationStore();
    const source = await createPipeline({ publication: sourceStore });
    const { publication: accepted } = await source.pipeline.ingest();
    const forgedStore = new InMemoryCatalogPublicationStore();
    await expect(
      forgedStore.publishReleaseHead({
        ...accepted,
        assets: accepted.assets.map((asset, index) =>
          index === 0 ? { ...asset, versionSha256: "0".repeat(64) } : asset,
        ),
      }),
    ).rejects.toMatchObject({ safeCode: "CATALOG_RELEASE_CONFLICT" });
    const changedManifest = Uint8Array.from(accepted.manifestBytes);
    changedManifest[0] = (changedManifest[0] ?? 0) ^ 1;
    await expect(
      forgedStore.publishReleaseHead({ ...accepted, manifestBytes: changedManifest }),
    ).rejects.toMatchObject({ safeCode: "CATALOG_RELEASE_CONFLICT" });
    expect(forgedStore.listVisibleReleases()).toEqual([]);
  });

  it("rejects traversal and every symlink component before reading bytes", async () => {
    const source = await RepositoryCatalogSource.create(fixtureRoot);
    await expect(source.read("../release.json", 1_000_000)).rejects.toMatchObject({
      safeCode: "CATALOG_SOURCE_PATH_INVALID",
    });
    await expect(source.read("https://invalid.example/model.glb", 1_000_000)).rejects.toMatchObject(
      {
        safeCode: "CATALOG_SOURCE_PATH_INVALID",
      },
    );

    const temporary = await mkdtemp(join(tmpdir(), "c13-catalog-source-"));
    const outside = join(temporary, "outside");
    const root = join(temporary, "root");
    await mkdir(outside);
    await mkdir(root);
    await writeFile(join(outside, "model.glb"), Uint8Array.of(1, 2, 3));
    await symlink(outside, join(root, "linked"));
    const linkedSource = await RepositoryCatalogSource.create(root);
    await expect(linkedSource.read("linked/model.glb", 100)).rejects.toMatchObject({
      safeCode: "CATALOG_SOURCE_PATH_INVALID",
    });
  });
});
