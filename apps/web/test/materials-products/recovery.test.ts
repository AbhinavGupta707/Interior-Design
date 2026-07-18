import { describe, expect, it } from "vitest";

import {
  clearMaterialsProductsRecovery,
  readMaterialsProductsRecovery,
  saveMaterialsProductsRecovery,
} from "../../src/features/materials-products/recovery";
import { ids } from "./fixtures";

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("C13 tab-local recovery", () => {
  it("stores only opaque identifiers and never payload, note, rights, or preview content", () => {
    const storage = new MemoryStorage();
    saveMaterialsProductsRecovery(storage, {
      candidateAssetVersionId: ids.assetSofa,
      projectId: ids.project,
      savedAt: "2026-07-18T13:00:00.000Z",
      schemaVersion: "c13-materials-products-recovery-v1",
      selectedLineId: ids.lineChair,
      specificationId: ids.specification,
    });
    const raw = [...storage.values.values()][0] ?? "";
    expect(raw).not.toMatch(/note|rights|schedule|preview|artifact|description|payload/iu);
    expect(readMaterialsProductsRecovery(storage, ids.project)?.selectedLineId).toBe(ids.lineChair);
    clearMaterialsProductsRecovery(storage, ids.project);
    expect(readMaterialsProductsRecovery(storage, ids.project)).toBeUndefined();
  });

  it("fails closed on cross-project, malformed, or oversized browser state", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      `hds:c13:selection-recovery:${ids.project}`,
      JSON.stringify({
        projectId: ids.viewer,
        schemaVersion: "c13-materials-products-recovery-v1",
      }),
    );
    expect(readMaterialsProductsRecovery(storage, ids.project)).toBeUndefined();
    storage.setItem(`hds:c13:selection-recovery:${ids.project}`, "{".repeat(1_001));
    expect(readMaterialsProductsRecovery(storage, ids.project)).toBeUndefined();
  });
});
