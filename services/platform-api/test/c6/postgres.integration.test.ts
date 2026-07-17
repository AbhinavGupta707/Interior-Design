import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyC1Migration, bootstrapC1Fixtures, createC1Sql } from "../../src/c1.js";
import { applyC2Migration } from "../../src/c2.js";
import { applyC3Migration } from "../../src/c3.js";
import { applyC4Migration } from "../../src/c4.js";
import { applyC5Migration } from "../../src/c5.js";
import { applyC6Migration } from "../../src/c6.js";
import { PostgresPlanProcessingRepository } from "../../src/modules/plan-processing/postgres.js";
import { alphaTenantId, ownerUserId } from "../c4/fixtures.js";
import { actors } from "./support.js";

const databaseUrl = process.env.C6_TEST_DATABASE_URL ?? "";
const describeWithPostgres = databaseUrl.length === 0 ? describe.skip : describe;
const ownerActor = actors["fixture|owner-alpha"];
if (ownerActor === undefined) throw new Error("The C6 owner fixture is missing.");

function correlation(label: string, digit: string) {
  const traceId = digit.repeat(32);
  const spanId = digit.repeat(16);
  return { requestId: label, spanId, traceId, traceParent: `00-${traceId}-${spanId}-01` };
}

describeWithPostgres("C6 live Postgres workflow", () => {
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
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it("persists one exact create/replay, fenced state transition, safe audit/outbox and immutable terminal history", async () => {
    const projectId = randomUUID();
    const assetId = randomUUID();
    const sourceSha256 = "f".repeat(64);
    await sql`
      INSERT INTO projects (id, tenant_id, name)
      VALUES (${projectId}::uuid, ${alphaTenantId}::uuid, 'Synthetic C6 live project')
    `;
    await sql`
      INSERT INTO assets (
        id, tenant_id, project_id, kind, file_name, declared_mime_type,
        detected_mime_type, source_byte_size, source_sha256, source_object_key, status
      ) VALUES (
        ${assetId}::uuid, ${alphaTenantId}::uuid, ${projectId}::uuid, 'plan', 'fixture.svg',
        'image/svg+xml', 'image/svg+xml', 1024, ${sourceSha256}, ${`sources/${randomUUID()}`}, 'ready'
      )
    `;
    await sql`
      INSERT INTO asset_rights_assertions (
        tenant_id, project_id, asset_id, basis, service_processing_consent, training_use_consent
      ) VALUES (
        ${alphaTenantId}::uuid, ${projectId}::uuid, ${assetId}::uuid,
        'owned-by-user', true, 'denied'
      )
    `;
    const repository = new PostgresPlanProcessingRepository(sql);
    const command = {
      actor: ownerActor,
      assetId,
      correlation: correlation(`c6-live-${randomUUID()}`, "1"),
      idempotencyKey: `c6-live-${randomUUID()}`,
      pageIndex: 0,
      parserPreference: "auto" as const,
      projectId,
      sourceSha256,
    };
    const created = await repository.createJob(command);
    const replayed = await repository.createJob({
      ...command,
      correlation: correlation("replay-request", "2"),
    });
    expect(replayed).toEqual({ job: created.job, replayed: true });
    expect(await repository.findJob(randomUUID(), projectId, created.job.id)).toBeUndefined();

    const counts = await sql<
      {
        readonly audit_count: number;
        readonly job_count: number;
        readonly outbox_count: number;
      }[]
    >`
      SELECT
        (SELECT count(*)::int FROM plan_processing_jobs WHERE project_id = ${projectId}::uuid) AS job_count,
        (SELECT count(*)::int FROM plan_processing_audit_events WHERE project_id = ${projectId}::uuid) AS audit_count,
        (SELECT count(*)::int FROM plan_processing_outbox WHERE project_id = ${projectId}::uuid) AS outbox_count
    `;
    expect(counts[0]).toEqual({ audit_count: 1, job_count: 1, outbox_count: 1 });

    const cancelled = await repository.cancelJob({
      actor: ownerActor,
      correlation: correlation("c6-live-cancel", "3"),
      expectedVersion: created.job.version,
      idempotencyKey: `c6-cancel-${randomUUID()}`,
      jobId: created.job.id,
      projectId,
    });
    expect(cancelled.job.state).toBe("cancelled");
    await expect(
      sql`
        UPDATE plan_processing_jobs SET updated_at = clock_timestamp(), version = version + 1
        WHERE tenant_id = ${alphaTenantId}::uuid AND project_id = ${projectId}::uuid
          AND id = ${created.job.id}::uuid
      `,
    ).rejects.toThrow(/terminal plan jobs are immutable/u);

    const audit = await sql<{ readonly metadata: unknown }[]>`
      SELECT metadata FROM plan_processing_audit_events
      WHERE project_id = ${projectId}::uuid ORDER BY occurred_at, id
    `;
    expect(JSON.stringify(audit)).not.toMatch(/sourceObjectKey|operations|credential|signedUrl/u);
    expect(ownerUserId).toBe(command.actor.userId);
  });
});
