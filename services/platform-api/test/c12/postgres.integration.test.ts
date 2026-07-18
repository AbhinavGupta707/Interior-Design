import { createOptionJobRequestSchema } from "@interior-design/contracts";
import { DeterministicDesignBriefKernel } from "@interior-design/design-brief";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyC1Migration, bootstrapC1Fixtures, createC1Sql } from "../../src/c1.js";
import { applyC10Migration } from "../../src/c10.js";
import { applyC11Migration } from "../../src/c11.js";
import { applyC2Migration } from "../../src/c2.js";
import { applyC3Migration } from "../../src/c3.js";
import { applyC4Migration } from "../../src/c4.js";
import { applyC5Migration } from "../../src/c5.js";
import { applyC6Migration } from "../../src/c6.js";
import { applyC7Migration } from "../../src/c7.js";
import { applyC8Migration } from "../../src/c8.js";
import { applyC9Migration } from "../../src/c9.js";
import { PostgresBriefRepository } from "../../src/modules/briefs/postgres.js";
import { BriefService } from "../../src/modules/briefs/service.js";
import { PostgresBriefSourceVerifier } from "../../src/modules/briefs/sources.js";
import { PostgresDesignOptionRepository } from "../../src/modules/design-options/postgres.js";
import { DesignOptionService } from "../../src/modules/design-options/service.js";
import { PostgresDesignOptionSourceVerifier } from "../../src/modules/design-options/sources.js";
import { DesignOptionWorkerRuntime } from "../../src/modules/design-options/worker.js";
import { ModelOperationService } from "../../src/modules/models/operations/service.js";
import { PostgresModelOperationRepository } from "../../src/modules/models/operations/postgres.js";
import { PostgresProjectRepository } from "../../src/modules/projects/repository.js";
import { householdEntry } from "../c11/briefs/support.js";
import { canonicalSnapshotFixture } from "../c4/fixtures.js";
import {
  actor,
  assetManifestSha256,
  constraint,
  correlation,
  MutableClock,
  publication,
} from "./support.js";

const databaseUrl = process.env.C12_TEST_DATABASE_URL ?? "";
const describeWithPostgres = databaseUrl.length === 0 ? describe.skip : describe;

async function applyC12Migration(sql: Sql): Promise<void> {
  const file = path.resolve(process.cwd(), "migrations/0012_design_options.sql");
  await sql.begin(async (transaction) => transaction.file(file));
}

