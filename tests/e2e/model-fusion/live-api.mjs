import { createHash } from "node:crypto";

import {
  canonicalHomeSnapshotSchema,
  captureProposalResultSchema,
  planProposalSchema,
} from "../../../packages/contracts/src/index.ts";
import { createServer } from "../../../services/platform-api/src/app.ts";
import {
  applyC1Migration,
  bootstrapC1Fixtures,
  createC1Sql,
} from "../../../services/platform-api/src/c1.ts";
import { applyC2Migration } from "../../../services/platform-api/src/c2.ts";
import { applyC3Migration } from "../../../services/platform-api/src/c3.ts";
import { applyC4Migration } from "../../../services/platform-api/src/c4.ts";
import { applyC5Migration } from "../../../services/platform-api/src/c5.ts";
import { applyC6Migration } from "../../../services/platform-api/src/c6.ts";
import { applyC7Migration } from "../../../services/platform-api/src/c7.ts";
import { applyC8Migration } from "../../../services/platform-api/src/c8.ts";
import { applyC9Migration } from "../../../services/platform-api/src/c9.ts";
import { canonicalSnapshotSha256 } from "../../../services/spatial-worker/src/model-fusion/canonical.ts";
import { captureProposalFixture } from "../../../services/spatial-worker/test/model-fusion/support.ts";

export const LIVE_IDS = Object.freeze({
  asset: "ca000000-0000-4000-8000-000000000201",
  branch: "ca000000-0000-4000-8000-000000000202",
  modelSnapshot: "ca000000-0000-4000-8000-000000000203",
  owner: "20000000-0000-4000-8000-000000000001",
  planJob: "ca000000-0000-4000-8000-000000000204",
  planProposal: "ca000000-0000-4000-8000-000000000205",
  project: "10000000-0000-4000-8000-000000000001",
  tenant: "10000000-0000-4000-8000-000000000001",
});

const NOW = "2026-07-17T22:00:00.000Z";

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  throw new Error("Unsupported live fixture value.");
}

function sha256(value) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function known(value) {
  if (value.knowledge !== "known") throw new Error("Live C9 geometry must be known.");
  return value.value;
}

function captureWithKnownLevels() {
  const capture = captureProposalFixture();
  const proposedSnapshot = canonicalHomeSnapshotSchema.parse({
    ...capture.proposedSnapshot,
    elements: {
      ...capture.proposedSnapshot.elements,
      levels: capture.proposedSnapshot.elements.levels.map((level, index) => {
        const wall = capture.proposedSnapshot.elements.walls.find(
          (candidate) => candidate.levelId === level.id && candidate.heightMm.knowledge === "known",
        );
        const height = wall?.heightMm.knowledge === "known" ? wall.heightMm.value : 3_000;
        return {
          ...level,
          elevationMm: { attribution: level.origin, knowledge: "known", value: index * 3_000 },
          name:
            level.name.knowledge === "known"
              ? level.name
              : {
                  attribution: level.origin,
                  knowledge: "known",
                  value: `Level ${String(index + 1)}`,
                },
          storeyHeightMm:
            level.storeyHeightMm.knowledge === "known"
              ? level.storeyHeightMm
              : { attribution: level.origin, knowledge: "known", value: height },
        };
      }),
    },
  });
  return captureProposalResultSchema.parse({ ...capture, proposedSnapshot });
}

