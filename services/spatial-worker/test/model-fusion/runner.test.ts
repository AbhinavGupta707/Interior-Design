import type { FusionProposal, FusionRegistrationResult } from "@interior-design/contracts";
import { describe, expect, it } from "vitest";

import { canonicalSnapshotSha256 } from "../../src/model-fusion/canonical.js";
import {
  BoundedFusionProducerProtocol,
  UnavailableRegistrationProducer,
  UnavailableSemanticProducer,
} from "../../src/model-fusion/protocol.js";
import { FusionProcessingRunner } from "../../src/model-fusion/runner.js";
import {
  FusionWorkerError,
  type FusionProcessingQueue,
  type LeasedFusionAttempt,
} from "../../src/model-fusion/types.js";
import { fusionWorkerFixture } from "./support.js";

class MemoryQueue implements FusionProcessingQueue {
  acknowledgements = 0;
  advances: string[] = [];
  claimed = false;
  failFence = false;
  failures: Array<{ readonly retryable: boolean; readonly safeCode: string }> = [];
  publishFence = false;
  published: FusionProposal[] = [];

  constructor(readonly lease: LeasedFusionAttempt) {}

  claim(): Promise<LeasedFusionAttempt | undefined> {
    if (this.claimed) return Promise.resolve(undefined);
    this.claimed = true;
    return Promise.resolve(this.lease);
  }

  advance(command: Parameters<FusionProcessingQueue["advance"]>[0]): Promise<void> {
    this.advances.push(command.stage);
    return Promise.resolve();
  }

  publish(command: Parameters<FusionProcessingQueue["publish"]>[0]): Promise<void> {
    if (this.publishFence) return Promise.reject(new Error("synthetic-publication-fence"));
    this.published.push(command.proposal);
    return Promise.resolve();
  }

  fail(command: Parameters<FusionProcessingQueue["fail"]>[0]): Promise<void> {
    if (this.failFence) return Promise.reject(new Error("synthetic-failure-fence"));
    this.failures.push({ retryable: command.retryable, safeCode: command.safeCode });
    return Promise.resolve();
  }

  acknowledgeCancellation(): Promise<void> {
    this.acknowledgements += 1;
    return Promise.resolve();
  }

  heartbeat(): Promise<"active"> {
    return Promise.resolve("active");
  }
}

const logger = {
  debug() {},
  error() {},
  info() {},
  warn() {},
};

function registrations(lease: LeasedFusionAttempt): readonly FusionRegistrationResult[] {
  return lease.request.sources.map((source, index) => ({
    confidenceBasisPoints: 8_500,
    connectedComponentId: "ca000000-0000-4000-8000-000000000030",
    findings: [],
    method: "semantic-overlap" as const,
    residuals: {
      inlierCount: 6,
      maximumMm: 80 + index,
      medianMm: 20,
      p90Mm: 60,
      sampleCount: 8,
    },
    scaleStatus: source.scaleStatus,
    schemaVersion: "c9-registration-result-v1" as const,
    sourceId: source.id,
    status: "registered" as const,
    transform: {
      rotationQuaternionE9: { w: 1_000_000_000, x: 0, y: 0, z: 0 },
      scalePartsPerMillion: 1_000_000,
      translationMm: { xMm: 0, yMm: 0, zMm: 0 },
    },
  }));
}

