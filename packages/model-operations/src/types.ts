import type {
  CanonicalHomeSnapshot,
  ModelOperationRequest,
  ModelOperationType,
} from "@interior-design/contracts";
import type { GeometryFinding } from "@interior-design/geometry-kernel";

export interface InternalSnapshotOperation {
  readonly clientOperationId: string;
  readonly reason: string;
  readonly schemaVersion: "c5-model-operation-v1";
  readonly sourceSnapshotId: string;
  readonly sourceSnapshotSha256: string;
  readonly type: "snapshot.initialize.v1" | "snapshot.restore.v1";
}

export type RetainedModelOperation = InternalSnapshotOperation | ModelOperationRequest;

export interface CanonicalOperationResult {
  readonly canonicalByteLength: number;
  readonly canonicalJson: string;
  readonly findings: readonly GeometryFinding[];
  readonly hasBlockingFindings: boolean;
  readonly snapshot: CanonicalHomeSnapshot;
  readonly snapshotSha256: string;
}

export interface RetainedOperationEnvelope {
  readonly operation: RetainedModelOperation;
  readonly ordinal: number;
  readonly revision: number;
}

export interface RetainedOperationCommit {
  readonly operations: readonly RetainedOperationEnvelope[];
  readonly revision: number;
  readonly snapshotSha256: string;
}

export interface ReplaySnapshotSource {
  readonly id: string;
  readonly snapshot: CanonicalHomeSnapshot;
  readonly snapshotSha256: string;
}

export type SnapshotResolver = (
  snapshotId: string,
  snapshotSha256: string,
) => Promise<ReplaySnapshotSource | undefined> | ReplaySnapshotSource | undefined;

export interface ReplayResult {
  readonly finalSnapshot: CanonicalHomeSnapshot;
  readonly finalSnapshotSha256: string;
  readonly revisions: readonly {
    readonly revision: number;
    readonly snapshotSha256: string;
  }[];
}

export interface OperationRegistryEntry {
  readonly audience: "internal" | "public";
  readonly type: ModelOperationType;
}
