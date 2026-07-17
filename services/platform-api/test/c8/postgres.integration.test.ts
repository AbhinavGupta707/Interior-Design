import type { Actor, CreateReconstructionJobRequest } from "@interior-design/contracts";
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
import { PostgresReconstructionRepository } from "../../src/modules/reconstruction/postgres.js";
import { ReconstructionService } from "../../src/modules/reconstruction/service.js";
import type { ReconstructionClock } from "../../src/modules/reconstruction/types.js";
import { alphaTenantId } from "../c4/fixtures.js";
import { actors } from "../c6/support.js";
import { abstainedResult, completedResult, requestWithSources } from "./support.js";

const databaseUrl = process.env.C8_TEST_DATABASE_URL ?? "";
const describeWithPostgres = databaseUrl.length === 0 ? describe.skip : describe;

function owner(): Actor {
  const actor = actors["fixture|owner-alpha"];
  if (!actor) throw new Error("The synthetic C8 owner fixture is missing.");
  return actor;
}

class MutableClock implements ReconstructionClock {
  #now = new Date("2026-07-17T14:00:00.000Z");

  advance(milliseconds: number): void {
    this.#now = new Date(this.#now.getTime() + milliseconds);
  }

  now(): Date {
    return new Date(this.#now);
  }
}

function correlation(label: string, digit: string) {
  const traceId = digit.repeat(32);
  const spanId = digit.repeat(16);
  return { requestId: label, spanId, traceId, traceParent: `00-${traceId}-${spanId}-01` };
}

describeWithPostgres("C8 live Postgres reconstruction workflow", () => {
  let assetId: string;
  let clock: MutableClock;
  let projectId: string;
  let repository: PostgresReconstructionRepository;
  let request: CreateReconstructionJobRequest;
  let service: ReconstructionService;
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
    projectId = randomUUID();
    assetId = randomUUID();
    await sql`
      INSERT INTO projects (id, tenant_id, name)
      VALUES (${projectId}::uuid, ${alphaTenantId}::uuid, 'Visibly synthetic C8 live project')
    `;
    await sql`
      INSERT INTO assets (
        id, tenant_id, project_id, kind, file_name, declared_mime_type,
        detected_mime_type, source_byte_size, source_sha256, source_object_key, status
      ) VALUES (
        ${assetId}::uuid, ${alphaTenantId}::uuid, ${projectId}::uuid, 'photograph',
        'visibly-synthetic-room.jpg', 'image/jpeg', 'image/jpeg', 2048,
        ${"8".repeat(64)}, ${`sources/${randomUUID()}`}, 'ready'
      )
    `;
    await sql`
      INSERT INTO asset_rights_assertions (
        tenant_id, project_id, asset_id, basis,
        service_processing_consent, training_use_consent
      ) VALUES (
        ${alphaTenantId}::uuid, ${projectId}::uuid, ${assetId}::uuid,
        'owned-by-user', true, 'denied'
      )
    `;
    request = requestWithSources([
      {
        assetId,
        byteSize: 2_048,
        detectedMimeType: "image/jpeg",
        kind: "rgb-image",
        sha256: "8".repeat(64),
      },
    ]);
    clock = new MutableClock();
    repository = new PostgresReconstructionRepository(sql, { clock });
    service = new ReconstructionService(repository, { record: () => undefined });
  });

  afterAll(async () => sql.end({ timeout: 5 }));

  async function createJob(key: string) {
    return service.createJob({
      actor: owner(),
      correlation: correlation(key, "1"),
      idempotencyKey: key,
      projectId,
      request,
    });
  }

