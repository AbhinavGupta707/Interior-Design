import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import {
  commitModelOperationsResponseSchema,
  modelBranchSchema,
  modelOperationsPreviewSchema,
} from "../../../packages/contracts/src/index.js";
import { describe, expect, it } from "vitest";

import { generatedRenameSequence } from "../../geometry/operations/operation-fixtures.js";

interface SqlClient {
  begin<T>(callback: (transaction: SqlClient) => Promise<T>): Promise<T>;
  end(options?: { readonly timeout?: number }): Promise<void>;
  unsafe<T extends readonly Record<string, unknown>[]>(
    query: string,
    parameters?: readonly unknown[],
  ): Promise<T>;
}

type PostgresFactory = (
  connection: string,
  options: { readonly max: number; readonly prepare: boolean },
) => SqlClient;

const requiredEnvironment = [
  "C5_LIVE_API_URL",
  "C5_LIVE_DATABASE_URL",
  "C5_LIVE_PROJECT_ID",
  "C5_LIVE_PROFILE",
  "C5_LIVE_SOURCE_SNAPSHOT_ID",
  "C5_LIVE_SOURCE_SNAPSHOT_SHA256",
  "C5_LIVE_OWNER_TOKEN",
  "C5_DB_BRANCH_TABLE",
  "C5_DB_SNAPSHOT_TABLE",
  "C5_DB_COMMIT_TABLE",
  "C5_DB_OPERATION_TABLE",
  "C5_DB_AUDIT_TABLE",
  "C5_DB_OUTBOX_TABLE",
  "C5_DB_AUDIT_BRANCH_COLUMN",
  "C5_DB_OUTBOX_BRANCH_COLUMN",
] as const;
const missingEnvironment = requiredEnvironment.filter(
  (name) => (process.env[name] ?? "").length === 0,
);
const liveEnabled =
  process.env.C5_RUN_LIVE_POSTGRES === "1" &&
  process.env.C5_LIVE_SOURCE_IS_C4_FIXTURE === "1" &&
  missingEnvironment.length === 0;

function environment(name: (typeof requiredEnvironment)[number]): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required.`);
  return value;
}

function sqlIdentifier(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/u.test(name)) {
    throw new Error(`Unsafe SQL identifier supplied for the C5 probe: ${name}`);
  }
  return `"${name}"`;
}

function apiPath(branchId?: string): string {
  const collection = `/v1/projects/${environment("C5_LIVE_PROJECT_ID")}/models/${environment("C5_LIVE_PROFILE")}/branches`;
  return branchId === undefined ? collection : `${collection}/${branchId}`;
}

async function apiRequest(pathname: string, body: unknown, key: string): Promise<Response> {
  return fetch(`${environment("C5_LIVE_API_URL").replace(/\/$/u, "")}${pathname}`, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${environment("C5_LIVE_OWNER_TOKEN")}`,
      "content-type": "application/json",
      "idempotency-key": key,
    },
    method: "POST",
    redirect: "manual",
  });
}

async function responseJson(response: Response): Promise<unknown> {
  return JSON.parse(await response.text()) as unknown;
}

function postgresFactory(): PostgresFactory {
  const requireFromApi = createRequire(`${process.cwd()}/services/platform-api/package.json`);
  const loaded = requireFromApi("postgres") as
    PostgresFactory | { readonly default: PostgresFactory };
  return typeof loaded === "function" ? loaded : loaded.default;
}

async function proveImmutable(
  sql: SqlClient,
  tableName: string,
  idColumn: string,
  id: unknown,
  mutation: "DELETE" | "UPDATE",
): Promise<boolean> {
  const table = sqlIdentifier(tableName);
  const column = sqlIdentifier(idColumn);
  const statement =
    mutation === "UPDATE"
      ? `UPDATE ${table} SET ${column} = ${column} WHERE ${column} = $1`
      : `DELETE FROM ${table} WHERE ${column} = $1`;
  try {
    await sql.begin(async (transaction) => {
      await transaction.unsafe(statement, [id]);
      throw new Error("C5_IMMUTABILITY_PROBE_WAS_NOT_BLOCKED");
    });
    return false;
  } catch (error) {
    return !(error instanceof Error && error.message === "C5_IMMUTABILITY_PROBE_WAS_NOT_BLOCKED");
  }
}

const suiteName = liveEnabled
  ? "live C5 Postgres atomicity and immutability acceptance"
  : `live C5 Postgres atomicity and immutability acceptance (skipped: set C5_RUN_LIVE_POSTGRES=1, C5_LIVE_SOURCE_IS_C4_FIXTURE=1 and table mapping; missing ${missingEnvironment.join(", ") || "no mapped environment"})`;

