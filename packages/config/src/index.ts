import { z } from "zod";

export const runtimeEnvironmentSchema = z.enum(["development", "test", "production"]);

export type RuntimeEnvironment = z.infer<typeof runtimeEnvironmentSchema>;

export const logLevelSchema = z.enum([
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
]);

const portSchema = z.coerce.number().int().min(1).max(65_535);
const timeoutSchema = z.coerce.number().int().positive();

export const platformApiConfigSchema = z
  .object({
    runtimeEnvironment: runtimeEnvironmentSchema.default("development"),
    host: z.string().trim().min(1).default("127.0.0.1"),
    port: portSchema.default(4_100),
    logLevel: logLevelSchema.default("info"),
    readinessTimeoutMs: timeoutSchema.max(30_000).default(1_000),
    shutdownTimeoutMs: timeoutSchema.max(60_000).default(10_000),
  })
  .strict();

type ParsedPlatformApiConfig = z.infer<typeof platformApiConfigSchema>;

export type PlatformApiConfig = Readonly<ParsedPlatformApiConfig>;

export type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export interface ConfigurationIssue {
  readonly variable: string;
  readonly message: string;
}

const CONFIG_KEYS = {
  host: "PLATFORM_API_HOST",
  logLevel: "PLATFORM_API_LOG_LEVEL",
  port: "PLATFORM_API_PORT",
  readinessTimeoutMs: "PLATFORM_API_READINESS_TIMEOUT_MS",
  runtimeEnvironment: "NODE_ENV",
  shutdownTimeoutMs: "PLATFORM_API_SHUTDOWN_TIMEOUT_MS",
} as const;

type ConfigKey = keyof typeof CONFIG_KEYS;

export class ConfigurationError extends Error {
  readonly issues: readonly ConfigurationIssue[];

  constructor(issues: readonly ConfigurationIssue[], options?: ErrorOptions) {
    const variables = issues.map((issue) => issue.variable).join(", ");
    super(`Invalid platform API configuration: ${variables}`, options);
    this.name = "ConfigurationError";
    this.issues = Object.freeze([...issues]);
  }
}

function toConfigurationIssues(error: z.ZodError): readonly ConfigurationIssue[] {
  return error.issues.map((issue) => {
    const key = issue.path[0];
    const variable =
      typeof key === "string" && key in CONFIG_KEYS
        ? CONFIG_KEYS[key as ConfigKey]
        : "PLATFORM_API_CONFIG";

    return Object.freeze({ message: issue.message, variable });
  });
}

/**
 * Loads only the public, non-secret process settings owned by the platform API.
 * Unrelated environment variables are deliberately ignored.
 */
export function loadPlatformApiConfig(
  environment: EnvironmentSource = process.env,
): PlatformApiConfig {
  const result = platformApiConfigSchema.safeParse({
    host: environment.PLATFORM_API_HOST,
    logLevel: environment.PLATFORM_API_LOG_LEVEL,
    port: environment.PLATFORM_API_PORT,
    readinessTimeoutMs: environment.PLATFORM_API_READINESS_TIMEOUT_MS,
    runtimeEnvironment: environment.NODE_ENV,
    shutdownTimeoutMs: environment.PLATFORM_API_SHUTDOWN_TIMEOUT_MS,
  });

  if (!result.success) {
    throw new ConfigurationError(toConfigurationIssues(result.error), { cause: result.error });
  }

  return Object.freeze(result.data);
}
