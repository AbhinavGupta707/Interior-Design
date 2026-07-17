import type { AssetProcessingCommand } from "@interior-design/contracts";
import { fileTypeFromFile } from "file-type";
import { open } from "node:fs/promises";

import type { WorkerConfig } from "./config.js";
import { MediaRejection } from "./errors.js";
import { ProcessExecutionError, runBoundedProcess } from "./subprocess.js";

const declaredMimeTypes = new Set([
  "application/pdf",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "video/mp4",
  "video/quicktime",
]);

const mimeKinds: Readonly<Record<AssetProcessingCommand["expected"]["kind"], ReadonlySet<string>>> =
  {
    document: new Set(["application/pdf"]),
    photograph: new Set(["image/heic", "image/heif", "image/jpeg", "image/png"]),
    plan: new Set([
      "application/pdf",
      "image/heic",
      "image/heif",
      "image/jpeg",
      "image/png",
      "image/svg+xml",
    ]),
    video: new Set(["video/mp4", "video/quicktime"]),
  };

function normalizeDetectedMime(mime: string): string {
  if (mime === "application/x-pdf") return "application/pdf";
  if (mime === "image/x-png") return "image/png";
  if (mime === "image/jpg") return "image/jpeg";
  return mime;
}

async function looksLikeSvg(filePath: string): Promise<boolean> {
  const handle = await open(filePath, "r");
  let prefix: Buffer;
  let bytesRead: number;
  try {
    prefix = Buffer.alloc(65_536);
    ({ bytesRead } = await handle.read(prefix, 0, prefix.byteLength, 0));
  } finally {
    await handle.close();
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(prefix.subarray(0, bytesRead));
  } catch {
    return false;
  }
  return /^\s*(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/iu.test(text);
}

export interface DetectionResult {
  readonly detectedMimeType: string;
  readonly fileUtilityVersion: string;
  readonly fileUtilityMimeType: string;
  readonly signatureMimeType: string;
}

export async function detectAndValidateMime(
  command: AssetProcessingCommand,
  filePath: string,
  config: WorkerConfig,
  signal?: AbortSignal,
): Promise<DetectionResult> {
  let fileUtilityMimeType: string;
  let fileUtilityVersion: string;
  try {
    const [result, version] = await Promise.all([
      runBoundedProcess(
        config.executables.file,
        ["--brief", "--mime-type", "--", filePath],
        config.subprocess,
        signal,
      ),
      runBoundedProcess(config.executables.file, ["--version"], config.subprocess, signal),
    ]);
    fileUtilityMimeType = normalizeDetectedMime(result.stdout.trim());
    fileUtilityVersion = version.stdout.split("\n")[0]?.trim().slice(0, 100) || "unknown";
  } catch (error) {
    if (error instanceof ProcessExecutionError && error.reason === "timeout") {
      throw new MediaRejection("resource-limit");
    }
    throw new MediaRejection("unsupported-type");
  }

  const detected = await fileTypeFromFile(filePath);
  let signatureMimeType = detected === undefined ? "" : normalizeDetectedMime(detected.mime);
  if (signatureMimeType.length === 0 && (await looksLikeSvg(filePath))) {
    signatureMimeType = "image/svg+xml";
  }
  if (signatureMimeType.length === 0 || !declaredMimeTypes.has(signatureMimeType)) {
    throw new MediaRejection("signature-mismatch");
  }

  const fileUtilityCompatible =
    fileUtilityMimeType === signatureMimeType ||
    (signatureMimeType === "image/svg+xml" &&
      ["application/xml", "image/svg+xml", "text/plain", "text/xml"].includes(
        fileUtilityMimeType,
      )) ||
    (["video/mp4", "video/quicktime"].includes(signatureMimeType) &&
      ["video/mp4", "video/quicktime"].includes(fileUtilityMimeType));
  if (!fileUtilityCompatible) {
    throw new MediaRejection("signature-mismatch", { detectedMimeType: signatureMimeType });
  }
  if (!mimeKinds[command.expected.kind].has(command.expected.declaredMimeType)) {
    throw new MediaRejection("signature-mismatch", { detectedMimeType: signatureMimeType });
  }
  const videoFamilyMatch =
    ["video/mp4", "video/quicktime"].includes(signatureMimeType) &&
    ["video/mp4", "video/quicktime"].includes(command.expected.declaredMimeType);
  if (signatureMimeType !== command.expected.declaredMimeType && !videoFamilyMatch) {
    throw new MediaRejection("signature-mismatch", { detectedMimeType: signatureMimeType });
  }
  if (signatureMimeType === "image/heic" || signatureMimeType === "image/heif") {
    throw new MediaRejection("unsupported-type", { detectedMimeType: signatureMimeType });
  }
  return {
    detectedMimeType: signatureMimeType,
    fileUtilityVersion,
    fileUtilityMimeType,
    signatureMimeType,
  };
}
