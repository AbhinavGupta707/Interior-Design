import {
  c13CatalogReleaseSchemaVersion,
  catalogAssetVersionSchema,
  catalogReleaseSchema,
  createOptionJobRequestSchema,
  createRenderJobRequestSchema,
  type CatalogAssetVersion,
  type RenderArtifactRole,
} from "../../../packages/contracts/src/index.js";
import {
  catalogCanonicalBytes,
  catalogSha256,
  deterministicCatalogUuid,
  sha256Bytes,
} from "../../../packages/catalog/src/index.js";
import { DeterministicDesignBriefKernel } from "../../../packages/design-brief/src/index.js";
import { parseProtectedC10Glb } from "../../../packages/render-scene/src/index.js";
import {
  assertExrMagic,
  canonicalJson,
  createOutputManifest,
  inspectPng,
  validateArtifactBytes,
  type RenderExecutionInput,
  type ValidatedRenderBundle,
} from "../../../workers/blender-renderer/src/index.js";
import { minimalExr, solidPng } from "../../../packages/render-evaluation/test/fixtures.js";
import { randomUUID, createHash } from "node:crypto";
import type { JSONValue, Sql } from "../../../services/platform-api/node_modules/postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { C10SpecificationSceneJobPort } from "../../../services/platform-api/src/c13.js";
import {
  applyC1Migration,
  bootstrapC1Fixtures,
  createC1Sql,
} from "../../../services/platform-api/src/c1.js";
import { applyC2Migration } from "../../../services/platform-api/src/c2.js";
import { applyC3Migration } from "../../../services/platform-api/src/c3.js";
import { applyC4Migration } from "../../../services/platform-api/src/c4.js";
import { applyC5Migration } from "../../../services/platform-api/src/c5.js";
import { applyC6Migration } from "../../../services/platform-api/src/c6.js";
import { applyC7Migration } from "../../../services/platform-api/src/c7.js";
import { applyC8Migration } from "../../../services/platform-api/src/c8.js";
import { applyC9Migration } from "../../../services/platform-api/src/c9.js";
import { applyC10Migration } from "../../../services/platform-api/src/c10.js";
import { applyC11Migration } from "../../../services/platform-api/src/c11.js";
import { applyC12Migration } from "../../../services/platform-api/src/c12.js";
import { applyC13Migration } from "../../../services/platform-api/src/c13.js";
import { applyC14Migration } from "../../../services/platform-api/src/c14.js";
import { PostgresBriefRepository } from "../../../services/platform-api/src/modules/briefs/postgres.js";
import { BriefService } from "../../../services/platform-api/src/modules/briefs/service.js";
import { PostgresBriefSourceVerifier } from "../../../services/platform-api/src/modules/briefs/sources.js";
import { PostgresCatalogRepository } from "../../../services/platform-api/src/modules/catalog/postgres.js";
import { PostgresDesignOptionRepository } from "../../../services/platform-api/src/modules/design-options/postgres.js";
import { DesignOptionService } from "../../../services/platform-api/src/modules/design-options/service.js";
import { PostgresDesignOptionSourceVerifier } from "../../../services/platform-api/src/modules/design-options/sources.js";
import { DesignOptionWorkerRuntime } from "../../../services/platform-api/src/modules/design-options/worker.js";
import { ModelOperationService } from "../../../services/platform-api/src/modules/models/operations/service.js";
import { PostgresModelOperationRepository } from "../../../services/platform-api/src/modules/models/operations/postgres.js";
import { PostgresProjectRepository } from "../../../services/platform-api/src/modules/projects/repository.js";
import {
  C10EmbeddedC13BindingInspector,
  C10RenderSceneAuthority,
  C13RenderSpecificationAuthority,
  EncryptedRenderArtifactBroker,
  FrozenRenderProfileAuthority,
  PortBackedRenderSourceResolver,
  PostgresRenderRepository,
  RenderStillService,
  RenderStillWorkerService,
  S3ExactSceneGlbReader,
  S3RenderObjectStorage,
} from "../../../services/platform-api/src/modules/render-stills/index.js";
import { PostgresSceneRepository } from "../../../services/platform-api/src/modules/scenes/postgres.js";
import {
  SceneService,
  SceneWorkerService,
} from "../../../services/platform-api/src/modules/scenes/service.js";
import { PostgresSceneSnapshotVerifier } from "../../../services/platform-api/src/modules/scenes/snapshot.js";
import { S3SceneObjectStorage } from "../../../services/platform-api/src/modules/scenes/storage.js";
import { PostgresSpecificationRepository } from "../../../services/platform-api/src/modules/specifications/postgres.js";
import { SpecificationService } from "../../../services/platform-api/src/modules/specifications/service.js";
import { parseWorkerConfig } from "../../../services/spatial-worker/src/config.js";
import { createJsonLogger } from "../../../services/spatial-worker/src/logger.js";
import {
  ExactC10RenderSourceMaterial,
  ExactC14RenderSceneBuilder,
  S3ExactCatalogManifestReader,
} from "../../../services/spatial-worker/src/render-stills/composition.js";
import { StatfsRenderDisk } from "../../../services/spatial-worker/src/render-stills/disk.js";
import { RenderStillRunner } from "../../../services/spatial-worker/src/render-stills/runner.js";
import { SceneCompilationRunner } from "../../../services/spatial-worker/src/scene-compile/runner.js";
import { createS3Client } from "../../../services/spatial-worker/src/storage.js";
import { S3CatalogPublicationStore } from "../../../services/spatial-worker/src/catalog/s3-publication.js";
import { householdEntry } from "../../../services/platform-api/test/c11/briefs/support.js";
import {
  actor,
  assetManifestSha256,
  constraint,
  correlation,
  MutableClock,
  publication,
} from "../../../services/platform-api/test/c12/support.js";
import { canonicalSnapshotFixture } from "../../../services/platform-api/test/c4/fixtures.js";
import {
  MutableSpecificationClock,
  only,
  required,
  wrapCatalogAsset,
} from "../../../services/platform-api/test/c13/specifications/support.js";

