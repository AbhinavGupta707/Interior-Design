import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL("../../migrations/0015_device_neutral_capture_envelopes.sql", import.meta.url),
);

describe("C14.8 device-neutral capture migration", () => {
  it("binds accepted envelopes to immutable C2, C7, RoomPlan, and C8 references", async () => {
    const sql = await readFile(migrationPath, "utf8");
    for (const table of [
      "capture_envelopes",
      "capture_envelope_media_sources",
      "capture_envelope_depth_sources",
      "capture_envelope_roomplan_sources",
      "capture_envelope_reconstruction_links",
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(sql).toContain("REFERENCES assets(tenant_id, project_id, id) ON DELETE RESTRICT");
    expect(sql).toContain(
      "REFERENCES capture_artifacts(tenant_id, project_id, capture_session_id, id)",
    );
    expect(sql).toContain("REFERENCES reconstruction_jobs(tenant_id, project_id, id)");
  });

  it("makes accepted capture evidence append-only and leaves canonical tables untouched", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("OLD.state IN ('accepted', 'proposed', 'abstained', 'cancelled')");
    expect(sql).toContain("'capture_envelopes', 'capture_envelope_media_sources'");
    expect(sql).toContain("EXECUTE FUNCTION c7_reject_append_only_mutation()");
    expect(sql).not.toMatch(/(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?model_/iu);
    expect(sql).not.toMatch(/(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?canonical_/iu);
  });

  it("requires explicit complete transfer state and immutable hashes", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("envelope_payload ->> 'transferState' = 'complete'");
    expect(sql).toContain("envelope_sha256 ~ '^[0-9a-f]{64}$'");
    expect(sql).toContain("source_sha256 ~ '^[0-9a-f]{64}$'");
    expect(sql).not.toContain("training_use_consent text");
  });
});
