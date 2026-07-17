import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.C2_ADVERSARIAL_DATABASE_URL ?? "";
const enabled = databaseUrl.length > 0;
const tables = [
  "asset_audit_events",
  "asset_processing_jobs",
  "asset_rights_assertions",
  "asset_upload_parts",
  "asset_upload_sessions",
  "assets",
  "derived_asset_artifacts",
] as const;

async function psql(sql: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "psql",
      ["--no-psqlrc", "--no-align", "--tuples-only", "--set", "ON_ERROR_STOP=1", "--command", sql],
      {
        env: { ...process.env, PAGER: "cat", PGDATABASE: databaseUrl },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const redactedStderr = Buffer.concat(stderr)
          .toString("utf8")
          .replaceAll(databaseUrl, "[REDACTED_DATABASE_URL]");
        reject(new Error(`psql exited ${String(code)}: ${redactedStderr}`));
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf8").trim());
    });
  });
}

const suiteName = enabled
  ? "live C2 Postgres isolation/lease schema acceptance"
  : "live C2 Postgres isolation/lease schema acceptance (set C2_ADVERSARIAL_DATABASE_URL for a disposable migrated database)";

describe.skipIf(!enabled)(suiteName, () => {
  it("has every frozen tenant-owned ingestion table", async () => {
    const result = await psql(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name LIKE 'asset%'
         OR table_schema = 'public' AND table_name = 'derived_asset_artifacts'
      ORDER BY table_name
    `);
    const actual = result.split("\n").filter(Boolean);
    for (const table of tables) {
      expect(actual).toContain(table);
    }
  });

  it("places tenant and project predicates on every tenant-owned ingestion record", async () => {
    for (const table of tables) {
      const result = await psql(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = '${table}'
          AND column_name IN ('tenant_id', 'project_id')
        ORDER BY column_name
      `);
      expect(result.split("\n").filter(Boolean)).toEqual(["project_id", "tenant_id"]);
    }
  });

  it("declares source-key, part-number, job, and derived-artifact uniqueness", async () => {
    const definitions = await psql(`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN ('assets', 'asset_upload_parts', 'asset_processing_jobs', 'derived_asset_artifacts')
      ORDER BY tablename, indexname
    `);
    expect(definitions).toMatch(/assets[\s\S]*(?:source_key|object_key)/iu);
    expect(definitions).toMatch(/asset_upload_parts[\s\S]*part_number/iu);
    expect(definitions).toMatch(/asset_processing_jobs[\s\S]*asset_id/iu);
    expect(definitions).toMatch(/derived_asset_artifacts[\s\S]*(?:object_key|key)/iu);
  });

  it.skipIf((process.env.C2_ADVERSARIAL_STALE_LEASE_ASSET_ID ?? "").length === 0)(
    "has reclaimed the orchestrator-seeded stale lease without multiple active jobs",
    async () => {
      const assetId = process.env.C2_ADVERSARIAL_STALE_LEASE_ASSET_ID ?? "";
      expect(assetId).toMatch(/^[a-f0-9-]{36}$/iu);
      const jobs = await psql(`
        SELECT to_jsonb(job)::text
        FROM asset_processing_jobs AS job
        WHERE asset_id = '${assetId}'::uuid
      `);
      const rows = jobs
        .split("\n")
        .filter(Boolean)
        .map((row) => JSON.parse(row) as Record<string, unknown>);
      expect(rows.length).toBeGreaterThan(0);
      const active = rows.filter((row) => ["leased", "running"].includes(String(row.status)));
      expect(active).toHaveLength(0);
      const attempts = rows.map((row) => Number(row.attempt ?? row.attempt_count ?? 0));
      expect(Math.max(...attempts)).toBeLessThanOrEqual(10);
    },
  );
});
