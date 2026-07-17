import type {
  SceneArtifact,
  SceneCompileConfiguration,
  SceneManifest,
  SceneSnapshotReference,
} from "@interior-design/contracts";

export interface SceneCompilationTask {
  readonly attempt: number;
  readonly jobId: string;
  /** Private fencing capability. It must never be copied to a result or log. */
  readonly publicationFence: string;
  readonly configuration: SceneCompileConfiguration;
  readonly sourceSnapshot: SceneSnapshotReference;
}

export interface ExactSnapshotPort {
  loadExactSnapshot(source: SceneSnapshotReference, signal: AbortSignal): Promise<unknown>;
}

export interface SceneCompilerOutput {
  readonly artifact: SceneArtifact;
  readonly glb: Uint8Array;
  readonly manifest: SceneManifest;
  readonly manifestBytes: Uint8Array;
}

export interface SceneCompilerPort {
  compile(input: {
    readonly configuration: SceneCompileConfiguration;
    readonly signal: AbortSignal;
    readonly snapshot: unknown;
    readonly sourceSnapshot: SceneSnapshotReference;
  }): Promise<SceneCompilerOutput>;
}

export type SceneWorkState = "cancelled" | "current" | "stale";

export interface SceneWorkStatePort {
  check(task: SceneCompilationTask, signal: AbortSignal): Promise<SceneWorkState>;
}

export interface ContentAddressedScenePublication {
  readonly artifact: SceneArtifact;
  readonly attempt: number;
  readonly contentAddress: {
    readonly glbSha256: string;
    readonly manifestSha256: string;
  };
  readonly glb: Uint8Array;
  readonly jobId: string;
  readonly manifest: SceneManifest;
  readonly manifestBytes: Uint8Array;
  readonly publicationFence: string;
}

export interface SceneArtifactPublisherPort {
  /** The implementation must check attempt/fence/cancellation atomically with immutable publication. */
  publishIfCurrent(
    publication: ContentAddressedScenePublication,
    signal: AbortSignal,
  ): Promise<"cancelled" | "published" | "stale">;
}

export type SceneCompilationRuntimeResult =
  | {
      readonly artifact: SceneArtifact;
      readonly manifest: SceneManifest;
      readonly status: "published";
    }
  | {
      readonly safeCode: "SCENE_COMPILATION_CANCELLED";
      readonly status: "cancelled";
    }
  | {
      readonly safeCode: "SCENE_COMPILATION_STALE";
      readonly status: "stale";
    }
  | {
      readonly safeCode: "SCENE_COMPILATION_FAILED";
      readonly status: "failed";
    };

export interface SceneCompilationRuntimePorts {
  readonly compiler: SceneCompilerPort;
  readonly publisher: SceneArtifactPublisherPort;
  readonly snapshots: ExactSnapshotPort;
  readonly workState: SceneWorkStatePort;
}
