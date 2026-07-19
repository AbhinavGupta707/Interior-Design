import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("C14 static renderer and persistence boundary", () => {
  it("uses spawn arrays, no shell and a bounded credential-free environment", async () => {
    const source = await readFile(
      path.join(root, "workers/blender-renderer/src/subprocess.ts"),
      "utf8",
    );
    expect(source).toContain("shell: false");
    expect(source).toContain('"--disable-autoexec"');
    expect(source).toContain('"--offline-mode"');
    expect(source).toContain("process.kill(-pid");
    expect(source).toContain("forbiddenEnvironmentKey");
    expect(source).not.toMatch(/exec\(|execFile\(|shell:\s*true/gu);
  });

  it("forces RLS, composite project scope, append-only history and one-winner publication", async () => {
    const sql = await readFile(
      path.join(root, "services/platform-api/migrations/0014_render_stills.sql"),
      "utf8",
    );
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("FOREIGN KEY (tenant_id, project_id)");
    expect(sql).toContain("FOR UPDATE OF j, h SKIP LOCKED");
    expect(sql).toContain("UNIQUE (tenant_id, project_id, job_id)");
    expect(sql).toContain("render_disk_reservation_releases");
    expect(sql).toContain("c14_reject_append_only_mutation");
  });

  it("keeps sensitive fields out of durable audit and outbox JSON", async () => {
    const sql = await readFile(
      path.join(root, "services/platform-api/migrations/0014_render_stills.sql"),
      "utf8",
    );
    for (const field of [
      "'address'",
      "'notes'",
      "'schedule'",
      "'rights'",
      "'licence'",
      "'manifest'",
      "'artifacts'",
      "'objectKey'",
      "'signedUrl'",
      "'stdout'",
      "'stderr'",
      "'leaseToken'",
      "'credential'",
    ]) {
      expect(sql).toContain(field);
    }
  });
});
