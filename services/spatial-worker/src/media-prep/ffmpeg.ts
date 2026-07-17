import { z } from "zod";

import { ProcessExecutionError, runBoundedProcess } from "../subprocess.js";
import type { ProcessLimits, ProcessResult } from "../subprocess.js";
import type {
  DecodedMediaProbe,
  MediaExecutable,
  MediaPreparationPolicy,
  MediaProcessPort,
  RGBMediaSource,
} from "./types.js";
import { MediaPreparationError } from "./types.js";
import type { MediaPreparationWorkspace } from "./workspace.js";

const ffprobeDocumentSchema = z
  .object({
    format: z
      .object({
        duration: z.string().optional(),
        format_name: z.string().optional(),
      })
      .loose()
      .optional(),
    streams: z.array(
      z
        .object({
          avg_frame_rate: z.string().optional(),
          codec_name: z.string().optional(),
          codec_type: z.string().optional(),
          duration: z.string().optional(),
          height: z.number().int().optional(),
          r_frame_rate: z.string().optional(),
          side_data_list: z.array(z.object({ rotation: z.number().optional() }).loose()).optional(),
          tags: z.object({ rotate: z.string().optional() }).loose().optional(),
          width: z.number().int().optional(),
        })
        .loose(),
    ),
  })
  .loose();

export class BoundedMediaProcessPort implements MediaProcessPort {
  run(
    executable: MediaExecutable,
    arguments_: readonly string[],
    limits: ProcessLimits,
    signal?: AbortSignal,
  ): Promise<ProcessResult> {
    return runBoundedProcess(executable, arguments_, limits, signal);
  }
}

export interface MediaToolVersions {
  readonly executableVersion: string;
  readonly ffmpeg: string;
  readonly ffprobe: string;
}

export class FFmpegMediaTools {
  readonly #policy: Readonly<MediaPreparationPolicy>;
  readonly #process: MediaProcessPort;
  readonly #workspace: MediaPreparationWorkspace;

  constructor(
    workspace: MediaPreparationWorkspace,
    policy: Readonly<MediaPreparationPolicy>,
    process: MediaProcessPort = new BoundedMediaProcessPort(),
  ) {
    this.#workspace = workspace;
    this.#policy = policy;
    this.#process = process;
  }

  async versions(signal?: AbortSignal): Promise<MediaToolVersions> {
    const limits = { maximumOutputBytes: 16_384, timeoutMs: 5_000 };
    const [ffmpeg, ffprobe] = await Promise.all([
      this.#run("ffmpeg", ["-version"], limits, signal),
      this.#run("ffprobe", ["-version"], limits, signal),
    ]);
    const ffmpegVersion = parseVersion(ffmpeg.stdout, "ffmpeg");
    const ffprobeVersion = parseVersion(ffprobe.stdout, "ffprobe");
    return {
      executableVersion: `ffmpeg:${ffmpegVersion};ffprobe:${ffprobeVersion}`,
      ffmpeg: ffmpegVersion,
      ffprobe: ffprobeVersion,
    };
  }

