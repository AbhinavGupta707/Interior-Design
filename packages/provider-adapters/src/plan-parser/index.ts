/// <reference types="node" />

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

import {
  c6PlanPolicy,
  planParserRequestSchema,
  planParserResultSchema,
  type PlanParserRequest,
  type PlanParserResult,
} from "@interior-design/contracts";

const maximumDefaultInputBytes = 32 * 1_024 * 1_024;
const maximumStderrBytes = 16 * 1_024;
const maximumJsonNodes = 200_000;
const maximumJsonDepth = 32;
const safeJsonKey = /^[A-Za-z][A-Za-z0-9]*$/u;

type JsonScalar = string | number | boolean | null;
type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue };

export type PlanParserAdapterErrorCode =
  | "INVALID_NORMALIZED_INPUT"
  | "INVALID_REQUEST"
  | "NORMALIZED_INPUT_HASH_MISMATCH"
  | "PARSER_ABORTED"
  | "PARSER_EXITED"
  | "PARSER_OUTPUT_INVALID"
  | "PARSER_OUTPUT_MALFORMED"
  | "PARSER_OUTPUT_TOO_LARGE"
  | "PARSER_SOURCE_MISMATCH"
  | "PARSER_STDERR_TOO_LARGE"
  | "PARSER_TIMEOUT"
  | "PARSER_UNAVAILABLE";

export class PlanParserAdapterError extends Error {
  readonly code: PlanParserAdapterErrorCode;
  readonly retryable: boolean;

  constructor(code: PlanParserAdapterErrorCode, retryable: boolean) {
    super(code);
    this.name = "PlanParserAdapterError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface PlanParserProcessConfiguration {
  /** Executable name or absolute path. It is always invoked directly, never through a shell. */
  readonly command: string;
  /** Exact arguments, for example ["-m", "inference_worker.plan_parser"]. */
  readonly arguments: readonly string[];
  readonly cwd?: string;
  /** Explicit service source root supplied as the only PYTHONPATH value. */
  readonly pythonPath?: string;
  readonly maximumInputBytes?: number;
  readonly maximumOutputBytes?: number;
  readonly timeoutMilliseconds?: number;
  readonly terminationGraceMilliseconds?: number;
}

export interface PlanParserInvocationOptions {
  readonly signal?: AbortSignal;
}

interface JsonValidationState {
  readonly ancestors: WeakSet<object>;
  bytes: number;
  nodes: number;
}

function invalidNormalizedInput(): PlanParserAdapterError {
  return new PlanParserAdapterError("INVALID_NORMALIZED_INPUT", false);
}

function toJsonValue(value: unknown, state: JsonValidationState, depth = 0): JsonValue {
  state.nodes += 1;
  if (state.nodes > maximumJsonNodes || depth > maximumJsonDepth) {
    throw invalidNormalizedInput();
  }
  if (typeof value === "string") {
    state.bytes += Buffer.byteLength(value, "utf8");
    if (state.bytes > maximumDefaultInputBytes) {
      throw invalidNormalizedInput();
    }
    return value;
  }
  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw invalidNormalizedInput();
    }
    return value;
  }
  if (typeof value !== "object") {
    throw invalidNormalizedInput();
  }
  if (state.ancestors.has(value)) {
    throw invalidNormalizedInput();
  }
  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > 100_000) {
        throw invalidNormalizedInput();
      }
      return value.map((item) => toJsonValue(item, state, depth + 1));
    }
    const prototype: object | null = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw invalidNormalizedInput();
    }
    const entries = Object.entries(value);
    if (entries.length > 100_000) {
      throw invalidNormalizedInput();
    }
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of entries) {
      if (!safeJsonKey.test(key)) {
        throw invalidNormalizedInput();
      }
      state.bytes += Buffer.byteLength(key, "utf8");
      if (state.bytes > maximumDefaultInputBytes) {
        throw invalidNormalizedInput();
      }
      result[key] = toJsonValue(item, state, depth + 1);
    }
    return result;
  } finally {
    state.ancestors.delete(value);
  }
}

function validatedJsonValue(value: unknown): JsonValue {
  return toJsonValue(value, { ancestors: new WeakSet<object>(), bytes: 0, nodes: 0 });
}

function encodedString(value: string): string {
  return JSON.stringify(value);
}

