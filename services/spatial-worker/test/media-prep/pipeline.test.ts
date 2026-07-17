import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import {
  MediaPreparationPipeline,
  type MediaPreparationPolicy,
  type MediaPreparationSafeCode,
  type PrivacyReviewer,
} from "../../src/media-prep/index.js";
import {
  acceptingPrivacyReviewer,
  requestFor,
  sourceFor,
  SyntheticMediaProcess,
  syntheticPng,
} from "./fixtures.js";

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "c8-media-prep-test-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("C8 deterministic media preparation", () => {
  it("creates exact deterministic hashes, strips metadata, and never forwards request strings as flags", async () => {
    const bytes = await syntheticPng();
    const request = requestFor(
      sourceFor(bytes, { assetId: "1d81d45d-b423-5c22-a44a-5ddc21a31a02" }),
    );
    const leftProcess = new SyntheticMediaProcess();
    const rightProcess = new SyntheticMediaProcess();
    const left = await new MediaPreparationPipeline({
      privacyReviewer: acceptingPrivacyReviewer,
      process: leftProcess,
      temporaryRoot: await temporaryRoot(),
    }).prepare(request);
    const right = await new MediaPreparationPipeline({
      privacyReviewer: acceptingPrivacyReviewer,
      process: rightProcess,
      temporaryRoot: await temporaryRoot(),
    }).prepare(request);

    expect(left.manifest).toEqual(right.manifest);
    expect(left.manifest).toMatchObject({
      privacyStatus: "accepted",
      schemaVersion: "c8-media-preparation-v1",
      tool: {
        adapterId: "ffmpeg-media-prep",
        executableVersion: "ffmpeg:synthetic-8.1;ffprobe:synthetic-8.1",
      },
    });
    expect(left.manifest.frames).toHaveLength(1);
    expect(left.manifest.frames[0]).toMatchObject({
      metadataStripped: true,
      redactionStatus: "not-required",
      timestampMicroseconds: 0,
    });
    const firstFrame = left.frames[0];
    const firstSource = request.sources[0];
    expect(firstFrame).toBeDefined();
    expect(firstSource).toBeDefined();
    if (firstFrame === undefined || firstSource === undefined) throw new Error("missing fixture");
    const output = await collect(firstFrame.open());
    const metadata = await sharp(output).metadata();
    expect(metadata.exif).toBeUndefined();
    const forwarded = leftProcess.calls.flatMap(({ arguments_ }) => arguments_).join(" ");
    expect(forwarded).not.toContain(firstSource.descriptor.assetId);
    expect(forwarded).not.toContain("http:");
    expect(forwarded).not.toContain("file:");
    await left.cleanup();
    await right.cleanup();
  });

  it("fails closed to review-required when no privacy detector is configured", async () => {
    const bundle = await new MediaPreparationPipeline({
      process: new SyntheticMediaProcess(),
      temporaryRoot: await temporaryRoot(),
    }).prepare(requestFor(sourceFor(await syntheticPng())));
    expect(bundle.manifest.privacyStatus).toBe("review-required");
    expect(bundle.manifest.frames[0]?.redactionStatus).toBe("review-required");
    await bundle.cleanup();
  });

  it("normalizes a pluggable redaction replacement before hashing", async () => {
    const replacement = await sharp({
      create: { background: "black", channels: 3, height: 8, width: 8 },
    })
      .withExif({ IFD0: { ImageDescription: "redaction metadata" } })
      .png()
      .toBuffer();
    const reviewer: PrivacyReviewer = {
      reviewerId: "synthetic-redactor",
      reviewerVersion: "1.0.0",
      review: () => Promise.resolve({ replacementPng: replacement, status: "applied" }),
    };
    const bundle = await new MediaPreparationPipeline({
      privacyReviewer: reviewer,
      process: new SyntheticMediaProcess(),
      temporaryRoot: await temporaryRoot(),
    }).prepare(requestFor(sourceFor(await syntheticPng())));
    expect(bundle.manifest.privacyStatus).toBe("accepted");
    expect(bundle.manifest.frames[0]?.redactionStatus).toBe("applied");
    const appliedFrame = bundle.frames[0];
    expect(appliedFrame).toBeDefined();
    if (appliedFrame === undefined) throw new Error("missing applied fixture");
    const metadata = await sharp(await collect(appliedFrame.open())).metadata();
    expect(metadata).toMatchObject({ height: 24, width: 32 });
    expect(metadata.exif).toBeUndefined();
    await bundle.cleanup();
  });

  it("records a rejected privacy decision without making accepted reconstruction input", async () => {
    const reviewer: PrivacyReviewer = {
      reviewerId: "synthetic-rejector",
      reviewerVersion: "1.0.0",
      review: () => Promise.resolve({ status: "rejected" }),
    };
    const bundle = await new MediaPreparationPipeline({
      privacyReviewer: reviewer,
      process: new SyntheticMediaProcess(),
      temporaryRoot: await temporaryRoot(),
    }).prepare(requestFor(sourceFor(await syntheticPng())));
    expect(bundle.manifest.privacyStatus).toBe("rejected");
    expect(bundle.manifest.frames[0]?.redactionStatus).toBe("review-required");
    await bundle.cleanup();
  });
});

