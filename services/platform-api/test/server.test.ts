import { loadPlatformApiConfig } from "@interior-design/config";
import { afterEach, describe, expect, it } from "vitest";

import {
  ApiError,
  createServer,
  startPlatformApi,
  type RunningPlatformApi,
} from "../src/server.js";

const servers: ReturnType<typeof createServer>[] = [];
const runtimes: RunningPlatformApi[] = [];

const testConfig = loadPlatformApiConfig({
  NODE_ENV: "test",
  PLATFORM_API_LOG_LEVEL: "silent",
  PLATFORM_API_READINESS_TIMEOUT_MS: "50",
  PLATFORM_API_SHUTDOWN_TIMEOUT_MS: "500",
});

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(async (runtime) => runtime.stop("test-cleanup")));
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
});

describe("platform API health contracts", () => {
  it("reports liveness independently and successful dependency readiness", async () => {
    const server = createServer({
      config: testConfig,
      logger: false,
      readinessChecks: [{ name: "database", check: () => undefined }],
    });
    servers.push(server);

    const [legacyLiveness, liveness, readiness] = await Promise.all([
      server.inject({ method: "GET", url: "/health" }),
      server.inject({ method: "GET", url: "/health/live" }),
      server.inject({ method: "GET", url: "/health/ready" }),
    ]);

    expect(legacyLiveness.statusCode).toBe(200);
    expect(legacyLiveness.json()).toEqual({ status: "ok" });
    expect(liveness.statusCode).toBe(200);
    expect(liveness.json()).toEqual({ status: "ok" });
    expect(readiness.statusCode).toBe(200);
    expect(readiness.json()).toEqual({
      checks: [{ name: "database", required: true, status: "available" }],
      status: "ready",
    });
  });

  it("returns 503 when a required dependency is unavailable without leaking its error", async () => {
    const server = createServer({
      config: testConfig,
      logger: false,
      readinessChecks: [
        {
          name: "database",
          check: () => {
            throw new Error("postgres://user:secret@host/database");
          },
        },
      ],
    });
    servers.push(server);

    const response = await server.inject({ method: "GET", url: "/health/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      checks: [{ name: "database", required: true, status: "unavailable" }],
      status: "not_ready",
    });
    expect(response.body).not.toContain("secret");
  });
});

describe("platform API correlation and errors", () => {
  it("continues a valid trace and correlates a redacted internal error", async () => {
    const logLines: string[] = [];
    const server = createServer({
      config: testConfig,
      logger: {
        level: "error",
        stream: {
          write(message) {
            logLines.push(message);
          },
        },
      },
    });
    servers.push(server);
    server.get("/test/failure", () => {
      throw new Error("sensitive-internal-message");
    });
    const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";

    const response = await server.inject({
      headers: {
        traceparent: `00-${traceId}-00f067aa0ba902b7-01`,
        "x-request-id": "request-123",
      },
      method: "GET",
      url: "/test/failure?ignored=true",
    });

    expect(response.statusCode).toBe(500);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.headers["x-request-id"]).toBe("request-123");
    expect(response.headers["x-trace-id"]).toBe(traceId);
    expect(response.headers.traceparent).toMatch(new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`));
    expect(response.json()).toEqual({
      code: "INTERNAL_ERROR",
      detail: "An unexpected error occurred.",
      instance: "/test/failure",
      requestId: "request-123",
      status: 500,
      title: "Internal Server Error",
      traceId,
      type: "urn:interior-design:error:internal-error",
    });
    expect(response.body).not.toContain("sensitive-internal-message");
    const logs = logLines.join("\n");
    expect(logs).toContain('"errorCode":"INTERNAL_ERROR"');
    expect(logs).toContain('"requestId":"request-123"');
    expect(logs).toContain(`"traceId":"${traceId}"`);
    expect(logs).toContain('"errorType":"Error"');
    expect(logs).not.toContain("sensitive-internal-message");
  });

  it("allows explicitly public API errors while retaining the envelope", async () => {
    const server = createServer({ config: testConfig, logger: false });
    servers.push(server);
    server.get("/test/conflict", () => {
      throw new ApiError({
        code: "REVISION_CONFLICT",
        detail: "The resource changed; reload it and retry.",
        statusCode: 409,
        title: "Revision Conflict",
      });
    });

    const response = await server.inject({ method: "GET", url: "/test/conflict" });
    const body = response.json<Record<string, unknown>>();

    expect(response.statusCode).toBe(409);
    expect(body).toMatchObject({
      code: "REVISION_CONFLICT",
      detail: "The resource changed; reload it and retry.",
      status: 409,
      title: "Revision Conflict",
      type: "urn:interior-design:error:revision-conflict",
    });
    expect(body.requestId).toBe(response.headers["x-request-id"]);
    expect(body.traceId).toBe(response.headers["x-trace-id"]);
  });
});

describe("platform API lifecycle", () => {
  it("starts on an explicit test listener and shuts down idempotently", async () => {
    const runtime = await startPlatformApi({
      config: testConfig,
      listener: async (server) => {
        await server.ready();
        return "in-process://platform-api";
      },
      logger: false,
    });
    runtimes.push(runtime);

    expect(runtime.address).toBe("in-process://platform-api");
    const response = await runtime.server.inject({ method: "GET", url: "/health/live" });
    expect(response.statusCode).toBe(200);

    await Promise.all([runtime.stop("test"), runtime.stop("duplicate")]);

    expect(runtime.server.server.listening).toBe(false);
  });
});
