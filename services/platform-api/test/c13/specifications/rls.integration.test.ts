import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createC1Sql } from "../../../src/c1.js";

const databaseUrl = process.env.C13_TEST_DATABASE_URL ?? "";
const describeWithPostgres = databaseUrl.length === 0 ? describe.skip : describe;
const probeRole = "c13_specification_rls_probe";

describeWithPostgres("C13 live PostgreSQL tenant isolation", () => {
  let sql: Sql;
  let tenantA: string;
  let tenantB: string;
  let projectA: string;
  let projectB: string;
  let userA: string;
  let userB: string;

  beforeAll(async () => {
    sql = createC1Sql(databaseUrl);
    tenantA = randomUUID();
    tenantB = randomUUID();
    projectA = randomUUID();
    projectB = randomUUID();
    userA = randomUUID();
    userB = randomUUID();

    await sql.unsafe(`
      DO $role$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${probeRole}') THEN
          CREATE ROLE ${probeRole} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
        END IF;
      END
      $role$;
      GRANT USAGE ON SCHEMA public TO ${probeRole};
      GRANT SELECT, INSERT ON specification_idempotency_effects TO ${probeRole};
    `);
    await sql`
      INSERT INTO identity_tenants (id, name) VALUES
        (${tenantA}::uuid, 'Synthetic C13 tenant A'),
        (${tenantB}::uuid, 'Synthetic C13 tenant B')
    `;
    await sql`
      INSERT INTO identity_users (id, subject, display_name) VALUES
        (${userA}::uuid, ${`synthetic-c13-a-${userA}`}, 'Synthetic C13 A'),
        (${userB}::uuid, ${`synthetic-c13-b-${userB}`}, 'Synthetic C13 B')
    `;
    await sql`
      INSERT INTO projects (id, tenant_id, name) VALUES
        (${projectA}::uuid, ${tenantA}::uuid, 'Synthetic C13 project A'),
        (${projectB}::uuid, ${tenantB}::uuid, 'Synthetic C13 project B')
    `;
    await sql`
      INSERT INTO specification_idempotency_effects (
        tenant_id, project_id, idempotency_key, actor_user_id,
        operation, request_sha256, created_at
      ) VALUES
        (${tenantA}::uuid, ${projectA}::uuid, ${randomUUID()}, ${userA}::uuid,
          'specification.create', ${"a".repeat(64)}, clock_timestamp()),
        (${tenantB}::uuid, ${projectB}::uuid, ${randomUUID()}, ${userB}::uuid,
          'specification.create', ${"b".repeat(64)}, clock_timestamp())
    `;
  });

  afterAll(async () => sql.end({ timeout: 5 }));

  it("uses a non-owner, non-superuser, NO-BYPASSRLS role and sees only its tenant", async () => {
    await sql.begin(async (transaction) => {
      await transaction.unsafe(`SET LOCAL ROLE ${probeRole}`);
      await transaction`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
      const role = await transaction<
        {
          readonly current_user: string;
          readonly rolbypassrls: boolean;
          readonly rolsuper: boolean;
        }[]
      >`
        SELECT current_user, rolbypassrls, rolsuper
        FROM pg_roles WHERE rolname = current_user
      `;
      expect(role).toEqual([{ current_user: probeRole, rolbypassrls: false, rolsuper: false }]);
      const rows = await transaction<{ readonly tenant_id: string }[]>`
        SELECT tenant_id::text FROM specification_idempotency_effects ORDER BY tenant_id
      `;
      expect(rows).toEqual([{ tenant_id: tenantA }]);
    });
  });

  it("rejects a cross-tenant insert before it can become an existence oracle", async () => {
    await expect(
      sql.begin(async (transaction) => {
        await transaction.unsafe(`SET LOCAL ROLE ${probeRole}`);
        await transaction`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
        await transaction`
          INSERT INTO specification_idempotency_effects (
            tenant_id, project_id, idempotency_key, actor_user_id,
            operation, request_sha256, created_at
          ) VALUES (
            ${tenantB}::uuid, ${projectB}::uuid, ${randomUUID()}, ${userB}::uuid,
            'specification.create', ${"c".repeat(64)}, clock_timestamp()
          )
        `;
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("surfaces a same-tenant missing composite target only as a foreign-key code", async () => {
    await expect(
      sql.begin(async (transaction) => {
        await transaction.unsafe(`SET LOCAL ROLE ${probeRole}`);
        await transaction`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
        await transaction`
          INSERT INTO specification_idempotency_effects (
            tenant_id, project_id, idempotency_key, actor_user_id,
            operation, request_sha256, created_at
          ) VALUES (
            ${tenantA}::uuid, ${randomUUID()}::uuid, ${randomUUID()}, ${userA}::uuid,
            'specification.create', ${"d".repeat(64)}, clock_timestamp()
          )
        `;
      }),
    ).rejects.toMatchObject({ code: "23503" });
  });
});
