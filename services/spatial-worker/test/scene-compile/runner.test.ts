import {
  c10DefaultCompileConfiguration,
  type ModelSnapshotRecord,
  type SceneArtifact,
  type SceneJob,
  type SceneManifest,
} from "@interior-design/contracts";
import type {
  LeasedSceneAttempt,
  SceneCompilerWorkerPort,
} from "@interior-design/platform-api/scenes";
import { describe, expect, it, vi } from "vitest";

import type { SafeLogger } from "../../src/logger.js";
import { SceneCompilationRunner } from "../../src/scene-compile/runner.js";
import type {
  SceneCompilationRuntimePorts,
  SceneCompilationRuntimeResult,
  SceneCompilationTask,
} from "../../src/scene-compile/types.js";

const uuid = (sequence: number): string =>
  `c1000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;
const hash = (value: string): string => value.repeat(64).slice(0, 64);

const lease: LeasedSceneAttempt = {
  attempt: 1,
  cacheKeySha256: hash("a"),
  compiler: { name: "interior-design-scene-compiler", version: "1.0.0" },
  configurationSha256: hash("b"),
  jobId: uuid(1),
  leaseExpiresAt: "2099-01-01T00:00:00.000Z",
  leaseToken: "private-fence-token",
  projectId: uuid(2),
  request: {
    configuration: c10DefaultCompileConfiguration,
    label: "Runner adapter test",
    sourceSnapshot: {
      modelId: uuid(3),
      profile: "existing",
      projectId: uuid(2),
      schemaVersion: "c4-canonical-home-v1",
      snapshotId: uuid(4),
      snapshotSha256: hash("c"),
    },
  },
  stage: "leased",
  tenantId: uuid(5),
};

function logger(): SafeLogger {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
}

function worker(
  options: { readonly heartbeatError?: unknown; readonly publishError?: unknown } = {},
) {
  const acknowledgeCancellation = vi.fn<SceneCompilerWorkerPort["acknowledgeCancellation"]>();
  const claimNext = vi.fn<SceneCompilerWorkerPort["claimNext"]>().mockResolvedValue(lease);
  const fail = vi.fn<SceneCompilerWorkerPort["fail"]>().mockResolvedValue({} as SceneJob);
  const heartbeat = vi.fn<SceneCompilerWorkerPort["heartbeat"]>();
  if (options.heartbeatError === undefined) heartbeat.mockResolvedValue({} as SceneJob);
  else heartbeat.mockRejectedValue(options.heartbeatError);
  const loadSource = vi
    .fn<SceneCompilerWorkerPort["loadSource"]>()
    .mockResolvedValue({ snapshot: { exact: true } } as unknown as ModelSnapshotRecord);
  const publish = vi.fn<SceneCompilerWorkerPort["publish"]>();
  if (options.publishError === undefined) publish.mockResolvedValue({} as SceneJob);
  else publish.mockRejectedValue(options.publishError);
  const port: SceneCompilerWorkerPort = {
    acknowledgeCancellation,
    claimNext,
    fail,
    heartbeat,
    loadSource,
    publish,
  };
  return { acknowledgeCancellation, fail, heartbeat, loadSource, port, publish };
}

const artifact = {
  byteSize: 20,
  glbSha256: hash("d"),
  id: uuid(6),
  manifestSha256: hash("e"),
  mimeType: "model/gltf-binary",
  schemaVersion: "c10-scene-artifact-v1",
} as const satisfies SceneArtifact;

const manifest = {
  counts: { nodes: 2, triangles: 12 },
} as unknown as SceneManifest;

describe("C10 scene compilation runner", () => {
  it("adapts a claimed lease through exact load, monotonic stages, and fenced publication", async () => {
    const double = worker();
    const runCompilation = vi.fn(
      async (
        task: SceneCompilationTask,
        ports: SceneCompilationRuntimePorts,
      ): Promise<SceneCompilationRuntimeResult> => {
        expect(await ports.workState.check(task, new AbortController().signal)).toBe("current");
        expect(
          await ports.snapshots.loadExactSnapshot(
            task.sourceSnapshot,
            new AbortController().signal,
          ),
        ).toEqual({
          exact: true,
        });
        const publication = await ports.publisher.publishIfCurrent(
          {
            artifact,
            attempt: task.attempt,
            contentAddress: {
              glbSha256: artifact.glbSha256,
              manifestSha256: artifact.manifestSha256,
            },
            glb: new Uint8Array(20),
            jobId: task.jobId,
            manifest,
            manifestBytes: new Uint8Array(),
            publicationFence: task.publicationFence,
          },
          new AbortController().signal,
        );
        expect(publication).toBe("published");
        return { artifact, manifest, status: "published" };
      },
    );
    const runner = new SceneCompilationRunner({
      heartbeatMilliseconds: 1_000,
      leaseSeconds: 30,
      logger: logger(),
      pollMilliseconds: 100,
      runCompilation,
      worker: double.port,
      workerId: "c10-test-worker",
    });

    await expect(runner.processNext()).resolves.toBe("processed");
    expect(double.loadSource).toHaveBeenCalledOnce();
    expect(double.publish).toHaveBeenCalledOnce();
    expect(double.fail).not.toHaveBeenCalled();
    expect(double.heartbeat.mock.calls.map(([command]) => command.stage)).toEqual([
      "leased",
      "compiling",
      "publishing",
    ]);
    expect(double.publish.mock.calls[0]?.[0]).toMatchObject({
      attempt: 1,
      jobId: lease.jobId,
      leaseToken: lease.leaseToken,
      workerId: "c10-test-worker",
    });
  });

  it("records a bounded retryable failure while the lease is current", async () => {
    const double = worker();
    const runner = new SceneCompilationRunner({
      logger: logger(),
      pollMilliseconds: 100,
      runCompilation: vi.fn().mockResolvedValue({
        safeCode: "SCENE_COMPILATION_FAILED",
        status: "failed",
      }),
      worker: double.port,
      workerId: "c10-test-worker",
    });
    await runner.processNext();
    expect(double.fail).toHaveBeenCalledWith(
      expect.objectContaining({ retryable: true, safeCode: "SCENE_COMPILATION_FAILED" }),
    );
  });

  it("fails a current attempt when publication is rejected for a non-fencing reason", async () => {
    const publicationError = Object.assign(new Error("invalid publication"), {
      code: "SCENE_MANIFEST_SCOPE_MISMATCH",
    });
    const double = worker({ publishError: publicationError });
    const warn = vi.fn<SafeLogger["warn"]>();
    const testLogger = { ...logger(), warn };
    const runner = new SceneCompilationRunner({
      logger: testLogger,
      pollMilliseconds: 100,
      runCompilation: async (task, ports) => {
        const publication = await ports.publisher.publishIfCurrent(
          {
            artifact,
            attempt: task.attempt,
            contentAddress: {
              glbSha256: artifact.glbSha256,
              manifestSha256: artifact.manifestSha256,
            },
            glb: new Uint8Array(20),
            jobId: task.jobId,
            manifest,
            manifestBytes: new Uint8Array(),
            publicationFence: task.publicationFence,
          },
          new AbortController().signal,
        );
        return publication === "published"
          ? { artifact, manifest, status: "published" }
          : { safeCode: "SCENE_COMPILATION_STALE", status: "stale" };
      },
      worker: double.port,
      workerId: "c10-test-worker",
    });

    await runner.processNext();
    expect(double.fail).toHaveBeenCalledWith(
      expect.objectContaining({ retryable: true, safeCode: "SCENE_COMPILATION_FAILED" }),
    );
    expect(warn).toHaveBeenCalledWith(
      "scene.publication-rejected",
      expect.objectContaining({ safeCode: "SCENE_MANIFEST_SCOPE_MISMATCH" }),
    );
  });

  it("acknowledges a cancellation without publishing or failing", async () => {
    const cancellation = Object.assign(new Error("cancelled"), {
      code: "SCENE_CANCELLATION_REQUESTED",
    });
    const double = worker({ heartbeatError: cancellation });
    const runner = new SceneCompilationRunner({
      logger: logger(),
      pollMilliseconds: 100,
      runCompilation: async (task, ports) => {
        expect(await ports.workState.check(task, new AbortController().signal)).toBe("cancelled");
        return { safeCode: "SCENE_COMPILATION_CANCELLED", status: "cancelled" };
      },
      worker: double.port,
      workerId: "c10-test-worker",
    });
    await runner.processNext();
    expect(double.acknowledgeCancellation).toHaveBeenCalledOnce();
    expect(double.publish).not.toHaveBeenCalled();
    expect(double.fail).not.toHaveBeenCalled();
  });
});
