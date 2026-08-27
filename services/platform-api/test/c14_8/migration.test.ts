import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { c7AdminMigrationTargets } from "../../src/c7.js";

const migrationPath = fileURLToPath(
  new URL("../../migrations/0015_device_neutral_capture_envelopes.sql", import.meta.url),
);
const c7RunbookPath = fileURLToPath(
  new URL("../../../../docs/runbooks/development/c7-native-capture.md", import.meta.url),
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

  it("keeps the documented composed migration path ordered and readiness-aware", async () => {
    expect(c7AdminMigrationTargets("migrate-c14-8")).toEqual(["c7", "c14-8"]);
    expect(c7AdminMigrationTargets("migrate")).toEqual(["c7"]);
    expect(c7AdminMigrationTargets("migrate-and-expire")).toEqual(["c7"]);
    expect(c7AdminMigrationTargets("expire")).toEqual([]);
    expect(() => c7AdminMigrationTargets("unknown")).toThrow(/Expected one of/u);

    const runbook = await readFile(c7RunbookPath, "utf8");
    expect(runbook).toContain("tsx src/c7.ts migrate-c14-8");
    expect(runbook).toContain("c14-8-capture-envelope-database");
    expect(runbook).toMatch(/do not\s+apply `0015`/u);
  });
});