describeWithPostgres("C12 live PostgreSQL lifecycle", () => {
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
    await applyC10Migration(sql);
    await applyC11Migration(sql);
    await applyC12Migration(sql);
  });

  afterAll(async () => sql.end({ timeout: 5 }));

  it("publishes proposals without mutation and atomically confirms exact sibling options", async () => {
    const project = await new PostgresProjectRepository(sql).create({
      actor,
      correlation,
      idempotencyKey: randomUUID(),
      request: { name: `Synthetic C12 PostgreSQL ${randomUUID()}` },
    });
    const modelId = randomUUID();
    const modelClock = new MutableClock();
    modelClock.value = new Date("2026-07-18T10:00:00.000Z");
    const modelService = new ModelOperationService(
      new PostgresModelOperationRepository(sql, { clock: () => modelClock.now() }),
    );
    const source = await modelService.initialize({
      actor,
      correlation,
      expectedCurrentSnapshotSha256: null,
      idempotencyKey: randomUUID(),
      profile: "existing",
      projectId: project.id,
      snapshot: canonicalSnapshotFixture({ modelId, projectId: project.id }),
    });

    const briefClock = new MutableClock();
    briefClock.value = new Date("2026-07-18T11:00:00.000Z");
    const briefRepository = new PostgresBriefRepository(sql, new DeterministicDesignBriefKernel(), {
      clock: briefClock,
    });
    const briefService = new BriefService({
      repository: briefRepository,
      sources: new PostgresBriefSourceVerifier(sql),
    });
    const draft = await briefService.update({
      actor,
      correlation,
      projectId: project.id,
      request: {
        expectedRevision: 0,
        idempotencyKey: randomUUID(),
        operations: [{ entry: householdEntry(randomUUID()), kind: "entry.add" }],
      },
    });
    briefClock.advance(1);
    const accepted = await briefService.accept({
      actor,
      correlation,
      projectId: project.id,
      request: { expectedRevision: draft.record.brief.revision, idempotencyKey: randomUUID() },
    });

    const request = createOptionJobRequestSchema.parse({
      baseBrief: {
        briefId: accepted.record.brief.id,
        contentSha256: accepted.record.contentSha256,
        revision: accepted.record.brief.revision,
      },
      requestedDirections: ["circulation-first", "conversation-first"],
      requestedOptionCount: 2,
      sourceModel: {
        modelId,
        profile: "existing",
        snapshotId: source.record.id,
        snapshotSha256: source.record.snapshotSha256,
        snapshotVersion: source.record.version,
      },
    });
    const optionClock = new MutableClock();
    const repository = new PostgresDesignOptionRepository(sql, {
      assetVerifier: {
        verifyExact: (asset) =>
          Promise.resolve(
            ["3".repeat(64), "4".repeat(64)].includes(asset.rights.rightsRecordSha256),
          ),
      },
      clock: optionClock,
    });
    const service = new DesignOptionService({
      constraintDeriver: {
        derive: () => Promise.resolve({ assetManifestSha256, constraints: [constraint] }),
      },
      repository,
      sourceVerifier: new PostgresDesignOptionSourceVerifier(sql),
    });
    const createKey = randomUUID();
    const createCommand = {
      actor,
      correlation,
      idempotencyKey: createKey,
      projectId: project.id,
      request,
    };
    const created = await service.createJob(createCommand);
    expect(await service.createJob(createCommand)).toEqual({ job: created.job, replayed: true });
    await expect(
      service.createJob({
        ...createCommand,
        request: createOptionJobRequestSchema.parse({
          ...request,
          requestedDirections: ["circulation-first", "conversation-first", "storage-first"],
          requestedOptionCount: 3,
        }),
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    optionClock.advance(1);
    const cancelKey = randomUUID();
    const cancelCommand = {
      actor,
      correlation,
      expectedVersion: created.job.version,
      idempotencyKey: cancelKey,
      jobId: created.job.id,
      projectId: project.id,
    };
    const cancelled = await service.cancelJob(cancelCommand);
    expect(cancelled.job).toMatchObject({ retryable: true, state: "cancelled" });
    expect(await service.cancelJob(cancelCommand)).toEqual({
      job: cancelled.job,
      replayed: true,
    });
    optionClock.advance(1);
    const firstRetry = await service.retryJob({
      actor,
      correlation,
      expectedVersion: cancelled.job.version,
      idempotencyKey: randomUUID(),
      jobId: created.job.id,
      projectId: project.id,
    });
    expect(firstRetry.job).toMatchObject({ attempt: 2, state: "queued" });

    const worker = new DesignOptionWorkerRuntime(repository);
    optionClock.advance(1);
    const firstLease = await worker.claimNext({ leaseSeconds: 60, workerId: "c12-worker-a" });
    if (firstLease === undefined || firstLease.job.id !== created.job.id) {
      throw new Error("Expected the retry attempt PostgreSQL lease.");
    }
    expect(firstLease.acceptedBrief).toEqual(accepted.record.brief);
    expect(firstLease.sourceSnapshot).toEqual(source.record);
    expect(firstLease.workingSnapshot).toMatchObject({
      modelId: firstLease.job.workingModel.modelId,
      profile: "proposed",
      projectId: project.id,
    });
    await sql`
      UPDATE design_option_attempts
      SET lease_expires_at = clock_timestamp() - interval '1 second',
          updated_at = updated_at + interval '1 millisecond'
      WHERE tenant_id = ${actor.tenantId}::uuid AND project_id = ${project.id}::uuid
        AND job_id = ${created.job.id}::uuid AND attempt = ${firstLease.attempt}
    `;
    optionClock.advance(2);
    const reclaimed = await worker.claimNext({ leaseSeconds: 60, workerId: "c12-worker-b" });
    if (reclaimed === undefined || reclaimed.job.id !== created.job.id) {
      throw new Error("Expected the expired PostgreSQL lease to be reclaimed.");
    }
    expect(reclaimed.leaseToken).not.toBe(firstLease.leaseToken);
    await expect(
      worker.heartbeat({
        attempt: firstLease.attempt,
        expectedJobVersion: firstLease.job.version,
        jobId: firstLease.job.id,
        leaseToken: firstLease.leaseToken,
        projectId: project.id,
        tenantId: actor.tenantId,
        workerId: "c12-worker-a",
      }),
    ).rejects.toMatchObject({ code: "LEASE_LOST" });
    optionClock.advance(1);
    const abstained = await worker.abstain({
      attempt: reclaimed.attempt,
      expectedJobVersion: reclaimed.job.version,
      jobId: reclaimed.job.id,
      leaseToken: reclaimed.leaseToken,
      projectId: project.id,
      safeCode: "NO_FEASIBLE_DIVERSE_SET",
      tenantId: actor.tenantId,
      workerId: "c12-worker-b",
    });
    expect(abstained).toMatchObject({ optionCount: 0, retryable: true, state: "abstained" });
    optionClock.advance(1);
    const secondRetry = await service.retryJob({
      actor,
      correlation,
      expectedVersion: abstained.version,
      idempotencyKey: randomUUID(),
      jobId: created.job.id,
      projectId: project.id,
    });
    expect(secondRetry.job).toMatchObject({ attempt: 3, state: "queued" });

    const beforePublication = await sql<
      Array<{ readonly branches: number; readonly commits: number; readonly snapshots: number }>
    >`
      SELECT
        (SELECT count(*)::int FROM model_branches
          WHERE project_id = ${project.id}::uuid AND model_id = ${modelId}::uuid
            AND profile = 'proposed') AS branches,
        (SELECT count(*)::int FROM model_operation_commits
          WHERE project_id = ${project.id}::uuid AND model_id = ${modelId}::uuid
            AND profile = 'proposed') AS commits,
        (SELECT count(*)::int FROM canonical_model_snapshots
          WHERE project_id = ${project.id}::uuid AND model_id = ${modelId}::uuid
            AND profile = 'proposed') AS snapshots
    `;
    expect(beforePublication[0]).toEqual({ branches: 0, commits: 0, snapshots: 0 });

    optionClock.advance(1);
    const lease = await worker.claimNext({ leaseSeconds: 60, workerId: "c12-worker-c" });
    if (lease === undefined || lease.job.id !== created.job.id) {
      throw new Error("Expected the new C12 PostgreSQL job lease.");
    }
    let job = lease.job;
    for (const stage of ["generating", "validating", "publishing"] as const) {
      optionClock.advance(1);
      job = await worker.advance({
        attempt: lease.attempt,
        expectedJobVersion: job.version,
        jobId: job.id,
        leaseToken: lease.leaseToken,
        projectId: project.id,
        stage,
        tenantId: actor.tenantId,
        workerId: "c12-worker-c",
      });
    }
    const proposed = publication(job, lease.workingSnapshot);
    optionClock.advance(1);
    const succeeded = await worker.publish({
      attempt: lease.attempt,
      expectedJobVersion: job.version,
      jobId: job.id,
      leaseToken: lease.leaseToken,
      optionSet: proposed.optionSet,
      options: proposed.options,
      projectId: project.id,
      tenantId: actor.tenantId,
      workerId: "c12-worker-c",
    });
    const afterPublication = await sql<Array<{ readonly branches: number }>>`
      SELECT count(*)::int AS branches FROM model_branches
      WHERE project_id = ${project.id}::uuid AND model_id = ${modelId}::uuid
        AND profile = 'proposed'
    `;
    expect(afterPublication[0]?.branches).toBe(0);

    const first = proposed.options[0];
    const second = proposed.options[1];
    if (first === undefined || second === undefined) throw new Error("Expected two live options.");
    const confirmationRequest = (idempotencyKey: string) => ({
      expectedBriefContentSha256: succeeded.baseBrief.contentSha256,
      expectedBriefRevision: succeeded.baseBrief.revision,
      expectedJobVersion: succeeded.version,
      expectedOptionSetSha256: proposed.optionSet.setSha256,
      expectedOptionStatus: "pending" as const,
      expectedSourceSnapshotSha256: succeeded.sourceModel.snapshotSha256,
      idempotencyKey,
    });
    optionClock.advance(1);
    await expect(
      service.confirmOption({
        actor,
        correlation,
        jobId: succeeded.id,
        optionId: first.id,
        projectId: project.id,
        request: {
          ...confirmationRequest(randomUUID()),
          expectedOptionSetSha256: "0".repeat(64),
        },
      }),
    ).rejects.toMatchObject({ code: "CONFIRMATION_CONFLICT" });
    const afterRollback = await sql<Array<{ readonly branches: number }>>`
      SELECT count(*)::int AS branches FROM model_branches
      WHERE project_id = ${project.id}::uuid AND model_id = ${modelId}::uuid
        AND profile = 'proposed'
    `;
    expect(afterRollback[0]?.branches).toBe(0);

    optionClock.advance(1);
    const replayKey = randomUUID();
    const confirmed = await service.confirmOption({
      actor,
      correlation,
      jobId: succeeded.id,
      optionId: first.id,
      projectId: project.id,
      request: confirmationRequest(replayKey),
    });
    const replayed = await service.confirmOption({
      actor,
      correlation,
      jobId: succeeded.id,
      optionId: first.id,
      projectId: project.id,
      request: confirmationRequest(replayKey),
    });
    expect(replayed).toEqual({ confirmation: confirmed.confirmation, replayed: true });

    optionClock.advance(1);
    const concurrent = await Promise.allSettled([
      service.confirmOption({
        actor,
        correlation,
        jobId: succeeded.id,
        optionId: second.id,
        projectId: project.id,
        request: confirmationRequest(randomUUID()),
      }),
      service.confirmOption({
        actor,
        correlation,
        jobId: succeeded.id,
        optionId: second.id,
        projectId: project.id,
        request: confirmationRequest(randomUUID()),
      }),
    ]);
    expect(concurrent.filter(({ status }) => status === "fulfilled")).toHaveLength(1);

    const linked = await sql<
      Array<{
        readonly branches: number;
        readonly confirmations: number;
        readonly envelopes: number;
        readonly result_mismatches: number;
      }>
    >`
      SELECT
        (SELECT count(*)::int FROM model_branches
          WHERE project_id = ${project.id}::uuid AND model_id = ${modelId}::uuid
            AND profile = 'proposed') AS branches,
        (SELECT count(*)::int FROM design_option_confirmations
          WHERE project_id = ${project.id}::uuid AND job_id = ${succeeded.id}::uuid) AS confirmations,
        (SELECT count(*)::int FROM model_operation_envelopes
          WHERE project_id = ${project.id}::uuid AND model_id = ${modelId}::uuid
            AND profile = 'proposed') AS envelopes,
        (SELECT count(*)::int FROM design_option_confirmations c
          JOIN canonical_model_snapshots s
            ON s.tenant_id = c.tenant_id AND s.project_id = c.project_id
            AND s.profile = c.profile AND s.id = c.result_snapshot_id
          WHERE c.project_id = ${project.id}::uuid
            AND c.result_snapshot_sha256 <> s.snapshot_sha256) AS result_mismatches
    `;
    expect(linked[0]).toEqual({
      branches: 2,
      confirmations: 2,
      envelopes: 2,
      result_mismatches: 0,
    });

    const proposedHead = await sql<
      Array<{
        readonly current_snapshot_id: string;
        readonly current_snapshot_sha256: string;
        readonly current_snapshot_version: number;
      }>
    >`
      SELECT current_snapshot_id, current_snapshot_sha256, current_snapshot_version
      FROM canonical_model_profiles
      WHERE tenant_id = ${actor.tenantId}::uuid AND project_id = ${project.id}::uuid
        AND model_id = ${modelId}::uuid AND profile = 'proposed'
    `;
    const proposedSource = proposedHead[0];
    if (proposedSource === undefined) throw new Error("Expected the proposed C12 profile head.");
    const staleRequest = createOptionJobRequestSchema.parse({
      ...request,
      sourceModel: {
        modelId,
        profile: "proposed",
        snapshotId: proposedSource.current_snapshot_id,
        snapshotSha256: proposedSource.current_snapshot_sha256,
        snapshotVersion: proposedSource.current_snapshot_version,
      },
    });
    optionClock.advance(1);
    const staleJob = await service.createJob({
      actor,
      correlation,
      idempotencyKey: randomUUID(),
      projectId: project.id,
      request: staleRequest,
    });
    briefClock.advance(1);
    await briefService.update({
      actor,
      correlation,
      projectId: project.id,
      request: {
        expectedRevision: accepted.record.brief.revision,
        idempotencyKey: randomUUID(),
        operations: [{ entry: householdEntry(randomUUID()), kind: "entry.add" }],
      },
    });
    optionClock.advance(1);
    expect(await worker.claimNext({ workerId: "c12-stale-input-worker" })).toBeUndefined();
    expect(await service.getJob(actor.tenantId, project.id, staleJob.job.id)).toMatchObject({
      retryable: true,
      safeCode: "SOURCE_CHANGED",
      state: "failed",
    });
    const staleEffects = await sql<Array<{ readonly branches: number; readonly sets: number }>>`
      SELECT
        (SELECT count(*)::int FROM model_branches
          WHERE project_id = ${project.id}::uuid AND name LIKE ${`Design option %`}) AS branches,
        (SELECT count(*)::int FROM design_option_sets
          WHERE project_id = ${project.id}::uuid AND job_id = ${staleJob.job.id}::uuid) AS sets
    `;
    expect(staleEffects[0]).toEqual({ branches: 2, sets: 0 });
  });

  it("enables tenant RLS and rejects immutable publication rewrites", async () => {
    const rls = await sql<Array<{ readonly relrowsecurity: boolean; readonly policies: number }>>`
      SELECT c.relrowsecurity,
        (SELECT count(*)::int FROM pg_policies p WHERE p.tablename = c.relname) AS policies
      FROM pg_class c WHERE c.relname = 'design_option_jobs'
    `;
    expect(rls[0]).toEqual({ policies: 1, relrowsecurity: true });
    await expect(sql`UPDATE design_option_sets SET option_count = option_count`).rejects.toThrow(
      /append-only/u,
    );
  });
});