function canonicalJsonValue(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return encodedString(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJsonValue(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${encodedString(key)}:${canonicalJsonValue(value[key] as JsonValue)}`)
    .join(",")}}`;
}

export function canonicalPlanParserJson(value: unknown): string {
  return canonicalJsonValue(validatedJsonValue(value));
}

export function hashNormalizedPlanInput(value: unknown): string {
  return createHash("sha256").update(canonicalPlanParserJson(value), "utf8").digest("hex");
}

function boundedInteger(
  value: number | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const selected = value ?? defaultValue;
  if (!Number.isSafeInteger(selected) || selected < minimum || selected > maximum) {
    throw new PlanParserAdapterError("INVALID_REQUEST", false);
  }
  return selected;
}

function safeEnvironment(pythonPath: string | undefined): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONHASHSEED: "0",
    PYTHONNOUSERSITE: "1",
  };
  for (const name of ["PATH", "SYSTEMROOT", "WINDIR", "COMSPEC"] as const) {
    const value = process.env[name];
    if (value !== undefined) {
      environment[name] = value;
    }
  }
  if (pythonPath !== undefined) {
    environment.PYTHONPATH = pythonPath;
  }
  return environment;
}

function verifyScope(result: PlanParserResult, request: PlanParserRequest): void {
  if (
    result.jobId !== request.jobId ||
    result.projectId !== request.source.projectId ||
    result.parser.mode !== request.parserMode ||
    canonicalPlanParserJson(result.source) !== canonicalPlanParserJson(request.source) ||
    (result.normalizedInputSha256 !== undefined &&
      result.normalizedInputSha256 !== request.normalizedInputSha256)
  ) {
    throw new PlanParserAdapterError("PARSER_SOURCE_MISMATCH", false);
  }
}

function decodeResult(output: Buffer, request: PlanParserRequest): PlanParserResult {
  let decoded: unknown;
  try {
    decoded = JSON.parse(output.toString("utf8")) as unknown;
  } catch {
    throw new PlanParserAdapterError("PARSER_OUTPUT_MALFORMED", false);
  }
  const parsed = planParserResultSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new PlanParserAdapterError("PARSER_OUTPUT_INVALID", false);
  }
  verifyScope(parsed.data, request);
  return parsed.data;
}

function normalizedSourceSha256(normalizedInput: JsonValue): string | undefined {
  if (
    Array.isArray(normalizedInput) ||
    normalizedInput === null ||
    typeof normalizedInput !== "object"
  ) {
    return undefined;
  }
  const value = normalizedInput["sourceSha256"];
  return typeof value === "string" ? value : undefined;
}

export class IsolatedPlanParserAdapter {
  readonly #configuration: PlanParserProcessConfiguration;

  constructor(configuration: PlanParserProcessConfiguration) {
    if (
      configuration.command.trim().length === 0 ||
      configuration.command.length > 4_096 ||
      configuration.command.includes("\0") ||
      configuration.arguments.length > 64 ||
      configuration.arguments.some(
        (argument) => argument.length > 16_384 || argument.includes("\0"),
      ) ||
      (configuration.cwd !== undefined &&
        (configuration.cwd.length > 4_096 || configuration.cwd.includes("\0"))) ||
      (configuration.pythonPath !== undefined &&
        (configuration.pythonPath.length > 4_096 || configuration.pythonPath.includes("\0")))
    ) {
      throw new PlanParserAdapterError("INVALID_REQUEST", false);
    }
    this.#configuration = configuration;
  }

