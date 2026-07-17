import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseWorkerConfig } from "../src/config.js";
import { serializeLog } from "../src/logger.js";
import { runBoundedProcess } from "../src/subprocess.js";
import type { ProcessExecutionError } from "../src/subprocess.js";
import { IsolatedWorkspace } from "../src/workspace.js";

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "c2-safety-test-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("strict worker configuration", () => {
  it("rejects incomplete production storage configuration", () => {
    expect(() => parseWorkerConfig({ NODE_ENV: "production" })).toThrow(
      "Production requires the C2 database",
    );
  });

  it("rejects non-loopback plaintext storage and unsafe heartbeat timing", () => {
    expect(() =>
      parseWorkerConfig({ C2_S3_ENDPOINT: "http://storage.example.test", NODE_ENV: "test" }),
    ).toThrow("must use HTTPS");
    expect(() =>
      parseWorkerConfig({ C2_HEARTBEAT_MS: "5000", C2_LEASE_MS: "10000", NODE_ENV: "test" }),
    ).toThrow("less than half");
  });
});

describe("bounded subprocess execution", () => {
  it("times out and kills a non-terminating child", async () => {
    await expect(
      runBoundedProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        maximumOutputBytes: 4_096,
        timeoutMs: 50,
      }),
    ).rejects.toMatchObject({ reason: "timeout" } satisfies Partial<ProcessExecutionError>);
  });

  it("returns a typed error for non-zero exit and bounds output", async () => {
    await expect(
      runBoundedProcess(process.execPath, ["-e", "process.exit(7)"], {
        maximumOutputBytes: 4_096,
        timeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({
      exitCode: 7,
      reason: "exit",
    } satisfies Partial<ProcessExecutionError>);
    await expect(
      runBoundedProcess(process.execPath, ["-e", "process.stdout.write('x'.repeat(5000))"], {
        maximumOutputBytes: 4_096,
        timeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({ reason: "output-limit" } satisfies Partial<ProcessExecutionError>);
  });

  it("passes hostile-looking paths as arguments without invoking a shell", async () => {
    const root = await temporaryRoot();
    const marker = path.join(root, "should-not-exist");
    const dangerous = `source;touch ${marker}`;
    const result = await runBoundedProcess(
      process.execPath,
      ["-e", "process.stdout.write(process.argv[1] ?? '')", dangerous],
      { maximumOutputBytes: 4_096, timeoutMs: 1_000 },
    );
    expect(result.stdout).toBe(dangerous);
    await expect(access(marker)).rejects.toThrow();
  });
});

describe("temporary and logging isolation", () => {
  it("rejects traversal, enforces quota and cleans a fresh workspace deterministically", async () => {
    const root = await temporaryRoot();
    const workspace = await IsolatedWorkspace.create(root, 8);
    expect(() => workspace.resolve("../escape")).toThrow("safe basenames");
    await writeFile(workspace.resolve("output.bin"), Buffer.alloc(9), { flag: "wx" });
    await expect(workspace.assertWithinQuota()).rejects.toMatchObject({
      message: "resource-limit",
    });
    const directory = workspace.directory;
    await workspace.cleanup();
    await workspace.cleanup();
    await expect(access(directory)).rejects.toThrow();
  });

  it("redacts signed URLs, credentials, object keys and long untrusted values", () => {
    const line = serializeLog(
      "error",
      "job.failed",
      {
        authorization: "Bearer very-secret-token",
        fileName: "private-plan.pdf",
        objectKey: "projects/private/source",
        safeCode: "processing-failed",
        signedUrl: "https://storage.invalid/object?X-Amz-Signature=secret",
        untrusted: "x".repeat(501),
      },
      () => new Date("2026-07-17T10:00:00.000Z"),
    );
    expect(line).toContain('"safeCode":"processing-failed"');
    expect(line).not.toContain("very-secret-token");
    expect(line).not.toContain("private-plan.pdf");
    expect(line).not.toContain("projects/private/source");
    expect(line).not.toContain("X-Amz-Signature");
  });
});
