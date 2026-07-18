import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  buildCatalogRelease,
  parseCatalogSourceManifest,
  type CatalogPublishedRelease,
  type CatalogSourceArtifactRole,
  type CatalogValidatedAsset,
  validateCatalogSourceAsset,
} from "@interior-design/catalog";
import { beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PinnedKhronosValidator } from "../../src/catalog/khronos-validator.js";
import {
  S3CatalogPublicationStore,
  type CatalogS3CommandClient,
} from "../../src/catalog/s3-publication.js";

const fixtureRoot = resolve(import.meta.dirname, "../../../../packages/catalog/fixtures/source");
const releaseHeadKey = "catalog/releases/1.0.0/head.json";

interface FakeObject {
  readonly body: Uint8Array;
  readonly checksumSha256: string;
  readonly contentType: string;
  readonly metadata: Readonly<Record<string, string>>;
}

function bodyChecksum(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("base64");
}

function s3Error(name: "NoSuchKey" | "PreconditionFailed", status: 404 | 412): Error {
  const error = new Error(name) as Error & { $metadata: { httpStatusCode: number } };
  error.name = name;
  error.$metadata = { httpStatusCode: status };
  return error;
}

class BoundedFakeS3Client implements CatalogS3CommandClient {
  readonly objects = new Map<string, FakeObject>();
  readonly putOrder: string[] = [];
  #commands = 0;

