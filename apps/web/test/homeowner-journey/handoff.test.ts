import type {
  FusionOperationDraft,
  ModelCommit,
  ModelOperationsPreview,
} from "@interior-design/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  commitPersistedDraftPreview,
  createSceneFromCommittedCurrent,
  previewPersistedDraft,
} from "../../src/features/homeowner-journey/canonical-handoff";
import { EditorProblem } from "../../src/features/editor-2d/api";

const projectId = "00000000-0000-4000-8000-000000000201";
const branchId = "00000000-0000-4000-8000-000000000202";
const previewId = "00000000-0000-4000-8000-000000000203";
const snapshotId = "00000000-0000-4000-8000-000000000204";
const modelId = "00000000-0000-4000-8000-000000000205";
const hash = "a".repeat(64);
const resultHash = "b".repeat(64);

const operation = {
  clientOperationId: "00000000-0000-4000-8000-000000000206",
  input: {
    collection: "spaces",
    elementId: "00000000-0000-4000-8000-000000000207",
    name: "Kitchen",
  },
  reason: "Homeowner accepted the reviewed discrepancy",
  schemaVersion: "c5-model-operation-v1",
  type: "space.rename.v1",
};

const draft = {
  baseSnapshot: {
    modelId,
    profile: "existing",
    snapshotId,
    snapshotSha256: hash,
  },
  branchId,
  decisionIds: ["00000000-0000-4000-8000-000000000208"],
  expectedBranchRevision: 2,
  expectedHeadSnapshotSha256: hash,
  operations: [operation],
  projectId,
  proposalId: "00000000-0000-4000-8000-000000000209",
  schemaVersion: "c9-operation-draft-v1",
} as unknown as FusionOperationDraft;

function preview(overrides: Partial<ModelOperationsPreview> = {}): ModelOperationsPreview {
  return {
    baseHeadSnapshotSha256: hash,
    baseRevision: 2,
    branchId,
    canonicalByteLength: 512,
    expiresAt: "2030-01-01T12:00:00.000Z",
    findings: [],
    hasBlockingFindings: false,
    id: previewId,
    operations: draft.operations,
    projectId,
    resultSnapshotSha256: resultHash,
    ...overrides,
  };
}

const commit: ModelCommit = {
  branchId,
  committedAt: "2026-08-23T12:00:00.000Z",
  committedBy: "00000000-0000-4000-8000-000000000210",
  id: "00000000-0000-4000-8000-000000000211",
  message: "Confirmed",
  operationIds: ["00000000-0000-4000-8000-000000000212"],
  parentSnapshotSha256: hash,
  projectId,
  revision: 3,
  snapshotId,
  snapshotSha256: resultHash,
};

