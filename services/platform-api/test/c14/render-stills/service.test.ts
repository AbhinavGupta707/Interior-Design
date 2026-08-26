import { describe, expect, it, vi } from "vitest";

import {
  RenderStillService,
  RenderStillWorkerService,
} from "../../../src/modules/render-stills/service.js";
import type { RenderObjectStorage } from "../../../src/modules/render-stills/types.js";
import { ids, queuedJob, request, safeBundle, source, StubRenderRepository } from "./support.js";

const actor = {
  displayName: "C14 fixture owner",
  role: "owner" as const,
  subject: "fixture|c14-owner",
  tenantId: ids.tenant,
  userId: ids.user,
};
const correlation = {
  requestId: "request-c14",
  spanId: "2".repeat(16),
  traceId: "1".repeat(32),
  traceParent: `00-${"1".repeat(32)}-${"2".repeat(16)}-00`,
};
const capabilities = {
  acceptingNewJobs: true,
  enhancementProvider: "disabled" as const,
  hardwareEvidence: "deferred" as const,
  profiles: [
    {
      available: true,
      capability: "cycles.cpu.v1",
      profileId: "cycles-cpu-geometry-safe-v1" as const,
      reason: "Inert fixture only",
    },
  ],
};

function storage(overrides: Partial<RenderObjectStorage> = {}): RenderObjectStorage {
  return {
    putImmutable: (input) =>
      Promise.resolve({
        objectKey: `render-stills/sha256/${input.sha256.slice(0, 2)}/${input.sha256}.${input.mediaType === "image/png" ? "png" : "exr"}`,
      }),
    readiness: () => Promise.resolve(),
    signExactAccess: () =>
      Promise.resolve({
        expiresAt: "2026-07-19T00:05:00.000Z",
        url: "http://127.0.0.1:43110/render-artifact-access/opaque",
      }),
    ...overrides,
  };
}

describe("C14 render service", () => {
  it("creates from selected IDs while persisting only server-resolved pins", async () => {
    const repository = new StubRenderRepository();
    const service = new RenderStillService({
      capabilities,
      repository,
      resolver: {
        listEligibleSources: () =>
          Promise.resolve({
            projectId: ids.project,
            schemaVersion: "c14-render-eligible-sources-v1",
            sources: [],
          }),
        resolveForNewJob: () =>
          Promise.resolve({
            cacheSourceIdentitySha256: "4".repeat(64),
            estimatedJobBytes: 1024,
            requiredCapability: "cycles.cpu.v1",
            source,
          }),
        revalidatePinnedSource: () => Promise.resolve(true),
      },
      storage: storage(),
    });
    await service.createJob({
      actor,
      correlation,
      idempotencyKey: "render-key-0001",
      projectId: ids.project,
      request,
    });
    expect(repository.createdCommand?.resolved.source).toEqual(source);
    expect(repository.createdCommand?.request).not.toHaveProperty("sceneGlbSha256");
  });

  it("publishes all content-addressed objects before the one visible transaction", async () => {
    const repository = new StubRenderRepository();
    repository.job = queuedJob({
      state: "publishing-safe",
      updatedAt: "2026-07-19T00:00:01.000Z",
      version: 2,
    });
    const order: string[] = [];
    vi.spyOn(repository, "publishResult").mockImplementation(() => {
      order.push("transaction");
      repository.published = true;
      if (repository.job === undefined) throw new Error("Fixture job disappeared.");
      return Promise.resolve(repository.job);
    });
    const objectStorage = storage({
      putImmutable: (input) => {
        order.push(input.role);
        return Promise.resolve({
          objectKey: `render-stills/sha256/${input.sha256.slice(0, 2)}/${input.sha256}.${input.mediaType === "image/png" ? "png" : "exr"}`,
        });
      },
    });
    const worker = new RenderStillWorkerService({
      repository,
      resolver: {
        listEligibleSources: () =>
          Promise.resolve({
            projectId: ids.project,
            schemaVersion: "c14-render-eligible-sources-v1",
            sources: [],
          }),
        resolveForNewJob: () => Promise.resolve(undefined),
        revalidatePinnedSource: () => Promise.resolve(true),
      },
      storage: objectStorage,
    });
    const bundle = safeBundle();
    await worker.publish({
      ...bundle,
      attempt: 1,
      jobId: ids.job,
      leaseToken: "14000000-0000-4000-8000-000000000099",
      projectId: ids.project,
      resultId: ids.result,
      tenantId: ids.tenant,
      workerId: "fixture-worker",
    });
    expect(order.at(-1)).toBe("transaction");
    expect(order).toHaveLength(6);
  });

  it("leaves partial object uploads invisible when publication fails early", async () => {
    const repository = new StubRenderRepository();
    repository.job = queuedJob({
      state: "publishing-safe",
      updatedAt: "2026-07-19T00:00:01.000Z",
      version: 2,
    });
    let puts = 0;
    const worker = new RenderStillWorkerService({
      repository,
      resolver: {
        listEligibleSources: () =>
          Promise.resolve({
            projectId: ids.project,
            schemaVersion: "c14-render-eligible-sources-v1",
            sources: [],
          }),
        resolveForNewJob: () => Promise.resolve(undefined),
        revalidatePinnedSource: () => Promise.resolve(true),
      },
      storage: storage({
        putImmutable: () => {
          puts += 1;
          if (puts === 3) throw new Error("fixture outage");
          return Promise.resolve({
            objectKey: "render-stills/sha256/aa/" + "a".repeat(64) + ".png",
          });
        },
      }),
    });
    await expect(
      worker.publish({
        ...safeBundle(),
        attempt: 1,
        jobId: ids.job,
        leaseToken: "14000000-0000-4000-8000-000000000099",
        projectId: ids.project,
        resultId: ids.result,
        tenantId: ids.tenant,
        workerId: "fixture-worker",
      }),
    ).rejects.toThrow("fixture outage");
    expect(repository.published).toBe(false);
  });

  it("rejects corrupt artifact bytes before object publication", async () => {
    const repository = new StubRenderRepository();
    repository.job = queuedJob({
      state: "publishing-safe",
      updatedAt: "2026-07-19T00:00:01.000Z",
      version: 2,
    });
    const bundle = safeBundle();
    bundle.artifactBytes.set("geometry-safe-png", Buffer.from("corrupt"));
    const put = vi.fn();
    const worker = new RenderStillWorkerService({
      repository,
      resolver: {
        listEligibleSources: () =>
          Promise.resolve({
            projectId: ids.project,
            schemaVersion: "c14-render-eligible-sources-v1",
            sources: [],
          }),
        resolveForNewJob: () => Promise.resolve(undefined),
        revalidatePinnedSource: () => Promise.resolve(true),
      },
      storage: storage({ putImmutable: put }),
    });
    await expect(
      worker.publish({
        ...bundle,
        attempt: 1,
        jobId: ids.job,
        leaseToken: "14000000-0000-4000-8000-000000000099",
        projectId: ids.project,
        resultId: ids.result,
        tenantId: ids.tenant,
        workerId: "fixture-worker",
      }),
    ).rejects.toMatchObject({ code: "RENDER_ARTIFACT_HASH_MISMATCH" });
    expect(put).not.toHaveBeenCalled();
  });
});
