import {
  c7CapturePolicy,
  captureQualityManifestSchema,
  type CreateCapturePackageRequest,
} from "@interior-design/contracts";
import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";

import type { ObjectStorage } from "../storage.js";
import { canonicalJson } from "./canonical.js";
import { RoomPlanSourceError, type LeasedCaptureArtifact } from "./types.js";

const MAXIMUM_NORMALIZED_JSON_BYTES = 16 * 1_024 * 1_024;
const MAXIMUM_QUALITY_JSON_BYTES = 2 * 1_024 * 1_024;
const HEARTBEAT_PROGRESS_BYTES = 32 * 1_024 * 1_024;

export interface VerifiedCaptureSources {
  readonly normalizedArtifactId: string;
  readonly normalizedInput: unknown;
  readonly normalizedInputSha256: string;
}

function sameArtifactSet(
  artifacts: readonly LeasedCaptureArtifact[],
  manifest: CreateCapturePackageRequest,
): boolean {
  const expected = [...manifest.artifacts]
    .sort((left, right) => left.artifactId.localeCompare(right.artifactId))
    .map((artifact) => ({
      artifactId: artifact.artifactId,
      byteSize: artifact.byteSize,
      contentType: artifact.contentType,
      kind: artifact.kind,
      roomId: artifact.roomId,
      sha256: artifact.sha256,
    }));
  const actual = [...artifacts]
    .sort((left, right) => left.artifactId.localeCompare(right.artifactId))
    .map((artifact) => ({
      artifactId: artifact.artifactId,
      byteSize: artifact.byteSize,
      contentType: artifact.contentType,
      kind: artifact.kind,
      roomId: artifact.roomId,
      sha256: artifact.sha256,
    }));
  return canonicalJson(actual) === canonicalJson(expected);
}

function assertMediaPrefix(kind: LeasedCaptureArtifact["kind"], prefix: readonly number[]): void {
  if (kind === "structure-usdz") {
    if (
      prefix.length < 4 ||
      prefix[0] !== 0x50 ||
      prefix[1] !== 0x4b ||
      prefix[2] !== 0x03 ||
      prefix[3] !== 0x04
    ) {
      throw new RoomPlanSourceError("source-mismatch");
    }
    return;
  }
  const firstContent = prefix.find((byte) => ![0x09, 0x0a, 0x0d, 0x20].includes(byte));
  if (firstContent !== 0x7b) throw new RoomPlanSourceError("source-mismatch");
}

async function verifyArtifact(
  storage: ObjectStorage,
  artifact: LeasedCaptureArtifact,
  collectLimit: number | undefined,
  progress: () => Promise<void>,
  signal?: AbortSignal,
): Promise<{ readonly bytes?: Uint8Array; readonly sha256: string }> {
  let stream: AsyncIterable<Uint8Array>;
  try {
    stream = await storage.openSource("source", artifact.objectKey, signal);
  } catch (error) {
    throw new RoomPlanSourceError("storage-unavailable", true, { cause: error });
  }
  const hash = createHash("sha256");
  const chunks: Uint8Array[] = [];
  const prefix: number[] = [];
  let byteSize = 0;
  let bytesSinceHeartbeat = 0;
  try {
    for await (const chunk of stream) {
      if (signal?.aborted === true) throw signal.reason;
      byteSize += chunk.byteLength;
      bytesSinceHeartbeat += chunk.byteLength;
      if (byteSize > artifact.byteSize || byteSize > c7CapturePolicy.maximumArtifactBytes) {
        throw new RoomPlanSourceError("source-mismatch");
      }
      if (collectLimit !== undefined) {
        if (byteSize > collectLimit) throw new RoomPlanSourceError("resource-limit");
        chunks.push(chunk);
      }
      hash.update(chunk);
      for (const byte of chunk) {
        if (prefix.length >= 64) break;
        prefix.push(byte);
      }
      if (bytesSinceHeartbeat >= HEARTBEAT_PROGRESS_BYTES) {
        await progress();
        bytesSinceHeartbeat = 0;
      }
    }
  } catch (error) {
    if (error instanceof RoomPlanSourceError) throw error;
    throw new RoomPlanSourceError("storage-unavailable", true, { cause: error });
  }
  const actualSha256 = hash.digest("hex");
  if (byteSize !== artifact.byteSize || actualSha256 !== artifact.sha256) {
    throw new RoomPlanSourceError("source-mismatch");
  }
  assertMediaPrefix(artifact.kind, prefix);
  return {
    ...(collectLimit === undefined ? {} : { bytes: Buffer.concat(chunks) }),
    sha256: actualSha256,
  };
}

function parseStrictJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    throw new RoomPlanSourceError("source-mismatch", false, { cause: error });
  }
}

export async function verifyCaptureSources(
  storage: ObjectStorage,
  artifacts: readonly LeasedCaptureArtifact[],
  manifest: CreateCapturePackageRequest,
  progress: () => Promise<void>,
  signal?: AbortSignal,
): Promise<VerifiedCaptureSources> {
  if (
    artifacts.length < 3 ||
    artifacts.length > c7CapturePolicy.maximumArtifactCount ||
    !sameArtifactSet(artifacts, manifest)
  ) {
    throw new RoomPlanSourceError("source-mismatch");
  }
  const total = artifacts.reduce((sum, artifact) => sum + artifact.byteSize, 0);
  if (total > c7CapturePolicy.maximumPackageBytes) throw new RoomPlanSourceError("resource-limit");
  let normalized:
    { readonly artifactId: string; readonly input: unknown; readonly sha256: string } | undefined;
  let quality: unknown;
  for (const artifact of [...artifacts].sort((left, right) =>
    left.artifactId.localeCompare(right.artifactId),
  )) {
    const collectLimit =
      artifact.kind === "roomplan-normalized-json"
        ? MAXIMUM_NORMALIZED_JSON_BYTES
        : artifact.kind === "quality-manifest-json"
          ? MAXIMUM_QUALITY_JSON_BYTES
          : undefined;
    const verified = await verifyArtifact(storage, artifact, collectLimit, progress, signal);
    if (artifact.kind === "roomplan-normalized-json") {
      if (normalized !== undefined || verified.bytes === undefined) {
        throw new RoomPlanSourceError("source-mismatch");
      }
      normalized = {
        artifactId: artifact.artifactId,
        input: parseStrictJson(verified.bytes),
        sha256: verified.sha256,
      };
    }
    if (artifact.kind === "quality-manifest-json") {
      if (quality !== undefined || verified.bytes === undefined) {
        throw new RoomPlanSourceError("source-mismatch");
      }
      quality = parseStrictJson(verified.bytes);
    }
    await progress();
  }
  if (normalized === undefined || quality === undefined) {
    throw new RoomPlanSourceError("source-mismatch");
  }
  const parsedQuality = captureQualityManifestSchema.safeParse(quality);
  if (
    !parsedQuality.success ||
    canonicalJson(parsedQuality.data) !== canonicalJson(manifest.quality)
  ) {
    throw new RoomPlanSourceError("source-mismatch");
  }
  return {
    normalizedArtifactId: normalized.artifactId,
    normalizedInput: normalized.input,
    normalizedInputSha256: normalized.sha256,
  };
}
