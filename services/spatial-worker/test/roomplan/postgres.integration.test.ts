import { captureProposalResultSchema } from "@interior-design/contracts";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres, { type Sql, type TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { convertRoomPlanToProposal } from "../../src/roomplan/converter.js";
import { sha256 } from "../../src/roomplan/canonical.js";
import { PostgresRoomPlanProcessingQueue } from "../../src/roomplan/postgres.js";
import type { LeasedRoomPlanCapture } from "../../src/roomplan/types.js";
import { SYNTHETIC_IDS, syntheticSources } from "./fixtures.js";

const databaseUrl = process.env.C7_TEST_DATABASE_URL ?? "";
const describeWithPostgres = databaseUrl.length === 0 ? describe.skip : describe;
const migrationDirectory = fileURLToPath(
  new URL("../../../platform-api/migrations/", import.meta.url),
);

interface SeededAttempt {
  readonly attemptId: string;
  readonly captureSessionId: string;
  readonly packageId: string;
  readonly projectId: string;
  readonly tenantId: string;
}

async function seedAttempt(
  sql: Sql,
  tenantId: string,
  ownerUserId: string,
  label: string,
): Promise<SeededAttempt> {
  const sources = syntheticSources();
  const projectId = randomUUID();
  const captureSessionId = randomUUID();
  const packageId = randomUUID();
  const attemptId = randomUUID();
  const manifest = {
    ...sources.manifest,
    captureSessionId,
    projectId,
  };
  const now = new Date();
  const brief = {
    captureLabel: `Visibly synthetic ${label}`,
    captureSessionId,
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1_000).toISOString(),
    expectedRoomCount: 1,
    instructionsVersion: "c7-roomplan-instructions-1.0.0",
    mode: "single-room",
    projectId,
    rights: manifest.rights,
    schemaVersion: "c7-capture-session-v1",
  };
  await sql.begin(async (transaction) => {
    await transaction`
      INSERT INTO projects (id, tenant_id, name)
      VALUES (${projectId}::uuid, ${tenantId}::uuid, ${`Visibly synthetic ${label} project`})
    `;
    await transaction`
      INSERT INTO capture_sessions (
        tenant_id, project_id, id, mode, state, package_id,
        created_by, created_at, updated_at, version
      ) VALUES (
        ${tenantId}::uuid, ${projectId}::uuid, ${captureSessionId}::uuid,
        'single-room', 'uploaded', ${packageId}::uuid, ${ownerUserId}::uuid,
        ${now}, ${now}, 1
      )
    `;
    await transaction`
      INSERT INTO capture_briefs (
        tenant_id, project_id, capture_session_id, schema_version,
        expires_at, instructions_version, brief_payload, created_at
      ) VALUES (
        ${tenantId}::uuid, ${projectId}::uuid, ${captureSessionId}::uuid,
        'c7-capture-session-v1', ${new Date(brief.expiresAt)},
        'c7-roomplan-instructions-1.0.0', ${transaction.json(brief)}, ${now}
      )
    `;
    await transaction`
      INSERT INTO capture_rights_events (
        id, tenant_id, project_id, capture_session_id, permitted, basis,
        service_processing_consent, training_use_consent, reason_code,
        actor_user_id, occurred_at
      ) VALUES (
        ${randomUUID()}::uuid, ${tenantId}::uuid, ${projectId}::uuid,
        ${captureSessionId}::uuid, true, 'owned-by-user', true, 'denied',
        'RIGHTS_ASSERTED', ${ownerUserId}::uuid, ${now}
      )
    `;
    for (const artifact of sources.artifacts) {
      await transaction`
        INSERT INTO capture_artifacts (
          tenant_id, project_id, capture_session_id, id, kind, content_type,
          room_id, source_byte_size, source_sha256, source_object_key,
          state, created_at, uploaded_at
        ) VALUES (
          ${tenantId}::uuid, ${projectId}::uuid, ${captureSessionId}::uuid,
          ${artifact.artifactId}::uuid, ${artifact.kind}, ${artifact.contentType},
          ${artifact.roomId ?? null}::uuid, ${artifact.byteSize}, ${artifact.sha256},
          ${`capture-sources/${randomUUID()}`}, 'uploaded', ${now}, ${now}
        )
      `;
    }
    await transaction`
      INSERT INTO capture_packages (
        tenant_id, project_id, capture_session_id, id, schema_version,
        manifest_sha256, manifest_payload, total_source_bytes, artifact_count,
        created_by, created_at
      ) VALUES (
        ${tenantId}::uuid, ${projectId}::uuid, ${captureSessionId}::uuid,
        ${packageId}::uuid, 'c7-capture-package-v1', ${sha256(manifest)},
        ${transaction.json(manifest)},
        ${manifest.artifacts.reduce((total, artifact) => total + artifact.byteSize, 0)},
        ${manifest.artifacts.length}, ${ownerUserId}::uuid, ${now}
      )
    `;
    await transaction`
      INSERT INTO capture_processing_attempts (
        tenant_id, project_id, capture_session_id, package_id, id,
        attempt_number, state, available_at, created_at, updated_at
      ) VALUES (
        ${tenantId}::uuid, ${projectId}::uuid, ${captureSessionId}::uuid,
        ${packageId}::uuid, ${attemptId}::uuid, 1, 'queued', ${now}, ${now}, ${now}
      )
    `;
  });
  return { attemptId, captureSessionId, packageId, projectId, tenantId };
}

