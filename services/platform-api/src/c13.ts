import { runtimeEnvironmentSchema, type RuntimeEnvironment } from "@interior-design/config";
import {
  c10DefaultCompileConfiguration,
  c4SchemaVersion,
  type Actor,
} from "@interior-design/contracts";
import type { FastifyInstance } from "fastify";
import { access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Sql } from "postgres";

import { createC1Sql } from "./c1.js";
import type { RequestCorrelation } from "./correlation.js";
import type { ReadinessCheck } from "./health.js";
import { PostgresCatalogRepository } from "./modules/catalog/postgres.js";
import { registerCatalogRoutes } from "./modules/catalog/routes.js";
import { CatalogService } from "./modules/catalog/service.js";
import { S3CatalogArtifactStorage } from "./modules/catalog/storage.js";
import type { CatalogArtifactStorage, CatalogRepository } from "./modules/catalog/types.js";
import {
  LocalFixtureTokenProvider,
  OidcTokenProvider,
  UnavailableTokenProvider,
  type SessionTokenProvider,
} from "./modules/identity/jwt.js";
import { PostgresIdentityStore } from "./modules/identity/postgres.js";
import { IdentityService } from "./modules/identity/service.js";
import {
  PostgresProjectRepository,
  type ProjectRepository,
} from "./modules/projects/repository.js";
import type { SceneService } from "./modules/scenes/service.js";
import { PostgresSpecificationRepository } from "./modules/specifications/postgres.js";
import { registerSpecificationRoutes } from "./modules/specifications/routes.js";
import { SpecificationService } from "./modules/specifications/service.js";
import type {
  SpecificationRepository,
  SpecificationSceneJobPort,
  SpecificationSceneRequest,
} from "./modules/specifications/types.js";
import { loadS3AssetStorageConfig } from "./storage/config.js";

const LOCAL_DATABASE_URL =
  "postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design";
const LOCAL_SESSION_SECRET = "local-fixture-only-session-secret-not-for-production-2026-c1";

type C13EnvironmentSource = Readonly<Record<string, string | undefined>>;

export interface C13ModuleOptions {
  readonly catalogRepository?: CatalogRepository;
  readonly catalogStorage?: CatalogArtifactStorage;
  readonly closeDatabase?: boolean;
  readonly database?: Sql;
  readonly databaseUrl?: string;
  readonly identity?: IdentityService;
  readonly projects?: ProjectRepository;
  readonly sceneJobs?: SpecificationSceneJobPort;
  readonly sceneService?: SceneService;
  readonly specificationRepository?: SpecificationRepository;
  readonly tokenProvider?: SessionTokenProvider;
}

export interface C13Module {
  readonly catalog: CatalogService;
  readonly catalogRepository: CatalogRepository;
  readonly readinessChecks: readonly ReadinessCheck[];
  readonly specification: SpecificationService;
  readonly specificationRepository: SpecificationRepository;
}

function databaseUrl(
  runtimeEnvironment: RuntimeEnvironment,
  environment: C13EnvironmentSource,
  override: string | undefined,
): string {
  const configured =
    override ??
    environment.C13_DATABASE_URL ??
    environment.C12_DATABASE_URL ??
    environment.C10_DATABASE_URL ??
    environment.C9_DATABASE_URL ??
    environment.C8_DATABASE_URL ??
    environment.C7_DATABASE_URL ??
    environment.C6_DATABASE_URL ??
    environment.C1_DATABASE_URL;
  if (configured !== undefined && configured.length > 0) return configured;
  if (runtimeEnvironment === "production") {
    throw new Error("C13_DATABASE_URL or a predecessor database URL is required in production.");
  }
  return LOCAL_DATABASE_URL;
}

