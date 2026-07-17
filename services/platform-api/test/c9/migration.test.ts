import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(process.cwd(), "migrations/0009_model_fusion.sql");

describe("C9 migration contract", () => {
  it("pins dependencies, tenant scope, exact sources, leases and append-only proposals", async () => {
    const sql = await readFile(migrationPath, "utf8");
    for (const dependency of [
      "0005_model_operations",
      "0006_plan_processing",
      "0007_native_capture",
      "0008_reconstruction",
    ]) {
      expect(sql).toContain(`C9 requires migration ${dependency}`);
    }
    expect(sql).toContain("fusion_job_sources_exact_unique");
    expect(sql).toContain("fusion_attempts_lease_state");
    expect(sql).toContain("fusion_proposals_append_only");
    expect(sql).toContain("fusion_decisions_append_only");
    expect(sql).toContain("fusion_drafts_append_only");
    expect(sql).toContain("fusion_rights_withdrawals_append_only");
    expect(sql).toContain("fusion_audit_append_only");
    expect(sql).toContain("fusion_outbox_append_only");
    expect(sql).toContain("VALUES ('0009_model_fusion')");
    expect(sql).not.toMatch(/ON DELETE CASCADE/u);
  });

  it("keeps publication proposal-only and never writes C4/C5 canonical tables", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("proposal_payload ->> 'authority' = 'proposal-only'");
    expect(sql).not.toMatch(/INSERT\s+INTO\s+canonical_model_snapshots/iu);
    expect(sql).not.toMatch(/UPDATE\s+(?:canonical_model_snapshots|model_branches)/iu);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+model_operation_envelopes/iu);
  });
});
