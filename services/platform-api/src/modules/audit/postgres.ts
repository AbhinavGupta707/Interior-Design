import type { Sql } from "postgres";

import {
  immutableModelAuditEventSchema,
  type ImmutableModelAuditEvent,
  type ImmutableModelAuditProjectionPort,
  type ReadImmutableModelAuditPage,
} from "./types.js";

interface ModelAuditRow {
  readonly action: string;
  readonly actor_user_id: string;
  readonly branch_id: string;
  readonly commit_id: string | null;
  readonly id: string;
  readonly model_id: string;
  readonly occurred_at: Date | string;
  readonly operation_types: unknown;
  readonly outcome: string;
  readonly profile: string;
  readonly project_id: string;
  readonly request_id: string;
  readonly revision: number;
  readonly snapshot_id: string;
  readonly tenant_id: string;
  readonly trace_id: string;
}

function timestamp(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function mapAuditRow(row: ModelAuditRow): ImmutableModelAuditEvent {
  const operationTypes = Array.isArray(row.operation_types) ? row.operation_types : [];
  return immutableModelAuditEventSchema.parse({
    action: row.action,
    actor: { id: row.actor_user_id, kind: "human" },
    branchId: row.branch_id,
    ...(row.commit_id === null ? {} : { commitId: row.commit_id }),
    eventId: row.id,
    modelId: row.model_id,
    occurredAt: timestamp(row.occurred_at),
    ...(operationTypes.length === 0 ? {} : { operationTypes }),
    outcome: row.outcome,
    profile: row.profile,
    projectId: row.project_id,
    requestId: row.request_id,
    revision: row.revision,
    snapshotId: row.snapshot_id,
    tenantId: row.tenant_id,
    traceId: row.trace_id,
  });
}

/** Tenant-scoped, newest-first adapter for the immutable C5 audit projection. */
export class PostgresModelAuditProjectionPort implements ImmutableModelAuditProjectionPort {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async listNewest(
    input: ReadImmutableModelAuditPage,
  ): Promise<readonly ImmutableModelAuditEvent[]> {
    const rows =
      input.before === undefined
        ? await this.#sql<ModelAuditRow[]>`
            SELECT id, tenant_id, project_id, model_id, profile, branch_id, commit_id,
                   revision, action, operation_types, snapshot_id, actor_user_id,
                   request_id, trace_id, occurred_at, outcome
            FROM model_domain_audit_events
            WHERE tenant_id = ${input.scope.tenantId}::uuid
              AND project_id = ${input.scope.projectId}::uuid
              AND model_id = ${input.scope.modelId}::uuid
              AND profile = ${input.scope.profile}
              AND branch_id = ${input.scope.branchId}::uuid
            ORDER BY occurred_at DESC, id DESC
            LIMIT ${input.limit}
          `
        : await this.#sql<ModelAuditRow[]>`
            SELECT id, tenant_id, project_id, model_id, profile, branch_id, commit_id,
                   revision, action, operation_types, snapshot_id, actor_user_id,
                   request_id, trace_id, occurred_at, outcome
            FROM model_domain_audit_events
            WHERE tenant_id = ${input.scope.tenantId}::uuid
              AND project_id = ${input.scope.projectId}::uuid
              AND model_id = ${input.scope.modelId}::uuid
              AND profile = ${input.scope.profile}
              AND branch_id = ${input.scope.branchId}::uuid
              AND (occurred_at, id) < (
                ${input.before.occurredAt}::timestamptz,
                ${input.before.eventId}::uuid
              )
            ORDER BY occurred_at DESC, id DESC
            LIMIT ${input.limit}
          `;
    return rows.map(mapAuditRow);
  }
}