function planPayload(snapshot) {
  const levels = snapshot.elements.levels.map((level, index) => ({
    candidateId: level.id,
    confidence: 90,
    elevationMillimetres: known(level.elevationMm),
    kind: "level",
    sourceRegion: {
      maximum: { x: 10 + index, y: 10 + index },
      minimum: { x: index, y: index },
    },
    suggestedName:
      level.name.knowledge === "known" ? level.name.value : `Level ${String(index + 1)}`,
  }));
  const walls = snapshot.elements.walls.map((wall, index) => {
    const path = known(wall.path);
    const start = path[0];
    const end = path.at(-1);
    if (start === undefined || end === undefined) throw new Error("Live wall has no endpoints.");
    return {
      candidateId: wall.id,
      confidence: 90,
      end: { x: end.xMm, y: end.yMm },
      heightMillimetres: known(wall.heightMm),
      kind: "wall",
      levelCandidateId: wall.levelId,
      sourceRegion: {
        maximum: { x: 100 + index, y: 100 + index },
        minimum: { x: 90 + index, y: 90 + index },
      },
      start: { x: start.xMm, y: start.yMm },
      ...(wall.thicknessMm.knowledge === "known"
        ? { thicknessMillimetres: wall.thicknessMm.value }
        : {}),
    };
  });
  return planProposalSchema.parse({
    candidates: [...levels, ...walls],
    createdAt: NOW,
    findings: [],
    jobId: LIVE_IDS.planJob,
    normalizedInputSha256: "4".repeat(64),
    overallConfidence: 90,
    parser: {
      adapterId: "c9-live-plan",
      adapterVersion: "1.0.0",
      manifestSha256: "5".repeat(64),
      mode: "deterministic-fixture",
      normalizers: [{ name: "c9-live-normalizer", version: "1.0.0" }],
    },
    projectId: LIVE_IDS.project,
    proposalId: LIVE_IDS.planProposal,
    schemaVersion: "c6-plan-proposal-v1",
    source: {
      assetId: LIVE_IDS.asset,
      byteSize: 1_024,
      coordinateSpace: "fixture-microunits",
      detectedMimeType: "image/png",
      heightSourceUnits: 20_000,
      pageIndex: 0,
      projectId: LIVE_IDS.project,
      rights: {
        basis: "owned-by-user",
        serviceProcessingConsent: true,
        trainingUseConsent: "denied",
      },
      sha256: "6".repeat(64),
      widthSourceUnits: 20_000,
    },
    status: "proposal",
    unresolvedRegions: [],
  });
}

function liveFixture() {
  const capture = captureWithKnownLevels();
  const sourceSnapshot = capture.proposedSnapshot;
  const firstWall = sourceSnapshot.elements.walls[0];
  if (firstWall?.path.knowledge !== "known") throw new Error("Live fixture wall is unavailable.");
  const base = canonicalHomeSnapshotSchema.parse({
    ...sourceSnapshot,
    elements: {
      ...sourceSnapshot.elements,
      walls: sourceSnapshot.elements.walls.map((wall) =>
        wall.id === firstWall.id && wall.path.knowledge === "known"
          ? {
              ...wall,
              path: {
                ...wall.path,
                value: wall.path.value.map(({ xMm, yMm }) => ({ xMm: xMm - 25, yMm })),
              },
            }
          : wall,
      ),
    },
  });
  const plan = planPayload(sourceSnapshot);
  const planForHash = { ...plan, createdAt: undefined };
  return {
    base,
    baseByteLength: Buffer.byteLength(canonicalJson(base), "utf8"),
    baseSha256: canonicalSnapshotSha256(base),
    capture,
    captureSha256: sha256(capture),
    firstWallId: firstWall.id,
    modelId: base.modelId,
    plan,
    planSha256: sha256(planForHash),
  };
}

async function migrate(sql) {
  await applyC1Migration(sql);
  await bootstrapC1Fixtures(sql, "development");
  await applyC2Migration(sql);
  await applyC3Migration(sql);
  await applyC4Migration(sql);
  await applyC5Migration(sql);
  await applyC6Migration(sql);
  await applyC7Migration(sql);
  await applyC8Migration(sql);
  await applyC9Migration(sql);
}

