import { createReconstructionJobRequestSchema } from "@interior-design/contracts";
import {
  PostgresReconstructionRepository,
  ReconstructionService,
} from "@interior-design/platform-api/reconstruction";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MediaPreparationPipeline } from "../../src/media-prep/index.js";
import { PythonReconstructionProcessor } from "../../src/reconstruction/processor.js";
import { ReconstructionProcessingRunner } from "../../src/reconstruction/runner.js";
import { PostgresReconstructionSourceLoader } from "../../src/reconstruction/source.js";
import type { DerivedWrite, ObjectStorage } from "../../src/storage.js";
import {
  acceptingPrivacyReviewer,
  sha256,
  SyntheticMediaProcess,
  syntheticPng,
} from "../media-prep/fixtures.js";

const databaseUrl = process.env.C8_TEST_DATABASE_URL ?? "";
const describeWithPostgres = databaseUrl.length === 0 ? describe.skip : describe;
const logger = { debug() {}, error() {}, info() {}, warn() {} };

class MemoryStorage implements ObjectStorage {
  readonly source: Uint8Array;
  writes: Array<DerivedWrite & { readonly bytes: Buffer }> = [];

  constructor(source: Uint8Array) {
    this.source = source;
  }

  openSource(): Promise<AsyncIterable<Uint8Array>> {
    const bytes = this.source;
    return Promise.resolve(
      (async function* stream() {
        await Promise.resolve();
        yield bytes;
      })(),
    );
  }

  async putDerivedIfAbsent(write: DerivedWrite): Promise<"created"> {
    this.writes.push({ ...write, bytes: await readFile(write.filePath) });
    return "created";
  }
}

describeWithPostgres("C8 live composed database/worker path", () => {
  let sql!: Sql;
  let root = "";
  let displayName = "";
  let subject = "";
  let tenantId = "";
  let userId = "";

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "c8-live-runner-"));
    sql = postgres(databaseUrl, { max: 4, onnotice: () => undefined });
    const markers = await sql<{ readonly id: string }[]>`
      SELECT id FROM platform_schema_migrations WHERE id = '0008_reconstruction'
    `;
    if (markers.length !== 1) {
      throw new Error("C8 live worker test requires the migrated disposable C8 database.");
    }
    const owners = await sql<
      Array<{
        readonly display_name: string;
        readonly subject: string;
        readonly tenant_id: string;
        readonly user_id: string;
      }>
    >`
      SELECT m.tenant_id, m.user_id, u.display_name, u.subject
      FROM identity_memberships m
      JOIN identity_users u ON u.id = m.user_id
      WHERE m.role = 'owner' ORDER BY m.created_at, m.user_id LIMIT 1
    `;
    const owner = owners[0];
    if (owner === undefined) throw new Error("C8 live worker test requires an owner fixture.");
    tenantId = owner.tenant_id;
    userId = owner.user_id;
    displayName = owner.display_name;
    subject = owner.subject;
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
    await rm(root, { force: true, recursive: true });
  });

  it("moves an exact rights-cleared source through preparation and atomic abstention publication", async () => {
    const owner = { displayName, role: "owner" as const, subject, tenantId, userId };
    const projectId = randomUUID();
    const assetId = randomUUID();
    const bytes = await syntheticPng();
    const sourceSha256 = sha256(bytes);
    const sourceObjectKey = `sources/${randomUUID()}`;
    await sql`
      INSERT INTO projects (id, tenant_id, name)
      VALUES (${projectId}::uuid, ${tenantId}::uuid, 'Synthetic C8 worker project')
    `;
    await sql`
      INSERT INTO assets (
        id, tenant_id, project_id, kind, file_name, declared_mime_type,
        detected_mime_type, source_byte_size, source_sha256, source_object_key, status
      ) VALUES (
        ${assetId}::uuid, ${tenantId}::uuid, ${projectId}::uuid, 'photograph',
        'synthetic-room.png', 'image/png', 'image/png', ${bytes.byteLength},
        ${sourceSha256}, ${sourceObjectKey}, 'ready'
      )
    `;
    await sql`
      INSERT INTO asset_rights_assertions (
        tenant_id, project_id, asset_id, basis,
        service_processing_consent, training_use_consent
      ) VALUES (
        ${tenantId}::uuid, ${projectId}::uuid, ${assetId}::uuid,
        'owned-by-user', true, 'denied'
      )
    `;
    const request = createReconstructionJobRequestSchema.parse({
      appearanceMode: "disabled",
      label: "Synthetic single-frame abstention",
      mode: "rgb-sfm",
      registrationAnchors: [],
      rights: {
        basis: "owned-by-user",
        serviceProcessingConsent: true,
        trainingUseConsent: "denied",
      },
      sources: [
        {
          assetId,
          byteSize: bytes.byteLength,
          detectedMimeType: "image/png",
          kind: "rgb-image",
          sha256: sourceSha256,
        },
      ],
    });
    const repository = new PostgresReconstructionRepository(sql);
    const service = new ReconstructionService(repository, { record: () => undefined });
    const created = await service.createJob({
      actor: owner,
      correlation: {
        requestId: `c8-live-${randomUUID()}`,
        spanId: "1".repeat(16),
        traceId: "2".repeat(32),
        traceParent: `00-${"2".repeat(32)}-${"1".repeat(16)}-01`,
      },
      idempotencyKey: `c8-live-${randomUUID()}`,
      projectId,
      request,
    });
    const storage = new MemoryStorage(bytes);
    const runner = new ReconstructionProcessingRunner({
      logger,
      media: new MediaPreparationPipeline({
        privacyReviewer: acceptingPrivacyReviewer,
        process: new SyntheticMediaProcess(),
        temporaryRoot: root,
      }),
      pollMilliseconds: 1,
      processor: new PythonReconstructionProcessor({
        pythonModuleRoot: path.resolve(root, "unused-for-one-frame"),
        storage,
        temporaryRoot: root,
      }),
      queue: repository,
      sources: new PostgresReconstructionSourceLoader(sql),
      storage,
      workerId: "c8-live-composed-worker",
    });
    await expect(runner.processNext()).resolves.toBe("processed");
    const job = await repository.findJob(tenantId, projectId, created.job.id);
    const result = await repository.findResult(tenantId, projectId, created.job.id);
    expect(job).toMatchObject({
      safeCode: "RECONSTRUCTION_INSUFFICIENT_FRAMES",
      state: "abstained",
    });
    expect(result).toMatchObject({
      safeCode: "RECONSTRUCTION_INSUFFICIENT_FRAMES",
      status: "abstained",
    });
    expect(storage.writes).toHaveLength(1);
    const canonicalRows = await sql<{ readonly count: number }[]>`
      SELECT count(*)::int AS count FROM canonical_model_snapshots
      WHERE tenant_id = ${tenantId}::uuid AND project_id = ${projectId}::uuid
    `;
    expect(canonicalRows[0]?.count).toBe(0);
  });
});