function configuredTokenProvider(
  runtimeEnvironment: RuntimeEnvironment,
  environment: C13EnvironmentSource,
): SessionTokenProvider {
  const mode = environment.C1_AUTH_MODE ?? (runtimeEnvironment === "production" ? "oidc" : "local");
  if (mode === "local") {
    return runtimeEnvironment === "production"
      ? new UnavailableTokenProvider()
      : new LocalFixtureTokenProvider(environment.C1_LOCAL_SESSION_SECRET ?? LOCAL_SESSION_SECRET);
  }
  if (mode === "oidc") {
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

export class C10SpecificationSceneJobPort implements SpecificationSceneJobPort {
  readonly #scenes: SceneService;

  constructor(scenes: SceneService) {
    this.#scenes = scenes;
  }

  async requestExactRevision(
    input: SpecificationSceneRequest,
    actor: Actor,
    correlation: RequestCorrelation,
  ): Promise<void> {
    const result = await this.#scenes.createJob({
      actor,
      cacheContextSha256: input.specificationRevisionSha256,
      correlation,
      idempotencyKey: `c13-scene-${input.sceneJobId}`,
      projectId: input.projectId,
      request: {
        configuration: c10DefaultCompileConfiguration,
        label: `Specification revision ${String(input.specificationRevision)}`,
        sourceSnapshot: {
          modelId: input.modelId,
          profile: "proposed",
          projectId: input.projectId,
          schemaVersion: c4SchemaVersion,
          snapshotId: input.modelSnapshotId,
          snapshotSha256: input.modelSnapshotSha256,
        },
      },
      requestedJobId: input.sceneJobId,
    });
    if (result.job.id !== input.sceneJobId) {
      throw new Error("The real C10 cache returned a different exact scene job identity.");
    }
  }
}

class UnavailableSpecificationSceneJobPort implements SpecificationSceneJobPort {
  requestExactRevision(): Promise<void> {
    return Promise.reject(new Error("The C10 scene service is not composed."));
  }
}

export function registerC13Module(
  server: FastifyInstance,
  runtimeEnvironment: RuntimeEnvironment,
  environment: C13EnvironmentSource,
  options: C13ModuleOptions = {},
): C13Module {
  const needsDatabase =
    options.catalogRepository === undefined ||
    options.specificationRepository === undefined ||
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
  const catalogRepository = options.catalogRepository ?? new PostgresCatalogRepository(sql as Sql);
  const catalogStorage =
    options.catalogStorage ??
    new S3CatalogArtifactStorage(loadS3AssetStorageConfig(runtimeEnvironment, environment));
  const catalog = new CatalogService({ repository: catalogRepository, storage: catalogStorage });
  const specificationRepository =
    options.specificationRepository ?? new PostgresSpecificationRepository(sql as Sql);
  const sceneJobs =
    options.sceneJobs ??
    (options.sceneService === undefined
      ? new UnavailableSpecificationSceneJobPort()
      : new C10SpecificationSceneJobPort(options.sceneService));
  const specification = new SpecificationService({
    repository: specificationRepository,
    sceneJobs,
  });

  registerCatalogRoutes(server, identity, projects, catalog);
  registerSpecificationRoutes(server, identity, projects, specification);

  if (sql !== undefined && (ownsDatabase || options.closeDatabase === true)) {
    server.addHook("onClose", async () => {
      await sql.end({ timeout: 5 });
    });
  }
  const readinessChecks: ReadinessCheck[] = [];
  if (sql !== undefined) {
    readinessChecks.push({
      name: "c13-database",
      check: async () => {
        const rows = await sql<{ readonly id: string }[]>`
          SELECT id FROM platform_schema_migrations WHERE id = '0013_specifications' LIMIT 1
        `;
        if (rows.length !== 1) throw new Error("C13 database migration is not applied.");
      },
    });
  }
  return {
    catalog,
    catalogRepository,
    readinessChecks,
    specification,
    specificationRepository,
  };
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
  throw new Error("The required C13 migration file could not be located.");
}

export async function applyC13Migration(sql: Sql, filePath?: string): Promise<void> {
  const resolvedPath =
    filePath ??
    (await firstExistingPath([
      path.resolve(process.cwd(), "services/platform-api/migrations/0013_specifications.sql"),
      path.resolve(process.cwd(), "migrations/0013_specifications.sql"),
    ]));
  await sql.begin(async (transaction) => transaction.file(resolvedPath));
}

async function runAdminCommand(command: string | undefined): Promise<void> {
  if (command !== "migrate") throw new Error("Expected: migrate.");
  const runtimeEnvironment = runtimeEnvironmentSchema.parse(process.env.NODE_ENV ?? "development");
  const sql = createC1Sql(databaseUrl(runtimeEnvironment, process.env, undefined));
  try {
    await applyC13Migration(sql);
    process.stdout.write(`${JSON.stringify({ command, status: "ok" })}\n`);
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
        event: "c13_admin_failed",
        status: "error",
      })}\n`,
    );
    process.exitCode = 1;
  });
}
