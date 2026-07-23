import { runtimeEnvironmentSchema, type RuntimeEnvironment } from "@interior-design/config";
import { S3Client } from "@aws-sdk/client-s3";
import type { FastifyInstance } from "fastify";
import { access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Sql } from "postgres";

import { createC1Sql } from "./c1.js";
import type { ReadinessCheck } from "./health.js";
import {
  C10EmbeddedC13BindingInspector,
  C10RenderSceneAuthority,
  C13RenderSpecificationAuthority,
  EncryptedRenderArtifactBroker,
  FrozenRenderProfileAuthority,
  PortBackedRenderSourceResolver,
  PostgresRenderRepository,
  RenderStillService,
  RenderStillWorkerService,
  S3RenderObjectStorage,
  S3ExactSceneGlbReader,
  registerRenderStillRoutes,
  type ExactSceneGlbReader,
  type RenderCapabilities,
  type RenderObjectStorage,
  type RenderArtifactBroker,
  type RenderRepository,
  type RenderSourceResolver,
} from "./modules/render-stills/index.js";
import { renderUnavailable } from "./modules/render-stills/errors.js";
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
import type { CatalogRepository } from "./modules/catalog/types.js";
import type { SceneRepository } from "./modules/scenes/types.js";
import type { SpecificationSceneBindingResolver } from "./modules/specifications/types.js";
import { loadS3AssetStorageConfig } from "./storage/config.js";

const LOCAL_DATABASE_URL =
  "postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design";
const LOCAL_SESSION_SECRET = "local-fixture-only-session-secret-not-for-production-2026-c1";

type C14EnvironmentSource = Readonly<Record<string, string | undefined>>;

export interface C14ModuleOptions {
  readonly capabilities?: RenderCapabilities;
  readonly catalogRepository?: CatalogRepository;
  readonly closeDatabase?: boolean;
  readonly database?: Sql;
  readonly databaseUrl?: string;
  readonly identity?: IdentityService;
  readonly projects?: ProjectRepository;
  readonly repository?: RenderRepository;
  readonly resolver?: RenderSourceResolver;
  readonly sceneReader?: ExactSceneGlbReader;
  readonly sceneRepository?: SceneRepository;
  readonly specificationRepository?: SpecificationSceneBindingResolver;
  readonly storage?: RenderObjectStorage;
  readonly tokenProvider?: SessionTokenProvider;
}

export interface C14Module {
  readonly readinessChecks: readonly ReadinessCheck[];
  readonly repository: RenderRepository;
  readonly service: RenderStillService;
  readonly worker: RenderStillWorkerService;
}

function databaseUrl(
  runtimeEnvironment: RuntimeEnvironment,
  environment: C14EnvironmentSource,
  override: string | undefined,
): string {
  const configured =
    override ??
    environment.C14_DATABASE_URL ??
    environment.C13_DATABASE_URL ??
    environment.C10_DATABASE_URL ??
    environment.C1_DATABASE_URL;
  if (configured !== undefined && configured.length > 0) return configured;
  if (runtimeEnvironment === "production") {
    throw new Error("C14_DATABASE_URL or a predecessor database URL is required in production.");
  }
  return LOCAL_DATABASE_URL;
}

