import {
  type LeasedSceneAttempt,
  type SceneCompilerWorkerPort,
  type SceneWorkerStage,
} from "@interior-design/platform-api/scenes";
import { compileCanonicalScene, sceneCompilerVersion } from "@interior-design/scene-compiler";

import type { SafeLogger } from "../logger.js";
import { runSceneCompilation } from "./runtime.js";
import type {
  SceneCompilationRuntimePorts,
  SceneCompilationRuntimeResult,
  SceneCompilationTask,
  SceneCompilerPort,
} from "./types.js";

type RunCompilation = typeof runSceneCompilation;

export interface SceneCompilationRunnerOptions {
  readonly compile?: SceneCompilerPort["compile"];
  readonly heartbeatMilliseconds?: number;
  readonly leaseSeconds?: number;
  readonly logger: SafeLogger;
  readonly pollMilliseconds: number;
  readonly runCompilation?: RunCompilation;
  readonly worker: SceneCompilerWorkerPort;
  readonly workerId: string;
}

type LeaseState = "cancelled" | "current" | "stale";

const stageOrder: Readonly<Record<SceneWorkerStage, number>> = {
  leased: 0,
  compiling: 1,
  publishing: 2,
};

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
  if (error === null || typeof error !== "object" || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function stateForError(error: unknown): Exclude<LeaseState, "current"> {
  return errorCode(error) === "SCENE_CANCELLATION_REQUESTED" ? "cancelled" : "stale";
}

function isPublicationFenceError(error: unknown): boolean {
  return ["SCENE_CANCELLATION_REQUESTED", "SCENE_LEASE_FENCED"].includes(errorCode(error) ?? "");
}

function leaseCommand(lease: LeasedSceneAttempt, workerId: string) {
  return {
    attempt: lease.attempt,
    jobId: lease.jobId,
    leaseToken: lease.leaseToken,
    projectId: lease.projectId,
    tenantId: lease.tenantId,
    workerId,
  } as const;
}

export class SceneCompilationRunner {
  readonly #options: SceneCompilationRunnerOptions;

  constructor(options: SceneCompilationRunnerOptions) {
    if (!/^[A-Za-z0-9_.:-]{3,100}$/u.test(options.workerId)) {
      throw new Error("The C10 worker identifier is invalid.");
    }
    const heartbeatMilliseconds = options.heartbeatMilliseconds ?? 5_000;
    const leaseSeconds = options.leaseSeconds ?? 300;
    if (
      !Number.isInteger(heartbeatMilliseconds) ||
      heartbeatMilliseconds < 1_000 ||
      heartbeatMilliseconds >= leaseSeconds * 500
    ) {
      throw new Error(
        "The C10 heartbeat must be at least one second and less than half the lease.",
      );
    }
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 3_600) {
      throw new Error("The C10 lease must be 30 through 3600 seconds.");
    }
    this.#options = options;
  }

  async processNext(signal?: AbortSignal): Promise<"idle" | "processed"> {
    const lease = await this.#options.worker.claimNext({
      compiler: {
        name: "interior-design-scene-compiler",
        version: sceneCompilerVersion,
      },
      leaseSeconds: this.#options.leaseSeconds ?? 300,
      workerId: this.#options.workerId,
    });
    if (lease === undefined) return "idle";
    await this.#process(lease, signal);
    return "processed";
  }

  async #process(lease: LeasedSceneAttempt, outerSignal?: AbortSignal): Promise<void> {
    const cancellation = new AbortController();
    const signal =
      outerSignal === undefined
        ? cancellation.signal
        : AbortSignal.any([outerSignal, cancellation.signal]);
    let currentStage = lease.stage;
    const leaseState: { value: LeaseState } = { value: "current" };
    let heartbeatQueue = Promise.resolve();

    const heartbeat = async (requestedStage = currentStage): Promise<LeaseState> => {
      heartbeatQueue = heartbeatQueue.then(async () => {
        if (leaseState.value !== "current" || signal.aborted) return;
        const stage =
          stageOrder[requestedStage] < stageOrder[currentStage] ? currentStage : requestedStage;
        try {
          await this.#options.worker.heartbeat({
            ...leaseCommand(lease, this.#options.workerId),
            stage,
          });
          currentStage = stage;
        } catch (error) {
          leaseState.value = stateForError(error);
          cancellation.abort(error);
        }
      });
      await heartbeatQueue;
      return leaseState.value;
    };

    const task: SceneCompilationTask = {
      attempt: lease.attempt,
      configuration: lease.request.configuration,
      jobId: lease.jobId,
      publicationFence: lease.leaseToken,
      sourceSnapshot: lease.request.sourceSnapshot,
    };
    const compiler: SceneCompilerPort = {
      compile:
        this.#options.compile ??
        (async (input) => {
          const compiled = await compileCanonicalScene(input);
          return {
            artifact: compiled.artifact,
            glb: compiled.glb,
            manifest: compiled.manifest,
            manifestBytes: compiled.manifestBytes,
          };
        }),
    };
    const ports: SceneCompilationRuntimePorts = {
      compiler,
      publisher: {
        publishIfCurrent: async (publication) => {
          const state = await heartbeat("publishing");
          if (state !== "current") return state;
          try {
            await this.#options.worker.publish({
              ...leaseCommand(lease, this.#options.workerId),
              output: { glb: publication.glb, manifest: publication.manifest },
            });
            return "published";
          } catch (error) {
            if (isPublicationFenceError(error)) {
              leaseState.value = stateForError(error);
              cancellation.abort(error);
              return leaseState.value;
            }
            this.#options.logger.warn("scene.publication-rejected", {
              attempt: lease.attempt,
              jobId: lease.jobId,
              safeCode: errorCode(error) ?? "SCENE_PUBLICATION_FAILED",
            });
            throw error;
          }
        },
      },
      snapshots: {
        loadExactSnapshot: async () => {
          const state = await heartbeat("compiling");
          if (state !== "current") throw new Error("The scene lease is no longer current.");
          const source = await this.#options.worker.loadSource(
            leaseCommand(lease, this.#options.workerId),
          );
          return source.snapshot;
        },
      },
      workState: {
        check: async () => heartbeat(),
      },
    };

    const monitor = this.#monitorHeartbeat(heartbeat, signal);
    let result: SceneCompilationRuntimeResult;
    try {
      result = await (this.#options.runCompilation ?? runSceneCompilation)(task, ports, signal);
      if (result.status === "published") {
        this.#options.logger.info("scene.compiled", {
          attempt: lease.attempt,
          byteSize: result.artifact.byteSize,
          jobId: lease.jobId,
          nodeCount: result.manifest.counts.nodes,
          triangleCount: result.manifest.counts.triangles,
        });
      } else if (leaseState.value === "cancelled") {
        await this.#acknowledgeCancellation(lease);
      } else if (result.status === "failed" && leaseState.value === "current" && !signal.aborted) {
        await this.#fail(lease);
      }
    } catch {
      if (leaseState.value === "cancelled") await this.#acknowledgeCancellation(lease);
      else if (leaseState.value === "current" && !signal.aborted) await this.#fail(lease);
    } finally {
      cancellation.abort();
      await monitor;
    }
  }

  async #acknowledgeCancellation(lease: LeasedSceneAttempt): Promise<void> {
    try {
      await this.#options.worker.acknowledgeCancellation(
        leaseCommand(lease, this.#options.workerId),
      );
    } catch {
      // Expiry, reclaim, or a newer attempt owns the durable fence.
    }
  }

  async #fail(lease: LeasedSceneAttempt): Promise<void> {
    try {
      await this.#options.worker.fail({
        ...leaseCommand(lease, this.#options.workerId),
        retryable: true,
        safeCode: "SCENE_COMPILATION_FAILED",
      });
    } catch {
      // Cancellation, expiry, reclaim, or a newer attempt owns the durable fence.
    }
    this.#options.logger.warn("scene.compilation-failed", {
      attempt: lease.attempt,
      jobId: lease.jobId,
      retryable: true,
      safeCode: "SCENE_COMPILATION_FAILED",
    });
  }

  async #monitorHeartbeat(
    heartbeat: () => Promise<LeaseState>,
    signal: AbortSignal,
  ): Promise<void> {
    while (!signal.aborted) {
      await delay(this.#options.heartbeatMilliseconds ?? 5_000, signal);
      await heartbeat();
    }
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const status = await this.processNext(signal);
      if (status === "idle") await delay(this.#options.pollMilliseconds, signal);
    }
  }
}
