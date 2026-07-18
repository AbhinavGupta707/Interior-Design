import { describe, expect, it } from "vitest";
import { reduceModelOperations } from "@interior-design/model-operations";

import { planDesignOptions } from "../../src/design-options/index.js";
import { richLease } from "./support.js";

describe("C12 deterministic production planner", () => {
  it("produces repeatable, materially or spatially distinct, replayable options", async () => {
    const lease = richLease();
    const first = await planDesignOptions(lease, new AbortController().signal);
    const second = await planDesignOptions(structuredClone(lease), new AbortController().signal);
    expect(second).toEqual(first);
    expect(first.status).toBe("produced");
    if (first.status !== "produced") return;

    expect(first.options).toHaveLength(2);
    expect(first.optionSet.pairwiseDiversity).toHaveLength(1);
    expect(first.optionSet.pairwiseDiversity[0]?.spatiallyOrMateriallyDistinct).toBe(true);
    expect(new Set(first.options.map(({ direction }) => direction))).toEqual(
      new Set(["circulation-first", "conversation-first"]),
    );
    first.options.forEach((option) => {
      expect(option.operationBundle.operations).toHaveLength(3);
      expect(
        new Set(option.operationBundle.assetPlacements.map(({ asset }) => asset.kind)),
      ).toEqual(new Set(["finish", "furnishing", "light"]));
      expect(option.operationBundle.constraintResults).toHaveLength(lease.constraints.length);
      const replay = reduceModelOperations(
        lease.workingSnapshot,
        option.operationBundle.operations,
      );
      expect(replay.hasBlockingFindings).toBe(false);
      expect(replay.snapshotSha256).toBe(option.operationBundle.candidateSnapshotSha256);
    });
  });

  it("fails closed instead of inventing proposal provenance", async () => {
    const result = await planDesignOptions(richLease(false), new AbortController().signal);
    expect(result).toEqual({
      retryable: false,
      safeCode: "CONSTRAINTS_INFEASIBLE",
      status: "failed",
    });
  });

  it("rejects a changed creator-owned catalog manifest before candidate production", async () => {
    const lease = richLease();
    const result = await planDesignOptions(
      {
        ...lease,
        job: { ...lease.job, assetManifestSha256: "f".repeat(64) },
      },
      new AbortController().signal,
    );
    expect(result).toEqual({
      retryable: true,
      safeCode: "SOURCE_CHANGED",
      status: "failed",
    });
  });
});
