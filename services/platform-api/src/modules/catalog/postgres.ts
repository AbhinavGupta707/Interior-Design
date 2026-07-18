import {
  catalogArtifactSchema,
  catalogAssetVersionSchema,
  catalogReleaseSchema,
  type CatalogArtifact,
  type CatalogAssetVersion,
  type CatalogRelease,
} from "@interior-design/contracts";
import { randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";

import type { CatalogAccessAuditCommand, CatalogRepository } from "./types.js";

async function setTenant(transaction: TransactionSql, tenantId: string): Promise<void> {
  await transaction`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
}

export class PostgresCatalogRepository implements CatalogRepository {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  #withTenant<T>(tenantId: string, operation: (transaction: TransactionSql) => Promise<T>) {
    return this.#sql.begin(async (transaction) => {
      await setTenant(transaction, tenantId);
      return operation(transaction);
    });
  }

  listReleases(tenantId: string, projectId: string): Promise<readonly CatalogRelease[]> {
    return this.#withTenant(tenantId, async (transaction) => {
      const rows = await transaction<{ readonly release_payload: unknown }[]>`
        SELECT release_payload FROM catalog_releases
        WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
        ORDER BY published_at, id
        LIMIT 512
      `;
      return rows.map(({ release_payload }) => catalogReleaseSchema.parse(release_payload));
    });
  }

  findRelease(
    tenantId: string,
    projectId: string,
    releaseId: string,
  ): Promise<CatalogRelease | undefined> {
    return this.#withTenant(tenantId, async (transaction) => {
      const rows = await transaction<{ readonly release_payload: unknown }[]>`
        SELECT release_payload FROM catalog_releases
        WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
          AND id = ${releaseId}::uuid
        LIMIT 1
      `;
      const payload = rows[0]?.release_payload;
      return payload === undefined ? undefined : catalogReleaseSchema.parse(payload);
    });
  }

  listAssets(
    tenantId: string,
    projectId: string,
    releaseId: string,
  ): Promise<readonly CatalogAssetVersion[]> {
    return this.#withTenant(tenantId, async (transaction) => {
      const rows = await transaction<{ readonly asset_payload: unknown }[]>`
        SELECT av.asset_payload
        FROM catalog_release_assets ra
        JOIN catalog_asset_versions av
          ON av.tenant_id = ra.tenant_id AND av.project_id = ra.project_id
          AND av.id = ra.asset_version_id AND av.version_sha256 = ra.asset_version_sha256
        WHERE ra.tenant_id = ${tenantId}::uuid AND ra.project_id = ${projectId}::uuid
          AND ra.release_id = ${releaseId}::uuid
        ORDER BY ra.ordinal
        LIMIT 512
      `;
      return rows.map(({ asset_payload }) => catalogAssetVersionSchema.parse(asset_payload));
    });
  }

  findAsset(
    tenantId: string,
    projectId: string,
    releaseId: string,
    assetVersionId: string,
  ): Promise<CatalogAssetVersion | undefined> {
    return this.#withTenant(tenantId, async (transaction) => {
      const rows = await transaction<{ readonly asset_payload: unknown }[]>`
        SELECT av.asset_payload
        FROM catalog_release_assets ra
        JOIN catalog_asset_versions av
          ON av.tenant_id = ra.tenant_id AND av.project_id = ra.project_id
          AND av.id = ra.asset_version_id AND av.version_sha256 = ra.asset_version_sha256
        WHERE ra.tenant_id = ${tenantId}::uuid AND ra.project_id = ${projectId}::uuid
          AND ra.release_id = ${releaseId}::uuid
          AND ra.asset_version_id = ${assetVersionId}::uuid
        LIMIT 1
      `;
      const payload = rows[0]?.asset_payload;
      return payload === undefined ? undefined : catalogAssetVersionSchema.parse(payload);
    });
  }

  findArtifact(
    tenantId: string,
    projectId: string,
    artifactId: string,
  ): Promise<CatalogArtifact | undefined> {
    return this.#withTenant(tenantId, async (transaction) => {
      const rows = await transaction<{ readonly artifact_payload: unknown }[]>`
        SELECT artifact.value AS artifact_payload
        FROM catalog_release_assets ra
        JOIN catalog_asset_versions av
          ON av.tenant_id = ra.tenant_id AND av.project_id = ra.project_id
          AND av.id = ra.asset_version_id AND av.version_sha256 = ra.asset_version_sha256
        CROSS JOIN LATERAL jsonb_array_elements(av.asset_payload -> 'artifacts') AS artifact(value)
        WHERE ra.tenant_id = ${tenantId}::uuid AND ra.project_id = ${projectId}::uuid
          AND artifact.value ->> 'artifactId' = ${artifactId}
        ORDER BY ra.release_id, ra.ordinal
        LIMIT 1
      `;
      const payload = rows[0]?.artifact_payload;
      return payload === undefined ? undefined : catalogArtifactSchema.parse(payload);
    });
  }

  recordAccess(command: CatalogAccessAuditCommand): Promise<void> {
    return this.#withTenant(command.actor.tenantId, async (transaction) => {
      await transaction`
        INSERT INTO catalog_access_events (
          id, tenant_id, project_id, artifact_id, actor_user_id,
          request_id, trace_id, occurred_at
        ) VALUES (
          ${randomUUID()}::uuid, ${command.actor.tenantId}::uuid,
          ${command.projectId}::uuid, ${command.artifact.artifactId}::uuid,
          ${command.actor.userId}::uuid, ${command.correlation.requestId},
          ${command.correlation.traceId}, clock_timestamp()
        )
      `;
    });
  }
}
