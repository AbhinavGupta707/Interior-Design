import { runtimeEnvironmentSchema, type RuntimeEnvironment } from "@interior-design/config";
import type { FastifyInstance } from "fastify";
import { access, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import postgres, { type Sql } from "postgres";

import type { ReadinessCheck } from "./health.js";
import {
  OidcTokenProvider,
  LocalFixtureTokenProvider,
  UnavailableTokenProvider,
  type SessionTokenProvider,
} from "./modules/identity/jwt.js";
import {
  parseIdentityFixtureSet,
  PostgresIdentityStore,
  seedIdentityFixtures,
} from "./modules/identity/postgres.js";
import { registerIdentityRoutes } from "./modules/identity/routes.js";
import { IdentityService } from "./modules/identity/service.js";
import type { IdentityStore } from "./modules/identity/store.js";
import { PostgresIntakeRepository, type IntakeRepository } from "./modules/intake/repository.js";
import { registerIntakeRoutes } from "./modules/intake/routes.js";
import {
  PostgresProjectRepository,
  type ProjectRepository,
} from "./modules/projects/repository.js";
import { registerProjectRoutes } from "./modules/projects/routes.js";

const LOCAL_DATABASE_URL =
  "postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design";
const LOCAL_SESSION_SECRET = "local-fixture-only-session-secret-not-for-production-2026-c1";

type C1EnvironmentSource = Readonly<Record<string, string | undefined>>;

export interface C1ModuleOptions {
  readonly closeDatabase?: boolean;
  readonly database?: Sql;
  readonly databaseUrl?: string;
  readonly identityStore?: IdentityStore;
  readonly intakeRepository?: IntakeRepository;
  readonly projectRepository?: ProjectRepository;
  readonly tokenProvider?: SessionTokenProvider;
}

export interface C1Module {
  readonly readinessChecks: readonly ReadinessCheck[];
}

function validatedDatabaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("C1_DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("C1_DATABASE_URL must use the postgres or postgresql protocol.");
  }
  return value;
}

function databaseUrl(
  runtimeEnvironment: RuntimeEnvironment,
  environment: C1EnvironmentSource,
  override: string | undefined,
): string {
  const configured = override ?? environment.C1_DATABASE_URL;
  if (configured !== undefined && configured.length > 0) {
    return validatedDatabaseUrl(configured);
  }
  if (runtimeEnvironment === "production") {
    throw new Error("C1_DATABASE_URL is required in production.");
  }
  return LOCAL_DATABASE_URL;
}

export function createC1Sql(url: string): Sql {
  return postgres(validatedDatabaseUrl(url), {
    connect_timeout: 5,
    idle_timeout: 20,
    max: 10,
    max_lifetime: 30 * 60,
    onnotice: () => undefined,
    prepare: true,
  });
}

function localTokenProvider(environment: C1EnvironmentSource): SessionTokenProvider {
  return new LocalFixtureTokenProvider(environment.C1_LOCAL_SESSION_SECRET ?? LOCAL_SESSION_SECRET);
}

function oidcTokenProvider(environment: C1EnvironmentSource): SessionTokenProvider {
  const issuer = environment.C1_OIDC_ISSUER;
  const audience = environment.C1_OIDC_AUDIENCE;
  const encodedPublicKey = environment.C1_OIDC_PUBLIC_KEY_BASE64;
  if (issuer === undefined || audience === undefined || encodedPublicKey === undefined) {
    return new UnavailableTokenProvider();
  }
  const publicKeyPem = Buffer.from(encodedPublicKey, "base64").toString("utf8");
  return new OidcTokenProvider({ audience, issuer, publicKeyPem });
}

function configuredTokenProvider(
  runtimeEnvironment: RuntimeEnvironment,
  environment: C1EnvironmentSource,
): SessionTokenProvider {
  const authMode =
    environment.C1_AUTH_MODE ?? (runtimeEnvironment === "production" ? "oidc" : "local");
  if (authMode === "local") {
    return runtimeEnvironment === "production"
      ? new UnavailableTokenProvider()
      : localTokenProvider(environment);
  }
  if (authMode === "oidc") {
    return oidcTokenProvider(environment);
  }
  throw new Error("C1_AUTH_MODE must be local or oidc.");
}

