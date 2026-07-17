import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(process.cwd(), "migrations/0008_reconstruction.sql");

describe("C8 migration contract", () => {
  it("pins dependencies, attempts/leases, rights fencing and append-only publication", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("C8 requires migration 0002_assets_evidence");
    expect(sql).toContain("C8 requires migration 0007_native_capture");
    expect(sql).toContain("reconstruction_attempts_lease_state");
    expect(sql).toContain("published reconstruction jobs are immutable");
    expect(sql).toContain("reconstruction_results_append_only");
    expect(sql).toContain("reconstruction_rights_withdrawals_append_only");
    expect(sql).toContain("reconstruction_audit_events_append_only");
    expect(sql).toContain("reconstruction_outbox_append_only");
    expect(sql).toContain("VALUES ('0008_reconstruction')");
    expect(sql).not.toMatch(/ON DELETE CASCADE/u);
  });
});
