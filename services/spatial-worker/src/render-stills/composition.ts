import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import {
  BundledOiioExrInspector,
  C10ProtectedGlbInspector,
  FixedArgumentRendererProcess,
  IsolatedStillRenderer,
} from "@interior-design/blender-renderer";
import {
  c13CatalogPolicy,
  renderProfileSchema,
  type CatalogRelease,
  type RenderProfile,
  type RenderSourceReference,
  type SceneJob,
  type SceneRecord,
  type Specification,
} from "@interior-design/contracts";
import { buildRenderScene, type BuiltRenderScene } from "@interior-design/render-scene";
import {
  C10EmbeddedC13BindingInspector,
  C10RenderSceneAuthority,
  C13RenderSpecificationAuthority,
  FrozenRenderProfileAuthority,
  PortBackedRenderSourceResolver,
  PostgresRenderRepository,
  RenderStillWorkerService,
  S3ExactSceneGlbReader,
  S3RenderObjectStorage,
  type ExactSceneGlbReader,
  type OpaqueRenderAccessSigner,
  type RenderSourceResolver,
} from "@interior-design/platform-api/render-stills";
import { PostgresCatalogRepository } from "@interior-design/platform-api/catalog";
import {
  PostgresSceneRepository,
  PostgresSceneSnapshotVerifier,
} from "@interior-design/platform-api/scenes";
import { PostgresSpecificationRepository } from "@interior-design/platform-api/specifications";
import { createHash } from "node:crypto";
import type { Sql } from "postgres";

import type { WorkerConfig } from "../config.js";
import type { SafeLogger } from "../logger.js";
import { StatfsRenderDisk } from "./disk.js";
import { RenderStillRunner } from "./runner.js";
import type {
  LoadedRenderSource,
  RenderSceneBuilderPort,
  RenderSourceMaterialPort,
} from "./types.js";

type C14RenderConfig = NonNullable<WorkerConfig["c14Render"]>;
type C14RenderSceneConfig = Pick<
  C14RenderConfig,
  "blenderBuildHash" | "blenderVersion" | "profile"
> & {
  readonly rendererScript: Pick<C14RenderConfig["rendererScript"], "sha256">;
};

function fail(code: string): never {
  throw Object.assign(new Error(code), { code });
}

function sameSource(left: RenderSourceReference, right: RenderSourceReference): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function expectedScene(
  leaseSource: RenderSourceReference,
  sceneJob: SceneJob | undefined,
  scene: SceneRecord | undefined,
): asserts scene is SceneRecord & { readonly projectId: string } {
  if (
    sceneJob === undefined ||
    scene === undefined ||
    sceneJob.state !== "succeeded" ||
    sceneJob.id !== leaseSource.sceneJobId ||
    sceneJob.sceneId !== leaseSource.sceneId ||
    scene.id !== leaseSource.sceneId ||
    scene.projectId !== leaseSource.projectId ||
    scene.artifact.id !== leaseSource.sceneArtifactId ||
    scene.artifact.glbSha256 !== leaseSource.sceneGlbSha256 ||
    scene.artifact.manifestSha256 !== leaseSource.sceneManifestSha256 ||
    scene.manifest.sourceSnapshot.snapshotSha256 !== leaseSource.sourceSnapshotSha256
  ) {
    fail("RENDER_SOURCE_CHANGED");
  }
}

/**
 * Reads one exact C10 object after re-checking the persisted C10 scene record.
 * This is intentionally separate from the API resolver: the worker cannot use
 * a request body, a URL, or a caller-provided object key as render authority.
 */
export class ExactC10RenderSourceMaterial implements RenderSourceMaterialPort {
  readonly #reader: ExactSceneGlbReader;
  readonly #scenes: PostgresSceneRepository;

  constructor(options: {
    readonly reader: ExactSceneGlbReader;
    readonly scenes: PostgresSceneRepository;
  }) {
    this.#reader = options.reader;
    this.#scenes = options.scenes;
  }

  async load(lease: Parameters<RenderSourceMaterialPort["load"]>[0]): Promise<LoadedRenderSource> {
    const [job, scene] = await Promise.all([
      this.#scenes.findJob(lease.tenantId, lease.projectId, lease.source.sceneJobId),
      this.#scenes.findScene(lease.tenantId, lease.projectId, lease.source.sceneJobId),
    ]);
    expectedScene(lease.source, job, scene);
    const bytes = await this.#reader.read({
      byteSize: scene.artifact.byteSize,
      glbSha256: scene.artifact.glbSha256,
    });
    if (
      bytes.byteLength !== scene.artifact.byteSize ||
      createHash("sha256").update(bytes).digest("hex") !== lease.source.sceneGlbSha256
    ) {
      fail("RENDER_SOURCE_HASH_MISMATCH");
    }
    return { glbBytes: bytes, glbSha256: lease.source.sceneGlbSha256, source: lease.source };
  }
}

