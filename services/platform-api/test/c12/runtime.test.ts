import { createOptionJobRequestSchema } from "@interior-design/contracts";
import { validateAndCanonicalizeSnapshot } from "@interior-design/model-operations";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { safeDesignOptionLogFields } from "../../src/modules/design-options/telemetry.js";
import { InMemoryDesignOptionSourceVerifier } from "../../src/modules/design-options/sources.js";
import type { DesignConstraintDerivationPort } from "../../src/modules/design-options/types.js";
import { DesignOptionWorkerRuntime } from "../../src/modules/design-options/worker.js";
import {
  actor,
  assetManifestSha256,
  brief,
  constraint,
  correlation,
  createJob,
  MutableClock,
  projectId,
  publication,
  request,
  sourceRecord,
  tenantId,
  testRuntime,
  verifiedInputs,
} from "./support.js";

async function runningPublication() {
  const runtime = await createJob();
  const worker = new DesignOptionWorkerRuntime(runtime.repository);
  const lease = await worker.claimNext({ leaseSeconds: 60, workerId: "c12-test-worker" });
  if (lease === undefined) throw new Error("Expected a C12 fixture lease.");
  const generating = await worker.advance({
    attempt: lease.attempt,
    expectedJobVersion: lease.job.version,
    jobId: lease.job.id,
    leaseToken: lease.leaseToken,
    projectId,
    stage: "generating",
    tenantId,
    workerId: "c12-test-worker",
  });
  const validating = await worker.advance({
    attempt: lease.attempt,
    expectedJobVersion: generating.version,
    jobId: lease.job.id,
    leaseToken: lease.leaseToken,
    projectId,
    stage: "validating",
    tenantId,
    workerId: "c12-test-worker",
  });
  const publishing = await worker.advance({
    attempt: lease.attempt,
    expectedJobVersion: validating.version,
    jobId: lease.job.id,
    leaseToken: lease.leaseToken,
    projectId,
    stage: "publishing",
    tenantId,
    workerId: "c12-test-worker",
  });
  const proposal = publication(publishing, lease.workingSnapshot);
  const succeeded = await worker.publish({
    attempt: lease.attempt,
    expectedJobVersion: publishing.version,
    jobId: lease.job.id,
    leaseToken: lease.leaseToken,
    optionSet: proposal.optionSet,
    options: proposal.options,
    projectId,
    tenantId,
    workerId: "c12-test-worker",
  });
  return { ...runtime, lease, proposal, succeeded, worker };
}

function confirmationRequest(
  runtime: Awaited<ReturnType<typeof runningPublication>>,
  idempotencyKey = randomUUID(),
) {
  return {
    expectedBriefContentSha256: runtime.succeeded.baseBrief.contentSha256,
    expectedBriefRevision: runtime.succeeded.baseBrief.revision,
    expectedJobVersion: runtime.succeeded.version,
    expectedOptionSetSha256: runtime.proposal.optionSet.setSha256,
    expectedOptionStatus: "pending" as const,
    expectedSourceSnapshotSha256: runtime.succeeded.sourceModel.snapshotSha256,
    idempotencyKey,
  };
}

