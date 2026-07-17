import { planParserRequestSchema } from "@interior-design/contracts";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LocalPlanParserFake } from "../../src/plan-processing/parser.js";
import { PostgresPlanProcessingQueue } from "../../src/plan-processing/postgres.js";
import type { LeasedPlanProcessingJob } from "../../src/plan-processing/types.js";

const databaseUrl = process.env.C6_TEST_DATABASE_URL ?? "";
const describeWithPostgres = databaseUrl.length === 0 ? describe.skip : describe;
const migrationDirectory = fileURLToPath(
  new URL("../../../platform-api/migrations/", import.meta.url),
);

async function insertQueuedJob(
  sql: Sql,
  input: {
    readonly assetId: string;
    readonly createdBy: string;
    readonly jobId: string;
    readonly projectId: string;
    readonly sourceSha256: string;
    readonly tenantId: string;
  },
): Promise<void> {
  await sql`
    INSERT INTO plan_processing_jobs (
      tenant_id, project_id, id, root_job_id, asset_id, page_index, parser_preference,
      source_sha256, attempt, state, retryable, created_by, created_at, updated_at, version
    ) VALUES (
      ${input.tenantId}::uuid, ${input.projectId}::uuid, ${input.jobId}::uuid,
      ${input.jobId}::uuid, ${input.assetId}::uuid, 0, 'fixture', ${input.sourceSha256},
      1, 'queued', false, ${input.createdBy}::uuid, clock_timestamp(), clock_timestamp(), 1
    )
  `;
}

async function fixtureResult(job: LeasedPlanProcessingJob) {
  const normalizedInputSha256 = "d".repeat(64);
  const normalizers = [{ name: "c6-fixture-normalizer", version: "1.0.0" }];
  const request = planParserRequestSchema.parse({
    jobId: job.jobId,
    limits: {
      maximumCandidates: 200,
      maximumOutputBytes: 5_242_880,
      timeoutMilliseconds: 30_000,
    },
    normalizers,
    normalizedInputSha256,
    parserMode: "deterministic-fixture",
    schemaVersion: "c6-plan-parser-input-v1",
    source: {
      assetId: job.assetId,
      byteSize: job.sourceByteSize,
      coordinateSpace: "fixture-microunits",
      detectedMimeType: job.detectedMimeType,
      heightSourceUnits: 1_000_000,
      pageIndex: job.pageIndex,
      projectId: job.projectId,
      rights: job.rights,
      sha256: job.sourceSha256,
      widthSourceUnits: 1_000_000,
    },
  });
  return new LocalPlanParserFake(() => new Date("2026-07-17T12:00:00.000Z")).parse({
    coordinateSpace: "fixture-microunits",
    filePath: "/internal/live-fixture.json",
    heightSourceUnits: 1_000_000,
    mode: "deterministic-fixture",
    normalizers,
    request,
    sha256: normalizedInputSha256,
    widthSourceUnits: 1_000_000,
  });
}

