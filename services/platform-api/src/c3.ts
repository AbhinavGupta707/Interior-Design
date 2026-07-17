import { runtimeEnvironmentSchema, type RuntimeEnvironment } from "@interior-design/config";
import {
  createPropertyAdapter,
  type PropertyAdapter,
  type PropertyAdapterMode,
} from "@interior-design/provider-adapters/property";
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
import { PostgresPropertyBackend, type PropertyClock } from "./modules/property/postgres.js";
import { registerPropertyRoutes } from "./modules/property/routes.js";
import type { PropertyBackend } from "./modules/property/types.js";
import {
  PostgresProjectRepository,
  type ProjectRepository,
} from "./modules/projects/repository.js";

const LOCAL_DATABASE_URL =
  "postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design";
const LOCAL_SESSION_SECRET = "local-fixture-only-session-secret-not-for-production-2026-c1";

type C3EnvironmentSource = Readonly<Record<string, string | undefined>>;

export interface C3ModuleOptions {
  readonly adapter?: PropertyAdapter;
  readonly backend?: PropertyBackend;
  readonly clock?: PropertyClock;
  readonly closeDatabase?: boolean;
  readonly database?: Sql;
  readonly databaseUrl?: string;
  readonly identity?: IdentityService;
  readonly projects?: ProjectRepository;
  readonly tokenProvider?: SessionTokenProvider;
}

export interface C3Module {
  readonly backend: PropertyBackend;
  readonly readinessChecks: readonly ReadinessCheck[];
}

function databaseUrl(
  runtimeEnvironment: RuntimeEnvironment,
  environment: C3EnvironmentSource,
  override: string | undefined,
): string {
  const configured = override ?? environment.C3_DATABASE_URL ?? environment.C1_DATABASE_URL;
  if (configured !== undefined && configured.length > 0) {
    return configured;
  }
  if (runtimeEnvironment === "production") {
    throw new Error("C3_DATABASE_URL or C1_DATABASE_URL is required in production.");
  }
  return LOCAL_DATABASE_URL;
}

function tokenProvider(
  runtimeEnvironment: RuntimeEnvironment,
  environment: C3EnvironmentSource,
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

function adapterMode(
  runtimeEnvironment: RuntimeEnvironment,
  environment: C3EnvironmentSource,
): PropertyAdapterMode {
  const mode =
    environment.C3_PROPERTY_PROVIDER_MODE ??
    (runtimeEnvironment === "production" ? "disabled" : "fixture");
  if (!(["disabled", "fixture", "unavailable"] as const).includes(mode as PropertyAdapterMode)) {
    throw new Error("C3_PROPERTY_PROVIDER_MODE must be disabled, fixture, or unavailable.");
  }
  if (runtimeEnvironment === "production" && mode !== "disabled") {
    throw new Error("C3 production property resolution must remain disabled.");
  }
  return mode as PropertyAdapterMode;
}

export function registerC3Module(
  server: FastifyInstance,
  runtimeEnvironment: RuntimeEnvironment,
  environment: C3EnvironmentSource,
  options: C3ModuleOptions = {},
): C3Module {
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
      options.tokenProvider ?? tokenProvider(runtimeEnvironment, environment),
    );
  const projects = options.projects ?? new PostgresProjectRepository(sql as Sql);
  const adapter =
    options.adapter ??
    createPropertyAdapter(adapterMode(runtimeEnvironment, environment), {
      ...(options.clock === undefined ? {} : { clock: options.clock }),
    });
  const backend =
    options.backend ??
    new PostgresPropertyBackend(sql as Sql, adapter, {
      ...(options.clock === undefined ? {} : { clock: options.clock }),
    });

  registerPropertyRoutes(server, identity, projects, backend);

  if (sql !== undefined && (ownsDatabase || options.closeDatabase === true)) {
    server.addHook("onClose", async () => {
      await sql.end({ timeout: 5 });
    });
  }

  const readinessChecks: ReadinessCheck[] = [];
  if (sql !== undefined) {
    readinessChecks.push({
      name: "c3-database",
      check: async () => {
        const rows = await sql<{ readonly id: string }[]>`
          SELECT id
          FROM platform_schema_migrations
          WHERE id = '0003_property_dossier'
          LIMIT 1
        `;
        if (rows.length !== 1) {
          throw new Error("C3 database migration is not applied.");
        }
      },
    });
  }
  return { backend, readinessChecks };
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
  throw new Error("The required C3 migration file could not be located.");
}

async function migrationPath(): Promise<string> {
  return firstExistingPath([
    path.resolve(process.cwd(), "services/platform-api/migrations/0003_property_dossier.sql"),
    path.resolve(process.cwd(), "migrations/0003_property_dossier.sql"),
  ]);
}

export async function applyC3Migration(sql: Sql, filePath?: string): Promise<void> {
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
    await applyC3Migration(sql);
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
        event: "c3_admin_failed",
        status: "error",
      })}\n`,
    );
    process.exitCode = 1;
  });
}
