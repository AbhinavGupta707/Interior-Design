import {
  createRenderJobRequestSchema,
  renderOutputManifestSchema,
} from "@interior-design/contracts";
import { createHash, randomUUID } from "node:crypto";
import type { JSONValue, Sql, TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyC1Migration, bootstrapC1Fixtures, createC1Sql } from "../../../src/c1.js";
import { applyC2Migration } from "../../../src/c2.js";
import { applyC3Migration } from "../../../src/c3.js";
import { applyC4Migration } from "../../../src/c4.js";
import { applyC5Migration } from "../../../src/c5.js";
import { applyC6Migration } from "../../../src/c6.js";
import { applyC7Migration } from "../../../src/c7.js";
import { applyC8Migration } from "../../../src/c8.js";
import { applyC9Migration } from "../../../src/c9.js";
import { applyC10Migration } from "../../../src/c10.js";
import { applyC11Migration } from "../../../src/c11.js";
import { applyC12Migration } from "../../../src/c12.js";
import { applyC13Migration } from "../../../src/c13.js";
import { applyC14Migration } from "../../../src/c14.js";
import { PostgresRenderRepository } from "../../../src/modules/render-stills/postgres.js";

const databaseUrl = process.env.C14_TEST_DATABASE_URL ?? "";
const describeWithPostgres = databaseUrl.length === 0 ? describe.skip : describe;
const appRole = "c14_render_app_probe";
const workerRole = "c14_render_worker_probe";
const diskFloorBytes = 15 * 1024 * 1024 * 1024;
const expectedMigrationIds = [
  "0001_identity_projects_intake",
  "0002_assets_evidence",
  "0003_property_dossier",
  "0004_canonical_models",
  "0005_model_operations",
  "0006_plan_processing",
  "0007_native_capture",
  "0008_reconstruction",
  "0009_model_fusion",
  "0010_scenes",
  "0011_design_briefs",
  "0012_design_options",
  "0013_specifications",
  "0014_render_stills",
] as const;

interface FixtureJob {
  readonly cacheHash: string;
  readonly capability: string;
  readonly id: string;
  readonly projectId: string;
  readonly publicationResultId: string;
  readonly sceneArtifactId: string;
  readonly sceneId: string;
  readonly sceneJobId: string;
  readonly tenantId: string;
  readonly userId: string;
}

interface ClaimRow {
  readonly job_id: string;
  readonly lease_token: string;
  readonly tenant_id: string;
}

