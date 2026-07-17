import { canonicalHomeSnapshotSchema, type FusionSource } from "@interior-design/contracts";
import { createHash } from "node:crypto";
import type { Sql } from "postgres";

import {
  FusionWorkerError,
  type FusionAcquisitionBundle,
  type FusionSourceAcquisitionPort,
  type FusionSourcePayload,
  type LeasedFusionAttempt,
} from "./types.js";

const maximumSourcePayloadBytes = 8 * 1_024 * 1_024;
const maximumTotalPayloadBytes = 32 * 1_024 * 1_024;

interface PayloadRow {
  readonly element_count: number | string;
  readonly payload: unknown;
  readonly schema_version: string;
  readonly sha256: string | null;
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
  throw new FusionWorkerError("FUSION_SOURCE_PAYLOAD_INVALID");
}

function payloadRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new FusionWorkerError("FUSION_SOURCE_PAYLOAD_INVALID");
  }
  return value as Readonly<Record<string, unknown>>;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isCancelled(signal: AbortSignal | undefined): boolean {
  return signal?.aborted ?? false;
}

export class PostgresFusionSourceAcquisition implements FusionSourceAcquisitionPort {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async acquire(
    lease: LeasedFusionAttempt,
    signal?: AbortSignal,
  ): Promise<FusionAcquisitionBundle> {
    if (isCancelled(signal)) throw new FusionWorkerError("FUSION_CANCELLED");
    const baseRows = await this.#sql<{ readonly snapshot: unknown }[]>`
      SELECT canonical_snapshot AS snapshot FROM canonical_model_snapshots
      WHERE tenant_id = ${lease.tenantId}::uuid AND project_id = ${lease.projectId}::uuid
        AND model_id = ${lease.request.baseSnapshot.modelId}::uuid AND profile = 'existing'
        AND id = ${lease.request.baseSnapshot.snapshotId}::uuid
        AND snapshot_sha256 = ${lease.request.baseSnapshot.snapshotSha256} LIMIT 1
    `;
    const base = baseRows[0];
    if (base === undefined) throw new FusionWorkerError("FUSION_BASE_SNAPSHOT_FENCED");
    const sources: FusionSourcePayload[] = [];
    let totalBytes = 0;
    for (const descriptor of lease.request.sources) {
      if (isCancelled(signal)) throw new FusionWorkerError("FUSION_CANCELLED");
      const rows = await this.#load(descriptor, lease);
      const row = rows[0];
      if (row === undefined) throw new FusionWorkerError("FUSION_SOURCE_FENCED");
      const payload = payloadRecord(row.payload);
      const canonical = canonicalJson(payload);
      const bytes = Buffer.byteLength(canonical, "utf8");
      totalBytes += bytes;
      if (bytes > maximumSourcePayloadBytes || totalBytes > maximumTotalPayloadBytes) {
        throw new FusionWorkerError("FUSION_SOURCE_RESOURCE_LIMIT");
      }
      const contentSha256 = row.sha256 ?? sha256(canonical);
      if (
        row.schema_version !== descriptor.schemaVersion ||
        contentSha256 !== descriptor.sha256 ||
        Number(row.element_count) !== descriptor.elementCount
      ) {
        throw new FusionWorkerError("FUSION_SOURCE_FENCED");
      }
      sources.push({ descriptor, payload });
    }
    if (sources.length !== lease.request.sources.length) {
      throw new FusionWorkerError("FUSION_SOURCE_FENCED");
    }
    return {
      baseSnapshot: canonicalHomeSnapshotSchema.parse(base.snapshot),
      sources,
    };
  }

  #load(descriptor: FusionSource, lease: LeasedFusionAttempt): Promise<PayloadRow[]> {
    if (descriptor.kind === "plan-proposal") {
      return this.#sql<PayloadRow[]>`
        SELECT r.result_payload AS payload, r.result_sha256 AS sha256,
          'c6-plan-proposal-v1' AS schema_version,
          jsonb_array_length(r.result_payload -> 'candidates') AS element_count
        FROM plan_processing_results r
        WHERE r.tenant_id = ${lease.tenantId}::uuid AND r.project_id = ${lease.projectId}::uuid
          AND r.id = ${descriptor.referenceId}::uuid AND r.status = 'proposal'
          AND c9_source_rights_active(r.tenant_id, r.project_id, 'plan-proposal', r.id)
          AND NOT EXISTS (
            SELECT 1 FROM fusion_source_rights_withdrawals w
            WHERE w.tenant_id = r.tenant_id AND w.project_id = r.project_id
              AND w.source_kind = 'plan-proposal' AND w.reference_id = r.id
          ) LIMIT 1
      `;
    }
    if (descriptor.kind === "roomplan-proposal") {
      return this.#sql<PayloadRow[]>`
        SELECT r.result_payload AS payload, r.result_sha256 AS sha256,
          'c7-capture-proposal-v1' AS schema_version,
          jsonb_array_length(r.result_payload -> 'elementSources') AS element_count
        FROM capture_results r
        WHERE r.tenant_id = ${lease.tenantId}::uuid AND r.project_id = ${lease.projectId}::uuid
          AND r.id = ${descriptor.referenceId}::uuid AND r.status = 'proposal'
          AND c9_source_rights_active(r.tenant_id, r.project_id, 'roomplan-proposal', r.id)
          AND NOT EXISTS (
            SELECT 1 FROM fusion_source_rights_withdrawals w
            WHERE w.tenant_id = r.tenant_id AND w.project_id = r.project_id
              AND w.source_kind = 'roomplan-proposal' AND w.reference_id = r.id
          ) LIMIT 1
      `;
    }
    if (descriptor.kind === "reconstruction-result") {
      return this.#sql<PayloadRow[]>`
        SELECT r.result_payload AS payload, NULL::text AS sha256,
          'c8-reconstruction-result-v1' AS schema_version,
          (r.result_payload -> 'geometry' ->> 'registeredFrameCount')::int AS element_count
        FROM reconstruction_results r
        WHERE r.tenant_id = ${lease.tenantId}::uuid AND r.project_id = ${lease.projectId}::uuid
          AND r.id = ${descriptor.referenceId}::uuid AND r.status = 'completed'
          AND c9_source_rights_active(r.tenant_id, r.project_id, 'reconstruction-result', r.id)
          AND NOT EXISTS (
            SELECT 1 FROM fusion_source_rights_withdrawals w
            WHERE w.tenant_id = r.tenant_id AND w.project_id = r.project_id
              AND w.source_kind = 'reconstruction-result' AND w.reference_id = r.id
          ) LIMIT 1
      `;
    }
    // C9 can consume these producers when their exact implementation ports are composed.
    return Promise.resolve([]);
  }
}
