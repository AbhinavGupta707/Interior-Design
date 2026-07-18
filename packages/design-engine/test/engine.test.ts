import { optionOperationBundleSchema } from "@interior-design/contracts";
import { reduceModelOperations } from "@interior-design/model-operations";
import { describe, expect, it } from "vitest";

import { runDeterministicDesignEngine } from "../src/index.js";
import { makeRequest } from "./support.js";

describe("deterministic design engine declarations", () => {
  it("emits exact C12 bundles, canonical candidate snapshots and a complete matrix", () => {
    const request = makeRequest();
    const result = runDeterministicDesignEngine(request);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.candidates).toHaveLength(2);
    expect(result.pairwiseDiversity).toHaveLength(1);
    expect(result.pairwiseDiversity[0]?.placementDistanceMm).toBe(2_000);
    expect(result.providerManifest).toMatchObject({
      adapter: "deterministic-local-design-v1",
      engineVersion: "c12-deterministic-layout-engine-v1",
      externalNetworkUsed: false,
    });
    result.candidates.forEach((candidate) => {
      expect(optionOperationBundleSchema.safeParse(candidate.operationBundle).success).toBe(true);
      const replay = reduceModelOperations(
        request.workingSnapshot,
        candidate.operationBundle.operations,
      );
      expect(replay.snapshotSha256).toBe(candidate.operationBundle.candidateSnapshotSha256);
      expect(replay.snapshot).toEqual(candidate.candidateSnapshot);
    });
  });

  it("returns the same hashes and ordering on exact replay", () => {
    const request = makeRequest();
    const first = runDeterministicDesignEngine(request);
    const second = runDeterministicDesignEngine(structuredClone(request));
    expect(second).toEqual(first);
  });
});
