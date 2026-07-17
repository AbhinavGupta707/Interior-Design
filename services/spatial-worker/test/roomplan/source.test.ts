import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import type { ObjectStorage } from "../../src/storage.js";
import { verifyCaptureSources } from "../../src/roomplan/source.js";
import { RoomPlanSourceError } from "../../src/roomplan/types.js";
import { SYNTHETIC_IDS, syntheticSources } from "./fixtures.js";

class SyntheticStorage implements ObjectStorage {
  readonly #objects: ReadonlyMap<string, Uint8Array>;
  readonly #failure: Error | undefined;

  constructor(objects: ReadonlyMap<string, Uint8Array>, failure?: Error) {
    this.#objects = objects;
    this.#failure = failure;
  }

  openSource(_bucket: "source", key: string): Promise<AsyncIterable<Uint8Array>> {
    if (this.#failure !== undefined) return Promise.reject(this.#failure);
    const bytes = this.#objects.get(key);
    if (bytes === undefined) return Promise.reject(new Error("Synthetic object is absent."));
    return Promise.resolve(
      (async function* chunks() {
        await Promise.resolve();
        const middle = Math.max(1, Math.floor(bytes.byteLength / 2));
        yield bytes.subarray(0, middle);
        yield bytes.subarray(middle);
      })(),
    );
  }

  putDerivedIfAbsent(): Promise<"created"> {
    return Promise.resolve("created");
  }
}

describe("verifyCaptureSources", () => {
  it("streams, hashes, binds, and parses every immutable source", async () => {
    const sources = syntheticSources();
    let progress = 0;
    const verified = await verifyCaptureSources(
      new SyntheticStorage(sources.bytesByKey),
      sources.artifacts,
      sources.manifest,
      () => {
        progress += 1;
        return Promise.resolve();
      },
    );
    expect(verified.normalizedArtifactId).toBe(SYNTHETIC_IDS.normalizedArtifact);
    expect(verified.normalizedInput).toEqual(sources.normalized);
    expect(progress).toBe(3);
  });

  it("rejects descriptor substitution before reading storage", async () => {
    const sources = syntheticSources();
    const substituted = sources.artifacts.map((artifact, index) =>
      index === 0 ? { ...artifact, byteSize: artifact.byteSize + 1 } : artifact,
    );
    await expect(
      verifyCaptureSources(
        new SyntheticStorage(sources.bytesByKey),
        substituted,
        sources.manifest,
        () => Promise.resolve(),
      ),
    ).rejects.toMatchObject({ code: "source-mismatch", retryable: false });
  });

  it("rejects byte, hash, length, JSON, media-prefix, and quality substitutions", async () => {
    const sources = syntheticSources();
    const normalizedKey = sources.artifacts.find(
      ({ kind }) => kind === "roomplan-normalized-json",
    )?.objectKey;
    const qualityKey = sources.artifacts.find(
      ({ kind }) => kind === "quality-manifest-json",
    )?.objectKey;
    if (normalizedKey === undefined || qualityKey === undefined)
      throw new Error("Synthetic keys absent.");

    const cases = [
      new Map(sources.bytesByKey).set(normalizedKey, Buffer.from("not-json", "utf8")),
      new Map(sources.bytesByKey).set(
        qualityKey,
        Buffer.from('{"heuristicName":"substituted"}', "utf8"),
      ),
      new Map(sources.bytesByKey).set(normalizedKey, Buffer.from("{}", "utf8")),
    ];
    for (const objects of cases) {
      await expect(
        verifyCaptureSources(
          new SyntheticStorage(objects),
          sources.artifacts,
          sources.manifest,
          () => Promise.resolve(),
        ),
      ).rejects.toBeInstanceOf(RoomPlanSourceError);
    }
  });

  it("classifies storage read failures as retryable without exposing provider details", async () => {
    const sources = syntheticSources();
    await expect(
      verifyCaptureSources(
        new SyntheticStorage(sources.bytesByKey, new Error("synthetic provider secret detail")),
        sources.artifacts,
        sources.manifest,
        () => Promise.resolve(),
      ),
    ).rejects.toMatchObject({
      code: "storage-unavailable",
      message: "roomplan-source-storage-unavailable",
      retryable: true,
    });
  });

  it("rejects a USDZ descriptor whose immutable bytes do not have a ZIP container signature", async () => {
    const sources = syntheticSources();
    const bytes = Buffer.from("{}", "utf8");
    const artifact = {
      artifactId: "60000000-0000-4000-8000-000000000099",
      byteSize: bytes.byteLength,
      contentType: "model/vnd.usdz+zip" as const,
      kind: "structure-usdz" as const,
      objectKey: "synthetic/c7/invalid-usdz",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    await expect(
      verifyCaptureSources(
        new SyntheticStorage(new Map(sources.bytesByKey).set(artifact.objectKey, bytes)),
        [...sources.artifacts, artifact],
        {
          ...sources.manifest,
          artifacts: [
            ...sources.manifest.artifacts,
            {
              artifactId: artifact.artifactId,
              byteSize: artifact.byteSize,
              contentType: artifact.contentType,
              kind: artifact.kind,
              sha256: artifact.sha256,
            },
          ],
        },
        () => Promise.resolve(),
      ),
    ).rejects.toMatchObject({ code: "source-mismatch", retryable: false });
  });

  it("stops oversized normalized JSON before parsing or unbounded allocation", async () => {
    const sources = syntheticSources();
    const oversized = Buffer.alloc(16 * 1_024 * 1_024 + 1, 0x20);
    oversized[0] = 0x7b;
    const current = sources.artifacts.find(({ kind }) => kind === "roomplan-normalized-json");
    if (current === undefined) throw new Error("Synthetic normalized descriptor is absent.");
    const replacement = {
      ...current,
      byteSize: oversized.byteLength,
      sha256: createHash("sha256").update(oversized).digest("hex"),
    };
    const artifacts = sources.artifacts.map((artifact) =>
      artifact.artifactId === replacement.artifactId ? replacement : artifact,
    );
    const manifest = {
      ...sources.manifest,
      artifacts: sources.manifest.artifacts.map((artifact) =>
        artifact.artifactId === replacement.artifactId
          ? {
              ...artifact,
              byteSize: replacement.byteSize,
              sha256: replacement.sha256,
            }
          : artifact,
      ),
    };
    await expect(
      verifyCaptureSources(
        new SyntheticStorage(new Map(sources.bytesByKey).set(replacement.objectKey, oversized)),
        artifacts,
        manifest,
        () => Promise.resolve(),
      ),
    ).rejects.toMatchObject({ code: "resource-limit", retryable: false });
  });
});
