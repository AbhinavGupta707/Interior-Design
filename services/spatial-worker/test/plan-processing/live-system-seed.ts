import { PutObjectCommand } from "@aws-sdk/client-s3";
import {
  c6PlanParserInputSchemaVersion,
  c6PlanPolicy,
  canonicalHomeSnapshotSchema,
  planParserRequestSchema,
} from "@interior-design/contracts";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import postgres from "postgres";
import sharp from "sharp";

import { IsolatedPlanParserPort } from "../../src/plan-processing/isolated-parser.js";
import { PlanNormalizer } from "../../src/plan-processing/normalizer.js";
import { validatePlanParserOutput } from "../../src/plan-processing/parser.js";
import { PostgresPlanProcessingQueue } from "../../src/plan-processing/postgres.js";
import { PlanProcessingRunner } from "../../src/plan-processing/runner.js";
import { createS3Client, S3ObjectStorage } from "../../src/storage.js";
import { parseWorkerConfig } from "../../src/config.js";

const alphaTenantId = "10000000-0000-4000-8000-000000000001";
const apiBaseUrl = process.env.C6_LIVE_API_URL ?? "http://127.0.0.1:3001";
const databaseUrl =
  process.env.C6_LIVE_DATABASE_URL ??
  "postgresql://localdev:local-development-only@127.0.0.1:54321/interior_c6_api";

function emptyCanonicalSnapshot(projectId: string, modelId: string) {
  const levelId = randomUUID();
  const origin = {
    actorUserId: "20000000-0000-4000-8000-000000000001",
    claimId: randomUUID(),
    evidenceIds: [],
    method: { kind: "fixture", name: "Synthetic C6 live gate", version: "1" },
    state: "user-asserted",
    verification: { status: "not-reviewed" },
  };
  const unknown = (reason: "not-observed" | "not-provided") => ({
    attribution: {
      claimId: randomUUID(),
      evidenceIds: [],
      method: { kind: "fixture", name: "Synthetic C6 live gate", version: "1" },
      reason,
      state: "unknown",
      verification: { status: "not-reviewed" },
    },
    knowledge: "unknown",
  });
  return canonicalHomeSnapshotSchema.parse({
    coordinateSystem: {
      axes: { x: "east", y: "north", z: "up" },
      globalAnchor: { status: "not-established" },
      handedness: "right",
      kind: "local-cartesian",
      lengthUnit: "mm",
      originConvention: "project-local-model-origin",
    },
    elements: {
      cameras: [],
      finishes: [],
      fixedObjects: [],
      furnishings: [],
      levels: [
        {
          elementType: "level",
          elevationMm: unknown("not-observed"),
          id: levelId,
          name: {
            attribution: { ...origin, claimId: randomUUID() },
            knowledge: "known",
            value: "Existing synthetic level",
          },
          origin,
          storeyHeightMm: unknown("not-provided"),
        },
      ],
      lights: [],
      openings: [],
      spaces: [],
      stairs: [],
      surfaces: [],
      walls: [],
    },
    knownLimitations: [
      {
        code: "SYNTHETIC_NOT_SURVEYED",
        detail: "Synthetic C6 live gate only; this is not surveyed or as-built truth.",
      },
    ],
    modelId,
    profile: "existing",
    projectId,
    schemaVersion: "c4-canonical-home-v1",
  });
}

