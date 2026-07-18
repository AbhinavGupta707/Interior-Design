import { runtimeEnvironmentSchema, type RuntimeEnvironment } from "@interior-design/config";
import { DeterministicDesignBriefKernel } from "@interior-design/design-brief";
import { BoundedModelGateway } from "@interior-design/model-gateway";
import type { FastifyInstance } from "fastify";
import { access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Sql } from "postgres";

import { createC1Sql } from "./c1.js";
import type { ReadinessCheck } from "./health.js";
import { PostgresBriefRepository } from "./modules/briefs/postgres.js";
import { registerBriefRoutes } from "./modules/briefs/routes.js";
import { BriefService } from "./modules/briefs/service.js";
import { PostgresBriefSourceVerifier } from "./modules/briefs/sources.js";
import type {
  BriefDomainKernel,
  BriefProposalConfirmationPort,
  BriefRepository,
  BriefSourceVerifier,
} from "./modules/briefs/types.js";
import { PostgresDesignAgentRepository } from "./modules/design-agent/postgres.js";
import { registerDesignAgentRoutes } from "./modules/design-agent/routes.js";
import { DesignAgentService } from "./modules/design-agent/service.js";
import type {
  BriefCommandPort,
  DesignAgentModelPort,
  DesignAgentRepository,
} from "./modules/design-agent/types.js";
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

type C11EnvironmentSource = Readonly<Record<string, string | undefined>>;

export interface C11ModuleOptions {
  readonly briefConfirmation?: BriefProposalConfirmationPort;
  readonly briefDomain?: BriefDomainKernel;
  readonly briefRepository?: BriefRepository;
  readonly briefSources?: BriefSourceVerifier;
  readonly closeDatabase?: boolean;
  readonly database?: Sql;
  readonly databaseUrl?: string;
  readonly designAgentModel?: DesignAgentModelPort;
  readonly designAgentRepository?: DesignAgentRepository;
  readonly identity?: IdentityService;
  readonly projects?: ProjectRepository;
  readonly tokenProvider?: SessionTokenProvider;
}

export interface C11Module {
  readonly briefService: BriefService;
  readonly designAgentService: DesignAgentService;
  readonly readinessChecks: readonly ReadinessCheck[];
}

function databaseUrl(
  runtimeEnvironment: RuntimeEnvironment,
  environment: C11EnvironmentSource,
  override: string | undefined,
): string {
  const configured =
    override ??
    environment.C11_DATABASE_URL ??
    environment.C10_DATABASE_URL ??
    environment.C9_DATABASE_URL ??
    environment.C8_DATABASE_URL ??
    environment.C7_DATABASE_URL ??
    environment.C6_DATABASE_URL ??
    environment.C1_DATABASE_URL;
  if (configured !== undefined && configured.length > 0) return configured;
  if (runtimeEnvironment === "production") {
    throw new Error("C11_DATABASE_URL or a predecessor database URL is required in production.");
  }
  return LOCAL_DATABASE_URL;
}

function configuredTokenProvider(
  runtimeEnvironment: RuntimeEnvironment,
  environment: C11EnvironmentSource,
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

function briefCommandPort(repository: BriefRepository, service: BriefService): BriefCommandPort {
  return {
    async confirmProposal(command) {
      return service.confirmProposal({
        actor: command.actor,
        confirmation: command.confirmation,
        correlation: command.correlation,
        expectedProposalStatus: command.expectedProposalStatus,
        expectedSessionState: command.expectedSessionState,
        expectedTurnCount: command.expectedTurnCount,
        projectId: command.projectId,
        proposal: command.proposal,
        update: command.request,
      });
    },
    async findCurrent(tenantId, projectId, briefId) {
      const current = await repository.findCurrent(tenantId, projectId);
      return current?.brief.id === briefId ? current.brief : undefined;
    },
  };
}

function localModelPort(gateway: BoundedModelGateway): DesignAgentModelPort {
  return {
    process(request, options) {
      return gateway.invoke(request, options);
    },
  };
}

export function registerC11Module(
  server: FastifyInstance,
  runtimeEnvironment: RuntimeEnvironment,
  environment: C11EnvironmentSource,
  options: C11ModuleOptions = {},
): C11Module {
  const needsDatabase =
    options.briefRepository === undefined ||
    options.briefSources === undefined ||
    options.designAgentRepository === undefined ||
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
  const briefDomain = options.briefDomain ?? new DeterministicDesignBriefKernel();
  let defaultBriefRepository: PostgresBriefRepository | undefined;
  let briefRepository: BriefRepository;
  if (options.briefRepository === undefined) {
    defaultBriefRepository = new PostgresBriefRepository(sql as Sql, briefDomain);
    briefRepository = defaultBriefRepository;
  } else {
    briefRepository = options.briefRepository;
  }
  const briefSources = options.briefSources ?? new PostgresBriefSourceVerifier(sql as Sql);
  const briefConfirmation = options.briefConfirmation ?? defaultBriefRepository;
  const briefService = new BriefService({
    ...(briefConfirmation === undefined ? {} : { confirmation: briefConfirmation }),
    repository: briefRepository,
    sources: briefSources,
  });
  const designAgentRepository =
    options.designAgentRepository ?? new PostgresDesignAgentRepository(sql as Sql);
  const modelGateway = new BoundedModelGateway();
  const designAgentModel = options.designAgentModel ?? localModelPort(modelGateway);
  const designAgentService = new DesignAgentService({
    briefs: briefCommandPort(briefRepository, briefService),
    model: designAgentModel,
    repository: designAgentRepository,
  });

  registerBriefRoutes(server, identity, projects, briefService);
  registerDesignAgentRoutes(server, identity, projects, designAgentService);

  if (sql !== undefined && (ownsDatabase || options.closeDatabase === true)) {
    server.addHook("onClose", async () => {
      await sql.end({ timeout: 5 });
    });
  }

  const readinessChecks: ReadinessCheck[] = [];
  if (sql !== undefined) {
    readinessChecks.push({
      name: "c11-database",
      check: async () => {
        const rows = await sql<{ readonly id: string }[]>`
          SELECT id FROM platform_schema_migrations
          WHERE id = '0011_design_briefs'
          LIMIT 1
        `;
        if (rows.length !== 1) throw new Error("C11 database migration is not applied.");
      },
    });
  }
  readinessChecks.push({
    name: "c11-local-model-gateway",
    check: () => {
      if (!modelGateway.capability("deterministic-local-v1").available) {
        throw new Error("The C11 deterministic local model gateway is not composed.");
      }
    },
  });
  return { briefService, designAgentService, readinessChecks };
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
  throw new Error("The required C11 migration file could not be located.");
}

export async function applyC11Migration(sql: Sql, filePath?: string): Promise<void> {
  const resolvedPath =
    filePath ??
    (await firstExistingPath([
      path.resolve(process.cwd(), "services/platform-api/migrations/0011_design_briefs.sql"),
      path.resolve(process.cwd(), "migrations/0011_design_briefs.sql"),
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
    await applyC11Migration(sql);
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
        event: "c11_admin_failed",
        status: "error",
      })}\n`,
    );
    process.exitCode = 1;
  });
}