interface CatalogManifestReader {
  read(release: CatalogRelease): Promise<Uint8Array>;
}

function catalogManifestObjectKey(sha256: string): string {
  if (!/^[a-f0-9]{64}$/u.test(sha256)) fail("RENDER_CATALOG_MANIFEST_INVALID");
  return `catalog/sha256/${sha256.slice(0, 2)}/${sha256}`;
}

/** Bounded, content-addressed C13 release-manifest read; never accepts an object locator from a job. */
export class S3ExactCatalogManifestReader implements CatalogManifestReader {
  readonly #client: Pick<S3Client, "send">;

  constructor(client: Pick<S3Client, "send">) {
    this.#client = client;
  }

  async read(release: CatalogRelease): Promise<Uint8Array> {
    let response: {
      readonly Body?: AsyncIterable<Uint8Array>;
      readonly ContentLength?: unknown;
      readonly ContentType?: unknown;
    };
    try {
      response = (await this.#client.send(
        new GetObjectCommand({
          Bucket: "derived",
          Key: catalogManifestObjectKey(release.manifestSha256),
        }),
      )) as typeof response;
    } catch {
      return fail("RENDER_CATALOG_MANIFEST_UNAVAILABLE");
    }
    const contentLength = response.ContentLength;
    if (
      response.Body === undefined ||
      response.ContentType !== "application/json" ||
      typeof contentLength !== "number" ||
      !Number.isSafeInteger(contentLength) ||
      contentLength < 2 ||
      contentLength > c13CatalogPolicy.maximumReleaseManifestBytes
    ) {
      return fail("RENDER_CATALOG_MANIFEST_INVALID");
    }
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for await (const chunk of response.Body) {
        if (!(chunk instanceof Uint8Array) || chunk.byteLength < 1) {
          return fail("RENDER_CATALOG_MANIFEST_INVALID");
        }
        length += chunk.byteLength;
        if (length > contentLength) return fail("RENDER_CATALOG_MANIFEST_INVALID");
        chunks.push(Uint8Array.from(chunk));
      }
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { readonly code?: unknown }).code === "RENDER_CATALOG_MANIFEST_INVALID"
      ) {
        throw error;
      }
      return fail("RENDER_CATALOG_MANIFEST_UNAVAILABLE");
    }
    const bytes = Buffer.concat(chunks, length);
    if (
      length !== contentLength ||
      createHash("sha256").update(bytes).digest("hex") !== release.manifestSha256
    ) {
      return fail("RENDER_CATALOG_MANIFEST_INVALID");
    }
    return bytes;
  }
}

function renderProfile(config: C14RenderSceneConfig): RenderProfile {
  const profileId = config.profile.profileId;
  const engine = profileId === "eevee-local-preview-v1" ? "eevee" : "cycles";
  const device =
    profileId === "eevee-local-preview-v1"
      ? "host-gpu"
      : profileId === "cycles-cpu-geometry-safe-v1"
        ? "cpu"
        : profileId === "cycles-metal-geometry-safe-v1"
          ? "metal"
          : profileId === "cycles-cuda-high-resolution-v1"
            ? "cuda"
            : "optix";
  return renderProfileSchema.parse({
    blenderBuildHash: config.blenderBuildHash,
    blenderVersion: config.blenderVersion,
    colourManagement: {
      displayDevice: "sRGB",
      look: "AgX - Medium High Contrast",
      viewTransform: "AgX",
    },
    denoise: "none",
    device,
    engine,
    heightPx: config.profile.heightPx,
    profileId,
    samples: config.profile.samples,
    seed: config.profile.seed,
    threads: config.profile.threads,
    transparentBackground: false,
    widthPx: config.profile.widthPx,
  });
}

/** Builds a C14 scene only from the exact source already leased by durable C14 storage. */
export class ExactC14RenderSceneBuilder implements RenderSceneBuilderPort {
  readonly #catalog: PostgresCatalogRepository;
  readonly #catalogManifest: CatalogManifestReader;
  readonly #config: C14RenderSceneConfig;
  readonly #scenes: PostgresSceneRepository;
  readonly #snapshots: PostgresSceneSnapshotVerifier;
  readonly #specifications: PostgresSpecificationRepository;

