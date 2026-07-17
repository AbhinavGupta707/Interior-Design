import { pathToFileURL } from "node:url";

import type {
  CanonicalHomeSnapshot,
  ModelOperationRequest,
} from "../../../packages/contracts/src/index.js";
import { existingHomeSnapshot } from "../../../packages/test-fixtures/src/models/index.js";
import { describe, expect, it } from "vitest";

import { generatedRenameSequence, publicOperationCatalog } from "./operation-fixtures.js";
import { reduceWithReference, referencePublicOperationTypes } from "./reference-reducer.js";

interface ProducerResult {
  readonly snapshot: CanonicalHomeSnapshot;
  readonly snapshotSha256: string;
}

interface ProducerAdapter {
  readonly operationTypes: readonly string[];
  reduce(
    snapshot: CanonicalHomeSnapshot,
    operations: readonly ModelOperationRequest[],
  ): ProducerResult | Promise<ProducerResult>;
}

const producerEnabled = process.env.C5_RUN_PRODUCER_INTEGRATION === "1";
const adapterPath = process.env.C5_PRODUCER_ADAPTER_PATH;
const suiteEnabled = producerEnabled && adapterPath !== undefined && adapterPath.length > 0;
const suiteName = suiteEnabled
  ? "C5 producer reducer conformance"
  : "C5 producer reducer conformance (skipped: set C5_RUN_PRODUCER_INTEGRATION=1 and C5_PRODUCER_ADAPTER_PATH)";

async function loadAdapter(): Promise<ProducerAdapter> {
  if (adapterPath === undefined) throw new Error("C5_PRODUCER_ADAPTER_PATH is required.");
  const module = (await import(pathToFileURL(adapterPath).href)) as {
    readonly default?: ProducerAdapter;
    readonly producerAdapter?: ProducerAdapter;
  };
  const adapter = module.producerAdapter ?? module.default;
  if (adapter === undefined || typeof adapter.reduce !== "function") {
    throw new Error("The producer adapter must export default or producerAdapter with reduce().");
  }
  return adapter;
}

describe.skipIf(!suiteEnabled)(suiteName, () => {
  it("publishes the exact frozen registry and matches every independent one-operation hash", async () => {
    const adapter = await loadAdapter();
    expect(adapter.operationTypes).toEqual(referencePublicOperationTypes);
    for (const operation of publicOperationCatalog()) {
      const before = structuredClone(existingHomeSnapshot);
      const expected = reduceWithReference(existingHomeSnapshot, [operation]);
      const actual = await adapter.reduce(existingHomeSnapshot, [operation]);
      expect(actual.snapshotSha256).toBe(expected.snapshotSha256);
      expect(actual.snapshot).toEqual(expected.snapshot);
      expect(existingHomeSnapshot).toEqual(before);
    }
  });

  it("matches fixed-seed ordered replay without mutating the source", async () => {
    const adapter = await loadAdapter();
    const operations = generatedRenameSequence(50);
    const expected = reduceWithReference(existingHomeSnapshot, operations);
    const before = structuredClone(existingHomeSnapshot);
    const actual = await adapter.reduce(existingHomeSnapshot, operations);
    expect(actual.snapshotSha256).toBe(expected.snapshotSha256);
    expect(actual.snapshot).toEqual(expected.snapshot);
    expect(existingHomeSnapshot).toEqual(before);
  });
});