  async probe(
    sourcePath: string,
    descriptor: RGBMediaSource,
    signal?: AbortSignal,
  ): Promise<DecodedMediaProbe> {
    this.#workspace.assertOwnedPath(sourcePath);
    const result = await this.#run(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=format_name,duration:stream=codec_type,codec_name,width,height,duration,avg_frame_rate,r_frame_rate:stream_tags=rotate:stream_side_data=rotation",
        "-of",
        "json",
        sourcePath,
      ],
      {
        maximumOutputBytes: this.#policy.maximumProbeBytes,
        timeoutMs: Math.min(this.#policy.processTimeoutMilliseconds, 30_000),
      },
      signal,
    );
    let document: z.infer<typeof ffprobeDocumentSchema>;
    try {
      document = ffprobeDocumentSchema.parse(JSON.parse(result.stdout));
    } catch (error) {
      throw new MediaPreparationError("MALFORMED_MEDIA", { cause: error });
    }
    const video = document.streams.find(({ codec_type }) => codec_type === "video");
    if (
      video?.codec_name === undefined ||
      video.width === undefined ||
      video.height === undefined ||
      video.width <= 0 ||
      video.height <= 0
    ) {
      throw new MediaPreparationError("MALFORMED_MEDIA");
    }
    const durationSeconds = parseFiniteNumber(document.format?.duration ?? video.duration ?? "0");
    const durationMicroseconds = Math.round(durationSeconds * 1_000_000);
    const framesPerSecond = parseRate(video.avg_frame_rate ?? video.r_frame_rate ?? "0/1");
    const formatNames = (document.format?.format_name ?? "")
      .split(",")
      .map((name) => name.trim().toLowerCase())
      .filter((name) => name.length > 0);
    const rawRotation =
      video.side_data_list?.find(({ rotation }) => rotation !== undefined)?.rotation ??
      parseFiniteNumber(video.tags?.rotate ?? "0");
    const rotationDegrees = normalizeRotation(rawRotation);
    const probe: DecodedMediaProbe = {
      codecName: video.codec_name.toLowerCase(),
      durationMicroseconds,
      formatNames,
      framesPerSecond,
      heightPixels: video.height,
      rotationDegrees,
      widthPixels: video.width,
    };
    validateDecodedType(descriptor, probe);
    this.#validateBudgets(descriptor, probe);
    return probe;
  }

  async extractFrames(
    sourcePath: string,
    sourceIndex: number,
    descriptor: RGBMediaSource,
    probe: DecodedMediaProbe,
    maximumFrames: number,
    signal?: AbortSignal,
  ): Promise<readonly string[]> {
    this.#workspace.assertOwnedPath(sourcePath);
    if (!Number.isSafeInteger(maximumFrames) || maximumFrames <= 0) {
      throw new MediaPreparationError("FRAME_LIMIT_EXCEEDED");
    }
    const outputPattern = this.#workspace.framePattern(sourceIndex);
    const sampling =
      descriptor.kind === "rgb-video"
        ? `fps=fps=1000000/${String(this.#policy.frameIntervalMicroseconds)}:start_time=0:round=down,`
        : "";
    const filter = `${sampling}metadata=mode=delete,sidedata=mode=delete,scale=iw:ih:flags=lanczos:in_range=auto:out_range=full:in_color_matrix=auto:out_color_matrix=bt709,setsar=1,format=rgb24`;
    const arguments_ = [
      "-hide_banner",
      "-nostdin",
      "-v",
      "error",
      "-threads",
      "1",
      "-filter_threads",
      "1",
      "-fflags",
      "+bitexact",
      "-autorotate",
      "-i",
      sourcePath,
      "-map",
      "0:v:0",
      "-an",
      "-sn",
      "-dn",
      "-map_metadata",
      "-1",
      "-map_chapters",
      "-1",
      "-vf",
      filter,
      "-frames:v",
      String(maximumFrames),
      "-start_number",
      "0",
      "-fps_mode",
      "passthrough",
      "-c:v",
      "png",
      "-compression_level",
      "9",
      "-pred",
      "mixed",
      "-bitexact",
      "-y",
      outputPattern,
    ] as const;
    await this.#runWithDiskMonitor(
      "ffmpeg",
      arguments_,
      {
        maximumOutputBytes: this.#policy.maximumOutputBytes,
        timeoutMs: this.#policy.processTimeoutMilliseconds,
      },
      signal,
    );
    const frames = await this.#workspace.framePaths(sourceIndex);
    if (frames.length === 0) throw new MediaPreparationError("MALFORMED_MEDIA");
    if (frames.length > maximumFrames) throw new MediaPreparationError("FRAME_LIMIT_EXCEEDED");
    await this.#workspace.assertWithinQuota();
    return frames;
  }

  expectedFrameCount(descriptor: RGBMediaSource, probe: DecodedMediaProbe): number {
    if (descriptor.kind === "rgb-image") return 1;
    return Math.max(
      1,
      Math.min(
        this.#policy.maximumFramesPerSource,
        Math.ceil(probe.durationMicroseconds / this.#policy.frameIntervalMicroseconds),
      ),
    );
  }

  #validateBudgets(descriptor: RGBMediaSource, probe: DecodedMediaProbe): void {
    const pixels = probe.widthPixels * probe.heightPixels;
    if (!Number.isSafeInteger(pixels) || pixels > this.#policy.maximumFramePixels) {
      throw new MediaPreparationError("PIXEL_LIMIT_EXCEEDED");
    }
    if (
      descriptor.kind === "rgb-video" &&
      (probe.durationMicroseconds <= 0 ||
        probe.durationMicroseconds > this.#policy.maximumDecodedDurationMicroseconds)
    ) {
      throw new MediaPreparationError("DURATION_LIMIT_EXCEEDED");
    }
    if (
      descriptor.kind === "rgb-video" &&
      (probe.framesPerSecond <= 0 ||
        probe.framesPerSecond > this.#policy.maximumVideoFramesPerSecond)
    ) {
      throw new MediaPreparationError("FRAME_RATE_LIMIT_EXCEEDED");
    }
  }

  async #runWithDiskMonitor(
    executable: MediaExecutable,
    arguments_: readonly string[],
    limits: ProcessLimits,
    signal?: AbortSignal,
  ): Promise<ProcessResult> {
    const controller = new AbortController();
    const diskLimitReason = Object.freeze({ code: "disk-limit" });
    const abort = (): void => {
      controller.abort();
    };
    signal?.addEventListener("abort", abort, { once: true });
    const monitor = setInterval(() => {
      void this.#workspace.assertWithinQuota().catch(() => {
        controller.abort(diskLimitReason);
      });
    }, 25);
    monitor.unref();
    try {
      const result = await this.#run(executable, arguments_, limits, controller.signal);
      await this.#workspace.assertWithinQuota();
      return result;
    } catch (error) {
      if (controller.signal.reason === diskLimitReason) {
        throw new MediaPreparationError("DISK_LIMIT_EXCEEDED", { cause: error });
      }
      if (signal?.aborted === true) throw new MediaPreparationError("CANCELLED", { cause: error });
      throw error;
    } finally {
      clearInterval(monitor);
      signal?.removeEventListener("abort", abort);
    }
  }

  async #run(
    executable: MediaExecutable,
    arguments_: readonly string[],
    limits: ProcessLimits,
    signal?: AbortSignal,
  ): Promise<ProcessResult> {
    if (
      arguments_.some(
        (argument) =>
          argument.includes("\0") ||
          argument.includes("\n") ||
          /^https?:/iu.test(argument) ||
          /^file:/iu.test(argument),
      )
    ) {
      throw new MediaPreparationError("PROCESS_FAILED");
    }
    try {
      return await this.#process.run(executable, arguments_, limits, signal);
    } catch (error) {
      if (signal?.aborted === true) throw new MediaPreparationError("CANCELLED", { cause: error });
      if (error instanceof ProcessExecutionError) {
        if (error.reason === "timeout") {
          throw new MediaPreparationError("PROCESS_TIMEOUT", { cause: error, retryable: true });
        }
        if (error.reason === "output-limit") {
          throw new MediaPreparationError("PROCESS_OUTPUT_LIMIT", { cause: error });
        }
        if (error.reason === "aborted") {
          throw new MediaPreparationError("CANCELLED", { cause: error });
        }
      }
      throw new MediaPreparationError("PROCESS_FAILED", { cause: error, retryable: true });
    }
  }
}

