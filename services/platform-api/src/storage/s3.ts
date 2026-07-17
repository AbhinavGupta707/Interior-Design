import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { S3AssetStorageConfig } from "./config.js";
import type {
  AbortMultipartUploadInput,
  AssetObjectStorage,
  CompleteMultipartUploadInput,
  CreateMultipartUploadInput,
  SignObjectAccessInput,
  SignUploadPartInput,
  SignedObjectAccess,
  SignedUploadPart,
} from "./object-storage.js";

interface StorageCommandClient {
  send(command: object): Promise<unknown>;
}

type Presign = (command: object, expiresInSeconds: number) => Promise<string>;

export interface S3AssetObjectStorageOptions {
  readonly client?: StorageCommandClient;
  readonly now?: () => Date;
  readonly presign?: Presign;
}

function safeStorageError(): Error {
  return new Error("The object-storage operation failed.");
}

function isNamedError(error: unknown, name: string): boolean {
  return error instanceof Error && error.name === name;
}

function ttlSeconds(now: Date, expiresAt: Date, maximum: number): number {
  const seconds = Math.ceil((expiresAt.getTime() - now.getTime()) / 1_000);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > maximum) {
    throw new Error("The requested signed URL lifetime is outside the storage policy.");
  }
  return seconds;
}

export class S3AssetObjectStorage implements AssetObjectStorage {
  readonly #client: StorageCommandClient;
  readonly #now: () => Date;
  readonly #presign: Presign;

  constructor(config: S3AssetStorageConfig, options: S3AssetObjectStorageOptions = {}) {
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
          signableHeaders: new Set(["content-length"]),
          unhoistableHeaders: new Set(["x-amz-checksum-sha256", "x-amz-sdk-checksum-algorithm"]),
        }));
  }

  async createMultipartUpload(input: CreateMultipartUploadInput): Promise<string> {
    try {
      const response = (await this.#client.send(
        new CreateMultipartUploadCommand({
          Bucket: input.bucket,
          ChecksumAlgorithm: "SHA256",
          ContentType: input.contentType,
          Key: input.key,
        }),
      )) as { readonly UploadId?: unknown };
      if (typeof response.UploadId !== "string" || response.UploadId.length === 0) {
        throw safeStorageError();
      }
      return response.UploadId;
    } catch {
      throw safeStorageError();
    }
  }

  async signUploadPart(input: SignUploadPartInput): Promise<SignedUploadPart> {
    try {
      const expiresIn = ttlSeconds(this.#now(), input.expiresAt, 900);
      const command = new UploadPartCommand({
        Bucket: input.bucket,
        ChecksumAlgorithm: "SHA256",
        ChecksumSHA256: input.checksumSha256,
        ContentLength: input.byteSize,
        Key: input.key,
        PartNumber: input.partNumber,
        UploadId: input.providerUploadId,
      });
      return {
        expiresAt: input.expiresAt.toISOString(),
        requiredHeaders: {
          "content-length": String(input.byteSize),
          "x-amz-checksum-sha256": input.checksumSha256,
          "x-amz-sdk-checksum-algorithm": "SHA256",
        },
        url: await this.#presign(command, expiresIn),
      };
    } catch {
      throw safeStorageError();
    }
  }

  async completeMultipartUpload(input: CompleteMultipartUploadInput): Promise<void> {
    try {
      await this.#client.send(
        new CompleteMultipartUploadCommand({
          Bucket: input.bucket,
          Key: input.key,
          MultipartUpload: {
            Parts: input.parts.map((part) => ({
              ChecksumSHA256: part.checksumSha256,
              ETag: part.etag,
              PartNumber: part.partNumber,
            })),
          },
          UploadId: input.providerUploadId,
        }),
      );
    } catch (error: unknown) {
      if (!isNamedError(error, "NoSuchUpload")) {
        throw safeStorageError();
      }
      try {
        const head = (await this.#client.send(
          new HeadObjectCommand({ Bucket: input.bucket, Key: input.key }),
        )) as { readonly ContentLength?: unknown };
        if (head.ContentLength !== input.expectedByteSize) {
          throw safeStorageError();
        }
      } catch {
        throw safeStorageError();
      }
    }
  }

  async abortMultipartUpload(input: AbortMultipartUploadInput): Promise<void> {
    try {
      await this.#client.send(
        new AbortMultipartUploadCommand({
          Bucket: input.bucket,
          Key: input.key,
          UploadId: input.providerUploadId,
        }),
      );
    } catch (error: unknown) {
      if (!isNamedError(error, "NoSuchUpload")) {
        throw safeStorageError();
      }
    }
  }

  async signObjectAccess(input: SignObjectAccessInput): Promise<SignedObjectAccess> {
    try {
      const expiresIn = ttlSeconds(this.#now(), input.expiresAt, 300);
      const command = new GetObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        ResponseContentDisposition: input.contentDisposition,
        ResponseContentType: input.contentType,
      });
      return {
        expiresAt: input.expiresAt.toISOString(),
        url: await this.#presign(command, expiresIn),
      };
    } catch {
      throw safeStorageError();
    }
  }

  async readiness(): Promise<void> {
    try {
      await Promise.all(
        (["source", "derived", "quarantine"] as const).map(async (bucket) =>
          this.#client.send(new HeadBucketCommand({ Bucket: bucket })),
        ),
      );
    } catch {
      throw safeStorageError();
    }
  }
}
