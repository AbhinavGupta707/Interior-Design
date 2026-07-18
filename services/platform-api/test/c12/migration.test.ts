import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(process.cwd(), "migrations/0012_design_options.sql");

describe("C12 migration contract", () => {
  it("creates the complete tenant-scoped durable option product", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("C12 requires migration 0011_design_briefs");
    for (const table of [
      "design_option_jobs",
      "design_option_attempts",
      "design_option_sets",
      "design_option_bundles",
      "design_options",
      "design_option_heads",
      "design_option_state_events",
      "design_option_job_state_events",
      "design_option_idempotency_effects",
      "design_option_confirmations",
      "design_option_audit_events",
      "design_option_outbox",
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
      expect(sql).toContain(`ALTER TABLE %I ENABLE ROW LEVEL SECURITY`);
    }
    expect(sql).toContain("VALUES ('0012_design_options')");
    expect(sql).not.toMatch(/ON DELETE CASCADE/iu);
  });

  it("widens C5 only for the exact paired C12 operation schema and types", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("model_operation_envelopes_schema_type_pair_check");
    expect(sql).toContain("schema_version = 'c5-model-operation-v1'");
    expect(sql).toContain("schema_version = 'c12-design-element-operation-v1'");
    for (const type of [
      "design.element.create.v1",
      "design.element.replace.v1",
      "design.element.remove.v1",
    ]) {
      expect(sql).toContain(`'${type}'`);
    }
    expect(sql).not.toMatch(/UPDATE\s+model_operation_envelopes/iu);
  });

  it("fences leases, immutable publication, state history, confirmation and privacy", async () => {
    const sql = await readFile(migrationPath, "utf8");
    for (const token of [
      "lease_token",
      "lease_expires_at",
      "heartbeat_at",
      "job_version",
      "c12_validate_attempt_mutation",
      "c12_validate_job_mutation",
      "c12_validate_option_head_mutation",
      "c12_reject_append_only_mutation",
      "branch_revision integer NOT NULL CHECK (branch_revision = 1)",
      "result_snapshot_sha256",
      "c12_current_tenant_id",
      "CREATE POLICY",
    ]) {
      expect(sql).toContain(token);
    }
    for (const forbidden of [
      "statement",
      "brief",
      "household",
      "accessibility",
      "narrative",
      "operations",
      "assets",
      "prompt",
      "token",
      "credential",
      "leaseToken",
    ]) {
      expect(sql).toContain(`'${forbidden}'`);
    }
  });
});