function parseVersion(output: string, executable: MediaExecutable): string {
  const firstLine = output.split(/\r?\n/u)[0] ?? "";
  const match = new RegExp(`^${executable} version ([^ ]+)`, "u").exec(firstLine);
  if (match?.[1] === undefined) throw new MediaPreparationError("PROCESS_FAILED");
  return match[1].slice(0, 40);
}

function parseFiniteNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new MediaPreparationError("MALFORMED_MEDIA");
  return parsed;
}

function parseRate(value: string): number {
  const [numeratorText, denominatorText] = value.split("/");
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText ?? "1");
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    throw new MediaPreparationError("MALFORMED_MEDIA");
  }
  return numerator / denominator;
}

function normalizeRotation(value: number): 0 | 90 | 180 | 270 {
  if (!Number.isFinite(value)) throw new MediaPreparationError("MALFORMED_MEDIA");
  const normalized = ((Math.round(value) % 360) + 360) % 360;
  if (normalized === 0 || normalized === 90 || normalized === 180 || normalized === 270) {
    return normalized;
  }
  throw new MediaPreparationError("MALFORMED_MEDIA");
}

function validateDecodedType(descriptor: RGBMediaSource, probe: DecodedMediaProbe): void {
  const valid = (() => {
    switch (descriptor.detectedMimeType) {
      case "image/jpeg":
        return descriptor.kind === "rgb-image" && probe.codecName === "mjpeg";
      case "image/png":
        return descriptor.kind === "rgb-image" && probe.codecName === "png";
      case "image/heic":
        return (
          descriptor.kind === "rgb-image" && ["av1", "hevc", "mjpeg"].includes(probe.codecName)
        );
      case "video/mp4":
      case "video/quicktime":
        return (
          descriptor.kind === "rgb-video" &&
          probe.formatNames.some((name) =>
            ["3g2", "3gp", "m4a", "mj2", "mov", "mp4"].includes(name),
          )
        );
      default:
        return false;
    }
  })();
  if (!valid) throw new MediaPreparationError("DECODED_TYPE_MISMATCH");
}