const databaseUrl = process.env.C14_RUNNER_TEST_DATABASE_URL ?? "";
const storageEndpoint = process.env.C14_RUNNER_TEST_STORAGE_ENDPOINT ?? "";
const describeLive =
  databaseUrl.length === 0 || storageEndpoint.length === 0 ? describe.skip : describe;

const inertRendererScriptSha256 = createHash("sha256")
  .update("c14-frozen-inert-renderer-boundary-v1")
  .digest("hex");
const inertExecutableSha256 = createHash("sha256")
  .update("c14-no-blender-local-control-plane-v1")
  .digest("hex");

const artifactRoles = [
  "geometry-safe-png",
  "multilayer-exr",
  "depth-exr",
  "normal-exr",
  "segmentation-png",
] as const satisfies readonly Exclude<RenderArtifactRole, "illustrative-enhancement-png">[];

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

function deterministicArtifactId(resultId: string, role: RenderArtifactRole): string {
  const bytes = createHash("sha256").update(`${resultId}:${role}`).digest().subarray(0, 16);
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x50, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

class FrozenInertRenderer {
  async render(input: RenderExecutionInput): Promise<ValidatedRenderBundle> {
    const { heightPx, widthPx } = input.renderSceneManifest.profile;
    const bytesByRole = new Map<RenderArtifactRole, Uint8Array>([
      ["geometry-safe-png", await solidPng({ b: 96, g: 84, r: 72 }, widthPx, heightPx)],
      [
        "multilayer-exr",
        minimalExr({
          channels: ["Combined.R", "Combined.G", "Combined.B", "CryptoObject00.R"],
          height: heightPx,
          width: widthPx,
        }),
      ],
      ["depth-exr", minimalExr({ channels: ["Z"], height: heightPx, width: widthPx })],
      [
        "normal-exr",
        minimalExr({
          channels: ["Normal.X", "Normal.Y", "Normal.Z"],
          height: heightPx,
          width: widthPx,
        }),
      ],
      ["segmentation-png", await solidPng({ b: 3, g: 2, r: 1 }, widthPx, heightPx)],
    ]);
    const artifacts = await Promise.all(
      artifactRoles.map(async (role) => {
        const bytes = bytesByRole.get(role);
        if (bytes === undefined) throw new Error(`Missing inert artifact bytes for ${role}.`);
        return validateArtifactBytes({
          artifactId: deterministicArtifactId(input.resultId, role),
          bytes,
          expectedHeightPx: heightPx,
          expectedWidthPx: widthPx,
          exrInspector: {
            inspect: (exrRole) =>
              Promise.resolve({
                allFinite: true,
                channels:
                  exrRole === "depth-exr"
                    ? ["Z"]
                    : exrRole === "normal-exr"
                      ? ["Normal.X", "Normal.Y", "Normal.Z"]
                      : ["Combined.R", "Combined.G", "Combined.B", "CryptoObject00.R"],
                heightPx,
                widthPx,
              }),
          },
          role,
        });
      }),
    );
    const manifest = createOutputManifest({
      artifacts,
      executableSha256: inertExecutableSha256,
      hostFingerprintSha256: createHash("sha256")
        .update("c14-frozen-inert-host-no-hardware-evidence")
        .digest("hex"),
      renderInput: input,
    });
    const manifestBytes = Buffer.from(canonicalJson(manifest), "utf8");
    return {
      artifactBytes: bytesByRole,
      artifacts,
      manifest,
      manifestBytes,
      manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
    };
  }
}

function json(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function sealCatalogAsset(asset: CatalogAssetVersion): CatalogAssetVersion {
  const { projectionSha256: _projectionSha256, ...projectionBody } = asset.placementProjection;
  const placementProjection = {
    ...asset.placementProjection,
    projectionSha256: catalogSha256(projectionBody),
  };
  const { versionSha256: _versionSha256, ...versionBody } = {
    ...asset,
    placementProjection,
  };
  return catalogAssetVersionSchema.parse({
    ...versionBody,
    versionSha256: catalogSha256(versionBody),
  });
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
      ${sql.json(json(asset))}, ${actor.userId}::uuid, ${publishedAt}::timestamptz
    )
  `;
}

describeLive("C14 local C1-C14 control-plane acceptance with an inert renderer boundary", () => {
  let sql!: Sql;
  let config: ReturnType<typeof parseWorkerConfig>;
  let s3: ReturnType<typeof createS3Client>;
  let sceneStorage: S3SceneObjectStorage;
  let broker: EncryptedRenderArtifactBroker;

  beforeAll(async () => {
    sql = createC1Sql(databaseUrl);
    config = parseWorkerConfig({
      C2_DATABASE_URL: databaseUrl,
      C2_HEARTBEAT_MS: "1000",
      C2_LEASE_MS: "10000",
      C2_S3_ACCESS_KEY_ID: process.env.C14_RUNNER_TEST_STORAGE_ACCESS_KEY_ID ?? "localdev",
      C2_S3_ENDPOINT: storageEndpoint,
      C2_S3_FORCE_PATH_STYLE: "true",
      C2_S3_REGION: process.env.C14_RUNNER_TEST_STORAGE_REGION ?? "local",
      C2_S3_SECRET_ACCESS_KEY:
        process.env.C14_RUNNER_TEST_STORAGE_SECRET_ACCESS_KEY ?? "local-development-only",
      C2_WORKER_ID: "c14-full-chain-worker",
      NODE_ENV: "test",
    });
    expect(config.c14Render).toBeUndefined();
    s3 = createS3Client(config);
    sceneStorage = new S3SceneObjectStorage(config.s3, { client: s3 });
    broker = new EncryptedRenderArtifactBroker({
      baseUrl: "http://127.0.0.1:3014",
      client: s3,
      key: new Uint8Array(32).fill(14),
    });
    const migrationTable = await sql<{ exists: boolean }[]>`
      SELECT to_regclass('public.platform_schema_migrations') IS NOT NULL AS exists
    `;
    if (migrationTable[0]?.exists !== true) {
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
    } else {
      const migrations = await sql<{ id: string }[]>`
        SELECT id FROM platform_schema_migrations ORDER BY id
      `;
      const migrationIds = migrations.map(({ id }) => id);
      if (migrationIds.join("\n") !== expectedMigrationIds.join("\n")) {
        throw new Error(`C14_DISPOSABLE_DATABASE_PARTIALLY_MIGRATED:${migrationIds.join(",")}`);
      }
    }
    await sceneStorage.readiness();
  });

  afterAll(async () => sql.end({ timeout: 5 }));

  it("publishes immutable inert fixture artifacts from a persisted C13-backed C10 GLB", async () => {
    const project = await new PostgresProjectRepository(sql).create({
      actor,
      correlation,
      idempotencyKey: randomUUID(),
      request: { name: `Synthetic C14 full-chain acceptance ${randomUUID()}` },
    });
    const modelId = randomUUID();
    const cameraId = randomUUID();
    const initialSnapshot = canonicalSnapshotFixture({ modelId, projectId: project.id });
    const cameraOrigin = {
      actorUserId: actor.userId,
      claimId: randomUUID(),
      evidenceIds: [],
      method: { kind: "fixture" as const, name: "c14-local-control-plane", version: "1" },
      state: "user-asserted" as const,
      verification: { status: "not-reviewed" as const },
    };
    const model = await new ModelOperationService(
      new PostgresModelOperationRepository(sql),
    ).initialize({
      actor,
      correlation,
      expectedCurrentSnapshotSha256: null,
      idempotencyKey: randomUUID(),
      profile: "existing",
      projectId: project.id,
      snapshot: {
        ...initialSnapshot,
        elements: {
          ...initialSnapshot.elements,
          cameras: [
            {
              elementType: "camera",
              id: cameraId,
              levelId: required(initialSnapshot.elements.levels[0], "Fixture level missing.").id,
              name: {
                attribution: { ...cameraOrigin, claimId: randomUUID() },
                knowledge: "known",
                value: "C14 inert integration camera",
              },
              origin: cameraOrigin,
              position: {
                attribution: { ...cameraOrigin, claimId: randomUUID() },
                knowledge: "known",
                value: { xMm: 1_000, yMm: 1_000, zMm: 1_600 },
              },
              target: {
                attribution: { ...cameraOrigin, claimId: randomUUID() },
                knowledge: "known",
                value: { xMm: 2_000, yMm: 1_500, zMm: 1_000 },
              },
              verticalFovMilliDegrees: {
                attribution: { ...cameraOrigin, claimId: randomUUID() },
                knowledge: "known",
                value: 60_000,
              },
            },
          ],
        },
      },
    });

    const briefClock = new MutableClock();
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
    await optionService.createJob({
      actor,
      correlation,
      idempotencyKey: randomUUID(),
      projectId: project.id,
      request: createOptionJobRequestSchema.parse({
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
          snapshotId: model.record.id,
          snapshotSha256: model.record.snapshotSha256,
          snapshotVersion: model.record.version,
        },
      }),
    });
    const optionWorker = new DesignOptionWorkerRuntime(optionRepository);
    optionClock.advance(1);
    const optionLease = await optionWorker.claimNext({
      leaseSeconds: 60,
      workerId: "c14-full-chain-option-worker",
    });
    if (optionLease === undefined)
      throw new Error("Synthetic C12 predecessor lease is unavailable.");
    let optionWorkerJob = optionLease.job;
    for (const stage of ["generating", "validating", "publishing"] as const) {
      optionClock.advance(1);
      optionWorkerJob = await optionWorker.advance({
        attempt: optionLease.attempt,
        expectedJobVersion: optionWorkerJob.version,
        jobId: optionWorkerJob.id,
        leaseToken: optionLease.leaseToken,
        projectId: project.id,
        stage,
        tenantId: actor.tenantId,
        workerId: "c14-full-chain-option-worker",
      });
    }
    const generated = publication(optionWorkerJob, optionLease.workingSnapshot);
    optionClock.advance(1);
    const optionSucceeded = await optionWorker.publish({
      attempt: optionLease.attempt,
      expectedJobVersion: optionWorkerJob.version,
      jobId: optionWorkerJob.id,
      leaseToken: optionLease.leaseToken,
      optionSet: generated.optionSet,
      options: generated.options,
      projectId: project.id,
      tenantId: actor.tenantId,
      workerId: "c14-full-chain-option-worker",
    });
    const selected = required(generated.options[0], "Synthetic selected design option is missing.");
    optionClock.advance(1);
    const confirmedOption = await optionService.confirmOption({
      actor,
      correlation,
      jobId: optionSucceeded.id,
      optionId: selected.id,
      projectId: project.id,
      request: {
        expectedBriefContentSha256: optionSucceeded.baseBrief.contentSha256,
        expectedBriefRevision: optionSucceeded.baseBrief.revision,
        expectedJobVersion: optionSucceeded.version,
        expectedOptionSetSha256: generated.optionSet.setSha256,
        expectedOptionStatus: "pending",
        expectedSourceSnapshotSha256: optionSucceeded.sourceModel.snapshotSha256,
        idempotencyKey: randomUUID(),
      },
    });

    const c12Asset = only(selected.operationBundle.assetPlacements).asset;
    const initialAsset = sealCatalogAsset(wrapCatalogAsset(c12Asset));
    const replacementAsset = sealCatalogAsset(
      wrapCatalogAsset({
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
      }),
    );
    const publishedAt = "2026-07-22T00:00:00.000Z";
    const manifestBytes = catalogCanonicalBytes({
      assets: [initialAsset, replacementAsset]
        .sort((left, right) => left.versionId.localeCompare(right.versionId))
        .map(({ assetId, versionId, versionSha256 }) => ({ assetId, versionId, versionSha256 })),
      createdAt: publishedAt,
      releaseVersion: "1.0.0",
      schemaVersion: "c13-catalog-release-manifest-v1",
    });
    const releaseManifestSha256 = sha256Bytes(manifestBytes);
    const release = catalogReleaseSchema.parse({
      assetVersionIds: [initialAsset.versionId, replacementAsset.versionId].sort(),
      createdAt: publishedAt,
      manifestSha256: releaseManifestSha256,
      releaseId: deterministicCatalogUuid(`c13:release:${releaseManifestSha256}`),
      schemaVersion: c13CatalogReleaseSchemaVersion,
      status: "published",
      version: "1.0.0",
    });
    await new S3CatalogPublicationStore(s3).putContentAddressed({
      bytes: manifestBytes,
      mediaType: "application/json",
      sha256: release.manifestSha256,
    });
    await sql`
      INSERT INTO catalog_releases (
        tenant_id, project_id, id, schema_version, version, manifest_sha256,
        status, release_payload, published_by, published_at
      ) VALUES (
        ${actor.tenantId}::uuid, ${project.id}::uuid, ${release.releaseId}::uuid,
        ${release.schemaVersion}, ${release.version}, ${release.manifestSha256}, 'published',
        ${sql.json(json(release))}, ${actor.userId}::uuid, ${publishedAt}::timestamptz
      )
    `;
    await publishAsset(sql, project.id, initialAsset, publishedAt);
    await publishAsset(sql, project.id, replacementAsset, publishedAt);
    for (const [ordinal, catalogAsset] of [initialAsset, replacementAsset]
      .sort((left, right) => left.versionId.localeCompare(right.versionId))
      .entries()) {
      await sql`
        INSERT INTO catalog_release_assets (
          tenant_id, project_id, release_id, release_sha256,
          asset_version_id, asset_version_sha256, ordinal
        ) VALUES (
          ${actor.tenantId}::uuid, ${project.id}::uuid, ${release.releaseId}::uuid,
          ${release.manifestSha256}, ${catalogAsset.versionId}::uuid,
          ${catalogAsset.versionSha256}, ${ordinal}
        )
      `;
    }

    const sceneRepository = new PostgresSceneRepository(sql);
    const sceneService = new SceneService({
      compiler: { name: "interior-design-scene-compiler", version: "1.0.0" },
      repository: sceneRepository,
      snapshotVerifier: new PostgresSceneSnapshotVerifier(sql),
      storage: sceneStorage,
    });
    const specificationClock = new MutableSpecificationClock();
    const specificationRepository = new PostgresSpecificationRepository(sql, {
      clock: specificationClock,
    });
    const specificationService = new SpecificationService({
      clock: specificationClock,
      repository: specificationRepository,
      sceneJobs: new C10SpecificationSceneJobPort(sceneService),
    });
    const specification = await specificationService.create({
      actor,
      correlation,
      idempotencyKey: randomUUID(),
      projectId: project.id,
      request: {
        catalogReleaseId: release.releaseId,
        catalogReleaseSha256: release.manifestSha256,
        confirmationId: confirmedOption.confirmation.id,
      },
    });
    const initialLine = only(specification.specification.currentRevision.lines);
    specificationClock.advance(1);
    const preview = await specificationService.createPreview({
      actor,
      correlation,
      idempotencyKey: randomUUID(),
      projectId: project.id,
      request: {
        elementId: initialLine.elementId,
        expectedBranchRevision: specification.specification.currentRevision.branchRevision,
        expectedSpecificationRevision: 1,
        replacementAssetVersionId: replacementAsset.versionId,
      },
      specificationId: specification.specification.specificationId,
    });
    specificationClock.advance(1);
    const c13Confirmation = await specificationService.confirm({
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
    expect(c13Confirmation.sceneState).toBe("requested");
    const sceneRunner = new SceneCompilationRunner({
      heartbeatMilliseconds: 1_000,
      leaseSeconds: 30,
      logger: createJsonLogger(),
      pollMilliseconds: 100,
      specifications: specificationRepository,
      worker: new SceneWorkerService({
        repository: sceneRepository,
        snapshotVerifier: new PostgresSceneSnapshotVerifier(sql),
        storage: sceneStorage,
      }),
      workerId: "c14-full-chain-scene-worker",
    });
    await expect(sceneRunner.processNext()).resolves.toBe("processed");
    const scene = await sceneService.getScene(
      actor.tenantId,
      project.id,
      c13Confirmation.confirmation.sceneJobId,
    );
    expect(scene.manifest.sourceSnapshot.profile).toBe("proposed");
    expect(scene.artifact.glbSha256).toMatch(/^[a-f0-9]{64}$/u);

    const resolver = new PortBackedRenderSourceResolver({
      embedded: new C10EmbeddedC13BindingInspector(),
      profiles: new FrozenRenderProfileAuthority(),
      scenes: new C10RenderSceneAuthority({
        reader: new S3ExactSceneGlbReader(config.s3, { client: s3 }),
        scenes: sceneRepository,
      }),
      specifications: new C13RenderSpecificationAuthority({
        catalog: new PostgresCatalogRepository(sql),
        specifications: specificationRepository,
      }),
    });
    const renderRepository = new PostgresRenderRepository(sql);
    const renderStorage = new S3RenderObjectStorage(config.s3, broker, { client: s3 });
    const renderService = new RenderStillService({
      capabilities: {
        acceptingNewJobs: true,
        enhancementProvider: "disabled",
        hardwareEvidence: "deferred",
        profiles: [
          {
            available: true,
            capability: "render.cycles.cpu.v1",
            profileId: "cycles-cpu-geometry-safe-v1",
            reason: "Local frozen inert control-plane fixture; no renderer hardware evidence.",
          },
        ],
      },
      repository: renderRepository,
      resolver,
      storage: renderStorage,
    });
    expect(renderService.capabilities()).toMatchObject({
      acceptingNewJobs: true,
      hardwareEvidence: "deferred",
    });
    const modelStateBeforeRender = await sql<
      { readonly commits: string; readonly snapshots: string }[]
    >`
      SELECT
        (SELECT count(*)::text FROM model_operation_commits WHERE project_id = ${project.id}::uuid) AS commits,
        (SELECT count(*)::text FROM canonical_model_snapshots WHERE project_id = ${project.id}::uuid) AS snapshots
    `;
    const queued = await renderService.createJob({
      actor,
      correlation,
      idempotencyKey: randomUUID(),
      projectId: project.id,
      request: createRenderJobRequestSchema.parse({
        cameraId,
        enhancement: "disabled",
        label: "Synthetic C14 bounded full-chain acceptance",
        lightingPresetId: "canonical-lights-neutral-world-v1",
        profileId: "cycles-cpu-geometry-safe-v1",
        sourceSceneJobId: c13Confirmation.confirmation.sceneJobId,
        specification: {
          specificationId: specification.specification.specificationId,
          specificationRevision: 2,
        },
      }),
    });
    const pinnedSource = await renderRepository.findPinnedSource(
      actor.tenantId,
      project.id,
      queued.job.id,
    );
    const confirmedBinding = await specificationRepository.resolveConfirmedSceneBinding(
      actor.tenantId,
      project.id,
      c13Confirmation.confirmation.sceneJobId,
    );
    expect(pinnedSource?.specification).toBeDefined();
    expect(confirmedBinding).toMatchObject({
      catalogReleaseId: pinnedSource?.specification?.catalogReleaseId,
      catalogReleaseSha256: pinnedSource?.specification?.catalogReleaseSha256,
      modelSnapshotSha256: pinnedSource?.sourceSnapshotSha256,
      projectId: pinnedSource?.projectId,
      revisionSha256: pinnedSource?.specification?.specificationRevisionSha256,
      sceneJobId: pinnedSource?.sceneJobId,
      specificationId: pinnedSource?.specification?.specificationId,
      specificationRevision: pinnedSource?.specification?.specificationRevision,
    });
    const pinnedRevisions = await specificationRepository.listRevisions(
      actor.tenantId,
      project.id,
      specification.specification.specificationId,
    );
    expect(
      pinnedRevisions.some(
        ({ revision, revisionSha256 }) =>
          revision === pinnedSource?.specification?.specificationRevision &&
          revisionSha256 === pinnedSource.specification.specificationRevisionSha256,
      ),
    ).toBe(true);
    const catalogRepository = new PostgresCatalogRepository(sql);
    const persistedRelease = await catalogRepository.findRelease(
      actor.tenantId,
      project.id,
      release.releaseId,
    );
    const persistedAssets = await catalogRepository.listAssets(
      actor.tenantId,
      project.id,
      release.releaseId,
    );
    expect(persistedRelease).toEqual(release);
    expect(persistedRelease?.releaseId).toBe(
      deterministicCatalogUuid(`c13:release:${release.manifestSha256}`),
    );
    for (const persistedAsset of persistedAssets) {
      const { projectionSha256, ...projectionBody } = persistedAsset.placementProjection;
      const { versionSha256, ...versionBody } = persistedAsset;
      expect(projectionSha256).toBe(catalogSha256(projectionBody));
      expect(versionSha256).toBe(catalogSha256(versionBody));
    }
    const glbBytes = await new S3ExactSceneGlbReader(config.s3, { client: s3 }).read({
      byteSize: scene.artifact.byteSize,
      glbSha256: scene.artifact.glbSha256,
    });
    const parsedGlb = parseProtectedC10Glb(glbBytes);
    expect(parsedGlb.specificationBinding).toEqual({
      authority: "catalog-metadata-on-parametric-scene",
      catalogReleaseId: release.releaseId,
      catalogReleaseSha256: release.manifestSha256,
      specificationId: specification.specification.specificationId,
      specificationRevision: 2,
      specificationRevisionSha256: pinnedSource?.specification?.specificationRevisionSha256,
    });
    const pinnedRevision = pinnedRevisions.find(({ revision }) => revision === 2);
    expect(pinnedRevision).toBeDefined();
    const committedSnapshot = await new PostgresSceneSnapshotVerifier(sql).findExactCommitted(
      actor.tenantId,
      project.id,
      scene.manifest.sourceSnapshot,
    );
    expect(committedSnapshot).toBeDefined();
    const { revisionSha256: pinnedRevisionSha256, ...pinnedRevisionBody } = required(
      pinnedRevision,
      "The exact C13 revision is unavailable.",
    );
    expect(pinnedRevisionSha256).toBe(catalogSha256(pinnedRevisionBody));
    expect(pinnedRevision).toMatchObject({
      catalogReleaseId: release.releaseId,
      catalogReleaseSha256: release.manifestSha256,
      modelSnapshotSha256: committedSnapshot?.snapshotSha256,
      sourceConfirmation: {
        modelId: committedSnapshot?.snapshot.modelId,
      },
    });
    expect(pinnedRevision?.sourceConfirmation.resultSnapshotId).not.toBe(
      pinnedRevision?.modelSnapshotId,
    );
    expect(pinnedRevision?.sourceConfirmation.resultSnapshotSha256).not.toBe(
      committedSnapshot?.snapshotSha256,
    );
    const elementsById = new Map(
      Object.values(committedSnapshot?.snapshot.elements ?? {})
        .flat()
        .map((element) => [element.id, element.elementType]),
    );
    const persistedAssetsByVersionId = new Map(
      persistedAssets.map((asset) => [asset.versionId, asset]),
    );
    for (const line of pinnedRevision?.lines ?? []) {
      const asset = persistedAssetsByVersionId.get(line.assetVersionId);
      expect(asset).toBeDefined();
      expect(line).toMatchObject({
        assetContentSha256: asset?.placementProjection.c12Asset.contentSha256,
        assetMetadataSha256: asset?.placementProjection.c12Asset.metadataSha256,
        assetVersionSha256: asset?.versionSha256,
        catalogReleaseId: release.releaseId,
        catalogReleaseSha256: release.manifestSha256,
        kind: asset?.kind,
        placementPolicySha256: asset?.placementProjection.c12Asset.placementPolicy.policySha256,
        placementProjectionSha256: asset?.placementProjection.projectionSha256,
        rightsRecordSha256: asset?.rights.recordSha256,
      });
      expect(elementsById.get(line.elementId)).toBe(line.kind);
      expect(parsedGlb.catalogBindingsByElement.get(line.elementId)).toEqual({
        assetContentSha256: line.assetContentSha256,
        assetMetadataSha256: line.assetMetadataSha256,
        assetVersionId: line.assetVersionId,
        assetVersionSha256: line.assetVersionSha256,
        placementPolicySha256: line.placementPolicySha256,
        placementProjectionSha256: line.placementProjectionSha256,
        representation: "parametric-bounded-not-vendor-fidelity",
        rightsRecordSha256: line.rightsRecordSha256,
      });
    }
    const runner = new RenderStillRunner({
      capabilities: ["render.cycles.cpu.v1"],
      control: new RenderStillWorkerService({
        repository: renderRepository,
        resolver,
        storage: renderStorage,
      }),
      disk: new StatfsRenderDisk(),
      heartbeatMilliseconds: 1_000,
      leaseSeconds: 30,
      logger: { info: () => undefined, warn: () => undefined },
      renderer: new FrozenInertRenderer(),
      sceneBuilder: new ExactC14RenderSceneBuilder({
        catalog: catalogRepository,
        catalogManifest: new S3ExactCatalogManifestReader(s3),
        config: {
          blenderBuildHash: "inert-fixture-build-no-blender",
          blenderVersion: "frozen-inert-fixture-no-blender",
          profile: {
            heightPx: 64,
            profileId: "cycles-cpu-geometry-safe-v1",
            samples: 1,
            seed: 14,
            threads: 1,
            widthPx: 64,
          },
          rendererScript: { sha256: inertRendererScriptSha256 },
        },
        scenes: sceneRepository,
        snapshots: new PostgresSceneSnapshotVerifier(sql),
        specifications: specificationRepository,
      }),
      source: new ExactC10RenderSourceMaterial({
        reader: new S3ExactSceneGlbReader(config.s3, { client: s3 }),
        scenes: sceneRepository,
      }),
      volumeId: "c14-local-inert-control-plane-volume",
      volumePath: "/private/tmp",
      workerId: "c14-local-inert-control-plane-worker",
    });
    let currentJob = await renderService.getJob(actor.tenantId, project.id, queued.job.id);
    for (let index = 0; index < 32 && currentJob.state === "queued"; index += 1) {
      await expect(runner.runOnce()).resolves.toBe("processed");
      currentJob = await renderService.getJob(actor.tenantId, project.id, queued.job.id);
    }

    const completed = await renderService.getJob(actor.tenantId, project.id, queued.job.id);
    const result = await renderService.getResult(actor.tenantId, project.id, queued.job.id);
    expect(completed.state).toBe("succeeded");
    expect(result.manifest.source.sceneGlbSha256).toBe(scene.artifact.glbSha256);
    expect(result.manifest.source.specification).toMatchObject({
      catalogReleaseSha256: release.manifestSha256,
      specificationId: specification.specification.specificationId,
      specificationRevision: 2,
    });
    expect(result.manifest.renderer).toMatchObject({
      blenderBuildHash: "inert-fixture-build-no-blender",
      blenderVersion: "frozen-inert-fixture-no-blender",
      executableSha256: inertExecutableSha256,
      scriptSha256: inertRendererScriptSha256,
    });
    expect(result.manifest.artifacts).toHaveLength(5);
    for (const artifact of result.manifest.artifacts) {
      const access = await renderService.createArtifactAccess({
        actor,
        artifactId: artifact.id,
        correlation,
        jobId: queued.job.id,
        projectId: project.id,
      });
      const token = new URL(access.url).pathname.split("/").at(-1);
      if (token === undefined) throw new Error("The opaque artifact access token is missing.");
      const opened = await broker.open(token);
      if (opened === undefined)
        throw new Error("The opaque artifact grant did not resolve exactly.");
      expect(opened.bytes.byteLength).toBe(artifact.byteLength);
      expect(createHash("sha256").update(opened.bytes).digest("hex")).toBe(artifact.sha256);
      if (artifact.role.endsWith("-png")) {
        expect(inspectPng(opened.bytes)).toEqual({
          heightPx: artifact.heightPx,
          widthPx: artifact.widthPx,
        });
      } else {
        expect(() => {
          assertExrMagic(opened.bytes);
        }).not.toThrow();
      }
    }
    const modelStateAfterRender = await sql<
      { readonly commits: string; readonly snapshots: string }[]
    >`
      SELECT
        (SELECT count(*)::text FROM model_operation_commits WHERE project_id = ${project.id}::uuid) AS commits,
        (SELECT count(*)::text FROM canonical_model_snapshots WHERE project_id = ${project.id}::uuid) AS snapshots
    `;
    expect(modelStateAfterRender).toEqual(modelStateBeforeRender);
  }, 120_000);
});
