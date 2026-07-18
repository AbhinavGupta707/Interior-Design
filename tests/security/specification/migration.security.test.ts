import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(
    new URL("../../../services/platform-api/migrations/0013_specifications.sql", import.meta.url),
  ),
  "utf8",
);

const tenantTables = [
  "catalog_releases",
  "catalog_asset_versions",
  "catalog_release_assets",
  "specifications",
  "specification_revisions",
  "specification_lines",
  "specification_substitution_previews",
  "specification_substitution_heads",
  "specification_substitution_confirmations",
  "specification_scene_links",
  "specification_scene_events",
  "specification_idempotency_effects",
  "specification_audit_events",
  "specification_outbox",
] as const;

describe("C13 migration security invariants", () => {
  it("forces tenant RLS with both read and write predicates on every C13 table", () => {
    for (const table of tenantTables) {
      expect(migration).toContain(`'${table}'`);
    }
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("USING (tenant_id = c13_current_tenant_id())");
    expect(migration).toContain("WITH CHECK (tenant_id = c13_current_tenant_id())");
  });

  it("uses composite tenant/project references and denies destructive history mutation", () => {
    expect(migration).toMatch(/FOREIGN KEY \(tenant_id, project_id[^)]*\)/gu);
    expect(migration).not.toContain("ON DELETE CASCADE");
    expect(migration).toContain("c13_reject_append_only_mutation");
    expect(migration).toContain("RAISE EXCEPTION '% is append-only'");
  });

  it("prevents commercial and training claims in catalog payloads", () => {
    expect(migration).toContain("{rights,policy,trainingAllowed}' = 'false'");
    expect(migration.match(/not-provided/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
