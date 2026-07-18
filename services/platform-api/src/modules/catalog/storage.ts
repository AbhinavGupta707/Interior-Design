import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { sha256Bytes } from "@interior-design/catalog";
import type { CatalogArtifact } from "@interior-design/contracts";

import type { S3AssetStorageConfig } from "../../storage/config.js";
import type { CatalogArtifactStorage } from "./types.js";

const accessTtlSeconds = 300;

interface StorageCommandClient {
  send(command: object): Promise<unknown>;
}

type Presign = (command: object, expiresIn: number) => Promise<string>;

function safeStorageError(): Error {
  return new Error("The catalog artifact-storage operation failed.");
}

function validateObjectIdentity(artifact: CatalogArtifact): void {
  if (
    !artifact.objectKey.endsWith(`/${artifact.sha256}`) ||
    !/^catalog\/sha256\/[a-f0-9]{2}\/[a-f0-9]{64}$/u.test(artifact.objectKey)
  ) {
    throw safeStorageError();
  }
}

function ttl(now: Date, expiresAt: Date): number {
  const seconds = Math.ceil((expiresAt.getTime() - now.getTime()) / 1_000);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > accessTtlSeconds) {
    throw safeStorageError();
  }
  return seconds;
}

export class S3CatalogArtifactStorage implements CatalogArtifactStorage {
  readonly #client: StorageCommandClient;
  readonly #now: () => Date;
  readonly #presign: Presign;

  constructor(
    config: S3AssetStorageConfig,
    options: {
      readonly client?: StorageCommandClient;
      readonly now?: () => Date;
      readonly presign?: Presign;
    } = {},
  ) {
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
      (async (command, expiresIn) =>
        getSignedUrl(client as S3Client, command as GetObjectCommand, { expiresIn }));
  }

  async available(artifact: CatalogArtifact): Promise<boolean> {
    validateObjectIdentity(artifact);
    try {
      const head = (await this.#client.send(
        new HeadObjectCommand({ Bucket: "derived", Key: artifact.objectKey }),
      )) as {
        readonly ContentLength?: unknown;
        readonly ContentType?: unknown;
        readonly Metadata?: Readonly<Record<string, string | undefined>>;
      };
      return (
        head.ContentLength === artifact.byteLength &&
        head.ContentType === artifact.mediaType &&
        head.Metadata?.sha256 === artifact.sha256
      );
    } catch {
      return false;
    }
  }

  async signAccess(input: {
    readonly artifact: CatalogArtifact;
    readonly expiresAt: Date;
  }): Promise<{ readonly expiresAt: string; readonly url: string }> {
    validateObjectIdentity(input.artifact);
    const expiresIn = ttl(this.#now(), input.expiresAt);
    try {
      const command = new GetObjectCommand({
        Bucket: "derived",
        Key: input.artifact.objectKey,
        ResponseContentDisposition: "inline",
        ResponseContentType: input.artifact.mediaType,
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

export class InMemoryCatalogArtifactStorage implements CatalogArtifactStorage {
  readonly #baseUrl: string;
  readonly #now: () => Date;
  readonly #objects = new Map<string, Uint8Array>();

  constructor(options: { readonly baseUrl?: string; readonly now?: () => Date } = {}) {
    this.#baseUrl = options.baseUrl ?? "http://127.0.0.1:43110";
    this.#now = options.now ?? (() => new Date());
    const parsed = new URL(this.#baseUrl);
    if (
      parsed.protocol !== "http:" ||
      !["127.0.0.1", "::1", "localhost"].includes(parsed.hostname) ||
      parsed.username.length > 0 ||
      parsed.password.length > 0
    ) {
      throw safeStorageError();
    }
  }

  putForTest(artifact: CatalogArtifact, bytes: Uint8Array): void {
    validateObjectIdentity(artifact);
    if (bytes.byteLength !== artifact.byteLength || sha256Bytes(bytes) !== artifact.sha256) {
      throw safeStorageError();
    }
    this.#objects.set(artifact.sha256, Uint8Array.from(bytes));
  }

  available(artifact: CatalogArtifact): Promise<boolean> {
    const bytes = this.#objects.get(artifact.sha256);
    return Promise.resolve(
      bytes !== undefined &&
        bytes.byteLength === artifact.byteLength &&
        sha256Bytes(bytes) === artifact.sha256,
    );
  }

  signAccess(input: {
    readonly artifact: CatalogArtifact;
    readonly expiresAt: Date;
  }): Promise<{ readonly expiresAt: string; readonly url: string }> {
    validateObjectIdentity(input.artifact);
    if (!this.#objects.has(input.artifact.sha256)) return Promise.reject(safeStorageError());
    ttl(this.#now(), input.expiresAt);
    return Promise.resolve({
      expiresAt: input.expiresAt.toISOString(),
      url: `${this.#baseUrl.replace(/\/$/u, "")}/catalog-artifacts/${input.artifact.artifactId}`,
    });
  }
}

export { accessTtlSeconds as catalogArtifactAccessTtlSeconds };
