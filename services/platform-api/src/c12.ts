import { runtimeEnvironmentSchema, type RuntimeEnvironment } from "@interior-design/config";
import {
  deriveDeterministicDesignConstraints,
  deterministicSearchConfigurationVersion,
} from "@interior-design/design-engine";
import {
  creatorOwnedSyntheticAssetCatalog,
  validateAssetCatalog,
} from "@interior-design/interior-assets";
import type { FastifyInstance } from "fastify";
import { access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Sql } from "postgres";

import { createC1Sql } from "./c1.js";
import { deriveC12SystemPolicy } from "./c12-policy.js";
import type { ReadinessCheck } from "./health.js";
import { CatalogDesignAssetVerifier } from "./modules/design-options/catalog.js";
import { designOptionConflict } from "./modules/design-options/errors.js";
import { PostgresDesignOptionRepository } from "./modules/design-options/postgres.js";
import { registerDesignOptionRoutes } from "./modules/design-options/routes.js";
import { DesignOptionService } from "./modules/design-options/service.js";
import { PostgresDesignOptionSourceVerifier } from "./modules/design-options/sources.js";
import type {
  DesignAssetVerificationPort,
  DesignConstraintDerivationPort,
  DesignOptionClock,
  DesignOptionRepository,
  DesignOptionSourceVerifier,
  DesignOptionTelemetry,
  DesignOptionUuidFactory,
} from "./modules/design-options/types.js";
import { DesignOptionWorkerRuntime } from "./modules/design-options/worker.js";
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

const LOCAL_DATABASE_URL =
  "postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design";
const LOCAL_SESSION_SECRET = "local-fixture-only-session-secret-not-for-production-2026-c1";

export const c12SystemBoundaryTouchPolicy = Object.freeze({
  keepOut: "forbid" as const,
  obstacle: "allow" as const,
  room: "allow" as const,
});

type C12EnvironmentSource = Readonly<Record<string, string | undefined>>;

export interface C12ModuleOptions {
  readonly assetVerifier?: DesignAssetVerificationPort;
  readonly clock?: DesignOptionClock;
  readonly closeDatabase?: boolean;
  readonly constraintDeriver?: DesignConstraintDerivationPort;
  readonly database?: Sql;
  readonly databaseUrl?: string;
  readonly identity?: IdentityService;
  readonly projects?: ProjectRepository;
  readonly repository?: DesignOptionRepository;
  readonly sourceVerifier?: DesignOptionSourceVerifier;
  readonly telemetry?: DesignOptionTelemetry;
  readonly tokenProvider?: SessionTokenProvider;
  readonly uuid?: DesignOptionUuidFactory;
}

export interface C12Module {
  readonly assetVerifier: DesignAssetVerificationPort;
  readonly readinessChecks: readonly ReadinessCheck[];
  readonly repository: DesignOptionRepository;
  readonly service: DesignOptionService;
  readonly worker: DesignOptionWorkerRuntime;
}

function databaseUrl(
  runtimeEnvironment: RuntimeEnvironment,
  environment: C12EnvironmentSource,
  override: string | undefined,
): string {
  const configured =
    override ??
    environment.C12_DATABASE_URL ??
    environment.C11_DATABASE_URL ??
    environment.C10_DATABASE_URL ??
    environment.C9_DATABASE_URL ??
    environment.C8_DATABASE_URL ??
    environment.C7_DATABASE_URL ??
    environment.C6_DATABASE_URL ??
    environment.C1_DATABASE_URL;
  if (configured !== undefined && configured.length > 0) return configured;
  if (runtimeEnvironment === "production") {
    throw new Error("C12_DATABASE_URL or a predecessor database URL is required in production.");
  }
  return LOCAL_DATABASE_URL;
}

