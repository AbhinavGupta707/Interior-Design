import {
  c10DefaultCompileConfiguration,
  type FusionOperationDraft,
  type ModelCommit,
  type ModelOperationsPreview,
  type SceneJob,
} from "@interior-design/contracts";

import type { editorClient } from "../editor-2d/api";
import type { sceneClient } from "../viewer-3d/api";

export type CanonicalCommitResult = Awaited<ReturnType<typeof editorClient.commit>>;

type PreviewClient = Pick<typeof editorClient, "preview">;
type CommitClient = Pick<typeof editorClient, "commit">;
type SceneHandoffClient = Pick<typeof sceneClient, "createJob" | "loadWorkspace">;

export type HandoffProblemCode =
  | "CURRENT_SNAPSHOT_UNAVAILABLE"
  | "PREVIEW_BLOCKED"
  | "PREVIEW_EXPIRED"
  | "PREVIEW_MISMATCH"
  | "VIEWER_CANNOT_COMPILE";

export class HandoffProblem extends Error {
  constructor(
    readonly code: HandoffProblemCode,
    message: string,
  ) {
    super(message);
    this.name = "HandoffProblem";
  }
}

function operationsMatch(draft: FusionOperationDraft, preview: ModelOperationsPreview): boolean {
  return JSON.stringify(draft.operations) === JSON.stringify(preview.operations);
}

export function assertExactPreview(
  draft: FusionOperationDraft,
  preview: ModelOperationsPreview,
): void {
  if (
    preview.branchId !== draft.branchId ||
    preview.baseRevision !== draft.expectedBranchRevision ||
    preview.baseHeadSnapshotSha256 !== draft.expectedHeadSnapshotSha256 ||
    !operationsMatch(draft, preview)
  ) {
    throw new HandoffProblem(
      "PREVIEW_MISMATCH",
      "The preview did not preserve the exact persisted C9 draft pins.",
    );
  }
}

export function assertPreviewCanCommit(
  draft: FusionOperationDraft,
  preview: ModelOperationsPreview,
  now = new Date(),
): void {
  assertExactPreview(draft, preview);
  if (preview.hasBlockingFindings) {
    throw new HandoffProblem("PREVIEW_BLOCKED", "Blocking geometry findings prevent commit.");
  }
  if (new Date(preview.expiresAt).getTime() <= now.getTime()) {
    throw new HandoffProblem("PREVIEW_EXPIRED", "The exact preview has expired.");
  }
}

export async function previewPersistedDraft(
  client: PreviewClient,
  projectId: string,
  draft: FusionOperationDraft,
): Promise<ModelOperationsPreview> {
  const preview = await client.preview(
    projectId,
    "existing",
    draft.branchId,
    draft.operations,
    draft.expectedBranchRevision,
    draft.expectedHeadSnapshotSha256,
  );
  assertExactPreview(draft, preview);
  return preview;
}

export async function commitPersistedDraftPreview(
  client: CommitClient,
  projectId: string,
  draft: FusionOperationDraft,
  preview: ModelOperationsPreview,
  now = new Date(),
): Promise<CanonicalCommitResult> {
  assertPreviewCanCommit(draft, preview, now);
  return client.commit(projectId, "existing", draft.branchId, {
    commitMessage: "Homeowner confirmed reviewed reconstruction corrections for exploration",
    expectedHeadSnapshotSha256: draft.expectedHeadSnapshotSha256,
    expectedRevision: draft.expectedBranchRevision,
    previewId: preview.id,
  });
}

export async function createSceneFromCommittedCurrent(
  client: SceneHandoffClient,
  projectId: string,
  commit: ModelCommit,
): Promise<SceneJob> {
  const workspace = await client.loadWorkspace(projectId);
  if (workspace.session.actor.role === "viewer") {
    throw new HandoffProblem("VIEWER_CANNOT_COMPILE", "Viewer roles cannot create scene jobs.");
  }
  const sourceSnapshot = workspace.snapshots.find(
    (snapshot) =>
      snapshot.profile === "existing" &&
      snapshot.snapshotId === commit.snapshotId &&
      snapshot.snapshotSha256 === commit.snapshotSha256,
  );
  if (!sourceSnapshot) {
    throw new HandoffProblem(
      "CURRENT_SNAPSHOT_UNAVAILABLE",
      "The committed snapshot is not yet exposed by the current C10 workspace.",
    );
  }
  return client.createJob(projectId, {
    configuration: c10DefaultCompileConfiguration,
    label: `Confirmed home twin · revision ${String(commit.revision)}`,
    sourceSnapshot,
  });
}