  it("publishes one immutable proposal with exact replay, lease fencing, safe audit and no canonical mutation", async () => {
    const canonicalBefore = await sql<{ readonly count: number }[]>`
      SELECT count(*)::int AS count FROM canonical_model_snapshots WHERE project_id = ${projectId}::uuid
    `;
    const key = `c8-live-create-${randomUUID()}`;
    const created = await createJob(key);
    const replayed = await createJob(key);
    expect(replayed).toEqual({ job: created.job, replayed: true });
    expect(await repository.findJob(randomUUID(), projectId, created.job.id)).toBeUndefined();

    const firstLease = await repository.claimNext({ leaseSeconds: 30, workerId: "c8-live-worker" });
    expect(firstLease).toMatchObject({ attempt: 1, jobId: created.job.id, stage: "preparing" });
    if (!firstLease) throw new Error("The C8 live lease was not created.");
    clock.advance(31_000);
    const reclaimed = await repository.claimNext({ leaseSeconds: 60, workerId: "c8-reclaimer" });
    expect(reclaimed?.leaseToken).not.toBe(firstLease.leaseToken);
    if (!reclaimed) throw new Error("The expired C8 lease was not reclaimed.");
    await expect(
      repository.advanceAttempt({
        attempt: firstLease.attempt,
        jobId: firstLease.jobId,
        leaseToken: firstLease.leaseToken,
        stage: "ready-for-reconstruction",
        workerId: "c8-live-worker",
      }),
    ).rejects.toMatchObject({ code: "RECONSTRUCTION_LEASE_FENCED" });
    await repository.advanceAttempt({
      attempt: reclaimed.attempt,
      jobId: reclaimed.jobId,
      leaseToken: reclaimed.leaseToken,
      stage: "ready-for-reconstruction",
      workerId: "c8-reclaimer",
    });
    await repository.advanceAttempt({
      attempt: reclaimed.attempt,
      jobId: reclaimed.jobId,
      leaseToken: reclaimed.leaseToken,
      stage: "reconstructing-geometry",
      workerId: "c8-reclaimer",
    });
    const published = await repository.publishResult({
      attempt: reclaimed.attempt,
      jobId: reclaimed.jobId,
      leaseToken: reclaimed.leaseToken,
      result: completedResult({
        jobId: reclaimed.jobId,
        projectId,
        sourceManifestSha256: reclaimed.sourceManifestSha256,
      }),
      workerId: "c8-reclaimer",
    });
    expect(published.state).toBe("completed");
    expect(published.resultId).toMatch(/^[0-9a-f-]{36}$/u);
    expect((await repository.findResult(alphaTenantId, projectId, published.id))?.status).toBe(
      "completed",
    );
    await expect(
      repository.publishResult({
        attempt: reclaimed.attempt,
        jobId: reclaimed.jobId,
        leaseToken: reclaimed.leaseToken,
        result: completedResult({
          jobId: reclaimed.jobId,
          projectId,
          sourceManifestSha256: reclaimed.sourceManifestSha256,
        }),
        workerId: "c8-reclaimer",
      }),
    ).rejects.toMatchObject({ code: "RECONSTRUCTION_LEASE_FENCED" });
    await expect(
      sql`
        UPDATE reconstruction_results SET created_at = clock_timestamp()
        WHERE tenant_id = ${alphaTenantId}::uuid AND project_id = ${projectId}::uuid
          AND job_id = ${published.id}::uuid
      `,
    ).rejects.toThrow(/append-only/u);
    await expect(
      sql`
        UPDATE reconstruction_jobs SET updated_at = clock_timestamp(), version = version + 1
        WHERE tenant_id = ${alphaTenantId}::uuid AND project_id = ${projectId}::uuid
          AND id = ${published.id}::uuid
      `,
    ).rejects.toThrow(/published reconstruction jobs are immutable/u);

    const counts = await sql<
      {
        readonly audit_count: number;
        readonly canonical_count: number;
        readonly outbox_count: number;
      }[]
    >`
      SELECT
        (SELECT count(*)::int FROM reconstruction_audit_events
          WHERE project_id = ${projectId}::uuid) AS audit_count,
        (SELECT count(*)::int FROM reconstruction_outbox
          WHERE project_id = ${projectId}::uuid) AS outbox_count,
        (SELECT count(*)::int FROM canonical_model_snapshots
          WHERE project_id = ${projectId}::uuid) AS canonical_count
    `;
    expect(counts[0]?.audit_count).toBeGreaterThanOrEqual(5);
    expect(counts[0]?.outbox_count).toBe(counts[0]?.audit_count);
    expect(counts[0]?.canonical_count).toBe(canonicalBefore[0]?.count);
    const safeRecords = await sql<{ readonly payload: unknown }[]>`
      SELECT metadata AS payload FROM reconstruction_audit_events WHERE project_id = ${projectId}::uuid
      UNION ALL
      SELECT payload FROM reconstruction_outbox WHERE project_id = ${projectId}::uuid
    `;
    expect(JSON.stringify(safeRecords)).not.toMatch(
      /sourceObjectKey|objectKey|signedUrl|rawMedia|credential|stdout|stderr/u,
    );
  });

