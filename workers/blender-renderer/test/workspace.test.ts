import { lstat, mkdir, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  createPrivateRenderWorkspace,
  removePrivateRenderWorkspace,
  safeWorkspacePath,
  stagePrivateFile,
} from "../src/index.js";

describe("C14 private workspace", () => {
  it("creates a 0700 workspace, stages regular 0600 files, and cleans it", async () => {
    const root = path.join(os.tmpdir(), `c14-root-${String(process.pid)}-${String(Date.now())}`);
    await mkdir(root, { mode: 0o700 });
    try {
      const workspace = await createPrivateRenderWorkspace(root);
      expect((await lstat(workspace)).mode & 0o777).toBe(0o700);
      const staged = await stagePrivateFile(workspace, "scene.glb", Buffer.from("fixture"));
      expect((await lstat(staged)).mode & 0o777).toBe(0o600);
      expect(() => safeWorkspacePath(workspace, "../escape")).toThrow();
      await removePrivateRenderWorkspace(root, workspace);
      await expect(lstat(workspace)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects a symlinked workspace root", async () => {
    const real = path.join(os.tmpdir(), `c14-real-${String(process.pid)}-${String(Date.now())}`);
    const linked = path.join(os.tmpdir(), `c14-link-${String(process.pid)}-${String(Date.now())}`);
    await mkdir(real, { mode: 0o700 });
    try {
      await symlink(real, linked);
      await expect(createPrivateRenderWorkspace(linked)).rejects.toMatchObject({
        safeCode: "RENDER_WORKSPACE_ROOT_INVALID",
      });
    } finally {
      await rm(linked, { force: true });
      await rm(real, { force: true, recursive: true });
    }
  });
});
