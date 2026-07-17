import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { MediaPreparationPipeline } from "../../src/media-prep/index.js";
import { runBoundedProcess } from "../../src/subprocess.js";
import { acceptingPrivacyReviewer, requestFor, sourceFor, syntheticPng } from "./fixtures.js";

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "c8-actual-ffmpeg-test-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("C8 actual FFmpeg deterministic harness", () => {
  it("normalizes an actual synthetic still and removes embedded metadata", async () => {
    const source = sourceFor(await syntheticPng());
    const bundle = await new MediaPreparationPipeline({
      privacyReviewer: acceptingPrivacyReviewer,
      temporaryRoot: await temporaryRoot(),
    }).prepare(requestFor(source));

    expect(bundle.manifest.privacyStatus).toBe("accepted");
    expect(bundle.manifest.frames).toHaveLength(1);
    expect(bundle.manifest.frames[0]?.timestampMicroseconds).toBe(0);
    const frame = bundle.frames[0];
    if (frame === undefined) throw new Error("expected one prepared synthetic frame");
    const metadata = await sharp(await collect(frame.open())).metadata();
    expect(metadata).toMatchObject({ format: "png", height: 24, width: 32 });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    await bundle.cleanup();
  });

  it("samples a visibly synthetic rights-cleared test signal at fixed timestamps and strips metadata", async () => {
    const fixtureRoot = await temporaryRoot();
    const sourcePath = path.join(fixtureRoot, "synthetic-rights-cleared-test-signal.mp4");
    await runBoundedProcess(
      "ffmpeg",
      [
        "-hide_banner",
        "-nostdin",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=96x64:rate=10:duration=3.2",
        "-metadata",
        "comment=SYNTHETIC RIGHTS-CLEARED C8 FIXTURE",
        "-an",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-y",
        sourcePath,
      ],
      { maximumOutputBytes: 1_048_576, timeoutMs: 15_000 },
    );
    const bytes = await readFile(sourcePath);
    const source = sourceFor(bytes, {
      detectedMimeType: "video/mp4",
      kind: "rgb-video",
    });
    const left = await new MediaPreparationPipeline({
      privacyReviewer: acceptingPrivacyReviewer,
      temporaryRoot: await temporaryRoot(),
    }).prepare(requestFor(source));
    const right = await new MediaPreparationPipeline({
      privacyReviewer: acceptingPrivacyReviewer,
      temporaryRoot: await temporaryRoot(),
    }).prepare(requestFor(source));

    expect(left.manifest).toEqual(right.manifest);
    expect(left.manifest.privacyStatus).toBe("accepted");
    expect(left.manifest.frames.map(({ timestampMicroseconds }) => timestampMicroseconds)).toEqual([
      0, 1_000_000, 2_000_000,
    ]);
    for (const frame of left.frames) {
      const metadata = await sharp(await collect(frame.open())).metadata();
      expect(metadata).toMatchObject({ format: "png", height: 64, width: 96 });
      expect(metadata.exif).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
    }
    await left.cleanup();
    await right.cleanup();
  });
});

async function collect(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
