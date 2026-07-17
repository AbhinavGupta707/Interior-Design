import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { MediaProcessor } from "../src/processor.js";
import { runBoundedProcess } from "../src/subprocess.js";
import { commandFor, MemoryObjectStorage, testConfig } from "./support.js";

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "c2-video-test-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function tinyVideo(root: string): Promise<Buffer> {
  const output = path.join(root, "tiny.mp4");
  await runBoundedProcess(
    "ffmpeg",
    [
      "-nostdin",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=16x16:d=0.2:r=5",
      "-an",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-y",
      output,
    ],
    { maximumOutputBytes: 1_048_576, timeoutMs: 10_000 },
  );
  return readFile(output);
}

describe("bounded video inspection", () => {
  it("inspects codecs, streams, container, duration and generates a safe frame", async () => {
    const root = await temporaryRoot();
    const contents = await tinyVideo(root);
    const command = commandFor(contents, { declaredMimeType: "video/mp4", kind: "video" });
    const storage = new MemoryObjectStorage();
    storage.sources.set(command.source.key, contents);
    const processor = new MediaProcessor(testConfig(root), storage);

    const prepared = await processor.process({
      command,
      executedAt: "2026-07-17T10:00:00.000Z",
    });
    expect(prepared.result).toMatchObject({
      detectedMimeType: "video/mp4",
      status: "ready",
      technicalMetadata: { heightPixels: 16, widthPixels: 16 },
    });
    expect(prepared.result.technicalMetadata.durationMilliseconds).toBeGreaterThan(0);
    expect(prepared.result.provenance.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["ffmpeg", "ffprobe"]),
    );
    await prepared.cleanup();
  });

  it("rejects honestly when the configured decoder executable is absent", async () => {
    const root = await temporaryRoot();
    const contents = await tinyVideo(root);
    const command = commandFor(contents, { declaredMimeType: "video/mp4", kind: "video" });
    const storage = new MemoryObjectStorage();
    storage.sources.set(command.source.key, contents);
    const baseConfig = testConfig(root);
    const config = {
      ...baseConfig,
      executables: { ...baseConfig.executables, ffmpeg: "missing-c2-ffmpeg" },
    };
    const processor = new MediaProcessor(config, storage);

    const prepared = await processor.process({
      command,
      executedAt: "2026-07-17T10:00:00.000Z",
    });
    expect(prepared.result).toMatchObject({
      rejectionCode: "unsupported-type",
      status: "rejected",
    });
    await prepared.cleanup();
  });
});
