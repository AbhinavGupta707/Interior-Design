import { describe, expect, it } from "vitest";

import { RoomPlanProcessingRunner } from "../../src/roomplan/runner.js";
import type { ObjectStorage } from "../../src/storage.js";
import type {
  LeasedRoomPlanCapture,
  RoomPlanProcessingFailureCode,
  RoomPlanProcessingQueue,
} from "../../src/roomplan/types.js";
import { syntheticJob, syntheticSources } from "./fixtures.js";

class MemoryQueue implements RoomPlanProcessingQueue {
  readonly job: LeasedRoomPlanCapture | undefined;
  heartbeatState: "cancel-requested" | "leased" | "lost" = "leased";
  published: unknown[] = [];
  failures: Array<{ code: RoomPlanProcessingFailureCode; retryable: boolean }> = [];
  cancellations = 0;
  heartbeatCalls = 0;

  constructor(job?: LeasedRoomPlanCapture) {
    this.job = job;
  }

  claimNext(): Promise<LeasedRoomPlanCapture | undefined> {
    return Promise.resolve(this.job);
  }

  heartbeat(): Promise<"cancel-requested" | "leased" | "lost"> {
    this.heartbeatCalls += 1;
    return Promise.resolve(this.heartbeatState);
  }

  publish(_job: LeasedRoomPlanCapture, _workerId: string, result: unknown): Promise<boolean> {
    if (this.heartbeatState !== "leased") return Promise.resolve(false);
    this.published.push(result);
    return Promise.resolve(true);
  }

  fail(
    _job: LeasedRoomPlanCapture,
    _workerId: string,
    code: RoomPlanProcessingFailureCode,
    retryable: boolean,
  ): Promise<boolean> {
    this.failures.push({ code, retryable });
    return Promise.resolve(true);
  }

  acknowledgeCancellation(): Promise<boolean> {
    this.cancellations += 1;
    return Promise.resolve(true);
  }
}

class MemoryStorage implements ObjectStorage {
  readonly objects: ReadonlyMap<string, Uint8Array>;
  readonly failure: Error | undefined;

  constructor(objects: ReadonlyMap<string, Uint8Array>, failure?: Error) {
    this.objects = objects;
    this.failure = failure;
  }

  openSource(_bucket: "source", key: string): Promise<AsyncIterable<Uint8Array>> {
    if (this.failure !== undefined) return Promise.reject(this.failure);
    const bytes = this.objects.get(key);
    if (bytes === undefined) return Promise.reject(new Error("Synthetic object is absent."));
    return Promise.resolve(
      (async function* stream() {
        await Promise.resolve();
        yield bytes;
      })(),
    );
  }

  putDerivedIfAbsent(): Promise<"created"> {
    return Promise.resolve("created");
  }
}

class DelayedMemoryStorage extends MemoryStorage {
  override async openSource(bucket: "source", key: string): Promise<AsyncIterable<Uint8Array>> {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return super.openSource(bucket, key);
  }
}

const logger = { error() {}, info() {}, warn() {} };

function runner(queue: MemoryQueue, storage: ObjectStorage): RoomPlanProcessingRunner {
  return new RoomPlanProcessingRunner({
    clock: { now: () => new Date("2026-01-01T12:02:00.000Z") },
    heartbeatMilliseconds: 1_000,
    leaseMilliseconds: 10_000,
    logger,
    pollMilliseconds: 1,
    queue,
    storage,
    workerId: "synthetic-worker",
  });
}

describe("RoomPlanProcessingRunner", () => {
  it("publishes one immutable proposal after source verification and lease revalidation", async () => {
    const sources = syntheticSources();
    const queue = new MemoryQueue(syntheticJob());
    await expect(runner(queue, new MemoryStorage(sources.bytesByKey)).processNext()).resolves.toBe(
      "processed",
    );
    expect(queue.published).toHaveLength(1);
    expect(queue.published[0]).toMatchObject({ status: "proposal" });
    expect(queue.failures).toEqual([]);
  });

  it("honours cancellation fencing before publication", async () => {
    const sources = syntheticSources();
    const queue = new MemoryQueue(syntheticJob());
    queue.heartbeatState = "cancel-requested";
    await runner(queue, new MemoryStorage(sources.bytesByKey)).processNext();
    expect(queue.published).toEqual([]);
    expect(queue.cancellations).toBe(1);
  });

  it("turns immutable source mismatches into an explicit abstention", async () => {
    const sources = syntheticSources();
    const normalized = sources.artifacts.find(({ kind }) => kind === "roomplan-normalized-json");
    if (normalized === undefined) throw new Error("Synthetic normalized artifact absent.");
    const corrupt = new Map(sources.bytesByKey).set(
      normalized.objectKey,
      Buffer.from("{}", "utf8"),
    );
    const queue = new MemoryQueue(syntheticJob());
    await runner(queue, new MemoryStorage(corrupt)).processNext();
    expect(queue.published).toHaveLength(1);
    expect(queue.published[0]).toMatchObject({ code: "source-mismatch", status: "abstained" });
    expect(queue.failures).toEqual([]);
  });

  it("records retryable storage unavailability without publishing", async () => {
    const sources = syntheticSources();
    const queue = new MemoryQueue(syntheticJob());
    await runner(
      queue,
      new MemoryStorage(sources.bytesByKey, new Error("synthetic storage outage")),
    ).processNext();
    expect(queue.published).toEqual([]);
    expect(queue.failures).toEqual([{ code: "storage-unavailable", retryable: true }]);
  });

  it("renews a lease by elapsed time while a slow source read is still active", async () => {
    const sources = syntheticSources();
    const queue = new MemoryQueue(syntheticJob());
    const processing = new RoomPlanProcessingRunner({
      heartbeatMilliseconds: 5,
      leaseMilliseconds: 100,
      logger,
      pollMilliseconds: 1,
      queue,
      storage: new DelayedMemoryStorage(sources.bytesByKey),
      workerId: "synthetic-worker",
    });
    await expect(processing.processNext()).resolves.toBe("processed");
    expect(queue.heartbeatCalls).toBeGreaterThan(1);
    expect(queue.published).toHaveLength(1);
  });

  it("reports idle when no durable attempt is available", async () => {
    const sources = syntheticSources();
    await expect(
      runner(new MemoryQueue(), new MemoryStorage(sources.bytesByKey)).processNext(),
    ).resolves.toBe("idle");
  });

  it("rejects lease settings that cannot heartbeat safely", () => {
    const sources = syntheticSources();
    expect(
      () =>
        new RoomPlanProcessingRunner({
          heartbeatMilliseconds: 5_000,
          leaseMilliseconds: 10_000,
          logger,
          pollMilliseconds: 1,
          queue: new MemoryQueue(),
          storage: new MemoryStorage(sources.bytesByKey),
          workerId: "synthetic-worker",
        }),
    ).toThrow(/heartbeat/u);
  });
});
