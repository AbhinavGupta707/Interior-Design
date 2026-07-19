import {
  c14RenderPolicy,
  renderSourceReferenceSchema,
  type CreateRenderJobRequest,
  type RenderSourceReference,
} from "@interior-design/contracts";
import { createHash } from "node:crypto";

import { renderConflict, renderInvalid } from "./errors.js";
import type { RenderSourceResolver, ResolvedRenderSource } from "./types.js";

export interface AuthoritativeSucceededScene {
  readonly glbBytes: Uint8Array;
  readonly projectId: string;
  readonly sceneArtifactId: string;
  readonly sceneGlbSha256: string;
  readonly sceneId: string;
  readonly sceneJobId: string;
  readonly sceneManifestSha256: string;
  readonly sourceSnapshotSha256: string;
}

export interface AuthoritativeScenePort {
  findSucceededScene(
    tenantId: string,
    projectId: string,
    sceneJobId: string,
  ): Promise<AuthoritativeSucceededScene | undefined>;
}

export interface AuthoritativeSpecificationBinding {
  readonly allReferencedRightsActive: boolean;
  readonly catalogReleaseId: string;
  readonly catalogReleaseSha256: string;
  readonly specificationId: string;
  readonly specificationRevision: number;
  readonly specificationRevisionSha256: string;
}

export interface AuthoritativeSpecificationPort {
  resolveSceneBinding(
    tenantId: string,
    projectId: string,
    sceneJobId: string,
  ): Promise<AuthoritativeSpecificationBinding | undefined>;
}

export interface EmbeddedC13BindingPort {
  inspect(bytes: Uint8Array): Promise<
    | {
        readonly catalogReleaseId: string;
        readonly catalogReleaseSha256: string;
        readonly specificationId: string;
        readonly specificationRevision: number;
        readonly specificationRevisionSha256: string;
      }
    | undefined
  >;
}

export interface RenderProfileAuthority {
  resolve(profileId: CreateRenderJobRequest["profileId"]):
    | {
        readonly estimatedJobBytes: number;
        readonly requiredCapability: string;
      }
    | undefined;
}

function exactBindingMatches(
  left: AuthoritativeSpecificationBinding,
  right: NonNullable<Awaited<ReturnType<EmbeddedC13BindingPort["inspect"]>>>,
): boolean {
  return (
    left.catalogReleaseId === right.catalogReleaseId &&
    left.catalogReleaseSha256 === right.catalogReleaseSha256 &&
    left.specificationId === right.specificationId &&
    left.specificationRevision === right.specificationRevision &&
    left.specificationRevisionSha256 === right.specificationRevisionSha256
  );
}

function sourceIdentity(source: RenderSourceReference, profileId: string): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        profileId,
        sceneGlbSha256: source.sceneGlbSha256,
        sceneManifestSha256: source.sceneManifestSha256,
        sourceSnapshotSha256: source.sourceSnapshotSha256,
        specification: source.specification,
      }),
    )
    .digest("hex");
}

function exactSceneBytes(scene: AuthoritativeSucceededScene): boolean {
  return (
    scene.glbBytes.byteLength > 0 &&
    createHash("sha256").update(scene.glbBytes).digest("hex") === scene.sceneGlbSha256
  );
}

/**
 * Resolves every hash from server-owned C10/C13 data and the immutable GLB. The request contributes
 * IDs and a named profile only; it never contributes an authoritative digest or rights assertion.
 */
export class PortBackedRenderSourceResolver implements RenderSourceResolver {
  readonly #embedded: EmbeddedC13BindingPort;
  readonly #profiles: RenderProfileAuthority;
  readonly #scenes: AuthoritativeScenePort;
  readonly #specifications: AuthoritativeSpecificationPort;

  constructor(options: {
    readonly embedded: EmbeddedC13BindingPort;
    readonly profiles: RenderProfileAuthority;
    readonly scenes: AuthoritativeScenePort;
    readonly specifications: AuthoritativeSpecificationPort;
  }) {
    this.#embedded = options.embedded;
    this.#profiles = options.profiles;
    this.#scenes = options.scenes;
    this.#specifications = options.specifications;
  }