function configuredTokenProvider(
  runtimeEnvironment: RuntimeEnvironment,
  environment: C14EnvironmentSource,
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

const renderProfileCapabilities = [
  ["eevee-local-preview-v1", "render.eevee.host-gpu.v1"],
  ["cycles-cpu-geometry-safe-v1", "render.cycles.cpu.v1"],
  ["cycles-metal-geometry-safe-v1", "render.cycles.metal.v1"],
  ["cycles-cuda-high-resolution-v1", "render.cycles.cuda.v1"],
  ["cycles-optix-high-resolution-v1", "render.cycles.optix.v1"],
] as const;

type RenderProfileId = (typeof renderProfileCapabilities)[number][0];

function unavailableCapabilities(): RenderCapabilities {
  return {
    acceptingNewJobs: false,
    enhancementProvider: "disabled",
    hardwareEvidence: "deferred",
    profiles: renderProfileCapabilities.map(([profileId, capability]) => ({
      available: false,
      capability,
      profileId,
      reason: "No configured render worker is accepting new jobs.",
    })),
  };
}

function isSha256(value: string | undefined): value is string {
  return value !== undefined && /^[a-f0-9]{64}$/u.test(value);
}

function configuredProfileId(value: string | undefined): RenderProfileId | undefined {
  return renderProfileCapabilities.find(([profileId]) => profileId === value)?.[0];
}

/**
 * C14 deliberately defaults to unavailable.  Enabling a queue requires the API
 * and the separately configured spatial worker to share the same explicit
 * operator-attested profile pins.  The attestation value itself is never sent
 * to the browser or persisted in a render job; it is deployment evidence only.
 */
function configuredCapabilities(environment: C14EnvironmentSource): RenderCapabilities {
  const enabled = environment.C14_RENDER_WORKER_ENABLED;
  if (enabled === undefined || enabled === "false") return unavailableCapabilities();
  if (enabled !== "true") {
    throw new Error("C14_RENDER_WORKER_ENABLED must be true or false.");
  }
  const profileId = configuredProfileId(environment.C14_RENDER_PROFILE_ID);
  const requiredHashes = [
    environment.C14_RENDER_EXECUTABLE_SHA256,
    environment.C14_RENDERER_SCRIPT_SHA256,
    environment.C14_RENDER_HOST_FINGERPRINT_SHA256,
    environment.C14_RENDER_HOST_ACCEPTANCE_SHA256,
  ];
  if (
    profileId === undefined ||
    environment.C14_RENDER_HARDWARE_EVIDENCE !== "verified-authorised-host" ||
    environment.C14_BLENDER_BUILD_HASH?.trim().length === 0 ||
    environment.C14_BLENDER_VERSION?.trim().length === 0 ||
    requiredHashes.some((value) => !isSha256(value))
  ) {
    throw new Error(
      "An enabled C14 render worker requires an exact profile and verified authorised-host acceptance pins.",
    );
  }
  return {
    acceptingNewJobs: true,
    enhancementProvider: "disabled",
    hardwareEvidence: "verified-authorised-host",
    profiles: renderProfileCapabilities.map(([candidateProfileId, capability]) => ({
      available: candidateProfileId === profileId,
      capability,
      profileId: candidateProfileId,
      ...(candidateProfileId === profileId
        ? { reason: "An authorised render host is configured for this exact profile." }
        : { reason: "This profile is not configured on the authorised render host." }),
    })),
  };
}

class UnavailableRenderSourceResolver implements RenderSourceResolver {
  resolveForNewJob(): Promise<undefined> {
    return Promise.resolve().then(() => {
      throw renderUnavailable(
        "RENDER_CAPABILITY_UNAVAILABLE",
        "No configured render worker is available for this profile.",
      );
    });
  }

  revalidatePinnedSource(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

class UnavailableRenderObjectStorage implements RenderObjectStorage {
  #unavailable(): never {
    throw renderUnavailable(
      "RENDER_STORAGE_UNAVAILABLE",
      "No immutable render object store has been configured.",
    );
  }

  putImmutable(): Promise<{ readonly objectKey: string }> {
    return Promise.resolve().then(() => this.#unavailable());
  }

  readiness(): Promise<void> {
    return Promise.resolve();
  }

  signExactAccess(): Promise<{ readonly expiresAt: string; readonly url: string }> {
    return Promise.resolve().then(() => this.#unavailable());
  }
}

function defaultResolver(options: C14ModuleOptions): RenderSourceResolver {
  if (
    options.sceneReader === undefined ||
    options.sceneRepository === undefined ||
    options.specificationRepository === undefined ||
    options.catalogRepository === undefined
  ) {
    return new UnavailableRenderSourceResolver();
  }
  return new PortBackedRenderSourceResolver({
    embedded: new C10EmbeddedC13BindingInspector(),
    profiles: new FrozenRenderProfileAuthority(),
    scenes: new C10RenderSceneAuthority({
      reader: options.sceneReader,
      scenes: options.sceneRepository,
    }),
    specifications: new C13RenderSpecificationAuthority({
      catalog: options.catalogRepository,
      specifications: options.specificationRepository,
    }),
  });
}

function configuredObjectStorage(
  runtimeEnvironment: RuntimeEnvironment,
  environment: C14EnvironmentSource,
  options: C14ModuleOptions,
): { readonly broker?: RenderArtifactBroker; readonly storage: RenderObjectStorage } {
  if (options.storage !== undefined) return { storage: options.storage };
  const encodedKey = environment.C14_RENDER_ACCESS_KEY_BASE64;
  const baseUrl = environment.C14_RENDER_ARTIFACT_BASE_URL;
  if (encodedKey === undefined && baseUrl === undefined)
    return { storage: new UnavailableRenderObjectStorage() };
  if (encodedKey === undefined || baseUrl === undefined) {
    throw new Error(
      "C14 render artifact access requires both key material and a public API base URL.",
    );
  }
  let key: Buffer;
  let parsedBaseUrl: URL;
  try {
    key = Buffer.from(encodedKey, "base64");
    parsedBaseUrl = new URL(baseUrl);
  } catch {
    throw new Error("C14 render artifact access configuration is invalid.");
  }
  const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsedBaseUrl.hostname);
  if (
    key.byteLength !== 32 ||
    parsedBaseUrl.username ||
    parsedBaseUrl.password ||
    parsedBaseUrl.search ||
    parsedBaseUrl.hash ||
    !["http:", "https:"].includes(parsedBaseUrl.protocol) ||
    (runtimeEnvironment === "production" && (parsedBaseUrl.protocol !== "https:" || loopback)) ||
    (runtimeEnvironment !== "production" && parsedBaseUrl.protocol !== "https:" && !loopback)
  ) {
    throw new Error("C14 render artifact access configuration is unsafe.");
  }
  const config = loadS3AssetStorageConfig(runtimeEnvironment, environment);
  const client = new S3Client({
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    region: config.region,
  });
  const broker = new EncryptedRenderArtifactBroker({ baseUrl, client, key });
  return {
    broker,
    storage: new S3RenderObjectStorage(config, broker, { client }),
  };
}

function registerRenderArtifactBrokerRoute(
  server: FastifyInstance,
  broker: RenderArtifactBroker,
): void {
  server.get("/v1/render-artifact-access/:token", async (request, reply) => {
    const { token } = request.params as { readonly token?: unknown };
    if (typeof token !== "string" || token.length > 12_288) return reply.status(404).send();
    const artifact = await broker.open(token);
    if (artifact === undefined) return reply.status(404).send();
    reply.header("cache-control", "private, no-store");
    reply.header("content-disposition", "inline");
    reply.header("x-content-type-options", "nosniff");
    return reply.type(artifact.mediaType).send(artifact.bytes);
  });
}

function configuredSceneReader(
  runtimeEnvironment: RuntimeEnvironment,
  environment: C14EnvironmentSource,
  options: C14ModuleOptions,
): ExactSceneGlbReader | undefined {
  if (options.sceneReader !== undefined) return options.sceneReader;
  return options.sceneRepository === undefined
    ? undefined
    : new S3ExactSceneGlbReader(loadS3AssetStorageConfig(runtimeEnvironment, environment));
}

export function registerC14Module(
  server: FastifyInstance,
  runtimeEnvironment: RuntimeEnvironment,
  environment: C14EnvironmentSource,
  options: C14ModuleOptions = {},
): C14Module {
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
  const repository = options.repository ?? new PostgresRenderRepository(sql as Sql);
  const storageConfiguration = configuredObjectStorage(runtimeEnvironment, environment, options);
  const storage = storageConfiguration.storage;
  const configuredReader = configuredSceneReader(runtimeEnvironment, environment, options);
  const resolver =
    options.resolver ??
    defaultResolver({
      ...options,
      ...(configuredReader === undefined ? {} : { sceneReader: configuredReader }),
    });
  const capabilities = options.capabilities ?? configuredCapabilities(environment);
  const service = new RenderStillService({ capabilities, repository, resolver, storage });
  const worker = new RenderStillWorkerService({ repository, resolver, storage });
  registerRenderStillRoutes(server, identity, projects, service);
  if (storageConfiguration.broker !== undefined) {
    registerRenderArtifactBrokerRoute(server, storageConfiguration.broker);
  }

  if (sql !== undefined && (ownsDatabase || options.closeDatabase === true)) {
    server.addHook("onClose", async () => {
      await sql.end({ timeout: 5 });
    });
  }
  const readinessChecks: ReadinessCheck[] = [];
  if (sql !== undefined) {
    readinessChecks.push({
      name: "c14-database",
      check: async () => {
        const rows = await sql<{ readonly id: string }[]>`
          SELECT id FROM platform_schema_migrations WHERE id = '0014_render_stills' LIMIT 1
        `;
        if (rows.length !== 1) throw new Error("C14 database migration is not applied.");
      },
    });
  }
  readinessChecks.push({
    name: "c14-render-storage",
    check: () => storage.readiness(),
    required: false,
  });
  return { readinessChecks, repository, service, worker };
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
  throw new Error("The required C14 migration file could not be located.");
}

export async function applyC14Migration(sql: Sql, filePath?: string): Promise<void> {
  const resolvedPath =
    filePath ??
    (await firstExistingPath([
      path.resolve(process.cwd(), "services/platform-api/migrations/0014_render_stills.sql"),
      path.resolve(process.cwd(), "migrations/0014_render_stills.sql"),
    ]));
  await sql.begin(async (transaction) => transaction.file(resolvedPath));
}

async function runAdminCommand(command: string | undefined): Promise<void> {
  if (command !== "migrate") throw new Error("Expected: migrate.");
  const runtimeEnvironment = runtimeEnvironmentSchema.parse(process.env.NODE_ENV ?? "development");
  const sql = createC1Sql(databaseUrl(runtimeEnvironment, process.env, undefined));
  try {
    await applyC14Migration(sql);
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
        event: "c14_admin_failed",
        status: "error",
      })}\n`,
    );
    process.exitCode = 1;
  });
}
