import { RendererBoundaryError } from "@interior-design/blender-renderer";
import { createHash } from "node:crypto";

import type {
  LeasedRenderJob,
  RenderWorkerStage,
} from "@interior-design/platform-api/render-stills";
import type { RenderStillRunnerOptions, SafeRenderLogger } from "./types.js";

const quietLogger: SafeRenderLogger = { info: () => undefined, warn: () => undefined };

function safeCode(error: unknown): string {
  if (error instanceof RendererBoundaryError) return error.safeCode;
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { readonly code?: unknown }).code === "string" &&
    /^[A-Z][A-Z0-9_]{2,79}$/u.test((error as { readonly code: string }).code)
  ) {
    return (error as { readonly code: string }).code;
  }
  return "RENDER_WORKER_FAILED";
}

function sourceMatches(lease: LeasedRenderJob, source: LeasedRenderJob["source"]): boolean {
  return (
    createHash("sha256").update(JSON.stringify(lease.source)).digest("hex") ===
    createHash("sha256").update(JSON.stringify(source)).digest("hex")
  );
}

export class RenderStillRunner {
  readonly #options: RenderStillRunnerOptions;
  readonly #logger: SafeRenderLogger;

  constructor(options: RenderStillRunnerOptions) {
    this.#options = options;
    this.#logger = options.logger ?? quietLogger;
  }

  async runOnce(): Promise<"idle" | "processed"> {
    const freeBytes = await this.#options.disk.freeBytes(this.#options.volumePath);
    const lease = await this.#options.control.claimNext({
      capabilities: this.#options.capabilities,
      freeBytes,
      leaseSeconds: this.#options.leaseSeconds ?? 300,
      volumeId: this.#options.volumeId,
      workerId: this.#options.workerId,
    });
    if (lease === undefined) return "idle";
    this.#logger.info({ event: "render.claimed", stage: lease.stage });
    try {
      await this.#heartbeat(lease, "preparing");
      const source = await this.#options.source.load(lease);
      if (
        !sourceMatches(lease, source.source) ||
        createHash("sha256").update(source.glbBytes).digest("hex") !==
          lease.source.sceneGlbSha256 ||
        source.glbSha256 !== lease.source.sceneGlbSha256
      ) {
        throw Object.assign(new Error("Render source bytes changed."), {
          code: "RENDER_SOURCE_HASH_MISMATCH",
        });
      }
      const built = await this.#options.sceneBuilder.build({ lease, source });
      if (
        !sourceMatches(lease, built.manifest.source) ||
        createHash("sha256").update(built.manifestBytes).digest("hex") !== built.manifestSha256
      ) {
        throw Object.assign(new Error("Render scene binding changed."), {
          code: "RENDER_SCENE_BINDING_MISMATCH",
        });
      }
      await this.#heartbeat(lease, "rendering-safe");
      const abort = new AbortController();
      const bundle = await this.#withLeaseHeartbeat(lease, "rendering-safe", abort, () =>
        this.#options.renderer.render(
          {
            glbBytes: source.glbBytes,
            glbSha256: source.glbSha256,
            renderSceneManifest: built.manifest,
            renderSceneManifestBytes: built.manifestBytes,
            renderSceneManifestSha256: built.manifestSha256,
            resultId: lease.resultId,
          },
          abort.signal,
        ),
      );
      await this.#heartbeat(lease, "validating-safe");
      await this.#heartbeat(lease, "publishing-safe");
      await this.#options.control.publish({
        artifactBytes: bundle.artifactBytes,
        attempt: lease.attempt,
        jobId: lease.jobId,
        leaseToken: lease.leaseToken,
        manifest: bundle.manifest,
        manifestBytes: bundle.manifestBytes,
        manifestSha256: bundle.manifestSha256,
        projectId: lease.projectId,
        resultId: lease.resultId,
        tenantId: lease.tenantId,
        workerId: this.#options.workerId,
      });
      this.#logger.info({ event: "render.published", stage: "succeeded" });
      return "processed";
    } catch (error) {
      const code = safeCode(error);
      this.#logger.warn({ event: "render.failed", safeCode: code });
      if (code.includes("CANCEL")) {
        await this.#options.control
          .acknowledgeCancellation({
            attempt: lease.attempt,
            jobId: lease.jobId,
            leaseToken: lease.leaseToken,
            projectId: lease.projectId,
            tenantId: lease.tenantId,
            workerId: this.#options.workerId,
          })
          .catch(() => undefined);
      } else {
        await this.#options.control
          .fail({
            attempt: lease.attempt,
            jobId: lease.jobId,
            leaseToken: lease.leaseToken,
            projectId: lease.projectId,
            retryable: [
              "RENDER_DISK_ADMISSION_LOST",
              "RENDER_PROCESS_KILLED",
              "RENDER_PROCESS_START_FAILED",
              "RENDER_PROCESS_TIMEOUT",
              "RENDER_WORKER_FAILED",
            ].includes(code),
            safeCode: code,
            tenantId: lease.tenantId,
            workerId: this.#options.workerId,
          })
          .catch(() => undefined);
      }
      return "processed";
    }
  }

  async #heartbeat(lease: LeasedRenderJob, stage: RenderWorkerStage): Promise<void> {
    await this.#options.control.heartbeat({
      attempt: lease.attempt,
      freeBytes: await this.#options.disk.freeBytes(this.#options.volumePath),
      jobId: lease.jobId,
      leaseToken: lease.leaseToken,
      projectId: lease.projectId,
      stage,
      tenantId: lease.tenantId,
      workerId: this.#options.workerId,
    });
  }

  async #withLeaseHeartbeat<T>(
    lease: LeasedRenderJob,
    stage: RenderWorkerStage,
    abort: AbortController,
    operation: () => Promise<T>,
  ): Promise<T> {
    const intervalMilliseconds = this.#options.heartbeatMilliseconds ?? 30_000;
    let heartbeatFailure: unknown;
    let active = false;
    const timer = setInterval(() => {
      if (active || heartbeatFailure !== undefined) return;
      active = true;
      void this.#heartbeat(lease, stage)
        .catch((error: unknown) => {
          heartbeatFailure = error;
          abort.abort();
        })
        .finally(() => {
          active = false;
        });
    }, intervalMilliseconds);
    timer.unref();
    try {
      const result = await operation();
      if (heartbeatFailure instanceof Error) throw heartbeatFailure;
      if (heartbeatFailure !== undefined)
        throw new RendererBoundaryError("RENDER_LEASE_HEARTBEAT_FAILED");
      return result;
    } finally {
      clearInterval(timer);
    }
  }
}
