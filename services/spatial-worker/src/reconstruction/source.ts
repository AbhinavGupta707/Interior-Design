import { reconstructionSourceSchema, type ReconstructionSource } from "@interior-design/contracts";
import type { LeasedReconstructionAttempt } from "@interior-design/platform-api/reconstruction";
import type { Sql } from "postgres";

import type { ObjectStorage } from "../storage.js";
import {
  ReconstructionWorkerError,
  type LeasedReconstructionSource,
  type ReconstructionSourceLoader,
} from "./types.js";

interface SourceRow {
  readonly asset_id: string;
  readonly byte_size: number | string;
  readonly detected_mime_type: string;
  readonly object_key: string;
  readonly sha256: string;
  readonly source_kind: string;
}

export class PostgresReconstructionSourceLoader implements ReconstructionSourceLoader {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async load(lease: LeasedReconstructionAttempt): Promise<readonly LeasedReconstructionSource[]> {
    const rows = await this.#sql<SourceRow[]>`
      SELECT s.asset_id, s.source_kind, s.detected_mime_type,
        s.byte_size, s.sha256, a.source_object_key AS object_key
      FROM reconstruction_job_sources s
      JOIN assets a
        ON a.tenant_id = s.tenant_id AND a.project_id = s.project_id AND a.id = s.asset_id
      JOIN asset_rights_assertions r
        ON r.tenant_id = s.tenant_id AND r.project_id = s.project_id AND r.asset_id = s.asset_id
      LEFT JOIN reconstruction_rights_withdrawals w
        ON w.tenant_id = s.tenant_id AND w.project_id = s.project_id AND w.asset_id = s.asset_id
      WHERE s.tenant_id = ${lease.tenantId}::uuid
        AND s.project_id = ${lease.projectId}::uuid
        AND s.job_id = ${lease.jobId}::uuid
        AND a.status = 'ready'
        AND r.service_processing_consent
        AND r.training_use_consent = 'denied'
        AND w.asset_id IS NULL
      ORDER BY s.asset_id
    `;
    const byId = new Map(rows.map((row) => [row.asset_id, row]));
    const sources = lease.request.sources.map((declared) => {
      const row = byId.get(declared.assetId);
      if (
        row === undefined ||
        Number(row.byte_size) !== declared.byteSize ||
        row.detected_mime_type !== declared.detectedMimeType ||
        row.sha256 !== declared.sha256 ||
        row.source_kind !== declared.kind
      ) {
        throw new ReconstructionWorkerError("RECONSTRUCTION_SOURCE_FENCED");
      }
      return {
        ...reconstructionSourceSchema.parse({
          assetId: row.asset_id,
          byteSize: Number(row.byte_size),
          detectedMimeType: row.detected_mime_type,
          kind: row.source_kind,
          sha256: row.sha256,
        }),
        objectKey: row.object_key,
      };
    });
    if (sources.length !== rows.length) {
      throw new ReconstructionWorkerError("RECONSTRUCTION_SOURCE_FENCED");
    }
    return sources;
  }
}

export function mediaPreparationSources(
  sources: readonly LeasedReconstructionSource[],
  storage: ObjectStorage,
): readonly {
  readonly descriptor: ReconstructionSource &
    ({ readonly kind: "rgb-image" } | { readonly kind: "rgb-video" });
  open(): Promise<AsyncIterable<Uint8Array>>;
}[] {
  return sources
    .filter(
      (
        source,
      ): source is LeasedReconstructionSource &
        ({ readonly kind: "rgb-image" } | { readonly kind: "rgb-video" }) =>
        source.kind === "rgb-image" || source.kind === "rgb-video",
    )
    .map((source) => {
      const { objectKey, ...declared } = source;
      return {
        descriptor: reconstructionSourceSchema.parse(declared) as ReconstructionSource &
          ({ readonly kind: "rgb-image" } | { readonly kind: "rgb-video" }),
        open: () => storage.openSource("source", objectKey),
      };
    });
}
