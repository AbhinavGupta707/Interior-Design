import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";

const localDatabaseUrl =
  "postgresql://localdev:local-development-only@127.0.0.1:54321/interior_design";
const localS3Endpoint = "http://127.0.0.1:8333";

const positiveInteger = (minimum: number, maximum: number) =>
  z.coerce.number().int().min(minimum).max(maximum);

const extractedEnvironmentSchema = z
  .object({
    C2_DATABASE_URL: z.string().trim().min(1).optional(),
    C2_DERIVED_BUCKET: z.literal("derived").default("derived"),
    C2_FFMPEG_PATH: z.string().trim().min(1).default("ffmpeg"),
    C2_FFPROBE_PATH: z.string().trim().min(1).default("ffprobe"),
    C2_FILE_PATH: z.string().trim().min(1).default("/usr/bin/file"),
    C2_HEARTBEAT_MS: positiveInteger(1_000, 120_000).default(15_000),
    C2_LEASE_MS: positiveInteger(10_000, 300_000).default(60_000),
    C2_PDFINFO_PATH: z.string().trim().min(1).default("pdfinfo"),
    C2_PDFTOPPM_PATH: z.string().trim().min(1).default("pdftoppm"),
    C2_POLL_MS: positiveInteger(100, 60_000).default(1_000),
    C2_QUARANTINE_BUCKET: z.literal("quarantine").default("quarantine"),
    C2_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    C2_S3_ENDPOINT: z.string().trim().min(1).optional(),
    C2_S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).optional(),
    C2_S3_REGION: z.string().trim().min(1).max(100).optional(),
    C2_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    C2_STORAGE_ACCESS_KEY_ID: z.string().min(1).optional(),
    C2_STORAGE_ENDPOINT: z.string().trim().min(1).optional(),
    C2_STORAGE_FORCE_PATH_STYLE: z.enum(["true", "false"]).optional(),
    C2_STORAGE_REGION: z.string().trim().min(1).max(100).optional(),
    C2_STORAGE_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    C2_SOURCE_BUCKET: z.literal("source").default("source"),
    C2_SUBPROCESS_MAX_OUTPUT_BYTES: positiveInteger(4_096, 4_194_304).default(1_048_576),
    C2_SUBPROCESS_TIMEOUT_MS: positiveInteger(1_000, 120_000).default(30_000),
    C2_TEMP_MAX_BYTES: positiveInteger(268_435_456, 3_221_225_472).default(2_684_354_560),
    C2_TEMP_ROOT: z.string().trim().min(1).optional(),
    C2_WORKER_ID: z
      .string()
      .trim()
      .min(3)
      .max(100)
      .regex(/^[A-Za-z0-9_.:-]+$/u)
      .default("spatial-worker-local"),
    C10_SCENE_WORKER_ENABLED: z.enum(["true", "false"]).default("false"),
    C10_DATABASE_URL: z.string().trim().min(1).optional(),
    C12_DESIGN_OPTION_WORKER_ENABLED: z.enum(["true", "false"]).default("false"),
    C12_DATABASE_URL: z.string().trim().min(1).optional(),
    C13_CATALOG_INGEST_ENABLED: z.enum(["true", "false"]).default("false"),
    C13_CATALOG_PROJECT_ID: z.uuid().optional(),
    C13_CATALOG_PUBLISHED_BY_USER_ID: z.uuid().optional(),
    C13_CATALOG_SOURCE_ROOT: z.string().trim().min(1).optional(),
    C13_CATALOG_TENANT_ID: z.uuid().optional(),
    C13_DATABASE_URL: z.string().trim().min(1).optional(),
    C14_BLENDER_BUILD_HASH: z.string().trim().min(1).max(120).optional(),
    C14_BLENDER_VERSION: z.string().trim().min(1).max(120).optional(),
    C14_EXR_INSPECTOR_SCRIPT_PATH: z.string().trim().min(1).optional(),
    C14_EXR_INSPECTOR_SCRIPT_SHA256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    C14_RENDER_EXECUTABLE_PATH: z.string().trim().min(1).optional(),
    C14_RENDER_EXECUTABLE_SHA256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    C14_RENDER_OCIO_PATH: z.string().trim().min(1).optional(),
    C14_RENDER_OCIO_SHA256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    C14_RENDER_HEIGHT_PX: positiveInteger(64, 4_096).optional(),
    C14_RENDER_HARDWARE_EVIDENCE: z.literal("verified-authorised-host").optional(),
    C14_RENDER_HOST_FINGERPRINT_SHA256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    C14_RENDER_HOST_ACCEPTANCE_SHA256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    C14_RENDER_MAX_OUTPUT_BYTES: positiveInteger(4_096, 1_048_576).optional(),
    C14_RENDER_PROFILE_ID: z
      .enum([
        "eevee-local-preview-v1",
        "cycles-cpu-geometry-safe-v1",
        "cycles-metal-geometry-safe-v1",
        "cycles-cuda-high-resolution-v1",
        "cycles-optix-high-resolution-v1",
      ])
      .optional(),
    C14_RENDER_SAMPLES: positiveInteger(1, 4_096).optional(),
    C14_RENDER_SEED: z.coerce.number().int().min(0).max(2_147_483_647).optional(),
    C14_RENDER_THREADS: positiveInteger(1, 256).optional(),
    C14_RENDER_TIMEOUT_MS: positiveInteger(100, 7_200_000).optional(),
    C14_RENDER_VOLUME_ID: z
      .string()
      .regex(/^[A-Za-z0-9_.:-]{3,120}$/u)
      .optional(),
    C14_RENDER_VOLUME_PATH: z.string().trim().min(1).optional(),
    C14_RENDER_WIDTH_PX: positiveInteger(64, 4_096).optional(),
    C14_RENDER_WORKER_ENABLED: z.enum(["true", "false"]).default("false"),
    C14_RENDER_WORKSPACE_ROOT: z.string().trim().min(1).optional(),
    C14_RENDERER_SCRIPT_PATH: z.string().trim().min(1).optional(),
    C14_RENDERER_SCRIPT_SHA256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  })
  .strict();

