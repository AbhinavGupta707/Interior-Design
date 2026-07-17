import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyC1Migration, bootstrapC1Fixtures, createC1Sql } from "../../src/c1.js";
import { applyC2Migration } from "../../src/c2.js";
import { applyC3Migration } from "../../src/c3.js";
import { applyC4Migration } from "../../src/c4.js";
import { applyC5Migration } from "../../src/c5.js";
import { applyC6Migration } from "../../src/c6.js";
import { applyC7Migration } from "../../src/c7.js";
import { applyC8Migration } from "../../src/c8.js";
import { applyC9Migration } from "../../src/c9.js";

const databaseUrl = process.env.C9_TEST_DATABASE_URL ?? "";
const describeWithPostgres = databaseUrl.length === 0 ? describe.skip : describe;

describeWithPostgres("C9 live Postgres schema fencing", () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = createC1Sql(databaseUrl);
    await applyC1Migration(sql);
    await bootstrapC1Fixtures(sql, "test");
    await applyC2Migration(sql);
    await applyC3Migration(sql);
    await applyC4Migration(sql);
    await applyC5Migration(sql);
    await applyC6Migration(sql);
    await applyC7Migration(sql);
    await applyC8Migration(sql);
    await applyC9Migration(sql);
  });

  afterAll(async () => sql.end({ timeout: 5 }));

  it("registers the migration and all durable tenant-scoped C9 stores", async () => {
    const rows = await sql<{ readonly name: string }[]>`
      SELECT table_name AS name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY(${sql.array([
        "fusion_jobs",
        "fusion_job_sources",
        "fusion_attempts",
        "fusion_proposals",
        "fusion_proposal_review_heads",
        "fusion_discrepancy_decisions",
        "fusion_operation_drafts",
        "fusion_source_rights_withdrawals",
        "fusion_audit_events",
        "fusion_outbox",
      ])}::text[])
      ORDER BY table_name
    `;
    expect(rows).toHaveLength(10);
    expect(
      await sql<{ readonly applied: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM platform_schema_migrations WHERE id = '0009_model_fusion'
        ) AS applied
      `,
    ).toEqual([{ applied: true }]);
  });

  it("defaults an unknown or cross-scope source rights check to denied", async () => {
    const rows = await sql<{ readonly permitted: boolean }[]>`
      SELECT c9_source_rights_active(
        ${randomUUID()}::uuid,
        ${randomUUID()}::uuid,
        'plan-proposal',
        ${randomUUID()}::uuid
      ) AS permitted
    `;
    expect(rows).toEqual([{ permitted: false }]);
  });

  it("installs immutable triggers for every material evidence/review/publication table", async () => {
    const rows = await sql<{ readonly trigger_name: string }[]>`
      SELECT trigger_name FROM information_schema.triggers
      WHERE event_object_schema = 'public' AND trigger_name = ANY(${sql.array([
        "fusion_proposals_append_only",
        "fusion_decisions_append_only",
        "fusion_drafts_append_only",
        "fusion_rights_withdrawals_append_only",
        "fusion_audit_append_only",
        "fusion_outbox_append_only",
      ])}::text[])
      ORDER BY trigger_name
    `;
    expect(new Set(rows.map(({ trigger_name }) => trigger_name)).size).toBe(6);
  });
});
