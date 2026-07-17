import type { LeasedReconstructionAttempt } from "@interior-design/platform-api/reconstruction";

import type { SafeLogger } from "../logger.js";
import { MediaPreparationError } from "../media-prep/index.js";
import type { MediaPreparationPipeline } from "../media-prep/index.js";
import type { ObjectStorage } from "../storage.js";
import { mediaPreparationSources } from "./source.js";
import {
  ReconstructionWorkerError,
  type ReconstructionProcessingQueue,
  type ReconstructionProcessor,
  type ReconstructionSourceLoader,
} from "./types.js";

export interface ReconstructionProcessingRunnerOptions {
  readonly leaseSeconds?: number;
  readonly logger: SafeLogger;
  readonly media: MediaPreparationPipeline;
  readonly pollMilliseconds: number;
  readonly processor: ReconstructionProcessor;
  readonly queue: ReconstructionProcessingQueue;
  readonly sources: ReconstructionSourceLoader;
  readonly storage: ObjectStorage;
  readonly workerId: string;
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

function safeFailure(error: unknown): { readonly retryable: boolean; readonly safeCode: string } {
  if (error instanceof ReconstructionWorkerError) {
    return { retryable: error.retryable, safeCode: error.safeCode };
  }
  if (error instanceof MediaPreparationError) {
    return {
      retryable: error.retryable,
      safeCode: `MEDIA_${error.safeCode}`.slice(0, 80),
    };
  }
  return { retryable: false, safeCode: "RECONSTRUCTION_WORKER_FAILED" };
}

function leaseCommand(lease: LeasedReconstructionAttempt, workerId: string) {
  return {
    attempt: lease.attempt,
    jobId: lease.jobId,
    leaseToken: lease.leaseToken,
    workerId,
  } as const;
}

export class ReconstructionProcessingRunner {
  readonly #options: ReconstructionProcessingRunnerOptions;

  constructor(options: ReconstructionProcessingRunnerOptions) {
    if (!/^[A-Za-z0-9_.:-]{3,100}$/u.test(options.workerId)) {
      throw new Error("The C8 worker identifier is invalid.");
    }
    this.#options = options;
  }

  async processNext(signal?: AbortSignal): Promise<"idle" | "processed"> {
    const lease = await this.#options.queue.claimNext({
      leaseSeconds: this.#options.leaseSeconds ?? 3_600,
      workerId: this.#options.workerId,
    });
    if (lease === undefined) return "idle";
    await this.#process(lease, signal);
    return "processed";
  }

  async #process(lease: LeasedReconstructionAttempt, signal?: AbortSignal): Promise<void> {
    let prepared: Awaited<ReturnType<MediaPreparationPipeline["prepare"]>> | undefined;
    try {
      const sources = await this.#options.sources.load(lease, signal);
      prepared = await this.#options.media.prepare(
        {
          jobId: lease.jobId,
          projectId: lease.projectId,
          sourceManifestSha256: lease.sourceManifestSha256,
          sources: mediaPreparationSources(sources, this.#options.storage),
        },
        signal,
      );
      if (prepared.manifest.sourceManifestSha256 !== lease.sourceManifestSha256) {
        throw new ReconstructionWorkerError("RECONSTRUCTION_SOURCE_MANIFEST_MISMATCH");
      }
      if (prepared.manifest.privacyStatus !== "accepted") {
        const safeCode =
          prepared.manifest.privacyStatus === "rejected"
            ? "RECONSTRUCTION_PRIVACY_REJECTED"
            : "RECONSTRUCTION_PRIVACY_REVIEW_REQUIRED";
        const result = await this.#options.processor.abstain(
          lease,
          prepared.manifest,
          safeCode,
          signal,
        );
        await this.#options.queue.publishResult({
          ...leaseCommand(lease, this.#options.workerId),
          result,
        });
        this.#options.logger.info("reconstruction.abstained", {
          attempt: lease.attempt,
          jobId: lease.jobId,
          safeCode,
        });
        return;
      }
      if (lease.stage === "preparing") {
        await this.#options.queue.advanceAttempt({
          ...leaseCommand(lease, this.#options.workerId),
          stage: "ready-for-reconstruction",
        });
      }
      if (lease.stage === "preparing" || lease.stage === "ready-for-reconstruction") {
        await this.#options.queue.advanceAttempt({
          ...leaseCommand(lease, this.#options.workerId),
          stage: "reconstructing-geometry",
        });
      }
      const result = await this.#options.processor.process(lease, prepared, signal);
      if (
        result.status === "completed" &&
        lease.request.appearanceMode === "optional" &&
        lease.stage !== "reconstructing-appearance"
      ) {
        await this.#options.queue.advanceAttempt({
          ...leaseCommand(lease, this.#options.workerId),
          stage: "reconstructing-appearance",
        });
      }
      await this.#options.queue.publishResult({
        ...leaseCommand(lease, this.#options.workerId),
        result,
      });
      this.#options.logger.info("reconstruction.processed", {
        attempt: lease.attempt,
        jobId: lease.jobId,
        status: result.status,
      });
    } catch (error) {
      if (signal?.aborted === true) return;
      const failure = safeFailure(error);
      try {
        await this.#options.queue.failAttempt({
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
          // A newer attempt or worker owns the durable fence. No publication is allowed.
        }
      }
      this.#options.logger.warn("reconstruction.processing-failed", {
        attempt: lease.attempt,
        errorName: error instanceof Error ? error.name : "unknown",
        jobId: lease.jobId,
        retryable: failure.retryable,
        safeCode: failure.safeCode,
      });
    } finally {
      await prepared?.cleanup();
    }
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const status = await this.processNext(signal);
      if (status === "idle") await delay(this.#options.pollMilliseconds, signal);
    }
  }
}
