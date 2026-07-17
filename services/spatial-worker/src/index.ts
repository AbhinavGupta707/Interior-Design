import { pathToFileURL } from "node:url";
import postgres from "postgres";

import { parseWorkerConfig } from "./config.js";
import { PostgresProcessingJobRepository } from "./jobs.js";
import { createJsonLogger } from "./logger.js";
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
  const shutdown = new AbortController();
  const requestShutdown = (): void => {
    shutdown.abort(new Error("shutdown-requested"));
  };
  process.once("SIGINT", requestShutdown);
  process.once("SIGTERM", requestShutdown);
  try {
    await runner.run(shutdown.signal);
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
