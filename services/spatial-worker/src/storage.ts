import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { createReadStream } from "node:fs";

import type { WorkerConfig } from "./config.js";
import { RetryableWorkerError } from "./errors.js";

function requestOptions(signal?: AbortSignal): { readonly abortSignal?: AbortSignal } {
  return signal === undefined ? {} : { abortSignal: signal };
}

export interface DerivedWrite {
  readonly bucket: "derived" | "quarantine";
  readonly byteSize: number;
  readonly contentType: string;
  readonly filePath: string;
  readonly key: string;
  readonly sha256: string;
}

export interface ObjectStorage {
  openSource(
    bucket: "source",
    key: string,
    signal?: AbortSignal,
  ): Promise<AsyncIterable<Uint8Array>>;
  putDerivedIfAbsent(write: DerivedWrite, signal?: AbortSignal): Promise<"created" | "existing">;
}

function isPreconditionFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as {
    readonly $metadata?: { readonly httpStatusCode?: number };
    readonly name?: string;
  };
  return candidate.name === "PreconditionFailed" || candidate.$metadata?.httpStatusCode === 412;
}

export function createS3Client(config: WorkerConfig): S3Client {
  const clientConfig: S3ClientConfig = {
    credentials: {
      accessKeyId: config.s3.accessKeyId,
      secretAccessKey: config.s3.secretAccessKey,
    },
    endpoint: config.s3.endpoint,
    forcePathStyle: config.s3.forcePathStyle,
    maxAttempts: 3,
    region: config.s3.region,
  };
  return new S3Client(clientConfig);
}

export class S3ObjectStorage implements ObjectStorage {
  readonly #client: S3Client;

  constructor(client: S3Client) {
    this.#client = client;
  }

  async openSource(
    bucket: "source",
    key: string,
    signal?: AbortSignal,
  ): Promise<AsyncIterable<Uint8Array>> {
    try {
      const response = await this.#client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        requestOptions(signal),
      );
      if (response.Body === undefined) {
        throw new Error("Source object returned no body.");
      }
      return response.Body as AsyncIterable<Uint8Array>;
    } catch (error) {
      throw new RetryableWorkerError("source-read-unavailable", error);
    }
  }

  async putDerivedIfAbsent(
    write: DerivedWrite,
    signal?: AbortSignal,
  ): Promise<"created" | "existing"> {
    try {
      await this.#client.send(
        new PutObjectCommand({
          Body: createReadStream(write.filePath),
          Bucket: write.bucket,
          ContentLength: write.byteSize,
          ContentType: write.contentType,
          IfNoneMatch: "*",
          Key: write.key,
          Metadata: { sha256: write.sha256 },
        }),
        requestOptions(signal),
      );
      return "created";
    } catch (error) {
      if (!isPreconditionFailure(error)) {
        throw new RetryableWorkerError("derived-write-unavailable", error);
      }
      try {
        const existing = await this.#client.send(
          new HeadObjectCommand({ Bucket: write.bucket, Key: write.key }),
          requestOptions(signal),
        );
        if (
          existing.ContentLength !== write.byteSize ||
          existing.Metadata?.sha256 !== write.sha256
        ) {
          throw new Error("Content-addressed object metadata does not match.", { cause: error });
        }
        return "existing";
      } catch (headError) {
        throw new RetryableWorkerError("derived-conflict-unverifiable", headError);
      }
    }
  }
}
