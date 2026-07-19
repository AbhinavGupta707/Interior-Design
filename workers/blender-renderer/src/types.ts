import type {
  RenderArtifact,
  RenderArtifactRole,
  RenderOutputManifest,
  RenderSceneManifest,
} from "@interior-design/contracts";

export const rendererArtifactFileNames = Object.freeze({
  "depth-exr": "depth.exr",
  "geometry-safe-png": "geometry-safe.png",
  "multilayer-exr": "multilayer.exr",
  "normal-exr": "normal.exr",
  "segmentation-png": "segmentation.png",
} satisfies Readonly<Record<Exclude<RenderArtifactRole, "illustrative-enhancement-png">, string>>);

export interface RendererExecutableDescriptor {
  readonly executablePath: string;
  readonly executableSha256: string;
  readonly rendererScriptPath: string;
  readonly rendererScriptSha256: string;
}

export interface RendererProcessRequest {
  readonly descriptor: RendererExecutableDescriptor;
  readonly maximumOutputBytes: number;
  readonly timeoutMilliseconds: number;
  readonly workspacePath: string;
}

export interface RendererProcessResult {
  readonly exitCode: number;
  readonly stderrBytes: number;
  readonly stdoutBytes: number;
}

export interface RendererProcessPort {
  run(request: RendererProcessRequest, signal?: AbortSignal): Promise<RendererProcessResult>;
}

export interface ExrInspection {
  readonly channels: readonly string[];
  readonly heightPx: number;
  readonly allFinite: boolean;
  readonly widthPx: number;
}

export interface ExrInspectionPort {
  inspect(
    role: "depth-exr" | "multilayer-exr" | "normal-exr",
    bytes: Uint8Array,
  ): Promise<ExrInspection>;
}

export interface ProtectedObjectBounds {
  readonly elementId: string;
  readonly maximumMetres: readonly [number, number, number];
  readonly minimumMetres: readonly [number, number, number];
}

export interface GlbInspection {
  readonly c13SpecificationBinding?: {
    readonly catalogReleaseId: string;
    readonly catalogReleaseSha256: string;
    readonly specificationId: string;
    readonly specificationRevision: number;
    readonly specificationRevisionSha256: string;
  };
  readonly externalResourceCount: number;
  readonly objectBounds: readonly ProtectedObjectBounds[];
  readonly objectIds: readonly string[];
  readonly unsafeExtensionNames: readonly string[];
  readonly containsDriversOrScripts: boolean;
}

export interface GlbInspectionPort {
  inspect(bytes: Uint8Array): Promise<GlbInspection>;
}

export interface RenderExecutionInput {
  readonly glbBytes: Uint8Array;
  readonly glbSha256: string;
  readonly renderSceneManifest: RenderSceneManifest;
  readonly renderSceneManifestBytes: Uint8Array;
  readonly renderSceneManifestSha256: string;
  readonly resultId: string;
}

export interface ValidatedRenderBundle {
  readonly artifactBytes: ReadonlyMap<RenderArtifactRole, Uint8Array>;
  readonly manifest: RenderOutputManifest;
  readonly manifestBytes: Uint8Array;
  readonly manifestSha256: string;
  readonly artifacts: readonly RenderArtifact[];
}
