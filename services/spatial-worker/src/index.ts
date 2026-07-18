import { pathToFileURL } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";
import {
  CatalogDesignAssetVerifier,
  DesignOptionWorkerRuntime,
  PostgresDesignOptionRepository,
} from "@interior-design/platform-api/design-options";
import {
  PostgresSceneRepository,
  PostgresSceneSnapshotVerifier,
  S3SceneObjectStorage,
  SceneWorkerService,
} from "@interior-design/platform-api/scenes";
import { PostgresSpecificationRepository } from "@interior-design/platform-api/specifications";
import { creatorOwnedSyntheticAssetCatalog } from "@interior-design/interior-assets";
import { PostgresReconstructionRepository } from "@interior-design/platform-api/reconstruction";
import postgres from "postgres";

import { parseWorkerConfig } from "./config.js";
import { PostgresProcessingJobRepository } from "./jobs.js";
import { createJsonLogger } from "./logger.js";
import {
  IsolatedPlanParserPort,
  PlanNormalizer,
  PlanProcessingRunner,
  PostgresPlanProcessingQueue,
} from "./plan-processing/index.js";
import { MediaProcessor } from "./processor.js";
import { MediaPreparationPipeline } from "./media-prep/index.js";
import {
  BoundedFusionProducerProtocol,
  FusionProcessingRunner,
  GeometryKernelRegistrationProducer,
  PostgresFusionProcessingQueue,
  PostgresFusionSourceAcquisition,
  PythonScanToModelProducer,
} from "./model-fusion/index.js";
import { PostgresRoomPlanProcessingQueue, RoomPlanProcessingRunner } from "./roomplan/index.js";
import {
  PostgresReconstructionSourceLoader,
  PythonReconstructionProcessor,
  ReconstructionProcessingRunner,
} from "./reconstruction/index.js";
import { SpatialWorkerRunner } from "./runner.js";
import { SceneCompilationRunner } from "./scene-compile/index.js";
import { DesignOptionProcessingRunner } from "./design-options/index.js";
import { createS3Client, S3ObjectStorage } from "./storage.js";
import {
  CatalogIngestionPipeline,
  PinnedKhronosValidator,
  PostgresCatalogPublicationStore,
  RepositoryCatalogSource,
  S3CatalogPublicationStore,
} from "./catalog/index.js";

export const spatialWorkerCheckpoint = "C2" as const;

export { parseWorkerConfig } from "./config.js";
export { MediaRejection, RetryableWorkerError } from "./errors.js";
export { PostgresProcessingJobRepository } from "./jobs.js";
export type { LeasedProcessingJob, ProcessingJobRepository, RetryOutcome } from "./jobs.js";
export { createJsonLogger, serializeLog } from "./logger.js";
export { MediaProcessor } from "./processor.js";
export type { ThreatScanner } from "./processor.js";
export { SpatialWorkerRunner } from "./runner.js";
export { S3ObjectStorage } from "./storage.js";
export type { DerivedWrite, ObjectStorage } from "./storage.js";
export { ProcessExecutionError, runBoundedProcess } from "./subprocess.js";
export { IsolatedWorkspace } from "./workspace.js";
export * from "./plan-processing/index.js";
export * from "./roomplan/index.js";
export * from "./media-prep/index.js";
export * from "./reconstruction/index.js";
export * from "./model-fusion/index.js";
export * from "./scene-compile/index.js";
export * from "./design-options/index.js";
export * from "./catalog/index.js";

export const spatialWorkerCapabilities = Object.freeze([
  "C2",
  "C6",
  "C7",
  "C8",
  "C9",
  "C10",
  "C12",
  "C13",
] as const);

function defaultInferenceModuleRoot(): string {
  const repositoryRoot = path.resolve(process.cwd(), "services/inference-worker/src");
  if (existsSync(repositoryRoot)) return repositoryRoot;
  const serviceSibling = path.resolve(process.cwd(), "../inference-worker/src");
  if (existsSync(serviceSibling)) return serviceSibling;
  return repositoryRoot;
}

