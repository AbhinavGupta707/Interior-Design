import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import type { S3AssetStorageConfig } from "../../storage/config.js";
import { renderUnavailable } from "./errors.js";
import type { PutRenderObjectInput, RenderObjectStorage } from "./types.js";

interface StorageCommandClient {
  send(command: object): Promise<unknown>;
}

const grantAad = Buffer.from("interior-design:c14:render-artifact-access:v1", "utf8");

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

interface EncryptedRenderAccessGrant {
  readonly artifactId: string;
  readonly byteLength: number;
  readonly expiresAt: string;
  readonly manifestSha256: string;
  readonly mediaType: string;
  readonly objectKey: string;
  readonly resultId: string;
  readonly role: string;
  readonly sha256: string;
}

export interface RenderArtifactBroker {
  open(token: string): Promise<
    | { readonly bytes: Uint8Array; readonly mediaType: "application/json" | "image/png" | "image/x-exr" }
    | undefined
  >;
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

function validGrant(input: EncryptedRenderAccessGrant): boolean {
  return (
    /^[0-9a-f-]{36}$/iu.test(input.artifactId) &&
    Number.isSafeInteger(input.byteLength) &&
    input.byteLength > 0 &&
    /^[a-f0-9]{64}$/u.test(input.manifestSha256) &&
    ["application/json", "image/png", "image/x-exr"].includes(input.mediaType) &&
    /^render-stills\/sha256\/[a-f0-9]{2}\/[a-f0-9]{64}\.(?:exr|json|png)$/u.test(input.objectKey) &&
    /^[0-9a-f-]{36}$/iu.test(input.resultId) &&
    [
      "depth-exr",
      "geometry-safe-png",
      "multilayer-exr",
      "normal-exr",
      "segmentation-png",
    ].includes(input.role) &&
    /^[a-f0-9]{64}$/u.test(input.sha256) &&
    input.expiresAt.length > 0
  );
}

function tokenParts(token: string): readonly [Buffer, Buffer, Buffer] | undefined {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]{8,4096}$/u.test(part))) {
    return undefined;
  }
  try {
    const decoded = parts.map((part) => Buffer.from(part, "base64url"));
    const [iv, ciphertext, tag] = decoded;
    if (iv?.byteLength !== 12 || ciphertext === undefined || ciphertext.byteLength < 1 || tag?.byteLength !== 16) {
      return undefined;
    }
    return [iv, ciphertext, tag];
  } catch {
    return undefined;
  }
}

/**
 * Issues encrypted, short-lived, artifact-exact grants and serves their bytes
 * through the API. The S3 key remains encrypted inside the bearer token and is
 * never sent to the browser or written to API logs.
 */
export class EncryptedRenderArtifactBroker implements OpaqueRenderAccessSigner, RenderArtifactBroker {
  readonly #baseUrl: URL;
  readonly #client: StorageCommandClient;
  readonly #key: Buffer;
  readonly #now: () => Date;

  constructor(options: {
    readonly baseUrl: string;
    readonly client: StorageCommandClient;
    readonly key: Uint8Array;
    readonly now?: () => Date;
  }) {
    const baseUrl = new URL(options.baseUrl);
    if (
      baseUrl.username ||
      baseUrl.password ||
      baseUrl.search ||
      baseUrl.hash ||
      !["http:", "https:"].includes(baseUrl.protocol) ||
      options.key.byteLength !== 32
    ) {
      storageFailure();
    }
    this.#baseUrl = baseUrl;
    this.#client = options.client;
    this.#key = Buffer.from(options.key);
    this.#now = options.now ?? (() => new Date());
  }

  sign(input: Parameters<OpaqueRenderAccessSigner["sign"]>[0]) {
    const expiresAt = input.expiresAt.toISOString();
    const grant: EncryptedRenderAccessGrant = { ...input, expiresAt };
    if (!validGrant(grant)) storageFailure();
    const ttl = Math.ceil((input.expiresAt.getTime() - this.#now().getTime()) / 1_000);
    if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 300) storageFailure();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
    cipher.setAAD(grantAad);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(grant), "utf8"), cipher.final()]);
    const token = `${iv.toString("base64url")}.${ciphertext.toString("base64url")}.${cipher
      .getAuthTag()
      .toString("base64url")}`;
    const url = new URL(`/v1/render-artifact-access/${token}`, this.#baseUrl).toString();
    return Promise.resolve({ expiresAt, url });
  }

  async open(token: string): Promise<
    | { readonly bytes: Uint8Array; readonly mediaType: "application/json" | "image/png" | "image/x-exr" }
    | undefined
  > {
    const parts = tokenParts(token);
    if (parts === undefined) return undefined;
    let grant: EncryptedRenderAccessGrant;
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.#key, parts[0]);
      decipher.setAAD(grantAad);
      decipher.setAuthTag(parts[2]);
      grant = JSON.parse(
        Buffer.concat([decipher.update(parts[1]), decipher.final()]).toString("utf8"),
      ) as EncryptedRenderAccessGrant;
    } catch {
      return undefined;
    }
    const expiresAt = new Date(grant.expiresAt);
    if (!validGrant(grant) || !Number.isFinite(expiresAt.getTime()) || expiresAt <= this.#now()) {
      return undefined;
    }
    let response: {
      readonly Body?: AsyncIterable<Uint8Array>;
      readonly ContentLength?: unknown;
      readonly ContentType?: unknown;
      readonly Metadata?: Readonly<Record<string, string | undefined>>;
    };
    try {
      response = (await this.#client.send(
        new GetObjectCommand({ Bucket: "derived", Key: grant.objectKey }),
      )) as typeof response;
    } catch {
      return undefined;
    }
    if (
      response.Body === undefined ||
      response.ContentLength !== grant.byteLength ||
      response.ContentType !== grant.mediaType ||
      response.Metadata?.sha256 !== grant.sha256
    ) {
      return undefined;
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for await (const chunk of response.Body) {
        if (!(chunk instanceof Uint8Array) || chunk.byteLength < 1) return undefined;
        total += chunk.byteLength;
        if (total > grant.byteLength) return undefined;
        chunks.push(Uint8Array.from(chunk));
      }
    } catch {
      return undefined;
    }
    const bytes = Buffer.concat(chunks, total);
    if (total !== grant.byteLength || createHash("sha256").update(bytes).digest("hex") !== grant.sha256) {
      return undefined;
    }
    return { bytes, mediaType: grant.mediaType as "application/json" | "image/png" | "image/x-exr" };
  }
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
