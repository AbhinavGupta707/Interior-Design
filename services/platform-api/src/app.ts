import {
  loadPlatformApiConfig,
  type EnvironmentSource,
  type PlatformApiConfig,
} from "@interior-design/config";
import Fastify, { type FastifyInstance, type FastifyLoggerOptions } from "fastify";
import type { LoggerOptions as PinoLoggerOptions } from "pino";

import { registerC1Module, type C1ModuleOptions } from "./c1.js";
import { generateRequestId, registerRequestCorrelation } from "./correlation.js";
import { registerErrorHandling } from "./errors.js";
import { registerHealthRoutes, type ReadinessCheck } from "./health.js";

declare module "fastify" {
  interface FastifyInstance {
    readonly platformConfig: PlatformApiConfig;
  }
}

type LoggerSetting = boolean | (FastifyLoggerOptions & PinoLoggerOptions);

export interface CreateServerOptions {
  readonly c1?: C1ModuleOptions;
  readonly config?: PlatformApiConfig;
  readonly environment?: EnvironmentSource;
  readonly logger?: LoggerSetting;
  readonly readinessChecks?: readonly ReadinessCheck[];
}

function defaultLogger(config: PlatformApiConfig): LoggerSetting {
  if (config.logLevel === "silent") {
    return false;
  }

  return {
    base: {
      environment: config.runtimeEnvironment,
      service: "platform-api",
    },
    level: config.logLevel,
    redact: {
      censor: "[REDACTED]",
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers['x-api-key']",
        "request.headers.authorization",
        "request.headers.cookie",
        "request.headers['x-api-key']",
      ],
    },
  };
}

export function createServer(options: CreateServerOptions = {}): FastifyInstance {
  const config = options.config ?? loadPlatformApiConfig(options.environment);
  const server = Fastify({
    bodyLimit: 1_048_576,
    genReqId: generateRequestId,
    logger: options.logger ?? defaultLogger(config),
    requestIdHeader: false,
    trustProxy: false,
  });

  server.decorate("platformConfig", config);
  registerRequestCorrelation(server);
  registerErrorHandling(server);
  const c1 = registerC1Module(
    server,
    config.runtimeEnvironment,
    options.environment ?? process.env,
    options.c1,
  );
  registerHealthRoutes(
    server,
    options.readinessChecks ?? c1.readinessChecks,
    config.readinessTimeoutMs,
  );

  return server;
}
