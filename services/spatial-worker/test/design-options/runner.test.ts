import { optionJobSchema } from "@interior-design/contracts";
import { describe, expect, it } from "vitest";

import {
  DesignOptionProcessingRunner,
  planDesignOptions,
  type DesignOptionProcessingRunnerOptions,
} from "../../src/design-options/index.js";
import type { SafeLogger } from "../../src/logger.js";
import { richLease } from "./support.js";

const logger: SafeLogger = {
  debug: () => undefined,
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
};

describe("C12 production worker runner", () => {
  it("maintains the exact version fence through generation, validation and publication", async () => {
    const lease = richLease();
    const publication = await planDesignOptions(lease, new AbortController().signal);
    expect(publication.status).toBe("produced");
    if (publication.status !== "produced") return;
    let current = lease.job;
    const stages: string[] = [];
    let published = false;
    let claimed = false;
    const worker: DesignOptionProcessingRunnerOptions["worker"] = {
      acknowledgeCancellation: () => Promise.reject(new Error("unexpected cancellation")),
      abstain: () => Promise.reject(new Error("unexpected abstention")),
      advance: (command) => {
        expect(command.expectedJobVersion).toBe(current.version);
        current = optionJobSchema.parse({
          ...current,
          stage: command.stage,
          updatedAt: new Date(Date.parse(current.updatedAt) + 1).toISOString(),
          version: current.version + 1,
        });
        stages.push(command.stage);
        return Promise.resolve(current);
      },
      claimNext: () => {
        if (claimed) return Promise.resolve(undefined);
        claimed = true;
        return Promise.resolve(lease);
      },
      fail: () => Promise.reject(new Error("unexpected failure")),
      heartbeat: (command) => {
        expect(command.expectedJobVersion).toBe(current.version);
        return Promise.resolve({ ...lease, job: current });
      },
      publish: (command) => {
        expect(command.expectedJobVersion).toBe(current.version);
        expect(command.options).toEqual(publication.options);
        expect(command.optionSet).toEqual(publication.optionSet);
        published = true;
        return Promise.resolve(
          optionJobSchema.parse({
            ...current,
            completedAt: new Date(Date.parse(current.updatedAt) + 1).toISOString(),
            optionCount: command.options.length,
            stage: "complete",
            state: "succeeded",
            updatedAt: new Date(Date.parse(current.updatedAt) + 1).toISOString(),
            version: current.version + 1,
          }),
        );
      },
    };
    const runner = new DesignOptionProcessingRunner({
      logger,
      planner: () => Promise.resolve(publication),
      pollMilliseconds: 100,
      worker,
      workerId: "c12-test-worker",
    });

    await expect(runner.processNext()).resolves.toBe("processed");
    expect(stages).toEqual(["generating", "validating", "publishing"]);
    expect(published).toBe(true);
  });

  it("turns a fenced cancellation into an acknowledgement attempt without publishing", async () => {
    const lease = richLease();
    let acknowledgedVersion: number | undefined;
    const worker: DesignOptionProcessingRunnerOptions["worker"] = {
      acknowledgeCancellation: (command) => {
        acknowledgedVersion = command.expectedJobVersion;
        return Promise.resolve(
          optionJobSchema.parse({
            ...lease.job,
            cancelledAt: "2026-07-18T05:00:02.000Z",
            stage: "complete",
            state: "cancelled",
            updatedAt: "2026-07-18T05:00:02.000Z",
            version: command.expectedJobVersion + 1,
          }),
        );
      },
      abstain: () => Promise.reject(new Error("unexpected abstention")),
      advance: () => Promise.reject(Object.assign(new Error("cancelled"), { code: "LEASE_LOST" })),
      claimNext: () => Promise.resolve(lease),
      fail: () => Promise.reject(new Error("unexpected failure")),
      heartbeat: () => Promise.resolve(lease),
      publish: () => Promise.reject(new Error("unexpected publication")),
    };
    const runner = new DesignOptionProcessingRunner({
      logger,
      pollMilliseconds: 100,
      worker,
      workerId: "c12-cancel-worker",
    });

    await expect(runner.processNext()).resolves.toBe("processed");
    expect(acknowledgedVersion).toBe(lease.job.version + 1);
  });
});
