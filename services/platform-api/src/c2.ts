import { runtimeEnvironmentSchema, type RuntimeEnvironment } from "@interior-design/config";
import type { FastifyInstance } from "fastify";
import { access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Sql } from "postgres";

import { createC1Sql } from "./c1.js";
import type { ReadinessCheck } from "./health.js";
import { PostgresAssetBackend } from "./modules/assets/postgres.js";
import { PostgresAssetProcessingJobRepository } from "./modules/assets/processing-jobs.js";
import { registerAssetRoutes } from "./modules/assets/routes.js";
import type { AssetBackend, AssetProcessingJobRepository } from "./modules/assets/types.js";
import {
  LocalFixtureTokenProvider,
  OidcTokenProvider,
  UnavailableTokenProvider,
  type SessionTokenProvider,
} from "./modules/identity/jwt.js";
import { PostgresIdentityStore } from "./modules/identity/postgres.js";
import { IdentityService } from "./modules/identity/service.js";
import { PostgresProjectRepository } from "./modules/projects/repository.js";
import type { ProjectRepository } from "./modules/projects/repository.js";
import { loadS3AssetStorageConfig } from "./storage/config.js";
import type { AssetObjectStorage } from "./storage/object-storage.js";
import { S3AssetObjectStorage } from "./storage/s3.js";

const LOCAL_DATABASE_URL =
  "postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design";
const LOCAL_SESSION_SECRET = "local-fixture-only-session-secret-not-for-production-2026-c1";

type C2EnvironmentSource = Readonly<Record<string, string | undefined>>;

export interface C2ModuleOptions {
  readonly backend?: AssetBackend;
  readonly closeDatabase?: boolean;
  readonly database?: Sql;
  readonly databaseUrl?: string;
  readonly identity?: IdentityService;
  readonly projects?: ProjectRepository;
  readonly storage?: AssetObjectStorage;
  readonly tokenProvider?: SessionTokenProvider;
}

export interface C2Module {
  readonly backend: AssetBackend;
  readonly jobs?: AssetProcessingJobRepository;
  readonly readinessChecks: readonly ReadinessCheck[];
}

function databaseUrl(
  runtimeEnvironment: RuntimeEnvironment,
  environment: C2EnvironmentSource,
  override: string | undefined,
): string {
  const configured = override ?? environment.C2_DATABASE_URL ?? environment.C1_DATABASE_URL;
  if (configured !== undefined && configured.length > 0) {
    return configured;
  }
  if (runtimeEnvironment === "production") {
    throw new Error("C2_DATABASE_URL or C1_DATABASE_URL is required in production.");
  }
  return LOCAL_DATABASE_URL;
}

function configuredTokenProvider(
  runtimeEnvironment: RuntimeEnvironment,
  environment: C2EnvironmentSource,
): SessionTokenProvider {
  const authMode =
    environment.C1_AUTH_MODE ?? (runtimeEnvironment === "production" ? "oidc" : "local");
  if (authMode === "local") {
    return runtimeEnvironment === "production"
      ? new UnavailableTokenProvider()
      : new LocalFixtureTokenProvider(environment.C1_LOCAL_SESSION_SECRET ?? LOCAL_SESSION_SECRET);
  }
  if (authMode === "oidc") {
    const issuer = environment.C1_OIDC_ISSUER;
    const audience = environment.C1_OIDC_AUDIENCE;
    const encodedPublicKey = environment.C1_OIDC_PUBLIC_KEY_BASE64;
    if (issuer === undefined || audience === undefined || encodedPublicKey === undefined) {
      return new UnavailableTokenProvider();
    }
    return new OidcTokenProvider({
      audience,
      issuer,
      publicKeyPem: Buffer.from(encodedPublicKey, "base64").toString("utf8"),
    });
  }
  throw new Error("C1_AUTH_MODE must be local or oidc.");
}

