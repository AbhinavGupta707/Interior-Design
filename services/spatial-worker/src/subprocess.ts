import { spawn } from "node:child_process";

export interface ProcessLimits {
  readonly maximumOutputBytes: number;
  readonly timeoutMs: number;
}

export interface ProcessResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

export interface ProcessExecutionOptions {
  /** Code-owned working directory. Request payloads must never supply this value. */
  readonly cwd?: string;
  /** Bounded code-owned protocol input. Customer paths and commands must never enter here. */
  readonly stdin?: string | Uint8Array;
}

export class ProcessExecutionError extends Error {
  readonly reason: "aborted" | "exit" | "output-limit" | "spawn" | "timeout";
  readonly exitCode?: number;
  readonly stderr?: string;
  readonly stdout?: string;

  constructor(
    reason: ProcessExecutionError["reason"],
    options: {
      readonly cause?: unknown;
      readonly exitCode?: number;
      readonly stderr?: string;
      readonly stdout?: string;
    } = {},
  ) {
    super(
      `subprocess-${reason}`,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "ProcessExecutionError";
    this.reason = reason;
    if (options.exitCode !== undefined) {
      this.exitCode = options.exitCode;
    }
    if (options.stderr !== undefined) this.stderr = options.stderr;
    if (options.stdout !== undefined) this.stdout = options.stdout;
  }
}

export function runBoundedProcess(
  executable: string,
  arguments_: readonly string[],
  limits: ProcessLimits,
  signal?: AbortSignal,
  options: ProcessExecutionOptions = {},
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let pendingFailure: ProcessExecutionError | undefined;
    let outputBytes = 0;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const child = spawn(executable, [...arguments_], {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      env: {
        LANG: "C",
        LC_ALL: "C",
        PATH: process.env.PATH ?? "/usr/bin:/bin",
      },
      shell: false,
      stdio: [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const childStdout = child.stdout;
    const childStderr = child.stderr;
    if (childStdout === null || childStderr === null) {
      reject(new ProcessExecutionError("spawn"));
      return;
    }

    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const failAndKill = (error: ProcessExecutionError): void => {
      if (settled || pendingFailure !== undefined) return;
      pendingFailure = error;
      cleanup();
      child.kill("SIGKILL");
    };
    const abort = (): void => {
      failAndKill(new ProcessExecutionError("aborted"));
    };
    const timer = setTimeout(() => {
      failAndKill(new ProcessExecutionError("timeout"));
    }, limits.timeoutMs);
    timer.unref();

    const collect = (target: Buffer[], chunk: Buffer): void => {
      outputBytes += chunk.byteLength;
      if (outputBytes > limits.maximumOutputBytes) {
        failAndKill(new ProcessExecutionError("output-limit"));
        return;
      }
      target.push(chunk);
    };
    childStdout.on("data", (chunk: Buffer) => {
      collect(stdout, chunk);
    });
    childStderr.on("data", (chunk: Buffer) => {
      collect(stderr, chunk);
    });
    child.once("error", (error) => {
      if (settled || pendingFailure !== undefined) return;
      settled = true;
      cleanup();
      reject(new ProcessExecutionError("spawn", { cause: error }));
    });
    child.once("close", (exitCode) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (pendingFailure !== undefined) {
        reject(pendingFailure);
        return;
      }
      const code = exitCode ?? -1;
      if (code !== 0) {
        reject(
          new ProcessExecutionError("exit", {
            exitCode: code,
            stderr: Buffer.concat(stderr).toString("utf8"),
            stdout: Buffer.concat(stdout).toString("utf8"),
          }),
        );
        return;
      }
      resolve({
        exitCode: code,
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdout: Buffer.concat(stdout).toString("utf8"),
      });
    });
    if (signal?.aborted === true) {
      abort();
    } else {
      signal?.addEventListener("abort", abort, { once: true });
    }
    if (options.stdin !== undefined && child.stdin !== null) {
      child.stdin.once("error", (error) => {
        if (!settled && pendingFailure === undefined) {
          failAndKill(new ProcessExecutionError("spawn", { cause: error }));
        }
      });
      child.stdin.end(options.stdin);
    }
  });
}
