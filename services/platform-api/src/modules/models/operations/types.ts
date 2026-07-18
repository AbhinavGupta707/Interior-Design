import type {
  Actor,
  CanonicalHomeSnapshot,
  ModelBranch,
  ModelCommit,
  ModelOperationRequest,
  ModelOperationsPreview,
  ModelProfile,
  ModelSnapshotRecord,
} from "@interior-design/contracts";
import type { GeometryFinding } from "@interior-design/geometry-kernel";

import type { RequestCorrelation } from "../../../correlation.js";

export type ModelOperationClock = () => Date;
export type ModelOperationUuidFactory = () => string;

interface OperationCommandContext {
  readonly actor: Actor;
  readonly correlation: RequestCorrelation;
  readonly idempotencyKey: string;
  readonly profile: ModelProfile;
  readonly projectId: string;
}

export interface InitializeModelCommand extends OperationCommandContext {
  readonly expectedCurrentSnapshotSha256: null;
  readonly snapshot: CanonicalHomeSnapshot;
}

export interface CreateBranchCommand extends OperationCommandContext {
  readonly name: string;
  readonly sourceSnapshotId: string;
  readonly sourceSnapshotSha256: string;
}

export interface BranchCommandContext extends OperationCommandContext {
  readonly branchId: string;
}

export interface PreviewOperationsCommand extends BranchCommandContext {
  readonly expectedHeadSnapshotSha256: string;
  readonly expectedRevision: number;
  readonly operations: readonly ModelOperationRequest[];
}

export interface CommitOperationsCommand extends BranchCommandContext {
  readonly commitMessage: string;
  readonly expectedHeadSnapshotSha256: string;
  readonly expectedRevision: number;
  readonly previewId: string;
}

export interface RestoreBranchCommand extends BranchCommandContext {
  readonly expectedHeadSnapshotSha256: string;
  readonly expectedRevision: number;
  readonly reason: string;
  readonly sourceSnapshotId: string;
  readonly sourceSnapshotSha256: string;
}

export interface ModelCommitResponse {
  readonly branch: ModelBranch;
  readonly commit: ModelCommit;
  readonly findings: readonly GeometryFinding[];
}

export interface OperationHistoryRecord {
  readonly branchId: string;
  readonly clientOperationId: string;
  readonly commitId: string;
  readonly committedAt: string;
  readonly committedBy: string;
  readonly id: string;
  readonly ordinal: number;
  readonly projectId: string;
  readonly reason: string;
  readonly revision: number;
  readonly schemaVersion: "c5-model-operation-v1" | "c12-design-element-operation-v1";
  readonly type:
    | "element.metadata.correct.v1"
    | "element.provenance.correct.v1"
    | "design.element.create.v1"
    | "design.element.replace.v1"
    | "design.element.remove.v1"
    | "level.create.v1"
    | "opening.insert.v1"
    | "snapshot.initialize.v1"
    | "snapshot.restore.v1"
    | "space.create.v1"
    | "space.rename.v1"
    | "wall.create.v1"
    | "wall.translate.v1";
}

export interface OperationHistoryPage {
  readonly nextCursor?: string;
  readonly operations: readonly OperationHistoryRecord[];
}

export interface BranchComparison {
  readonly baseBranchId: string;
  readonly baseHeadSnapshotSha256: string;
  readonly changes: readonly {
    readonly elementId: string;
    readonly kind: "added" | "modified" | "removed";
  }[];
  readonly projectId: string;
  readonly targetBranchId: string;
  readonly targetHeadSnapshotSha256: string;
  readonly truncated: boolean;
}

export interface ReplayVerification {
  readonly branchId: string;
  readonly commitCount: number;
  readonly finalSnapshotSha256: string;
}

export interface ModelOperationRepository {
  initialize(command: InitializeModelCommand): Promise<{
    readonly record: ModelSnapshotRecord;
    readonly replayed: boolean;
  }>;
  createBranch(command: CreateBranchCommand): Promise<{
    readonly branch: ModelBranch;
    readonly replayed: boolean;
  }>;
  listBranches(
    tenantId: string,
    projectId: string,
    profile: ModelProfile,
  ): Promise<readonly ModelBranch[]>;
  getBranch(
    tenantId: string,
    projectId: string,
    profile: ModelProfile,
    branchId: string,
  ): Promise<ModelBranch | undefined>;
  preview(command: PreviewOperationsCommand): Promise<{
    readonly preview: ModelOperationsPreview;
    readonly replayed: boolean;
  }>;
  commit(command: CommitOperationsCommand): Promise<{
    readonly replayed: boolean;
    readonly response: ModelCommitResponse;
  }>;
  restore(command: RestoreBranchCommand): Promise<{
    readonly replayed: boolean;
    readonly response: ModelCommitResponse;
  }>;
  listOperations(
    tenantId: string,
    projectId: string,
    profile: ModelProfile,
    branchId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<OperationHistoryPage>;
  compareBranches(
    tenantId: string,
    projectId: string,
    profile: ModelProfile,
    branchId: string,
    targetBranchId: string,
  ): Promise<BranchComparison | undefined>;
  verifyReplay(
    tenantId: string,
    projectId: string,
    profile: ModelProfile,
    branchId: string,
  ): Promise<ReplayVerification | undefined>;
}
