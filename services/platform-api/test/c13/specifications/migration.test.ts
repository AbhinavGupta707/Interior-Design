import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(process.cwd(), "migrations/0013_specifications.sql");

describe("C13 specification migration contract", () => {
  it("creates composite tenant/project catalog, one-line truth, history and transaction records", async () => {
    const sql = await readFile(migrationPath, "utf8");
    for (const table of [
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
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(sql).toContain("Every schedule is read directly from these rows");
    expect(sql).not.toMatch(
      /CREATE TABLE IF NOT EXISTS specification_(?:room|product|finish)_schedule/iu,
    );
    expect(sql).not.toMatch(/ON DELETE CASCADE/iu);
  });

  it("forces RLS and transaction-local tenant context for every C13 tenant table", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("ALTER TABLE %I ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("ALTER TABLE %I FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("c13_current_tenant_id()");
    expect(sql).toContain("current_setting('app.tenant_id', true)");
    expect(sql).toContain("CREATE POLICY");
  });

  it("enforces append-only revisions/lines/confirmations and one-step mutable heads", async () => {
    const sql = await readFile(migrationPath, "utf8");
    for (const token of [
      "c13_reject_append_only_mutation",
      "c13_validate_specification_head",
      "NEW.current_revision <> OLD.current_revision + 1",
      "c13_validate_substitution_head",
      "NEW.version <> OLD.version + 1",
      "c13_validate_scene_link",
      "c13_validate_idempotency_completion",
    ]) {
      expect(sql).toContain(token);
    }
  });

  it("bounds commercial/quantity truth and privacy-minimised audit/outbox payloads", async () => {
    const sql = await readFile(migrationPath, "utf8");
    for (const token of [
      "not-provided",
      "not-derived-in-c13",
      "trainingAllowed",
      "bounded-catalog-preview-only",
      "design.element.replace.v1",
      "notes",
      "licenceText",
      "sourceReceipt",
      "signedUrl",
      "objectLocator",
    ]) {
      expect(sql).toContain(token);
    }
  });
});