export function registerC2Module(
  server: FastifyInstance,
  runtimeEnvironment: RuntimeEnvironment,
  environment: C2EnvironmentSource,
  options: C2ModuleOptions = {},
): C2Module {
  const needsDatabase =
    options.backend === undefined ||
    options.identity === undefined ||
    options.projects === undefined;
  const ownsDatabase = needsDatabase && options.database === undefined;
  const sql = needsDatabase
    ? (options.database ??
      createC1Sql(databaseUrl(runtimeEnvironment, environment, options.databaseUrl)))
    : options.database;
  const identity =
    options.identity ??
    new IdentityService(
      runtimeEnvironment,
      new PostgresIdentityStore(sql as Sql),
      options.tokenProvider ?? configuredTokenProvider(runtimeEnvironment, environment),
    );
  const projects = options.projects ?? new PostgresProjectRepository(sql as Sql);
  const storage =
    options.storage ??
    (options.backend === undefined
      ? new S3AssetObjectStorage(loadS3AssetStorageConfig(runtimeEnvironment, environment))
      : undefined);
  const backend =
    options.backend ?? new PostgresAssetBackend(sql as Sql, storage as AssetObjectStorage);
  const jobs = sql === undefined ? undefined : new PostgresAssetProcessingJobRepository(sql);

  registerAssetRoutes(server, identity, projects, backend);

  if (sql !== undefined && (ownsDatabase || options.closeDatabase === true)) {
    server.addHook("onClose", async () => {
      await sql.end({ timeout: 5 });
    });
  }

  const readinessChecks: ReadinessCheck[] = [];
  if (sql !== undefined) {
    readinessChecks.push({
      name: "c2-database",
      check: async () => {
        const rows = await sql<{ readonly id: string }[]>`
          SELECT id
          FROM platform_schema_migrations
          WHERE id = '0002_assets_evidence'
          LIMIT 1
        `;
        if (rows.length !== 1) {
          throw new Error("C2 database migration is not applied.");
        }
      },
    });
  }
  if (storage !== undefined) {
    readinessChecks.push({ name: "object-storage", check: () => storage.readiness() });
  }
  return jobs === undefined ? { backend, readinessChecks } : { backend, jobs, readinessChecks };
}

async function firstExistingPath(candidates: readonly string[]): Promise<string> {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue to the next repository-relative candidate.
    }
  }
  throw new Error("The required C2 migration file could not be located.");
}

async function migrationPath(): Promise<string> {
  return firstExistingPath([
    path.resolve(process.cwd(), "services/platform-api/migrations/0002_assets_evidence.sql"),
    path.resolve(process.cwd(), "migrations/0002_assets_evidence.sql"),
  ]);
}

export async function applyC2Migration(sql: Sql, filePath?: string): Promise<void> {
  const resolvedPath = filePath ?? (await migrationPath());
  await sql.begin(async (transaction) => {
    await transaction.file(resolvedPath);
  });
}

async function runAdminCommand(command: string | undefined): Promise<void> {
  const runtimeEnvironment = runtimeEnvironmentSchema.parse(process.env.NODE_ENV ?? "development");
  if (!["migrate", "cleanup-expired", "migrate-and-cleanup"].includes(command ?? "")) {
    throw new Error("Expected one of: migrate, cleanup-expired, migrate-and-cleanup.");
  }
  const sql = createC1Sql(databaseUrl(runtimeEnvironment, process.env, undefined));
  try {
    if (command === "migrate" || command === "migrate-and-cleanup") {
      await applyC2Migration(sql);
    }
    let expiredSessions = 0;
    if (command === "cleanup-expired" || command === "migrate-and-cleanup") {
      const storage = new S3AssetObjectStorage(
        loadS3AssetStorageConfig(runtimeEnvironment, process.env),
      );
      expiredSessions = await new PostgresAssetBackend(sql, storage).cleanupExpiredSessions();
    }
    process.stdout.write(`${JSON.stringify({ command, expiredSessions, status: "ok" })}\n`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  void runAdminCommand(process.argv[2]).catch((error: unknown) => {
    process.stderr.write(
      `${JSON.stringify({
        errorType: error instanceof Error ? error.name : "UnknownError",
        event: "c2_admin_failed",
        status: "error",
      })}\n`,
    );
    process.exitCode = 1;
  });
}
