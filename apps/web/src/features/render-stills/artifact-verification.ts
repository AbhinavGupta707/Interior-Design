import type { RenderArtifact } from "@interior-design/contracts";
import { inspectExrHeader, inspectPngHeader } from "@interior-design/render-evaluation/browser";

import type { RenderArtifactAccess } from "./contracts";

const maximumPreviewBytes = 64 * 1024 * 1024;

export type ArtifactVerificationFailure =
  "decode" | "expired" | "network" | "resource-limit" | "tampered" | "unsafe-url";

export class ArtifactVerificationError extends Error {
  constructor(
    readonly kind: ArtifactVerificationFailure,
    message: string,
  ) {
    super(message);
    this.name = "ArtifactVerificationError";
  }
}

export function safeArtifactUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ArtifactVerificationError("unsafe-url", "Artifact access URL is malformed.");
  }
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
  ) {
    throw new ArtifactVerificationError(
      "unsafe-url",
      "Artifact access requires HTTPS, except for explicit loopback development.",
    );
  }
  return url;
}

export function verifyArtifactAccess(
  access: RenderArtifactAccess,
  artifact: RenderArtifact,
  manifestSha256: string,
  now = Date.now(),
): URL {
  if (Date.parse(access.expiresAt) <= now) {
    throw new ArtifactVerificationError(
      "expired",
      "Artifact access expired before use. Request a fresh access grant.",
    );
  }
  if (
    access.artifactId !== artifact.id ||
    access.byteLength !== artifact.byteLength ||
    access.mediaType !== artifact.mediaType ||
    access.role !== artifact.role ||
    access.sha256 !== artifact.sha256 ||
    access.manifestSha256 !== manifestSha256
  ) {
    throw new ArtifactVerificationError(
      "tampered",
      "Fresh artifact access does not match the immutable result manifest.",
    );
  }
  return safeArtifactUrl(access.url);
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function boundedResponseBytes(
  response: Response,
  expectedBytes: number,
): Promise<Uint8Array> {
  if (expectedBytes > maximumPreviewBytes) {
    throw new ArtifactVerificationError(
      "resource-limit",
      "This artifact exceeds the bounded in-browser preview verification budget.",
    );
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared !== expectedBytes) {
    throw new ArtifactVerificationError(
      "tampered",
      "Downloaded Content-Length does not match the immutable artifact declaration.",
    );
  }
  if (!response.body) throw new ArtifactVerificationError("network", "Artifact body is missing.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > expectedBytes || total > maximumPreviewBytes) {
        await reader.cancel();
        throw new ArtifactVerificationError(
          "resource-limit",
          "Artifact stream exceeded its declared or bounded byte budget.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total !== expectedBytes) {
    throw new ArtifactVerificationError(
      "tampered",
      "Downloaded bytes do not match the immutable artifact byte length.",
    );
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export interface VerifiedArtifactBytes {
  readonly bytes: Uint8Array;
  readonly format: "exr" | "png";
  readonly heightPx: number;
  readonly widthPx: number;
}

export async function fetchVerifiedArtifact(
  access: RenderArtifactAccess,
  artifact: RenderArtifact,
  manifestSha256: string,
  transport: typeof fetch = fetch,
): Promise<VerifiedArtifactBytes> {
  const url = verifyArtifactAccess(access, artifact, manifestSha256);
  let response: Response;
  try {
    response = await transport(url, { cache: "no-store", credentials: "omit", redirect: "error" });
  } catch (reason) {
    if (reason instanceof ArtifactVerificationError) throw reason;
    throw new ArtifactVerificationError(
      "network",
      "Fresh artifact bytes could not be reached. Request new access and retry.",
    );
  }
  if (!response.ok) {
    throw new ArtifactVerificationError(
      response.status === 401 || response.status === 403 || response.status === 410
        ? "expired"
        : "network",
      "Fresh artifact access was rejected or expired.",
    );
  }
  const responseType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (responseType !== artifact.mediaType) {
    throw new ArtifactVerificationError(
      "tampered",
      "Downloaded Content-Type does not match the immutable artifact role.",
    );
  }
  const bytes = await boundedResponseBytes(response, artifact.byteLength);
  const digestInput = Uint8Array.from(bytes).buffer;
  const digest = toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", digestInput)));
  if (digest !== artifact.sha256) {
    throw new ArtifactVerificationError(
      "tampered",
      "Downloaded bytes failed immutable SHA-256 verification.",
    );
  }
  try {
    const metadata = artifact.role.endsWith("-png")
      ? inspectPngHeader(bytes)
      : inspectExrHeader(bytes);
    if (metadata.widthPx !== artifact.widthPx || metadata.heightPx !== artifact.heightPx) {
      throw new ArtifactVerificationError(
        "tampered",
        "Downloaded dimensions do not match the immutable artifact declaration.",
      );
    }
    return {
      bytes,
      format: artifact.role.endsWith("-png") ? "png" : "exr",
      heightPx: metadata.heightPx,
      widthPx: metadata.widthPx,
    };
  } catch (reason) {
    if (reason instanceof ArtifactVerificationError) throw reason;
    throw new ArtifactVerificationError(
      "decode",
      "Artifact signature or bounded image metadata could not be decoded safely.",
    );
  }
}
