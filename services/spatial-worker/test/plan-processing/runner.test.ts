import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import { PlanNormalizer } from "../../src/plan-processing/normalizer.js";
import { LocalPlanParserFake } from "../../src/plan-processing/parser.js";
import { PlanProcessingRunner } from "../../src/plan-processing/runner.js";
import type {
  LeasedPlanProcessingJob,
  PlanProcessingQueue,
} from "../../src/plan-processing/types.js";
import type { DerivedWrite, ObjectStorage } from "../../src/storage.js";

const roots: string[] = [];

async function root(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "c6-runner-test-"));
  roots.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

class FixtureStorage implements ObjectStorage {
  readonly #bytes: Buffer;

  constructor(bytes: Buffer) {
    this.#bytes = bytes;
  }

  openSource(): Promise<AsyncIterable<Uint8Array>> {
    return Promise.resolve(Readable.from([this.#bytes]));
  }

  putDerivedIfAbsent(write: DerivedWrite): Promise<"created" | "existing"> {
    void write;
    return Promise.resolve("created");
  }
}

class FixtureQueue implements PlanProcessingQueue {
  readonly job: LeasedPlanProcessingJob;
  readonly heartbeats: ("cancel-requested" | "leased" | "lost")[];
  cancellationAcknowledged = false;
  failed = false;
  failedCode?: string;
  publishedStatus?: string;
  #claimed = false;

  constructor(
    job: LeasedPlanProcessingJob,
    heartbeats: ("cancel-requested" | "leased" | "lost")[] = ["leased", "leased"],
  ) {
    this.job = job;
    this.heartbeats = [...heartbeats];
  }

  claimNext(): Promise<LeasedPlanProcessingJob | undefined> {
    if (this.#claimed) return Promise.resolve(undefined);
    this.#claimed = true;
    return Promise.resolve(this.job);
  }

  heartbeat(): Promise<"cancel-requested" | "leased" | "lost"> {
    return Promise.resolve(this.heartbeats.shift() ?? "lost");
  }

  acknowledgeCancellation(): Promise<boolean> {
    this.cancellationAcknowledged = true;
    return Promise.resolve(true);
  }

  fail(_job: LeasedPlanProcessingJob, _workerId: string, code: string): Promise<boolean> {
    this.failed = true;
    this.failedCode = code;
    return Promise.resolve(true);
  }

  publish(
    _job: LeasedPlanProcessingJob,
    _workerId: string,
    result: { readonly status: string },
  ): Promise<boolean> {
    this.publishedStatus = result.status;
    return Promise.resolve(true);
  }
}

const logger = {
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
};

describe("C6 durable runner boundary", () => {
  it("streams the exact source into an isolated workspace and publishes only through a fenced lease", async () => {
    const bytes = Buffer.from("deterministic fixture plan", "utf8");
    const job: LeasedPlanProcessingJob = {
      assetId: "91000000-0000-4000-8000-000000000001",
      attempt: 1,
      detectedMimeType: "image/svg+xml",
      jobId: "91000000-0000-4000-8000-000000000002",
      leaseExpiresAt: "2026-07-17T12:01:00.000Z",
      leaseToken: "91000000-0000-4000-8000-000000000003",
      pageIndex: 0,
      parserPreference: "fixture",
      projectId: "91000000-0000-4000-8000-000000000004",
      rights: {
        basis: "owned-by-user",
        serviceProcessingConsent: true,
        trainingUseConsent: "denied",
      },
      sourceByteSize: bytes.byteLength,
      sourceObjectKey: "sources/91000000-0000-4000-8000-000000000005",
      sourceSha256: createHash("sha256").update(bytes).digest("hex"),
      tenantId: "91000000-0000-4000-8000-000000000006",
    };
    const queue = new FixtureQueue(job);
    const runner = new PlanProcessingRunner({
      heartbeatMilliseconds: 1000,
      leaseMilliseconds: 10_000,
      logger,
      normalizer: new PlanNormalizer({
        pdfInfo: "unused",
        pdfToCairo: "unused",
        pdfToPpm: "unused",
        popplerVersion: "unused",
      }),
      parser: new LocalPlanParserFake(() => new Date("2026-07-17T12:00:00.000Z")),
      pollMilliseconds: 100,
      queue,
      storage: new FixtureStorage(bytes),
      temporaryMaximumBytes: 30_000_000,
      temporaryRoot: await root(),
      workerId: "fixture-worker:c6",
    });
    expect(await runner.processNext()).toBe("processed");
    expect(queue.publishedStatus).toBe("proposal");
    expect(queue.failed).toBe(false);
  });

  it("lets cancellation win before parser publication", async () => {
    const bytes = Buffer.from("cancelled fixture plan", "utf8");
    const job: LeasedPlanProcessingJob = {
      assetId: "92000000-0000-4000-8000-000000000001",
      attempt: 1,
      detectedMimeType: "image/svg+xml",
      jobId: "92000000-0000-4000-8000-000000000002",
      leaseExpiresAt: "2026-07-17T12:01:00.000Z",
      leaseToken: "92000000-0000-4000-8000-000000000003",
      pageIndex: 0,
      parserPreference: "fixture",
      projectId: "92000000-0000-4000-8000-000000000004",
      rights: {
        basis: "owned-by-user",
        serviceProcessingConsent: true,
        trainingUseConsent: "denied",
      },
      sourceByteSize: bytes.byteLength,
      sourceObjectKey: "sources/92000000-0000-4000-8000-000000000005",
      sourceSha256: createHash("sha256").update(bytes).digest("hex"),
      tenantId: "92000000-0000-4000-8000-000000000006",
    };
    const queue = new FixtureQueue(job, ["cancel-requested"]);
    const runner = new PlanProcessingRunner({
      heartbeatMilliseconds: 1000,
      leaseMilliseconds: 10_000,
      logger,
      normalizer: new PlanNormalizer({
        pdfInfo: "unused",
        pdfToCairo: "unused",
        pdfToPpm: "unused",
        popplerVersion: "unused",
      }),
      parser: new LocalPlanParserFake(),
      pollMilliseconds: 100,
      queue,
      storage: new FixtureStorage(bytes),
      temporaryMaximumBytes: 30_000_000,
      temporaryRoot: await root(),
      workerId: "fixture-worker:c6",
    });
    await runner.processNext();
    expect(queue.cancellationAcknowledged).toBe(true);
    expect(queue.publishedStatus).toBeUndefined();
  });

  it("stops an oversized or fingerprint-mismatched source stream before normalization", async () => {
    const expected = Buffer.from("expected fixture plan", "utf8");
    const actual = Buffer.concat([expected, Buffer.from("-unexpected-tail", "utf8")]);
    const job: LeasedPlanProcessingJob = {
      assetId: "93000000-0000-4000-8000-000000000001",
      attempt: 1,
      detectedMimeType: "image/svg+xml",
      jobId: "93000000-0000-4000-8000-000000000002",
      leaseExpiresAt: "2026-07-17T12:01:00.000Z",
      leaseToken: "93000000-0000-4000-8000-000000000003",
      pageIndex: 0,
      parserPreference: "fixture",
      projectId: "93000000-0000-4000-8000-000000000004",
      rights: {
        basis: "owned-by-user",
        serviceProcessingConsent: true,
        trainingUseConsent: "denied",
      },
      sourceByteSize: expected.byteLength,
      sourceObjectKey: "sources/93000000-0000-4000-8000-000000000005",
      sourceSha256: createHash("sha256").update(expected).digest("hex"),
      tenantId: "93000000-0000-4000-8000-000000000006",
    };
    const queue = new FixtureQueue(job);
    const runner = new PlanProcessingRunner({
      heartbeatMilliseconds: 1000,
      leaseMilliseconds: 10_000,
      logger,
      normalizer: new PlanNormalizer({
        pdfInfo: "unused",
        pdfToCairo: "unused",
        pdfToPpm: "unused",
        popplerVersion: "unused",
      }),
      parser: new LocalPlanParserFake(),
      pollMilliseconds: 100,
      queue,
      storage: new FixtureStorage(actual),
      temporaryMaximumBytes: 30_000_000,
      temporaryRoot: await root(),
      workerId: "fixture-worker:c6",
    });
    await runner.processNext();
    expect(queue.failedCode).toBe("source-mismatch");
    expect(queue.publishedStatus).toBeUndefined();
  });
});