function fixtureProposal(job: LeasedRoomPlanCapture) {
  const sources = syntheticSources();
  const normalized = job.artifacts.find(({ kind }) => kind === "roomplan-normalized-json");
  if (normalized === undefined) throw new Error("The live synthetic normalized source is absent.");
  return captureProposalResultSchema.parse(
    convertRoomPlanToProposal(sources.normalized, {
      captureSessionId: job.captureSessionId,
      createdAt: new Date().toISOString(),
      normalizedArtifactId: normalized.artifactId,
      normalizedInputSha256: normalized.sha256,
      packageId: job.packageId,
      packageManifestSha256: job.packageManifestSha256,
      projectId: job.projectId,
      proposalId: randomUUID(),
    }),
  );
}

async function forceLeaseExpired(
  transaction: TransactionSql,
  job: LeasedRoomPlanCapture,
): Promise<void> {
  await transaction`
    UPDATE capture_processing_attempts
    SET lease_expires_at = clock_timestamp() - interval '1 second',
        updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 microsecond'),
        version = version + 1
    WHERE tenant_id = ${job.tenantId}::uuid AND project_id = ${job.projectId}::uuid
      AND capture_session_id = ${job.captureSessionId}::uuid AND id = ${job.attemptId}::uuid
  `;
}

