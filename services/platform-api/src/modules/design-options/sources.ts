import {
  canonicalHomeSnapshotSchema,
  designBriefSchema,
  modelSnapshotRecordSchema,
  type ModelSnapshotRecord,
} from "@interior-design/contracts";
import { validateAndCanonicalizeSnapshot } from "@interior-design/model-operations";
import type { Sql } from "postgres";

import type {
  CreateOptionJobRequest,
  DesignOptionSourceVerifier,
  VerifiedOptionInputs,
} from "./types.js";

interface BriefRow {
  readonly brief_payload: unknown;
  readonly content_sha256: string;
  readonly revision: number;
}

interface SnapshotRow {
  readonly canonical_byte_length: number;
  readonly canonical_snapshot: unknown;
  readonly created_at: Date | string;
  readonly created_by: string;
  readonly id: string;
  readonly model_id: string;
  readonly profile: "existing" | "proposed";
  readonly project_id: string;
  readonly schema_version: string;
  readonly snapshot_sha256: string;
  readonly version: number;
}

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function mapSnapshot(row: SnapshotRow): ModelSnapshotRecord {
  const snapshot = canonicalHomeSnapshotSchema.parse(row.canonical_snapshot);
  const canonical = validateAndCanonicalizeSnapshot(snapshot);
  if (
    canonical.hasBlockingFindings ||
    canonical.snapshotSha256 !== row.snapshot_sha256 ||
    canonical.canonicalByteLength !== row.canonical_byte_length
  ) {
    throw new Error("Stored C12 source snapshot failed canonical integrity verification.");
  }
  return modelSnapshotRecordSchema.parse({
    canonicalByteLength: row.canonical_byte_length,
    createdAt: iso(row.created_at),
    createdBy: row.created_by,
    id: row.id,
    modelId: row.model_id,
    profile: row.profile,
    projectId: row.project_id,
    schemaVersion: row.schema_version,
    snapshot: canonical.snapshot,
    snapshotSha256: row.snapshot_sha256,
    version: row.version,
  });
}

export class PostgresDesignOptionSourceVerifier implements DesignOptionSourceVerifier {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async findExactAcceptedInputs(
    tenantId: string,
    projectId: string,
    request: CreateOptionJobRequest,
  ): Promise<VerifiedOptionInputs | undefined> {
    const briefRows = await this.#sql<BriefRow[]>`
      SELECT r.brief_payload, r.content_sha256, r.revision
      FROM design_briefs b
      JOIN design_brief_revisions r
        ON r.tenant_id = b.tenant_id AND r.project_id = b.project_id
        AND r.brief_id = b.id AND r.revision = b.current_revision
      JOIN design_brief_acceptance_events a
        ON a.tenant_id = r.tenant_id AND a.project_id = r.project_id
        AND a.brief_id = r.brief_id AND a.accepted_revision = r.revision
      WHERE b.tenant_id = ${tenantId}::uuid AND b.project_id = ${projectId}::uuid
        AND b.id = ${request.baseBrief.briefId}::uuid
        AND b.current_status = 'accepted'
        AND r.revision = ${request.baseBrief.revision}
        AND r.content_sha256 = ${request.baseBrief.contentSha256}
      LIMIT 1
    `;
    const briefRow = briefRows[0];
    if (briefRow === undefined) return undefined;

    const sourceRows = await this.#sql<SnapshotRow[]>`
      SELECT s.id, s.project_id, s.model_id, s.profile, s.version, s.schema_version,
             s.canonical_snapshot, s.snapshot_sha256, s.canonical_byte_length,
             s.created_by, s.created_at
      FROM canonical_model_profiles p
      JOIN canonical_model_snapshots s
        ON s.tenant_id = p.tenant_id AND s.project_id = p.project_id
        AND s.model_id = p.model_id AND s.profile = p.profile
        AND s.id = p.current_snapshot_id
        AND s.snapshot_sha256 = p.current_snapshot_sha256
        AND s.version = p.current_snapshot_version
      WHERE p.tenant_id = ${tenantId}::uuid AND p.project_id = ${projectId}::uuid
        AND p.model_id = ${request.sourceModel.modelId}::uuid
        AND p.profile = ${request.sourceModel.profile}
        AND s.id = ${request.sourceModel.snapshotId}::uuid
        AND s.snapshot_sha256 = ${request.sourceModel.snapshotSha256}
        AND s.version = ${request.sourceModel.snapshotVersion}
      LIMIT 1
    `;
    const sourceRow = sourceRows[0];
    if (sourceRow === undefined) return undefined;

    const proposedRows = await this.#sql<SnapshotRow[]>`
      SELECT s.id, s.project_id, s.model_id, s.profile, s.version, s.schema_version,
             s.canonical_snapshot, s.snapshot_sha256, s.canonical_byte_length,
             s.created_by, s.created_at
      FROM canonical_model_profiles p
      JOIN canonical_model_snapshots s
        ON s.tenant_id = p.tenant_id AND s.project_id = p.project_id
        AND s.model_id = p.model_id AND s.profile = p.profile
        AND s.id = p.current_snapshot_id
        AND s.snapshot_sha256 = p.current_snapshot_sha256
        AND s.version = p.current_snapshot_version
      WHERE p.tenant_id = ${tenantId}::uuid AND p.project_id = ${projectId}::uuid
        AND p.model_id = ${request.sourceModel.modelId}::uuid AND p.profile = 'proposed'
      LIMIT 1
    `;
    const currentProposed = proposedRows[0];
    return {
      brief: designBriefSchema.parse(briefRow.brief_payload),
      briefReference: request.baseBrief,
      ...(currentProposed === undefined ? {} : { currentProposed: mapSnapshot(currentProposed) }),
      source: mapSnapshot(sourceRow),
      sourceReference: request.sourceModel,
    };
  }
}

export class InMemoryDesignOptionSourceVerifier implements DesignOptionSourceVerifier {
  readonly records = new Map<string, VerifiedOptionInputs>();

  static key(tenantId: string, projectId: string, request: CreateOptionJobRequest): string {
    return [
      tenantId,
      projectId,
      request.baseBrief.briefId,
      request.baseBrief.revision,
      request.baseBrief.contentSha256,
      request.sourceModel.modelId,
      request.sourceModel.profile,
      request.sourceModel.snapshotId,
      request.sourceModel.snapshotVersion,
      request.sourceModel.snapshotSha256,
    ].join(":");
  }

  findExactAcceptedInputs(
    tenantId: string,
    projectId: string,
    request: CreateOptionJobRequest,
  ): Promise<VerifiedOptionInputs | undefined> {
    return Promise.resolve(
      this.records.get(InMemoryDesignOptionSourceVerifier.key(tenantId, projectId, request)),
    );
  }
}
