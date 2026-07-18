import type { Sql } from "postgres";

import { requestHash } from "../projects/idempotency.js";
import type {
  BriefSourceVerifier,
  VerifiedBriefAsset,
  VerifiedBriefMessage,
  VerifiedBriefSnapshot,
} from "./types.js";

interface AssetRow {
  readonly asset_id: string;
  readonly asserted_at: Date | string;
  readonly attribution: string | null;
  readonly basis: string;
  readonly licence_url: string | null;
  readonly project_id: string;
  readonly service_processing_consent: boolean;
  readonly source_sha256: string;
  readonly status: string;
  readonly tenant_id: string;
  readonly training_use_consent: string;
}

export function evidenceRightsRecordSha256(input: {
  readonly assertedAt: string;
  readonly assetId: string;
  readonly attribution?: string;
  readonly basis: string;
  readonly licenceUrl?: string;
  readonly serviceProcessingConsent: boolean;
  readonly trainingUseConsent: string;
}): string {
  return requestHash(input);
}

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function mapAsset(row: AssetRow): VerifiedBriefAsset {
  return {
    assetId: row.asset_id,
    projectId: row.project_id,
    rightsRecordSha256: evidenceRightsRecordSha256({
      assertedAt: iso(row.asserted_at),
      assetId: row.asset_id,
      ...(row.attribution === null ? {} : { attribution: row.attribution }),
      basis: row.basis,
      ...(row.licence_url === null ? {} : { licenceUrl: row.licence_url }),
      serviceProcessingConsent: row.service_processing_consent,
      trainingUseConsent: row.training_use_consent,
    }),
    serviceProcessingConsent: row.service_processing_consent,
    sourceSha256: row.source_sha256,
    status: row.status,
    tenantId: row.tenant_id,
    trainingUseConsent: row.training_use_consent,
  };
}

export class PostgresBriefSourceVerifier implements BriefSourceVerifier {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async findAsset(tenantId: string, projectId: string, assetId: string) {
    const rows = await this.#sql<AssetRow[]>`
      SELECT
        a.tenant_id, a.project_id, a.id AS asset_id, a.source_sha256, a.status,
        r.basis, r.attribution, r.licence_url, r.service_processing_consent,
        r.training_use_consent, r.asserted_at
      FROM assets a
      JOIN asset_rights_assertions r
        ON r.tenant_id = a.tenant_id AND r.project_id = a.project_id AND r.asset_id = a.id
      WHERE a.tenant_id = ${tenantId}::uuid AND a.project_id = ${projectId}::uuid
        AND a.id = ${assetId}::uuid
      LIMIT 1
    `;
    const row = rows[0];
    return row === undefined ? undefined : mapAsset(row);
  }

  async findSnapshot(tenantId: string, projectId: string, snapshotId: string) {
    const rows = await this.#sql<
      Array<{
        readonly project_id: string;
        readonly snapshot_id: string;
        readonly snapshot_sha256: string;
        readonly tenant_id: string;
      }>
    >`
      SELECT tenant_id, project_id, id AS snapshot_id, snapshot_sha256
      FROM canonical_model_snapshots
      WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
        AND id = ${snapshotId}::uuid
      ORDER BY model_id, profile
      LIMIT 2
    `;
    const row = rows.length === 1 ? rows[0] : undefined;
    return row === undefined
      ? undefined
      : {
          projectId: row.project_id,
          snapshotId: row.snapshot_id,
          snapshotSha256: row.snapshot_sha256,
          tenantId: row.tenant_id,
        };
  }

  async findMessage(tenantId: string, projectId: string, messageId: string) {
    const rows = await this.#sql<
      Array<{
        readonly content_sha256: string;
        readonly created_at: Date | string;
        readonly created_by: string | null;
        readonly message_id: string;
        readonly project_id: string;
        readonly session_id: string;
        readonly tenant_id: string;
      }>
    >`
      SELECT tenant_id, project_id, session_id, id AS message_id,
        content_sha256, created_by, created_at
      FROM consultation_messages
      WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
        AND id = ${messageId}::uuid
      LIMIT 1
    `;
    const row = rows[0];
    return row === undefined
      ? undefined
      : {
          contentSha256: row.content_sha256,
          createdAt: iso(row.created_at),
          ...(row.created_by === null ? {} : { createdByUserId: row.created_by }),
          messageId: row.message_id,
          projectId: row.project_id,
          sessionId: row.session_id,
          tenantId: row.tenant_id,
        };
  }
}

export class InMemoryBriefSourceVerifier implements BriefSourceVerifier {
  readonly assets = new Map<string, VerifiedBriefAsset>();
  readonly messages = new Map<string, VerifiedBriefMessage>();
  readonly snapshots = new Map<string, VerifiedBriefSnapshot>();

  findAsset(tenantId: string, projectId: string, assetId: string) {
    const asset = this.assets.get(`${tenantId}:${projectId}:${assetId}`);
    return Promise.resolve(asset);
  }

  findSnapshot(tenantId: string, projectId: string, snapshotId: string) {
    const snapshot = this.snapshots.get(`${tenantId}:${projectId}:${snapshotId}`);
    return Promise.resolve(snapshot);
  }

  findMessage(tenantId: string, projectId: string, messageId: string) {
    const message = this.messages.get(`${tenantId}:${projectId}:${messageId}`);
    return Promise.resolve(message);
  }
}
