import {
  c13CatalogReleaseSchemaVersion,
  catalogReleaseSchema,
  createOptionJobRequestSchema,
  interiorAssetRefSchema,
  type CatalogAssetVersion,
} from "@interior-design/contracts";
import { DeterministicDesignBriefKernel } from "@interior-design/design-brief";
import { randomUUID } from "node:crypto";
import type { JSONValue, Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrapC1Fixtures, createC1Sql } from "../../../src/c1.js";
import { PostgresBriefRepository } from "../../../src/modules/briefs/postgres.js";
import { BriefService } from "../../../src/modules/briefs/service.js";
import { PostgresBriefSourceVerifier } from "../../../src/modules/briefs/sources.js";
import { PostgresDesignOptionRepository } from "../../../src/modules/design-options/postgres.js";
import { DesignOptionService } from "../../../src/modules/design-options/service.js";
import { PostgresDesignOptionSourceVerifier } from "../../../src/modules/design-options/sources.js";
import { DesignOptionWorkerRuntime } from "../../../src/modules/design-options/worker.js";
import { ModelOperationService } from "../../../src/modules/models/operations/service.js";
import { PostgresModelOperationRepository } from "../../../src/modules/models/operations/postgres.js";
import { PostgresProjectRepository } from "../../../src/modules/projects/repository.js";
import { PostgresSpecificationRepository } from "../../../src/modules/specifications/postgres.js";
import { SpecificationService } from "../../../src/modules/specifications/service.js";
import { householdEntry } from "../../c11/briefs/support.js";
import { canonicalSnapshotFixture } from "../../c4/fixtures.js";
import {
  actor,
  assetManifestSha256,
  constraint,
  correlation,
  MutableClock,
  publication,
} from "../../c12/support.js";
import { MutableSpecificationClock, only, required, wrapCatalogAsset } from "./support.js";

const databaseUrl = process.env.C13_TEST_DATABASE_URL ?? "";
const describeWithPostgres = databaseUrl.length === 0 ? describe.skip : describe;

