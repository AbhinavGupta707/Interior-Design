import type {
  CanonicalHomeSnapshot,
  CatalogAssetVersion,
  CatalogRelease,
  RenderProfile,
  RenderSceneManifest,
  SceneJob,
  SceneRecord,
  Specification,
} from "@interior-design/contracts";

export const renderScenePackageVersion = "1.0.0" as const;
export const c14RenderSceneHashEnvelopeVersion = "c14-render-scene-external-sha256-v1" as const;

export interface RenderSceneBuildInput {
  readonly camera: {
    readonly cameraId: string;
    readonly clipEndMm: number;
    readonly clipStartMm: number;
  };
  readonly canonicalSnapshot: CanonicalHomeSnapshot;
  readonly catalogAssetVersions: readonly CatalogAssetVersion[];
  readonly catalogRelease: CatalogRelease;
  readonly catalogReleaseManifestBytes: Uint8Array;
  readonly profile: RenderProfile;
  readonly rendererScriptSha256: string;
  readonly scene: SceneRecord;
  readonly sceneGlb: Uint8Array;
  readonly sceneJob: SceneJob;
  readonly specification: Specification;
}

export interface RenderSceneHashEnvelope {
  readonly byteLength: number;
  readonly manifestSchemaVersion: "c14-render-scene-manifest-v1";
  readonly schemaVersion: typeof c14RenderSceneHashEnvelopeVersion;
  readonly sha256: string;
}

export interface BuiltRenderScene {
  readonly canonicalJson: string;
  readonly envelope: RenderSceneHashEnvelope;
  readonly manifest: RenderSceneManifest;
  /** Returns a fresh copy so retained canonical bytes cannot be mutated. */
  canonicalBytes(): Uint8Array;
}

export interface BlenderPointMetres {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface BlenderCameraTransform {
  readonly clipEndMetres: number;
  readonly clipStartMetres: number;
  readonly collinearityPolicy: "canonical-positive-z-up-v1" | "positive-y-world-up-fallback-v1";
  readonly positionMetres: BlenderPointMetres;
  /** Row-major 3x3 local-camera-to-world rotation; local -Z is view forward. */
  readonly rotationMatrix3x3: readonly [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  readonly verticalFovRadians: number;
}
