import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import sharp from "sharp";

import { ProcessExecutionError } from "../../src/subprocess.js";
import type {
  MediaExecutable,
  MediaPreparationRequest,
  MediaPreparationSource,
  MediaProcessPort,
  PrivacyReviewer,
  RGBMediaSource,
} from "../../src/media-prep/index.js";

export const projectId = "cb79666d-ed5f-5c2b-aa9e-9f0a187049de";
export const jobId = "40c6c94a-7177-53a5-a367-49de0e4c9059";
export const assetId = "61926662-21a7-573e-a768-c35f5583badb";

export const acceptingPrivacyReviewer: PrivacyReviewer = {
  reviewerId: "synthetic-test-reviewer",
  reviewerVersion: "1.0.0",
  review: () => Promise.resolve({ status: "not-required" }),
};

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sourceFor(
  bytes: Buffer,
  overrides: Partial<RGBMediaSource> = {},
): MediaPreparationSource {
  const descriptor: RGBMediaSource = {
    assetId,
    byteSize: bytes.byteLength,
    detectedMimeType: "image/png",
    kind: "rgb-image",
    sha256: sha256(bytes),
    ...overrides,
  };
  return {
    descriptor,
    open: () => Promise.resolve(Readable.from([bytes])),
  };
}

export function requestFor(source: MediaPreparationSource): MediaPreparationRequest {
  return { jobId, projectId, sources: [source] };
}

export interface SyntheticProbe {
  readonly codecName: string;
  readonly duration: string;
  readonly formatName: string;
  readonly frameRate: string;
  readonly height: number;
  readonly rotation?: number;
  readonly width: number;
}

export class SyntheticMediaProcess implements MediaProcessPort {
  readonly calls: {
    readonly arguments_: readonly string[];
    readonly executable: MediaExecutable;
  }[] = [];
  failExtraction?: "output-limit" | "timeout";
  frameCount = 1;
  probe: SyntheticProbe = {
    codecName: "png",
    duration: "0",
    formatName: "image2",
    frameRate: "25/1",
    height: 24,
    width: 32,
  };

  async run(executable: MediaExecutable, arguments_: readonly string[]) {
    this.calls.push({ arguments_, executable });
    if (arguments_[0] === "-version") {
      return {
        exitCode: 0,
        stderr: "",
        stdout: `${executable} version synthetic-8.1 Copyright synthetic fixture\n`,
      };
    }
    if (executable === "ffprobe") {
      return {
        exitCode: 0,
        stderr: "",
        stdout: JSON.stringify({
          format: { duration: this.probe.duration, format_name: this.probe.formatName },
          streams: [
            {
              avg_frame_rate: this.probe.frameRate,
              codec_name: this.probe.codecName,
              codec_type: "video",
              height: this.probe.height,
              side_data_list:
                this.probe.rotation === undefined ? [] : [{ rotation: this.probe.rotation }],
              width: this.probe.width,
            },
          ],
        }),
      };
    }
    if (this.failExtraction !== undefined) {
      throw new ProcessExecutionError(this.failExtraction);
    }
    const pattern = arguments_.at(-1);
    if (pattern === undefined || !pattern.includes("%06d"))
      throw new Error("missing output pattern");
    for (let index = 0; index < this.frameCount; index += 1) {
      const output = pattern.replace("%06d", String(index).padStart(6, "0"));
      const pixels = Buffer.alloc(this.probe.width * this.probe.height * 3);
      for (let pixel = 0; pixel < this.probe.width * this.probe.height; pixel += 1) {
        pixels[pixel * 3] = (pixel + index * 11) % 255;
        pixels[pixel * 3 + 1] = (pixel * 3 + index * 7) % 255;
        pixels[pixel * 3 + 2] = (pixel * 5 + index * 13) % 255;
      }
      const png = await sharp(pixels, {
        raw: { channels: 3, height: this.probe.height, width: this.probe.width },
      })
        .png({ compressionLevel: 9 })
        .toBuffer();
      await writeFile(output, png, { mode: 0o600 });
    }
    return { exitCode: 0, stderr: "", stdout: "" };
  }
}

export async function syntheticPng(): Promise<Buffer> {
  return sharp({
    create: { background: { b: 160, g: 80, r: 20 }, channels: 3, height: 24, width: 32 },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="32" height="24"><text x="1" y="12" font-size="4" fill="white">SYNTHETIC</text><text x="1" y="18" font-size="3" fill="white">RIGHTS-CLEARED</text></svg>`,
        ),
      },
    ])
    .withExif({ IFD0: { ImageDescription: "synthetic metadata must be stripped" } })
    .png()
    .toBuffer();
}
