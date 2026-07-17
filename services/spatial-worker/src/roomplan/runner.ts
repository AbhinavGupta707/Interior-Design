import { deterministicUuid } from "./canonical.js";
import {
  convertRoomPlanToProposal,
  createRoomPlanAbstention,
  type RoomPlanConversionContext,
} from "./converter.js";
import { verifyCaptureSources } from "./source.js";
import {
  RoomPlanSourceError,
  type LeasedRoomPlanCapture,
  type RoomPlanProcessingQueue,
} from "./types.js";
import { RoomPlanValidationError, validateRoomPlanNormalized } from "./validator.js";
import type { ObjectStorage } from "../storage.js";

export interface RoomPlanRunnerOptions {
  readonly clock?: { now(): Date };
  readonly heartbeatMilliseconds: number;
  readonly leaseMilliseconds: number;
  readonly logger: {
    error(event: string, fields?: Readonly<Record<string, unknown>>): void;
    info(event: string, fields?: Readonly<Record<string, unknown>>): void;
    warn(event: string, fields?: Readonly<Record<string, unknown>>): void;
  };
  readonly pollMilliseconds: number;
  readonly queue: RoomPlanProcessingQueue;
  readonly storage: ObjectStorage;
  readonly workerId: string;
}

class RoomPlanLeaseEnded extends Error {
  readonly state: "cancel-requested" | "lost";

  constructor(state: "cancel-requested" | "lost") {
    super(`roomplan-lease-${state}`);
    this.name = "RoomPlanLeaseEnded";
    this.state = state;
  }
}

function delay(milliseconds: number, signal: AbortSignal): Promise<"aborted" | "elapsed"> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve("aborted");
      return;
    }
    const timer = setTimeout(() => {
      resolve("elapsed");
    }, milliseconds);
    timer.unref();
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve("aborted");
      },
      { once: true },
    );
  });
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error("Unknown RoomPlan processing failure.");
}

function contextFor(
  job: LeasedRoomPlanCapture,
  createdAt: string,
  normalizedArtifactId: string,
  normalizedInputSha256: string,
): RoomPlanConversionContext {
  return {
    captureSessionId: job.captureSessionId,
    createdAt,
    normalizedArtifactId,
    normalizedInputSha256,
    packageId: job.packageId,
    packageManifestSha256: job.packageManifestSha256,
    projectId: job.projectId,
    proposalId: deterministicUuid(
      "c7-proposal",
      `${job.captureSessionId}:${job.packageId}:${job.packageManifestSha256}`,
    ),
  };
}

export class RoomPlanProcessingRunner {
  readonly #clock: { now(): Date };
  readonly #options: RoomPlanRunnerOptions;

  constructor(options: RoomPlanRunnerOptions) {
    if (options.heartbeatMilliseconds * 2 >= options.leaseMilliseconds) {
      throw new Error("The C7 heartbeat must be less than half the lease duration.");
    }
    this.#options = options;
    this.#clock = options.clock ?? { now: () => new Date() };
  }

