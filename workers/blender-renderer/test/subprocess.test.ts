import { createReadStream } from "node:fs";
import { chmod } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { FixedArgumentRendererProcess, type RendererExecutableDescriptor } from "../src/index.js";

const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url);

async function hashFile(url: URL): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(url)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function descriptor(scriptName: string): Promise<RendererExecutableDescriptor> {
  const executablePath = fileURLToPath(fixture("inert-renderer.ts"));
  const rendererScriptPath = fileURLToPath(fixture(scriptName));
  await chmod(executablePath, 0o755);
  return {
    executablePath,
    executableSha256: await hashFile(fixture("inert-renderer.ts")),
    rendererScriptPath,
    rendererScriptSha256: await hashFile(fixture(scriptName)),
  };
}

describe("C14 fixed subprocess boundary", () => {
  it("uses the fixed offline/no-autoexec argument array and a credential-free environment", async () => {
    process.env.C14_FIXTURE_SECRET_TOKEN = "must-not-cross";
    try {
      const result = await new FixedArgumentRendererProcess().run({
        descriptor: await descriptor("inert.py"),
        maximumOutputBytes: 1_024,
        timeoutMilliseconds: 2_000,
        workspacePath: fileURLToPath(fixture(".")),
      });
      expect(result).toEqual({ exitCode: 0, stderrBytes: 0, stdoutBytes: 0 });
    } finally {
      delete process.env.C14_FIXTURE_SECRET_TOKEN;
    }
  });

  it("kills the entire inert fixture process group on timeout", async () => {
    await expect(
      new FixedArgumentRendererProcess().run({
        descriptor: await descriptor("hang.py"),
        maximumOutputBytes: 1_024,
        timeoutMilliseconds: 100,
        workspacePath: fileURLToPath(fixture(".")),
      }),
    ).rejects.toMatchObject({ safeCode: "RENDER_PROCESS_TIMEOUT" });
  });

  it("kills an inert fixture that exceeds bounded subprocess output", async () => {
    await expect(
      new FixedArgumentRendererProcess().run({
        descriptor: await descriptor("flood.py"),
        maximumOutputBytes: 512,
        timeoutMilliseconds: 2_000,
        workspacePath: fileURLToPath(fixture(".")),
      }),
    ).rejects.toMatchObject({ safeCode: "RENDER_PROCESS_OUTPUT_LIMIT" });
  });

  it("rejects an executable whose pinned bytes changed", async () => {
    const pinned = await descriptor("inert.py");
    await expect(
      new FixedArgumentRendererProcess().run({
        descriptor: { ...pinned, executableSha256: "0".repeat(64) },
        maximumOutputBytes: 512,
        timeoutMilliseconds: 2_000,
        workspacePath: fileURLToPath(fixture(".")),
      }),
    ).rejects.toMatchObject({ safeCode: "RENDER_EXECUTABLE_HASH_MISMATCH" });
  });
});