  constructor(options: {
    readonly catalog: PostgresCatalogRepository;
    readonly catalogManifest: CatalogManifestReader;
    readonly config: C14RenderSceneConfig;
    readonly scenes: PostgresSceneRepository;
    readonly snapshots: PostgresSceneSnapshotVerifier;
    readonly specifications: PostgresSpecificationRepository;
  }) {
    this.#catalog = options.catalog;
    this.#catalogManifest = options.catalogManifest;
    this.#config = options.config;
    this.#scenes = options.scenes;
    this.#snapshots = options.snapshots;
    this.#specifications = options.specifications;
  }

  async build(input: Parameters<RenderSceneBuilderPort["build"]>[0]) {
    const { lease, source } = input;
    if (!sameSource(lease.source, source.source) || lease.source.specification === undefined) {
      fail("RENDER_SOURCE_CHANGED");
    }
    const [sceneJob, scene, binding] = await Promise.all([
      this.#scenes.findJob(lease.tenantId, lease.projectId, lease.source.sceneJobId),
      this.#scenes.findScene(lease.tenantId, lease.projectId, lease.source.sceneJobId),
      this.#specifications.resolveConfirmedSceneBinding(
        lease.tenantId,
        lease.projectId,
        lease.source.sceneJobId,
      ),
    ]);
    expectedScene(lease.source, sceneJob, scene);
    const pinned = lease.source.specification;
    if (
      binding === undefined ||
      binding.projectId !== lease.projectId ||
      binding.sceneJobId !== lease.source.sceneJobId ||
      binding.modelSnapshotSha256 !== lease.source.sourceSnapshotSha256 ||
      binding.specificationId !== pinned.specificationId ||
      binding.specificationRevision !== pinned.specificationRevision ||
      binding.revisionSha256 !== pinned.specificationRevisionSha256 ||
      binding.catalogReleaseId !== pinned.catalogReleaseId ||
      binding.catalogReleaseSha256 !== pinned.catalogReleaseSha256
    ) {
      fail("RENDER_C13_BINDING_MISMATCH");
    }
    const [snapshot, specification, release, assets] = await Promise.all([
      this.#snapshots.findExactCommitted(
        lease.tenantId,
        lease.projectId,
        scene.manifest.sourceSnapshot,
      ),
      this.#specifications.findSpecification(
        lease.tenantId,
        lease.projectId,
        pinned.specificationId,
      ),
      this.#catalog.findRelease(lease.tenantId, lease.projectId, pinned.catalogReleaseId),
      this.#catalog.listAssets(lease.tenantId, lease.projectId, pinned.catalogReleaseId),
    ]);
    if (
      snapshot === undefined ||
      specification === undefined ||
      release === undefined ||
      release.manifestSha256 !== pinned.catalogReleaseSha256
    ) {
      fail("RENDER_SOURCE_CHANGED");
    }
    const revisions = await this.#specifications.listRevisions(
      lease.tenantId,
      lease.projectId,
      pinned.specificationId,
    );
    const revision = revisions.find(
      (candidate) =>
        candidate.revision === pinned.specificationRevision &&
        candidate.revisionSha256 === pinned.specificationRevisionSha256,
    );
    if (revision === undefined) fail("RENDER_C13_BINDING_MISMATCH");
    const exactSpecification: Specification = { ...specification, currentRevision: revision };
    const built: BuiltRenderScene = buildRenderScene({
      camera: { cameraId: lease.request.cameraId, clipEndMm: 100_000, clipStartMm: 10 },
      canonicalSnapshot: snapshot.snapshot,
      catalogAssetVersions: assets,
      catalogRelease: release,
      catalogReleaseManifestBytes: await this.#catalogManifest.read(release),
      profile: renderProfile(this.#config),
      rendererScriptSha256: this.#config.rendererScript.sha256,
      scene,
      sceneGlb: source.glbBytes,
      sceneJob: sceneJob as unknown as Parameters<typeof buildRenderScene>[0]["sceneJob"],
      specification: exactSpecification,
    });
    return {
      manifest: built.manifest,
      manifestBytes: built.canonicalBytes(),
      manifestSha256: built.envelope.sha256,
    };
  }
}

class WorkerOnlyArtifactAccessSigner implements OpaqueRenderAccessSigner {
  sign(): Promise<{ readonly expiresAt: string; readonly url: string }> {
    return Promise.reject(
      new Error("The render worker cannot issue browser artifact access grants."),
    );
  }
}

