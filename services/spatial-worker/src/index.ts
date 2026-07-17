import { pathToFileURL } from "node:url";
import path from "node:path";
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
import { SpatialWorkerRunner } from "./runner.js";
import { createS3Client, S3ObjectStorage } from "./storage.js";

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
            pythonPath:
              environment.C6_PLAN_PARSER_PYTHONPATH ??
              path.resolve(process.cwd(), "services/inference-worker/src"),
          }),
          pollMilliseconds: config.pollMs,
          queue: new PostgresPlanProcessingQueue(sql),
          storage,
          temporaryMaximumBytes: Math.min(config.temporaryDirectory.maximumBytes, 268_435_456),
          temporaryRoot: config.temporaryDirectory.root,
          workerId: `c6-${config.workerId}`.slice(0, 100),
        })
      : undefined;
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
