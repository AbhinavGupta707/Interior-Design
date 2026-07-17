import { canonicalizeHomeSnapshot } from "@interior-design/domain-model";

import { ModelOperationError } from "./errors.js";
import { reduceModelOperations, validateAndCanonicalizeSnapshot } from "./reducer.js";
import { upcastModelOperation } from "./registry.js";
import type {
  ReplayResult,
  ReplaySnapshotSource,
  RetainedModelOperation,
  RetainedOperationCommit,
  SnapshotResolver,
} from "./types.js";

function assertSameBoundary(
  current: ReplaySnapshotSource["snapshot"],
  candidate: ReplaySnapshotSource["snapshot"],
): void {
  if (
    current.projectId !== candidate.projectId ||
    current.modelId !== candidate.modelId ||
    current.profile !== candidate.profile
  ) {
    throw new ModelOperationError(
      "SNAPSHOT_BOUNDARY_MISMATCH",
      "Replay attempted to cross a project, model, or profile boundary.",
    );
  }
}

async function applyInternalOperation(
  current: ReplaySnapshotSource,
  operation: Extract<RetainedModelOperation, { readonly type: `snapshot.${string}` }>,
  resolveSnapshot: SnapshotResolver,
): Promise<ReplaySnapshotSource> {
  if (operation.type === "snapshot.initialize.v1") {
    if (
      current.id !== operation.sourceSnapshotId ||
      current.snapshotSha256 !== operation.sourceSnapshotSha256
    ) {
      throw new ModelOperationError(
        "HISTORY_HASH_MISMATCH",
        "The initialization operation does not identify the branch source snapshot.",
      );
    }
    return current;
  }
  const source = await resolveSnapshot(operation.sourceSnapshotId, operation.sourceSnapshotSha256);
  if (
    source === undefined ||
    source.id !== operation.sourceSnapshotId ||
    source.snapshotSha256 !== operation.sourceSnapshotSha256
  ) {
    throw new ModelOperationError(
      "HISTORY_HASH_MISMATCH",
      "A restore source snapshot is absent or does not match its retained hash.",
    );
  }
  assertSameBoundary(current.snapshot, source.snapshot);
  const validated = validateAndCanonicalizeSnapshot(source.snapshot);
  if (validated.hasBlockingFindings || validated.snapshotSha256 !== source.snapshotSha256) {
    throw new ModelOperationError(
      "HISTORY_HASH_MISMATCH",
      "A restore source fails canonical integrity or geometry validation.",
    );
  }
  return { id: source.id, snapshot: validated.snapshot, snapshotSha256: validated.snapshotSha256 };
}

function isInternalOperation(
  operation: RetainedModelOperation,
): operation is Extract<RetainedModelOperation, { readonly type: `snapshot.${string}` }> {
  return operation.type === "snapshot.initialize.v1" || operation.type === "snapshot.restore.v1";
}

export async function replayModelOperationHistory(
  source: ReplaySnapshotSource,
  commits: readonly RetainedOperationCommit[],
  resolveSnapshot: SnapshotResolver,
): Promise<ReplayResult> {
  const sourceCanonical = canonicalizeHomeSnapshot(source.snapshot);
  if (sourceCanonical.snapshotSha256 !== source.snapshotSha256) {
    throw new ModelOperationError(
      "HISTORY_HASH_MISMATCH",
      "The branch source snapshot bytes do not match its retained hash.",
    );
  }
  let current: ReplaySnapshotSource = {
    id: source.id,
    snapshot: sourceCanonical.snapshot,
    snapshotSha256: sourceCanonical.snapshotSha256,
  };
  const revisions: Array<{ readonly revision: number; readonly snapshotSha256: string }> = [];

  for (let commitIndex = 0; commitIndex < commits.length; commitIndex += 1) {
    const commit = commits[commitIndex];
    if (commit === undefined || commit.revision !== commitIndex + 1) {
      throw new ModelOperationError(
        "HISTORY_REVISION_GAP",
        "Retained operation history contains a missing or reordered revision.",
      );
    }
    const sorted = [...commit.operations].sort((left, right) => left.ordinal - right.ordinal);
    sorted.forEach((envelope, ordinal) => {
      if (envelope.revision !== commit.revision || envelope.ordinal !== ordinal) {
        throw new ModelOperationError(
          "HISTORY_ORDINAL_GAP",
          "Retained operation history contains a missing or reordered ordinal.",
        );
      }
    });
    const operations = sorted.map(({ operation }) => upcastModelOperation(operation));
    const internal = operations.filter(isInternalOperation);
    if (internal.length > 0) {
      if (operations.length !== 1 || internal[0] === undefined) {
        throw new ModelOperationError(
          "INVALID_OPERATION",
          "Internal snapshot operations must be the sole operation in their commit.",
        );
      }
      current = await applyInternalOperation(current, internal[0], resolveSnapshot);
    } else {
      const result = reduceModelOperations(current.snapshot, operations);
      if (result.hasBlockingFindings) {
        throw new ModelOperationError(
          "HISTORY_HASH_MISMATCH",
          "Replayed history produces blocking geometry findings.",
        );
      }
      current = {
        id: current.id,
        snapshot: result.snapshot,
        snapshotSha256: result.snapshotSha256,
      };
    }
    if (current.snapshotSha256 !== commit.snapshotSha256) {
      throw new ModelOperationError(
        "HISTORY_HASH_MISMATCH",
        "Replayed history does not reproduce the committed snapshot hash.",
      );
    }
    revisions.push({ revision: commit.revision, snapshotSha256: commit.snapshotSha256 });
  }

  return Object.freeze({
    finalSnapshot: current.snapshot,
    finalSnapshotSha256: current.snapshotSha256,
    revisions: Object.freeze(revisions),
  });
}
