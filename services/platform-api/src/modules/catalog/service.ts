import {
  catalogCanonicalBytes,
  catalogArtifactSchema,
  catalogAssetVersionSchema,
  catalogReleaseSchema,
  catalogSha256,
  isCatalogAssetSelectable,
  parseCatalogCanonicalJson,
} from "@interior-design/catalog";
import type {
  Actor,
  CatalogArtifact,
  CatalogAssetVersion,
  CatalogRelease,
} from "@interior-design/contracts";

import type { RequestCorrelation } from "../../correlation.js";
import { ApiError } from "../../errors.js";
import { notFound } from "../identity/http.js";
import { catalogUnavailable, invalidCatalogCursor, invalidCatalogQuery } from "./errors.js";
import { catalogArtifactAccessTtlSeconds } from "./storage.js";
import { catalogTelemetry } from "./telemetry.js";
import type {
  CatalogArtifactAccess,
  CatalogAssetListQuery,
  CatalogAssetPage,
  CatalogArtifactStorage,
  CatalogClock,
  CatalogRepository,
  CatalogTelemetry,
} from "./types.js";

const systemClock: CatalogClock = { now: () => new Date() };
const defaultAssetListQuery: CatalogAssetListQuery = { limit: 24 };

function publicAsset(candidate: CatalogAssetVersion): CatalogAssetVersion {
  const parsed = catalogAssetVersionSchema.parse(candidate);
  const rights = { ...parsed.rights };
  delete rights.sourceUri;
  return { ...parsed, rights };
}

function filterIdentity(releaseId: string, query: CatalogAssetListQuery): string {
  return catalogSha256({
    kind: query.kind ?? null,
    query: query.query?.toLocaleLowerCase("en-US") ?? null,
    releaseId,
    rights: query.rights ?? null,
    source: query.source ?? null,
  });
}

function encodeCursor(offset: number, identity: string): string {
  return Buffer.from(
    catalogCanonicalBytes({
      filterSha256: identity,
      offset,
      schemaVersion: "c13-catalog-cursor-v1",
    }),
  ).toString("base64url");
}

function decodeCursor(cursor: string, identity: string, maximum: number): number {
  if (!/^[A-Za-z0-9_-]{1,500}$/u.test(cursor)) throw invalidCatalogCursor();
  try {
    const bytes = Uint8Array.from(Buffer.from(cursor, "base64url"));
    if (Buffer.from(bytes).toString("base64url") !== cursor) throw invalidCatalogCursor();
    const decoded = parseCatalogCanonicalJson(bytes);
    if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
      throw invalidCatalogCursor();
    }
    const value = decoded as Record<string, unknown>;
    if (
      Object.keys(value).sort().join(",") !== "filterSha256,offset,schemaVersion" ||
      value.schemaVersion !== "c13-catalog-cursor-v1" ||
      value.filterSha256 !== identity ||
      typeof value.offset !== "number" ||
      !Number.isSafeInteger(value.offset) ||
      value.offset < 1 ||
      value.offset >= maximum
    ) {
      throw invalidCatalogCursor();
    }
    return value.offset;
  } catch (error) {
    if (error instanceof ApiError && error.code === "INVALID_CATALOG_CURSOR") throw error;
    throw invalidCatalogCursor();
  }
}

function matchesSearch(asset: CatalogAssetVersion, query: string): boolean {
  const needle = query.toLocaleLowerCase("en-US");
  return [
    asset.category,
    asset.description,
    asset.displayName,
    asset.kind,
    ...asset.tags,
    ...asset.materials.map(({ name }) => name),
  ].some((value) => value.toLocaleLowerCase("en-US").includes(needle));
}

export class CatalogService {
  readonly #clock: CatalogClock;
  readonly #repository: CatalogRepository;
  readonly #storage: CatalogArtifactStorage;
  readonly #telemetry: CatalogTelemetry;

  constructor(options: {
    readonly clock?: CatalogClock;
    readonly repository: CatalogRepository;
    readonly storage: CatalogArtifactStorage;
    readonly telemetry?: CatalogTelemetry;
  }) {
    this.#clock = options.clock ?? systemClock;
    this.#repository = options.repository;
    this.#storage = options.storage;
    this.#telemetry = options.telemetry ?? catalogTelemetry;
  }

  async listReleases(tenantId: string, projectId: string): Promise<readonly CatalogRelease[]> {
    const releases = (await this.#repository.listReleases(tenantId, projectId)).map((release) =>
      catalogReleaseSchema.parse(release),
    );
    this.#telemetry.record({ count: releases.length, outcome: "accepted", stage: "release-read" });
    return releases;
  }

  async getRelease(
    tenantId: string,
    projectId: string,
    releaseId: string,
  ): Promise<CatalogRelease> {
    const release = await this.#repository.findRelease(tenantId, projectId, releaseId);
    if (release === undefined) {
      this.#telemetry.record({ outcome: "missing", stage: "release-read" });
      throw notFound();
    }
    this.#telemetry.record({ outcome: "accepted", stage: "release-read" });
    return catalogReleaseSchema.parse(release);
  }