describe.skipIf(!liveEnabled)(suiteName, () => {
  it("connects one committed revision to snapshot, operations, audit and outbox atomically", async () => {
    const create = await apiRequest(
      apiPath(),
      {
        name: `Postgres atomicity ${randomUUID()}`,
        sourceSnapshotId: environment("C5_LIVE_SOURCE_SNAPSHOT_ID"),
        sourceSnapshotSha256: environment("C5_LIVE_SOURCE_SNAPSHOT_SHA256"),
      },
      `c5-db-branch-${randomUUID()}`,
    );
    expect([200, 201]).toContain(create.status);
    const branch = modelBranchSchema.parse(await responseJson(create));
    const previewResponse = await apiRequest(
      `${apiPath(branch.id)}/previews`,
      {
        expectedHeadSnapshotSha256: branch.headSnapshotSha256,
        expectedRevision: branch.revision,
        operations: generatedRenameSequence(3, 0xdb, 2_000),
      },
      `c5-db-preview-${randomUUID()}`,
    );
    expect([200, 201]).toContain(previewResponse.status);
    const preview = modelOperationsPreviewSchema.parse(await responseJson(previewResponse));
    const commitResponse = await apiRequest(
      `${apiPath(branch.id)}/commits`,
      {
        commitMessage: "Atomic database evidence",
        expectedHeadSnapshotSha256: branch.headSnapshotSha256,
        expectedRevision: branch.revision,
        previewId: preview.id,
      },
      `c5-db-commit-${randomUUID()}`,
    );
    expect([200, 201]).toContain(commitResponse.status);
    const committed = commitModelOperationsResponseSchema.parse(await responseJson(commitResponse));

    const postgres = postgresFactory();
    const sql = postgres(environment("C5_LIVE_DATABASE_URL"), { max: 1, prepare: false });
    const branchTable = sqlIdentifier(environment("C5_DB_BRANCH_TABLE"));
    const snapshotTable = sqlIdentifier(environment("C5_DB_SNAPSHOT_TABLE"));
    const commitTable = sqlIdentifier(environment("C5_DB_COMMIT_TABLE"));
    const operationTable = sqlIdentifier(environment("C5_DB_OPERATION_TABLE"));
    const auditTable = sqlIdentifier(environment("C5_DB_AUDIT_TABLE"));
    const outboxTable = sqlIdentifier(environment("C5_DB_OUTBOX_TABLE"));
    const auditBranchColumn = sqlIdentifier(environment("C5_DB_AUDIT_BRANCH_COLUMN"));
    const outboxBranchColumn = sqlIdentifier(environment("C5_DB_OUTBOX_BRANCH_COLUMN"));
    try {
      const branchRows = await sql.unsafe<readonly Record<string, unknown>[]>(
        `SELECT * FROM ${branchTable} WHERE id = $1`,
        [branch.id],
      );
      const commitRows = await sql.unsafe<readonly Record<string, unknown>[]>(
        `SELECT * FROM ${commitTable} WHERE branch_id = $1`,
        [branch.id],
      );
      const operationRows = await sql.unsafe<readonly Record<string, unknown>[]>(
        `SELECT * FROM ${operationTable} WHERE branch_id = $1`,
        [branch.id],
      );
      const snapshotRows = await sql.unsafe<readonly Record<string, unknown>[]>(
        `SELECT * FROM ${snapshotTable} WHERE id = $1`,
        [committed.commit.snapshotId],
      );
      const auditRows = await sql.unsafe<readonly Record<string, unknown>[]>(
        `SELECT * FROM ${auditTable} WHERE ${auditBranchColumn} = $1`,
        [branch.id],
      );
      const outboxRows = await sql.unsafe<readonly Record<string, unknown>[]>(
        `SELECT * FROM ${outboxTable} WHERE ${outboxBranchColumn} = $1`,
        [branch.id],
      );

      expect(branchRows).toHaveLength(1);
      expect(branchRows[0]).toMatchObject({
        head_snapshot_id: committed.commit.snapshotId,
        revision: 1,
      });
      expect(commitRows).toHaveLength(1);
      expect(operationRows).toHaveLength(3);
      expect(snapshotRows).toHaveLength(1);
      expect(auditRows.length).toBeGreaterThanOrEqual(1);
      expect(outboxRows.length).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(outboxRows)).not.toContain('"elements"');
      expect(JSON.stringify(outboxRows)).not.toContain('"coordinateSystem"');

      expect(
        await proveImmutable(
          sql,
          environment("C5_DB_OPERATION_TABLE"),
          "id",
          operationRows[0]?.id,
          "UPDATE",
        ),
      ).toBe(true);
      expect(
        await proveImmutable(
          sql,
          environment("C5_DB_COMMIT_TABLE"),
          "id",
          committed.commit.id,
          "DELETE",
        ),
      ).toBe(true);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
