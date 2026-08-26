import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { c13CatalogPolicy } from "@interior-design/contracts";
import { parseProtectedC10Glb } from "@interior-design/render-scene";
import { createHash } from "node:crypto";

import type { CatalogRepository } from "../catalog/types.js";
import { sceneObjectKey } from "../scenes/storage.js";
import type { SceneRepository } from "../scenes/types.js";
import type { SpecificationSceneBindingResolver } from "../specifications/types.js";
import type { S3AssetStorageConfig } from "../../storage/config.js";
import type {
  AuthoritativeScenePort,
  AuthoritativeSpecificationPort,
  EmbeddedC13BindingPort,
  RenderProfileAuthority,
} from "./source.js";

export interface ExactSceneGlbReader {
  read(input: { readonly byteSize: number; readonly glbSha256: string }): Promise<Uint8Array>;
}

interface S3GetClient {
  send(command: object): Promise<unknown>;
}

function boundedGlbInput(input: { readonly byteSize: number; readonly glbSha256: string }): void {
  if (
    !Number.isSafeInteger(input.byteSize) ||
    input.byteSize < 20 ||
    input.byteSize > c13CatalogPolicy.maximumGlbBytes ||
    !/^[a-f0-9]{64}$/u.test(input.glbSha256)
  ) {
    throw new Error("The exact C10 GLB reference is invalid.");
  }
}

/**
 * Reads only C10's internal content-addressed scene object. It derives the key
 * from the C10 authority record, bounds the stream before allocating, and
 * rechecks the immutable hash before a render authority sees any bytes.
 */
export class S3ExactSceneGlbReader implements ExactSceneGlbReader {
  readonly #client: S3GetClient;

  constructor(config: S3AssetStorageConfig, options: { readonly client?: S3GetClient } = {}) {
    this.#client =
      options.client ??
      new S3Client({
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        endpoint: config.endpoint,
        forcePathStyle: config.forcePathStyle,
        region: config.region,
      });
  }

  async read(input: {
    readonly byteSize: number;
    readonly glbSha256: string;
  }): Promise<Uint8Array> {
    boundedGlbInput(input);
    let response: { readonly Body?: AsyncIterable<Uint8Array>; readonly ContentLength?: unknown };
    try {
      response = (await this.#client.send(
        new GetObjectCommand({ Bucket: "derived", Key: sceneObjectKey(input.glbSha256) }),
      )) as typeof response;
    } catch {
      throw new Error("The exact C10 GLB could not be read.");
    }
    if (response.ContentLength !== input.byteSize || response.Body === undefined) {
      throw new Error("The exact C10 GLB metadata does not match its authority record.");
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for await (const chunk of response.Body) {
        if (!(chunk instanceof Uint8Array) || chunk.byteLength < 1) {
          throw new Error("Invalid C10 GLB stream chunk.");
        }
        total += chunk.byteLength;
        if (total > input.byteSize) throw new Error("C10 GLB stream exceeds its authority record.");
        chunks.push(Uint8Array.from(chunk));
      }
    } catch {
      throw new Error("The exact C10 GLB stream could not be read.");
    }
    if (total !== input.byteSize) throw new Error("The C10 GLB length is not exact.");
    const bytes = Buffer.concat(chunks, total);
    if (sha256(bytes) !== input.glbSha256) throw new Error("The C10 GLB hash is not exact.");
    return bytes;
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Loads only the exact succeeded C10 scene selected by server-owned persistence. */
export class C10RenderSceneAuthority implements AuthoritativeScenePort {
  readonly #reader: ExactSceneGlbReader;
  readonly #scenes: SceneRepository;

  constructor(options: { readonly reader: ExactSceneGlbReader; readonly scenes: SceneRepository }) {
    this.#reader = options.reader;
    this.#scenes = options.scenes;
  }

  async listSucceededScenes(tenantId: string, projectId: string) {
    const jobs = await this.#scenes.listJobs(tenantId, projectId);
    const scenes = await Promise.all(
      jobs
        .filter(({ state }) => state === "succeeded")
        .slice(0, 100)
        .map(async (job) => {
          const scene = await this.#scenes.findScene(tenantId, projectId, job.id);
          if (scene === undefined || scene.projectId !== projectId) {
            throw new Error("The succeeded C10 scene authority returned an invalid scoped record.");
          }
          const cameraIds = scene.manifest.elementMappings
            .filter(({ elementType, status }) => elementType === "camera" && status === "mapped")
            .map(({ elementId }) => elementId)
            .sort((left, right) => left.localeCompare(right));
          return {
            cameraIds,
            projectId,
            sceneArtifactId: scene.artifact.id,
            sceneGlbSha256: scene.artifact.glbSha256,
            sceneId: scene.id,
            sceneJobId: job.id,
            sceneManifestSha256: scene.artifact.manifestSha256,
            sourceSnapshotSha256: scene.manifest.sourceSnapshot.snapshotSha256,
          };
        }),
    );
    return scenes.sort((left, right) => left.sceneJobId.localeCompare(right.sceneJobId));
  }

