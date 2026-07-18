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
import { registerC4Module, type C4ModuleOptions } from "./c4.js";
import { registerC5Module, type C5ModuleOptions } from "./c5.js";
import { registerC6Module, type C6ModuleOptions } from "./c6.js";
import { registerC7Module, type C7ModuleOptions } from "./c7.js";
import { registerC8Module, type C8ModuleOptions } from "./c8.js";
import { registerC9Module, type C9ModuleOptions } from "./c9.js";
import { registerC10Module, type C10ModuleOptions } from "./c10.js";
import { registerC11Module, type C11ModuleOptions } from "./c11.js";
import { registerC12Module, type C12ModuleOptions } from "./c12.js";
import { registerC13Module, type C13ModuleOptions } from "./c13.js";
import { generateRequestId, registerRequestCorrelation } from "./correlation.js";
import { registerErrorHandling } from "./errors.js";
import { registerHealthRoutes, type ReadinessCheck } from "./health.js";
import { disableRawCanonicalSnapshotMutationRoute } from "./modules/models/core/routes.js";

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
  readonly c4?: C4ModuleOptions;
  readonly c5?: C5ModuleOptions;
  readonly c6?: C6ModuleOptions;
  readonly c7?: C7ModuleOptions;
  readonly c8?: C8ModuleOptions;
  readonly c9?: C9ModuleOptions;
  readonly c10?: C10ModuleOptions;
  readonly c11?: C11ModuleOptions;
  readonly c12?: C12ModuleOptions;
  readonly c13?: C13ModuleOptions;
  readonly config?: PlatformApiConfig;
  readonly environment?: EnvironmentSource;
  readonly logger?: LoggerSetting;
  readonly readinessChecks?: readonly ReadinessCheck[];
}

