import { fusionProposalSchema, type FusionProposal } from "@interior-design/contracts";
import { createHash } from "node:crypto";

import type { SafeLogger } from "../logger.js";
import { canonicalSnapshotSha256 } from "./canonical.js";
import type { BoundedFusionProducerProtocol } from "./protocol.js";
import {
  FusionWorkerError,
  type FusionLeaseCommand,
  type FusionProcessingQueue,
  type FusionSourceAcquisitionPort,
  type LeasedFusionAttempt,
} from "./types.js";

export interface FusionProcessingRunnerOptions {
  readonly clock?: { now(): Date };
  readonly heartbeatMilliseconds?: number;
  readonly leaseSeconds?: number;
  readonly logger: SafeLogger;
  readonly pollMilliseconds: number;
  readonly producers: BoundedFusionProducerProtocol;
  readonly queue: FusionProcessingQueue;
  readonly sources: FusionSourceAcquisitionPort;
  readonly workerId: string;
}

function deterministicUuid(value: string): string {
  const bytes = Buffer.from(createHash("sha256").update(value).digest().subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, milliseconds);
    timer.unref();
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw new FusionWorkerError("FUSION_CANCELLED");
}

function leaseCommand(lease: LeasedFusionAttempt, workerId: string): FusionLeaseCommand {
  return {
    attempt: lease.attempt,
    jobId: lease.jobId,
    leaseToken: lease.leaseToken,
    projectId: lease.projectId,
    tenantId: lease.tenantId,
    workerId,
  };
}

function safeFailure(error: unknown): { readonly retryable: boolean; readonly safeCode: string } {
  if (error instanceof FusionWorkerError) {
    return { retryable: error.retryable, safeCode: error.safeCode };
  }
  return { retryable: false, safeCode: "FUSION_WORKER_FAILED" };
}

export class FusionProcessingRunner {
  readonly #clock: { now(): Date };
  readonly #options: FusionProcessingRunnerOptions;

  constructor(options: FusionProcessingRunnerOptions) {
    if (!/^[A-Za-z0-9_.:-]{3,100}$/u.test(options.workerId)) {
      throw new Error("The C9 worker identifier is invalid.");
    }
    this.#options = options;
    this.#clock = options.clock ?? { now: () => new Date() };
  }

  async processNext(signal?: AbortSignal): Promise<"idle" | "processed"> {
    const lease = await this.#options.queue.claim({
      leaseSeconds: this.#options.leaseSeconds ?? 300,
      workerId: this.#options.workerId,
    });
    if (lease === undefined) return "idle";
    await this.#process(lease, signal);
    return "processed";
  }

  async #process(lease: LeasedFusionAttempt, outerSignal?: AbortSignal): Promise<void> {
    const cancellation = new AbortController();
    const workSignal =
      outerSignal === undefined
        ? cancellation.signal
        : AbortSignal.any([outerSignal, cancellation.signal]);
    const monitor = this.#monitorLease(lease, cancellation, workSignal);
    try {
      throwIfAborted(workSignal);
      const acquired = await this.#options.sources.acquire(lease, workSignal);
      throwIfAborted(workSignal);
      const registrations = await this.#options.producers.register(
        acquired.sources,
        lease.request.anchorGroups,
        workSignal,
      );
      throwIfAborted(workSignal);
      await this.#options.queue.advance({
        ...leaseCommand(lease, this.#options.workerId),
        stage: "fitting",
      });
      const semantic = await this.#options.producers.fit(
        {
          baseSnapshot: acquired.baseSnapshot,
          baseSnapshotReference: lease.request.baseSnapshot,
          inferencePolicy: lease.request.inferencePolicy,
          jobId: lease.jobId,
          projectId: lease.projectId,
          registrations,
          sources: acquired.sources,
        },
        workSignal,
      );
      throwIfAborted(workSignal);
      if (semantic.status !== "abstained") {
        if (
          canonicalSnapshotSha256(semantic.candidateSnapshot) !== semantic.candidateSnapshotSha256
        ) {
          throw new FusionWorkerError("FUSION_CANDIDATE_HASH_MISMATCH");
        }
        await this.#options.queue.advance({
          ...leaseCommand(lease, this.#options.workerId),
          stage: "comparing",
        });
      }
      throwIfAborted(workSignal);
      const proposalId = deterministicUuid(
        `c9:proposal:${lease.jobId}:${String(lease.attempt)}:${lease.sourceManifestSha256}`,
      );
      const proposal: FusionProposal = fusionProposalSchema.parse({
        authority: "proposal-only",
        baseSnapshot: lease.request.baseSnapshot,
        coverage: semantic.coverage,
        createdAt: this.#clock.now().toISOString(),
        discrepancies: semantic.discrepancies,
        id: proposalId,
        projectId: lease.projectId,
        registrations,
        schemaVersion: "c9-full-house-proposal-v1",
        sourceManifestSha256: lease.sourceManifestSha256,
        status: semantic.status,
        version: 1,
        ...(semantic.status === "abstained"
          ? { findings: semantic.findings, safeCode: semantic.safeCode }
          : {
              candidateSnapshot: semantic.candidateSnapshot,
              candidateSnapshotSha256: semantic.candidateSnapshotSha256,
            }),
      });
      await this.#options.queue.publish({
        ...leaseCommand(lease, this.#options.workerId),
        proposal,
      });
      this.#options.logger.info("fusion.processed", {
        attempt: lease.attempt,
        discrepancyCount: proposal.discrepancies.length,
        jobId: lease.jobId,
        status: proposal.status,
      });
    } catch (error) {
      const failure = safeFailure(error);
      try {
        await this.#options.queue.fail({
          ...leaseCommand(lease, this.#options.workerId),
          retryable: failure.retryable,
          safeCode: failure.safeCode,
        });
      } catch {
        try {
          await this.#options.queue.acknowledgeCancellation(
            leaseCommand(lease, this.#options.workerId),
          );
        } catch {
          // A cancellation, expiry, reclaim, or newer attempt owns the durable fence.
        }
      }
      this.#options.logger.warn("fusion.processing-failed", {
        attempt: lease.attempt,
        errorName: error instanceof Error ? error.name : "unknown",
        jobId: lease.jobId,
        retryable: failure.retryable,
        safeCode: failure.safeCode,
      });
    } finally {
      cancellation.abort();
      await monitor;
    }
  }

  async #monitorLease(
    lease: LeasedFusionAttempt,
    cancellation: AbortController,
    signal: AbortSignal,
  ): Promise<void> {
    const interval = this.#options.heartbeatMilliseconds ?? 5_000;
    while (!signal.aborted) {
      await delay(interval, signal);
      if (isAborted(signal)) return;
      try {
        const state = await this.#options.queue.heartbeat(
          leaseCommand(lease, this.#options.workerId),
        );
        if (state === "cancel-requested") {
          cancellation.abort(new FusionWorkerError("FUSION_CANCELLED"));
          return;
        }
      } catch {
        cancellation.abort(new FusionWorkerError("FUSION_LEASE_FENCED"));
        return;
      }
    }
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const status = await this.processNext(signal);
      if (status === "idle") await delay(this.#options.pollMilliseconds, signal);
    }
  }
}
