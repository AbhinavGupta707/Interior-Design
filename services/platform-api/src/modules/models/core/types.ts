import type {
  Actor,
  CanonicalHomeSnapshot,
  ModelProfile,
  ModelSnapshotRecord,
} from "@interior-design/contracts";
import type { GeometryFinding } from "@interior-design/geometry-kernel";

import type { RequestCorrelation } from "../../../correlation.js";

export const canonicalModelProfiles = ["existing", "proposed", "as-built"] as const;

export interface CanonicalSnapshotEncoding {
  readonly canonicalByteLength: number;
  readonly canonicalJson: string;
  readonly snapshot: CanonicalHomeSnapshot;
  readonly snapshotSha256: string;
}

/** Replaceable port whose production adapter delegates to the domain canonical-byte authority. */
export interface CanonicalSnapshotCodec {
  encode(snapshot: CanonicalHomeSnapshot): CanonicalSnapshotEncoding;
}

export type CanonicalGeometryValidator = (
  snapshot: CanonicalHomeSnapshot,
) => readonly GeometryFinding[];

export type RetainedGeometryFinding = GeometryFinding & {
  readonly severity: "information" | "warning";
};

export interface CreateCanonicalSnapshotCommand {
  readonly actor: Actor;
  readonly correlation: RequestCorrelation;
  readonly expectedCurrentSnapshotSha256: string | null;
  readonly idempotencyKey: string;
  readonly profile: ModelProfile;
  readonly projectId: string;
  readonly snapshot: CanonicalHomeSnapshot;
}

export interface PersistCanonicalSnapshotCommand extends CreateCanonicalSnapshotCommand {
  readonly canonical: CanonicalSnapshotEncoding;
  readonly retainedGeometryFindings: readonly RetainedGeometryFinding[];
}

export interface CreateCanonicalSnapshotResult {
  readonly record: ModelSnapshotRecord;
  readonly replayed: boolean;
}

export type AvailableModelProfileSummary = {
  readonly currentSnapshotId: string;
  readonly currentSnapshotSha256: string;
  readonly modelId: string;
  readonly profile: ModelProfile;
  readonly status: "available";
  readonly updatedAt: string;
  readonly version: number;
};

export interface CanonicalModelRepository {
  createSnapshot(command: PersistCanonicalSnapshotCommand): Promise<CreateCanonicalSnapshotResult>;
  getCurrentSnapshot(
    tenantId: string,
    projectId: string,
    profile: ModelProfile,
  ): Promise<ModelSnapshotRecord | undefined>;
  getSnapshot(
    tenantId: string,
    projectId: string,
    profile: ModelProfile,
    snapshotId: string,
  ): Promise<ModelSnapshotRecord | undefined>;
  listAvailableProfiles(
    tenantId: string,
    projectId: string,
  ): Promise<readonly AvailableModelProfileSummary[]>;
}
