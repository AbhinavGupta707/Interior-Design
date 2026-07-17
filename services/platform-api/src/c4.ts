import { runtimeEnvironmentSchema, type RuntimeEnvironment } from "@interior-design/config";
import { validateCanonicalGeometry } from "@interior-design/geometry-kernel";
import type { FastifyInstance } from "fastify";
import { access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Sql } from "postgres";

import { createC1Sql } from "./c1.js";
import type { ReadinessCheck } from "./health.js";
import {
  LocalFixtureTokenProvider,
  OidcTokenProvider,
  UnavailableTokenProvider,
  type SessionTokenProvider,
} from "./modules/identity/jwt.js";
import { PostgresIdentityStore } from "./modules/identity/postgres.js";
import { IdentityService } from "./modules/identity/service.js";
import { DomainCanonicalSnapshotCodec } from "./modules/models/core/canonical.js";
import {
  PostgresCanonicalModelRepository,
  type CanonicalModelClock,
  type CanonicalModelUuidFactory,
} from "./modules/models/core/postgres.js";
import { registerCanonicalModelRoutes } from "./modules/models/core/routes.js";
import { CanonicalModelService } from "./modules/models/core/service.js";
import type {
  CanonicalGeometryValidator,
  CanonicalModelRepository,
  CanonicalSnapshotCodec,
} from "./modules/models/core/types.js";
import {
  PostgresProjectRepository,
  type ProjectRepository,
} from "./modules/projects/repository.js";

const LOCAL_DATABASE_URL =
  "postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design";
const LOCAL_SESSION_SECRET = "local-fixture-only-session-secret-not-for-production-2026-c1";

type C4EnvironmentSource = Readonly<Record<string, string | undefined>>;

export interface C4ModuleOptions {
  readonly clock?: CanonicalModelClock;
  readonly closeDatabase?: boolean;
  readonly codec?: CanonicalSnapshotCodec;
  readonly database?: Sql;
  readonly databaseUrl?: string;
  readonly geometryValidator?: CanonicalGeometryValidator;
  readonly identity?: IdentityService;
  readonly projects?: ProjectRepository;
  readonly repository?: CanonicalModelRepository;
  readonly tokenProvider?: SessionTokenProvider;
  readonly uuid?: CanonicalModelUuidFactory;
}

export interface C4Module {
  readonly readinessChecks: readonly ReadinessCheck[];
  readonly service: CanonicalModelService;
}

function databaseUrl(
  runtimeEnvironment: RuntimeEnvironment,
  environment: C4EnvironmentSource,
  override: string | undefined,
): string {
  const configured = override ?? environment.C4_DATABASE_URL ?? environment.C1_DATABASE_URL;
  if (configured !== undefined && configured.length > 0) {
    return configured;
  }
  if (runtimeEnvironment === "production") {
    throw new Error("C4_DATABASE_URL or C1_DATABASE_URL is required in production.");
  }
  return LOCAL_DATABASE_URL;
}

function configuredTokenProvider(
  runtimeEnvironment: RuntimeEnvironment,
  environment: C4EnvironmentSource,
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

export function registerC4Module(
  server: FastifyInstance,
  runtimeEnvironment: RuntimeEnvironment,
  environment: C4EnvironmentSource,
  options: C4ModuleOptions = {},
): C4Module {
  const needsDatabase =
    options.repository === undefined ||
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
  const codec = options.codec ?? new DomainCanonicalSnapshotCodec();
  const repository =
    options.repository ??
    new PostgresCanonicalModelRepository(sql as Sql, codec, {
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      ...(options.uuid === undefined ? {} : { uuid: options.uuid }),
    });
  const service = new CanonicalModelService(
    repository,
    codec,
    options.geometryValidator ?? validateCanonicalGeometry,
  );

  registerCanonicalModelRoutes(server, identity, projects, service);
  if (sql !== undefined && (ownsDatabase || options.closeDatabase === true)) {
    server.addHook("onClose", async () => {
      await sql.end({ timeout: 5 });
    });
  }
  const readinessChecks: ReadinessCheck[] = [];
  if (sql !== undefined) {
    readinessChecks.push({
      name: "c4-database",
      check: async () => {
        const rows = await sql<{ readonly id: string }[]>`
          SELECT id
          FROM platform_schema_migrations
          WHERE id = '0004_canonical_models'
          LIMIT 1
        `;
        if (rows.length !== 1) {
          throw new Error("C4 database migration is not applied.");
        }
      },
    });
  }
  return { readinessChecks, service };
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
  throw new Error("The required C4 migration file could not be located.");
}

async function migrationPath(): Promise<string> {
  return firstExistingPath([
    path.resolve(process.cwd(), "services/platform-api/migrations/0004_canonical_models.sql"),
    path.resolve(process.cwd(), "migrations/0004_canonical_models.sql"),
  ]);
}

export async function applyC4Migration(sql: Sql, filePath?: string): Promise<void> {
  const resolvedPath = filePath ?? (await migrationPath());
  await sql.begin(async (transaction) => {
    await transaction.file(resolvedPath);
  });
}

async function runAdminCommand(command: string | undefined): Promise<void> {
  const runtimeEnvironment = runtimeEnvironmentSchema.parse(process.env.NODE_ENV ?? "development");
  if (command !== "migrate") {
    throw new Error("Expected: migrate.");
  }
  const sql = createC1Sql(databaseUrl(runtimeEnvironment, process.env, undefined));
  try {
    await applyC4Migration(sql);
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
        event: "c4_admin_failed",
        status: "error",
      })}\n`,
    );
    process.exitCode = 1;
  });
}