export interface WorkerConfig {
  readonly c10SceneWorkerEnabled: boolean;
  readonly c12DesignOptionWorkerEnabled: boolean;
  readonly c13CatalogIngestion?: {
    readonly projectId: string;
    readonly publishedByUserId: string;
    readonly sourceRoot: string;
    readonly tenantId: string;
  };
  readonly c14Render?: {
    readonly blenderBuildHash: string;
    readonly blenderVersion: string;
    readonly executable: { readonly path: string; readonly sha256: string };
    readonly exrInspectorScript: { readonly path: string; readonly sha256: string };
    readonly ocioConfig: { readonly path: string; readonly sha256: string };
    /** Matches the deployment-only API acceptance pin; never reaches a render manifest or log. */
    readonly hardwareEvidence: "verified-authorised-host";
    readonly hostAcceptanceSha256: string;
    readonly hostFingerprintSha256: string;
    readonly maximumOutputBytes: number;
    readonly profile: {
      readonly heightPx: number;
      readonly profileId:
        | "eevee-local-preview-v1"
        | "cycles-cpu-geometry-safe-v1"
        | "cycles-metal-geometry-safe-v1"
        | "cycles-cuda-high-resolution-v1"
        | "cycles-optix-high-resolution-v1";
      readonly samples: number;
      readonly seed: number;
      readonly threads: number;
      readonly widthPx: number;
    };
    readonly rendererScript: { readonly path: string; readonly sha256: string };
    readonly timeoutMilliseconds: number;
    readonly volumeId: string;
    readonly volumePath: string;
    readonly workspaceRoot: string;
  };
  readonly databaseUrl: string;
  readonly derivedBucket: "derived";
  readonly executables: {
    readonly ffmpeg: string;
    readonly ffprobe: string;
    readonly file: string;
    readonly pdfinfo: string;
    readonly pdftoppm: string;
  };
  readonly heartbeatMs: number;
  readonly leaseMs: number;
  readonly pollMs: number;
  readonly quarantineBucket: "quarantine";
  readonly runtimeEnvironment: "development" | "test" | "production";
  readonly s3: {
    readonly accessKeyId: string;
    readonly endpoint: string;
    readonly forcePathStyle: boolean;
    readonly region: string;
    readonly secretAccessKey: string;
  };
  readonly sourceBucket: "source";
  readonly subprocess: {
    readonly maximumOutputBytes: number;
    readonly timeoutMs: number;
  };
  readonly temporaryDirectory: {
    readonly maximumBytes: number;
    readonly root: string;
  };
  readonly workerId: string;
}

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

function validateDatabaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("C2_DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("C2_DATABASE_URL must use postgres or postgresql.");
  }
  if (parsed.username.length === 0 || parsed.hostname.length === 0 || parsed.pathname === "/") {
    throw new Error("C2_DATABASE_URL must include a user, host and database.");
  }
  return value;
}

function validateEndpoint(value: string, production: boolean): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("C2_S3_ENDPOINT must be a valid URL.");
  }
  if (parsed.username.length > 0 || parsed.password.length > 0 || parsed.search.length > 0) {
    throw new Error("C2_S3_ENDPOINT must not contain credentials or query parameters.");
  }
  const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback && !production)) {
    throw new Error("C2_S3_ENDPOINT must use HTTPS except for loopback development.");
  }
  return parsed.toString().replace(/\/$/u, "");
}

export function parseWorkerConfig(environment: EnvironmentSource): WorkerConfig {
  const extracted = extractedEnvironmentSchema.parse({
    C2_DATABASE_URL: environment.C2_DATABASE_URL,
    C2_DERIVED_BUCKET: environment.C2_DERIVED_BUCKET,
    C2_FFMPEG_PATH: environment.C2_FFMPEG_PATH,
    C2_FFPROBE_PATH: environment.C2_FFPROBE_PATH,
    C2_FILE_PATH: environment.C2_FILE_PATH,
    C2_HEARTBEAT_MS: environment.C2_HEARTBEAT_MS,
    C2_LEASE_MS: environment.C2_LEASE_MS,
    C2_PDFINFO_PATH: environment.C2_PDFINFO_PATH,
    C2_PDFTOPPM_PATH: environment.C2_PDFTOPPM_PATH,
    C2_POLL_MS: environment.C2_POLL_MS,
    C2_QUARANTINE_BUCKET: environment.C2_QUARANTINE_BUCKET,
    C2_S3_ACCESS_KEY_ID: environment.C2_S3_ACCESS_KEY_ID,
    C2_S3_ENDPOINT: environment.C2_S3_ENDPOINT,
    C2_S3_FORCE_PATH_STYLE: environment.C2_S3_FORCE_PATH_STYLE,
    C2_S3_REGION: environment.C2_S3_REGION,
    C2_S3_SECRET_ACCESS_KEY: environment.C2_S3_SECRET_ACCESS_KEY,
    C2_STORAGE_ACCESS_KEY_ID: environment.C2_STORAGE_ACCESS_KEY_ID,
    C2_STORAGE_ENDPOINT: environment.C2_STORAGE_ENDPOINT,
    C2_STORAGE_FORCE_PATH_STYLE: environment.C2_STORAGE_FORCE_PATH_STYLE,
    C2_STORAGE_REGION: environment.C2_STORAGE_REGION,
    C2_STORAGE_SECRET_ACCESS_KEY: environment.C2_STORAGE_SECRET_ACCESS_KEY,
    C2_SOURCE_BUCKET: environment.C2_SOURCE_BUCKET,
    C2_SUBPROCESS_MAX_OUTPUT_BYTES: environment.C2_SUBPROCESS_MAX_OUTPUT_BYTES,
    C2_SUBPROCESS_TIMEOUT_MS: environment.C2_SUBPROCESS_TIMEOUT_MS,
    C2_TEMP_MAX_BYTES: environment.C2_TEMP_MAX_BYTES,
    C2_TEMP_ROOT: environment.C2_TEMP_ROOT,
    C2_WORKER_ID: environment.C2_WORKER_ID,
    C10_SCENE_WORKER_ENABLED: environment.C10_SCENE_WORKER_ENABLED,
    C10_DATABASE_URL: environment.C10_DATABASE_URL,
    C12_DESIGN_OPTION_WORKER_ENABLED: environment.C12_DESIGN_OPTION_WORKER_ENABLED,
    C12_DATABASE_URL: environment.C12_DATABASE_URL,
    C13_CATALOG_INGEST_ENABLED: environment.C13_CATALOG_INGEST_ENABLED,
    C13_CATALOG_PROJECT_ID: environment.C13_CATALOG_PROJECT_ID,
    C13_CATALOG_PUBLISHED_BY_USER_ID: environment.C13_CATALOG_PUBLISHED_BY_USER_ID,
    C13_CATALOG_SOURCE_ROOT: environment.C13_CATALOG_SOURCE_ROOT,
    C13_CATALOG_TENANT_ID: environment.C13_CATALOG_TENANT_ID,
    C13_DATABASE_URL: environment.C13_DATABASE_URL,
    C14_BLENDER_BUILD_HASH: environment.C14_BLENDER_BUILD_HASH,
    C14_BLENDER_VERSION: environment.C14_BLENDER_VERSION,
    C14_EXR_INSPECTOR_SCRIPT_PATH: environment.C14_EXR_INSPECTOR_SCRIPT_PATH,
    C14_EXR_INSPECTOR_SCRIPT_SHA256: environment.C14_EXR_INSPECTOR_SCRIPT_SHA256,
    C14_RENDER_EXECUTABLE_PATH: environment.C14_RENDER_EXECUTABLE_PATH,
    C14_RENDER_EXECUTABLE_SHA256: environment.C14_RENDER_EXECUTABLE_SHA256,
    C14_RENDER_OCIO_PATH: environment.C14_RENDER_OCIO_PATH,
    C14_RENDER_OCIO_SHA256: environment.C14_RENDER_OCIO_SHA256,
    C14_RENDER_HEIGHT_PX: environment.C14_RENDER_HEIGHT_PX,
    C14_RENDER_HARDWARE_EVIDENCE: environment.C14_RENDER_HARDWARE_EVIDENCE,
    C14_RENDER_HOST_ACCEPTANCE_SHA256: environment.C14_RENDER_HOST_ACCEPTANCE_SHA256,
    C14_RENDER_HOST_FINGERPRINT_SHA256: environment.C14_RENDER_HOST_FINGERPRINT_SHA256,
    C14_RENDER_MAX_OUTPUT_BYTES: environment.C14_RENDER_MAX_OUTPUT_BYTES,
    C14_RENDER_PROFILE_ID: environment.C14_RENDER_PROFILE_ID,
    C14_RENDER_SAMPLES: environment.C14_RENDER_SAMPLES,
    C14_RENDER_SEED: environment.C14_RENDER_SEED,
    C14_RENDER_THREADS: environment.C14_RENDER_THREADS,
    C14_RENDER_TIMEOUT_MS: environment.C14_RENDER_TIMEOUT_MS,
    C14_RENDER_VOLUME_ID: environment.C14_RENDER_VOLUME_ID,
    C14_RENDER_VOLUME_PATH: environment.C14_RENDER_VOLUME_PATH,
    C14_RENDER_WIDTH_PX: environment.C14_RENDER_WIDTH_PX,
    C14_RENDER_WORKER_ENABLED: environment.C14_RENDER_WORKER_ENABLED,
    C14_RENDER_WORKSPACE_ROOT: environment.C14_RENDER_WORKSPACE_ROOT,
    C14_RENDERER_SCRIPT_PATH: environment.C14_RENDERER_SCRIPT_PATH,
    C14_RENDERER_SCRIPT_SHA256: environment.C14_RENDERER_SCRIPT_SHA256,
    NODE_ENV: environment.NODE_ENV,
  });
  const production = extracted.NODE_ENV === "production";
  const c10Enabled = extracted.C10_SCENE_WORKER_ENABLED === "true";
  const c12Enabled = extracted.C12_DESIGN_OPTION_WORKER_ENABLED === "true";
  const c13CatalogEnabled = extracted.C13_CATALOG_INGEST_ENABLED === "true";
  const c14RenderEnabled = extracted.C14_RENDER_WORKER_ENABLED === "true";
  const activeDatabaseUrls = [
    extracted.C2_DATABASE_URL,
    extracted.C10_DATABASE_URL,
    extracted.C12_DATABASE_URL,
    extracted.C13_DATABASE_URL,
  ].filter((value): value is string => value !== undefined);
  if (new Set(activeDatabaseUrls).size > 1) {
    throw new Error("Spatial-worker database variables must identify one shared database URL.");
  }
  const databaseUrl =
    extracted.C13_DATABASE_URL ??
    extracted.C12_DATABASE_URL ??
    extracted.C10_DATABASE_URL ??
    extracted.C2_DATABASE_URL ??
    (production ? undefined : localDatabaseUrl);
  const endpoint =
    extracted.C2_S3_ENDPOINT ??
    extracted.C2_STORAGE_ENDPOINT ??
    (production ? undefined : localS3Endpoint);
  const accessKeyId =
    extracted.C2_S3_ACCESS_KEY_ID ??
    extracted.C2_STORAGE_ACCESS_KEY_ID ??
    (production ? undefined : "localdev");
  const secretAccessKey =
    extracted.C2_S3_SECRET_ACCESS_KEY ??
    extracted.C2_STORAGE_SECRET_ACCESS_KEY ??
    (production ? undefined : "local-development-only");
  if (
    databaseUrl === undefined ||
    endpoint === undefined ||
    accessKeyId === undefined ||
    secretAccessKey === undefined
  ) {
    throw new Error("Production requires the C2 database, S3 endpoint and S3 credentials.");
  }
  const c14Required = c14RenderEnabled
    ? [
        extracted.C14_BLENDER_BUILD_HASH,
        extracted.C14_BLENDER_VERSION,
        extracted.C14_EXR_INSPECTOR_SCRIPT_PATH,
        extracted.C14_EXR_INSPECTOR_SCRIPT_SHA256,
        extracted.C14_RENDER_EXECUTABLE_PATH,
        extracted.C14_RENDER_EXECUTABLE_SHA256,
        extracted.C14_RENDER_HEIGHT_PX,
        extracted.C14_RENDER_OCIO_PATH,
        extracted.C14_RENDER_OCIO_SHA256,
        extracted.C14_RENDER_HARDWARE_EVIDENCE,
        extracted.C14_RENDER_HOST_ACCEPTANCE_SHA256,
        extracted.C14_RENDER_HOST_FINGERPRINT_SHA256,
        extracted.C14_RENDER_MAX_OUTPUT_BYTES,
        extracted.C14_RENDER_PROFILE_ID,
        extracted.C14_RENDER_SAMPLES,
        extracted.C14_RENDER_SEED,
        extracted.C14_RENDER_THREADS,
        extracted.C14_RENDER_TIMEOUT_MS,
        extracted.C14_RENDER_VOLUME_ID,
        extracted.C14_RENDER_VOLUME_PATH,
        extracted.C14_RENDER_WIDTH_PX,
        extracted.C14_RENDER_WORKSPACE_ROOT,
        extracted.C14_RENDERER_SCRIPT_PATH,
        extracted.C14_RENDERER_SCRIPT_SHA256,
      ]
    : [];
  if (c14Required.some((value) => value === undefined)) {
    throw new Error("C14 render worker requires a complete pinned local renderer profile.");
  }
  const absoluteC14Path = (value: string, variable: string): string => {
    const resolved = path.resolve(value);
    if (!path.isAbsolute(resolved))
      throw new Error(`${variable} must resolve to an absolute path.`);
    return resolved;
  };
  const c14Render = c14RenderEnabled
    ? {
        blenderBuildHash: extracted.C14_BLENDER_BUILD_HASH as string,
        blenderVersion: extracted.C14_BLENDER_VERSION as string,
        executable: {
          path: absoluteC14Path(
            extracted.C14_RENDER_EXECUTABLE_PATH as string,
            "C14_RENDER_EXECUTABLE_PATH",
          ),
          sha256: extracted.C14_RENDER_EXECUTABLE_SHA256 as string,
        },
        exrInspectorScript: {
          path: absoluteC14Path(
            extracted.C14_EXR_INSPECTOR_SCRIPT_PATH as string,
            "C14_EXR_INSPECTOR_SCRIPT_PATH",
          ),
          sha256: extracted.C14_EXR_INSPECTOR_SCRIPT_SHA256 as string,
        },
        hardwareEvidence: extracted.C14_RENDER_HARDWARE_EVIDENCE as "verified-authorised-host",
        hostAcceptanceSha256: extracted.C14_RENDER_HOST_ACCEPTANCE_SHA256 as string,
        hostFingerprintSha256: extracted.C14_RENDER_HOST_FINGERPRINT_SHA256 as string,
        maximumOutputBytes: extracted.C14_RENDER_MAX_OUTPUT_BYTES as number,
        ocioConfig: {
          path: absoluteC14Path(extracted.C14_RENDER_OCIO_PATH as string, "C14_RENDER_OCIO_PATH"),
          sha256: extracted.C14_RENDER_OCIO_SHA256 as string,
        },
        profile: {
          heightPx: extracted.C14_RENDER_HEIGHT_PX as number,
          profileId: extracted.C14_RENDER_PROFILE_ID as NonNullable<
            typeof extracted.C14_RENDER_PROFILE_ID
          >,
          samples: extracted.C14_RENDER_SAMPLES as number,
          seed: extracted.C14_RENDER_SEED as number,
          threads: extracted.C14_RENDER_THREADS as number,
          widthPx: extracted.C14_RENDER_WIDTH_PX as number,
        },
        rendererScript: {
          path: absoluteC14Path(
            extracted.C14_RENDERER_SCRIPT_PATH as string,
            "C14_RENDERER_SCRIPT_PATH",
          ),
          sha256: extracted.C14_RENDERER_SCRIPT_SHA256 as string,
        },
        timeoutMilliseconds: extracted.C14_RENDER_TIMEOUT_MS as number,
        volumeId: extracted.C14_RENDER_VOLUME_ID as string,
        volumePath: absoluteC14Path(
          extracted.C14_RENDER_VOLUME_PATH as string,
          "C14_RENDER_VOLUME_PATH",
        ),
        workspaceRoot: absoluteC14Path(
          extracted.C14_RENDER_WORKSPACE_ROOT as string,
          "C14_RENDER_WORKSPACE_ROOT",
        ),
      }
    : undefined;
  if (extracted.C2_HEARTBEAT_MS * 2 >= extracted.C2_LEASE_MS) {
    throw new Error("C2_HEARTBEAT_MS must be less than half C2_LEASE_MS.");
  }
  const temporaryRoot = path.resolve(extracted.C2_TEMP_ROOT ?? tmpdir());
  if (!path.isAbsolute(temporaryRoot)) {
    throw new Error("C2_TEMP_ROOT must resolve to an absolute path.");
  }
  const catalogSourceRoot =
    extracted.C13_CATALOG_SOURCE_ROOT === undefined
      ? undefined
      : path.resolve(extracted.C13_CATALOG_SOURCE_ROOT);
  if (
    c13CatalogEnabled &&
    (catalogSourceRoot === undefined ||
      extracted.C13_CATALOG_TENANT_ID === undefined ||
      extracted.C13_CATALOG_PROJECT_ID === undefined ||
      extracted.C13_CATALOG_PUBLISHED_BY_USER_ID === undefined)
  ) {
    throw new Error(
      "C13 catalog ingestion requires source root, tenant, project and publisher identifiers.",
    );
  }
  return {
    c10SceneWorkerEnabled: c10Enabled,
    c12DesignOptionWorkerEnabled: c12Enabled,
    ...(c14Render === undefined ? {} : { c14Render }),
    ...(c13CatalogEnabled
      ? {
          c13CatalogIngestion: {
            projectId: extracted.C13_CATALOG_PROJECT_ID as string,
            publishedByUserId: extracted.C13_CATALOG_PUBLISHED_BY_USER_ID as string,
            sourceRoot: catalogSourceRoot as string,
            tenantId: extracted.C13_CATALOG_TENANT_ID as string,
          },
        }
      : {}),
    databaseUrl: validateDatabaseUrl(databaseUrl),
    derivedBucket: extracted.C2_DERIVED_BUCKET,
    executables: {
      ffmpeg: extracted.C2_FFMPEG_PATH,
      ffprobe: extracted.C2_FFPROBE_PATH,
      file: extracted.C2_FILE_PATH,
      pdfinfo: extracted.C2_PDFINFO_PATH,
      pdftoppm: extracted.C2_PDFTOPPM_PATH,
    },
    heartbeatMs: extracted.C2_HEARTBEAT_MS,
    leaseMs: extracted.C2_LEASE_MS,
    pollMs: extracted.C2_POLL_MS,
    quarantineBucket: extracted.C2_QUARANTINE_BUCKET,
    runtimeEnvironment: extracted.NODE_ENV,
    s3: {
      accessKeyId,
      endpoint: validateEndpoint(endpoint, production),
      forcePathStyle:
        (extracted.C2_S3_FORCE_PATH_STYLE ?? extracted.C2_STORAGE_FORCE_PATH_STYLE ?? "true") ===
        "true",
      region: extracted.C2_S3_REGION ?? extracted.C2_STORAGE_REGION ?? "local",
      secretAccessKey,
    },
    sourceBucket: extracted.C2_SOURCE_BUCKET,
    subprocess: {
      maximumOutputBytes: extracted.C2_SUBPROCESS_MAX_OUTPUT_BYTES,
      timeoutMs: extracted.C2_SUBPROCESS_TIMEOUT_MS,
    },
    temporaryDirectory: {
      maximumBytes: extracted.C2_TEMP_MAX_BYTES,
      root: temporaryRoot,
    },
    workerId: extracted.C2_WORKER_ID,
  };
}
