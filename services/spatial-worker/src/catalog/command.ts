import { pathToFileURL } from "node:url";
import postgres from "postgres";

import { parseWorkerConfig } from "../config.js";
import { createS3Client } from "../storage.js";
import { PinnedKhronosValidator } from "./khronos-validator.js";
import { CatalogIngestionPipeline, type CatalogIngestionResult } from "./pipeline.js";
import { PostgresCatalogPublicationStore } from "./postgres-publication.js";
import { S3CatalogPublicationStore } from "./s3-publication.js";
import { RepositoryCatalogSource } from "./source.js";

export async function ingestConfiguredCatalog(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<CatalogIngestionResult> {
  const config = parseWorkerConfig(environment);
  if (config.c13CatalogIngestion === undefined) {
    throw new Error("C13 catalog ingestion is not explicitly configured.");
  }
  const sql = postgres(config.databaseUrl, {
    connect_timeout: 5,
    idle_timeout: 20,
    max: 2,
    max_lifetime: 30 * 60,
    onnotice: () => undefined,
    prepare: true,
  });
  const s3Client = createS3Client(config);
  try {
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
      source: await RepositoryCatalogSource.create(config.c13CatalogIngestion.sourceRoot),
      validator: new PinnedKhronosValidator(),
    });
    return await pipeline.ingest();
  } finally {
    s3Client.destroy();
    await sql.end({ timeout: 5 });
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  void ingestConfiguredCatalog()
    .then((result) => {
      process.stdout.write(
        `${JSON.stringify({
          assetCount: result.publication.assets.length,
          manifestSha256: result.publication.release.manifestSha256,
          releaseId: result.publication.release.releaseId,
          replayed: result.replayed,
          status: "ok",
        })}\n`,
      );
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `${JSON.stringify({
          errorType: error instanceof Error ? error.name : "UnknownError",
          event: "c13_catalog_ingestion_failed",
          status: "error",
        })}\n`,
      );
      process.exitCode = 1;
    });
}