async function apiRequest(
  pathname: string,
  options: {
    readonly body?: unknown;
    readonly idempotencyKey?: string;
    readonly method?: "GET" | "POST";
    readonly token?: string;
  } = {},
): Promise<Record<string, unknown>> {
  const headers = new Headers({ accept: "application/json, application/problem+json" });
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.idempotencyKey !== undefined) headers.set("idempotency-key", options.idempotencyKey);
  if (options.token !== undefined) headers.set("authorization", `Bearer ${options.token}`);
  const response = await fetch(`${apiBaseUrl}${pathname}`, {
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    headers,
    method: options.method ?? "GET",
  });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok || typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error(`Live seed API request failed safely with status ${String(response.status)}.`);
  }
  return payload as Record<string, unknown>;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing ${name}.`);
  return value;
}

const session = await apiRequest("/v1/auth/local/session", {
  body: { persona: "homeowner-alpha" },
  method: "POST",
});
const token = requiredString(session.accessToken, "local session token");
const project = await apiRequest("/v1/projects", {
  body: { name: `Synthetic C6 live ${randomUUID()}` },
  idempotencyKey: `c6-live-project-${randomUUID()}`,
  method: "POST",
  token,
});
const projectId = requiredString(project.id, "project id");
const modelId = randomUUID();
const initialized = await apiRequest(`/v1/projects/${projectId}/models/existing/snapshots`, {
  body: {
    expectedCurrentSnapshotSha256: null,
    snapshot: emptyCanonicalSnapshot(projectId, modelId),
  },
  idempotencyKey: `c6-live-model-${randomUUID()}`,
  method: "POST",
  token,
});
const snapshotSha256 = requiredString(initialized.snapshotSha256, "snapshot hash");

const assetId = randomUUID();
const sourceObjectKey = `sources/${randomUUID()}`;
const source = Buffer.from(
  '<svg viewBox="0 0 100 80"><rect x="10" y="10" width="80" height="60"/></svg>',
  "utf8",
);
const sourceSha256 = createHash("sha256").update(source).digest("hex");
const preview = await sharp({
  create: { background: "white", channels: 3, height: 80, width: 100 },
})
  .composite([
    {
      input: Buffer.from(
        '<svg width="100" height="80"><rect x="10" y="10" width="80" height="60" fill="none" stroke="#192c25" stroke-width="2"/></svg>',
      ),
    },
  ])
  .png()
  .toBuffer();
const previewSha256 = createHash("sha256").update(preview).digest("hex");
const previewObjectKey = `projects/${projectId}/assets/${assetId}/preview/${previewSha256}.png`;

const workerConfig = parseWorkerConfig({
  C2_DATABASE_URL: databaseUrl,
  C2_S3_ACCESS_KEY_ID: "localdev",
  C2_S3_ENDPOINT: "http://127.0.0.1:8333",
  C2_S3_FORCE_PATH_STYLE: "true",
  C2_S3_REGION: "local",
  C2_S3_SECRET_ACCESS_KEY: "local-development-only",
  NODE_ENV: "development",
});
const s3Client = createS3Client(workerConfig);
const sql = postgres(databaseUrl, { max: 4, onnotice: () => undefined, prepare: true });
try {
  await s3Client.send(
    new PutObjectCommand({
      Body: source,
      Bucket: "source",
      ContentLength: source.byteLength,
      ContentType: "image/svg+xml",
      Key: sourceObjectKey,
      Metadata: { sha256: sourceSha256 },
    }),
  );
  await s3Client.send(
    new PutObjectCommand({
      Body: preview,
      Bucket: "derived",
      ContentLength: preview.byteLength,
      ContentType: "image/png",
      Key: previewObjectKey,
      Metadata: { sha256: previewSha256 },
    }),
  );
  await sql.begin(async (transaction) => {
    await transaction`
      INSERT INTO assets (
        id, tenant_id, project_id, kind, file_name, declared_mime_type,
        detected_mime_type, source_byte_size, source_sha256, source_object_key, status
      ) VALUES (
        ${assetId}::uuid, ${alphaTenantId}::uuid, ${projectId}::uuid, 'plan',
        'synthetic-live-plan.svg', 'image/svg+xml', 'image/svg+xml', ${source.byteLength},
        ${sourceSha256}, ${sourceObjectKey}, 'ready'
      )
    `;
    await transaction`
      INSERT INTO asset_rights_assertions (
        tenant_id, project_id, asset_id, basis, service_processing_consent, training_use_consent
      ) VALUES (
        ${alphaTenantId}::uuid, ${projectId}::uuid, ${assetId}::uuid,
        'owned-by-user', true, 'denied'
      )
    `;
    await transaction`
      INSERT INTO derived_asset_artifacts (
        id, tenant_id, project_id, asset_id, bucket, object_key, kind, mime_type, byte_size, sha256
      ) VALUES (
        ${randomUUID()}::uuid, ${alphaTenantId}::uuid, ${projectId}::uuid, ${assetId}::uuid,
        'derived', ${previewObjectKey}, 'preview', 'image/png', ${preview.byteLength},
        ${previewSha256}
      )
    `;
  });
  const job = await apiRequest(`/v1/projects/${projectId}/plan-processing-jobs`, {
    body: { assetId, pageIndex: 0, parserPreference: "fixture" },
    idempotencyKey: `c6-live-job-${randomUUID()}`,
    method: "POST",
    token,
  });
  const jobId = requiredString(job.id, "job id");
  const storage = new S3ObjectStorage(s3Client);
  const storedChunks: Buffer[] = [];
  for await (const chunk of await storage.openSource("source", sourceObjectKey))
    storedChunks.push(Buffer.from(chunk));
  if (!Buffer.concat(storedChunks).equals(source))
    throw new Error("The live source object did not round-trip exactly.");
  const preflightWorkspace = await mkdtemp(path.join(tmpdir(), "c6-live-preflight-"));
  try {
    const preflightSourcePath = path.join(preflightWorkspace, "source.svg");
    await writeFile(preflightSourcePath, source, { mode: 0o600 });
    const normalizer = new PlanNormalizer({
      pdfInfo: "pdfinfo",
      pdfToCairo: "pdftocairo",
      pdfToPpm: "pdftoppm",
      popplerVersion: "local-poppler",
    });
    const normalized = await normalizer.normalize({
      detectedMimeType: "image/svg+xml",
      expectedByteSize: source.byteLength,
      expectedSha256: sourceSha256,
      pageIndex: 0,
      parserPreference: "fixture",
      sourcePath: preflightSourcePath,
      workspaceDirectory: preflightWorkspace,
    });
    const parserInput = {
      ...normalized,
      request: planParserRequestSchema.parse({
        jobId,
        limits: {
          maximumCandidates: c6PlanPolicy.maximumCandidates,
          maximumOutputBytes: c6PlanPolicy.maximumParserOutputBytes,
          timeoutMilliseconds: c6PlanPolicy.parserTimeoutMilliseconds,
        },
        normalizers: normalized.normalizers,
        normalizedInputSha256: normalized.sha256,
        parserMode: normalized.mode,
        schemaVersion: c6PlanParserInputSchemaVersion,
        source: {
          assetId,
          byteSize: source.byteLength,
          coordinateSpace: normalized.coordinateSpace,
          detectedMimeType: "image/svg+xml",
          heightSourceUnits: normalized.heightSourceUnits,
          pageIndex: 0,
          projectId,
          rights: {
            basis: "owned-by-user",
            serviceProcessingConsent: true,
            trainingUseConsent: "denied",
          },
          sha256: sourceSha256,
          widthSourceUnits: normalized.widthSourceUnits,
        },
      }),
    };
    const parser = new IsolatedPlanParserPort({
      arguments: ["-m", "inference_worker.plan_parser"],
      command: process.env.C6_TEST_PYTHON ?? "python3",
      pythonPath: path.resolve(import.meta.dirname, "../../../inference-worker/src"),
    });
    validatePlanParserOutput(parserInput, await parser.parse(parserInput));
  } finally {
    await rm(preflightWorkspace, { force: true, recursive: true });
  }
  const runner = new PlanProcessingRunner({
    heartbeatMilliseconds: 5_000,
    leaseMilliseconds: 60_000,
    logger: {
      error: () => undefined,
      info: () => undefined,
      warn: () => undefined,
    },
    normalizer: new PlanNormalizer({
      pdfInfo: "pdfinfo",
      pdfToCairo: "pdftocairo",
      pdfToPpm: "pdftoppm",
      popplerVersion: "local-poppler",
    }),
    parser: new IsolatedPlanParserPort({
      arguments: ["-m", "inference_worker.plan_parser"],
      command: process.env.C6_TEST_PYTHON ?? "python3",
      pythonPath: path.resolve(import.meta.dirname, "../../../inference-worker/src"),
    }),
    pollMilliseconds: 100,
    queue: new PostgresPlanProcessingQueue(sql),
    storage,
    temporaryMaximumBytes: 268_435_456,
    temporaryRoot: tmpdir(),
    workerId: `c6-live-${randomUUID()}`,
  });
  let currentJobState = "queued";
  for (let processed = 0; processed < 20 && currentJobState === "queued"; processed += 1) {
    if ((await runner.processNext()) === "idle")
      throw new Error("The live C6 queue became idle before the seeded job was terminal.");
    const currentJob = await apiRequest(`/v1/projects/${projectId}/plan-processing-jobs/${jobId}`, {
      token,
    });
    currentJobState = requiredString(currentJob.state, "job state");
  }
  if (currentJobState !== "proposed")
    throw new Error(`The seeded live C6 job reached safe state ${currentJobState}.`);
  const proposal = await apiRequest(
    `/v1/projects/${projectId}/plan-processing-jobs/${jobId}/proposal`,
    { token },
  );
  if (proposal.status !== "proposal") throw new Error("Live C6 parser did not publish a proposal.");
  const branches = await apiRequest(`/v1/projects/${projectId}/models/existing/branches`, {
    token,
  });
  const branchValues = branches.branches;
  let branch: unknown;
  if (Array.isArray(branchValues)) branch = (branchValues as unknown[])[0];
  if (typeof branch !== "object" || branch === null || Array.isArray(branch))
    throw new Error("Live C5 branch was not initialized.");
  process.stdout.write(
    `${JSON.stringify({
      assetId,
      branchId: requiredString((branch as Record<string, unknown>).id, "branch id"),
      jobId,
      normalizedInputSha256: requiredString(
        proposal.normalizedInputSha256,
        "normalized input hash",
      ),
      parserManifestSha256: requiredString(
        (proposal.parser as Record<string, unknown> | undefined)?.manifestSha256,
        "parser manifest hash",
      ),
      projectId,
      proposalId: requiredString(proposal.proposalId, "proposal id"),
      snapshotSha256,
      sourceSha256,
    })}\n`,
  );
} finally {
  s3Client.destroy();
  await sql.end({ timeout: 5 });
}
