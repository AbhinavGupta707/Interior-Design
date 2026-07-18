import type {
  SceneArtifact,
  SceneCompileConfiguration,
  SceneFinding,
  SceneManifest,
  SceneSnapshotReference,
} from "@interior-design/contracts";

export const sceneCompilerVersion = "1.0.0" as const;

export interface SceneCatalogLineBinding {
  readonly assetContentSha256: string;
  readonly assetMetadataSha256: string;
  readonly assetVersionId: string;
  readonly assetVersionSha256: string;
  readonly elementId: string;
  readonly kind: "finish" | "furnishing" | "light";
  readonly placementPolicySha256: string;
  readonly placementProjectionSha256: string;
  readonly rightsRecordSha256: string;
}

export interface SceneSpecificationBinding {
  readonly catalogReleaseId: string;
  readonly catalogReleaseSha256: string;
  readonly lines: readonly SceneCatalogLineBinding[];
  readonly modelSnapshotSha256: string;
  readonly projectId: string;
  readonly specificationId: string;
  readonly specificationRevision: number;
  readonly specificationRevisionSha256: string;
}

export interface SceneCompileInput {
  readonly configuration: SceneCompileConfiguration;
  readonly signal?: AbortSignal;
  readonly snapshot: unknown;
  readonly specificationBinding?: SceneSpecificationBinding;
  readonly sourceSnapshot: SceneSnapshotReference;
}

export interface SceneValidatorEvidence {
  readonly issueCodes: readonly string[];
  readonly numErrors: number;
  readonly numHints: number;
  readonly numInfos: number;
  readonly numWarnings: number;
  readonly validatorVersion: string;
}

export interface CompiledScene {
  readonly artifact: SceneArtifact;
  readonly findings: readonly SceneFinding[];
  readonly glb: Uint8Array;
  readonly manifest: SceneManifest;
  readonly manifestBytes: Uint8Array;
  readonly validation: SceneValidatorEvidence;
}

export interface ParsedGlbCounts {
  readonly accessors: number;
  readonly bufferViews: number;
  readonly materials: number;
  readonly meshes: number;
  readonly nodes: number;
  readonly triangles: number;
  readonly vertices: number;
}

export interface ParsedGlb {
  readonly binaryChunk: Uint8Array;
  readonly counts: ParsedGlbCounts;
  readonly json: Readonly<Record<string, unknown>>;
  readonly jsonChunk: Uint8Array;
}
