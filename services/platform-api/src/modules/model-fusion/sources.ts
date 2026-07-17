import type { FusionSource } from "@interior-design/contracts";
import { createHash } from "node:crypto";
import type { Sql } from "postgres";

import type { FusionBaseVerifier, FusionSourceVerifier, VerifiedFusionSource } from "./types.js";

interface SourceRow {
  readonly element_count: number | string;
  readonly evidence_state: FusionSource["evidenceState"];
  readonly project_id: string;
  readonly reference_id: string;
  readonly rights_active: boolean;
  readonly schema_version: string;
  readonly sha256: string | null;
  readonly payload: unknown;
  readonly tenant_id: string;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  throw new Error("Unsupported source payload value.");
}

function payloadSha256(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

export class PostgresFusionVerification implements FusionSourceVerifier, FusionBaseVerifier {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async findExact(
    tenantId: string,
    projectId: string,
    base: Parameters<FusionBaseVerifier["findExact"]>[2],
  ) {
    const rows = await this.#sql<{ readonly record: unknown }[]>`
      SELECT jsonb_build_object(
        'canonicalByteLength', canonical_byte_length,
        'createdAt', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'createdBy', created_by,
        'id', id,
        'modelId', model_id,
        'profile', profile,
        'projectId', project_id,
        'schemaVersion', schema_version,
        'snapshot', canonical_snapshot,
        'snapshotSha256', snapshot_sha256,
        'version', version
      ) AS record
      FROM canonical_model_snapshots
      WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
        AND model_id = ${base.modelId}::uuid AND profile = 'existing'
        AND id = ${base.snapshotId}::uuid AND snapshot_sha256 = ${base.snapshotSha256}
      LIMIT 1
    `;
    const { modelSnapshotRecordSchema } = await import("@interior-design/contracts");
    return rows[0] === undefined ? undefined : modelSnapshotRecordSchema.parse(rows[0].record);
  }

  async verify(
    tenantId: string,
    projectId: string,
    source: FusionSource,
  ): Promise<VerifiedFusionSource | undefined> {
    let rows: SourceRow[];
    if (source.kind === "plan-proposal") {
      rows = await this.#sql<SourceRow[]>`
        SELECT r.tenant_id, r.project_id, r.id AS reference_id,
          'c6-plan-proposal-v1' AS schema_version, r.result_sha256 AS sha256,
          jsonb_array_length(r.result_payload -> 'candidates') AS element_count,
          'source-derived' AS evidence_state, r.result_payload AS payload,
          (j.state = 'proposed' AND a.status = 'ready'
            AND ar.service_processing_consent AND ar.training_use_consent = 'denied') AS rights_active
        FROM plan_processing_results r
        JOIN plan_processing_jobs j
          ON j.tenant_id = r.tenant_id AND j.project_id = r.project_id AND j.id = r.job_id
        JOIN assets a
          ON a.tenant_id = j.tenant_id AND a.project_id = j.project_id AND a.id = j.asset_id
        JOIN asset_rights_assertions ar
          ON ar.tenant_id = a.tenant_id AND ar.project_id = a.project_id AND ar.asset_id = a.id
        WHERE r.tenant_id = ${tenantId}::uuid AND r.project_id = ${projectId}::uuid
          AND r.id = ${source.referenceId}::uuid AND r.status = 'proposal' LIMIT 1
      `;
    } else if (source.kind === "roomplan-proposal") {
      rows = await this.#sql<SourceRow[]>`
        SELECT r.tenant_id, r.project_id, r.id AS reference_id,
          'c7-capture-proposal-v1' AS schema_version, r.result_sha256 AS sha256,
          jsonb_array_length(r.result_payload -> 'elementSources') AS element_count,
          'source-derived' AS evidence_state, r.result_payload AS payload,
          coalesce((SELECT e.permitted AND e.service_processing_consent
            AND e.training_use_consent = 'denied'
            FROM capture_rights_events e
            WHERE e.tenant_id = r.tenant_id AND e.project_id = r.project_id
              AND e.capture_session_id = r.capture_session_id
            ORDER BY e.occurred_at DESC, e.id DESC LIMIT 1), false) AS rights_active
        FROM capture_results r
        WHERE r.tenant_id = ${tenantId}::uuid AND r.project_id = ${projectId}::uuid
          AND r.id = ${source.referenceId}::uuid AND r.status = 'proposal' LIMIT 1
      `;
    } else if (source.kind === "reconstruction-result") {
      rows = await this.#sql<SourceRow[]>`
        SELECT r.tenant_id, r.project_id, r.id AS reference_id,
          'c8-reconstruction-result-v1' AS schema_version, NULL::text AS sha256,
          (r.result_payload -> 'geometry' ->> 'registeredFrameCount')::int AS element_count,
          'source-derived' AS evidence_state, r.result_payload AS payload,
          NOT EXISTS (
            SELECT 1 FROM reconstruction_job_sources s
            JOIN assets a ON a.tenant_id = s.tenant_id AND a.project_id = s.project_id AND a.id = s.asset_id
            JOIN asset_rights_assertions ar
              ON ar.tenant_id = s.tenant_id AND ar.project_id = s.project_id AND ar.asset_id = s.asset_id
            LEFT JOIN reconstruction_rights_withdrawals w
              ON w.tenant_id = s.tenant_id AND w.project_id = s.project_id AND w.asset_id = s.asset_id
            WHERE s.tenant_id = r.tenant_id AND s.project_id = r.project_id AND s.job_id = r.job_id
              AND (a.status <> 'ready' OR NOT ar.service_processing_consent
                OR ar.training_use_consent <> 'denied' OR w.asset_id IS NOT NULL)
          ) AS rights_active
        FROM reconstruction_results r
        WHERE r.tenant_id = ${tenantId}::uuid AND r.project_id = ${projectId}::uuid
          AND r.id = ${source.referenceId}::uuid AND r.status = 'completed' LIMIT 1
      `;
    } else {
      // Measurement and assertion producers are intentionally isolated behind this port.
      return undefined;
    }
    const row = rows[0];
    if (row === undefined) return undefined;
    return {
      elementCount: Number(row.element_count),
      evidenceState: row.evidence_state,
      kind: source.kind,
      projectId: row.project_id,
      referenceId: row.reference_id,
      rightsActive: row.rights_active,
      schemaVersion: row.schema_version,
      sha256: row.sha256 ?? payloadSha256(row.payload),
      tenantId: row.tenant_id,
    };
  }
}