function json(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

async function dropProbeRoles(sql: Sql): Promise<void> {
  await sql.unsafe(`
    DO $roles$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${appRole}') THEN
        EXECUTE 'DROP OWNED BY ${appRole}';
        EXECUTE 'DROP ROLE ${appRole}';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${workerRole}') THEN
        EXECUTE 'DROP OWNED BY ${workerRole}';
        EXECUTE 'DROP ROLE ${workerRole}';
      END IF;
    END
    $roles$;
  `);
}

async function ensureExactMigrations(sql: Sql): Promise<void> {
  const [registry] = await sql<{ readonly exists: boolean }[]>`
    SELECT to_regclass('public.platform_schema_migrations') IS NOT NULL AS exists
  `;
  if (registry?.exists === true) {
    const rows = await sql<{ readonly id: string }[]>`
      SELECT id FROM platform_schema_migrations ORDER BY id
    `;
    const actual = rows.map(({ id }) => id);
    if (
      actual.length !== expectedMigrationIds.length ||
      actual.some((id, index) => id !== expectedMigrationIds[index])
    ) {
      throw new Error(`C14_DISPOSABLE_DATABASE_PARTIALLY_MIGRATED:${actual.join(",")}`);
    }
    return;
  }

  await applyC1Migration(sql);
  await bootstrapC1Fixtures(sql, "test");
  await applyC2Migration(sql);
  await applyC3Migration(sql);
  await applyC4Migration(sql);
  await applyC5Migration(sql);
  await applyC6Migration(sql);
  await applyC7Migration(sql);
  await applyC8Migration(sql);
  await applyC9Migration(sql);
  await applyC10Migration(sql);
  await applyC11Migration(sql);
  await applyC12Migration(sql);
  await applyC13Migration(sql);
  await applyC14Migration(sql);
}

async function seedJob(sql: Sql, fixture: FixtureJob): Promise<void> {
  const request = {
    cameraId: randomUUID(),
    enhancement: "disabled",
    label: "C14 PostgreSQL proof fixture",
    lightingPresetId: "canonical-lights-neutral-world-v1",
    profileId: "cycles-cpu-geometry-safe-v1",
    sourceSceneJobId: fixture.sceneJobId,
  };
  const source = {
    projectId: fixture.projectId,
    sceneArtifactId: fixture.sceneArtifactId,
    sceneGlbSha256: "a".repeat(64),
    sceneId: fixture.sceneId,
    sceneJobId: fixture.sceneJobId,
    sceneManifestSha256: "b".repeat(64),
    sourceSnapshotSha256: "c".repeat(64),
  };
  await sql.begin(async (transaction) => {
    // These tests isolate C14 storage semantics. C10 parent fixtures are deliberately not
    // fabricated; the disposable-database owner disables FK triggers only while seeding.
    await transaction.unsafe("SET LOCAL session_replication_role = replica");
    await transaction`
      INSERT INTO render_jobs (
        tenant_id, project_id, id, request_payload, request_sha256, cache_identity_sha256,
        source_payload, source_scene_job_id, source_scene_id, source_scene_artifact_id,
        source_scene_glb_sha256, source_scene_manifest_sha256, source_snapshot_sha256,
        required_capability, estimated_job_bytes, enhancement_provider_enabled,
        publication_result_id, attempt, state, retryable, created_by, created_at, updated_at, version
      ) VALUES (
        ${fixture.tenantId}::uuid, ${fixture.projectId}::uuid, ${fixture.id}::uuid,
        ${transaction.json(json(request))}, ${"d".repeat(64)}, ${fixture.cacheHash},
        ${transaction.json(json(source))}, ${fixture.sceneJobId}::uuid, ${fixture.sceneId}::uuid,
        ${fixture.sceneArtifactId}::uuid, ${"a".repeat(64)}, ${"b".repeat(64)}, ${"c".repeat(64)},
        ${fixture.capability}, 1024, false, ${fixture.publicationResultId}::uuid,
        1, 'queued', false, ${fixture.userId}::uuid, clock_timestamp(), clock_timestamp(), 1
      )
    `;
    await transaction`
      INSERT INTO render_attempts (
        tenant_id, project_id, job_id, attempt, estimated_job_bytes, created_at
      ) VALUES (
        ${fixture.tenantId}::uuid, ${fixture.projectId}::uuid, ${fixture.id}::uuid,
        1, 1024, clock_timestamp()
      )
    `;
    await transaction`
      INSERT INTO render_attempt_heads (
        tenant_id, project_id, job_id, attempt, state, stage, fence_version, created_at, updated_at
      ) VALUES (
        ${fixture.tenantId}::uuid, ${fixture.projectId}::uuid, ${fixture.id}::uuid,
        1, 'queued', 'preparing', 0, clock_timestamp(), clock_timestamp()
      )
    `;
  });
}

async function claimAsWorker(
  sql: Sql,
  capability: string,
  workerId: string,
  volumeId: string,
  freeBytes: number,
): Promise<ClaimRow[]> {
  return sql.begin(async (transaction) => {
    await transaction.unsafe(`SET LOCAL ROLE ${workerRole}`);
    return transaction<ClaimRow[]>`
      SELECT tenant_id::text, job_id::text, lease_token::text
      FROM c14_claim_render_job(
        ${workerId}, ${[capability]}, ${volumeId}, ${freeBytes}, 60
      )
    `;
  });
}

describeWithPostgres("C14 live PostgreSQL queue, RLS and append-only controls", () => {
  let sql: Sql;
  let tenantA: string;
  let tenantB: string;
  let projectA: string;
  let projectB: string;
  let userA: string;
  let userB: string;
  let concurrentJob: FixtureJob;
  let lowDiskJob: FixtureJob;
  let cancellationJob: FixtureJob;
  let staleJob: FixtureJob;
  let publicationJob: FixtureJob;

  beforeAll(async () => {
    sql = createC1Sql(databaseUrl);
    await ensureExactMigrations(sql);
    await dropProbeRoles(sql);
    tenantA = randomUUID();
    tenantB = randomUUID();
    projectA = randomUUID();
    projectB = randomUUID();
    userA = randomUUID();
    userB = randomUUID();

    await sql.unsafe(`
      DO $roles$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${appRole}') THEN
          CREATE ROLE ${appRole} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${workerRole}') THEN
          CREATE ROLE ${workerRole} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
        END IF;
      END
      $roles$;
      GRANT USAGE ON SCHEMA public TO ${appRole}, ${workerRole};
      GRANT SELECT, INSERT ON render_jobs TO ${appRole};
      GRANT EXECUTE ON FUNCTION c14_claim_render_job(text, text[], text, bigint, integer) TO ${workerRole};
    `);
    await sql`
      INSERT INTO identity_tenants (id, name) VALUES
        (${tenantA}::uuid, 'Synthetic C14 tenant A'),
        (${tenantB}::uuid, 'Synthetic C14 tenant B')
    `;
    await sql`
      INSERT INTO identity_users (id, subject, display_name) VALUES
        (${userA}::uuid, ${`synthetic-c14-a-${userA}`}, 'Synthetic C14 A'),
        (${userB}::uuid, ${`synthetic-c14-b-${userB}`}, 'Synthetic C14 B')
    `;
    await sql`
      INSERT INTO projects (id, tenant_id, name) VALUES
        (${projectA}::uuid, ${tenantA}::uuid, 'Synthetic C14 project A'),
        (${projectB}::uuid, ${tenantB}::uuid, 'Synthetic C14 project B')
    `;

    const fixture = (
      tenantId: string,
      projectId: string,
      userId: string,
      capability: string,
    ): FixtureJob => ({
      cacheHash: randomUUID().replaceAll("-", "").padEnd(64, "0"),
      capability,
      id: randomUUID(),
      projectId,
      publicationResultId: randomUUID(),
      sceneArtifactId: randomUUID(),
      sceneId: randomUUID(),
      sceneJobId: randomUUID(),
      tenantId,
      userId,
    });
    const runSuffix = randomUUID().slice(0, 8);
    concurrentJob = fixture(tenantA, projectA, userA, `c14.concurrent.${runSuffix}`);
    lowDiskJob = fixture(tenantA, projectA, userA, `c14.low-disk.${runSuffix}`);
    cancellationJob = fixture(tenantB, projectB, userB, `c14.cancel.${runSuffix}`);
    staleJob = fixture(tenantB, projectB, userB, `c14.stale.${runSuffix}`);
    publicationJob = fixture(tenantA, projectA, userA, `c14.publish.${runSuffix}`);
    await seedJob(sql, concurrentJob);
    await seedJob(sql, lowDiskJob);
    await seedJob(sql, cancellationJob);
    await seedJob(sql, staleJob);
    await seedJob(sql, publicationJob);
  });

  afterAll(async () => {
    try {
      await dropProbeRoles(sql);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("forces tenant RLS for a non-owner app role and rejects cross-tenant inserts", async () => {
    await sql.begin(async (transaction) => {
      await transaction.unsafe(`SET LOCAL ROLE ${appRole}`);
      await transaction`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
      const role = await transaction<
        { readonly rolbypassrls: boolean; readonly rolsuper: boolean }[]
      >`
        SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user
      `;
      expect(role).toEqual([{ rolbypassrls: false, rolsuper: false }]);
      const visible = await transaction<{ readonly tenant_id: string }[]>`
        SELECT DISTINCT tenant_id::text FROM render_jobs
      `;
      expect(visible).toEqual([{ tenant_id: tenantA }]);
    });

    await expect(
      sql.begin(async (transaction) => {
        await transaction.unsafe(`SET LOCAL ROLE ${appRole}`);
        await transaction`SELECT set_config('app.tenant_id', ${tenantA}, true)`;
        await transaction`
          INSERT INTO render_jobs (
            tenant_id, project_id, id, request_payload, request_sha256, cache_identity_sha256,
            source_payload, source_scene_job_id, source_scene_id, source_scene_artifact_id,
            source_scene_glb_sha256, source_scene_manifest_sha256, source_snapshot_sha256,
            required_capability, estimated_job_bytes, publication_result_id, attempt, state,
            retryable, created_by, created_at, updated_at, version
          ) VALUES (
            ${tenantB}::uuid, ${projectB}::uuid, ${randomUUID()}::uuid,
            ${transaction.json(json({ sourceSceneJobId: randomUUID(), profileId: "cycles-cpu-geometry-safe-v1" }))},
            ${"1".repeat(64)}, ${"2".repeat(64)}, ${transaction.json(json({ projectId: projectB }))},
            ${randomUUID()}::uuid, ${randomUUID()}::uuid, ${randomUUID()}::uuid,
            ${"3".repeat(64)}, ${"4".repeat(64)}, ${"5".repeat(64)},
            'c14.cross-tenant.cpu', 1024, ${randomUUID()}::uuid, 1, 'queued', false,
            ${userB}::uuid, clock_timestamp(), clock_timestamp(), 1
          )
        `;
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("exposes only the constrained claim hook and gives one winner under concurrent claims", async () => {
    const role = await sql<
      { readonly has_table_access: boolean; readonly rolbypassrls: boolean }[]
    >`
      SELECT has_table_privilege(${workerRole}, 'render_jobs', 'SELECT') AS has_table_access,
        rolbypassrls FROM pg_roles WHERE rolname = ${workerRole}
    `;
    expect(role).toEqual([{ has_table_access: false, rolbypassrls: false }]);

    const claims = await Promise.all([
      claimAsWorker(
        sql,
        concurrentJob.capability,
        "worker.concurrent.1",
        `volume.${concurrentJob.id}`,
        diskFloorBytes + 1024,
      ),
      claimAsWorker(
        sql,
        concurrentJob.capability,
        "worker.concurrent.2",
        `volume.${concurrentJob.id}`,
        diskFloorBytes + 1024,
      ),
    ]);
    expect(claims.flat()).toHaveLength(1);
    expect(claims.flat()[0]).toMatchObject({ job_id: concurrentJob.id, tenant_id: tenantA });
  });

  it("admits atomically only when unreserved free space meets the frozen threshold", async () => {
    await expect(
      claimAsWorker(
        sql,
        lowDiskJob.capability,
        "worker.disk.1",
        `volume.${lowDiskJob.id}`,
        diskFloorBytes + 1023,
      ),
    ).resolves.toEqual([]);
    const admitted = await claimAsWorker(
      sql,
      lowDiskJob.capability,
      "worker.disk.2",
      `volume.${lowDiskJob.id}`,
      diskFloorBytes + 1024,
    );
    expect(admitted).toHaveLength(1);
    const reservation = await sql<{ readonly required_unreserved_bytes: string }[]>`
      SELECT required_unreserved_bytes::text FROM render_disk_reservations
      WHERE tenant_id = ${tenantA}::uuid AND project_id = ${projectA}::uuid
        AND job_id = ${lowDiskJob.id}::uuid
    `;
    expect(reservation).toEqual([{ required_unreserved_bytes: String(diskFloorBytes + 1024) }]);
  });

  it("terminalises an expired cancellation and releases its reservation", async () => {
    const [claim] = await claimAsWorker(
      sql,
      cancellationJob.capability,
      "worker.cancel.1",
      `volume.${cancellationJob.id}`,
      diskFloorBytes + 1024,
    );
    expect(claim).toBeDefined();
    await sql.begin(async (transaction: TransactionSql) => {
      await transaction`
        UPDATE render_attempt_heads SET state = 'cancel-requested',
          lease_expires_at = clock_timestamp() - interval '1 second',
          fence_version = fence_version + 1, updated_at = clock_timestamp()
        WHERE tenant_id = ${tenantB}::uuid AND project_id = ${projectB}::uuid
          AND job_id = ${cancellationJob.id}::uuid AND attempt = 1
      `;
      await transaction`
        UPDATE render_jobs SET state = 'cancel-requested', version = version + 1,
          updated_at = clock_timestamp()
        WHERE tenant_id = ${tenantB}::uuid AND project_id = ${projectB}::uuid
          AND id = ${cancellationJob.id}::uuid
      `;
    });
    await expect(
      claimAsWorker(
        sql,
        cancellationJob.capability,
        "worker.cancel.2",
        `volume.${cancellationJob.id}`,
        diskFloorBytes + 1024,
      ),
    ).resolves.toEqual([]);
    const terminal = await sql<{ readonly state: string }[]>`
      SELECT state FROM render_jobs WHERE tenant_id = ${tenantB}::uuid
        AND project_id = ${projectB}::uuid AND id = ${cancellationJob.id}::uuid
    `;
    expect(terminal).toEqual([{ state: "cancelled" }]);
    const releases = await sql<{ readonly count: string }[]>`
      SELECT count(*)::text AS count FROM render_disk_reservation_releases
      WHERE tenant_id = ${tenantB}::uuid AND project_id = ${projectB}::uuid
        AND job_id = ${cancellationJob.id}::uuid
    `;
    expect(releases).toEqual([{ count: "1" }]);
  });

  it("reclaims stale leases only on the reserved volume with a fresh disk and lease fence", async () => {
    const volumeId = `volume.${staleJob.id}`;
    const [original] = await claimAsWorker(
      sql,
      staleJob.capability,
      "worker.stale.1",
      volumeId,
      diskFloorBytes + 1024,
    );
    expect(original).toBeDefined();
    await sql`
      UPDATE render_attempt_heads SET lease_expires_at = clock_timestamp() - interval '1 second',
        fence_version = fence_version + 1, updated_at = clock_timestamp()
      WHERE tenant_id = ${tenantB}::uuid AND project_id = ${projectB}::uuid
        AND job_id = ${staleJob.id}::uuid AND attempt = 1
    `;

    await expect(
      claimAsWorker(
        sql,
        staleJob.capability,
        "worker.stale.2",
        `other.${staleJob.id}`,
        diskFloorBytes + 1024,
      ),
    ).resolves.toEqual([]);
    await expect(
      claimAsWorker(sql, staleJob.capability, "worker.stale.2", volumeId, diskFloorBytes + 1023),
    ).resolves.toEqual([]);
    const [reclaimed] = await claimAsWorker(
      sql,
      staleJob.capability,
      "worker.stale.2",
      volumeId,
      diskFloorBytes + 1024,
    );
    expect(reclaimed?.lease_token).not.toBe(original?.lease_token);
    const fences = await sql<{ readonly fresh: boolean; readonly stale: boolean }[]>`
      SELECT
        c14_recheck_disk_reservation(
          ${tenantB}::uuid, ${projectB}::uuid, ${staleJob.id}::uuid, 1,
          ${reclaimed?.lease_token ?? randomUUID()}::uuid, ${diskFloorBytes + 1024}
        ) AS fresh,
        c14_recheck_disk_reservation(
          ${tenantB}::uuid, ${projectB}::uuid, ${staleJob.id}::uuid, 1,
          ${original?.lease_token ?? randomUUID()}::uuid, ${diskFloorBytes + 1024}
        ) AS stale
    `;
    expect(fences).toEqual([{ fresh: true, stale: false }]);
  });

  it("allows one fenced safe-result publication winner and releases disk atomically", async () => {
    const volumeId = `volume.${publicationJob.id}`;
    const [lease] = await claimAsWorker(
      sql,
      publicationJob.capability,
      "worker.publish.1",
      volumeId,
      diskFloorBytes + 1024,
    );
    if (lease === undefined) throw new Error("Publication fixture was not leased.");
    const repository = new PostgresRenderRepository(sql);
    const fence = {
      attempt: 1,
      freeBytes: diskFloorBytes + 1024,
      jobId: publicationJob.id,
      leaseToken: lease.lease_token,
      projectId: projectA,
      tenantId: tenantA,
      workerId: "worker.publish.1",
    };
    for (const stage of [
      "preparing",
      "rendering-safe",
      "validating-safe",
      "publishing-safe",
    ] as const) {
      await repository.heartbeat({ ...fence, stage });
    }
    const roles = [
      "geometry-safe-png",
      "multilayer-exr",
      "depth-exr",
      "normal-exr",
      "segmentation-png",
    ] as const;
    const artifacts = roles.map((role, index) => {
      const digest = String(index + 1).repeat(64);
      const mediaType = role.endsWith("-png") ? ("image/png" as const) : ("image/x-exr" as const);
      return {
        artifact: {
          byteLength: 1,
          heightPx: 64,
          id: randomUUID(),
          mediaType,
          role,
          schemaVersion: "c14-render-artifact-v1" as const,
          sha256: digest,
          widthPx: 64,
        },
        objectKey: `render-stills/sha256/${digest.slice(0, 2)}/${digest}.${mediaType === "image/png" ? "png" : "exr"}`,
      };
    });
    const source = {
      projectId: projectA,
      sceneArtifactId: publicationJob.sceneArtifactId,
      sceneGlbSha256: "a".repeat(64),
      sceneId: publicationJob.sceneId,
      sceneJobId: publicationJob.sceneJobId,
      sceneManifestSha256: "b".repeat(64),
      sourceSnapshotSha256: "c".repeat(64),
    };
    const manifest = renderOutputManifestSchema.parse({
      artifacts: artifacts.map(({ artifact }) => artifact),
      authority: "derived-visualisation-only",
      exactByteReplayScope: "same-host-build-script-profile-source",
      hostFingerprintSha256: "6".repeat(64),
      renderSceneManifestSha256: "7".repeat(64),
      renderer: {
        blenderBuildHash: "fixture-only",
        blenderVersion: "fixture-only",
        executableSha256: "8".repeat(64),
        scriptSha256: "9".repeat(64),
      },
      resultId: publicationJob.publicationResultId,
      schemaVersion: "c14-render-output-manifest-v1",
      source,
    });
    const command = {
      artifacts,
      attempt: 1,
      jobId: publicationJob.id,
      leaseToken: lease.lease_token,
      manifest,
      manifestSha256: createHash("sha256").update(JSON.stringify(manifest)).digest("hex"),
      projectId: projectA,
      resultId: publicationJob.publicationResultId,
      tenantId: tenantA,
      workerId: "worker.publish.1",
    };
    const outcomes = await Promise.allSettled([
      repository.publishResult(command),
      repository.publishResult(command),
    ]);
    expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const visible = await repository.findResult(tenantA, projectA, publicationJob.id);
    expect(visible?.id).toBe(publicationJob.publicationResultId);
    const releases = await sql<{ readonly count: string }[]>`
      SELECT count(*)::text AS count FROM render_disk_reservation_releases
      WHERE tenant_id = ${tenantA}::uuid AND project_id = ${projectA}::uuid
        AND job_id = ${publicationJob.id}::uuid
    `;
    expect(releases).toEqual([{ count: "1" }]);
  });

  it("rejects mutation of append-only attempt history", async () => {
    await expect(sql`UPDATE render_attempt_events SET state = 'failed'`).rejects.toMatchObject({
      code: "P0001",
    });
    await expect(
      sql`
        UPDATE render_enhancement_jobs SET base_artifact_sha256 = ${"0".repeat(64)}
        WHERE tenant_id = ${tenantA}::uuid AND project_id = ${projectA}::uuid
          AND render_job_id = ${publicationJob.id}::uuid
      `,
    ).rejects.toMatchObject({ code: "P0001" });
  });

  it("replays an exact completed effect and rejects the same key with a changed body hash", async () => {
    const idempotencyKey = `c14-replay-${randomUUID()}`;
    const requestSha256 = "e".repeat(64);
    const request = createRenderJobRequestSchema.parse({
      cameraId: randomUUID(),
      enhancement: "disabled",
      label: "C14 replay proof",
      lightingPresetId: "canonical-lights-neutral-world-v1",
      profileId: "cycles-cpu-geometry-safe-v1",
      sourceSceneJobId: concurrentJob.sceneJobId,
    });
    const response = {
      attempt: 1,
      createdAt: "2026-07-19T00:00:00.000Z",
      createdBy: userA,
      id: concurrentJob.id,
      projectId: projectA,
      request,
      state: "queued",
      updatedAt: "2026-07-19T00:00:00.000Z",
      version: 1,
    };
    await sql`
      INSERT INTO render_idempotency_effects (
        tenant_id, project_id, idempotency_key, actor_user_id, operation,
        request_sha256, response_payload, response_status, created_at, completed_at
      ) VALUES (
        ${tenantA}::uuid, ${projectA}::uuid, ${idempotencyKey}, ${userA}::uuid,
        'render.job.create', ${requestSha256}, ${sql.json(json(response))}, 201,
        clock_timestamp(), clock_timestamp()
      )
    `;
    const repository = new PostgresRenderRepository(sql);
    const command = {
      actor: {
        displayName: "Synthetic C14 A",
        role: "owner" as const,
        subject: `synthetic-c14-a-${userA}`,
        tenantId: tenantA,
        userId: userA,
      },
      cacheIdentitySha256: concurrentJob.cacheHash,
      correlation: {
        requestId: "c14-replay-proof",
        spanId: "e".repeat(16),
        traceId: "f".repeat(32),
        traceParent: `00-${"f".repeat(32)}-${"e".repeat(16)}-00`,
      },
      enhancementProviderEnabled: false,
      idempotencyKey,
      projectId: projectA,
      request,
      requestSha256,
      resolved: {
        cacheSourceIdentitySha256: "1".repeat(64),
        estimatedJobBytes: 1024,
        requiredCapability: concurrentJob.capability,
        source: {
          projectId: projectA,
          sceneArtifactId: concurrentJob.sceneArtifactId,
          sceneGlbSha256: "a".repeat(64),
          sceneId: concurrentJob.sceneId,
          sceneJobId: concurrentJob.sceneJobId,
          sceneManifestSha256: "b".repeat(64),
          sourceSnapshotSha256: "c".repeat(64),
        },
      },
    };

    await expect(repository.createJob(command)).resolves.toEqual({ job: response, replayed: true });
    await expect(
      repository.createJob({ ...command, requestSha256: "0".repeat(64) }),
    ).rejects.toMatchObject({
      code: "RENDER_IDEMPOTENCY_CONFLICT",
      statusCode: 409,
    });
  });
});
