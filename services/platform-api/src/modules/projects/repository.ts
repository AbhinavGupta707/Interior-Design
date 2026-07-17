import {
  projectSchema,
  type Actor,
  type CreateProjectRequest,
  type Project,
} from "@interior-design/contracts";
import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";

import type { RequestCorrelation } from "../../correlation.js";
import { claimIdempotency, completeIdempotency, type IdempotencyClaim } from "./idempotency.js";

interface ProjectRow {
  readonly created_at: Date | string;
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly tenant_id: string;
  readonly updated_at: Date | string;
  readonly version: number;
}

export interface CreateProjectCommand {
  readonly actor: Actor;
  readonly correlation: RequestCorrelation;
  readonly idempotencyKey: string;
  readonly request: CreateProjectRequest;
}

export interface ProjectRepository {
  create(command: CreateProjectCommand): Promise<Project>;
  findById(tenantId: string, projectId: string): Promise<Project | undefined>;
  list(tenantId: string): Promise<readonly Project[]>;
}

function isoTimestamp(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function mapProject(row: ProjectRow): Project {
  return projectSchema.parse({
    createdAt: isoTimestamp(row.created_at),
    id: row.id,
    name: row.name,
    status: row.status,
    tenantId: row.tenant_id,
    updatedAt: isoTimestamp(row.updated_at),
    version: row.version,
  });
}

export class PostgresProjectRepository implements ProjectRepository {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async create(command: CreateProjectCommand): Promise<Project> {
    return this.#sql.begin(async (transaction) => {
      const claim: IdempotencyClaim = {
        actorUserId: command.actor.userId,
        idempotencyKey: command.idempotencyKey,
        operation: "project.create",
        requestBody: command.request,
        tenantId: command.actor.tenantId,
      };
      const idempotency = await claimIdempotency(transaction, claim);
      if (idempotency.kind === "replay") {
        return projectSchema.parse(idempotency.body);
      }

      const projectId = randomUUID();
      const rows = await transaction<ProjectRow[]>`
        INSERT INTO projects (id, tenant_id, name)
        VALUES (${projectId}::uuid, ${command.actor.tenantId}::uuid, ${command.request.name})
        RETURNING id, tenant_id, name, status, version, created_at, updated_at
      `;
      const row = rows[0];
      if (row === undefined) {
        throw new Error("Project insert returned no row.");
      }
      const project = mapProject(row);
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
          'project.create',
          'project',
          ${project.id}::uuid,
          ${command.correlation.requestId},
          ${command.correlation.traceId}
        )
      `;
      await completeIdempotency(transaction, claim, 201, project);
      return project;
    });
  }

  async findById(tenantId: string, projectId: string): Promise<Project | undefined> {
    const rows = await this.#sql<ProjectRow[]>`
      SELECT id, tenant_id, name, status, version, created_at, updated_at
      FROM projects
      WHERE tenant_id = ${tenantId}::uuid
        AND id = ${projectId}::uuid
      LIMIT 1
    `;
    return rows[0] === undefined ? undefined : mapProject(rows[0]);
  }

  async list(tenantId: string): Promise<readonly Project[]> {
    const rows = await this.#sql<ProjectRow[]>`
      SELECT id, tenant_id, name, status, version, created_at, updated_at
      FROM projects
      WHERE tenant_id = ${tenantId}::uuid
      ORDER BY created_at ASC, id ASC
    `;
    return rows.map((row) => mapProject(row));
  }
}
