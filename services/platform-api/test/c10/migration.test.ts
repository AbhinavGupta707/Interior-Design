import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(process.cwd(), "migrations/0010_scenes.sql");

describe("C10 migration contract", () => {
  it("pins exact committed snapshots, cache identity, attempts, leases, and immutable publication", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("C10 requires migration 0009_model_fusion");
    expect(sql).toContain("c10_snapshot_is_committed");
    expect(sql).toContain("UNIQUE (tenant_id, project_id, cache_key_sha256)");
    expect(sql).toContain("scene_attempts_lease_state");
    expect(sql).toContain("attempt BETWEEN 1 AND 3");
    expect(sql).toContain("FOR EACH ROW EXECUTE FUNCTION c10_validate_job_mutation");
    expect(sql).toContain("scene_artifacts_append_only");
    expect(sql).toContain("scenes_append_only");
    expect(sql).toContain("scene_cache_entries_append_only");
    expect(sql).toContain("scene_audit_append_only");
    expect(sql).toContain("scene_outbox_append_only");
    expect(sql).toContain("VALUES ('0010_scenes')");
    expect(sql).not.toMatch(/ON DELETE CASCADE/u);
  });

  it("does not mutate a snapshot, branch, model operation, or proposal producer", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).not.toMatch(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+canonical_model_snapshots/iu);
    expect(sql).not.toMatch(/(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+model_branches/iu);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+model_operation_/iu);
    expect(sql).not.toMatch(/(?:INSERT\s+INTO|UPDATE)\s+fusion_proposals/iu);
    expect(sql).toContain("authority' = 'derived-visualisation-only");
  });

  it("forbids locator, URL, credential, lease, raw snapshot, manifest, and GLB audit fields", async () => {
    const sql = await readFile(migrationPath, "utf8");
    for (const forbidden of [
      "canonicalSnapshot",
      "manifest",
      "glb",
      "objectKey",
      "providerId",
      "signedUrl",
      "leaseToken",
      "credential",
    ]) {
      expect(sql).toContain(`'${forbidden}'`);
    }
  });
});
