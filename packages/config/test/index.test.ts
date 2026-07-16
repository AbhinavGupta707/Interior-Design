import { describe, expect, it } from "vitest";

import {
  ConfigurationError,
  loadPlatformApiConfig,
  runtimeEnvironmentSchema,
} from "../src/index.js";

describe("runtimeEnvironmentSchema", () => {
  it("rejects undeclared environments", () => {
    expect(runtimeEnvironmentSchema.safeParse("fixture-production").success).toBe(false);
  });
});

describe("loadPlatformApiConfig", () => {
  it("uses a local-only, no-secret default configuration", () => {
    const config = loadPlatformApiConfig({ DATABASE_URL: "postgres://not-part-of-config" });

    expect(config).toEqual({
      host: "127.0.0.1",
      logLevel: "info",
      port: 4_100,
      readinessTimeoutMs: 1_000,
      runtimeEnvironment: "development",
      shutdownTimeoutMs: 10_000,
    });
    expect(config).not.toHaveProperty("DATABASE_URL");
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("coerces declared numeric settings into a typed configuration", () => {
    const config = loadPlatformApiConfig({
      NODE_ENV: "test",
      PLATFORM_API_HOST: "localhost",
      PLATFORM_API_LOG_LEVEL: "silent",
      PLATFORM_API_PORT: "4201",
      PLATFORM_API_READINESS_TIMEOUT_MS: "250",
      PLATFORM_API_SHUTDOWN_TIMEOUT_MS: "500",
    });

    expect(config).toEqual({
      host: "localhost",
      logLevel: "silent",
      port: 4_201,
      readinessTimeoutMs: 250,
      runtimeEnvironment: "test",
      shutdownTimeoutMs: 500,
    });
  });

  it("reports invalid variable names without echoing their values", () => {
    const invalidPort = "definitely-not-a-port";

    expect(() =>
      loadPlatformApiConfig({
        NODE_ENV: "production-ish",
        PLATFORM_API_PORT: invalidPort,
      }),
    ).toThrow(ConfigurationError);

    try {
      loadPlatformApiConfig({ NODE_ENV: "production-ish", PLATFORM_API_PORT: invalidPort });
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ConfigurationError);
      if (!(error instanceof ConfigurationError)) {
        throw error;
      }
      expect(error.issues.map((issue) => issue.variable)).toEqual(
        expect.arrayContaining(["NODE_ENV", "PLATFORM_API_PORT"]),
      );
      expect(error.message).not.toContain(invalidPort);
    }
  });
});