async function seed(sql) {
  const fixture = liveFixture();
  await sql`
    INSERT INTO projects (id, tenant_id, name, status)
    VALUES (${LIVE_IDS.project}::uuid, ${LIVE_IDS.tenant}::uuid, 'C9 production-path acceptance', 'active')
  `;
  await sql`
    INSERT INTO canonical_model_profiles (tenant_id, project_id, model_id, profile)
    VALUES (${LIVE_IDS.tenant}::uuid, ${LIVE_IDS.project}::uuid, ${fixture.modelId}::uuid, 'existing')
  `;
  await sql`
    INSERT INTO canonical_model_snapshots (
      id, tenant_id, project_id, model_id, profile, version, schema_version,
      canonical_snapshot, snapshot_sha256, canonical_byte_length, validation_findings,
      created_by, created_at
    ) VALUES (
      ${LIVE_IDS.modelSnapshot}::uuid, ${LIVE_IDS.tenant}::uuid, ${LIVE_IDS.project}::uuid,
      ${fixture.modelId}::uuid, 'existing', 1, 'c4-canonical-home-v1',
      ${sql.json(fixture.base)}, ${fixture.baseSha256}, ${fixture.baseByteLength}, '[]'::jsonb,
      ${LIVE_IDS.owner}::uuid, ${NOW}
    )
  `;
  await sql`
    UPDATE canonical_model_profiles SET
      current_snapshot_id = ${LIVE_IDS.modelSnapshot}::uuid,
      current_snapshot_sha256 = ${fixture.baseSha256}, current_snapshot_version = 1,
      updated_at = ${NOW}, updated_by = ${LIVE_IDS.owner}::uuid
    WHERE tenant_id = ${LIVE_IDS.tenant}::uuid AND project_id = ${LIVE_IDS.project}::uuid
      AND profile = 'existing'
  `;
  await sql`
    INSERT INTO model_branches (
      tenant_id, project_id, model_id, profile, id, name,
      source_snapshot_id, source_snapshot_sha256, source_snapshot_version,
      head_snapshot_id, head_snapshot_sha256, head_snapshot_version, revision,
      created_by, created_at, updated_by, updated_at
    ) VALUES (
      ${LIVE_IDS.tenant}::uuid, ${LIVE_IDS.project}::uuid, ${fixture.modelId}::uuid, 'existing',
      ${LIVE_IDS.branch}::uuid, 'C9 acceptance existing branch',
      ${LIVE_IDS.modelSnapshot}::uuid, ${fixture.baseSha256}, 1,
      ${LIVE_IDS.modelSnapshot}::uuid, ${fixture.baseSha256}, 1, 0,
      ${LIVE_IDS.owner}::uuid, ${NOW}, ${LIVE_IDS.owner}::uuid, ${NOW}
    )
  `;
  await sql`
    INSERT INTO assets (
      id, tenant_id, project_id, kind, file_name, declared_mime_type, detected_mime_type,
      source_byte_size, source_sha256, source_object_key, status
    ) VALUES (
      ${LIVE_IDS.asset}::uuid, ${LIVE_IDS.tenant}::uuid, ${LIVE_IDS.project}::uuid, 'plan',
      'c9-live-plan.png', 'image/png', 'image/png', 1024, ${fixture.plan.source.sha256},
      'sources/ca000000-0000-4000-8000-000000000201', 'ready'
    )
  `;
  await sql`
    INSERT INTO asset_rights_assertions (
      tenant_id, project_id, asset_id, basis, service_processing_consent, training_use_consent
    ) VALUES (
      ${LIVE_IDS.tenant}::uuid, ${LIVE_IDS.project}::uuid, ${LIVE_IDS.asset}::uuid,
      'owned-by-user', true, 'denied'
    )
  `;
  await sql.begin(async (tx) => {
    await tx`SET CONSTRAINTS ALL DEFERRED`;
    await tx`
      INSERT INTO plan_processing_jobs (
        tenant_id, project_id, id, root_job_id, asset_id, page_index, parser_preference,
        source_sha256, attempt, state, result_id, created_by, created_at, updated_at
      ) VALUES (
        ${LIVE_IDS.tenant}::uuid, ${LIVE_IDS.project}::uuid, ${LIVE_IDS.planJob}::uuid,
        ${LIVE_IDS.planJob}::uuid, ${LIVE_IDS.asset}::uuid, 0, 'fixture',
        ${fixture.plan.source.sha256}, 1, 'proposed', ${LIVE_IDS.planProposal}::uuid,
        ${LIVE_IDS.owner}::uuid, ${NOW}, ${NOW}
      )
    `;
    await tx`
      INSERT INTO plan_processing_results (
        tenant_id, project_id, job_id, id, status, source_sha256, normalized_input_sha256,
        parser_manifest_sha256, result_sha256, result_payload, created_at
      ) VALUES (
        ${LIVE_IDS.tenant}::uuid, ${LIVE_IDS.project}::uuid, ${LIVE_IDS.planJob}::uuid,
        ${LIVE_IDS.planProposal}::uuid, 'proposal', ${fixture.plan.source.sha256},
        ${fixture.plan.normalizedInputSha256}, ${fixture.plan.parser.manifestSha256},
        ${fixture.planSha256}, ${tx.json(fixture.plan)}, ${NOW}
      )
    `;
  });

  await sql.begin(async (tx) => {
    await tx`SET CONSTRAINTS ALL DEFERRED`;
    await tx`
      INSERT INTO capture_sessions (
        tenant_id, project_id, id, mode, state, package_id, result_id, proposal_id,
        created_by, created_at, updated_at
      ) VALUES (
        ${LIVE_IDS.tenant}::uuid, ${LIVE_IDS.project}::uuid, ${fixture.capture.captureSessionId}::uuid,
        'single-room', 'proposed', ${fixture.capture.packageId}::uuid,
        ${fixture.capture.proposalId}::uuid, ${fixture.capture.proposalId}::uuid,
        ${LIVE_IDS.owner}::uuid, ${NOW}, ${NOW}
      )
    `;
    await tx`
      INSERT INTO capture_briefs (
        tenant_id, project_id, capture_session_id, schema_version, expires_at,
        instructions_version, brief_payload, created_at
      ) VALUES (
        ${LIVE_IDS.tenant}::uuid, ${LIVE_IDS.project}::uuid,
        ${fixture.capture.captureSessionId}::uuid, 'c7-capture-session-v1',
        '2026-07-18T22:00:00.000Z', 'c9-live-acceptance-1',
        ${tx.json({
          captureLabel: "C9 production-path RoomPlan proposal",
          captureSessionId: fixture.capture.captureSessionId,
          expectedRoomCount: 1,
          expiresAt: "2026-07-18T22:00:00.000Z",
          instructionsVersion: "c9-live-acceptance-1",
          mode: "single-room",
          projectId: LIVE_IDS.project,
          rights: {
            basis: "owned-by-user",
            serviceProcessingConsent: true,
            trainingUseConsent: "denied",
          },
          schemaVersion: "c7-capture-session-v1",
        })}, ${NOW}
      )
    `;
    await tx`
      INSERT INTO capture_rights_events (
        id, tenant_id, project_id, capture_session_id, permitted, basis,
        service_processing_consent, training_use_consent, reason_code, actor_user_id, occurred_at
      ) VALUES (
        'ca000000-0000-4000-8000-000000000206'::uuid, ${LIVE_IDS.tenant}::uuid,
        ${LIVE_IDS.project}::uuid, ${fixture.capture.captureSessionId}::uuid, true,
        'owned-by-user', true, 'denied', 'CAPTURE_AUTHORISED', ${LIVE_IDS.owner}::uuid, ${NOW}
      )
    `;
    await tx`
      INSERT INTO capture_packages (
        tenant_id, project_id, capture_session_id, id, schema_version, manifest_sha256,
        manifest_payload, total_source_bytes, artifact_count, created_by, created_at
      ) VALUES (
        ${LIVE_IDS.tenant}::uuid, ${LIVE_IDS.project}::uuid, ${fixture.capture.captureSessionId}::uuid,
        ${fixture.capture.packageId}::uuid, 'c7-capture-package-v1',
        ${fixture.capture.packageManifestSha256},
        ${tx.json({
          captureSessionId: fixture.capture.captureSessionId,
          projectId: LIVE_IDS.project,
          schemaVersion: "c7-capture-package-v1",
        })}, 3072, 3, ${LIVE_IDS.owner}::uuid, ${NOW}
      )
    `;
    await tx`
      INSERT INTO capture_processing_attempts (
        tenant_id, project_id, capture_session_id, package_id, id, attempt_number, state,
        available_at, created_at, updated_at
      ) VALUES (
        ${LIVE_IDS.tenant}::uuid, ${LIVE_IDS.project}::uuid, ${fixture.capture.captureSessionId}::uuid,
        ${fixture.capture.packageId}::uuid, 'ca000000-0000-4000-8000-000000000207'::uuid,
        1, 'succeeded', ${NOW}, ${NOW}, ${NOW}
      )
    `;
    await tx`
      INSERT INTO capture_results (
        tenant_id, project_id, capture_session_id, package_id, attempt_id, id, status,
        normalized_input_sha256, package_manifest_sha256, converter_manifest_sha256,
        result_sha256, result_payload, created_at
      ) VALUES (
        ${LIVE_IDS.tenant}::uuid, ${LIVE_IDS.project}::uuid, ${fixture.capture.captureSessionId}::uuid,
        ${fixture.capture.packageId}::uuid, 'ca000000-0000-4000-8000-000000000207'::uuid,
        ${fixture.capture.proposalId}::uuid, 'proposal', ${fixture.capture.converter.normalizedInputSha256},
        ${fixture.capture.packageManifestSha256}, ${fixture.capture.converter.manifestSha256},
        ${fixture.captureSha256}, ${tx.json(fixture.capture)}, ${NOW}
      )
    `;
  });
  return fixture;
}

