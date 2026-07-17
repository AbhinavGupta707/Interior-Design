import { modelSnapshotRecordSchema, type SceneSnapshotReference } from "@interior-design/contracts";
import type { Sql } from "postgres";

import { DomainCanonicalSnapshotCodec } from "../models/core/canonical.js";
import type { SceneSnapshotVerifier } from "./types.js";

interface SnapshotRow {
  readonly canonical_byte_length: number;
  readonly canonical_snapshot: unknown;
  readonly created_at: Date | string;
  readonly created_by: string;
  readonly id: string;
  readonly model_id: string;
  readonly profile: string;
  readonly project_id: string;
  readonly schema_version: string;
  readonly snapshot_sha256: string;
  readonly version: number;
}

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export class PostgresSceneSnapshotVerifier implements SceneSnapshotVerifier {
  readonly #codec = new DomainCanonicalSnapshotCodec();
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async findExactCommitted(tenantId: string, projectId: string, reference: SceneSnapshotReference) {
    const rows = await this.#sql<SnapshotRow[]>`
      SELECT s.id, s.project_id, s.model_id, s.profile, s.version, s.schema_version,
        s.canonical_snapshot, s.snapshot_sha256, s.canonical_byte_length,
        s.created_by, s.created_at
      FROM canonical_model_snapshots s
      WHERE s.tenant_id = ${tenantId}::uuid
        AND s.project_id = ${projectId}::uuid
        AND s.project_id = ${reference.projectId}::uuid
        AND s.model_id = ${reference.modelId}::uuid
        AND s.profile = ${reference.profile}
        AND s.id = ${reference.snapshotId}::uuid
        AND s.snapshot_sha256 = ${reference.snapshotSha256}
        AND s.schema_version = ${reference.schemaVersion}
        AND c10_snapshot_is_committed(
          s.tenant_id, s.project_id, s.model_id, s.profile, s.id, s.snapshot_sha256
        )
      LIMIT 1
    `;
    const row = rows[0];
    if (row === undefined) return undefined;
    const stored = modelSnapshotRecordSchema.parse({
      canonicalByteLength: row.canonical_byte_length,
      createdAt: iso(row.created_at),
      createdBy: row.created_by,
      id: row.id,
      modelId: row.model_id,
      profile: row.profile,
      projectId: row.project_id,
      schemaVersion: row.schema_version,
      snapshot: row.canonical_snapshot,
      snapshotSha256: row.snapshot_sha256,
      version: row.version,
    });
    const recomputed = this.#codec.encode(stored.snapshot);
    if (
      recomputed.snapshotSha256 !== stored.snapshotSha256 ||
      recomputed.canonicalByteLength !== stored.canonicalByteLength ||
      recomputed.snapshot.projectId !== reference.projectId ||
      recomputed.snapshot.modelId !== reference.modelId ||
      recomputed.snapshot.profile !== reference.profile
    ) {
      throw new Error("Stored committed scene source snapshot failed canonical integrity checks.");
    }
    return stored;
  }
}