describeWithPostgres("C6 live Postgres worker fencing", () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = postgres(databaseUrl, { max: 4, onnotice: () => undefined, prepare: true });
    for (const migration of [
      "0001_identity_projects_intake.sql",
      "0002_assets_evidence.sql",
      "0003_property_dossier.sql",
      "0004_canonical_models.sql",
      "0005_model_operations.sql",
      "0006_plan_processing.sql",
    ]) {
      await sql.begin(async (transaction) => {
        await transaction.file(path.join(migrationDirectory, migration));
      });
    }
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it("fences expired and cancelled leases, publishes one immutable result, and rechecks rights", async () => {
    const tenantId = randomUUID();
    const ownerUserId = randomUUID();
    const projectId = randomUUID();
    const assetId = randomUUID();
    const sourceSha256 = "e".repeat(64);
    await sql`
      INSERT INTO identity_tenants (id, name)
      VALUES (${tenantId}::uuid, 'Synthetic C6 worker tenant')
    `;
    await sql`
      INSERT INTO identity_users (id, subject, display_name)
      VALUES (${ownerUserId}::uuid, ${`c6-live-${ownerUserId}`}, 'Synthetic C6 worker owner')
    `;
    await sql`
      INSERT INTO projects (id, tenant_id, name)
      VALUES (${projectId}::uuid, ${tenantId}::uuid, 'Synthetic C6 worker project')
    `;
    await sql`
      INSERT INTO assets (
        id, tenant_id, project_id, kind, file_name, declared_mime_type,
        detected_mime_type, source_byte_size, source_sha256, source_object_key, status
      ) VALUES (
        ${assetId}::uuid, ${tenantId}::uuid, ${projectId}::uuid, 'plan', 'fixture.svg',
        'image/svg+xml', 'image/svg+xml', 1024, ${sourceSha256}, ${`sources/${randomUUID()}`},
        'ready'
      )
    `;
    await sql`
      INSERT INTO asset_rights_assertions (
        tenant_id, project_id, asset_id, basis, service_processing_consent, training_use_consent
      ) VALUES (
        ${tenantId}::uuid, ${projectId}::uuid, ${assetId}::uuid,
        'owned-by-user', true, 'denied'
      )
    `;
    const queue = new PostgresPlanProcessingQueue(sql);

    const publishJobId = randomUUID();
    await insertQueuedJob(sql, {
      assetId,
      createdBy: ownerUserId,
      jobId: publishJobId,
      projectId,
      sourceSha256,
      tenantId,
    });
    const expiredLease = await queue.claimNext("c6-live-worker-a", 60_000);
    expect(expiredLease?.jobId).toBe(publishJobId);
    if (expiredLease === undefined) throw new Error("Expected the live publish lease.");
    const result = await fixtureResult(expiredLease);
    await sql`
      UPDATE plan_processing_jobs
      SET lease_expires_at = clock_timestamp() - interval '1 second',
          updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 microsecond'),
          version = version + 1
      WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
        AND id = ${publishJobId}::uuid
    `;
    expect(await queue.publish(expiredLease, "c6-live-worker-a", result)).toBe(false);
    const currentLease = await queue.claimNext("c6-live-worker-b", 60_000);
    expect(currentLease?.jobId).toBe(publishJobId);
    if (currentLease === undefined) throw new Error("Expected the reclaimed live lease.");
    expect(await queue.publish(currentLease, "c6-live-worker-b", result)).toBe(true);
    expect(await queue.publish(currentLease, "c6-live-worker-b", result)).toBe(false);
    const terminal = await sql<{ readonly result_count: number; readonly state: string }[]>`
      SELECT j.state,
        (SELECT count(*)::int FROM plan_processing_results r
          WHERE r.tenant_id = j.tenant_id AND r.project_id = j.project_id AND r.job_id = j.id
        ) AS result_count
      FROM plan_processing_jobs j
      WHERE j.tenant_id = ${tenantId}::uuid AND j.project_id = ${projectId}::uuid
        AND j.id = ${publishJobId}::uuid
    `;
    expect(terminal[0]).toEqual({ result_count: 1, state: "proposed" });
    await expect(
      sql`
        UPDATE plan_processing_results SET created_at = clock_timestamp()
        WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
          AND job_id = ${publishJobId}::uuid
      `,
    ).rejects.toThrow(/append-only/u);

    const cancelledJobId = randomUUID();
    await insertQueuedJob(sql, {
      assetId,
      createdBy: ownerUserId,
      jobId: cancelledJobId,
      projectId,
      sourceSha256,
      tenantId,
    });
    const cancelledLease = await queue.claimNext("c6-live-worker-c", 60_000);
    expect(cancelledLease?.jobId).toBe(cancelledJobId);
    if (cancelledLease === undefined) throw new Error("Expected the live cancellation lease.");
    await sql`
      UPDATE plan_processing_jobs
      SET state = 'cancel-requested',
          updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 microsecond'),
          version = version + 1
      WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
        AND id = ${cancelledJobId}::uuid
    `;
    expect(
      await queue.publish(cancelledLease, "c6-live-worker-c", await fixtureResult(cancelledLease)),
    ).toBe(false);
    expect(await queue.acknowledgeCancellation(cancelledLease, "c6-live-worker-c")).toBe(true);

    const rightsAssetId = randomUUID();
    await sql`
      INSERT INTO assets (
        id, tenant_id, project_id, kind, file_name, declared_mime_type,
        detected_mime_type, source_byte_size, source_sha256, source_object_key, status
      ) VALUES (
        ${rightsAssetId}::uuid, ${tenantId}::uuid, ${projectId}::uuid, 'plan', 'denied.svg',
        'image/svg+xml', 'image/svg+xml', 1024, ${sourceSha256}, ${`sources/${randomUUID()}`},
        'ready'
      )
    `;
    const rightsJobId = randomUUID();
    await insertQueuedJob(sql, {
      assetId: rightsAssetId,
      createdBy: ownerUserId,
      jobId: rightsJobId,
      projectId,
      sourceSha256,
      tenantId,
    });
    expect(await queue.claimNext("c6-live-worker-d", 60_000)).toBeUndefined();
    const rejected = await sql<{ readonly safe_code: string; readonly state: string }[]>`
      SELECT state, safe_code FROM plan_processing_jobs
      WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
        AND id = ${rightsJobId}::uuid
    `;
    expect(rejected[0]).toEqual({ safe_code: "rights-not-permitted", state: "failed" });
  });
});
