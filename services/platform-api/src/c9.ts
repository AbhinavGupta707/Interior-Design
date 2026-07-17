import { runtimeEnvironmentSchema, type RuntimeEnvironment } from "@interior-design/config";
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
import { PostgresModelFusionRepository } from "./modules/model-fusion/postgres.js";
import { registerModelFusionRoutes } from "./modules/model-fusion/routes.js";
import { ModelFusionService } from "./modules/model-fusion/service.js";
import { PostgresFusionVerification } from "./modules/model-fusion/sources.js";
import type {
  FusionBaseVerifier,
  FusionClock,
  FusionRepository,
  FusionSourceVerifier,
  FusionTelemetry,
  FusionUuidFactory,
} from "./modules/model-fusion/types.js";
import {
  PostgresProjectRepository,
  type ProjectRepository,
} from "./modules/projects/repository.js";

const LOCAL_DATABASE_URL =
  "postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design";
const LOCAL_SESSION_SECRET = "local-fixture-only-session-secret-not-for-production-2026-c1";

type C9EnvironmentSource = Readonly<Record<string, string | undefined>>;

export interface C9ModuleOptions {
  readonly baseVerifier?: FusionBaseVerifier;
  readonly clock?: FusionClock;
  readonly closeDatabase?: boolean;
  readonly database?: Sql;
  readonly databaseUrl?: string;
  readonly identity?: IdentityService;
  readonly projects?: ProjectRepository;
  readonly repository?: FusionRepository;
  readonly sourceVerifier?: FusionSourceVerifier;
  readonly telemetry?: FusionTelemetry;
  readonly tokenProvider?: SessionTokenProvider;
  readonly uuid?: FusionUuidFactory;
}

export interface C9Module {
  readonly readinessChecks: readonly ReadinessCheck[];
  readonly repository: FusionRepository;
  readonly service: ModelFusionService;
}

function databaseUrl(
  runtimeEnvironment: RuntimeEnvironment,
  environment: C9EnvironmentSource,
  override: string | undefined,
): string {
  const configured =
    override ??
    environment.C9_DATABASE_URL ??
    environment.C8_DATABASE_URL ??
    environment.C7_DATABASE_URL ??
    environment.C6_DATABASE_URL ??
    environment.C1_DATABASE_URL;
  if (configured !== undefined && configured.length > 0) return configured;
  if (runtimeEnvironment === "production") {
    throw new Error("C9_DATABASE_URL or a predecessor database URL is required in production.");
  }
  return LOCAL_DATABASE_URL;
}

function configuredTokenProvider(
  runtimeEnvironment: RuntimeEnvironment,
  environment: C9EnvironmentSource,
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

export function registerC9Module(
  server: FastifyInstance,
  runtimeEnvironment: RuntimeEnvironment,
  environment: C9EnvironmentSource,
  options: C9ModuleOptions = {},
): C9Module {
  const needsDatabase =
    options.repository === undefined ||
    options.sourceVerifier === undefined ||
    options.baseVerifier === undefined ||
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
  const repository =
    options.repository ??
    new PostgresModelFusionRepository(sql as Sql, {
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      ...(options.uuid === undefined ? {} : { uuid: options.uuid }),
    });
  const verification = new PostgresFusionVerification(sql as Sql);
  const service = new ModelFusionService({
    baseVerifier: options.baseVerifier ?? verification,
    repository,
    sourceVerifier: options.sourceVerifier ?? verification,
    ...(options.telemetry === undefined ? {} : { telemetry: options.telemetry }),
  });
  registerModelFusionRoutes(server, identity, projects, service);

  if (sql !== undefined && (ownsDatabase || options.closeDatabase === true)) {
    server.addHook("onClose", async () => {
      await sql.end({ timeout: 5 });
    });
  }
  const readinessChecks: ReadinessCheck[] = [];
  if (sql !== undefined) {
    readinessChecks.push({
      name: "c9-database",
      check: async () => {
        const rows = await sql<{ readonly id: string }[]>`
          SELECT id FROM platform_schema_migrations WHERE id = '0009_model_fusion' LIMIT 1
        `;
        if (rows.length !== 1) throw new Error("C9 database migration is not applied.");
      },
    });
  }
  return { readinessChecks, repository, service };
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
  throw new Error("The required C9 migration file could not be located.");
}

export async function applyC9Migration(sql: Sql, filePath?: string): Promise<void> {
  const resolvedPath =
    filePath ??
    (await firstExistingPath([
      path.resolve(process.cwd(), "services/platform-api/migrations/0009_model_fusion.sql"),
      path.resolve(process.cwd(), "migrations/0009_model_fusion.sql"),
    ]));
  await sql.begin(async (transaction) => {
    await transaction.file(resolvedPath);
  });
}

async function runAdminCommand(command: string | undefined): Promise<void> {
  if (command !== "migrate") throw new Error("Expected: migrate.");
  const runtimeEnvironment = runtimeEnvironmentSchema.parse(process.env.NODE_ENV ?? "development");
  const sql = createC1Sql(databaseUrl(runtimeEnvironment, process.env, undefined));
  try {
    await applyC9Migration(sql);
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
        event: "c9_admin_failed",
        status: "error",
      })}\n`,
    );
    process.exitCode = 1;
  });
}
