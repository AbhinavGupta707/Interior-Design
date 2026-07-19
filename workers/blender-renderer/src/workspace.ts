import { lstat, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { rendererFailure } from "./errors.js";

const safeLeafPattern = /^[a-z0-9][a-z0-9.-]{0,79}$/u;

async function requirePrivateDirectory(directory: string): Promise<string> {
  if (!path.isAbsolute(directory)) rendererFailure("RENDER_WORKSPACE_ROOT_INVALID");
  const stat = await lstat(directory).catch(() => undefined);
  if (stat === undefined || !stat.isDirectory() || stat.isSymbolicLink()) {
    rendererFailure("RENDER_WORKSPACE_ROOT_INVALID");
  }
  if ((stat.mode & 0o077) !== 0) rendererFailure("RENDER_WORKSPACE_ROOT_INVALID");
  const canonical = await realpath(directory);
  return canonical;
}

export async function createPrivateRenderWorkspace(root: string): Promise<string> {
  await mkdir(root, { mode: 0o700, recursive: false }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  });
  const canonicalRoot = await requirePrivateDirectory(root);
  const workspace = await mkdtemp(path.join(canonicalRoot, "render-"));
  await mkdir(path.join(workspace, "output"), { mode: 0o700 });
  return workspace;
}

export function safeWorkspacePath(workspace: string, leaf: string): string {
  if (!safeLeafPattern.test(leaf)) rendererFailure("RENDER_WORKSPACE_PATH_INVALID");
  const resolved = path.resolve(workspace, leaf);
  if (path.dirname(resolved) !== path.resolve(workspace)) {
    rendererFailure("RENDER_WORKSPACE_PATH_INVALID");
  }
  return resolved;
}

export async function stagePrivateFile(
  workspace: string,
  leaf: string,
  bytes: Uint8Array,
): Promise<string> {
  const target = safeWorkspacePath(workspace, leaf);
  await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
  const stat = await lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== bytes.byteLength) {
    rendererFailure("RENDER_WORKSPACE_STAGE_INVALID");
  }
  return target;
}

export async function removePrivateRenderWorkspace(root: string, workspace: string): Promise<void> {
  const stat = await lstat(workspace).catch(() => undefined);
  if (stat === undefined) return;
  const canonicalRoot = await requirePrivateDirectory(root);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    !path.basename(workspace).startsWith("render-") ||
    path.dirname(await realpath(workspace)) !== canonicalRoot
  ) {
    rendererFailure("RENDER_WORKSPACE_CLEANUP_REFUSED");
  }
  await rm(workspace, { force: true, recursive: true });
}
