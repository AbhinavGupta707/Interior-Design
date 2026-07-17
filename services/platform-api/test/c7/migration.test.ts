import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL("../../migrations/0007_native_capture.sql", import.meta.url),
);

describe("C7 native capture migration", () => {
  it("defines every durable tenant/project/session-scoped relation", async () => {
    const sql = await readFile(migrationPath, "utf8");
    for (const table of [
      "capture_sessions",
      "capture_briefs",
      "capture_rights_events",
      "capture_artifacts",
      "capture_artifact_upload_sessions",
      "capture_artifact_upload_parts",
      "capture_packages",
      "capture_processing_attempts",
      "capture_results",
      "capture_audit_events",
      "capture_outbox",
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(sql).toContain(
      "FOREIGN KEY (tenant_id, project_id, capture_session_id, artifact_id, upload_session_id)",
    );
    expect(sql).toContain("PRIMARY KEY (tenant_id, project_id, capture_session_id, id)");
  });

  it("enforces bounded states, source bindings, lease fencing, and one result", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toMatch(
      /source_sha256 text NOT NULL CHECK \(source_sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/u,
    );
    expect(sql).toContain("UNIQUE (tenant_id, project_id, capture_session_id)");
    expect(sql).toContain("lease_token uuid");
    expect(sql).toContain("lease_expires_at timestamptz");
    expect(sql).toContain("attempt_number BETWEEN 1 AND 3");
    expect(sql).toContain("part_size integer NOT NULL CHECK (part_size = 8388608)");
    expect(sql).toContain(
      "training_use_consent text NOT NULL CHECK (training_use_consent = 'denied')",
    );
  });

  it("uses append-only and terminal-immutability triggers without mutating canonical C4 tables", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION c7_reject_append_only_mutation()");
    expect(sql).toContain(
      "'capture_briefs', 'capture_rights_events', 'capture_packages', 'capture_results'",
    );
    expect(sql).toContain("CREATE OR REPLACE FUNCTION c7_validate_session_mutation()");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION c7_validate_attempt_mutation()");
    expect(sql).not.toMatch(/(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?model_/iu);
    expect(sql).not.toMatch(/(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?canonical_/iu);
  });

  it("provides partial cleanup and queue indexes for bounded live operations", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("capture_briefs_expiry_idx");
    expect(sql).toContain("capture_upload_sessions_cleanup_idx");
    expect(sql).toContain("capture_attempts_queue_idx");
    expect(sql).toContain("WHERE state IN ('queued', 'leased', 'cancel-requested')");
    expect(sql).toContain("capture_outbox_poll_idx");
  });
});
