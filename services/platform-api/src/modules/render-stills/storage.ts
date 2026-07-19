import {
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createHash, randomBytes } from "node:crypto";

import type { S3AssetStorageConfig } from "../../storage/config.js";
import { renderUnavailable } from "./errors.js";
import type { PutRenderObjectInput, RenderObjectStorage } from "./types.js";

interface StorageCommandClient {
  send(command: object): Promise<unknown>;
}

export interface OpaqueRenderAccessSigner {
  sign(input: {
    readonly artifactId: string;
    readonly byteLength: number;
    readonly expiresAt: Date;
    readonly manifestSha256: string;
    readonly mediaType: string;
    readonly objectKey: string;
    readonly resultId: string;
    readonly role: string;
    readonly sha256: string;
  }): Promise<{ readonly expiresAt: string; readonly url: string }>;
}

function storageFailure(): never {
  throw renderUnavailable(
    "RENDER_STORAGE_UNAVAILABLE",
    "The immutable render object store is unavailable.",
  );
}

function extension(mediaType: PutRenderObjectInput["mediaType"]): string {
  if (mediaType === "image/png") return "png";
  if (mediaType === "image/x-exr") return "exr";
  return "json";
}

export function renderObjectKey(
  sha256: string,
  mediaType: PutRenderObjectInput["mediaType"],
): string {
  if (!/^[a-f0-9]{64}$/u.test(sha256)) storageFailure();
  return `render-stills/sha256/${sha256.slice(0, 2)}/${sha256}.${extension(mediaType)}`;
}

function checksumBase64(sha256: string): string {
  return Buffer.from(sha256, "hex").toString("base64");
}

function assertExactBytes(input: PutRenderObjectInput): void {
  const actual = createHash("sha256").update(input.bytes).digest("hex");
  if (actual !== input.sha256 || input.bytes.byteLength < 1) storageFailure();
}

function isPreconditionFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    ["ConditionalRequestConflict", "PreconditionFailed"].includes(error.name)
  );
}

export class S3RenderObjectStorage implements RenderObjectStorage {
  readonly #client: StorageCommandClient;
  readonly #signer: OpaqueRenderAccessSigner;

  constructor(
    config: S3AssetStorageConfig,
    signer: OpaqueRenderAccessSigner,
    options: { readonly client?: StorageCommandClient } = {},
  ) {
    this.#client =
      options.client ??
      new S3Client({
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        endpoint: config.endpoint,
        forcePathStyle: config.forcePathStyle,
        region: config.region,
      });
    this.#signer = signer;
  }

  async putImmutable(input: PutRenderObjectInput): Promise<{ readonly objectKey: string }> {
    assertExactBytes(input);
    const objectKey = renderObjectKey(input.sha256, input.mediaType);
    try {
      await this.#client.send(
        new PutObjectCommand({
          Body: input.bytes,
          Bucket: "derived",
          ChecksumSHA256: checksumBase64(input.sha256),
          ContentLength: input.bytes.byteLength,
          ContentType: input.mediaType,
          IfNoneMatch: "*",
          Key: objectKey,
          Metadata: { sha256: input.sha256 },
        }),
      );
    } catch (error) {
      if (!isPreconditionFailure(error)) storageFailure();
      const head = (await this.#client.send(
        new HeadObjectCommand({ Bucket: "derived", Key: objectKey }),
      )) as {
        readonly ContentLength?: number;
        readonly ContentType?: string;
        readonly Metadata?: Record<string, string>;
      };
      if (
        head.ContentLength !== input.bytes.byteLength ||
        head.ContentType !== input.mediaType ||
        head.Metadata?.sha256 !== input.sha256
      ) {
        storageFailure();
      }
    }
    return { objectKey };
  }

  async readiness(): Promise<void> {
    try {
      await this.#client.send(new HeadBucketCommand({ Bucket: "derived" }));
    } catch {
      storageFailure();
    }
  }

  signExactAccess(input: Parameters<RenderObjectStorage["signExactAccess"]>[0]) {
    return this.#signer.sign({
      artifactId: input.artifact.id,
      byteLength: input.artifact.byteLength,
      expiresAt: input.expiresAt,
      manifestSha256: input.manifestSha256,
      mediaType: input.artifact.mediaType,
      objectKey: input.objectKey,
      resultId: input.resultId,
      role: input.artifact.role,
      sha256: input.artifact.sha256,
    });
  }
}

export class InMemoryRenderObjectStorage implements RenderObjectStorage, OpaqueRenderAccessSigner {
  readonly #baseUrl: string;
  readonly #now: () => Date;
  readonly #objects = new Map<string, Uint8Array>();
  readonly #tokens = new Map<
    string,
    { readonly objectKey: string; readonly claimsSha256: string }
  >();

  constructor(options: { readonly baseUrl?: string; readonly now?: () => Date } = {}) {
    this.#baseUrl = options.baseUrl ?? "http://127.0.0.1:43110";
    this.#now = options.now ?? (() => new Date());
    const url = new URL(this.#baseUrl);
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "::1", "localhost"].includes(url.hostname) ||
      url.username ||
      url.password
    ) {
      throw new Error("The fixture render store requires a credential-free loopback URL.");
    }
  }

  putImmutable(input: PutRenderObjectInput): Promise<{ readonly objectKey: string }> {
    return Promise.resolve().then(() => {
      assertExactBytes(input);
      const objectKey = renderObjectKey(input.sha256, input.mediaType);
      const existing = this.#objects.get(objectKey);
      if (existing !== undefined && !Buffer.from(existing).equals(Buffer.from(input.bytes)))
        storageFailure();
      this.#objects.set(objectKey, Uint8Array.from(input.bytes));
      return { objectKey };
    });
  }

  readiness(): Promise<void> {
    return Promise.resolve();
  }

  signExactAccess(input: Parameters<RenderObjectStorage["signExactAccess"]>[0]) {
    return this.sign({
      artifactId: input.artifact.id,
      byteLength: input.artifact.byteLength,
      expiresAt: input.expiresAt,
      manifestSha256: input.manifestSha256,
      mediaType: input.artifact.mediaType,
      objectKey: input.objectKey,
      resultId: input.resultId,
      role: input.artifact.role,
      sha256: input.artifact.sha256,
    });
  }

  sign(input: Parameters<OpaqueRenderAccessSigner["sign"]>[0]) {
    const ttl = Math.ceil((input.expiresAt.getTime() - this.#now().getTime()) / 1_000);
    if (ttl < 1 || ttl > 300 || !this.#objects.has(input.objectKey)) storageFailure();
    const claimsSha256 = createHash("sha256")
      .update(
        JSON.stringify({
          ...input,
          expiresAt: input.expiresAt.toISOString(),
          objectKey: undefined,
        }),
      )
      .digest("hex");
    const token = randomBytes(24).toString("base64url");
    this.#tokens.set(token, { claimsSha256, objectKey: input.objectKey });
    return Promise.resolve({
      expiresAt: input.expiresAt.toISOString(),
      url: `${this.#baseUrl.replace(/\/$/u, "")}/render-artifact-access/${token}`,
    });
  }

  readForTest(objectKey: string): Uint8Array | undefined {
    const bytes = this.#objects.get(objectKey);
    return bytes === undefined ? undefined : Uint8Array.from(bytes);
  }
}
