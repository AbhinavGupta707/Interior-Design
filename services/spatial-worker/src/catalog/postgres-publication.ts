import { CatalogError, type CatalogPublishedRelease } from "@interior-design/catalog";
import type { CatalogAssetVersion, CatalogRelease } from "@interior-design/contracts";
import type { JSONValue, Sql, TransactionSql } from "postgres";

import {
  validateCatalogPublication,
  type CatalogPublicationStore,
  type PutCatalogObjectInput,
} from "./publication.js";

function json(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function conflict(error?: unknown): CatalogError {
  return new CatalogError("CATALOG_RELEASE_CONFLICT", { cause: error });
}

async function setTenant(transaction: TransactionSql, tenantId: string): Promise<void> {
  await transaction`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
}

async function assertProjectAndPublisher(
  transaction: TransactionSql,
  scope: CatalogPublicationScope,
): Promise<void> {
  const rows = await transaction<{ readonly project: boolean; readonly publisher: boolean }[]>`
    SELECT
      EXISTS (
        SELECT 1 FROM projects
        WHERE tenant_id = ${scope.tenantId}::uuid AND id = ${scope.projectId}::uuid
      ) AS project,
      EXISTS (
        SELECT 1 FROM identity_users WHERE id = ${scope.publishedByUserId}::uuid
      ) AS publisher
  `;
  const scopeState = rows.at(0);
  if (scopeState === undefined || !scopeState.project || !scopeState.publisher) throw conflict();
}

async function insertAsset(
  transaction: TransactionSql,
  scope: CatalogPublicationScope,
  asset: CatalogAssetVersion,
  publishedAt: string,
): Promise<boolean> {
  const rows = await transaction<{ readonly id: string }[]>`
    INSERT INTO catalog_asset_versions (
      tenant_id, project_id, id, asset_id, schema_version, kind, version,
      version_sha256, lifecycle, rights_record_sha256, rights_review_state,
      placement_projection_sha256, c12_asset_content_sha256,
      c12_asset_metadata_sha256, c12_placement_policy_sha256, asset_payload,
      published_by, published_at
    ) VALUES (
      ${scope.tenantId}::uuid, ${scope.projectId}::uuid, ${asset.versionId}::uuid,
      ${asset.assetId}::uuid, ${asset.schemaVersion}, ${asset.kind}, ${asset.version},
      ${asset.versionSha256}, ${asset.lifecycle}, ${asset.rights.recordSha256},
      ${asset.rights.review.state}, ${asset.placementProjection.projectionSha256},
      ${asset.placementProjection.c12Asset.contentSha256},
      ${asset.placementProjection.c12Asset.metadataSha256},
      ${asset.placementProjection.c12Asset.placementPolicy.policySha256},
      ${transaction.json(json(asset))}, ${scope.publishedByUserId}::uuid,
      ${publishedAt}::timestamptz
    ) ON CONFLICT (tenant_id, project_id, id) DO NOTHING
    RETURNING id
  `;
  if (rows.length === 1) return false;
  const existing = await transaction<Array<{ readonly version_sha256: string }>>`
    SELECT version_sha256 FROM catalog_asset_versions
    WHERE tenant_id = ${scope.tenantId}::uuid AND project_id = ${scope.projectId}::uuid
      AND id = ${asset.versionId}::uuid
    LIMIT 1
  `;
  if (existing[0]?.version_sha256 !== asset.versionSha256) {
    throw conflict();
  }
  return true;
}

async function insertRelease(
  transaction: TransactionSql,
  scope: CatalogPublicationScope,
  release: CatalogRelease,
): Promise<boolean> {
  const rows = await transaction<{ readonly id: string }[]>`
    INSERT INTO catalog_releases (
      tenant_id, project_id, id, schema_version, version, manifest_sha256,
      status, release_payload, published_by, published_at
    ) VALUES (
      ${scope.tenantId}::uuid, ${scope.projectId}::uuid, ${release.releaseId}::uuid,
      ${release.schemaVersion}, ${release.version}, ${release.manifestSha256},
      ${release.status}, ${transaction.json(json(release))},
      ${scope.publishedByUserId}::uuid, ${release.createdAt}::timestamptz
    ) ON CONFLICT (tenant_id, project_id, id) DO NOTHING
    RETURNING id
  `;
  if (rows.length === 1) return false;
  const existing = await transaction<Array<{ readonly manifest_sha256: string }>>`
    SELECT manifest_sha256 FROM catalog_releases
    WHERE tenant_id = ${scope.tenantId}::uuid AND project_id = ${scope.projectId}::uuid
      AND id = ${release.releaseId}::uuid
    LIMIT 1
  `;
  if (existing[0]?.manifest_sha256 !== release.manifestSha256) {
    throw conflict();
  }
  return true;
}

export interface CatalogPublicationScope {
  readonly projectId: string;
  readonly publishedByUserId: string;
  readonly tenantId: string;
}

/**
 * Publishes bytes and the immutable S3 head first, then atomically exposes the release through the
 * forced-RLS database projection. An S3-only crash residue is content-addressed and undiscoverable;
 * the API cannot observe a partial database release.
 */
export class PostgresCatalogPublicationStore implements CatalogPublicationStore {
  readonly #objects: CatalogPublicationStore;
  readonly #scope: CatalogPublicationScope;
  readonly #sql: Sql;

  constructor(options: {
    readonly objects: CatalogPublicationStore;
    readonly scope: CatalogPublicationScope;
    readonly sql: Sql;
  }) {
    this.#objects = options.objects;
    this.#scope = options.scope;
    this.#sql = options.sql;
  }

  putContentAddressed(input: PutCatalogObjectInput): Promise<void> {
    return this.#objects.putContentAddressed(input);
  }

  async publishReleaseHead(
    publication: CatalogPublishedRelease,
  ): Promise<{ readonly release: CatalogRelease; readonly replayed: boolean }> {
    const validated = validateCatalogPublication(publication);
    const objectResult = await this.#objects.publishReleaseHead(validated);
    try {
      const databaseReplayed = await this.#sql.begin(async (transaction) => {
        await setTenant(transaction, this.#scope.tenantId);
        await assertProjectAndPublisher(transaction, this.#scope);
        const assetReplays = await Promise.all(
          validated.assets.map((asset) =>
            insertAsset(transaction, this.#scope, asset, validated.release.createdAt),
          ),
        );
        const releaseReplay = await insertRelease(transaction, this.#scope, validated.release);
        for (const [ordinal, asset] of validated.assets.entries()) {
          const rows = await transaction<{ readonly asset_version_id: string }[]>`
            INSERT INTO catalog_release_assets (
              tenant_id, project_id, release_id, release_sha256, asset_version_id,
              asset_version_sha256, ordinal
            ) VALUES (
              ${this.#scope.tenantId}::uuid, ${this.#scope.projectId}::uuid,
              ${validated.release.releaseId}::uuid, ${validated.release.manifestSha256},
              ${asset.versionId}::uuid, ${asset.versionSha256}, ${ordinal}
            ) ON CONFLICT (tenant_id, project_id, release_id, asset_version_id) DO NOTHING
            RETURNING asset_version_id
          `;
          if (rows.length === 0) {
            const existing = await transaction<
              Array<{ readonly asset_version_sha256: string; readonly ordinal: number }>
            >`
              SELECT asset_version_sha256, ordinal FROM catalog_release_assets
              WHERE tenant_id = ${this.#scope.tenantId}::uuid
                AND project_id = ${this.#scope.projectId}::uuid
                AND release_id = ${validated.release.releaseId}::uuid
                AND asset_version_id = ${asset.versionId}::uuid
              LIMIT 1
            `;
            const existingBinding = existing.at(0);
            if (
              existingBinding === undefined ||
              existingBinding.asset_version_sha256 !== asset.versionSha256 ||
              existingBinding.ordinal !== ordinal
            ) {
              throw conflict();
            }
          }
        }
        return releaseReplay && assetReplays.every(Boolean);
      });
      return {
        release: structuredClone(validated.release),
        replayed: objectResult.replayed && databaseReplayed,
      };
    } catch (error) {
      throw error instanceof CatalogError ? error : conflict(error);
    }
  }
}
