import { setTimeout as delay } from "node:timers/promises";

import type { WorkerConfig } from "./config.js";
import { LeaseLostError, RetryableWorkerError } from "./errors.js";
import type { LeasedProcessingJob, ProcessingJobRepository } from "./jobs.js";
import type { SafeLogger } from "./logger.js";
import type { PreparedProcessing, ProcessJobInput } from "./processor.js";
import type { ObjectStorage } from "./storage.js";

export { FusionProcessingRunner } from "./model-fusion/runner.js";

export interface RunOneOutcome {
  readonly claimed: boolean;
  readonly outcome?: "completed" | "exhausted" | "lease-lost" | "retrying";
}

export interface JobProcessor {
  process(input: ProcessJobInput): Promise<PreparedProcessing>;
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

export class SpatialWorkerRunner {
  readonly #config: WorkerConfig;
  readonly #jobs: ProcessingJobRepository;
  readonly #logger: SafeLogger;
  readonly #processor: JobProcessor;
  readonly #storage: ObjectStorage;

  constructor(options: {
    readonly config: WorkerConfig;
    readonly jobs: ProcessingJobRepository;
    readonly logger: SafeLogger;
    readonly processor: JobProcessor;
    readonly storage: ObjectStorage;
  }) {
    this.#config = options.config;
    this.#jobs = options.jobs;
    this.#logger = options.logger;
    this.#processor = options.processor;
    this.#storage = options.storage;
  }

  async run(signal: AbortSignal): Promise<void> {
    this.#logger.info("worker.started", { workerId: this.#config.workerId });
    while (!signal.aborted) {
      try {
        const outcome = await this.runOne(signal);
        if (!outcome.claimed) {
          await delay(this.#config.pollMs, undefined, { signal });
        }
      } catch (error) {
        if (isAborted(signal)) break;
        this.#logger.error("worker.poll-failed", {
          errorCode:
            error instanceof RetryableWorkerError ? error.safeCode : "repository-unavailable",
        });
        try {
          await delay(this.#config.pollMs, undefined, { signal });
        } catch {
          break;
        }
      }
    }
    this.#logger.info("worker.stopped", { workerId: this.#config.workerId });
  }

  async runOne(signal?: AbortSignal): Promise<RunOneOutcome> {
    const job = await this.#jobs.claim(this.#config.workerId, this.#config.leaseMs);
    if (job === undefined) return { claimed: false };
    this.#logger.info("job.claimed", {
      assetId: job.command.assetId,
      attempt: job.command.attempt,
      jobId: job.jobId,
      projectId: job.command.projectId,
    });
    return this.#execute(job, signal);
  }

  async #execute(job: LeasedProcessingJob, shutdownSignal?: AbortSignal): Promise<RunOneOutcome> {
    const leaseController = new AbortController();
    const heartbeatController = new AbortController();
    const workSignal =
      shutdownSignal === undefined
        ? leaseController.signal
        : AbortSignal.any([shutdownSignal, leaseController.signal]);
    let prepared: PreparedProcessing | undefined;
    const heartbeat = this.#heartbeat(job, leaseController, heartbeatController.signal);
    try {
      prepared = await this.#processor.process({
        command: job.command,
        executedAt: job.executionStartedAt,
        signal: workSignal,
      });
      if (isAborted(workSignal)) throw new LeaseLostError();
      const renewed = await this.#jobs.renew(job, this.#config.leaseMs);
      if (!renewed) throw new LeaseLostError();
      for (const write of prepared.writes) {
        if (isAborted(workSignal)) throw new LeaseLostError();
        await this.#storage.putDerivedIfAbsent(write, workSignal);
      }
      const completed = await this.#jobs.complete(job, prepared.result);
      if (!completed) throw new LeaseLostError();
      this.#logger.info("job.completed", {
        assetId: job.command.assetId,
        jobId: job.jobId,
        status: prepared.result.status,
      });
      return { claimed: true, outcome: "completed" };
    } catch (error) {
      if (
        error instanceof LeaseLostError ||
        leaseController.signal.aborted ||
        shutdownSignal?.aborted === true
      ) {
        this.#logger.warn("job.lease-lost", {
          assetId: job.command.assetId,
          jobId: job.jobId,
        });
        return { claimed: true, outcome: "lease-lost" };
      }
      const safeCode =
        error instanceof RetryableWorkerError ? error.safeCode : "processing-unavailable";
      const retryDelayMs = Math.min(60_000, 1_000 * 2 ** Math.max(0, job.command.attempt - 1));
      const outcome = await this.#jobs.retry(job, safeCode, retryDelayMs);
      this.#logger.warn("job.retry-recorded", {
        assetId: job.command.assetId,
        errorCode: safeCode,
        jobId: job.jobId,
        outcome,
      });
      return {
        claimed: true,
        outcome: outcome === "lost" ? "lease-lost" : outcome,
      };
    } finally {
      heartbeatController.abort();
      await heartbeat;
      try {
        await prepared?.cleanup();
      } catch {
        this.#logger.error("job.cleanup-failed", {
          assetId: job.command.assetId,
          jobId: job.jobId,
        });
      }
    }
  }

  async #heartbeat(
    job: LeasedProcessingJob,
    leaseController: AbortController,
    signal: AbortSignal,
  ): Promise<void> {
    while (!signal.aborted && !leaseController.signal.aborted) {
      try {
        await delay(this.#config.heartbeatMs, undefined, { signal });
        if (isAborted(signal)) return;
        if (!(await this.#jobs.renew(job, this.#config.leaseMs))) {
          leaseController.abort(new LeaseLostError());
          return;
        }
      } catch {
        if (!isAborted(signal)) leaseController.abort(new LeaseLostError());
        return;
      }
    }
  }
}
