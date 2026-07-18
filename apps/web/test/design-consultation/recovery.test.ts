import { describe, expect, it, vi } from "vitest";

import {
  clearConsultationRecovery,
  readConsultationRecovery,
  saveConsultationRecovery,
} from "../../src/features/design-consultation/recovery";
import { ids } from "./fixtures";

function storage() {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: vi.fn((key: string) => entries.get(key) ?? null),
    removeItem: vi.fn((key: string) => entries.delete(key)),
    setItem: vi.fn((key: string, value: string) => entries.set(key, value)),
  };
}

describe("C11 interruption recovery", () => {
  it("stores identifiers only and recovers a pending proposal", () => {
    const target = storage();
    saveConsultationRecovery(target, {
      projectId: ids.project,
      proposalId: ids.proposal,
      savedAt: "2026-07-18T09:00:00.000Z",
      schemaVersion: "c11-consultation-recovery-v1",
      sessionId: ids.session,
    });
    const raw = [...target.entries.values()][0] ?? "";
    expect(raw).toContain(ids.session);
    expect(raw).not.toMatch(/message|prompt|token|accessibility|health/iu);
    expect(readConsultationRecovery(target, ids.project)?.proposalId).toBe(ids.proposal);
  });

  it("removes malformed or foreign-project state without throwing", () => {
    const target = storage();
    target.entries.set(`hds:c11:consultation-recovery:v1:${ids.project}`, "not json");
    expect(readConsultationRecovery(target, ids.project)).toBeUndefined();
    expect(target.removeItem).toHaveBeenCalled();
  });

  it("clears recovery after cancellation or a confirmed patch", () => {
    const target = storage();
    clearConsultationRecovery(target, ids.project);
    expect(target.removeItem).toHaveBeenCalledWith(
      `hds:c11:consultation-recovery:v1:${ids.project}`,
    );
  });
});
