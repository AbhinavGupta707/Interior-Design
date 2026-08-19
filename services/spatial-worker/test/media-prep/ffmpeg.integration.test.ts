import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    for (const [index, frame] of left.frames.entries()) {
      const rightFrame = right.frames[index];
      if (rightFrame === undefined) throw new Error("missing repeated synthetic frame");
      const leftBytes = await collect(frame.open());
      expect(leftBytes).toEqual(await collect(rightFrame.open()));
      const metadata = await sharp(leftBytes).metadata();
      expect(metadata).toMatchObject({ format: "png", height: 64, width: 96 });
      expect(metadata.exif).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
    }
    await left.cleanup();
    await right.cleanup();
  });

  it("applies display rotation visually, swaps dimensions, strips rotation metadata, and stays deterministic", async () => {
    const fixtureRoot = await temporaryRoot();
    const sourcePath = path.join(fixtureRoot, "synthetic-quadrants.mp4");
    const rotatedPath = path.join(fixtureRoot, "synthetic-quadrants-rotated.mp4");
    await createQuadrantVideo(sourcePath);
    await runBoundedProcess(
      "ffmpeg",
      [
        "-hide_banner",
        "-nostdin",
        "-v",
        "error",
        "-display_rotation",
        "90",
        "-i",
        sourcePath,
        "-map",
        "0:v:0",
        "-c",
        "copy",
        "-y",
        rotatedPath,
      ],
      { maximumOutputBytes: 1_048_576, timeoutMs: 15_000 },
    );
    expect(await rotationMetadata(rotatedPath)).toContain("rotation=90");

    const source = sourceFor(await readFile(rotatedPath), {
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
    expect(left.manifest.frames).toHaveLength(1);
    expect(left.manifest.frames[0]).toMatchObject({
      heightPixels: 80,
      metadataStripped: true,
      widthPixels: 40,
    });
    const leftFrame = left.frames[0];
    const rightFrame = right.frames[0];
    if (leftFrame === undefined || rightFrame === undefined) {
      throw new Error("expected one prepared rotated frame");
    }
    const leftBytes = await collect(leftFrame.open());
    const rightBytes = await collect(rightFrame.open());
    expect(leftBytes).toEqual(rightBytes);

    const metadata = await sharp(leftBytes).metadata();
    expect(metadata).toMatchObject({ format: "png", height: 80, width: 40 });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();

    const normalizedPath = path.join(fixtureRoot, "normalized-rotated.png");
    await writeFile(normalizedPath, leftBytes);
    expect(await rotationMetadata(normalizedPath)).toBe("");

    const { data, info } = await sharp(leftBytes)
      .removeAlpha()
      .toColourspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info).toMatchObject({ channels: 3, height: 80, width: 40 });
    expectPixelColour(data, info.width, info.channels, 5, 5, "green");
    expectPixelColour(data, info.width, info.channels, 35, 5, "yellow");
    expectPixelColour(data, info.width, info.channels, 5, 75, "red");
    expectPixelColour(data, info.width, info.channels, 35, 75, "blue");

    await left.cleanup();
    await right.cleanup();
  });
});

async function collect(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function createQuadrantVideo(outputPath: string): Promise<void> {
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
      "color=c=black:s=80x40:r=1:d=1,drawbox=x=0:y=0:w=40:h=20:color=red:t=fill,drawbox=x=40:y=0:w=40:h=20:color=green:t=fill,drawbox=x=0:y=20:w=40:h=20:color=blue:t=fill,drawbox=x=40:y=20:w=40:h=20:color=yellow:t=fill",
      "-metadata",
      "comment=SYNTHETIC RIGHTS-CLEARED ROTATION FIXTURE",
      "-an",
      "-c:v",
      "libx264",
      "-crf",
      "0",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-y",
      outputPath,
    ],
    { maximumOutputBytes: 1_048_576, timeoutMs: 15_000 },
  );
}

async function rotationMetadata(sourcePath: string): Promise<string> {
  const result = await runBoundedProcess(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream_tags=rotate:stream_side_data=rotation",
      "-of",
      "default=noprint_wrappers=1",
      sourcePath,
    ],
    { maximumOutputBytes: 16_384, timeoutMs: 5_000 },
  );
  return result.stdout.trim();
}

type PixelColour = "blue" | "green" | "red" | "yellow";

function expectPixelColour(
  data: Buffer,
  width: number,
  channels: number,
  x: number,
  y: number,
  expected: PixelColour,
): void {
  const offset = (y * width + x) * channels;
  const [red, green, blue] = [data[offset] ?? -1, data[offset + 1] ?? -1, data[offset + 2] ?? -1];
  switch (expected) {
    case "red":
      expect(red).toBeGreaterThan(180);
      expect(green).toBeLessThan(60);
      expect(blue).toBeLessThan(60);
      return;
    case "green":
      expect(red).toBeLessThan(60);
      expect(green).toBeGreaterThan(80);
      expect(blue).toBeLessThan(60);
      return;
    case "blue":
      expect(red).toBeLessThan(60);
      expect(green).toBeLessThan(60);
      expect(blue).toBeGreaterThan(180);
      return;
    case "yellow":
      expect(red).toBeGreaterThan(180);
      expect(green).toBeGreaterThan(180);
      expect(blue).toBeLessThan(60);
  }
}
