import type { GeometryFinding } from "@interior-design/geometry-kernel";

export class BranchRevisionConflictError extends Error {
  readonly branchId: string;
  readonly currentHeadSnapshotSha256: string;
  readonly currentRevision: number;

  constructor(input: {
    readonly branchId: string;
    readonly currentHeadSnapshotSha256: string;
    readonly currentRevision: number;
  }) {
    super("The branch head changed before the requested operation could be applied.");
    this.name = "BranchRevisionConflictError";
    this.branchId = input.branchId;
    this.currentHeadSnapshotSha256 = input.currentHeadSnapshotSha256;
    this.currentRevision = input.currentRevision;
  }
}

export class ModelOperationValidationError extends Error {
  readonly findings: readonly GeometryFinding[];

  constructor(message: string, findings: readonly GeometryFinding[] = []) {
    super(message);
    this.name = "ModelOperationValidationError";
    this.findings = findings;
  }
}