export function registerC1Module(
  server: FastifyInstance,
  runtimeEnvironment: RuntimeEnvironment,
  environment: C1EnvironmentSource,
  options: C1ModuleOptions = {},
): C1Module {
  const needsDatabase =
    options.identityStore === undefined ||
    options.projectRepository === undefined ||
    options.intakeRepository === undefined;
  const ownsDatabase = needsDatabase && options.database === undefined;
  const sql = needsDatabase
    ? (options.database ??
      createC1Sql(databaseUrl(runtimeEnvironment, environment, options.databaseUrl)))
    : options.database;
  const identityStore = options.identityStore ?? new PostgresIdentityStore(sql as Sql);
  const projects = options.projectRepository ?? new PostgresProjectRepository(sql as Sql);
  const intakes = options.intakeRepository ?? new PostgresIntakeRepository(sql as Sql);
  const tokenProvider =
    options.tokenProvider ?? configuredTokenProvider(runtimeEnvironment, environment);
  const identity = new IdentityService(runtimeEnvironment, identityStore, tokenProvider);

  registerIdentityRoutes(server, identity);
  registerProjectRoutes(server, identity, projects);
  registerIntakeRoutes(server, identity, projects, intakes);

  if (sql !== undefined && (ownsDatabase || options.closeDatabase === true)) {
    server.addHook("onClose", async () => {
      await sql.end({ timeout: 5 });
    });
  }

  const readinessChecks: ReadinessCheck[] = [
    {
      name: "database",
      check:
        sql === undefined
          ? () => undefined
          : async () => {
              const rows = await sql<{ readonly id: string }[]>`
                SELECT id
                FROM platform_schema_migrations
                WHERE id = '0001_identity_projects_intake'
                LIMIT 1
              `;
              if (rows.length !== 1) {
                throw new Error("C1 database migration is not applied.");
              }
            },
    },
    {
      name: "identity-provider",
      check: () => {
        if (!identity.providerAvailable) {
          throw new Error("Identity provider is not configured.");
        }
      },
    },
  ];
  return { readinessChecks };
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
  throw new Error("The required C1 repository file could not be located.");
}

async function migrationPath(): Promise<string> {
  return firstExistingPath([
    path.resolve(
      process.cwd(),
      "services/platform-api/migrations/0001_identity_projects_intake.sql",
    ),
    path.resolve(process.cwd(), "migrations/0001_identity_projects_intake.sql"),
  ]);
}

async function fixturePath(): Promise<string> {
  return firstExistingPath([
    path.resolve(process.cwd(), "tests/fixtures/c1/tenants.json"),
    path.resolve(process.cwd(), "../../tests/fixtures/c1/tenants.json"),
  ]);
}

export async function applyC1Migration(sql: Sql, filePath?: string): Promise<void> {
  const resolvedPath = filePath ?? (await migrationPath());
  await sql.begin(async (transaction) => {
    await transaction.file(resolvedPath);
  });
}

export async function bootstrapC1Fixtures(
  sql: Sql,
  runtimeEnvironment: RuntimeEnvironment,
  filePath?: string,
): Promise<void> {
  if (runtimeEnvironment === "production") {
    throw new Error("Synthetic C1 fixtures cannot be bootstrapped in production.");
  }
  const contents = await readFile(filePath ?? (await fixturePath()), "utf8");
  const fixtures = parseIdentityFixtureSet(JSON.parse(contents) as unknown);
  await seedIdentityFixtures(sql, fixtures);
}

async function runAdminCommand(command: string | undefined): Promise<void> {
  const runtimeEnvironment = runtimeEnvironmentSchema.parse(process.env.NODE_ENV ?? "development");
  if (!["migrate", "bootstrap-fixtures", "migrate-and-bootstrap"].includes(command ?? "")) {
    throw new Error("Expected one of: migrate, bootstrap-fixtures, migrate-and-bootstrap.");
  }
  const sql = createC1Sql(databaseUrl(runtimeEnvironment, process.env, undefined));
  try {
    if (command === "migrate" || command === "migrate-and-bootstrap") {
      await applyC1Migration(sql);
    }
    if (command === "bootstrap-fixtures" || command === "migrate-and-bootstrap") {
      await bootstrapC1Fixtures(sql, runtimeEnvironment);
    }
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
        event: "c1_admin_failed",
        status: "error",
      })}\n`,
    );
    process.exitCode = 1;
  });
}