function configuredTokenProvider(
  runtimeEnvironment: RuntimeEnvironment,
  environment: C12EnvironmentSource,
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

export class DeterministicDesignConstraintDeriver implements DesignConstraintDerivationPort {
  derive(input: Parameters<DesignConstraintDerivationPort["derive"]>[0]) {
    const policy = deriveC12SystemPolicy(input.workingSnapshot);
    const result = deriveDeterministicDesignConstraints({
      acceptedBrief: input.brief,
      acceptedBriefContentSha256: input.request.baseBrief.contentSha256,
      briefConstraintFacts: policy.briefConstraintFacts,
      finishTargets: policy.finishTargets,
      keepOuts: policy.keepOuts,
      sourceModel: input.request.sourceModel,
      sourceSnapshot: input.source.snapshot,
      systemPolicy: {
        boundaryTouch: c12SystemBoundaryTouchPolicy,
        schemaVersion: deterministicSearchConfigurationVersion,
      },
      workingModel: input.workingModel,
      workingSnapshot: input.workingSnapshot,
    });
    if (!result.ok) {
      throw designOptionConflict(
        "CONSTRAINTS_FAILED",
        `C12 deterministic constraint derivation abstained with ${result.abstention.code}.`,
        422,
      );
    }
    return Promise.resolve({
      assetManifestSha256: creatorOwnedSyntheticAssetCatalog.manifestSha256,
      constraints: result.constraints,
    });
  }
}

export function registerC12Module(
  server: FastifyInstance,
  runtimeEnvironment: RuntimeEnvironment,
  environment: C12EnvironmentSource,
  options: C12ModuleOptions = {},
): C12Module {
  const needsDatabase =
    options.repository === undefined ||
    options.sourceVerifier === undefined ||
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
  const assetVerifier =
    options.assetVerifier ??
    new CatalogDesignAssetVerifier({ catalog: creatorOwnedSyntheticAssetCatalog });
  const repository =
    options.repository ??
    new PostgresDesignOptionRepository(sql as Sql, {
      assetVerifier,
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      ...(options.uuid === undefined ? {} : { uuid: options.uuid }),
    });
  const sourceVerifier =
    options.sourceVerifier ?? new PostgresDesignOptionSourceVerifier(sql as Sql);
  const service = new DesignOptionService({
    constraintDeriver: options.constraintDeriver ?? new DeterministicDesignConstraintDeriver(),
    repository,
    sourceVerifier,
    ...(options.telemetry === undefined ? {} : { telemetry: options.telemetry }),
    ...(options.uuid === undefined ? {} : { uuid: options.uuid }),
  });
  const worker = new DesignOptionWorkerRuntime(repository);
  registerDesignOptionRoutes(server, identity, projects, service);

  if (sql !== undefined && (ownsDatabase || options.closeDatabase === true)) {
    server.addHook("onClose", async () => {
      await sql.end({ timeout: 5 });
    });
  }
  const readinessChecks: ReadinessCheck[] = [];
  if (sql !== undefined) {
    readinessChecks.push({
      name: "c12-database",
      check: async () => {
        const rows = await sql<{ readonly id: string }[]>`
          SELECT id FROM platform_schema_migrations WHERE id = '0012_design_options' LIMIT 1
        `;
        if (rows.length !== 1) throw new Error("C12 database migration is not applied.");
      },
    });
  }
  readinessChecks.push({
    name: "c12-deterministic-design-runtime",
    check: () => {
      const catalog = validateAssetCatalog(creatorOwnedSyntheticAssetCatalog);
      const kinds = new Set(catalog.assets.map(({ ref }) => ref.kind));
      if (!(["finish", "furnishing", "light"] as const).every((kind) => kinds.has(kind))) {
        throw new Error("The deterministic C12 engine or creator-owned catalog is unavailable.");
      }
    },
  });
  return { assetVerifier, readinessChecks, repository, service, worker };
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
  throw new Error("The required C12 migration file could not be located.");
}

export async function applyC12Migration(sql: Sql, filePath?: string): Promise<void> {
  const resolvedPath =
    filePath ??
    (await firstExistingPath([
      path.resolve(process.cwd(), "services/platform-api/migrations/0012_design_options.sql"),
      path.resolve(process.cwd(), "migrations/0012_design_options.sql"),
    ]));
  await sql.begin(async (transaction) => transaction.file(resolvedPath));
}

async function runAdminCommand(command: string | undefined): Promise<void> {
  if (command !== "migrate") throw new Error("Expected: migrate.");
  const runtimeEnvironment = runtimeEnvironmentSchema.parse(process.env.NODE_ENV ?? "development");
  const sql = createC1Sql(databaseUrl(runtimeEnvironment, process.env, undefined));
  try {
    await applyC12Migration(sql);
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
        event: "c12_admin_failed",
        status: "error",
      })}\n`,
    );
    process.exitCode = 1;
  });
}
