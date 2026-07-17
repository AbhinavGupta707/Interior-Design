import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash } from "node:crypto";

import type { S3AssetStorageConfig } from "../../storage/config.js";

export interface PutSceneObjectInput {
  readonly byteSize: number;
  readonly bytes: Uint8Array;
  readonly glbSha256: string;
  readonly mimeType: "model/gltf-binary";
}

export interface SignSceneObjectInput {
  readonly expiresAt: Date;
  readonly glbSha256: string;
  readonly mimeType: "model/gltf-binary";
}

export interface SignedSceneObject {
  readonly expiresAt: string;
  readonly url: string;
}

/** Object identity is derived internally from the checksum; callers never supply or receive a key. */
export interface SceneObjectStorage {
  putImmutable(input: PutSceneObjectInput): Promise<void>;
  readiness(): Promise<void>;
  signAccess(input: SignSceneObjectInput): Promise<SignedSceneObject>;
}

interface StorageCommandClient {
  send(command: object): Promise<unknown>;
}

type Presign = (command: object, expiresInSeconds: number) => Promise<string>;

function safeStorageError(): Error {
  return new Error("The scene object-storage operation failed.");
}

function objectKey(sha256: string): string {
  if (!/^[a-f0-9]{64}$/u.test(sha256)) throw safeStorageError();
  return `scenes/sha256/${sha256.slice(0, 2)}/${sha256}.glb`;
}

function checksumBase64(sha256: string): string {
  return Buffer.from(sha256, "hex").toString("base64");
}

function ttlSeconds(now: Date, expiresAt: Date): number {
  const seconds = Math.ceil((expiresAt.getTime() - now.getTime()) / 1_000);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) throw safeStorageError();
  return seconds;
}

function isPreconditionFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    ["PreconditionFailed", "ConditionalRequestConflict"].includes(error.name)
  );
}

export interface S3SceneObjectStorageOptions {
  readonly client?: StorageCommandClient;
  readonly now?: () => Date;
  readonly presign?: Presign;
}

export class S3SceneObjectStorage implements SceneObjectStorage {
  readonly #client: StorageCommandClient;
  readonly #now: () => Date;
  readonly #presign: Presign;

  constructor(config: S3AssetStorageConfig, options: S3SceneObjectStorageOptions = {}) {
    const client =
      options.client ??
      new S3Client({
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
        endpoint: config.endpoint,
        forcePathStyle: config.forcePathStyle,
        region: config.region,
      });
    this.#client = client;
    this.#now = options.now ?? (() => new Date());
    this.#presign =
      options.presign ??
      (async (command, expiresInSeconds) =>
        getSignedUrl(client as S3Client, command as GetObjectCommand, {
          expiresIn: expiresInSeconds,
        }));
  }

  async putImmutable(input: PutSceneObjectInput): Promise<void> {
    const actual = createHash("sha256").update(input.bytes).digest("hex");
    if (
      actual !== input.glbSha256 ||
      input.byteSize !== input.bytes.byteLength ||
      input.byteSize < 1
    ) {
      throw safeStorageError();
    }
    const key = objectKey(input.glbSha256);
    try {
      await this.#client.send(
        new PutObjectCommand({
          Body: input.bytes,
          Bucket: "derived",
          ChecksumAlgorithm: "SHA256",
          ChecksumSHA256: checksumBase64(input.glbSha256),
          ContentLength: input.byteSize,
          ContentType: input.mimeType,
          IfNoneMatch: "*",
          Key: key,
          Metadata: { sha256: input.glbSha256 },
        }),
      );
      return;
    } catch (error: unknown) {
      if (!isPreconditionFailure(error)) throw safeStorageError();
    }
    try {
      const head = (await this.#client.send(
        new HeadObjectCommand({ Bucket: "derived", Key: key }),
      )) as {
        readonly ChecksumSHA256?: unknown;
        readonly ContentLength?: unknown;
        readonly ContentType?: unknown;
        readonly Metadata?: Readonly<Record<string, string | undefined>>;
      };
      const checksumMatches =
        head.ChecksumSHA256 === checksumBase64(input.glbSha256) ||
        head.Metadata?.sha256 === input.glbSha256;
      if (
        !checksumMatches ||
        head.ContentLength !== input.byteSize ||
        head.ContentType !== input.mimeType
      ) {
        throw safeStorageError();
      }
    } catch {
      throw safeStorageError();
    }
  }

  async readiness(): Promise<void> {
    try {
      await this.#client.send(new HeadBucketCommand({ Bucket: "derived" }));
    } catch {
      throw safeStorageError();
    }
  }

  async signAccess(input: SignSceneObjectInput): Promise<SignedSceneObject> {
    try {
      const expiresIn = ttlSeconds(this.#now(), input.expiresAt);
      const command = new GetObjectCommand({
        Bucket: "derived",
        Key: objectKey(input.glbSha256),
        ResponseContentDisposition: "inline",
        ResponseContentType: input.mimeType,
      });
      return {
        expiresAt: input.expiresAt.toISOString(),
        url: await this.#presign(command, expiresIn),
      };
    } catch {
      throw safeStorageError();
    }
  }
}

export class InMemorySceneObjectStorage implements SceneObjectStorage {
  readonly #baseUrl: string;
  readonly #now: () => Date;
  readonly #objects = new Map<string, Uint8Array>();

  constructor(options: { readonly baseUrl?: string; readonly now?: () => Date } = {}) {
    this.#baseUrl = options.baseUrl ?? "http://127.0.0.1:43110";
    this.#now = options.now ?? (() => new Date());
    const parsed = new URL(this.#baseUrl);
    if (
      parsed.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) ||
      parsed.username.length > 0 ||
      parsed.password.length > 0
    ) {
      throw new Error("The in-memory scene store requires a credential-free loopback base URL.");
    }
  }

  putImmutable(input: PutSceneObjectInput): Promise<void> {
    const actual = createHash("sha256").update(input.bytes).digest("hex");
    if (actual !== input.glbSha256 || input.bytes.byteLength !== input.byteSize) {
      return Promise.reject(safeStorageError());
    }
    const existing = this.#objects.get(input.glbSha256);
    if (existing !== undefined && !Buffer.from(existing).equals(Buffer.from(input.bytes))) {
      return Promise.reject(safeStorageError());
    }
    this.#objects.set(input.glbSha256, Uint8Array.from(input.bytes));
    return Promise.resolve();
  }

  readiness(): Promise<void> {
    return Promise.resolve();
  }

  signAccess(input: SignSceneObjectInput): Promise<SignedSceneObject> {
    if (!this.#objects.has(input.glbSha256)) return Promise.reject(safeStorageError());
    ttlSeconds(this.#now(), input.expiresAt);
    return Promise.resolve({
      expiresAt: input.expiresAt.toISOString(),
      url: `${this.#baseUrl.replace(/\/$/u, "")}/scene-artifacts/${input.glbSha256}`,
    });
  }

  readForTest(glbSha256: string): Uint8Array | undefined {
    const bytes = this.#objects.get(glbSha256);
    return bytes === undefined ? undefined : Uint8Array.from(bytes);
  }
}
