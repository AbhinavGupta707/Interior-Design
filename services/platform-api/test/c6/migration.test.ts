import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(process.cwd(), "migrations/0006_plan_processing.sql");

describe("C6 migration contract", () => {
  it("pins dependencies, immutable records, fenced leases, audit/outbox and the migration marker", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("C6 requires migration 0002_assets_evidence");
    expect(sql).toContain("C6 requires migration 0005_model_operations");
    expect(sql).toContain("plan_processing_jobs_lease_state");
    expect(sql).toContain("terminal plan jobs are immutable");
    expect(sql).toContain("plan_processing_results_append_only");
    expect(sql).toContain("result_sha256 text NOT NULL");
    expect(sql).toContain("plan_calibrations_append_only");
    expect(sql).toContain("plan_operation_drafts_append_only");
    expect(sql).toContain("plan_processing_audit_events");
    expect(sql).toContain("plan_processing_outbox");
    expect(sql).toContain("VALUES ('0006_plan_processing')");
    expect(sql).not.toMatch(/ON DELETE CASCADE/u);
  });
});
