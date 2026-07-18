import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(process.cwd(), "migrations/0011_design_briefs.sql");

describe("C11 design-brief migration contract", () => {
  it("creates the complete scoped brief and consultation product", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("C11 requires migration 0010_scenes");
    for (const table of [
      "design_briefs",
      "design_brief_revisions",
      "design_brief_entry_projections",
      "design_brief_reference_projections",
      "design_brief_acceptance_events",
      "design_brief_idempotency_effects",
      "design_brief_audit_events",
      "consultation_sessions",
      "consultation_messages",
      "consultation_patch_proposals",
      "consultation_proposal_state_events",
      "consultation_proposal_heads",
      "consultation_proposal_confirmations",
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(sql).toContain("VALUES ('0011_design_briefs')");
    expect(sql).not.toMatch(/ON DELETE CASCADE/iu);
  });

  it("enforces append-only history and explicit lifecycle transitions", async () => {
    const sql = await readFile(migrationPath, "utf8");
    for (const trigger of [
      "design_brief_revisions_append_only",
      "design_brief_entries_append_only",
      "design_brief_references_append_only",
      "design_brief_acceptances_append_only",
      "design_brief_audit_append_only",
      "consultation_messages_append_only",
      "consultation_proposals_append_only",
      "consultation_proposal_states_append_only",
      "consultation_confirmations_append_only",
    ]) {
      expect(sql).toContain(trigger);
    }
    expect(sql).toContain("NEW.current_revision <> OLD.current_revision + 1");
    expect(sql).toContain("accepted current brief must advance the acceptance pointer");
    expect(sql).toContain("draft edits cannot rewrite acceptance history");
    expect(sql).toContain("terminal consultation sessions are immutable");
    expect(sql).toContain("terminal consultation sessions cannot retain pending proposals");
    expect(sql).toContain("superseded-by-new-turn");
    expect(sql).toContain("terminal consultation proposals are immutable");
  });

  it("pins classification, provenance, rights, revision and tenant/project fences", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("design_brief_entry_provenance");
    expect(sql).toContain("design_brief_entry_classification");
    expect(sql).toContain("brief source snapshot must resolve exactly once inside project scope");
    expect(sql).toContain("rights_record_sha256 ~ '^[0-9a-f]{64}$'");
    expect(sql).toContain("PRIMARY KEY (tenant_id, project_id, brief_id, revision)");
    expect(sql).toContain("UNIQUE (tenant_id, project_id)");
    expect(sql).toContain("FOREIGN KEY (tenant_id, project_id, asset_id)");
    expect(sql).toContain("FOREIGN KEY (tenant_id, project_id, source_message_id)");
    expect(sql).toContain("PRIMARY KEY (tenant_id, idempotency_key)");
  });

  it("keeps audit metadata bounded and excludes private consultation content", async () => {
    const sql = await readFile(migrationPath, "utf8");
    for (const forbidden of [
      "statement",
      "message",
      "operations",
      "entries",
      "referenceBoard",
      "prompt",
      "health",
      "accessibility",
      "assetLocator",
      "token",
      "credential",
    ]) {
      expect(sql).toContain(`'${forbidden}'`);
    }
  });

  it("does not mutate C2 evidence or C4/C5/C9/C10 product state", async () => {
    const sql = await readFile(migrationPath, "utf8");
    for (const protectedTable of [
      "assets",
      "asset_rights_assertions",
      "canonical_model_snapshots",
      "model_branches",
      "model_operation_commits",
      "fusion_proposals",
      "scene_jobs",
      "scenes",
    ]) {
      expect(sql).not.toMatch(
        new RegExp(`(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+${protectedTable}`, "iu"),
      );
    }
  });
});