const unavailableStorage = {
  abortMultipartUpload: async () => {
    throw new Error("Live C9 acceptance does not permit object-storage writes.");
  },
  completeMultipartUpload: async () => {
    throw new Error("Live C9 acceptance does not permit object-storage writes.");
  },
  createMultipartUpload: async () => {
    throw new Error("Live C9 acceptance does not permit object-storage writes.");
  },
  readiness: async () => undefined,
  signObjectAccess: async () => {
    throw new Error("Live C9 acceptance does not permit object-storage reads.");
  },
  signUploadPart: async () => {
    throw new Error("Live C9 acceptance does not permit object-storage writes.");
  },
};

async function assertOutcome(sql) {
  const rows = await sql`
    SELECT
      (SELECT count(*)::int FROM canonical_model_snapshots
        WHERE tenant_id = ${LIVE_IDS.tenant}::uuid AND project_id = ${LIVE_IDS.project}::uuid) AS snapshot_count,
      (SELECT revision FROM model_branches
        WHERE tenant_id = ${LIVE_IDS.tenant}::uuid AND project_id = ${LIVE_IDS.project}::uuid
          AND id = ${LIVE_IDS.branch}::uuid) AS branch_revision,
      (SELECT count(*)::int FROM fusion_jobs
        WHERE tenant_id = ${LIVE_IDS.tenant}::uuid AND project_id = ${LIVE_IDS.project}::uuid
          AND state IN ('proposed', 'abstained')) AS terminal_jobs,
      (SELECT count(*)::int FROM fusion_proposals
        WHERE tenant_id = ${LIVE_IDS.tenant}::uuid AND project_id = ${LIVE_IDS.project}::uuid) AS proposals,
      (SELECT count(*)::int FROM fusion_operation_drafts
        WHERE tenant_id = ${LIVE_IDS.tenant}::uuid AND project_id = ${LIVE_IDS.project}::uuid) AS drafts
  `;
  const result = rows[0];
  if (
    result?.snapshot_count !== 1 ||
    result.branch_revision !== 0 ||
    result.terminal_jobs < 1 ||
    result.proposals < 1 ||
    result.drafts < 1
  ) {
    throw new Error(`C9 live invariant failure: ${JSON.stringify(result)}`);
  }
  process.stdout.write(`${JSON.stringify({ event: "c9-live-assertion", ...result })}\n`);
}