  async parse(
    untrustedRequest: unknown,
    untrustedNormalizedInput: unknown,
    options: PlanParserInvocationOptions = {},
  ): Promise<PlanParserResult> {
    const parsedRequest = planParserRequestSchema.safeParse(untrustedRequest);
    if (!parsedRequest.success) {
      throw new PlanParserAdapterError("INVALID_REQUEST", false);
    }
    if (options.signal?.aborted === true) {
      throw new PlanParserAdapterError("PARSER_ABORTED", false);
    }
    const normalizedInput = validatedJsonValue(untrustedNormalizedInput);
    const normalizedHash = createHash("sha256")
      .update(canonicalJsonValue(normalizedInput), "utf8")
      .digest("hex");
    if (normalizedHash !== parsedRequest.data.normalizedInputSha256) {
      throw new PlanParserAdapterError("NORMALIZED_INPUT_HASH_MISMATCH", false);
    }
    if (normalizedSourceSha256(normalizedInput) !== parsedRequest.data.source.sha256) {
      throw new PlanParserAdapterError("PARSER_SOURCE_MISMATCH", false);
    }

    const requestJson = validatedJsonValue(parsedRequest.data);
    const input = Buffer.from(
      canonicalJsonValue({ normalizedInput, request: requestJson }),
      "utf8",
    );
    const maximumInputBytes = boundedInteger(
      this.#configuration.maximumInputBytes,
      maximumDefaultInputBytes,
      1_024,
      maximumDefaultInputBytes,
    );
    const maximumOutputBytes = boundedInteger(
      this.#configuration.maximumOutputBytes,
      c6PlanPolicy.maximumParserOutputBytes,
      128,
      c6PlanPolicy.maximumParserOutputBytes,
    );
    const timeoutMilliseconds = boundedInteger(
      this.#configuration.timeoutMilliseconds,
      c6PlanPolicy.parserTimeoutMilliseconds,
      1,
      c6PlanPolicy.parserTimeoutMilliseconds,
    );
    const terminationGraceMilliseconds = boundedInteger(
      this.#configuration.terminationGraceMilliseconds,
      100,
      1,
      1_000,
    );
    if (input.byteLength > maximumInputBytes) {
      throw new PlanParserAdapterError("INVALID_NORMALIZED_INPUT", false);
    }

    return await new Promise<PlanParserResult>((resolve, reject) => {
      let settled = false;
      let timedOut = false;
      let aborted = false;
      let outputTooLarge = false;
      let stderrTooLarge = false;
      let stdoutBytes = 0;
      let stderrBytes = 0;
      const output: Buffer[] = [];
      const child = spawn(this.#configuration.command, [...this.#configuration.arguments], {
        cwd: this.#configuration.cwd,
        env: safeEnvironment(this.#configuration.pythonPath),
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });

      const finish = (action: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", abortListener);
        action();
      };
      const terminate = (): void => {
        child.kill("SIGTERM");
        const forceTimer = setTimeout(() => {
          child.kill("SIGKILL");
        }, terminationGraceMilliseconds);
        forceTimer.unref();
      };
      const abortListener = (): void => {
        aborted = true;
        terminate();
      };
      options.signal?.addEventListener("abort", abortListener, { once: true });

      const timeout = setTimeout(() => {
        timedOut = true;
        terminate();
      }, timeoutMilliseconds);
      timeout.unref();

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.byteLength;
        if (stdoutBytes > maximumOutputBytes) {
          outputTooLarge = true;
          terminate();
          return;
        }
        output.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderrBytes += chunk.byteLength;
        if (stderrBytes > maximumStderrBytes) {
          stderrTooLarge = true;
          terminate();
        }
      });
      child.once("error", () => {
        finish(() => {
          reject(new PlanParserAdapterError("PARSER_UNAVAILABLE", true));
        });
      });
      child.once("close", (exitCode, signal) => {
        finish(() => {
          if (aborted) {
            reject(new PlanParserAdapterError("PARSER_ABORTED", false));
            return;
          }
          if (timedOut) {
            reject(new PlanParserAdapterError("PARSER_TIMEOUT", true));
            return;
          }
          if (outputTooLarge) {
            reject(new PlanParserAdapterError("PARSER_OUTPUT_TOO_LARGE", false));
            return;
          }
          if (stderrTooLarge) {
            reject(new PlanParserAdapterError("PARSER_STDERR_TOO_LARGE", false));
            return;
          }
          if (exitCode !== 0 || signal !== null) {
            reject(new PlanParserAdapterError("PARSER_EXITED", true));
            return;
          }
          try {
            resolve(decodeResult(Buffer.concat(output, stdoutBytes), parsedRequest.data));
          } catch (error) {
            reject(
              error instanceof PlanParserAdapterError
                ? error
                : new PlanParserAdapterError("PARSER_OUTPUT_INVALID", false),
            );
          }
        });
      });
      child.stdin.once("error", () => {
        // A close/error event owns the bounded public failure code.
      });
      child.stdin.end(input);
    });
  }
}
