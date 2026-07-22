import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import { c14RenderPolicy } from "@interior-design/contracts";

import { rendererFailure, RendererBoundaryError } from "./errors.js";
import type {
  ExrInspection,
  ExrInspectionPort,
  ExrInspectorExecutableDescriptor,
} from "./types.js";
import {
  createPrivateRenderWorkspace,
  removePrivateRenderWorkspace,
  safeWorkspacePath,
  stagePrivateFile,
} from "./workspace.js";

const fixedEnvironmentKeys = ["LANG", "LC_ALL", "PATH"] as const;
const forbiddenEnvironmentKey =
  /(DATABASE|PG|POSTGRES|AWS|S3|SECRET|TOKEN|CREDENTIAL|PROVIDER|OPENAI)/iu;
const inspectionPrefix = "C14_EXR_INSPECTION ";

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

async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const digest = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk: Buffer) => digest.update(chunk));
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

export async function verifyExrInspectorDescriptor(
  descriptor: ExrInspectorExecutableDescriptor,
): Promise<void> {
  await verifyRegularFile(descriptor.executablePath, descriptor.executableSha256, true);
  await verifyRegularFile(descriptor.inspectorScriptPath, descriptor.inspectorScriptSha256, false);
}

export function exrInspectorArguments(
  descriptor: ExrInspectorExecutableDescriptor,
  workspacePath: string,
  role: "depth-exr" | "multilayer-exr" | "normal-exr",
) {
  return [
    "--background",
    "--factory-startup",
    "--disable-autoexec",
    "--offline-mode",
    "--python-exit-code",
    "42",
    "--python",
    descriptor.inspectorScriptPath,
    "--",
    "--input",
    safeWorkspacePath(workspacePath, "input.exr"),
    "--role",
    role,
  ] as const;
}

function normalizedChannels(
  role: "depth-exr" | "multilayer-exr" | "normal-exr",
  rawChannels: readonly string[],
): readonly string[] {
  const raw = new Set(rawChannels);
  if (role === "depth-exr") {
    return raw.has("depth.V") || raw.has("Z.V") || raw.has("Z") ? ["Z"] : [];
  }
  if (role === "normal-exr") {
    return ["X", "Y", "Z"]
      .filter((axis) => raw.has(`normal.${axis}`) || raw.has(`Normal.${axis}`))
      .map((axis) => `Normal.${axis}`);
  }
  const expected = ["Combined.R", "Combined.G", "Combined.B", "CryptoObject00.R"];
  return expected.filter((channel) => {
    if (raw.has(channel)) return true;
    const [layer, component] = channel.split(".");
    return (
      layer === "CryptoObject00" &&
      component !== undefined &&
      raw.has(`${layer}.${component.toLowerCase()}`)
    );
  });
}

function parseInspectionOutput(
  stdout: string,
  role: "depth-exr" | "multilayer-exr" | "normal-exr",
): ExrInspection {
  const candidates = stdout
    .split(/\r?\n/u)
    .filter((line) => line.startsWith(inspectionPrefix))
    .map((line) => line.slice(inspectionPrefix.length));
  if (candidates.length !== 1) rendererFailure("RENDER_EXR_INSPECTION_INVALID");
  let value: unknown;
  try {
    value = JSON.parse(candidates[0] ?? "");
  } catch {
    rendererFailure("RENDER_EXR_INSPECTION_INVALID");
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (value as { readonly schemaVersion?: unknown }).schemaVersion !== "c14-exr-inspection-v1" ||
    !Array.isArray((value as { readonly channels?: unknown }).channels) ||
    !(value as { readonly channels: readonly unknown[] }).channels.every(
      (channel) => typeof channel === "string" && /^[A-Za-z0-9_.]{1,120}$/u.test(channel),
    ) ||
    typeof (value as { readonly allFinite?: unknown }).allFinite !== "boolean" ||
    !Number.isInteger((value as { readonly widthPx?: unknown }).widthPx) ||
    !Number.isInteger((value as { readonly heightPx?: unknown }).heightPx)
  ) {
    rendererFailure("RENDER_EXR_INSPECTION_INVALID");
  }
  const widthPx = (value as { readonly widthPx: number }).widthPx;
  const heightPx = (value as { readonly heightPx: number }).heightPx;
  if (
    widthPx < 1 ||
    heightPx < 1 ||
    widthPx * heightPx > c14RenderPolicy.maximumPixels ||
    (value as { readonly channels: readonly string[] }).channels.length > 128
  ) {
    rendererFailure("RENDER_EXR_INSPECTION_INVALID");
  }
  return {
    allFinite: (value as { readonly allFinite: boolean }).allFinite,
    channels: normalizedChannels(role, (value as { readonly channels: readonly string[] }).channels),
    heightPx,
    widthPx,
  };
}

function terminateProcessGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function inspectWithPinnedBlender(input: {
  readonly descriptor: ExrInspectorExecutableDescriptor;
  readonly role: "depth-exr" | "multilayer-exr" | "normal-exr";
  readonly timeoutMilliseconds: number;
  readonly workspace: string;
}): Promise<string> {
  await verifyExrInspectorDescriptor(input.descriptor);
  return new Promise((resolve, reject) => {
    const child = spawn(
      input.descriptor.executablePath,
      exrInspectorArguments(input.descriptor, input.workspace, input.role),
      {
        cwd: input.workspace,
        detached: true,
        env: boundedEnvironment(input.workspace),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    const output: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const fail = (safeCode: string) => {
      finish(() => {
        reject(new RendererBoundaryError(safeCode));
      });
      terminateProcessGroup(child.pid);
    };
    const collect = (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > 65_536) fail("RENDER_EXR_INSPECTION_OUTPUT_LIMIT");
      else output.push(chunk);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", () => {
      fail("RENDER_EXR_INSPECTION_START_FAILED");
    });
    child.on("close", (code, signal) => {
      finish(() => {
        if (signal !== null || code !== 0) {
          reject(new RendererBoundaryError("RENDER_EXR_INSPECTION_FAILED"));
        } else {
          resolve(Buffer.concat(output).toString("utf8"));
        }
      });
    });
    const timeout = setTimeout(() => {
      fail("RENDER_EXR_INSPECTION_TIMEOUT");
    }, input.timeoutMilliseconds);
    timeout.unref();
  });
}

export class BundledOiioExrInspector implements ExrInspectionPort {
  readonly #descriptor: ExrInspectorExecutableDescriptor;
  readonly #timeoutMilliseconds: number;
  readonly #workspaceRoot: string;

  constructor(options: {
    readonly descriptor: ExrInspectorExecutableDescriptor;
    readonly timeoutMilliseconds?: number;
    readonly workspaceRoot: string;
  }) {
    this.#descriptor = options.descriptor;
    this.#timeoutMilliseconds = options.timeoutMilliseconds ?? 30_000;
    this.#workspaceRoot = options.workspaceRoot;
  }

  async inspect(
    role: "depth-exr" | "multilayer-exr" | "normal-exr",
    bytes: Uint8Array,
  ): Promise<ExrInspection> {
    if (
      bytes.byteLength < 16 ||
      bytes.byteLength > c14RenderPolicy.maximumArtifactBytes ||
      !Number.isInteger(this.#timeoutMilliseconds) ||
      this.#timeoutMilliseconds < 100 ||
      this.#timeoutMilliseconds > 120_000
    ) {
      rendererFailure("RENDER_EXR_INSPECTION_INVALID");
    }
    const workspace = await createPrivateRenderWorkspace(this.#workspaceRoot);
    try {
      await stagePrivateFile(workspace, "input.exr", bytes);
      return parseInspectionOutput(
        await inspectWithPinnedBlender({
          descriptor: this.#descriptor,
          role,
          timeoutMilliseconds: this.#timeoutMilliseconds,
          workspace,
        }),
        role,
      );
    } finally {
      await removePrivateRenderWorkspace(this.#workspaceRoot, workspace);
    }
  }
}

export const __test__ = { normalizedChannels, parseInspectionOutput };
