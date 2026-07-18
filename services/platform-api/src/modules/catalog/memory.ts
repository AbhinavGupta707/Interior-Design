import {
  catalogAssetVersionSchema,
  catalogReleaseSchema,
  type CatalogArtifact,
  type CatalogAssetVersion,
  type CatalogRelease,
} from "@interior-design/contracts";

import type { CatalogAccessAuditCommand, CatalogRepository } from "./types.js";

interface CatalogSeedRelease {
  readonly assets: readonly CatalogAssetVersion[];
  readonly release: CatalogRelease;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export class InMemoryCatalogRepository implements CatalogRepository {
  readonly accessEvents: Array<{
    readonly artifactId: string;
    readonly correlationId: string;
    readonly projectId: string;
    readonly tenantId: string;
    readonly userId: string;
  }> = [];
  readonly #artifacts = new Map<string, CatalogArtifact>();
  readonly #assets = new Map<string, readonly CatalogAssetVersion[]>();
  readonly #releases = new Map<string, CatalogRelease>();

  constructor(seed: readonly CatalogSeedRelease[]) {
    for (const item of seed) {
      const release = catalogReleaseSchema.parse(item.release);
      const assets = item.assets
        .map((asset) => catalogAssetVersionSchema.parse(asset))
        .sort((left, right) => compareStrings(left.versionId, right.versionId));
      if (
        this.#releases.has(release.releaseId) ||
        [...this.#releases.values()].some(({ version }) => version === release.version) ||
        assets.length !== release.assetVersionIds.length ||
        assets.some(({ versionId }, index) => versionId !== release.assetVersionIds[index])
      ) {
        throw new Error("Catalog repository seed contains an immutable identity conflict.");
      }
      this.#releases.set(release.releaseId, clone(release));
      this.#assets.set(release.releaseId, clone(assets));
      for (const asset of assets) {
        for (const artifact of asset.artifacts) {
          const existing = this.#artifacts.get(artifact.artifactId);
          if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(artifact)) {
            throw new Error("Catalog artifact identity cannot be overwritten.");
          }
          this.#artifacts.set(artifact.artifactId, clone(artifact));
        }
      }
    }
  }

  listReleases(_tenantId: string, _projectId: string): Promise<readonly CatalogRelease[]> {
    void _tenantId;
    void _projectId;
    return Promise.resolve(
      [...this.#releases.values()]
        .map(clone)
        .sort((left, right) => compareStrings(left.version, right.version)),
    );
  }

  findRelease(
    _tenantId: string,
    _projectId: string,
    releaseId: string,
  ): Promise<CatalogRelease | undefined> {
    const release = this.#releases.get(releaseId);
    return Promise.resolve(release === undefined ? undefined : clone(release));
  }

  listAssets(
    _tenantId: string,
    _projectId: string,
    releaseId: string,
  ): Promise<readonly CatalogAssetVersion[]> {
    const assets = this.#assets.get(releaseId);
    return Promise.resolve(assets === undefined ? [] : clone(assets));
  }

  findAsset(
    _tenantId: string,
    _projectId: string,
    releaseId: string,
    assetVersionId: string,
  ): Promise<CatalogAssetVersion | undefined> {
    const asset = this.#assets
      .get(releaseId)
      ?.find(({ versionId }) => versionId === assetVersionId);
    return Promise.resolve(asset === undefined ? undefined : clone(asset));
  }

  findArtifact(
    _tenantId: string,
    _projectId: string,
    artifactId: string,
  ): Promise<CatalogArtifact | undefined> {
    const artifact = this.#artifacts.get(artifactId);
    return Promise.resolve(artifact === undefined ? undefined : clone(artifact));
  }

  recordAccess(command: CatalogAccessAuditCommand): Promise<void> {
    this.accessEvents.push({
      artifactId: command.artifact.artifactId,
      correlationId: command.correlation.requestId,
      projectId: command.projectId,
      tenantId: command.actor.tenantId,
      userId: command.actor.userId,
    });
    return Promise.resolve();
  }
}
