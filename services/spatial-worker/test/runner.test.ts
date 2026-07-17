import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";

import { createJsonLogger } from "../src/logger.js";
import { MediaProcessor, type PreparedProcessing } from "../src/processor.js";
import { SpatialWorkerRunner, type JobProcessor } from "../src/runner.js";
import {
  commandFor,
  jpegFixture,
  MemoryJobRepository,
  MemoryObjectStorage,
  testConfig,
} from "./support.js";

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "c2-runner-test-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

function quietLogger(): ReturnType<typeof createJsonLogger> {
  return createJsonLogger({
    write: () => true,
  });
}

describe("durable runner behavior", () => {
  it("retries idempotently after a partial derived write without overwriting", async () => {
    const contents = await jpegFixture();
    const command = commandFor(contents);
    const storage = new MemoryObjectStorage();
    storage.sources.set(command.source.key, contents);
    const immutableSource = Buffer.from(contents);
    storage.failNextDerivedWrite = true;
    const config = testConfig(await temporaryRoot());
    const jobs = new MemoryJobRepository(command);
    const processor = new MediaProcessor(config, storage);
    const runner = new SpatialWorkerRunner({
      config,
      jobs,
      logger: quietLogger(),
      processor,
      storage,
    });

    await expect(runner.runOne()).resolves.toEqual({ claimed: true, outcome: "retrying" });
    await expect(runner.runOne()).resolves.toEqual({ claimed: true, outcome: "completed" });
    expect(jobs.attempt).toBe(2);
    expect(jobs.completed).toHaveLength(1);
    expect(jobs.completed[0]?.status).toBe("ready");
    expect(storage.derived.size).toBe(3);
    expect(storage.sources.get(command.source.key)).toEqual(immutableSource);
    expect(jobs.retried).toEqual(["processing-unavailable"]);
  });

  it("abandons side effects when an expired lease cannot be renewed", async () => {
    const contents = await jpegFixture();
    const command = commandFor(contents);
    const storage = new MemoryObjectStorage();
    const jobs = new MemoryJobRepository(command);
    jobs.leaseRenewalSucceeds = false;
    const baseConfig = testConfig(await temporaryRoot());
    const config = { ...baseConfig, heartbeatMs: 5, leaseMs: 20 };
    let cleaned = false;
    const prepared: PreparedProcessing = {
      cleanup: () => {
        cleaned = true;
        return Promise.resolve();
      },
      result: {
        artifacts: [],
        assetId: command.assetId,
        detectedMimeType: "image/jpeg",
        projectId: command.projectId,
        provenance: {
          executedAt: "2026-07-17T10:00:00.000Z",
          policyVersion: "c2-ingest-v1",
          tools: [{ name: "synthetic", version: "1" }],
        },
        rejectionCode: "processing-failed",
        status: "rejected",
        technicalMetadata: {},
        verifiedSource: {
          byteSize: command.expected.byteSize,
          sha256: command.expected.sha256,
        },
        version: "c2-ingest-v1",
      },
      writes: [],
    };
    const processor: JobProcessor = {
      process: async () => {
        await delay(15);
        return prepared;
      },
    };
    const runner = new SpatialWorkerRunner({
      config,
      jobs,
      logger: quietLogger(),
      processor,
      storage,
    });

    await expect(runner.runOne()).resolves.toEqual({ claimed: true, outcome: "lease-lost" });
    expect(jobs.completed).toHaveLength(0);
    expect(jobs.retried).toHaveLength(0);
    expect(storage.derived.size).toBe(0);
    expect(cleaned).toBe(true);

    jobs.leaseRenewalSucceeds = true;
    jobs.available = true;
    await expect(runner.runOne()).resolves.toEqual({ claimed: true, outcome: "completed" });
    expect(jobs.attempt).toBe(2);
    expect(jobs.completed).toHaveLength(1);
  });

  it("records exhausted retry state without fabricating a verified result", async () => {
    const contents = await jpegFixture();
    const command = commandFor(contents);
    const storage = new MemoryObjectStorage();
    const jobs = new MemoryJobRepository(command);
    jobs.retryOutcome = "exhausted";
    const config = testConfig(await temporaryRoot());
    const processor: JobProcessor = {
      process: () => Promise.reject(new Error("synthetic pre-verification failure")),
    };
    const runner = new SpatialWorkerRunner({
      config,
      jobs,
      logger: quietLogger(),
      processor,
      storage,
    });

    await expect(runner.runOne()).resolves.toEqual({ claimed: true, outcome: "exhausted" });
    expect(jobs.completed).toHaveLength(0);
    expect(jobs.retried).toEqual(["processing-unavailable"]);
  });
});
