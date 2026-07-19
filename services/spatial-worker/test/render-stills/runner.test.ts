import {
  RendererBoundaryError,
  type ValidatedRenderBundle,
} from "@interior-design/blender-renderer";
import type { LeasedRenderJob } from "@interior-design/platform-api/render-stills";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { RenderStillRunner } from "../../src/render-stills/runner.js";
import type {
  GeometrySafeRendererPort,
  RenderStillControlPort,
} from "../../src/render-stills/types.js";

const hash = (character: string) => character.repeat(64);
const sourceBytes = Buffer.from("protected-fixture-glb");
const glbDigest = createHash("sha256").update(sourceBytes).digest("hex");
const ids = {
  artifact: "14000000-0000-4000-8000-000000000001",
  camera: "14000000-0000-4000-8000-000000000002",
  job: "14000000-0000-4000-8000-000000000003",
  project: "14000000-0000-4000-8000-000000000004",
  result: "14000000-0000-4000-8000-000000000005",
  scene: "14000000-0000-4000-8000-000000000006",
  sceneJob: "14000000-0000-4000-8000-000000000007",
  tenant: "14000000-0000-4000-8000-000000000008",
};

const lease: LeasedRenderJob = {
  attempt: 1,
  cacheIdentitySha256: hash("f"),
  estimatedJobBytes: 1024,
  jobId: ids.job,
  leaseExpiresAt: "2026-07-19T00:05:00.000Z",
  leaseToken: "14000000-0000-4000-8000-000000000009",
  projectId: ids.project,
  request: {
    cameraId: ids.camera,
    enhancement: "disabled",
    label: "Fixture render",
    lightingPresetId: "canonical-lights-neutral-world-v1",
    profileId: "cycles-cpu-geometry-safe-v1",
    sourceSceneJobId: ids.sceneJob,
  },
  requiredCapability: "cycles.cpu.v1",
  resultId: ids.result,
  source: {
    projectId: ids.project,
    sceneArtifactId: ids.artifact,
    sceneGlbSha256: glbDigest,
    sceneId: ids.scene,
    sceneJobId: ids.sceneJob,
    sceneManifestSha256: hash("b"),
    sourceSnapshotSha256: hash("c"),
  },
  stage: "preparing",
  tenantId: ids.tenant,
  volumeId: "fixture-volume",
};

function control(overrides: Partial<RenderStillControlPort> = {}) {
  const value: RenderStillControlPort = {
    acknowledgeCancellation: vi.fn(() => Promise.resolve()),
    claimNext: vi.fn(() => Promise.resolve(lease)),
    fail: vi.fn(() => Promise.resolve({}) as never),
    heartbeat: vi.fn(() => Promise.resolve({}) as never),
    publish: vi.fn(() => Promise.resolve({}) as never),
    ...overrides,
  };
  return value;
}

const source = {
  glbBytes: sourceBytes,
  glbSha256: glbDigest,
  source: lease.source,
};
const scene = {
  manifest: { source: lease.source } as never,
  manifestBytes: Buffer.from("fixture-render-scene"),
  manifestSha256: "",
};
scene.manifestSha256 = createHash("sha256").update(scene.manifestBytes).digest("hex");

const bundle = {
  artifactBytes: new Map(),
  artifacts: [],
  manifest: { resultId: ids.result, source: lease.source } as never,
  manifestBytes: Buffer.from("output-manifest"),
  manifestSha256: hash("e"),
} satisfies ValidatedRenderBundle;

function runner(
  input: {
    readonly control?: RenderStillControlPort;
    readonly renderer?: GeometrySafeRendererPort;
  } = {},
) {
  return new RenderStillRunner({
    capabilities: ["cycles.cpu.v1"],
    control: input.control ?? control(),
    disk: { freeBytes: () => Promise.resolve(100 * 1024 ** 3) },
    heartbeatMilliseconds: 5,
    leaseSeconds: 60,
    renderer: input.renderer ?? { render: () => Promise.resolve(bundle) },
    sceneBuilder: { build: () => Promise.resolve(scene) },
    source: {
      load: () => Promise.resolve({ ...source, glbSha256: lease.source.sceneGlbSha256 }),
    },
    volumeId: "fixture-volume",
    volumePath: "/tmp",
    workerId: "fixture-render-worker",
  });
}

describe("C14 spatial render orchestration", () => {
  it("rechecks disk at each stage and publishes only after validation", async () => {
    const c = control();
    await expect(runner({ control: c }).runOnce()).resolves.toBe("processed");
    expect(c.heartbeat).toHaveBeenCalledTimes(4);
    expect(vi.mocked(c.heartbeat).mock.calls.map(([command]) => command.stage)).toEqual([
      "preparing",
      "rendering-safe",
      "validating-safe",
      "publishing-safe",
    ]);
    expect(c.publish).toHaveBeenCalledOnce();
    expect(c.fail).not.toHaveBeenCalled();
  });

  it("turns a bounded renderer timeout into a retryable terminal failure", async () => {
    const c = control();
    await runner({
      control: c,
      renderer: {
        render: () => Promise.reject(new RendererBoundaryError("RENDER_PROCESS_TIMEOUT")),
      },
    }).runOnce();
    expect(c.fail).toHaveBeenCalledWith(
      expect.objectContaining({ retryable: true, safeCode: "RENDER_PROCESS_TIMEOUT" }),
    );
    expect(c.publish).not.toHaveBeenCalled();
  });

  it("aborts renderer work and acknowledges a fenced cancellation", async () => {
    let renderingHeartbeats = 0;
    const c = control({
      heartbeat: vi.fn((command: Parameters<RenderStillControlPort["heartbeat"]>[0]) => {
        if (command.stage === "rendering-safe" && ++renderingHeartbeats > 1) {
          return Promise.reject(
            Object.assign(new Error("cancelled"), { code: "RENDER_CANCELLATION_REQUESTED" }),
          );
        }
        return Promise.resolve({}) as never;
      }),
    });
    await runner({
      control: c,
      renderer: {
        render: async (_input: unknown, signal?: AbortSignal) =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener(
              "abort",
              () => {
                reject(new RendererBoundaryError("RENDER_PROCESS_CANCELLED"));
              },
              { once: true },
            );
          }),
      },
    }).runOnce();
    expect(c.acknowledgeCancellation).toHaveBeenCalledOnce();
    expect(c.publish).not.toHaveBeenCalled();
  });

  it("emits only bounded lifecycle fields to the structured logger", async () => {
    const events: Readonly<Record<string, boolean | number | string>>[] = [];
    const c = control();
    const instance = new RenderStillRunner({
      capabilities: ["cycles.cpu.v1"],
      control: c,
      disk: { freeBytes: () => Promise.resolve(100 * 1024 ** 3) },
      logger: {
        info: (event) => {
          events.push(event);
        },
        warn: (event) => {
          events.push(event);
        },
      },
      renderer: { render: () => Promise.resolve(bundle) },
      sceneBuilder: { build: () => Promise.resolve(scene) },
      source: {
        load: () => Promise.resolve({ ...source, glbSha256: lease.source.sceneGlbSha256 }),
      },
      volumeId: "fixture-volume",
      volumePath: "/tmp",
      workerId: "fixture-render-worker",
    });
    await instance.runOnce();
    expect(JSON.stringify(events)).not.toContain(ids.job);
    expect(JSON.stringify(events)).not.toContain(lease.leaseToken);
    expect(
      events.every((event) =>
        Object.keys(event).every((key) => ["event", "safeCode", "stage"].includes(key)),
      ),
    ).toBe(true);
  });
});
