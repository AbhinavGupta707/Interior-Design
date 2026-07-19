import type { RenderSceneManifest, RenderSourceReference } from "@interior-design/contracts";
import type { ValidatedRenderBundle } from "@interior-design/blender-renderer";
import type {
  LeasedRenderJob,
  RenderStillWorkerService,
} from "@interior-design/platform-api/render-stills";

export type RenderStillControlPort = Pick<
  RenderStillWorkerService,
  "acknowledgeCancellation" | "claimNext" | "fail" | "heartbeat" | "publish"
>;

export interface RenderDiskPort {
  freeBytes(volumePath: string): Promise<number>;
}

export interface LoadedRenderSource {
  readonly glbBytes: Uint8Array;
  readonly glbSha256: string;
  readonly source: RenderSourceReference;
}

/** Loads exact server-resolved bytes; renderer subprocesses never receive this port or its credentials. */
export interface RenderSourceMaterialPort {
  load(lease: LeasedRenderJob): Promise<LoadedRenderSource>;
}

/** Narrow seam for C14-L1. No not-yet-merged render-scene symbol is imported here. */
export interface RenderSceneBuilderPort {
  build(input: { readonly lease: LeasedRenderJob; readonly source: LoadedRenderSource }): Promise<{
    readonly manifest: RenderSceneManifest;
    readonly manifestBytes: Uint8Array;
    readonly manifestSha256: string;
  }>;
}

export interface GeometrySafeRendererPort {
  render(
    input: {
      readonly glbBytes: Uint8Array;
      readonly glbSha256: string;
      readonly renderSceneManifest: RenderSceneManifest;
      readonly renderSceneManifestBytes: Uint8Array;
      readonly renderSceneManifestSha256: string;
      readonly resultId: string;
    },
    signal?: AbortSignal,
  ): Promise<ValidatedRenderBundle>;
}

export interface SafeRenderLogger {
  info(event: Readonly<Record<string, boolean | number | string>>): void;
  warn(event: Readonly<Record<string, boolean | number | string>>): void;
}

export interface RenderStillRunnerOptions {
  readonly capabilities: readonly string[];
  readonly control: RenderStillControlPort;
  readonly disk: RenderDiskPort;
  readonly heartbeatMilliseconds?: number;
  readonly leaseSeconds?: number;
  readonly logger?: SafeRenderLogger;
  readonly renderer: GeometrySafeRendererPort;
  readonly sceneBuilder: RenderSceneBuilderPort;
  readonly source: RenderSourceMaterialPort;
  readonly volumeId: string;
  readonly volumePath: string;
  readonly workerId: string;
}
