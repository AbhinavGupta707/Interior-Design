import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../../../migrations/0014_render_stills.sql", import.meta.url);

describe("C14 migration static security contract", () => {
  it("forces RLS and constrains cross-tenant queue discovery", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain("ALTER TABLE %I FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("c14_current_tenant_id()");
    expect(sql).toContain("FOR UPDATE OF j, h SKIP LOCKED");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("REVOKE ALL ON FUNCTION c14_claim_render_job");
  });

  it("keeps attempt/result/artifact/audit/outbox facts append-only", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    for (const table of [
      "render_attempts",
      "render_attempt_events",
      "render_results",
      "render_artifacts",
      "render_audit_events",
      "render_outbox",
    ]) {
      expect(sql).toContain(`'${table}'`);
    }
    expect(sql).toContain("c14_reject_append_only_mutation()");
  });

  it("freezes the atomic disk equation and release ledger", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain("16106127360 + candidate.estimated_job_bytes");
    expect(sql).toContain("3 * candidate.estimated_job_bytes");
    expect(sql).toContain("render_disk_reservation_releases");
    expect(sql).toContain("c14_recheck_disk_reservation");
  });
});