function requiredCapability(profileId: C14RenderConfig["profile"]["profileId"]): string {
  return {
    "cycles-cpu-geometry-safe-v1": "render.cycles.cpu.v1",
    "cycles-cuda-high-resolution-v1": "render.cycles.cuda.v1",
    "cycles-metal-geometry-safe-v1": "render.cycles.metal.v1",
    "cycles-optix-high-resolution-v1": "render.cycles.optix.v1",
    "eevee-local-preview-v1": "render.eevee.host-gpu.v1",
  }[profileId];
}

/**
 * The only runtime composition point for an enabled C14 renderer. When the
 * explicit profile is absent the root worker does not create a renderer at all.
 */
export function composeC14RenderRunner(options: {
  readonly config: WorkerConfig;
  readonly logger: SafeLogger;
  readonly s3Client: S3Client;
  readonly sql: Sql;
}): RenderStillRunner | undefined {
  const config = options.config.c14Render;
  if (config === undefined) return undefined;
  const scenes = new PostgresSceneRepository(options.sql);
  const specifications = new PostgresSpecificationRepository(options.sql);
  const catalog = new PostgresCatalogRepository(options.sql);
  const sceneReader = new S3ExactSceneGlbReader(options.config.s3, { client: options.s3Client });
  const resolver: RenderSourceResolver = new PortBackedRenderSourceResolver({
    embedded: new C10EmbeddedC13BindingInspector(),
    profiles: new FrozenRenderProfileAuthority(),
    scenes: new C10RenderSceneAuthority({ reader: sceneReader, scenes }),
    specifications: new C13RenderSpecificationAuthority({ catalog, specifications }),
  });
  const control = new RenderStillWorkerService({
    repository: new PostgresRenderRepository(options.sql),
    resolver,
    storage: new S3RenderObjectStorage(options.config.s3, new WorkerOnlyArtifactAccessSigner(), {
      client: options.s3Client,
    }),
  });
  const renderer = new IsolatedStillRenderer({
    descriptor: {
      executablePath: config.executable.path,
      executableSha256: config.executable.sha256,
      rendererScriptPath: config.rendererScript.path,
      rendererScriptSha256: config.rendererScript.sha256,
    },
    exrInspector: new BundledOiioExrInspector({
      descriptor: {
        executablePath: config.executable.path,
        executableSha256: config.executable.sha256,
        inspectorScriptPath: config.exrInspectorScript.path,
        inspectorScriptSha256: config.exrInspectorScript.sha256,
      },
      timeoutMilliseconds: Math.min(config.timeoutMilliseconds, 60_000),
      workspaceRoot: config.workspaceRoot,
    }),
    glbInspector: new C10ProtectedGlbInspector(),
    hostFingerprintSha256: config.hostFingerprintSha256,
    maximumOutputBytes: config.maximumOutputBytes,
    process: new FixedArgumentRendererProcess(),
    timeoutMilliseconds: config.timeoutMilliseconds,
    workspaceRoot: config.workspaceRoot,
  });
  return new RenderStillRunner({
    capabilities: [requiredCapability(config.profile.profileId)],
    control,
    disk: new StatfsRenderDisk(),
    heartbeatMilliseconds: Math.min(options.config.heartbeatMs, 15_000),
    leaseSeconds: Math.max(30, Math.min(3_600, Math.ceil(options.config.leaseMs / 1_000))),
    logger: {
      info: (event) => {
        options.logger.info(
          event.event === "render.claimed" || event.event === "render.published"
            ? event.event
            : "render.lifecycle",
          { stage: event.stage ?? "unknown" },
        );
      },
      warn: (event) => {
        options.logger.warn("render.failed", {
          safeCode: typeof event.safeCode === "string" ? event.safeCode : "RENDER_WORKER_FAILED",
        });
      },
    },
    pollMilliseconds: options.config.pollMs,
    renderer,
    sceneBuilder: new ExactC14RenderSceneBuilder({
      catalog,
      catalogManifest: new S3ExactCatalogManifestReader(options.s3Client),
      config,
      scenes,
      snapshots: new PostgresSceneSnapshotVerifier(options.sql),
      specifications,
    }),
    source: new ExactC10RenderSourceMaterial({ reader: sceneReader, scenes }),
    volumeId: config.volumeId,
    volumePath: config.volumePath,
    workerId: `c14-${options.config.workerId}`.slice(0, 100),
  });
}