describe("C8 hostile media and resource limits", () => {
  it.each([
    {
      code: "DECODED_TYPE_MISMATCH",
      mutate: (process: SyntheticMediaProcess) => {
        process.probe = { ...process.probe, codecName: "mjpeg" };
      },
    },
    {
      code: "PIXEL_LIMIT_EXCEEDED",
      mutate: (process: SyntheticMediaProcess) => {
        process.probe = { ...process.probe, height: 100_000, width: 100_000 };
      },
    },
  ])(
    "rejects decoded hostile media with $code and cleans the workspace",
    async ({ code, mutate }) => {
      const root = await temporaryRoot();
      const process = new SyntheticMediaProcess();
      mutate(process);
      await expect(
        new MediaPreparationPipeline({
          privacyReviewer: acceptingPrivacyReviewer,
          process,
          temporaryRoot: root,
        }).prepare(requestFor(sourceFor(await syntheticPng()))),
      ).rejects.toMatchObject({ safeCode: code });
      expect(await readdir(root)).toEqual([]);
    },
  );

  it("rejects duration, frame-rate, timeout, output, disk, hash, and cancellation limits", async () => {
    const bytes = await syntheticPng();
    const cases: {
      readonly code: MediaPreparationSafeCode;
      readonly configure: (process: SyntheticMediaProcess) => void;
      readonly overrides?: Readonly<Partial<MediaPreparationPolicy>>;
      readonly source?: ReturnType<typeof sourceFor>;
    }[] = [
      {
        code: "DURATION_LIMIT_EXCEEDED",
        configure: (process) => {
          process.probe = {
            ...process.probe,
            codecName: "h264",
            duration: "3601",
            formatName: "mov,mp4",
          };
        },
        source: sourceFor(bytes, { detectedMimeType: "video/mp4", kind: "rgb-video" }),
      },
      {
        code: "FRAME_RATE_LIMIT_EXCEEDED",
        configure: (process) => {
          process.probe = {
            ...process.probe,
            codecName: "h264",
            duration: "1",
            formatName: "mov,mp4",
            frameRate: "1000/1",
          };
        },
        source: sourceFor(bytes, { detectedMimeType: "video/mp4", kind: "rgb-video" }),
      },
      {
        code: "PROCESS_TIMEOUT",
        configure: (process) => {
          process.failExtraction = "timeout";
        },
      },
      {
        code: "PROCESS_OUTPUT_LIMIT",
        configure: (process) => {
          process.failExtraction = "output-limit";
        },
      },
      {
        code: "DISK_LIMIT_EXCEEDED",
        configure: () => undefined,
        overrides: { maximumTemporaryBytes: bytes.byteLength - 1 },
      },
      {
        code: "HASH_MISMATCH",
        configure: () => undefined,
        source: sourceFor(bytes, { sha256: "0".repeat(64) }),
      },
    ];
    for (const testCase of cases) {
      const root = await temporaryRoot();
      const process = new SyntheticMediaProcess();
      testCase.configure(process);
      await expect(
        new MediaPreparationPipeline({
          ...(testCase.overrides === undefined ? {} : { policy: testCase.overrides }),
          privacyReviewer: acceptingPrivacyReviewer,
          process,
          temporaryRoot: root,
        }).prepare(requestFor(testCase.source ?? sourceFor(bytes))),
      ).rejects.toMatchObject({ safeCode: testCase.code });
      expect(await readdir(root)).toEqual([]);
    }

    const root = await temporaryRoot();
    const abort = new AbortController();
    abort.abort();
    await expect(
      new MediaPreparationPipeline({
        privacyReviewer: acceptingPrivacyReviewer,
        process: new SyntheticMediaProcess(),
        temporaryRoot: root,
      }).prepare(requestFor(sourceFor(bytes)), abort.signal),
    ).rejects.toMatchObject({ safeCode: "CANCELLED" });
    expect(await readdir(root)).toEqual([]);
  });

  it("never creates a path named by hostile asset input", async () => {
    const root = await temporaryRoot();
    const process = new SyntheticMediaProcess();
    const bytes = await syntheticPng();
    const bundle = await new MediaPreparationPipeline({
      privacyReviewer: acceptingPrivacyReviewer,
      process,
      temporaryRoot: root,
    }).prepare(
      requestFor(
        sourceFor(bytes, {
          assetId: "a2f98669-35d4-5501-91f0-a40dff45ac48",
        }),
      ),
    );
    for (const entry of await readdir(root)) {
      expect(entry).toMatch(/^c8-media-prep-/u);
      expect(entry).not.toContain(";");
      expect(entry).not.toContain("..");
    }
    await bundle.cleanup();
    await expect(access(root)).resolves.toBeUndefined();
  });
});

async function collect(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
