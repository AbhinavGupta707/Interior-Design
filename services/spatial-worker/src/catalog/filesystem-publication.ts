import {
  CatalogError,
  catalogCanonicalBytes,
  parseCatalogCanonicalJson,
  sha256Bytes,
  type CatalogPublishedRelease,
} from "@interior-design/catalog";
import {
  catalogAssetVersionSchema,
  catalogReleaseSchema,
  type CatalogAssetVersion,
  type CatalogRelease,
} from "@interior-design/contracts";
import { link, lstat, mkdir, open, readFile, readdir, realpath, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join } from "node:path";

import type { CatalogPublicationStore, PutCatalogObjectInput } from "./publication.js";
import { validateCatalogPublication } from "./publication.js";

interface StoredReleaseHead {
  readonly assets: readonly CatalogAssetVersion[];
  readonly release: CatalogRelease;
  readonly schemaVersion: "c13-local-release-head-v1";
}

function conflict(): CatalogError {
  return new CatalogError("CATALOG_RELEASE_CONFLICT");
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safeVersion(version: string): string {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version)) throw conflict();
  return version;
}

async function assertRegularFile(path: string): Promise<void> {
  const status = await lstat(path);
  if (!status.isFile() || status.isSymbolicLink()) throw conflict();
}

async function readExact(path: string): Promise<Uint8Array> {
  await assertRegularFile(path);
  return Uint8Array.from(await readFile(path));
}

async function installImmutable(path: string, bytes: Uint8Array): Promise<boolean> {
  try {
    const existing = await readExact(path);
    if (!Buffer.from(existing).equals(Buffer.from(bytes))) throw conflict();
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const temporary = `${path}.pending-${randomUUID()}`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  try {
    await link(temporary, path);
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await readExact(path);
    if (!Buffer.from(existing).equals(Buffer.from(bytes))) throw conflict();
    return true;
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new CatalogError("CATALOG_RELEASE_CONFLICT", { cause: error });
      }
    });
  }
}

function parseHead(bytes: Uint8Array): StoredReleaseHead {
  let input: unknown;
  try {
    input = parseCatalogCanonicalJson(bytes);
  } catch (error) {
    throw new CatalogError("CATALOG_RELEASE_CONFLICT", { cause: error });
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw conflict();
  const candidate = input as Record<string, unknown>;
  if (
    Object.keys(candidate).sort().join(",") !== "assets,release,schemaVersion" ||
    candidate.schemaVersion !== "c13-local-release-head-v1" ||
    !Array.isArray(candidate.assets)
  ) {
    throw conflict();
  }
  const release = catalogReleaseSchema.safeParse(candidate.release);
  const assets = candidate.assets.map((asset) => catalogAssetVersionSchema.safeParse(asset));
  if (!release.success || assets.some((asset) => !asset.success)) throw conflict();
  const records = assets.map((asset) => {
    if (!asset.success) throw conflict();
    return asset.data;
  });
  const manifestBytes = catalogCanonicalBytes({
    assets: records.map(({ assetId, versionId, versionSha256 }) => ({
      assetId,
      versionId,
      versionSha256,
    })),
    createdAt: release.data.createdAt,
    releaseVersion: release.data.version,
    schemaVersion: "c13-catalog-release-manifest-v1",
  });
  validateCatalogPublication({ assets: records, manifestBytes, release: release.data });
  const canonicalHead = catalogCanonicalBytes({
    assets: records,
    release: release.data,
    schemaVersion: "c13-local-release-head-v1",
  });
  if (!Buffer.from(canonicalHead).equals(Buffer.from(bytes))) throw conflict();
  return {
    assets: records,
    release: release.data,
    schemaVersion: "c13-local-release-head-v1",
  };
}

export class FileSystemCatalogPublicationStore implements CatalogPublicationStore {
  readonly #headDirectory: string;
  readonly #objectDirectory: string;

  private constructor(root: string) {
    this.#headDirectory = join(root, "release-heads");
    this.#objectDirectory = join(root, "objects", "sha256");
  }

  static async create(root: string): Promise<FileSystemCatalogPublicationStore> {
    if (!isAbsolute(root)) throw new CatalogError("CATALOG_SOURCE_PATH_INVALID");
    await mkdir(root, { mode: 0o700, recursive: true });
    const resolved = await realpath(root);
    await mkdir(join(resolved, "release-heads"), { mode: 0o700, recursive: true });
    await mkdir(join(resolved, "objects", "sha256"), { mode: 0o700, recursive: true });
    return new FileSystemCatalogPublicationStore(resolved);
  }

  async putContentAddressed(input: PutCatalogObjectInput): Promise<void> {
    if (sha256Bytes(input.bytes) !== input.sha256) {
      throw new CatalogError("CATALOG_ARTIFACT_HASH_MISMATCH");
    }
    const prefixDirectory = join(this.#objectDirectory, input.sha256.slice(0, 2));
    await mkdir(prefixDirectory, { mode: 0o700, recursive: true });
    await installImmutable(join(prefixDirectory, input.sha256), input.bytes);
  }

  async publishReleaseHead(
    publication: CatalogPublishedRelease,
  ): Promise<{ readonly release: CatalogRelease; readonly replayed: boolean }> {
    const validated = validateCatalogPublication(publication);
    const { release, assets: sortedAssets } = validated;
    const required = [
      { byteLength: validated.manifestBytes.byteLength, sha256: release.manifestSha256 },
      ...sortedAssets.flatMap(({ artifacts }) => artifacts),
    ];
    for (const item of required) {
      const path = join(this.#objectDirectory, item.sha256.slice(0, 2), item.sha256);
      const bytes = await readExact(path).catch(() => {
        throw conflict();
      });
      if (bytes.byteLength !== item.byteLength || sha256Bytes(bytes) !== item.sha256)
        throw conflict();
    }
    const head: StoredReleaseHead = {
      assets: sortedAssets,
      release,
      schemaVersion: "c13-local-release-head-v1",
    };
    const replayed = await installImmutable(
      join(this.#headDirectory, `${safeVersion(release.version)}.json`),
      catalogCanonicalBytes(head),
    );
    return { release: structuredClone(release), replayed };
  }

  async listVisibleReleases(): Promise<readonly CatalogRelease[]> {
    const entries = (await readdir(this.#headDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /^\d+\.\d+\.\d+\.json$/u.test(entry.name))
      .map(({ name }) => name)
      .sort(compareStrings);
    const heads = await Promise.all(
      entries.map(async (name) => parseHead(await readExact(join(this.#headDirectory, name)))),
    );
    return heads.map(({ release }) => structuredClone(release));
  }

  async findVisibleAssets(releaseId: string): Promise<readonly CatalogAssetVersion[] | undefined> {
    const entries = await readdir(this.#headDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !/^\d+\.\d+\.\d+\.json$/u.test(entry.name)) continue;
      const head = parseHead(await readExact(join(this.#headDirectory, entry.name)));
      if (head.release.releaseId === releaseId) return structuredClone(head.assets);
    }
    return undefined;
  }
}
