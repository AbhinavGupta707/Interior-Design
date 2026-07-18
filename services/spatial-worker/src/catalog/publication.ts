import {
  CatalogError,
  catalogCanonicalBytes,
  catalogSha256,
  deterministicCatalogUuid,
  isCatalogAssetSelectable,
  sha256Bytes,
  type CatalogPublishedRelease,
} from "@interior-design/catalog";
import {
  catalogAssetVersionSchema,
  catalogReleaseSchema,
  type CatalogAssetVersion,
  type CatalogRelease,
} from "@interior-design/contracts";

export interface PutCatalogObjectInput {
  readonly bytes: Uint8Array;
  readonly mediaType:
    "application/json" | "image/png" | "model/gltf-binary" | "text/plain; charset=utf-8";
  readonly sha256: string;
}

export interface CatalogPublicationStore {
  publishReleaseHead(
    publication: CatalogPublishedRelease,
  ): Promise<{ readonly release: CatalogRelease; readonly replayed: boolean }>;
  putContentAddressed(input: PutCatalogObjectInput): Promise<void>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function conflict(): never {
  throw new CatalogError("CATALOG_RELEASE_CONFLICT");
}

export function validateCatalogPublication(
  publication: CatalogPublishedRelease,
): CatalogPublishedRelease {
  const release = catalogReleaseSchema.safeParse(publication.release);
  const assets = publication.assets.map((asset) => catalogAssetVersionSchema.safeParse(asset));
  if (
    !release.success ||
    assets.some((asset) => !asset.success) ||
    release.data.status !== "published"
  ) {
    conflict();
  }
  const parsedAssets = assets.map((asset) => {
    if (!asset.success) conflict();
    const { versionSha256, ...core } = asset.data;
    if (catalogSha256(core) !== versionSha256 || !isCatalogAssetSelectable(asset.data)) conflict();
    return asset.data;
  });
  const sortedIds = parsedAssets.map(({ versionId }) => versionId).sort();
  if (
    sortedIds.length !== release.data.assetVersionIds.length ||
    sortedIds.some((versionId, index) => versionId !== release.data.assetVersionIds[index]) ||
    parsedAssets.some(({ versionId }, index) => versionId !== sortedIds[index])
  ) {
    conflict();
  }
  const expectedManifestBytes = catalogCanonicalBytes({
    assets: parsedAssets.map(({ assetId, versionId, versionSha256 }) => ({
      assetId,
      versionId,
      versionSha256,
    })),
    createdAt: release.data.createdAt,
    releaseVersion: release.data.version,
    schemaVersion: "c13-catalog-release-manifest-v1",
  });
  if (
    !Buffer.from(expectedManifestBytes).equals(Buffer.from(publication.manifestBytes)) ||
    sha256Bytes(publication.manifestBytes) !== release.data.manifestSha256 ||
    release.data.releaseId !==
      deterministicCatalogUuid(`c13:release:${release.data.manifestSha256}`)
  ) {
    conflict();
  }
  return {
    assets: clone(parsedAssets),
    manifestBytes: Uint8Array.from(publication.manifestBytes),
    release: clone(release.data),
  };
}

export class InMemoryCatalogPublicationStore implements CatalogPublicationStore {
  readonly #assetsByRelease = new Map<string, readonly CatalogAssetVersion[]>();
  readonly #objects = new Map<string, { readonly bytes: Uint8Array; readonly mediaType: string }>();
  readonly #releaseById = new Map<string, CatalogRelease>();
  readonly #releaseByVersion = new Map<string, CatalogRelease>();

  putContentAddressed(input: PutCatalogObjectInput): Promise<void> {
    if (sha256Bytes(input.bytes) !== input.sha256) {
      return Promise.reject(new CatalogError("CATALOG_ARTIFACT_HASH_MISMATCH"));
    }
    const existing = this.#objects.get(input.sha256);
    if (
      existing !== undefined &&
      (existing.mediaType !== input.mediaType ||
        !Buffer.from(existing.bytes).equals(Buffer.from(input.bytes)))
    ) {
      return Promise.reject(new CatalogError("CATALOG_RELEASE_CONFLICT"));
    }
    this.#objects.set(input.sha256, {
      bytes: Uint8Array.from(input.bytes),
      mediaType: input.mediaType,
    });
    return Promise.resolve();
  }

  publishReleaseHead(
    publication: CatalogPublishedRelease,
  ): Promise<{ readonly release: CatalogRelease; readonly replayed: boolean }> {
    let validated: CatalogPublishedRelease;
    try {
      validated = validateCatalogPublication(publication);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : conflict());
    }
    const { release } = validated;
    if (!this.#objects.has(release.manifestSha256)) {
      return Promise.reject(new CatalogError("CATALOG_RELEASE_CONFLICT"));
    }
    const storedManifest = this.#objects.get(release.manifestSha256);
    if (
      storedManifest?.mediaType !== "application/json" ||
      !Buffer.from(storedManifest.bytes).equals(Buffer.from(validated.manifestBytes))
    ) {
      return Promise.reject(new CatalogError("CATALOG_RELEASE_CONFLICT"));
    }
    for (const asset of validated.assets) {
      for (const artifact of asset.artifacts) {
        const stored = this.#objects.get(artifact.sha256);
        if (
          stored?.mediaType !== artifact.mediaType ||
          stored.bytes.byteLength !== artifact.byteLength ||
          sha256Bytes(stored.bytes) !== artifact.sha256
        ) {
          return Promise.reject(new CatalogError("CATALOG_RELEASE_CONFLICT"));
        }
      }
    }
    const existingId = this.#releaseById.get(release.releaseId);
    const existingVersion = this.#releaseByVersion.get(release.version);
    if (existingId !== undefined || existingVersion !== undefined) {
      const existing = existingId ?? existingVersion;
      if (
        existing?.releaseId !== release.releaseId ||
        existing.manifestSha256 !== release.manifestSha256
      ) {
        return Promise.reject(new CatalogError("CATALOG_RELEASE_CONFLICT"));
      }
      return Promise.resolve({ release: clone(existing), replayed: true });
    }
    this.#releaseById.set(release.releaseId, clone(release));
    this.#releaseByVersion.set(release.version, clone(release));
    this.#assetsByRelease.set(release.releaseId, clone(validated.assets));
    return Promise.resolve({ release: clone(release), replayed: false });
  }

  listVisibleReleases(): readonly CatalogRelease[] {
    return [...this.#releaseById.values()]
      .map(clone)
      .sort((left, right) =>
        left.version < right.version ? -1 : left.version > right.version ? 1 : 0,
      );
  }

  findVisibleAssets(releaseId: string): readonly CatalogAssetVersion[] | undefined {
    const assets = this.#assetsByRelease.get(releaseId);
    return assets === undefined ? undefined : clone(assets);
  }

  readObjectForTest(sha256: string): Uint8Array | undefined {
    const found = this.#objects.get(sha256);
    return found === undefined ? undefined : Uint8Array.from(found.bytes);
  }

  objectCountForTest(): number {
    return this.#objects.size;
  }
}
