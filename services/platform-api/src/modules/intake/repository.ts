import {
  projectIntakeSchema,
  type Actor,
  type ProjectIntake,
  type UpsertProjectIntakeRequest,
} from "@interior-design/contracts";
import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";

import type { RequestCorrelation } from "../../correlation.js";
import { ApiError } from "../../errors.js";
import { notFound } from "../identity/http.js";
import {
  claimIdempotency,
  completeIdempotency,
  type IdempotencyClaim,
} from "../projects/idempotency.js";

interface IntakeRow {
  readonly intake: unknown;
  readonly project_id: string;
  readonly updated_at: Date | string;
  readonly updated_by: string;
  readonly version: number;
}

interface IntakeVersionRow {
  readonly version: number;
}

export interface UpsertIntakeCommand {
  readonly actor: Actor;
  readonly correlation: RequestCorrelation;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly request: UpsertProjectIntakeRequest;
}

export interface IntakeRepository {
  find(tenantId: string, projectId: string): Promise<ProjectIntake | undefined>;
  upsert(command: UpsertIntakeCommand): Promise<ProjectIntake>;
}

function isoTimestamp(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function mapIntake(row: IntakeRow): ProjectIntake {
  return projectIntakeSchema.parse({
    intake: row.intake,
    projectId: row.project_id,
    updatedAt: isoTimestamp(row.updated_at),
    updatedBy: row.updated_by,
    version: row.version,
  });
}

function revisionConflict(): ApiError {
  return new ApiError({
    code: "REVISION_CONFLICT",
    detail: "The intake changed; reload it and retry with the current version.",
    statusCode: 409,
    title: "Revision Conflict",
  });
}

export class PostgresIntakeRepository implements IntakeRepository {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async find(tenantId: string, projectId: string): Promise<ProjectIntake | undefined> {
    const rows = await this.#sql<IntakeRow[]>`
      SELECT project_id, intake, version, updated_at, updated_by
      FROM project_intakes
      WHERE tenant_id = ${tenantId}::uuid
        AND project_id = ${projectId}::uuid
      LIMIT 1
    `;
    return rows[0] === undefined ? undefined : mapIntake(rows[0]);
  }

  async upsert(command: UpsertIntakeCommand): Promise<ProjectIntake> {
    return this.#sql.begin(async (transaction) => {
      const claim: IdempotencyClaim = {
        actorUserId: command.actor.userId,
        idempotencyKey: command.idempotencyKey,
        operation: `intake.upsert:${command.projectId}`,
        requestBody: command.request,
        tenantId: command.actor.tenantId,
      };
      const idempotency = await claimIdempotency(transaction, claim);
      if (idempotency.kind === "replay") {
        return projectIntakeSchema.parse(idempotency.body);
      }

      const projects = await transaction<{ readonly id: string }[]>`
        SELECT id
        FROM projects
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND id = ${command.projectId}::uuid
        FOR UPDATE
      `;
      if (projects.length === 0) {
        throw notFound();
      }

      const existingRows = await transaction<IntakeVersionRow[]>`
        SELECT version
        FROM project_intakes
        WHERE tenant_id = ${command.actor.tenantId}::uuid
          AND project_id = ${command.projectId}::uuid
        FOR UPDATE
      `;
      const existing = existingRows[0];
      if ((existing?.version ?? 0) !== command.request.expectedVersion) {
        throw revisionConflict();
      }

      let rows: readonly IntakeRow[];
      let action: "intake.create" | "intake.update";
      if (existing === undefined) {
        action = "intake.create";
        rows = await transaction<IntakeRow[]>`
          INSERT INTO project_intakes (
            tenant_id,
            project_id,
            intake,
            version,
            updated_by
          )
          VALUES (
            ${command.actor.tenantId}::uuid,
            ${command.projectId}::uuid,
            ${transaction.json(command.request.intake)},
            1,
            ${command.actor.userId}::uuid
          )
          RETURNING project_id, intake, version, updated_at, updated_by
        `;
      } else {
        action = "intake.update";
        rows = await transaction<IntakeRow[]>`
          UPDATE project_intakes
          SET intake = ${transaction.json(command.request.intake)},
              version = version + 1,
              updated_at = clock_timestamp(),
              updated_by = ${command.actor.userId}::uuid
          WHERE tenant_id = ${command.actor.tenantId}::uuid
            AND project_id = ${command.projectId}::uuid
            AND version = ${command.request.expectedVersion}
          RETURNING project_id, intake, version, updated_at, updated_by
        `;
      }
      const row = rows[0];
      if (row === undefined) {
        throw revisionConflict();
      }
      const intake = mapIntake(row);
      await transaction`
        INSERT INTO audit_events (
          id,
          tenant_id,
          actor_user_id,
          action,
          resource_type,
          resource_id,
          request_id,
          trace_id
        )
        VALUES (
          ${randomUUID()}::uuid,
          ${command.actor.tenantId}::uuid,
          ${command.actor.userId}::uuid,
          ${action},
          'project_intake',
          ${command.projectId}::uuid,
          ${command.correlation.requestId},
          ${command.correlation.traceId}
        )
      `;
      await completeIdempotency(transaction, claim, 200, intake);
      return intake;
    });
  }
}