export async function runSpatialWorker(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  const config = parseWorkerConfig(environment);
  const logger = createJsonLogger();
  const sql = postgres(config.databaseUrl, {
    connect_timeout: 5,
    idle_timeout: 20,
    max: 4,
    max_lifetime: 30 * 60,
    onnotice: () => undefined,
    prepare: true,
  });
  const s3Client = createS3Client(config);
  const storage = new S3ObjectStorage(s3Client);
  const jobs = new PostgresProcessingJobRepository(sql);
  const processor = new MediaProcessor(config, storage);
  const runner = new SpatialWorkerRunner({ config, jobs, logger, processor, storage });
  const planRunner =
    environment.C6_PLAN_WORKER_ENABLED === "true"
      ? new PlanProcessingRunner({
          heartbeatMilliseconds: Math.min(config.heartbeatMs, 15_000),
          leaseMilliseconds: Math.max(config.leaseMs, 60_000),
          logger,
          normalizer: new PlanNormalizer({
            pdfInfo: config.executables.pdfinfo,
            pdfToCairo: environment.C6_PDFTOCAIRO_PATH ?? "pdftocairo",
            pdfToPpm: config.executables.pdftoppm,
            popplerVersion: environment.C6_POPPLER_VERSION ?? "local-poppler",
          }),
          parser: new IsolatedPlanParserPort({
            arguments: ["-m", "inference_worker.plan_parser"],
            command: environment.C6_PLAN_PARSER_COMMAND ?? "python3",
            pythonPath: environment.C6_PLAN_PARSER_PYTHONPATH ?? defaultInferenceModuleRoot(),
          }),
          pollMilliseconds: config.pollMs,
          queue: new PostgresPlanProcessingQueue(sql),
          storage,
          temporaryMaximumBytes: Math.min(config.temporaryDirectory.maximumBytes, 268_435_456),
          temporaryRoot: config.temporaryDirectory.root,
          workerId: `c6-${config.workerId}`.slice(0, 100),
        })
      : undefined;
  const roomPlanRunner =
    environment.C7_ROOMPLAN_WORKER_ENABLED === "true"
      ? new RoomPlanProcessingRunner({
          heartbeatMilliseconds: Math.min(config.heartbeatMs, 15_000),
          leaseMilliseconds: Math.max(config.leaseMs, 60_000),
          logger,
          pollMilliseconds: config.pollMs,
          queue: new PostgresRoomPlanProcessingQueue(sql),
          storage,
          workerId: `c7-${config.workerId}`.slice(0, 100),
        })
      : undefined;
  const reconstructionRunner =
    environment.C8_RECONSTRUCTION_WORKER_ENABLED === "true"
      ? new ReconstructionProcessingRunner({
          leaseSeconds: Math.max(30, Math.min(3_600, Math.ceil(config.leaseMs / 1_000))),
          logger,
          media: new MediaPreparationPipeline({
            logger,
            temporaryRoot: config.temporaryDirectory.root,
          }),
          pollMilliseconds: config.pollMs,
          processor: new PythonReconstructionProcessor({
            maximumOutputBytes: config.subprocess.maximumOutputBytes,
            processTimeoutMilliseconds: Math.max(config.subprocess.timeoutMs, 3_600_000),
            pythonCommand: environment.C8_INFERENCE_PYTHON_COMMAND ?? "python3",
            pythonModuleRoot: environment.C8_INFERENCE_PYTHONPATH ?? defaultInferenceModuleRoot(),
            storage,
            temporaryRoot: config.temporaryDirectory.root,
          }),
          queue: new PostgresReconstructionRepository(sql),
          sources: new PostgresReconstructionSourceLoader(sql),
          storage,
          workerId: `c8-${config.workerId}`.slice(0, 100),
        })
      : undefined;
  const fusionRunner =
    environment.C9_FUSION_WORKER_ENABLED === "true"
      ? new FusionProcessingRunner({
          heartbeatMilliseconds: Math.min(config.heartbeatMs, 15_000),
          leaseSeconds: Math.max(30, Math.min(3_600, Math.ceil(config.leaseMs / 1_000))),
          logger,
          pollMilliseconds: config.pollMs,
          producers: new BoundedFusionProducerProtocol({
            registration: new GeometryKernelRegistrationProducer(),
            semantic: new PythonScanToModelProducer({
              pythonCommand: environment.C9_INFERENCE_PYTHON_COMMAND ?? "python3",
              pythonModuleRoot: environment.C9_INFERENCE_PYTHONPATH ?? defaultInferenceModuleRoot(),
            }),
          }),
          queue: new PostgresFusionProcessingQueue(sql),
          sources: new PostgresFusionSourceAcquisition(sql),
          workerId: `c9-${config.workerId}`.slice(0, 100),
        })
      : undefined;
  const sceneRunner = config.c10SceneWorkerEnabled
    ? new SceneCompilationRunner({
        heartbeatMilliseconds: Math.min(config.heartbeatMs, 15_000),
        leaseSeconds: Math.max(30, Math.min(3_600, Math.ceil(config.leaseMs / 1_000))),
        logger,
        pollMilliseconds: config.pollMs,
        specifications: new PostgresSpecificationRepository(sql),
        worker: new SceneWorkerService({
          repository: new PostgresSceneRepository(sql),
          snapshotVerifier: new PostgresSceneSnapshotVerifier(sql),
          storage: new S3SceneObjectStorage(config.s3, { client: s3Client }),
        }),
        workerId: `c10-${config.workerId}`.slice(0, 100),
      })
    : undefined;
  const designOptionRunner = config.c12DesignOptionWorkerEnabled
    ? new DesignOptionProcessingRunner({
        leaseSeconds: Math.max(30, Math.min(3_600, Math.ceil(config.leaseMs / 1_000))),
        logger,
        pollMilliseconds: config.pollMs,
        worker: new DesignOptionWorkerRuntime(
          new PostgresDesignOptionRepository(sql, {
            assetVerifier: new CatalogDesignAssetVerifier({
              catalog: creatorOwnedSyntheticAssetCatalog,
            }),
          }),
        ),
        workerId: `c12-${config.workerId}`.slice(0, 100),
      })
    : undefined;
  if (config.c13CatalogIngestion !== undefined) {
    const source = await RepositoryCatalogSource.create(config.c13CatalogIngestion.sourceRoot);
    const pipeline = new CatalogIngestionPipeline({
      publication: new PostgresCatalogPublicationStore({
        objects: new S3CatalogPublicationStore(s3Client),
        scope: {
          projectId: config.c13CatalogIngestion.projectId,
          publishedByUserId: config.c13CatalogIngestion.publishedByUserId,
          tenantId: config.c13CatalogIngestion.tenantId,
        },
        sql,
      }),
      source,
      validator: new PinnedKhronosValidator(),
    });
    const result = await pipeline.execute();
    if (!result.ok) {
      logger.error("catalog.ingestion-failed", {
        safeCode: result.diagnostic.code,
      });
      throw new Error("C13 catalog ingestion failed closed.");
    }
    logger.info("catalog.release-published", {
      assetCount: result.result.publication.assets.length,
      manifestSha256: result.result.publication.release.manifestSha256,
      releaseId: result.result.publication.release.releaseId,
      replayed: result.result.replayed,
    });
  }
  const shutdown = new AbortController();
  const requestShutdown = (): void => {
    shutdown.abort(new Error("shutdown-requested"));
  };
  process.once("SIGINT", requestShutdown);
  process.once("SIGTERM", requestShutdown);
  try {
    await Promise.all([
      runner.run(shutdown.signal),
      ...(planRunner === undefined ? [] : [planRunner.run(shutdown.signal)]),
      ...(roomPlanRunner === undefined ? [] : [roomPlanRunner.run(shutdown.signal)]),
      ...(reconstructionRunner === undefined ? [] : [reconstructionRunner.run(shutdown.signal)]),
      ...(fusionRunner === undefined ? [] : [fusionRunner.run(shutdown.signal)]),
      ...(sceneRunner === undefined ? [] : [sceneRunner.run(shutdown.signal)]),
      ...(designOptionRunner === undefined ? [] : [designOptionRunner.run(shutdown.signal)]),
    ]);
  } finally {
    process.removeListener("SIGINT", requestShutdown);
    process.removeListener("SIGTERM", requestShutdown);
    s3Client.destroy();
    await sql.end({ timeout: 5 });
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runSpatialWorker().catch(() => {
    createJsonLogger(process.stderr).error("worker.startup-failed", {
      errorCode: "configuration-or-runtime-unavailable",
    });
    process.exitCode = 1;
  });
}