  async findSucceededScene(tenantId: string, projectId: string, sceneJobId: string) {
    const [job, scene] = await Promise.all([
      this.#scenes.findJob(tenantId, projectId, sceneJobId),
      this.#scenes.findScene(tenantId, projectId, sceneJobId),
    ]);
    if (
      job === undefined ||
      job.state !== "succeeded" ||
      scene === undefined ||
      scene.projectId !== projectId
    ) {
      return undefined;
    }
    const glbBytes = await this.#reader.read({
      byteSize: scene.artifact.byteSize,
      glbSha256: scene.artifact.glbSha256,
    });
    if (
      glbBytes.byteLength !== scene.artifact.byteSize ||
      sha256(glbBytes) !== scene.artifact.glbSha256
    ) {
      return undefined;
    }
    return {
      cameraIds: scene.manifest.elementMappings
        .filter(({ elementType, status }) => elementType === "camera" && status === "mapped")
        .map(({ elementId }) => elementId)
        .sort((left, right) => left.localeCompare(right)),
      glbBytes,
      projectId,
      sceneArtifactId: scene.artifact.id,
      sceneGlbSha256: scene.artifact.glbSha256,
      sceneId: scene.id,
      sceneJobId,
      sceneManifestSha256: scene.artifact.manifestSha256,
      sourceSnapshotSha256: scene.manifest.sourceSnapshot.snapshotSha256,
    };
  }
}

function activeRenderRights(asset: Awaited<ReturnType<CatalogRepository["findAsset"]>>): boolean {
  return (
    asset !== undefined &&
    asset.lifecycle === "approved" &&
    asset.rights.review.state === "approved" &&
    asset.rights.policy.serviceProcessingAllowed &&
    asset.rights.grants.derivatives &&
    asset.rights.grants.renderedOutputDistribution
  );
}

/** Rechecks the exact C13 lines against their live release and rights records for every render. */
export class C13RenderSpecificationAuthority implements AuthoritativeSpecificationPort {
  readonly #catalog: CatalogRepository;
  readonly #specifications: SpecificationSceneBindingResolver;

  constructor(options: {
    readonly catalog: CatalogRepository;
    readonly specifications: SpecificationSceneBindingResolver;
  }) {
    this.#catalog = options.catalog;
    this.#specifications = options.specifications;
  }

  async resolveSceneBinding(tenantId: string, projectId: string, sceneJobId: string) {
    const binding = await this.#specifications.resolveConfirmedSceneBinding(
      tenantId,
      projectId,
      sceneJobId,
    );
    if (binding === undefined) return undefined;
    const assets = await Promise.all(
      binding.lines.map((line) =>
        this.#catalog.findAsset(tenantId, projectId, line.catalogReleaseId, line.assetVersionId),
      ),
    );
    const allReferencedRightsActive = assets.every((asset, index) => {
      const line = binding.lines[index];
      return (
        line !== undefined &&
        activeRenderRights(asset) &&
        asset !== undefined &&
        asset.versionSha256 === line.assetVersionSha256 &&
        asset.rights.recordSha256 === line.rightsRecordSha256
      );
    });
    return {
      allReferencedRightsActive,
      catalogReleaseId: binding.catalogReleaseId,
      catalogReleaseSha256: binding.catalogReleaseSha256,
      specificationId: binding.specificationId,
      specificationRevision: binding.specificationRevision,
      specificationRevisionSha256: binding.revisionSha256,
    };
  }
}

/** Parses C10's protected GLB rather than trusting a request-body C13 binding. */
export class C10EmbeddedC13BindingInspector implements EmbeddedC13BindingPort {
  inspect(bytes: Uint8Array) {
    try {
      const binding = parseProtectedC10Glb(bytes).specificationBinding;
      if (
        typeof binding.catalogReleaseId !== "string" ||
        typeof binding.catalogReleaseSha256 !== "string" ||
        typeof binding.specificationId !== "string" ||
        !Number.isSafeInteger(binding.specificationRevision) ||
        typeof binding.specificationRevisionSha256 !== "string"
      ) {
        return Promise.resolve(undefined);
      }
      return Promise.resolve({
        catalogReleaseId: binding.catalogReleaseId,
        catalogReleaseSha256: binding.catalogReleaseSha256,
        specificationId: binding.specificationId,
        specificationRevision: binding.specificationRevision as number,
        specificationRevisionSha256: binding.specificationRevisionSha256,
      });
    } catch {
      return Promise.resolve(undefined);
    }
  }
}

const profiles = Object.freeze({
  "cycles-cpu-geometry-safe-v1": {
    estimatedJobBytes: 268_435_456,
    requiredCapability: "render.cycles.cpu.v1",
  },
  "cycles-cuda-high-resolution-v1": {
    estimatedJobBytes: 1_073_741_824,
    requiredCapability: "render.cycles.cuda.v1",
  },
  "cycles-metal-geometry-safe-v1": {
    estimatedJobBytes: 536_870_912,
    requiredCapability: "render.cycles.metal.v1",
  },
  "cycles-optix-high-resolution-v1": {
    estimatedJobBytes: 1_073_741_824,
    requiredCapability: "render.cycles.optix.v1",
  },
  "eevee-local-preview-v1": {
    estimatedJobBytes: 134_217_728,
    requiredCapability: "render.eevee.host-gpu.v1",
  },
});

export class FrozenRenderProfileAuthority implements RenderProfileAuthority {
  resolve(profileId: Parameters<RenderProfileAuthority["resolve"]>[0]) {
    return profiles[profileId];
  }
}