function json(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

async function publishAsset(
  sql: Sql,
  projectId: string,
  asset: CatalogAssetVersion,
  publishedAt: string,
): Promise<void> {
  await sql`
    INSERT INTO catalog_asset_versions (
      tenant_id, project_id, id, asset_id, schema_version, kind, version,
      version_sha256, lifecycle, rights_record_sha256, rights_review_state,
      placement_projection_sha256, c12_asset_content_sha256,
      c12_asset_metadata_sha256, c12_placement_policy_sha256, asset_payload,
      published_by, published_at
    ) VALUES (
      ${actor.tenantId}::uuid, ${projectId}::uuid, ${asset.versionId}::uuid,
      ${asset.assetId}::uuid, ${asset.schemaVersion}, ${asset.kind}, ${asset.version},
      ${asset.versionSha256}, ${asset.lifecycle}, ${asset.rights.recordSha256},
      ${asset.rights.review.state}, ${asset.placementProjection.projectionSha256},
      ${asset.placementProjection.c12Asset.contentSha256},
      ${asset.placementProjection.c12Asset.metadataSha256},
      ${asset.placementProjection.c12Asset.placementPolicy.policySha256},
      ${sql.json(json(asset))}, ${actor.userId}::uuid,
      ${publishedAt}::timestamptz
    )
  `;
}

describeWithPostgres("C13 live PostgreSQL specification lifecycle", () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = createC1Sql(databaseUrl);
    await bootstrapC1Fixtures(sql, "test");
  });

  afterAll(async () => sql.end({ timeout: 5 }));

  it("joins C12 authoritatively and atomically advances C5 plus the immutable specification", async () => {
    const project = await new PostgresProjectRepository(sql).create({
      actor,
      correlation,
      idempotencyKey: randomUUID(),
      request: { name: `Synthetic C13 PostgreSQL ${randomUUID()}` },
    });
    const modelId = randomUUID();
    const modelService = new ModelOperationService(new PostgresModelOperationRepository(sql));
    const source = await modelService.initialize({
      actor,
      correlation,
      expectedCurrentSnapshotSha256: null,
      idempotencyKey: randomUUID(),
      profile: "existing",
      projectId: project.id,
      snapshot: canonicalSnapshotFixture({ modelId, projectId: project.id }),
    });

    const briefClock = new MutableClock();
    briefClock.value = new Date("2026-07-18T11:00:00.000Z");
    const briefRepository = new PostgresBriefRepository(sql, new DeterministicDesignBriefKernel(), {
      clock: briefClock,
    });
    const briefService = new BriefService({
      repository: briefRepository,
      sources: new PostgresBriefSourceVerifier(sql),
    });
    const draft = await briefService.update({
      actor,
      correlation,
      projectId: project.id,
      request: {
        expectedRevision: 0,
        idempotencyKey: randomUUID(),
        operations: [{ entry: householdEntry(randomUUID()), kind: "entry.add" }],
      },
    });
    briefClock.advance(1);
    const accepted = await briefService.accept({
      actor,
      correlation,
      projectId: project.id,
      request: { expectedRevision: draft.record.brief.revision, idempotencyKey: randomUUID() },
    });

    const optionClock = new MutableClock();
    const optionRepository = new PostgresDesignOptionRepository(sql, {
      assetVerifier: { verifyExact: () => Promise.resolve(true) },
      clock: optionClock,
    });
    const optionService = new DesignOptionService({
      constraintDeriver: {
        derive: () => Promise.resolve({ assetManifestSha256, constraints: [constraint] }),
      },
      repository: optionRepository,
      sourceVerifier: new PostgresDesignOptionSourceVerifier(sql),
    });
    const optionRequest = createOptionJobRequestSchema.parse({
      baseBrief: {
        briefId: accepted.record.brief.id,
        contentSha256: accepted.record.contentSha256,
        revision: accepted.record.brief.revision,
      },
      requestedDirections: ["circulation-first", "conversation-first"],
      requestedOptionCount: 2,
      sourceModel: {
        modelId,
        profile: "existing",
        snapshotId: source.record.id,
        snapshotSha256: source.record.snapshotSha256,
        snapshotVersion: source.record.version,
      },
    });
    const created = await optionService.createJob({
      actor,
      correlation,
      idempotencyKey: randomUUID(),
      projectId: project.id,
      request: optionRequest,
    });
    const worker = new DesignOptionWorkerRuntime(optionRepository);
    optionClock.advance(1);
    const lease = await worker.claimNext({ leaseSeconds: 60, workerId: "c13-synthetic-worker" });
    if (lease === undefined || lease.job.id !== created.job.id) {
      throw new Error("Expected the synthetic C13 predecessor job lease.");
    }
    let job = lease.job;
    for (const stage of ["generating", "validating", "publishing"] as const) {
      optionClock.advance(1);
      job = await worker.advance({
        attempt: lease.attempt,
        expectedJobVersion: job.version,
        jobId: job.id,
        leaseToken: lease.leaseToken,
        projectId: project.id,
        stage,
        tenantId: actor.tenantId,
        workerId: "c13-synthetic-worker",
      });
    }
    const generated = publication(job, lease.workingSnapshot);
    optionClock.advance(1);
    const succeeded = await worker.publish({
      attempt: lease.attempt,
      expectedJobVersion: job.version,
      jobId: job.id,
      leaseToken: lease.leaseToken,
      optionSet: generated.optionSet,
      options: generated.options,
      projectId: project.id,
      tenantId: actor.tenantId,
      workerId: "c13-synthetic-worker",
    });
    const selected = required(generated.options[0], "Synthetic generated option missing.");
    optionClock.advance(1);
    const predecessor = await optionService.confirmOption({
      actor,
      correlation,
      jobId: succeeded.id,
      optionId: selected.id,
      projectId: project.id,
      request: {
        expectedBriefContentSha256: succeeded.baseBrief.contentSha256,
        expectedBriefRevision: succeeded.baseBrief.revision,
        expectedJobVersion: succeeded.version,
        expectedOptionSetSha256: generated.optionSet.setSha256,
        expectedOptionStatus: "pending",
        expectedSourceSnapshotSha256: succeeded.sourceModel.snapshotSha256,
        idempotencyKey: randomUUID(),
      },
    });

    const c12Asset = only(selected.operationBundle.assetPlacements).asset;
    const initialAsset = wrapCatalogAsset(c12Asset);
    const replacementRef = interiorAssetRefSchema.parse({
      ...c12Asset,
      contentSha256: "6".repeat(64),
      geometryEnvelopeMm: {
        ...c12Asset.geometryEnvelopeMm,
        widthMm: Math.max(1, c12Asset.geometryEnvelopeMm.widthMm - 100),
      },
      id: randomUUID(),
      metadataSha256: "7".repeat(64),
      placementPolicy: { ...c12Asset.placementPolicy, policySha256: "8".repeat(64) },
      rights: { ...c12Asset.rights, rightsRecordSha256: "9".repeat(64) },
      version: "2.0.0",
      versionId: randomUUID(),
    });
    const replacementAsset = wrapCatalogAsset(replacementRef, {
      versionSha256: "a".repeat(64),
    });
    const releaseId = randomUUID();
    const releaseSha256 = "f".repeat(64);
    const publishedAt = "2026-07-18T13:00:00.000Z";
    const release = catalogReleaseSchema.parse({
      assetVersionIds: [initialAsset.versionId, replacementAsset.versionId],
      createdAt: publishedAt,
      manifestSha256: releaseSha256,
      releaseId,
      schemaVersion: c13CatalogReleaseSchemaVersion,
      status: "published",
      version: "1.0.0",
    });
    await sql`
      INSERT INTO catalog_releases (
        tenant_id, project_id, id, schema_version, version, manifest_sha256,
        status, release_payload, published_by, published_at
      ) VALUES (
        ${actor.tenantId}::uuid, ${project.id}::uuid, ${releaseId}::uuid,
        ${release.schemaVersion}, ${release.version}, ${releaseSha256}, 'published',
        ${sql.json(json(release))}, ${actor.userId}::uuid,
        ${publishedAt}::timestamptz
      )
    `;
    await publishAsset(sql, project.id, initialAsset, publishedAt);
    await publishAsset(sql, project.id, replacementAsset, publishedAt);
    for (const [ordinal, asset] of [initialAsset, replacementAsset].entries()) {
      await sql`
        INSERT INTO catalog_release_assets (
          tenant_id, project_id, release_id, release_sha256,
          asset_version_id, asset_version_sha256, ordinal
        ) VALUES (
          ${actor.tenantId}::uuid, ${project.id}::uuid, ${releaseId}::uuid,
          ${releaseSha256}, ${asset.versionId}::uuid, ${asset.versionSha256}, ${ordinal}
        )
      `;
    }

    const specificationClock = new MutableSpecificationClock();
    const repository = new PostgresSpecificationRepository(sql, { clock: specificationClock });
    const sceneRequests: unknown[] = [];
    const service = new SpecificationService({
      clock: specificationClock,
      repository,
      sceneJobs: {
        requestExactRevision(request) {
          sceneRequests.push(structuredClone(request));
          return Promise.resolve();
        },
      },
    });
    const createKey = randomUUID();
    const createRequest = {
      catalogReleaseId: releaseId,
      catalogReleaseSha256: releaseSha256,
      confirmationId: predecessor.confirmation.id,
    };
    const specification = await service.create({
      actor,
      correlation,
      idempotencyKey: createKey,
      projectId: project.id,
      request: createRequest,
    });
    expect(
      await service.create({
        actor,
        correlation,
        idempotencyKey: createKey,
        projectId: project.id,
        request: createRequest,
      }),
    ).toEqual({ replayed: true, specification: specification.specification });
    expect(specification.specification.currentRevision.lines).toHaveLength(1);

    specificationClock.advance(1);
    const line = only(specification.specification.currentRevision.lines);
    const branchId = specification.specification.currentRevision.branchId;
    const preview = await service.createPreview({
      actor,
      correlation,
      idempotencyKey: randomUUID(),
      projectId: project.id,
      request: {
        elementId: line.elementId,
        expectedBranchRevision: specification.specification.currentRevision.branchRevision,
        expectedSpecificationRevision: 1,
        replacementAssetVersionId: replacementAsset.versionId,
      },
      specificationId: specification.specification.specificationId,
    });
    const before = await sql<
      { readonly branch_revision: number; readonly specification_revision: number }[]
    >`
      SELECT
        (SELECT revision FROM model_branches WHERE tenant_id = ${actor.tenantId}::uuid
          AND project_id = ${project.id}::uuid AND id = ${branchId}::uuid)
          AS branch_revision,
        (SELECT current_revision FROM specifications WHERE tenant_id = ${actor.tenantId}::uuid
          AND project_id = ${project.id}::uuid
          AND id = ${specification.specification.specificationId}::uuid)
          AS specification_revision
    `;
    expect(before[0]).toEqual({ branch_revision: 1, specification_revision: 1 });

    specificationClock.advance(1);
    const confirmed = await service.confirm({
      actor,
      correlation,
      idempotencyKey: randomUUID(),
      projectId: project.id,
      request: {
        expectedCandidateSnapshotSha256: preview.preview.candidateSnapshotSha256,
        expectedSpecificationRevision: 1,
        previewId: preview.preview.previewId,
      },
      specificationId: specification.specification.specificationId,
    });
    expect(confirmed.sceneState).toBe("requested");
    expect(sceneRequests).toHaveLength(1);
    const binding = await repository.resolveConfirmedSceneBinding(
      actor.tenantId,
      project.id,
      confirmed.confirmation.sceneJobId,
    );
    expect(binding).toMatchObject({
      branchRevision: 2,
      catalogReleaseSha256: releaseSha256,
      modelSnapshotSha256: confirmed.confirmation.resultSnapshotSha256,
      specificationRevision: 2,
    });
    expect(binding?.lines[0]).toMatchObject({
      assetVersionId: replacementAsset.versionId,
      elementId: line.elementId,
    });
    const linked = await sql<
      {
        readonly branch_revision: number;
        readonly commits: number;
        readonly specification_revision: number;
      }[]
    >`
      SELECT
        (SELECT revision FROM model_branches WHERE tenant_id = ${actor.tenantId}::uuid
          AND project_id = ${project.id}::uuid AND id = ${branchId}::uuid)
          AS branch_revision,
        (SELECT count(*)::int FROM model_operation_commits WHERE tenant_id = ${actor.tenantId}::uuid
          AND project_id = ${project.id}::uuid AND branch_id = ${branchId}::uuid)
          AS commits,
        (SELECT current_revision FROM specifications WHERE tenant_id = ${actor.tenantId}::uuid
          AND project_id = ${project.id}::uuid
          AND id = ${specification.specification.specificationId}::uuid)
          AS specification_revision
    `;
    expect(linked[0]).toEqual({ branch_revision: 2, commits: 2, specification_revision: 2 });

    specificationClock.advance(1);
    const current = await service.get(
      actor.tenantId,
      project.id,
      specification.specification.specificationId,
    );
    const rollbackRepository = new PostgresSpecificationRepository(sql, {
      clock: specificationClock,
      failureInjector(stage) {
        if (stage === "after-model-write") {
          throw new Error("Synthetic failure after C5 writes.");
        }
      },
    });
    const rollbackService = new SpecificationService({
      clock: specificationClock,
      repository: rollbackRepository,
      sceneJobs: { requestExactRevision: () => Promise.resolve() },
    });
    const rollbackPreview = await rollbackService.createPreview({
      actor,
      correlation,
      idempotencyKey: randomUUID(),
      projectId: project.id,
      request: {
        elementId: only(current.currentRevision.lines).elementId,
        expectedBranchRevision: current.currentRevision.branchRevision,
        expectedSpecificationRevision: current.currentRevision.revision,
        replacementAssetVersionId: initialAsset.versionId,
      },
      specificationId: current.specificationId,
    });
    const rollbackRequest = {
      expectedCandidateSnapshotSha256: rollbackPreview.preview.candidateSnapshotSha256,
      expectedSpecificationRevision: current.currentRevision.revision,
      previewId: rollbackPreview.preview.previewId,
    };
    await expect(
      rollbackService.confirm({
        actor,
        correlation,
        idempotencyKey: randomUUID(),
        projectId: project.id,
        request: rollbackRequest,
        specificationId: current.specificationId,
      }),
    ).rejects.toThrow("Synthetic failure after C5 writes.");
    const afterRollback = await sql<
      {
        readonly branch_revision: number;
        readonly commits: number;
        readonly specification_revision: number;
      }[]
    >`
      SELECT
        (SELECT revision FROM model_branches WHERE tenant_id = ${actor.tenantId}::uuid
          AND project_id = ${project.id}::uuid AND id = ${branchId}::uuid) AS branch_revision,
        (SELECT count(*)::int FROM model_operation_commits WHERE tenant_id = ${actor.tenantId}::uuid
          AND project_id = ${project.id}::uuid AND branch_id = ${branchId}::uuid) AS commits,
        (SELECT current_revision FROM specifications WHERE tenant_id = ${actor.tenantId}::uuid
          AND project_id = ${project.id}::uuid AND id = ${current.specificationId}::uuid)
          AS specification_revision
    `;
    expect(afterRollback[0]).toEqual({ branch_revision: 2, commits: 2, specification_revision: 2 });

    specificationClock.advance(1);
    const concurrent = await Promise.allSettled([
      service.confirm({
        actor,
        correlation,
        idempotencyKey: randomUUID(),
        projectId: project.id,
        request: rollbackRequest,
        specificationId: current.specificationId,
      }),
      service.confirm({
        actor,
        correlation,
        idempotencyKey: randomUUID(),
        projectId: project.id,
        request: rollbackRequest,
        specificationId: current.specificationId,
      }),
    ]);
    expect(concurrent.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter(({ status }) => status === "rejected")).toHaveLength(1);
    const afterConcurrent = await service.get(actor.tenantId, project.id, current.specificationId);
    expect(afterConcurrent.currentRevision).toMatchObject({ branchRevision: 3, revision: 3 });
    expect(sceneRequests).toHaveLength(2);

    specificationClock.advance(1);
    const concurrentLine = only(afterConcurrent.currentRevision.lines);
    const boardUpdate = await service.updateSelectionBoard({
      actor,
      correlation,
      idempotencyKey: randomUUID(),
      projectId: project.id,
      request: {
        entries: [
          {
            assetVersionId: concurrentLine.assetVersionId,
            elementId: concurrentLine.elementId,
            note: "Synthetic post-substitution decision",
            state: "shortlisted",
          },
        ],
        expectedRevision: 3,
      },
      specificationId: current.specificationId,
    });
    expect(boardUpdate.specification.currentRevision).toMatchObject({
      branchRevision: 3,
      revision: 4,
    });
  });
});
