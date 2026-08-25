import { describe, expect, it } from "vitest";

import {
  clearDesignOptionRecovery,
  readDesignOptionRecovery,
  saveDesignOptionRecovery,
} from "../../src/features/design-options/recovery";
import { confirmationA, ids } from "./fixtures";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
}

describe("C12 private recovery boundary", () => {
  it("stores bounded job/comparison IDs and the opaque server-issued C13 continuation", () => {
    const local = storage();
    saveDesignOptionRecovery(local, {
      leftOptionId: ids.optionA,
      confirmations: [{ confirmation: confirmationA, optionId: ids.optionA }],
      projectId: ids.project,
      rightOptionId: ids.optionB,
      savedAt: "2026-07-18T10:05:00.000Z",
      schemaVersion: "c12-design-options-recovery-v1",
      selectedJobId: ids.job,
    });
    const serialized = [...local.values.values()].join("");
    expect(serialized).not.toMatch(/brief statement|asset payload|operation|token|credential/iu);
    expect(readDesignOptionRecovery(local, ids.project)?.selectedJobId).toBe(ids.job);
    expect(readDesignOptionRecovery(local, ids.project)?.confirmations?.[0]?.confirmation.id).toBe(
      confirmationA.id,
    );
    clearDesignOptionRecovery(local, ids.project);
    expect(readDesignOptionRecovery(local, ids.project)).toBeUndefined();
  });

  it("drops malformed, oversized, foreign, and duplicate-option recovery", () => {
    const local = storage();
    local.setItem(`hds:c12:option-recovery:${ids.project}`, "{");
    expect(readDesignOptionRecovery(local, ids.project)).toBeUndefined();
    local.setItem(`hds:c12:option-recovery:${ids.project}`, "x".repeat(8_001));
    expect(readDesignOptionRecovery(local, ids.project)).toBeUndefined();
    local.setItem(
      `hds:c12:option-recovery:${ids.project}`,
      JSON.stringify({
        leftOptionId: ids.optionA,
        projectId: "c1200000-0000-4000-8000-000000000099",
        rightOptionId: ids.optionA,
        savedAt: "2026-07-18T10:05:00.000Z",
        schemaVersion: "c12-design-options-recovery-v1",
        selectedJobId: ids.job,
      }),
    );
    expect(readDesignOptionRecovery(local, ids.project)).toBeUndefined();
  });
});