describe("C12 durable in-memory runtime", () => {
  it("creates proposal-only jobs with exact same-key replay and changed-body conflict", async () => {
    const runtime = testRuntime();
    const idempotencyKey = randomUUID();
    const first = await runtime.service.createJob({
      actor,
      correlation,
      idempotencyKey,
      projectId,
      request,
    });
    const replay = await runtime.service.createJob({
      actor,
      correlation,
      idempotencyKey,
      projectId,
      request,
    });
    expect(replay).toEqual({ job: first.job, replayed: true });
    expect(runtime.repository.branches).toHaveLength(0);
    expect(runtime.repository.confirmations).toHaveLength(0);

    const changed = createOptionJobRequestSchema.parse({
      ...request,
      requestedDirections: ["circulation-first", "conversation-first", "storage-first"],
      requestedOptionCount: 3,
    });
    runtime.sources.records.set(
      InMemoryDesignOptionSourceVerifier.key(tenantId, projectId, changed),
      { ...verifiedInputs(), briefReference: changed.baseBrief },
    );
    await expect(
      runtime.service.createJob({
        actor,
        correlation,
        idempotencyKey,
        projectId,
        request: changed,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("binds normalized request inputs and exact working-model pins into constraint derivation", async () => {
    let observed: Parameters<DesignConstraintDerivationPort["derive"]>[0] | undefined;
    const reversed = createOptionJobRequestSchema.parse({
      ...request,
      requestedDirections: ["conversation-first", "circulation-first"],
    });
    const runtime = testRuntime(new MutableClock(), undefined, {
      derive: (input) => {
        observed = input;
        return Promise.resolve({ assetManifestSha256, constraints: [constraint] });
      },
    });
    const created = await runtime.service.createJob({
      actor,
      correlation,
      idempotencyKey: randomUUID(),
      projectId,
      request: reversed,
    });
    if (observed === undefined) throw new Error("Expected the C12 derivation port input.");

    expect(observed.request.requestedDirections).toEqual([
      "circulation-first",
      "conversation-first",
    ]);
    expect(observed.request.requestedOptionCount).toBe(2);
    expect(observed.request.baseBrief).toEqual(request.baseBrief);
    expect(observed.request.sourceModel).toEqual(request.sourceModel);
    expect(observed.source).toEqual(verifiedInputs().source);
    expect(observed.workingModel).toEqual(created.job.workingModel);
    expect(observed.workingSnapshot).toMatchObject({
      derivedFromSnapshotSha256: request.sourceModel.snapshotSha256,
      modelId: request.sourceModel.modelId,
      profile: "proposed",
      projectId,
    });
    expect(validateAndCanonicalizeSnapshot(observed.workingSnapshot).snapshotSha256).toBe(
      observed.workingModel.snapshotSha256,
    );
  });

  it("fences heartbeat and publication after lease loss, then reclaims deterministically", async () => {
    const runtime = await createJob();
    const worker = new DesignOptionWorkerRuntime(runtime.repository);
    const first = await worker.claimNext({ leaseSeconds: 60, workerId: "worker-a" });
    if (first === undefined) throw new Error("Expected first C12 lease.");
    expect(first.acceptedBrief).toEqual(brief);
    expect(first.sourceSnapshot).toEqual(sourceRecord);
    expect(first.workingSnapshot).toMatchObject({
      modelId: first.job.workingModel.modelId,
      profile: "proposed",
      projectId,
    });
    runtime.clock.advance(60_001);
    const reclaimed = await worker.claimNext({ leaseSeconds: 60, workerId: "worker-b" });
    if (reclaimed === undefined) throw new Error("Expected reclaimed C12 lease.");
    expect(reclaimed.attempt).toBe(first.attempt);
    expect(reclaimed.leaseToken).not.toBe(first.leaseToken);
    await expect(
      worker.heartbeat({
        attempt: first.attempt,
        expectedJobVersion: first.job.version,
        jobId: first.job.id,
        leaseToken: first.leaseToken,
        projectId,
        tenantId,
        workerId: "worker-a",
      }),
    ).rejects.toMatchObject({ code: "LEASE_LOST" });
  });

  it("refuses stale or foreign worker inputs before lease and after the publication fence", async () => {
    const staleBrief = await createJob();
    const staleStored = [...staleBrief.repository.jobs.values()][0];
    if (staleStored === undefined) throw new Error("Expected a retained C12 job.");
    Object.assign(staleStored, { acceptedBrief: { ...brief, status: "draft" } });
    expect(
      await new DesignOptionWorkerRuntime(staleBrief.repository).claimNext({
        workerId: "worker-a",
      }),
    ).toBeUndefined();
    expect((await staleBrief.service.getJob(tenantId, projectId, staleBrief.job.id)).state).toBe(
      "failed",
    );

    const foreignSource = await createJob();
    const foreignStored = [...foreignSource.repository.jobs.values()][0];
    if (foreignStored === undefined) throw new Error("Expected a retained C12 source.");
    Object.assign(foreignStored, {
      sourceSnapshot: { ...sourceRecord, projectId: randomUUID() },
    });
    expect(
      await new DesignOptionWorkerRuntime(foreignSource.repository).claimNext({
        workerId: "worker-a",
      }),
    ).toBeUndefined();

    const lateMismatch = await createJob();
    const worker = new DesignOptionWorkerRuntime(lateMismatch.repository);
    const lease = await worker.claimNext({ workerId: "worker-a" });
    if (lease === undefined) throw new Error("Expected a valid C12 lease.");
    let job = lease.job;
    for (const stage of ["generating", "validating", "publishing"] as const) {
      job = await worker.advance({
        attempt: lease.attempt,
        expectedJobVersion: job.version,
        jobId: job.id,
        leaseToken: lease.leaseToken,
        projectId,
        stage,
        tenantId,
        workerId: "worker-a",
      });
    }
    const lateStored = [...lateMismatch.repository.jobs.values()][0];
    if (lateStored === undefined) throw new Error("Expected late C12 worker inputs.");
    Object.assign(lateStored, {
      sourceSnapshot: { ...sourceRecord, snapshotSha256: "0".repeat(64) },
    });
    const proposal = publication(job, lease.workingSnapshot);
    await expect(
      worker.publish({
        attempt: lease.attempt,
        expectedJobVersion: job.version,
        jobId: job.id,
        leaseToken: lease.leaseToken,
        optionSet: proposal.optionSet,
        options: proposal.options,
        projectId,
        tenantId,
        workerId: "worker-a",
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    expect(lateMismatch.repository.publications).toHaveLength(0);
  });

  it("publishes only a complete replayable diverse set and rejects forged or failed bundles atomically", async () => {
    const runtime = await createJob();
    const worker = new DesignOptionWorkerRuntime(runtime.repository);
    const lease = await worker.claimNext({ workerId: "worker-a" });
    if (lease === undefined) throw new Error("Expected C12 lease.");
    let job = lease.job;
    for (const stage of ["generating", "validating", "publishing"] as const) {
      job = await worker.advance({
        attempt: lease.attempt,
        expectedJobVersion: job.version,
        jobId: job.id,
        leaseToken: lease.leaseToken,
        projectId,
        stage,
        tenantId,
        workerId: "worker-a",
      });
    }
    const proposal = publication(job, lease.workingSnapshot);
    const first = proposal.options[0];
    if (first === undefined) throw new Error("Expected first C12 option.");
    await expect(
      worker.publish({
        attempt: lease.attempt,
        expectedJobVersion: job.version,
        jobId: job.id,
        leaseToken: lease.leaseToken,
        optionSet: proposal.optionSet,
        options: [
          {
            ...first,
            operationBundle: {
              ...first.operationBundle,
              bundleSha256: "f".repeat(64),
            },
          },
          proposal.options[1],
        ].filter((option) => option !== undefined),
        projectId,
        tenantId,
        workerId: "worker-a",
      }),
    ).rejects.toMatchObject({ code: "PUBLICATION_INVALID" });
    await expect(
      worker.publish({
        attempt: lease.attempt,
        expectedJobVersion: job.version,
        jobId: job.id,
        leaseToken: lease.leaseToken,
        optionSet: proposal.optionSet,
        options: [
          {
            ...first,
            operationBundle: {
              ...first.operationBundle,
              constraintResults: first.operationBundle.constraintResults.map((result) => ({
                ...result,
                passed: false,
              })),
            },
          },
          ...proposal.options.slice(1),
        ],
        projectId,
        tenantId,
        workerId: "worker-a",
      }),
    ).rejects.toBeDefined();
    expect(runtime.repository.publications).toHaveLength(0);
    expect(runtime.repository.branches).toHaveLength(0);
  });

  it("rejects an unavailable exact asset before durable publication", async () => {
    const runtime = await createJob(
      testRuntime(new MutableClock(), { verifyExact: () => Promise.resolve(false) }),
    );
    const worker = new DesignOptionWorkerRuntime(runtime.repository);
    const lease = await worker.claimNext({ workerId: "worker-a" });
    if (lease === undefined) throw new Error("Expected C12 lease.");
    let job = lease.job;
    for (const stage of ["generating", "validating", "publishing"] as const) {
      job = await worker.advance({
        attempt: lease.attempt,
        expectedJobVersion: job.version,
        jobId: job.id,
        leaseToken: lease.leaseToken,
        projectId,
        stage,
        tenantId,
        workerId: "worker-a",
      });
    }
    const proposal = publication(job, lease.workingSnapshot);
    await expect(
      worker.publish({
        attempt: lease.attempt,
        expectedJobVersion: job.version,
        jobId: job.id,
        leaseToken: lease.leaseToken,
        optionSet: proposal.optionSet,
        options: proposal.options,
        projectId,
        tenantId,
        workerId: "worker-a",
      }),
    ).rejects.toMatchObject({ code: "ASSET_BINDING_CHANGED" });
    expect(runtime.repository.publications).toHaveLength(0);
  });

  it("cancels running work through a fenced acknowledgement and retries with a new attempt", async () => {
    const runtime = await createJob();
    const worker = new DesignOptionWorkerRuntime(runtime.repository);
    const lease = await worker.claimNext({ workerId: "worker-a" });
    if (lease === undefined) throw new Error("Expected C12 lease.");
    runtime.clock.advance(1);
    const requested = await runtime.service.cancelJob({
      actor,
      correlation,
      expectedVersion: lease.job.version,
      idempotencyKey: randomUUID(),
      jobId: lease.job.id,
      projectId,
    });
    expect(requested.job.state).toBe("cancel-requested");
    runtime.clock.advance(1);
    const cancelled = await worker.acknowledgeCancellation({
      attempt: lease.attempt,
      expectedJobVersion: lease.job.version,
      jobId: lease.job.id,
      leaseToken: lease.leaseToken,
      projectId,
      tenantId,
      workerId: "worker-a",
    });
    expect(cancelled.state).toBe("cancelled");
    runtime.clock.advance(1);
    const retried = await runtime.service.retryJob({
      actor,
      correlation,
      expectedVersion: cancelled.version,
      idempotencyKey: randomUUID(),
      jobId: cancelled.id,
      projectId,
    });
    expect(retried.job).toMatchObject({ attempt: 2, state: "queued" });
  });

  it("supports typed abstention and retry without publishing a partial option set", async () => {
    const runtime = await createJob();
    const worker = new DesignOptionWorkerRuntime(runtime.repository);
    const lease = await worker.claimNext({ workerId: "worker-a" });
    if (lease === undefined) throw new Error("Expected C12 lease.");
    runtime.clock.advance(1);
    const abstained = await worker.abstain({
      attempt: lease.attempt,
      expectedJobVersion: lease.job.version,
      jobId: lease.job.id,
      leaseToken: lease.leaseToken,
      projectId,
      safeCode: "NO_FEASIBLE_DIVERSE_SET",
      tenantId,
      workerId: "worker-a",
    });
    expect(abstained).toMatchObject({ optionCount: 0, retryable: true, state: "abstained" });
    expect((await runtime.service.listOptions(tenantId, projectId, abstained.id)).options).toEqual(
      [],
    );
  });

  it("confirms exact options atomically, replays the same key, and keeps siblings independent", async () => {
    const runtime = await runningPublication();
    expect(runtime.repository.branches).toHaveLength(0);
    const firstOption = runtime.proposal.options[0];
    const secondOption = runtime.proposal.options[1];
    if (firstOption === undefined || secondOption === undefined)
      throw new Error("Expected two C12 options.");
    runtime.clock.advance(1);
    const requestBody = confirmationRequest(runtime);
    const first = await runtime.service.confirmOption({
      actor,
      correlation,
      jobId: runtime.succeeded.id,
      optionId: firstOption.id,
      projectId,
      request: requestBody,
    });
    const replay = await runtime.service.confirmOption({
      actor,
      correlation,
      jobId: runtime.succeeded.id,
      optionId: firstOption.id,
      projectId,
      request: requestBody,
    });
    expect(replay).toEqual({ confirmation: first.confirmation, replayed: true });
    expect(runtime.repository.branches).toHaveLength(1);

    await expect(
      runtime.service.confirmOption({
        actor,
        correlation,
        jobId: runtime.succeeded.id,
        optionId: secondOption.id,
        projectId,
        request: requestBody,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(runtime.repository.branches).toHaveLength(1);

    runtime.clock.advance(1);
    const sibling = await runtime.service.confirmOption({
      actor,
      correlation,
      jobId: runtime.succeeded.id,
      optionId: secondOption.id,
      projectId,
      request: confirmationRequest(runtime),
    });
    expect(sibling.confirmation.branchId).not.toBe(first.confirmation.branchId);
    expect(runtime.repository.branches).toHaveLength(2);
    expect(
      (await runtime.service.getOption(tenantId, projectId, runtime.succeeded.id, firstOption.id))
        .status,
    ).toBe("confirmed");
    expect(
      (await runtime.service.getOption(tenantId, projectId, runtime.succeeded.id, secondOption.id))
        .status,
    ).toBe("confirmed");
  });

  it("rolls back stale, concurrent, and expired confirmations without partial branches", async () => {
    const stale = await runningPublication();
    const option = stale.proposal.options[0];
    if (option === undefined) throw new Error("Expected C12 option.");
    await expect(
      stale.service.confirmOption({
        actor,
        correlation,
        jobId: stale.succeeded.id,
        optionId: option.id,
        projectId,
        request: { ...confirmationRequest(stale), expectedOptionSetSha256: "0".repeat(64) },
      }),
    ).rejects.toMatchObject({ code: "CONFIRMATION_CONFLICT" });
    expect(stale.repository.branches).toHaveLength(0);

    const concurrent = await runningPublication();
    const concurrentOption = concurrent.proposal.options[0];
    if (concurrentOption === undefined) throw new Error("Expected concurrent C12 option.");
    const results = await Promise.allSettled([
      concurrent.service.confirmOption({
        actor,
        correlation,
        jobId: concurrent.succeeded.id,
        optionId: concurrentOption.id,
        projectId,
        request: confirmationRequest(concurrent),
      }),
      concurrent.service.confirmOption({
        actor,
        correlation,
        jobId: concurrent.succeeded.id,
        optionId: concurrentOption.id,
        projectId,
        request: confirmationRequest(concurrent),
      }),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(concurrent.repository.branches).toHaveLength(1);

    const expired = await runningPublication();
    const expiredOption = expired.proposal.options[0];
    if (expiredOption === undefined) throw new Error("Expected expiring C12 option.");
    expired.clock.advance(3_600_101);
    await expect(
      expired.service.confirmOption({
        actor,
        correlation,
        jobId: expired.succeeded.id,
        optionId: expiredOption.id,
        projectId,
        request: confirmationRequest(expired),
      }),
    ).rejects.toMatchObject({ code: "OPTION_EXPIRED" });
    expect(expired.repository.branches).toHaveLength(0);
  });

  it("drops private brief, household, operation, asset, token, and lease fields from logs", () => {
    const fields = safeDesignOptionLogFields({
      accessibility: "private accessibility marker",
      asset: "private asset payload",
      assets: "private assets payload",
      brief: "private brief marker",
      household: "private household marker",
      jobVersion: 4,
      leaseToken: "private lease marker",
      operation: "private operation payload",
      operations: "private operations payload",
      payload: "private generic payload",
      prompt: "private prompt",
      stage: "publishing",
      token: "private bearer marker",
    });
    expect(fields).toEqual({ jobVersion: 4, stage: "publishing" });
    expect(JSON.stringify(fields)).not.toMatch(/private|accessibility|household|lease/iu);
  });
});
