import {
  c6PlanParserInputSchemaVersion,
  c6PlanPolicy,
  planParserRequestSchema,
} from "@interior-design/contracts";
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";

import type { ObjectStorage } from "../storage.js";
import { IsolatedWorkspace } from "../workspace.js";
import type { PlanNormalizer } from "./normalizer.js";
import { validatePlanParserOutput } from "./parser.js";
import { PlanNormalizationError } from "./types.js";
import type { LeasedPlanProcessingJob, PlanParserPort, PlanProcessingQueue } from "./types.js";

export interface PlanProcessingRunnerOptions {
  readonly heartbeatMilliseconds: number;
  readonly leaseMilliseconds: number;
  readonly logger: {
    error(event: string, fields?: Readonly<Record<string, unknown>>): void;
    info(event: string, fields?: Readonly<Record<string, unknown>>): void;
    warn(event: string, fields?: Readonly<Record<string, unknown>>): void;
  };
  readonly normalizer: PlanNormalizer;
  readonly parser: PlanParserPort;
  readonly pollMilliseconds: number;
  readonly queue: PlanProcessingQueue;
  readonly storage: ObjectStorage;
  readonly temporaryMaximumBytes: number;
  readonly temporaryRoot: string;
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

async function streamExactSource(
  source: AsyncIterable<Uint8Array>,
  destination: string,
  expectedByteSize: number,
  expectedSha256: string,
  signal: AbortSignal,
): Promise<void> {
  const handle = await open(destination, "wx", 0o600);
  const hash = createHash("sha256");
  let byteSize = 0;
  try {
    for await (const chunk of source) {
      if (signal.aborted) throw signal.reason;
      byteSize += chunk.byteLength;
      if (byteSize > expectedByteSize || byteSize > c6PlanPolicy.maximumAssetBytes)
        throw new PlanNormalizationError("source-mismatch");
      hash.update(chunk);
      await handle.writeFile(chunk);
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (byteSize !== expectedByteSize || hash.digest("hex") !== expectedSha256)
    throw new PlanNormalizationError("source-mismatch");
}

export class PlanProcessingRunner {
  readonly #options: PlanProcessingRunnerOptions;

  constructor(options: PlanProcessingRunnerOptions) {
    if (options.heartbeatMilliseconds * 2 >= options.leaseMilliseconds) {
      throw new Error("The C6 heartbeat must be less than half the lease duration.");
    }
    this.#options = options;
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

  async #process(job: LeasedPlanProcessingJob, signal?: AbortSignal): Promise<void> {
    const workspace = await IsolatedWorkspace.create(
      this.#options.temporaryRoot,
      this.#options.temporaryMaximumBytes,
    );
    const deadline = AbortSignal.timeout(c6PlanPolicy.parserTimeoutMilliseconds);
    const processingSignal = signal === undefined ? deadline : AbortSignal.any([signal, deadline]);
    try {
      const source = await this.#options.storage.openSource(
        "source",
        job.sourceObjectKey,
        processingSignal,
      );
      const sourcePath = workspace.resolve("plan-source.bin");
      await streamExactSource(
        source,
        sourcePath,
        job.sourceByteSize,
        job.sourceSha256,
        processingSignal,
      );
      const normalized = await this.#options.normalizer.normalize(
        {
          detectedMimeType: job.detectedMimeType,
          expectedByteSize: job.sourceByteSize,
          expectedSha256: job.sourceSha256,
          pageIndex: job.pageIndex,
          parserPreference: job.parserPreference,
          sourcePath,
          workspaceDirectory: workspace.directory,
        },
        processingSignal,
      );
      await workspace.assertWithinQuota();
      const leaseState = await this.#options.queue.heartbeat(
        job,
        this.#options.workerId,
        this.#options.leaseMilliseconds,
      );
      if (leaseState === "cancel-requested") {
        await this.#options.queue.acknowledgeCancellation(job, this.#options.workerId);
        return;
      }
      if (leaseState === "lost") return;
      const sourceManifest = {
        assetId: job.assetId,
        byteSize: job.sourceByteSize,
        coordinateSpace: normalized.coordinateSpace,
        detectedMimeType: job.detectedMimeType,
        heightSourceUnits: normalized.heightSourceUnits,
        pageIndex: job.pageIndex,
        projectId: job.projectId,
        rights: job.rights,
        sha256: job.sourceSha256,
        widthSourceUnits: normalized.widthSourceUnits,
      } as const;
      const request = planParserRequestSchema.parse({
        jobId: job.jobId,
        limits: {
          maximumCandidates: c6PlanPolicy.maximumCandidates,
          maximumOutputBytes: c6PlanPolicy.maximumParserOutputBytes,
          timeoutMilliseconds: c6PlanPolicy.parserTimeoutMilliseconds,
        },
        normalizers: normalized.normalizers,
        normalizedInputSha256: normalized.sha256,
        parserMode: normalized.mode,
        schemaVersion: c6PlanParserInputSchemaVersion,
        source: sourceManifest,
      });
      let result;
      try {
        const parserInput = { ...normalized, request };
        result = validatePlanParserOutput(
          parserInput,
          await this.#options.parser.parse(parserInput, processingSignal),
        );
      } catch (error) {
        if (deadline.aborted)
          throw new PlanNormalizationError("parser-timeout", true, { cause: error });
        if (error instanceof PlanNormalizationError) throw error;
        throw new PlanNormalizationError("invalid-parser-output", false, { cause: error });
      }
      const finalLease = await this.#options.queue.heartbeat(
        job,
        this.#options.workerId,
        this.#options.leaseMilliseconds,
      );
      if (finalLease === "cancel-requested") {
        await this.#options.queue.acknowledgeCancellation(job, this.#options.workerId);
        return;
      }
      if (finalLease === "lost") return;
      if (!(await this.#options.queue.publish(job, this.#options.workerId, result))) {
        this.#options.logger.warn("plan.publish-fenced", {
          attempt: job.attempt,
          safeCode: "lease-or-cancel-race",
        });
        return;
      }
      this.#options.logger.info("plan.processed", {
        attempt: job.attempt,
        candidateCount: result.status === "proposal" ? result.candidates.length : 0,
        resultStatus: result.status,
        safeCode: result.status === "abstained" ? result.code : undefined,
      });
    } catch (error) {
      const failure = deadline.aborted
        ? new PlanNormalizationError("parser-timeout", true, { cause: error })
        : error instanceof PlanNormalizationError
          ? error
          : new PlanNormalizationError("parser-unavailable", true, { cause: error });
      await this.#options.queue.fail(job, this.#options.workerId, failure.code, failure.retryable);
      this.#options.logger.warn("plan.processing-failed", {
        attempt: job.attempt,
        retryable: failure.retryable,
        safeCode: failure.code,
      });
    } finally {
      try {
        await workspace.cleanup();
      } catch {
        this.#options.logger.error("plan.workspace-cleanup-failed", { safeCode: "cleanup-failed" });
      }
    }
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const result = await this.processNext(signal);
      if (result === "idle") await delay(this.#options.pollMilliseconds, signal);
    }
  }
}