  it.each([
    "preparing",
    "ready-for-reconstruction",
    "reconstructing-geometry",
    "reconstructing-appearance",
  ] as const)("cancels safely during the %s stage", async (targetStage) => {
    clock.advance(1_000);
    const created = await createJob(`c8-cancel-${targetStage}-${randomUUID()}`);
    const lease = await repository.claimNext({ workerId: `worker-${targetStage}` });
    if (!lease) throw new Error(`No synthetic lease for ${targetStage}.`);
    const progression = [
      "ready-for-reconstruction",
      "reconstructing-geometry",
      "reconstructing-appearance",
    ] as const;
    for (const stage of progression) {
      if (targetStage === "preparing") break;
      await repository.advanceAttempt({
        attempt: lease.attempt,
        jobId: lease.jobId,
        leaseToken: lease.leaseToken,
        stage,
        workerId: `worker-${targetStage}`,
      });
      if (stage === targetStage) break;
    }
    const current = await repository.findJob(alphaTenantId, projectId, created.job.id);
    if (!current) throw new Error("The synthetic cancellation job disappeared.");
    const requested = await repository.cancelJob({
      actor: owner(),
      correlation: correlation(`cancel-${targetStage}`, "2"),
      expectedVersion: current.version,
      idempotencyKey: `c8-cancel-action-${targetStage}-${randomUUID()}`,
      projectId,
      reconstructionJobId: current.id,
    });
    expect(requested.job.state).toBe("cancel-requested");
    await repository.acknowledgeCancellation({
      attempt: lease.attempt,
      jobId: lease.jobId,
      leaseToken: lease.leaseToken,
      workerId: `worker-${targetStage}`,
    });
    expect((await repository.findJob(alphaTenantId, projectId, current.id))?.state).toBe(
      "cancelled",
    );
  });

  it("fences an expired cancellation acknowledgement and lets reclaim finish safely", async () => {
    clock.advance(1_000);
    const created = await createJob(`c8-expired-cancel-${randomUUID()}`);
    const lease = await repository.claimNext({
      leaseSeconds: 30,
      workerId: "c8-expired-cancel-worker",
    });
    if (!lease) throw new Error("The synthetic cancellation lease was not created.");
    const current = await repository.findJob(alphaTenantId, projectId, created.job.id);
    if (!current) throw new Error("The synthetic cancellation job disappeared.");
    await repository.cancelJob({
      actor: owner(),
      correlation: correlation("expired-cancel", "6"),
      expectedVersion: current.version,
      idempotencyKey: `c8-expired-cancel-action-${randomUUID()}`,
      projectId,
      reconstructionJobId: current.id,
    });
    clock.advance(31_000);
    await expect(
      repository.acknowledgeCancellation({
        attempt: lease.attempt,
        jobId: lease.jobId,
        leaseToken: lease.leaseToken,
        workerId: "c8-expired-cancel-worker",
      }),
    ).rejects.toMatchObject({ code: "RECONSTRUCTION_LEASE_FENCED" });
    expect(await repository.claimNext({ workerId: "c8-cancellation-reclaimer" })).toBeUndefined();
    expect(await repository.findJob(alphaTenantId, projectId, current.id)).toMatchObject({
      retryable: true,
      state: "cancelled",
    });
  });

