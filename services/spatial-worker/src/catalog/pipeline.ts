import {
  CatalogError,
  buildCatalogRelease,
  parseCatalogSourceManifest,
  safeCatalogDiagnostic,
  type CatalogPublishedRelease,
  type CatalogSourceArtifactRole,
  type CatalogValidatedAsset,
  type KhronosValidatorPort,
  validateCatalogSourceAsset,
} from "@interior-design/catalog";
import { c13CatalogPolicy } from "@interior-design/contracts";

import type { CatalogPublicationStore } from "./publication.js";
import type { CatalogSourceReader } from "./source.js";

export type CatalogPipelineStage =
  | "artifact-published"
  | "asset-validated"
  | "before-release-head"
  | "manifest-loaded"
  | "release-published";

export interface CatalogPipelineHooks {
  afterStage?(stage: CatalogPipelineStage): Promise<void> | void;
}

export interface CatalogIngestionResult {
  readonly publication: CatalogPublishedRelease;
  readonly replayed: boolean;
}

function throwIfStopped(signal: AbortSignal | undefined, startedAt: number): void {
  if (signal?.aborted === true) throw new CatalogError("CATALOG_CANCELLED");
  if (performance.now() - startedAt > c13CatalogPolicy.ingestionTimeoutSeconds * 1_000) {
    throw new CatalogError("CATALOG_RESOURCE_LIMIT");
  }
}

function waitBounded<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
  startedAt: number,
): Promise<T> {
  throwIfStopped(signal, startedAt);
  const remaining = Math.max(
    1,
    c13CatalogPolicy.ingestionTimeoutSeconds * 1_000 - (performance.now() - startedAt),
  );
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancelled);
      callback();
    };
    const cancelled = (): void => {
      finish(() => {
        reject(new CatalogError("CATALOG_CANCELLED"));
      });
    };
    const timeout = setTimeout(() => {
      finish(() => {
        reject(new CatalogError("CATALOG_RESOURCE_LIMIT"));
      });
    }, remaining);
    signal?.addEventListener("abort", cancelled, { once: true });
    operation.then(
      (value) => {
        finish(() => {
          resolve(value);
        });
      },
      (error: unknown) => {
        finish(() => {
          reject(
            error instanceof Error
              ? error
              : new Error("Catalog dependency rejected.", { cause: error }),
          );
        });
      },
    );
  });
}

function artifactMaximum(role: CatalogSourceArtifactRole): number {
  if (role === "model") return c13CatalogPolicy.maximumGlbBytes;
  if (role === "thumbnail") return c13CatalogPolicy.maximumImageEncodedBytes;
  return 256 * 1024;
}

export class CatalogIngestionPipeline {
  readonly #hooks: CatalogPipelineHooks;
  readonly #publication: CatalogPublicationStore;
  readonly #source: CatalogSourceReader;
  readonly #validator: KhronosValidatorPort;

  constructor(options: {
    readonly hooks?: CatalogPipelineHooks;
    readonly publication: CatalogPublicationStore;
    readonly source: CatalogSourceReader;
    readonly validator: KhronosValidatorPort;
  }) {
    this.#hooks = options.hooks ?? {};
    this.#publication = options.publication;
    this.#source = options.source;
    this.#validator = options.validator;
  }

  async ingest(
    options: {
      readonly manifestRelativePath?: "release.json";
      readonly signal?: AbortSignal;
    } = {},
  ): Promise<CatalogIngestionResult> {
    const startedAt = performance.now();
    throwIfStopped(options.signal, startedAt);
    const manifestBytes = await waitBounded(
      this.#source.read(
        options.manifestRelativePath ?? "release.json",
        c13CatalogPolicy.maximumReleaseManifestBytes,
      ),
      options.signal,
      startedAt,
    );
    const manifest = parseCatalogSourceManifest(manifestBytes);
    await waitBounded(
      Promise.resolve(this.#hooks.afterStage?.("manifest-loaded")),
      options.signal,
      startedAt,
    );
    const records: CatalogValidatedAsset[] = [];
    for (const asset of manifest.assets) {
      throwIfStopped(options.signal, startedAt);
      const bytesByRole = new Map<CatalogSourceArtifactRole, Uint8Array>();
      let totalBytes = 0;
      for (const descriptor of asset.artifacts) {
        const bytes = await waitBounded(
          this.#source.read(descriptor.relativePath, artifactMaximum(descriptor.role)),
          options.signal,
          startedAt,
        );
        totalBytes += bytes.byteLength;
        if (totalBytes > c13CatalogPolicy.maximumArtifactBytesPerAsset) {
          throw new CatalogError("CATALOG_RESOURCE_LIMIT");
        }
        bytesByRole.set(descriptor.role, bytes);
      }
      const validated = await waitBounded(
        validateCatalogSourceAsset({
          bytesByRole,
          source: asset,
          validator: this.#validator,
        }),
        options.signal,
        startedAt,
      );
      for (const artifact of validated.record.artifacts) {
        const bytes = validated.artifactBytes.get(artifact.artifactId);
        if (bytes === undefined) throw new CatalogError("CATALOG_INPUT_MALFORMED");
        await waitBounded(
          this.#publication.putContentAddressed({
            bytes,
            mediaType: artifact.mediaType,
            sha256: artifact.sha256,
          }),
          options.signal,
          startedAt,
        );
        await waitBounded(
          Promise.resolve(this.#hooks.afterStage?.("artifact-published")),
          options.signal,
          startedAt,
        );
      }
      records.push({ artifactBytes: new Map(), record: validated.record });
      await waitBounded(
        Promise.resolve(this.#hooks.afterStage?.("asset-validated")),
        options.signal,
        startedAt,
      );
    }
    throwIfStopped(options.signal, startedAt);
    const publication = buildCatalogRelease(manifest, records);
    await waitBounded(
      this.#publication.putContentAddressed({
        bytes: publication.manifestBytes,
        mediaType: "application/json",
        sha256: publication.release.manifestSha256,
      }),
      options.signal,
      startedAt,
    );
    await waitBounded(
      Promise.resolve(this.#hooks.afterStage?.("before-release-head")),
      options.signal,
      startedAt,
    );
    throwIfStopped(options.signal, startedAt);
    const result = await this.#publication.publishReleaseHead(publication);
    await this.#hooks.afterStage?.("release-published");
    return { publication, replayed: result.replayed };
  }

  async execute(
    options: {
      readonly manifestRelativePath?: "release.json";
      readonly signal?: AbortSignal;
    } = {},
  ): Promise<
    | { readonly ok: true; readonly result: CatalogIngestionResult }
    | {
        readonly diagnostic: ReturnType<typeof safeCatalogDiagnostic>;
        readonly ok: false;
      }
  > {
    try {
      return { ok: true, result: await this.ingest(options) };
    } catch (error) {
      return { diagnostic: safeCatalogDiagnostic(error), ok: false };
    }
  }
}