function runnerFixture(
  options: {
    readonly acquisitionFailure?: FusionWorkerError;
    readonly available?: boolean;
    readonly candidateHash?: string;
  } = {},
) {
  const fixture = fusionWorkerFixture();
  const queue = new MemoryQueue(fixture.lease);
  const protocol = options.available
    ? new BoundedFusionProducerProtocol({
        registration: { register: () => Promise.resolve(registrations(fixture.lease)) },
        semantic: {
          fit: (input) =>
            Promise.resolve({
              candidateSnapshot: input.baseSnapshot,
              candidateSnapshotSha256:
                options.candidateHash ?? canonicalSnapshotSha256(input.baseSnapshot),
              coverage: {
                inputSourceCount: input.sources.length,
                levelsCovered: 1,
                registeredSourceCount: input.registrations.length,
                unknownRegionCount: 0,
              },
              discrepancies: [],
              status: "full-house-proposal",
            }),
        },
      })
    : new BoundedFusionProducerProtocol({
        registration: new UnavailableRegistrationProducer(),
        semantic: new UnavailableSemanticProducer(),
      });
  const runner = new FusionProcessingRunner({
    clock: { now: () => new Date("2026-07-17T12:30:00.000Z") },
    heartbeatMilliseconds: 100,
    logger,
    pollMilliseconds: 1,
    producers: protocol,
    queue,
    sources: {
      acquire: () =>
        options.acquisitionFailure
          ? Promise.reject(options.acquisitionFailure)
          : Promise.resolve(fixture.acquired),
    },
    workerId: "c9-synthetic-worker",
  });
  return { fixture, queue, runner };
}

describe("C9 composed fusion runner", () => {
  it("publishes a deterministic provider-free abstention without candidate geometry", async () => {
    const { queue, runner } = runnerFixture();
    await expect(runner.processNext()).resolves.toBe("processed");
    expect(queue.advances).toEqual(["fitting"]);
    expect(queue.published).toHaveLength(1);
    expect(queue.published[0]).toMatchObject({
      authority: "proposal-only",
      safeCode: "FUSION_PRODUCER_UNAVAILABLE",
      status: "abstained",
    });
    expect(queue.failures).toEqual([]);
  });

  it("advances registering → fitting → comparing and publishes a schema-valid full proposal", async () => {
    const { queue, runner } = runnerFixture({ available: true });
    await expect(runner.processNext()).resolves.toBe("processed");
    expect(queue.advances).toEqual(["fitting", "comparing"]);
    expect(queue.published[0]).toMatchObject({
      authority: "proposal-only",
      status: "full-house-proposal",
    });
    expect(
      queue.published[0]?.status === "full-house-proposal"
        ? queue.published[0].candidateSnapshotSha256
        : undefined,
    ).toBe(canonicalSnapshotSha256(fusionWorkerFixture().acquired.baseSnapshot));
    expect(JSON.stringify(queue.published[0])).not.toMatch(
      /url|objectKey|credential|canonicalWrite/u,
    );
  });

  it("records a bounded safe failure when exact source acquisition is fenced", async () => {
    const { queue, runner } = runnerFixture({
      acquisitionFailure: new FusionWorkerError("FUSION_SOURCE_FENCED"),
    });
    await expect(runner.processNext()).resolves.toBe("processed");
    expect(queue.published).toEqual([]);
    expect(queue.failures).toEqual([{ retryable: false, safeCode: "FUSION_SOURCE_FENCED" }]);
  });

  it("rejects a producer candidate whose canonical snapshot hash is false", async () => {
    const { queue, runner } = runnerFixture({
      available: true,
      candidateHash: "0".repeat(64),
    });
    await expect(runner.processNext()).resolves.toBe("processed");
    expect(queue.advances).toEqual(["fitting"]);
    expect(queue.published).toEqual([]);
    expect(queue.failures).toEqual([
      { retryable: false, safeCode: "FUSION_CANDIDATE_HASH_MISMATCH" },
    ]);
  });

  it("acknowledges cancellation when both publication and failure paths lose the lease fence", async () => {
    const { queue, runner } = runnerFixture({ available: true });
    queue.publishFence = true;
    queue.failFence = true;
    await expect(runner.processNext()).resolves.toBe("processed");
    expect(queue.published).toEqual([]);
    expect(queue.failures).toEqual([]);
    expect(queue.acknowledgements).toBe(1);
  });

  it("returns idle without touching producers when no durable lease is claimable", async () => {
    const { queue, runner } = runnerFixture();
    queue.claimed = true;
    await expect(runner.processNext()).resolves.toBe("idle");
    expect(queue.advances).toEqual([]);
    expect(queue.published).toEqual([]);
  });
});