describeWithPostgres("C7 live Postgres RoomPlan worker fencing", () => {
  let sql: Sql;
  let tenantId: string;
  let ownerUserId: string;

  beforeAll(async () => {
    sql = postgres(databaseUrl, { max: 4, onnotice: () => undefined, prepare: true });
    for (const migration of [
      "0001_identity_projects_intake.sql",
      "0002_assets_evidence.sql",
      "0003_property_dossier.sql",
      "0004_canonical_models.sql",
      "0005_model_operations.sql",
      "0006_plan_processing.sql",
      "0007_native_capture.sql",
    ]) {
      await sql.begin(async (transaction) => {
        await transaction.file(path.join(migrationDirectory, migration));
      });
    }
    tenantId = randomUUID();
    ownerUserId = randomUUID();
    await sql`
      INSERT INTO identity_tenants (id, name)
      VALUES (${tenantId}::uuid, 'Visibly synthetic C7 worker tenant')
    `;
    await sql`
      INSERT INTO identity_users (id, subject, display_name)
      VALUES (
        ${ownerUserId}::uuid, ${`c7-worker-${ownerUserId}`},
        'Visibly synthetic C7 worker owner'
      )
    `;
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it("fences stale and cancelled leases, publishes once, preserves results, and rechecks rights", async () => {
    const queue = new PostgresRoomPlanProcessingQueue(sql);
    const publishSeed = await seedAttempt(sql, tenantId, ownerUserId, "publish");
    const stale = await queue.claimNext("c7-live-worker-a", 60_000);
    expect(stale?.captureSessionId).toBe(publishSeed.captureSessionId);
    if (stale === undefined) throw new Error("Expected the synthetic stale lease.");
    const staleResult = fixtureProposal(stale);
    await sql.begin((transaction) => forceLeaseExpired(transaction, stale));
    expect(await queue.publish(stale, "c7-live-worker-a", staleResult)).toBe(false);

    const current = await queue.claimNext("c7-live-worker-b", 60_000);
    expect(current?.captureSessionId).toBe(publishSeed.captureSessionId);
    if (current === undefined) throw new Error("Expected the reclaimed synthetic lease.");
    const currentResult = fixtureProposal(current);
    expect(await queue.publish(current, "c7-live-worker-b", currentResult)).toBe(true);
    expect(await queue.publish(current, "c7-live-worker-b", currentResult)).toBe(false);
    const terminal = await sql<Array<{ readonly result_count: number; readonly state: string }>>`
      SELECT s.state,
        (SELECT count(*)::int FROM capture_results r
          WHERE r.tenant_id = s.tenant_id AND r.project_id = s.project_id
            AND r.capture_session_id = s.id) AS result_count
      FROM capture_sessions s
      WHERE s.tenant_id = ${tenantId}::uuid AND s.project_id = ${publishSeed.projectId}::uuid
        AND s.id = ${publishSeed.captureSessionId}::uuid
    `;
    expect(terminal[0]).toEqual({ result_count: 1, state: "proposed" });
    await expect(
      sql`
        UPDATE capture_results SET created_at = clock_timestamp()
        WHERE tenant_id = ${tenantId}::uuid AND project_id = ${publishSeed.projectId}::uuid
      `,
    ).rejects.toThrow(/append-only/u);

    const cancelSeed = await seedAttempt(sql, tenantId, ownerUserId, "cancel");
    const cancelling = await queue.claimNext("c7-live-worker-c", 60_000);
    expect(cancelling?.captureSessionId).toBe(cancelSeed.captureSessionId);
    if (cancelling === undefined) throw new Error("Expected the synthetic cancellation lease.");
    await sql.begin(async (transaction) => {
      await transaction`
        UPDATE capture_processing_attempts
        SET state = 'cancel-requested',
            updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 microsecond'),
            version = version + 1
        WHERE tenant_id = ${tenantId}::uuid AND project_id = ${cancelSeed.projectId}::uuid
          AND capture_session_id = ${cancelSeed.captureSessionId}::uuid
      `;
      await transaction`
        UPDATE capture_sessions
        SET state = 'cancel-requested',
            updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 microsecond'),
            version = version + 1
        WHERE tenant_id = ${tenantId}::uuid AND project_id = ${cancelSeed.projectId}::uuid
          AND id = ${cancelSeed.captureSessionId}::uuid
      `;
    });
    expect(await queue.publish(cancelling, "c7-live-worker-c", fixtureProposal(cancelling))).toBe(
      false,
    );
    expect(await queue.acknowledgeCancellation(cancelling, "c7-live-worker-c")).toBe(true);

    const rightsSeed = await seedAttempt(sql, tenantId, ownerUserId, "rights denied");
    await sql`
      INSERT INTO capture_rights_events (
        id, tenant_id, project_id, capture_session_id, permitted, basis,
        service_processing_consent, training_use_consent, reason_code, occurred_at
      ) VALUES (
        ${randomUUID()}::uuid, ${tenantId}::uuid, ${rightsSeed.projectId}::uuid,
        ${rightsSeed.captureSessionId}::uuid, false, 'owned-by-user', false, 'denied',
        'RIGHTS_WITHDRAWN', clock_timestamp()
      )
    `;
    expect(await queue.claimNext("c7-live-worker-d", 60_000)).toBeUndefined();
    const denied = await sql<Array<{ readonly safe_code: string; readonly state: string }>>`
      SELECT state, safe_code FROM capture_sessions
      WHERE tenant_id = ${tenantId}::uuid AND project_id = ${rightsSeed.projectId}::uuid
        AND id = ${rightsSeed.captureSessionId}::uuid
    `;
    expect(denied[0]).toEqual({ safe_code: "CAPTURE_RIGHTS_NOT_PERMITTED", state: "failed" });

    expect(SYNTHETIC_IDS.normalizedArtifact).toMatch(/^[0-9a-f-]{36}$/u);
  });
});
