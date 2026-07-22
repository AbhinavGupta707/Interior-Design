import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import { rendererFailure, RendererBoundaryError } from "./errors.js";
import type {
  RendererExecutableDescriptor,
  RendererProcessPort,
  RendererProcessResult,
} from "./types.js";

const fixedEnvironmentKeys = ["LANG", "LC_ALL", "PATH"] as const;
const forbiddenEnvironmentKey =
  /(DATABASE|PG|POSTGRES|AWS|S3|SECRET|TOKEN|CREDENTIAL|PROVIDER|OPENAI)/iu;

async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const digest = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk: Buffer) => {
      digest.update(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => {
      resolve(digest.digest("hex"));
    });
  });
}

async function verifyRegularFile(filePath: string, expectedSha256: string, executable: boolean) {
  if (!path.isAbsolute(filePath) || !/^[a-f0-9]{64}$/u.test(expectedSha256)) {
    rendererFailure("RENDER_EXECUTABLE_INVALID");
  }
  const stat = await lstat(filePath).catch(() => undefined);
  if (stat === undefined || !stat.isFile() || stat.isSymbolicLink()) {
    rendererFailure("RENDER_EXECUTABLE_INVALID");
  }
  if (executable && (stat.mode & 0o111) === 0) rendererFailure("RENDER_EXECUTABLE_INVALID");
  if ((await realpath(filePath)) !== filePath || (await hashFile(filePath)) !== expectedSha256) {
    rendererFailure("RENDER_EXECUTABLE_HASH_MISMATCH");
  }
}

export async function verifyRendererDescriptor(
  descriptor: RendererExecutableDescriptor,
): Promise<void> {
  await verifyRegularFile(descriptor.executablePath, descriptor.executableSha256, true);
  await verifyRegularFile(descriptor.rendererScriptPath, descriptor.rendererScriptSha256, false);
}

export function rendererArguments(descriptor: RendererExecutableDescriptor, workspacePath: string) {
  const scene = path.join(workspacePath, "render-scene.json");
  const glb = path.join(workspacePath, "scene.glb");
  const protectedObjects = path.join(workspacePath, "protected-objects.json");
  const output = path.join(workspacePath, "output");
  return [
    "--background",
    "--factory-startup",
    "--disable-autoexec",
    "--offline-mode",
    "--python-exit-code",
    "41",
    "--python",
    descriptor.rendererScriptPath,
    "--",
    "--render-scene",
    scene,
    "--source-glb",
    glb,
    "--protected-objects",
    protectedObjects,
    "--output-directory",
    output,
  ] as const;
}

function boundedEnvironment(workspacePath: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = Object.create(null) as NodeJS.ProcessEnv;
  for (const key of fixedEnvironmentKeys) {
    const value = process.env[key];
    if (value !== undefined && !forbiddenEnvironmentKey.test(key)) environment[key] = value;
  }
  environment.HOME = workspacePath;
  environment.TMPDIR = workspacePath;
  environment.BLENDER_USER_CONFIG = path.join(workspacePath, "user-config");
  environment.BLENDER_USER_SCRIPTS = path.join(workspacePath, "user-scripts");
  environment.PYTHONNOUSERSITE = "1";
  return environment;
}

function terminateProcessGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return;
    if (code !== "EPERM") throw error;
    try {
      process.kill(pid, signal);
    } catch (fallbackError) {
      if ((fallbackError as NodeJS.ErrnoException).code !== "ESRCH") throw fallbackError;
    }
  }
}

export class FixedArgumentRendererProcess implements RendererProcessPort {
  async run(
    request: Parameters<RendererProcessPort["run"]>[0],
    signal?: AbortSignal,
  ): Promise<RendererProcessResult> {
    await verifyRendererDescriptor(request.descriptor);
    if (
      !Number.isInteger(request.maximumOutputBytes) ||
      request.maximumOutputBytes < 1 ||
      request.maximumOutputBytes > 1_048_576 ||
      !Number.isInteger(request.timeoutMilliseconds) ||
      request.timeoutMilliseconds < 100 ||
      request.timeoutMilliseconds > 7_200_000
    ) {
      rendererFailure("RENDER_PROCESS_LIMIT_INVALID");
    }

    return new Promise((resolve, reject) => {
      const child = spawn(
        request.descriptor.executablePath,
        rendererArguments(request.descriptor, request.workspacePath),
        {
          cwd: request.workspacePath,
          detached: true,
          env: boundedEnvironment(request.workspacePath),
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;
      const finish = (result: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        result();
      };
      const fail = (safeCode: string, childSignal: NodeJS.Signals = "SIGKILL") => {
        finish(() => {
          reject(new RendererBoundaryError(safeCode));
        });
        terminateProcessGroup(child.pid, childSignal);
      };
      const count = (kind: "stderr" | "stdout", chunk: Buffer) => {
        if (kind === "stdout") stdoutBytes += chunk.byteLength;
        else stderrBytes += chunk.byteLength;
        if (stdoutBytes + stderrBytes > request.maximumOutputBytes) {
          fail("RENDER_PROCESS_OUTPUT_LIMIT");
        }
      };
      child.stdout.on("data", (chunk: Buffer) => {
        count("stdout", chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        count("stderr", chunk);
      });
      child.on("error", () => {
        fail("RENDER_PROCESS_START_FAILED");
      });
      child.on("close", (code, childSignal) => {
        finish(() => {
          if (childSignal !== null || code === null) {
            reject(new RendererBoundaryError("RENDER_PROCESS_KILLED"));
          } else {
            resolve({ exitCode: code, stderrBytes, stdoutBytes });
          }
        });
      });
      const timeout = setTimeout(() => {
        setTimeout(() => {
          terminateProcessGroup(child.pid, "SIGKILL");
        }, 250).unref();
        fail("RENDER_PROCESS_TIMEOUT", "SIGTERM");
      }, request.timeoutMilliseconds);
      timeout.unref();
      const abort = () => {
        fail("RENDER_PROCESS_CANCELLED");
      };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted === true) abort();
    });
  }
}
