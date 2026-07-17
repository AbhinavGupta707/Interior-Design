import {
  ConfigurationError,
  loadPlatformApiConfig,
  type PlatformApiConfig,
} from "@interior-design/config";
import type { FastifyInstance } from "fastify";
import { pathToFileURL } from "node:url";

import { createServer, type CreateServerOptions } from "./app.js";

export { createServer } from "./app.js";
export { applyC9Migration, registerC9Module } from "./c9.js";
export { ApiError, type ProblemDetails } from "./errors.js";
export type { ReadinessCheck, ReadinessResponse } from "./health.js";

export interface ListenAddress {
  readonly host: string;
  readonly port: number;
}

export type PlatformApiListener = (
  server: FastifyInstance,
  address: ListenAddress,
) => Promise<string>;

export interface StartPlatformApiOptions extends CreateServerOptions {
  /** A composition/testing override. The executable always uses validated config. */
  readonly listen?: ListenAddress;
  /** Allows a process host or test harness to own listener creation. */
  readonly listener?: PlatformApiListener;
}

export interface RunningPlatformApi {
  readonly address: string;
  readonly config: PlatformApiConfig;
  readonly server: FastifyInstance;
  stop(reason?: string): Promise<void>;
}

async function closeWithDeadline(server: FastifyInstance, timeoutMs: number): Promise<void> {
  const closePromise = server.close();
  let timeout: NodeJS.Timeout | undefined;
  const deadline = new Promise<"timeout">((resolve) => {
    timeout = setTimeout(() => {
      resolve("timeout");
    }, timeoutMs);
    timeout.unref();
  });
  const result = await Promise.race([
    closePromise.then(() => {
      return "closed" as const;
    }),
    deadline,
  ]);

  if (timeout !== undefined) {
    clearTimeout(timeout);
  }
  if (result === "timeout") {
    server.server.closeAllConnections();
    throw new Error(`Platform API shutdown exceeded ${String(timeoutMs)}ms`);
  }
}

export async function startPlatformApi(
  options: StartPlatformApiOptions = {},
): Promise<RunningPlatformApi> {
  const config = options.config ?? loadPlatformApiConfig(options.environment);
  const server = createServer({ ...options, config });
  const listen = options.listen ?? { host: config.host, port: config.port };
  const listener = options.listener ?? (async (instance, address) => instance.listen(address));
  let address: string;
  try {
    address = await listener(server, listen);
  } catch (error: unknown) {
    await server.close();
    throw error;
  }
  let stopPromise: Promise<void> | undefined;

  const stop = (reason = "requested"): Promise<void> => {
    stopPromise ??= (async () => {
      server.log.info({ reason }, "platform API stopping");
      await closeWithDeadline(server, config.shutdownTimeoutMs);
      server.log.info({ reason }, "platform API stopped");
    })();
    return stopPromise;
  };

  return { address, config, server, stop };
}

export function registerProcessShutdown(runtime: RunningPlatformApi): () => void {
  const signals = ["SIGINT", "SIGTERM"] as const;
  const handlers = new Map<NodeJS.Signals, () => void>();

  const removeHandlers = (): void => {
    for (const [signal, handler] of handlers) {
      process.off(signal, handler);
    }
    handlers.clear();
  };

  for (const signal of signals) {
    const handler = (): void => {
      removeHandlers();
      void runtime.stop(signal).catch((error: unknown) => {
        runtime.server.log.fatal({ err: error, signal }, "platform API shutdown failed");
        process.exitCode = 1;
      });
    };
    handlers.set(signal, handler);
    process.once(signal, handler);
  }

  return removeHandlers;
}

export async function runPlatformApi(): Promise<RunningPlatformApi> {
  const runtime = await startPlatformApi();
  registerProcessShutdown(runtime);
  return runtime;
}

function writeFatalStartupError(error: unknown): void {
  const details =
    error instanceof ConfigurationError
      ? { errorType: error.name, issues: error.issues }
      : { errorType: error instanceof Error ? error.name : "UnknownError" };
  process.stderr.write(
    `${JSON.stringify({ event: "startup_failed", level: "fatal", service: "platform-api", ...details })}\n`,
  );
  process.exitCode = 1;
}

const entrypoint = process.argv[1];

if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  void runPlatformApi().catch(writeFatalStartupError);
}