  send(command: object): Promise<unknown> {
    this.#commands += 1;
    if (this.#commands > 5_000)
      return Promise.reject(new Error("Synthetic command bound exceeded."));
    if (command instanceof HeadObjectCommand) {
      const key = command.input.Key;
      if (key === undefined) return Promise.reject(new Error("Synthetic HeadObject key missing."));
      const object = this.objects.get(key);
      if (object === undefined) return Promise.reject(s3Error("NoSuchKey", 404));
      return Promise.resolve({
        ChecksumSHA256: object.checksumSha256,
        ContentLength: object.body.byteLength,
        ContentType: object.contentType,
        Metadata: { ...object.metadata },
      });
    }
    if (command instanceof PutObjectCommand) {
      const {
        Body: body,
        ChecksumSHA256: checksumSha256,
        ContentType: contentType,
        IfNoneMatch: condition,
        Key: key,
      } = command.input;
      if (
        !(body instanceof Uint8Array) ||
        checksumSha256 !== bodyChecksum(body) ||
        contentType === undefined ||
        key === undefined
      ) {
        return Promise.reject(new Error("Synthetic PutObject input malformed."));
      }
      if (condition !== "*") return Promise.reject(new Error("Immutable condition missing."));
      if (this.objects.has(key)) return Promise.reject(s3Error("PreconditionFailed", 412));
      const metadata = Object.fromEntries(
        Object.entries(command.input.Metadata ?? {}).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
      this.objects.set(key, {
        body: Uint8Array.from(body),
        checksumSha256,
        contentType,
        metadata,
      });
      this.putOrder.push(key);
      return Promise.resolve({});
    }
    return Promise.reject(new Error("Unexpected synthetic S3 command."));
  }

  corruptMetadata(key: string): void {
    const object = this.objects.get(key);
    if (object === undefined) throw new Error("Synthetic object missing.");
    this.objects.set(key, { ...object, metadata: { ...object.metadata, sha256: "0".repeat(64) } });
  }

  corruptBodyPreservingMetadata(key: string): void {
    const object = this.objects.get(key);
    if (object === undefined) throw new Error("Synthetic object missing.");
    const body = Uint8Array.from(object.body);
    body[0] = (body[0] ?? 0) ^ 1;
    this.objects.set(key, { ...object, body, checksumSha256: bodyChecksum(body) });
  }
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Synthetic catalog S3 fixture is incomplete.");
  return value;
}

interface PublicationFixture {
  readonly artifactBytes: ReadonlyMap<string, Uint8Array>;
  readonly publication: CatalogPublishedRelease;
}

async function createPublicationFixture(): Promise<PublicationFixture> {
  const source = parseCatalogSourceManifest(await readFile(resolve(fixtureRoot, "release.json")));
  const validator = new PinnedKhronosValidator();
  const validated: CatalogValidatedAsset[] = await Promise.all(
    source.assets.map(async (asset) => {
      const bytesByRole = new Map<CatalogSourceArtifactRole, Uint8Array>(
        await Promise.all(
          asset.artifacts.map(
            async (artifact) =>
              [
                artifact.role,
                Uint8Array.from(await readFile(resolve(fixtureRoot, artifact.relativePath))),
              ] as const,
          ),
        ),
      );
      return validateCatalogSourceAsset({ bytesByRole, source: asset, validator });
    }),
  );
  return {
    artifactBytes: new Map(validated.flatMap(({ artifactBytes }) => [...artifactBytes])),
    publication: buildCatalogRelease(source, validated),
  };
}

async function stage(
  store: S3CatalogPublicationStore,
  fixture: PublicationFixture,
  omittedArtifactId?: string,
): Promise<void> {
  for (const asset of fixture.publication.assets) {
    for (const artifact of asset.artifacts) {
      if (artifact.artifactId === omittedArtifactId) continue;
      await store.putContentAddressed({
        bytes: required(fixture.artifactBytes.get(artifact.artifactId)),
        mediaType: artifact.mediaType,
        sha256: artifact.sha256,
      });
    }
  }
  await store.putContentAddressed({
    bytes: fixture.publication.manifestBytes,
    mediaType: "application/json",
    sha256: fixture.publication.release.manifestSha256,
  });
}

describe("C13 S3-compatible catalog publication store", () => {
  let fixture: PublicationFixture;

  beforeAll(async () => {
    fixture = await createPublicationFixture();
  });

  it("publishes the conditional head last and replays exact immutable objects", async () => {
    const client = new BoundedFakeS3Client();
    const store = new S3CatalogPublicationStore(client);
    await stage(store, fixture);
    expect(client.objects.has(releaseHeadKey)).toBe(false);
    await expect(store.publishReleaseHead(fixture.publication)).resolves.toMatchObject({
      replayed: false,
      release: fixture.publication.release,
    });
    expect(client.putOrder.at(-1)).toBe(releaseHeadKey);
    await stage(store, fixture);
    await expect(store.publishReleaseHead(fixture.publication)).resolves.toMatchObject({
      replayed: true,
    });
    expect(client.putOrder.filter((key) => key === releaseHeadKey)).toHaveLength(1);
  });

  it("keeps the release invisible after a partial stage or crash before head", async () => {
    const client = new BoundedFakeS3Client();
    const store = new S3CatalogPublicationStore(client);
    const missing = required(
      required(fixture.publication.assets[0]).artifacts.find(({ role }) => role === "model"),
    );
    await stage(store, fixture, missing.artifactId);
    await expect(store.publishReleaseHead(fixture.publication)).rejects.toMatchObject({
      safeCode: "CATALOG_RELEASE_CONFLICT",
    });
    expect(client.objects.has(releaseHeadKey)).toBe(false);

    await store.putContentAddressed({
      bytes: required(fixture.artifactBytes.get(missing.artifactId)),
      mediaType: missing.mediaType,
      sha256: missing.sha256,
    });
    expect(client.objects.has(releaseHeadKey)).toBe(false);
    await expect(
      new S3CatalogPublicationStore(client).publishReleaseHead(fixture.publication),
    ).resolves.toMatchObject({ replayed: false });
  });

  it("rejects conflicting media metadata and corrupted object identity without a head", async () => {
    const client = new BoundedFakeS3Client();
    const store = new S3CatalogPublicationStore(client);
    const artifact = required(fixture.publication.assets[0]?.artifacts[0]);
    const bytes = required(fixture.artifactBytes.get(artifact.artifactId));
    await store.putContentAddressed({
      bytes,
      mediaType: artifact.mediaType,
      sha256: artifact.sha256,
    });
    await expect(
      store.putContentAddressed({
        bytes,
        mediaType: artifact.mediaType === "image/png" ? "model/gltf-binary" : "image/png",
        sha256: artifact.sha256,
      }),
    ).rejects.toMatchObject({ safeCode: "CATALOG_RELEASE_CONFLICT" });

    await stage(store, fixture);
    client.corruptMetadata(artifact.objectKey);
    await expect(store.publishReleaseHead(fixture.publication)).rejects.toMatchObject({
      safeCode: "CATALOG_RELEASE_CONFLICT",
    });
    expect(client.objects.has(releaseHeadKey)).toBe(false);
  });

  it("rejects a same-length changed body with forged matching user metadata", async () => {
    const client = new BoundedFakeS3Client();
    const store = new S3CatalogPublicationStore(client);
    await stage(store, fixture);
    const artifact = required(
      required(fixture.publication.assets[0]).artifacts.find(({ role }) => role === "model"),
    );
    const original = required(client.objects.get(artifact.objectKey));
    client.corruptBodyPreservingMetadata(artifact.objectKey);
    const attacked = required(client.objects.get(artifact.objectKey));
    expect(attacked.body.byteLength).toBe(original.body.byteLength);
    expect(attacked.metadata).toEqual(original.metadata);
    expect(attacked.checksumSha256).not.toBe(original.checksumSha256);
    await expect(store.publishReleaseHead(fixture.publication)).rejects.toMatchObject({
      safeCode: "CATALOG_RELEASE_CONFLICT",
    });
    expect(client.objects.has(releaseHeadKey)).toBe(false);
  });

  it("does not overwrite a conflicting conditional release head", async () => {
    const client = new BoundedFakeS3Client();
    const store = new S3CatalogPublicationStore(client);
    await stage(store, fixture);
    const existing: FakeObject = {
      body: Uint8Array.of(1, 2, 3),
      checksumSha256: bodyChecksum(Uint8Array.of(1, 2, 3)),
      contentType: "application/json",
      metadata: {
        "catalog-storage": "release-head-v1",
        "manifest-sha256": "0".repeat(64),
        "release-id": fixture.publication.release.releaseId,
        sha256: "0".repeat(64),
      },
    };
    client.objects.set(releaseHeadKey, existing);
    await expect(store.publishReleaseHead(fixture.publication)).rejects.toMatchObject({
      safeCode: "CATALOG_RELEASE_CONFLICT",
    });
    expect(client.objects.get(releaseHeadKey)).toEqual(existing);
  });
});