async function main() {
  const databaseUrl = process.env.C9_LIVE_DATABASE_URL;
  if (!databaseUrl) throw new Error("C9_LIVE_DATABASE_URL is required.");
  const command = process.argv[2] ?? "serve";
  const sql = createC1Sql(databaseUrl);
  if (command === "assert") {
    try {
      await assertOutcome(sql);
    } finally {
      await sql.end({ timeout: 5 });
    }
    return;
  }
  await migrate(sql);
  const fixture = await seed(sql);
  const environment = {
    C1_AUTH_MODE: "local",
    C1_DATABASE_URL: databaseUrl,
    NODE_ENV: "development",
    PLATFORM_API_HOST: "127.0.0.1",
    PLATFORM_API_LOG_LEVEL: "silent",
    PLATFORM_API_PORT: process.env.C9_LIVE_API_PORT ?? "4119",
  };
  const server = createServer({
    c1: { database: sql },
    c4: { database: sql },
    c5: { database: sql },
    c6: { database: sql },
    c7: { database: sql, storage: unavailableStorage },
    c8: { database: sql },
    c9: { database: sql },
    environment,
    logger: false,
  });
  const port = Number(environment.PLATFORM_API_PORT);
  await server.listen({ host: "127.0.0.1", port });
  process.stdout.write(
    `${JSON.stringify({
      baseSha256: fixture.baseSha256,
      branchId: LIVE_IDS.branch,
      event: "c9-live-ready",
      firstWallId: fixture.firstWallId,
      projectId: LIVE_IDS.project,
      url: `http://127.0.0.1:${String(port)}`,
    })}\n`,
  );
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await server.close();
    await sql.end({ timeout: 5 });
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}

await main();