  async resolveForNewJob(
    tenantId: string,
    projectId: string,
    request: CreateRenderJobRequest,
  ): Promise<ResolvedRenderSource | undefined> {
    const profile = this.#profiles.resolve(request.profileId);
    if (
      profile === undefined ||
      !Number.isSafeInteger(profile.estimatedJobBytes) ||
      profile.estimatedJobBytes < 1 ||
      profile.estimatedJobBytes > c14RenderPolicy.maximumEstimatedJobBytes ||
      !/^[A-Za-z0-9_.:+-]{3,120}$/u.test(profile.requiredCapability)
    ) {
      throw renderInvalid(
        "RENDER_PROFILE_UNAVAILABLE",
        "The selected frozen render profile is unavailable.",
      );
    }
    const scene = await this.#scenes.findSucceededScene(
      tenantId,
      projectId,
      request.sourceSceneJobId,
    );
    if (
      scene === undefined ||
      scene.projectId !== projectId ||
      scene.sceneJobId !== request.sourceSceneJobId ||
      !exactSceneBytes(scene)
    ) {
      return undefined;
    }
    const [authoritative, embedded] = await Promise.all([
      this.#specifications.resolveSceneBinding(tenantId, projectId, request.sourceSceneJobId),
      this.#embedded.inspect(scene.glbBytes),
    ]);
    if ((authoritative === undefined) !== (embedded === undefined)) {
      throw renderConflict(
        "RENDER_C13_BINDING_MISMATCH",
        "The immutable scene and C13 authority do not carry the same exact binding.",
      );
    }
    if (authoritative !== undefined) {
      if (
        embedded === undefined ||
        !exactBindingMatches(authoritative, embedded) ||
        !authoritative.allReferencedRightsActive
      ) {
        throw renderConflict(
          "RENDER_C13_BINDING_MISMATCH",
          "The exact C13 specification, catalog release, GLB binding, or active rights cannot be verified.",
        );
      }
      if (
        request.specification?.specificationId !== authoritative.specificationId ||
        request.specification.specificationRevision !== authoritative.specificationRevision
      ) {
        throw renderConflict(
          "RENDER_SPECIFICATION_SELECTION_MISMATCH",
          "The selected specification does not match the server-resolved scene binding.",
        );
      }
    } else if (request.specification !== undefined) {
      throw renderConflict(
        "RENDER_SPECIFICATION_SELECTION_MISMATCH",
        "This scene has no authoritative C13 specification binding.",
      );
    }
    const source = renderSourceReferenceSchema.parse({
      projectId,
      sceneArtifactId: scene.sceneArtifactId,
      sceneGlbSha256: scene.sceneGlbSha256,
      sceneId: scene.sceneId,
      sceneJobId: scene.sceneJobId,
      sceneManifestSha256: scene.sceneManifestSha256,
      sourceSnapshotSha256: scene.sourceSnapshotSha256,
      ...(authoritative === undefined
        ? {}
        : {
            specification: {
              catalogReleaseId: authoritative.catalogReleaseId,
              catalogReleaseSha256: authoritative.catalogReleaseSha256,
              specificationId: authoritative.specificationId,
              specificationRevision: authoritative.specificationRevision,
              specificationRevisionSha256: authoritative.specificationRevisionSha256,
            },
          }),
    });
    return {
      cacheSourceIdentitySha256: sourceIdentity(source, request.profileId),
      estimatedJobBytes: profile.estimatedJobBytes,
      requiredCapability: profile.requiredCapability,
      source,
    };
  }

  async revalidatePinnedSource(
    tenantId: string,
    projectId: string,
    source: RenderSourceReference,
  ): Promise<boolean> {
    const scene = await this.#scenes.findSucceededScene(tenantId, projectId, source.sceneJobId);
    if (
      scene === undefined ||
      scene.projectId !== projectId ||
      scene.sceneJobId !== source.sceneJobId ||
      scene.sceneId !== source.sceneId ||
      scene.sceneArtifactId !== source.sceneArtifactId ||
      scene.sceneGlbSha256 !== source.sceneGlbSha256 ||
      scene.sceneManifestSha256 !== source.sceneManifestSha256 ||
      scene.sourceSnapshotSha256 !== source.sourceSnapshotSha256 ||
      !exactSceneBytes(scene)
    ) {
      return false;
    }
    const [authoritative, embedded] = await Promise.all([
      this.#specifications.resolveSceneBinding(tenantId, projectId, source.sceneJobId),
      this.#embedded.inspect(scene.glbBytes),
    ]);
    if (source.specification === undefined)
      return authoritative === undefined && embedded === undefined;
    return (
      authoritative !== undefined &&
      embedded !== undefined &&
      authoritative.allReferencedRightsActive &&
      exactBindingMatches(authoritative, embedded) &&
      authoritative.specificationId === source.specification.specificationId &&
      authoritative.specificationRevision === source.specification.specificationRevision &&
      authoritative.specificationRevisionSha256 ===
        source.specification.specificationRevisionSha256 &&
      authoritative.catalogReleaseId === source.specification.catalogReleaseId &&
      authoritative.catalogReleaseSha256 === source.specification.catalogReleaseSha256
    );
  }
}
