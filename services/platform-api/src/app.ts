import {
  loadPlatformApiConfig,
  type EnvironmentSource,
  type PlatformApiConfig,
} from "@interior-design/config";
import Fastify, { type FastifyInstance, type FastifyLoggerOptions } from "fastify";
import type { LoggerOptions as PinoLoggerOptions } from "pino";

import { registerC1Module, type C1ModuleOptions } from "./c1.js";
import { registerC2Module, type C2ModuleOptions } from "./c2.js";
import { registerC3Module, type C3ModuleOptions } from "./c3.js";
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
  readonly c2?: C2ModuleOptions;
  readonly c3?: C3ModuleOptions;
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
        "providerUploadId",
        "provider_upload_id",
        "sourceObjectKey",
        "source_object_key",
        "objectKey",
        "object_key",
        "url",
        "signedUrl",
        "query",
        "address",
        "displayAddress",
        "body.query",
        "body.address",
        "body.displayAddress",
        "req.body.query",
        "req.body.address",
        "req.body.displayAddress",
        "request.body.query",
        "request.body.address",
        "request.body.displayAddress",
        "*.providerUploadId",
        "*.provider_upload_id",
        "*.sourceObjectKey",
        "*.source_object_key",
        "*.objectKey",
        "*.object_key",
        "*.url",
        "*.signedUrl",
        "*.query",
        "*.address",
        "*.displayAddress",
        "*.body.query",
        "*.body.address",
        "*.body.displayAddress",
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
  // Tests and composition harnesses with injected C1 boundaries opt in to C2 explicitly.
  // Executable development/production processes pass neither override and therefore always
  // compose C2 and validate storage configuration before listening.
  const c2 =
    options.c2 !== undefined || (options.c1 === undefined && config.runtimeEnvironment !== "test")
      ? registerC2Module(
          server,
          config.runtimeEnvironment,
          options.environment ?? process.env,
          options.c2,
        )
      : undefined;
  const c3 =
    options.c3 !== undefined || (options.c1 === undefined && config.runtimeEnvironment !== "test")
      ? registerC3Module(
          server,
          config.runtimeEnvironment,
          options.environment ?? process.env,
          options.c3,
        )
      : undefined;
  registerHealthRoutes(
    server,
    options.readinessChecks ?? [
      ...c1.readinessChecks,
      ...(c2?.readinessChecks ?? []),
      ...(c3?.readinessChecks ?? []),
    ],
    config.readinessTimeoutMs,
  );

  return server;
}