  async listAssets(
    tenantId: string,
    projectId: string,
    releaseId: string,
    query: CatalogAssetListQuery = defaultAssetListQuery,
  ): Promise<CatalogAssetPage> {
    if (
      !Number.isSafeInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 24 ||
      (query.query !== undefined &&
        (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,119}$/u.test(query.query) ||
          query.query !== query.query.trim()))
    ) {
      throw invalidCatalogQuery();
    }
    const release = await this.getRelease(tenantId, projectId, releaseId);
    const assets = (await this.#repository.listAssets(tenantId, projectId, releaseId)).map(
      publicAsset,
    );
    if (
      assets.length > 512 ||
      assets.length !== release.assetVersionIds.length ||
      assets.some(({ versionId }, index) => versionId !== release.assetVersionIds[index])
    ) {
      throw new Error("The catalog repository returned an inconsistent release projection.");
    }
    const filtered = assets.filter(
      (asset) =>
        (query.kind === undefined || asset.kind === query.kind) &&
        (query.rights === undefined || asset.rights.review.state === query.rights) &&
        (query.source === undefined || asset.rights.sourceKind === query.source) &&
        (query.query === undefined || matchesSearch(asset, query.query)),
    );
    const identity = filterIdentity(releaseId, query);
    const offset =
      query.cursor === undefined ? 0 : decodeCursor(query.cursor, identity, filtered.length);
    const page = filtered.slice(offset, offset + query.limit);
    const nextOffset = offset + page.length;
    this.#telemetry.record({ count: page.length, outcome: "accepted", stage: "asset-read" });
    return {
      assets: page,
      ...(nextOffset < filtered.length ? { nextCursor: encodeCursor(nextOffset, identity) } : {}),
      releaseId,
      total: filtered.length,
    };
  }

  async getAsset(
    tenantId: string,
    projectId: string,
    releaseId: string,
    assetVersionId: string,
  ): Promise<CatalogAssetVersion> {
    await this.getRelease(tenantId, projectId, releaseId);
    const asset = await this.#repository.findAsset(tenantId, projectId, releaseId, assetVersionId);
    if (asset === undefined) {
      this.#telemetry.record({ outcome: "missing", stage: "asset-read" });
      throw notFound();
    }
    this.#telemetry.record({ outcome: "accepted", stage: "asset-read" });
    return publicAsset(asset);
  }

  async requireSelectableAsset(input: {
    readonly assetVersionId: string;
    readonly expectedReleaseSha256: string;
    readonly expectedVersionSha256: string;
    readonly projectId: string;
    readonly releaseId: string;
    readonly tenantId: string;
  }): Promise<CatalogAssetVersion> {
    const release = await this.getRelease(input.tenantId, input.projectId, input.releaseId);
    if (release.status !== "published" || release.manifestSha256 !== input.expectedReleaseSha256) {
      this.#telemetry.record({ outcome: "denied", stage: "selection-check" });
      throw catalogUnavailable("CATALOG_RELEASE_NOT_SELECTABLE");
    }
    const asset = await this.getAsset(
      input.tenantId,
      input.projectId,
      input.releaseId,
      input.assetVersionId,
    );
    if (!isCatalogAssetSelectable(asset) || asset.versionSha256 !== input.expectedVersionSha256) {
      this.#telemetry.record({ outcome: "denied", stage: "selection-check" });
      throw catalogUnavailable("CATALOG_ASSET_NOT_SELECTABLE");
    }
    for (const artifact of asset.artifacts) {
      if (!(await this.#storage.available(artifact))) {
        this.#telemetry.record({ outcome: "denied", stage: "selection-check" });
        throw catalogUnavailable("CATALOG_ARTIFACT_MISSING");
      }
    }
    this.#telemetry.record({ outcome: "accepted", stage: "selection-check" });
    return asset;
  }

  async createArtifactAccess(input: {
    readonly actor: Actor;
    readonly artifactId: string;
    readonly correlation: RequestCorrelation;
    readonly projectId: string;
  }): Promise<CatalogArtifactAccess> {
    const found = await this.#repository.findArtifact(
      input.actor.tenantId,
      input.projectId,
      input.artifactId,
    );
    if (found === undefined) {
      this.#telemetry.record({ outcome: "missing", stage: "artifact-access" });
      throw notFound();
    }
    const artifact: CatalogArtifact = catalogArtifactSchema.parse(found);
    if (!(await this.#storage.available(artifact))) {
      this.#telemetry.record({ outcome: "missing", stage: "artifact-access" });
      throw catalogUnavailable("CATALOG_ARTIFACT_MISSING");
    }
    const expiresAt = new Date(
      this.#clock.now().getTime() + catalogArtifactAccessTtlSeconds * 1_000,
    );
    const signed = await this.#storage.signAccess({ artifact, expiresAt });
    await this.#repository.recordAccess({
      actor: input.actor,
      artifact,
      correlation: input.correlation,
      projectId: input.projectId,
    });
    this.#telemetry.record({ outcome: "accepted", stage: "artifact-access" });
    return {
      artifactId: artifact.artifactId,
      byteLength: artifact.byteLength,
      expiresAt: signed.expiresAt,
      mediaType: artifact.mediaType,
      sha256: artifact.sha256,
      url: signed.url,
    };
  }
}