  async processNext(signal?: AbortSignal): Promise<"idle" | "processed"> {
    const job = await this.#options.queue.claimNext(
      this.#options.workerId,
      this.#options.leaseMilliseconds,
    );
    if (job === undefined) return "idle";
    await this.#process(job, signal);
    return "processed";
  }

  async #heartbeat(job: LeasedRoomPlanCapture): Promise<void> {
    const state = await this.#options.queue.heartbeat(
      job,
      this.#options.workerId,
      this.#options.leaseMilliseconds,
    );
    if (state !== "leased") throw new RoomPlanLeaseEnded(state);
  }

  async #heartbeatLoop(
    job: LeasedRoomPlanCapture,
    processingAbort: AbortController,
    signal: AbortSignal,
    recordFailure: (error: Error) => void,
  ): Promise<void> {
    while (!signal.aborted) {
      if ((await delay(this.#options.heartbeatMilliseconds, signal)) === "aborted") return;
      try {
        await this.#heartbeat(job);
      } catch (error) {
        recordFailure(normalizeError(error));
        processingAbort.abort(error);
        return;
      }
    }
  }

  async #process(job: LeasedRoomPlanCapture, signal?: AbortSignal): Promise<void> {
    const processingAbort = new AbortController();
    const processingSignal =
      signal === undefined
        ? processingAbort.signal
        : AbortSignal.any([signal, processingAbort.signal]);
    const heartbeatState: { failure?: Error } = {};
    const heartbeatTask = this.#heartbeatLoop(job, processingAbort, processingSignal, (error) => {
      heartbeatState.failure = error;
    });
    const createdAt = this.#clock.now().toISOString();
    const declaredNormalized = job.artifacts.find(
      ({ kind }) => kind === "roomplan-normalized-json",
    );
    let context =
      declaredNormalized === undefined
        ? undefined
        : contextFor(job, createdAt, declaredNormalized.artifactId, declaredNormalized.sha256);
    try {
      const verified = await verifyCaptureSources(
        this.#options.storage,
        job.artifacts,
        job.manifest,
        () => {
          return heartbeatState.failure === undefined
            ? Promise.resolve()
            : Promise.reject(heartbeatState.failure);
        },
        processingSignal,
      );
      context = contextFor(
        job,
        createdAt,
        verified.normalizedArtifactId,
        verified.normalizedInputSha256,
      );
      let result;
      try {
        const normalized = validateRoomPlanNormalized(verified.normalizedInput, {
          actualNormalizedSha256: verified.normalizedInputSha256,
          captureSessionId: job.captureSessionId,
          expectedNormalizedSha256: verified.normalizedInputSha256,
          manifest: job.manifest,
          projectId: job.projectId,
        });
        result = convertRoomPlanToProposal(normalized, context);
      } catch (error) {
        if (!(error instanceof RoomPlanValidationError)) throw error;
        result = createRoomPlanAbstention(context, error.code, error.message);
      }
      if (heartbeatState.failure !== undefined) throw heartbeatState.failure;
      await this.#heartbeat(job);
      if (!(await this.#options.queue.publish(job, this.#options.workerId, result))) {
        this.#options.logger.warn("roomplan.publish-fenced", {
          attempt: job.attempt,
          safeCode: "lease-cancel-rights-race",
        });
        return;
      }
      this.#options.logger.info("roomplan.processed", {
        attempt: job.attempt,
        resultStatus: result.status,
        safeCode: result.status === "abstained" ? result.code : undefined,
      });
    } catch (error) {
      const failure = heartbeatState.failure ?? error;
      if (failure instanceof RoomPlanLeaseEnded) {
        if (failure.state === "cancel-requested") {
          await this.#options.queue.acknowledgeCancellation(job, this.#options.workerId);
        }
        return;
      }
      if (signal?.aborted === true) return;
      if (
        failure instanceof RoomPlanSourceError &&
        !failure.retryable &&
        failure.code !== "storage-unavailable" &&
        context !== undefined
      ) {
        const result = createRoomPlanAbstention(
          context,
          failure.code,
          `The immutable source package failed ${failure.code} validation.`,
        );
        await this.#options.queue.publish(job, this.#options.workerId, result);
        return;
      }
      const code = failure instanceof RoomPlanSourceError ? failure.code : "conversion-failed";
      const retryable = failure instanceof RoomPlanSourceError ? failure.retryable : false;
      await this.#options.queue.fail(job, this.#options.workerId, code, retryable);
      this.#options.logger.warn("roomplan.processing-failed", {
        attempt: job.attempt,
        retryable,
        safeCode: code,
      });
    } finally {
      processingAbort.abort(new Error("roomplan-processing-complete"));
      await heartbeatTask;
    }
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const result = await this.processNext(signal);
      if (result === "idle") await delay(this.#options.pollMilliseconds, signal);
    }
  }
}