export function defaultLogger(config: PlatformApiConfig): LoggerSetting {
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
        "req.headers['idempotency-key']",
        "req.url",
        "request.headers.authorization",
        "request.headers.cookie",
        "request.headers['x-api-key']",
        "request.headers['idempotency-key']",
        "request.url",
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
        "body.snapshot",
        "body.operations",
        "body.previewId",
        "body.message",
        "body.prompt",
        "body.accessibilityNeeds",
        "body.healthDetails",
        "body.notes",
        "body.lines",
        "body.schedule",
        "body.artifacts",
        "body.manifest",
        "body.licenceText",
        "body.sourceReceipt",
        "req.body.query",
        "req.body.address",
        "req.body.displayAddress",
        "req.body.snapshot",
        "req.body.operations",
        "req.body.previewId",
        "req.body.message",
        "req.body.prompt",
        "req.body.accessibilityNeeds",
        "req.body.healthDetails",
        "req.body.glb",
        "req.body.manifest",
        "req.body.leaseToken",
        "req.body.notes",
        "req.body.lines",
        "req.body.schedule",
        "req.body.artifacts",
        "req.body.licenceText",
        "req.body.sourceReceipt",
        "request.body.query",
        "request.body.address",
        "request.body.displayAddress",
        "request.body.snapshot",
        "request.body.operations",
        "request.body.previewId",
        "request.body.message",
        "request.body.prompt",
        "request.body.accessibilityNeeds",
        "request.body.healthDetails",
        "request.body.glb",
        "request.body.manifest",
        "request.body.leaseToken",
        "request.body.acceptedBrief",
        "request.body.constraints",
        "request.body.optionSet",
        "request.body.options",
        "request.body.assetPlacements",
        "request.body.workingSnapshot",
        "request.body.notes",
        "request.body.lines",
        "request.body.schedule",
        "request.body.artifacts",
        "request.body.licenceText",
        "request.body.sourceReceipt",
        "*.providerUploadId",
        "*.provider_upload_id",
        "*.sourceObjectKey",
        "*.source_object_key",
        "*.objectKey",
        "*.object_key",
        "*.url",
        "*.signedUrl",
        "*.leaseToken",
        "*.lease_token",
        "*.acceptedBrief",
        "*.constraints",
        "*.constraintResults",
        "*.optionSet",
        "*.options",
        "*.operations",
        "*.assetPlacements",
        "*.workingSnapshot",
        "*.notes",
        "*.lines",
        "*.schedule",
        "*.licenceText",
        "*.sourceReceipt",
        "*.attributionContact",
        "*.manifest",
        "*.glb",
        "*.query",
        "*.address",
        "*.displayAddress",
        "*.message",
        "*.prompt",
        "*.accessibilityNeeds",
        "*.healthDetails",
        "*.canonical_snapshot",
        "*.body.query",
        "*.body.address",
        "*.body.displayAddress",
        "*.body.snapshot",
        "*.body.operations",
        "*.body.previewId",
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
  const composeC5 =
    options.c5 !== undefined || (options.c1 === undefined && config.runtimeEnvironment !== "test");
  if (composeC5) disableRawCanonicalSnapshotMutationRoute(server);
  const c4 =
    options.c4 !== undefined ||
    composeC5 ||
    (options.c1 === undefined && config.runtimeEnvironment !== "test")
      ? registerC4Module(
          server,
          config.runtimeEnvironment,
          options.environment ?? process.env,
          options.c4,
        )
      : undefined;
  const c5 = composeC5
    ? registerC5Module(
        server,
        config.runtimeEnvironment,
        options.environment ?? process.env,
        options.c5,
      )
    : undefined;
  const c6 =
    options.c6 !== undefined || (options.c1 === undefined && config.runtimeEnvironment !== "test")
      ? registerC6Module(
          server,
          config.runtimeEnvironment,
          options.environment ?? process.env,
          options.c6,
        )
      : undefined;
  const c7 =
    options.c7 !== undefined || (options.c1 === undefined && config.runtimeEnvironment !== "test")
      ? registerC7Module(
          server,
          config.runtimeEnvironment,
          options.environment ?? process.env,
          options.c7,
        )
      : undefined;
  const c8 =
    options.c8 !== undefined || (options.c1 === undefined && config.runtimeEnvironment !== "test")
      ? registerC8Module(
          server,
          config.runtimeEnvironment,
          options.environment ?? process.env,
          options.c8,
        )
      : undefined;
  const c9 =
    options.c9 !== undefined || (options.c1 === undefined && config.runtimeEnvironment !== "test")
      ? registerC9Module(
          server,
          config.runtimeEnvironment,
          options.environment ?? process.env,
          options.c9,
        )
      : undefined;
  const c10 =
    options.c10 !== undefined || (options.c1 === undefined && config.runtimeEnvironment !== "test")
      ? registerC10Module(
          server,
          config.runtimeEnvironment,
          options.environment ?? process.env,
          options.c10,
        )
      : undefined;
  const c11 =
    options.c11 !== undefined || (options.c1 === undefined && config.runtimeEnvironment !== "test")
      ? registerC11Module(
          server,
          config.runtimeEnvironment,
          options.environment ?? process.env,
          options.c11,
        )
      : undefined;
  const c12 =
    options.c12 !== undefined || (options.c1 === undefined && config.runtimeEnvironment !== "test")
      ? registerC12Module(
          server,
          config.runtimeEnvironment,
          options.environment ?? process.env,
          options.c12,
        )
      : undefined;
  const c13 =
    options.c13 !== undefined || (options.c1 === undefined && config.runtimeEnvironment !== "test")
      ? registerC13Module(server, config.runtimeEnvironment, options.environment ?? process.env, {
          ...(c10 === undefined ? {} : { sceneService: c10.service }),
          ...(options.c13 ?? {}),
        })
      : undefined;
  registerHealthRoutes(
    server,
    options.readinessChecks ?? [
      ...c1.readinessChecks,
      ...(c2?.readinessChecks ?? []),
      ...(c3?.readinessChecks ?? []),
      ...(c4?.readinessChecks ?? []),
      ...(c5?.readinessChecks ?? []),
      ...(c6?.readinessChecks ?? []),
      ...(c7?.readinessChecks ?? []),
      ...(c8?.readinessChecks ?? []),
      ...(c9?.readinessChecks ?? []),
      ...(c10?.readinessChecks ?? []),
      ...(c11?.readinessChecks ?? []),
      ...(c12?.readinessChecks ?? []),
      ...(c13?.readinessChecks ?? []),
    ],
    config.readinessTimeoutMs,
  );

  return server;
}