  it("publishes one immutable abstention without inventing geometry", async () => {
    clock.advance(1_000);
    const created = await createJob(`c8-abstain-${randomUUID()}`);
    const lease = await repository.claimNext({ workerId: "c8-abstention-worker" });
    if (!lease) throw new Error("The synthetic abstention lease was not created.");
    await repository.advanceAttempt({
      attempt: lease.attempt,
      jobId: lease.jobId,
      leaseToken: lease.leaseToken,
      stage: "ready-for-reconstruction",
      workerId: "c8-abstention-worker",
    });
    await repository.advanceAttempt({
      attempt: lease.attempt,
      jobId: lease.jobId,
      leaseToken: lease.leaseToken,
      stage: "reconstructing-geometry",
      workerId: "c8-abstention-worker",
    });
    const published = await repository.publishResult({
      attempt: lease.attempt,
      jobId: lease.jobId,
      leaseToken: lease.leaseToken,
      result: abstainedResult({
        jobId: lease.jobId,
        projectId,
        sourceManifestSha256: lease.sourceManifestSha256,
      }),
      workerId: "c8-abstention-worker",
    });
    expect(published).toMatchObject({
      id: created.job.id,
      retryable: false,
      safeCode: "INSUFFICIENT_OVERLAP",
      state: "abstained",
    });
    const storedResult = await repository.findResult(alphaTenantId, projectId, created.job.id);
    expect(storedResult).toMatchObject({
      safeCode: "INSUFFICIENT_OVERLAP",
      status: "abstained",
    });
    expect(storedResult && "geometry" in storedResult).toBe(false);
    await expect(
      sql`
        DELETE FROM reconstruction_results
        WHERE tenant_id = ${alphaTenantId}::uuid AND project_id = ${projectId}::uuid
          AND job_id = ${created.job.id}::uuid
      `,
    ).rejects.toThrow(/append-only/u);
  });

  it("creates a new fenced retry attempt and fails closed when rights are withdrawn", async () => {
    clock.advance(10_000);
    const created = await createJob(`c8-retry-create-${randomUUID()}`);
    const cancelled = await repository.cancelJob({
      actor: owner(),
      correlation: correlation("cancel-created", "3"),
      expectedVersion: created.job.version,
      idempotencyKey: `c8-cancel-created-${randomUUID()}`,
      projectId,
      reconstructionJobId: created.job.id,
    });
    expect(cancelled.job).toMatchObject({ retryable: true, state: "cancelled" });
    const retried = await repository.retryJob({
      actor: owner(),
      correlation: correlation("retry-created", "4"),
      expectedVersion: cancelled.job.version,
      idempotencyKey: `c8-retry-action-${randomUUID()}`,
      projectId,
      reconstructionJobId: created.job.id,
    });
    expect(retried.job).toMatchObject({ attempt: 2, state: "created" });
    clock.advance(10_000);
    expect(
      await repository.withdrawSource({
        assetId,
        projectId,
        reasonCode: "RIGHTS_WITHDRAWN",
        tenantId: alphaTenantId,
      }),
    ).toBe(1);
    expect(await repository.findJob(alphaTenantId, projectId, created.job.id)).toMatchObject({
      retryable: false,
      safeCode: "RECONSTRUCTION_SOURCE_RIGHTS_WITHDRAWN",
      state: "failed",
    });
    await expect(
      repository.retryJob({
        actor: owner(),
        correlation: correlation("retry-withdrawn", "5"),
        expectedVersion: retried.job.version + 1,
        idempotencyKey: `c8-retry-withdrawn-${randomUUID()}`,
        projectId,
        reconstructionJobId: created.job.id,
      }),
    ).rejects.toMatchObject({ code: "RECONSTRUCTION_JOB_NOT_RETRYABLE" });
  });
});
