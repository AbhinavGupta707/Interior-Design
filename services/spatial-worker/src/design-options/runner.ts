import type { OptionJob } from "@interior-design/contracts";
import type {
  DesignOptionWorkerRuntime,
  LeasedOptionAttempt,
} from "@interior-design/platform-api/design-options";

import type { SafeLogger } from "../logger.js";
import { planDesignOptions, type DesignOptionPlanningResult } from "./planner.js";

export interface DesignOptionProcessingRunnerOptions {
  readonly leaseSeconds?: number;
  readonly logger: SafeLogger;
  readonly planner?: typeof planDesignOptions;
  readonly pollMilliseconds: number;
  readonly worker: Pick<
    DesignOptionWorkerRuntime,
    | "abstain"
    | "acknowledgeCancellation"
    | "advance"
    | "claimNext"
    | "fail"
    | "heartbeat"
    | "publish"
  >;
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

function errorCode(error: unknown): string | undefined {
  return error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

export class DesignOptionProcessingRunner {
  readonly #options: DesignOptionProcessingRunnerOptions;

  constructor(options: DesignOptionProcessingRunnerOptions) {
    if (!/^[A-Za-z0-9_.:-]{3,100}$/u.test(options.workerId))
      throw new Error("The C12 worker identifier is invalid.");
    const leaseSeconds = options.leaseSeconds ?? 300;
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 3_600) {
      throw new Error("The C12 lease must be 30 through 3600 seconds.");
    }
    if (
      !Number.isInteger(options.pollMilliseconds) ||
      options.pollMilliseconds < 100 ||
      options.pollMilliseconds > 60_000
    ) {
      throw new Error("The C12 poll interval must be 100 through 60000 milliseconds.");
    }
    this.#options = options;
  }

  async processNext(
    signal: AbortSignal = new AbortController().signal,
  ): Promise<"idle" | "processed"> {
    const lease = await this.#options.worker.claimNext({
      leaseSeconds: this.#options.leaseSeconds ?? 300,
      workerId: this.#options.workerId,
    });
    if (lease === undefined) return "idle";
    await this.#process(lease, signal);
    return "processed";
  }

  async #process(lease: LeasedOptionAttempt, signal: AbortSignal): Promise<void> {
    let job = lease.job;
    try {
      await this.#heartbeat(lease, job.version);
      job = await this.#advance(lease, job, "generating");
      const result = await (this.#options.planner ?? planDesignOptions)({ ...lease, job }, signal);
      if (signal.aborted) throw new Error("C12 processing aborted.");
      await this.#heartbeat(lease, job.version);
      if (result.status !== "produced") {
        await this.#finish(lease, job, result);
        return;
      }
      job = await this.#advance(lease, job, "validating");
      job = await this.#advance(lease, job, "publishing");
      await this.#options.worker.publish({
        ...this.#leaseCommand(lease, job.version),
        optionSet: result.optionSet,
        options: result.options,
      });
      this.#options.logger.info("design-options.published", {
        attempt: lease.attempt,
        jobId: lease.job.id,
        optionCount: result.options.length,
      });
    } catch (error) {
      if (errorCode(error) === "LEASE_LOST") {
        await this.#acknowledgePossibleCancellation(lease, job.version + 1);
        return;
      }
      try {
        await this.#options.worker.fail({
          ...this.#leaseCommand(lease, job.version),
          retryable: true,
          safeCode: "INTERNAL_FAILURE",
        });
      } catch {
        // A newer attempt, cancellation, or expiry owns the durable fence.
      }
      this.#options.logger.warn("design-options.processing-failed", {
        attempt: lease.attempt,
        errorCode: errorCode(error) ?? "INTERNAL_FAILURE",
        jobId: lease.job.id,
      });
    }
  }

  #leaseCommand(lease: LeasedOptionAttempt, expectedJobVersion: number) {
    return {
      attempt: lease.attempt,
      expectedJobVersion,
      jobId: lease.job.id,
      leaseToken: lease.leaseToken,
      projectId: lease.job.projectId,
      tenantId: lease.tenantId,
      workerId: this.#options.workerId,
    } as const;
  }

  #advance(
    lease: LeasedOptionAttempt,
    job: OptionJob,
    stage: "generating" | "validating" | "publishing",
  ): Promise<OptionJob> {
    return this.#options.worker.advance({ ...this.#leaseCommand(lease, job.version), stage });
  }

  async #heartbeat(lease: LeasedOptionAttempt, expectedJobVersion: number): Promise<void> {
    await this.#options.worker.heartbeat({
      ...this.#leaseCommand(lease, expectedJobVersion),
      leaseSeconds: this.#options.leaseSeconds ?? 300,
    });
  }

  async #finish(
    lease: LeasedOptionAttempt,
    job: OptionJob,
    result: Exclude<DesignOptionPlanningResult, { readonly status: "produced" }>,
  ): Promise<void> {
    if (result.status === "abstained") {
      await this.#options.worker.abstain({
        ...this.#leaseCommand(lease, job.version),
        safeCode: result.safeCode,
      });
      return;
    }
    await this.#options.worker.fail({
      ...this.#leaseCommand(lease, job.version),
      retryable: result.retryable,
      safeCode: result.safeCode,
    });
  }

  async #acknowledgePossibleCancellation(
    lease: LeasedOptionAttempt,
    expectedJobVersion: number,
  ): Promise<void> {
    try {
      await this.#options.worker.acknowledgeCancellation(
        this.#leaseCommand(lease, expectedJobVersion),
      );
    } catch {
      // A non-cancellation fence change remains untouched.
    }
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const result = await this.processNext(signal);
      if (result === "idle") await delay(this.#options.pollMilliseconds, signal);
    }
  }
}
