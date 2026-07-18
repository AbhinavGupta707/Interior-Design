import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  CatalogError,
  catalogCanonicalBytes,
  sha256Bytes,
  type CatalogPublishedRelease,
} from "@interior-design/catalog";
import type { CatalogRelease } from "@interior-design/contracts";

import {
  validateCatalogPublication,
  type CatalogPublicationStore,
  type PutCatalogObjectInput,
} from "./publication.js";

export interface CatalogS3CommandClient {
  send(command: object): Promise<unknown>;
}

interface ExpectedObject {
  readonly byteLength: number;
  readonly key: string;
  readonly mediaType: PutCatalogObjectInput["mediaType"];
  readonly metadata: Readonly<Record<string, string>>;
  readonly sha256: string;
}

function conflict(error?: unknown): CatalogError {
  return new CatalogError("CATALOG_RELEASE_CONFLICT", { cause: error });
}

function statusCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("$metadata" in error)) return undefined;
  const metadata = error.$metadata;
  if (typeof metadata !== "object" || metadata === null || !("httpStatusCode" in metadata)) {
    return undefined;
  }
  return typeof metadata.httpStatusCode === "number" ? metadata.httpStatusCode : undefined;
}

function isNotFound(error: unknown): boolean {
  return (
    statusCode(error) === 404 ||
    (error instanceof Error && ["NoSuchKey", "NotFound"].includes(error.name))
  );
}

function isPreconditionFailed(error: unknown): boolean {
  return (
    statusCode(error) === 412 || (error instanceof Error && error.name === "PreconditionFailed")
  );
}

function objectKey(sha256: string): string {
  return `catalog/sha256/${sha256.slice(0, 2)}/${sha256}`;
}

function checksumSha256(sha256: string): string {
  return Buffer.from(sha256, "hex").toString("base64");
}

function headKey(version: string): string {
  return `catalog/releases/${version}/head.json`;
}

export class S3CatalogPublicationStore implements CatalogPublicationStore {
  readonly #bucket = "derived";
  readonly #client: CatalogS3CommandClient;

  constructor(client: CatalogS3CommandClient) {
    this.#client = client;
  }

  async #matches(expected: ExpectedObject): Promise<boolean> {
    try {
      const result = (await this.#client.send(
        new HeadObjectCommand({
          Bucket: this.#bucket,
          ChecksumMode: "ENABLED",
          Key: expected.key,
        }),
      )) as {
        readonly ChecksumSHA256?: unknown;
        readonly ContentLength?: unknown;
        readonly ContentType?: unknown;
        readonly Metadata?: Readonly<Record<string, string | undefined>>;
      };
      return (
        result.ChecksumSHA256 === checksumSha256(expected.sha256) &&
        result.ContentLength === expected.byteLength &&
        result.ContentType === expected.mediaType &&
        result.Metadata?.sha256 === expected.sha256 &&
        Object.entries(expected.metadata).every(([key, value]) => result.Metadata?.[key] === value)
      );
    } catch (error) {
      if (isNotFound(error)) return false;
      throw conflict(error);
    }
  }

  async #install(expected: ExpectedObject, bytes: Uint8Array): Promise<boolean> {
    if (sha256Bytes(bytes) !== expected.sha256 || bytes.byteLength !== expected.byteLength) {
      throw new CatalogError("CATALOG_ARTIFACT_HASH_MISMATCH");
    }
    if (await this.#matches(expected)) return true;
    try {
      await this.#client.send(
        new PutObjectCommand({
          Body: bytes,
          Bucket: this.#bucket,
          ContentLength: bytes.byteLength,
          ContentType: expected.mediaType,
          ChecksumSHA256: checksumSha256(expected.sha256),
          IfNoneMatch: "*",
          Key: expected.key,
          Metadata: { ...expected.metadata, sha256: expected.sha256 },
        }),
      );
    } catch (error) {
      if (!isPreconditionFailed(error) || !(await this.#matches(expected))) {
        throw conflict(error);
      }
      return true;
    }
    if (!(await this.#matches(expected))) throw conflict();
    return false;
  }

  async putContentAddressed(input: PutCatalogObjectInput): Promise<void> {
    if (!/^[a-f0-9]{64}$/u.test(input.sha256) || sha256Bytes(input.bytes) !== input.sha256) {
      throw new CatalogError("CATALOG_ARTIFACT_HASH_MISMATCH");
    }
    await this.#install(
      {
        byteLength: input.bytes.byteLength,
        key: objectKey(input.sha256),
        mediaType: input.mediaType,
        metadata: { "catalog-storage": "content-addressed-v1" },
        sha256: input.sha256,
      },
      input.bytes,
    );
  }

  async publishReleaseHead(
    publication: CatalogPublishedRelease,
  ): Promise<{ readonly release: CatalogRelease; readonly replayed: boolean }> {
    const validated = validateCatalogPublication(publication);
    const required: ExpectedObject[] = [
      {
        byteLength: validated.manifestBytes.byteLength,
        key: objectKey(validated.release.manifestSha256),
        mediaType: "application/json",
        metadata: { "catalog-storage": "content-addressed-v1" },
        sha256: validated.release.manifestSha256,
      },
      ...validated.assets.flatMap(({ artifacts }) =>
        artifacts.map((artifact) => ({
          byteLength: artifact.byteLength,
          key: artifact.objectKey,
          mediaType: artifact.mediaType,
          metadata: { "catalog-storage": "content-addressed-v1" },
          sha256: artifact.sha256,
        })),
      ),
    ];
    const present = await Promise.all(required.map((expected) => this.#matches(expected)));
    if (present.some((available) => !available)) throw conflict();

    const headBytes = catalogCanonicalBytes({
      assets: validated.assets,
      release: validated.release,
      schemaVersion: "c13-s3-release-head-v1",
    });
    const headSha256 = sha256Bytes(headBytes);
    const replayed = await this.#install(
      {
        byteLength: headBytes.byteLength,
        key: headKey(validated.release.version),
        mediaType: "application/json",
        metadata: {
          "catalog-storage": "release-head-v1",
          "manifest-sha256": validated.release.manifestSha256,
          "release-id": validated.release.releaseId,
        },
        sha256: headSha256,
      },
      headBytes,
    );
    return { release: structuredClone(validated.release), replayed };
  }
}