describe("C14.1 exact C9 to C5 to C10 handoff", () => {
  it("previews and commits with the unchanged persisted draft pins", async () => {
    const previewCall = vi.fn().mockResolvedValue(preview());
    const previewClient = {
      preview: previewCall,
    } as unknown as Parameters<typeof previewPersistedDraft>[0];
    const exactPreview = await previewPersistedDraft(previewClient, projectId, draft);
    expect(previewCall).toHaveBeenCalledExactlyOnceWith(
      projectId,
      "existing",
      branchId,
      draft.operations,
      2,
      hash,
    );

    const response = {
      branch: { id: branchId },
      commit,
      findings: [],
    } as unknown as Awaited<ReturnType<typeof commitPersistedDraftPreview>>;
    const commitCall = vi.fn().mockResolvedValue(response);
    const commitClient = {
      commit: commitCall,
    } as unknown as Parameters<typeof commitPersistedDraftPreview>[0];
    await commitPersistedDraftPreview(
      commitClient,
      projectId,
      draft,
      exactPreview,
      new Date("2026-08-23T12:00:00.000Z"),
    );
    expect(commitCall).toHaveBeenCalledExactlyOnceWith(projectId, "existing", branchId, {
      commitMessage: "Homeowner confirmed reviewed reconstruction corrections for exploration",
      expectedHeadSnapshotSha256: hash,
      expectedRevision: 2,
      previewId,
    });
  });

  it("never calls commit for blocking, expired or mismatched previews", async () => {
    const commitCall = vi.fn();
    const client = {
      commit: commitCall,
    } as unknown as Parameters<typeof commitPersistedDraftPreview>[0];

    await expect(
      commitPersistedDraftPreview(client, projectId, draft, preview({ hasBlockingFindings: true })),
    ).rejects.toMatchObject({ code: "PREVIEW_BLOCKED" });
    await expect(
      commitPersistedDraftPreview(
        client,
        projectId,
        draft,
        preview({ expiresAt: "2020-01-01T00:00:00.000Z" }),
        new Date("2026-08-23T12:00:00.000Z"),
      ),
    ).rejects.toMatchObject({ code: "PREVIEW_EXPIRED" });
    await expect(
      commitPersistedDraftPreview(
        client,
        projectId,
        draft,
        preview({ baseHeadSnapshotSha256: "c".repeat(64) }),
      ),
    ).rejects.toMatchObject({ code: "PREVIEW_MISMATCH" });
    expect(commitCall).not.toHaveBeenCalled();
  });

  it("propagates stale and offline failures once without retry or merge", async () => {
    for (const problem of [
      new EditorProblem("conflict", "stale", 409, "BRANCH_REVISION_CONFLICT"),
      new EditorProblem("offline", "offline"),
    ]) {
      const commitCall = vi.fn().mockRejectedValue(problem);
      const client = {
        commit: commitCall,
      } as unknown as Parameters<typeof commitPersistedDraftPreview>[0];
      await expect(
        commitPersistedDraftPreview(
          client,
          projectId,
          draft,
          preview(),
          new Date("2026-08-23T12:00:00.000Z"),
        ),
      ).rejects.toBe(problem);
      expect(commitCall).toHaveBeenCalledTimes(1);
    }
  });

  it("creates C10 only from the matching current-workspace snapshot", async () => {
    const sourceSnapshot = {
      modelId,
      profile: "existing" as const,
      projectId,
      schemaVersion: "c4-canonical-home-v1" as const,
      snapshotId,
      snapshotSha256: resultHash,
    };
    const loadWorkspace = vi.fn().mockResolvedValue({
      jobs: [],
      project: { id: projectId },
      session: { actor: { role: "owner" } },
      snapshots: [sourceSnapshot],
    });
    const sceneJob = { id: "00000000-0000-4000-8000-000000000213", state: "queued" };
    const createJob = vi.fn().mockResolvedValue(sceneJob);
    const client = {
      createJob,
      loadWorkspace,
    } as unknown as Parameters<typeof createSceneFromCommittedCurrent>[0];

    await expect(createSceneFromCommittedCurrent(client, projectId, commit)).resolves.toBe(
      sceneJob,
    );
    expect(loadWorkspace).toHaveBeenCalledExactlyOnceWith(projectId);
    expect(createJob).toHaveBeenCalledExactlyOnceWith(
      projectId,
      expect.objectContaining({
        label: "Confirmed home twin · revision 3",
        sourceSnapshot,
      }),
    );
  });

  it("fails scene creation closed for viewer or a missing current snapshot", async () => {
    const createJob = vi.fn();
    const viewerClient = {
      createJob,
      loadWorkspace: vi.fn().mockResolvedValue({
        session: { actor: { role: "viewer" } },
        snapshots: [],
      }),
    } as unknown as Parameters<typeof createSceneFromCommittedCurrent>[0];
    await expect(
      createSceneFromCommittedCurrent(viewerClient, projectId, commit),
    ).rejects.toMatchObject({ code: "VIEWER_CANNOT_COMPILE" });

    const missingClient = {
      createJob,
      loadWorkspace: vi.fn().mockResolvedValue({
        session: { actor: { role: "owner" } },
        snapshots: [],
      }),
    } as unknown as Parameters<typeof createSceneFromCommittedCurrent>[0];
    await expect(
      createSceneFromCommittedCurrent(missingClient, projectId, commit),
    ).rejects.toMatchObject({ code: "CURRENT_SNAPSHOT_UNAVAILABLE" });
    expect(createJob).not.toHaveBeenCalled();
  });
});
