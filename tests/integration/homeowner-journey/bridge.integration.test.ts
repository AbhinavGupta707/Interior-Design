import {
  modelCommitSchema,
  type ModelOperationsPreview,
} from "../../../packages/contracts/src/index";
import { describe, expect, it, vi } from "vitest";

import {
  commitPersistedDraftPreview,
  createSceneFromCommittedCurrent,
  previewPersistedDraft,
} from "../../../apps/web/src/features/homeowner-journey/canonical-handoff";
import {
  deriveHomeJourney,
  type HomeJourneyInput,
  type JourneyResource,
} from "../../../apps/web/src/features/homeowner-journey/journey-state";
import {
  branch,
  draft,
  project,
  snapshotRecord,
} from "../../../apps/web/test/model-fusion/fixtures";

const previewId = "e1410000-0000-4000-8000-000000000001";
const committedSnapshotId = "e1410000-0000-4000-8000-000000000002";
const resultHash = "e".repeat(64);

const preview: ModelOperationsPreview = {
  baseHeadSnapshotSha256: draft.expectedHeadSnapshotSha256,
  baseRevision: draft.expectedBranchRevision,
  branchId: draft.branchId,
  canonicalByteLength: 2_048,
  expiresAt: "2099-08-23T20:00:00.000Z",
  findings: [],
  hasBlockingFindings: false,
  id: previewId,
  operations: draft.operations,
  projectId: project.id,
  resultSnapshotSha256: resultHash,
};

const commit = modelCommitSchema.parse({
  branchId: draft.branchId,
  committedAt: "2026-08-23T18:03:00.000Z",
  committedBy: "e1410000-0000-4000-8000-000000000003",
  id: "e1410000-0000-4000-8000-000000000004",
  message: "Confirmed synthetic reconstruction corrections",
  operationIds: ["e1410000-0000-4000-8000-000000000005"],
  parentSnapshotSha256: draft.expectedHeadSnapshotSha256,
  projectId: project.id,
  revision: 1,
  snapshotId: committedSnapshotId,
  snapshotSha256: resultHash,
});

function ready<T>(value: T): JourneyResource<T> {
  return { kind: "ready", value };
}

function unavailable<T>(
  problem: "expired" | "forbidden" | "offline" | "unavailable",
): JourneyResource<T> {
  return { kind: "unavailable", problem };
}

function journeyInput(overrides: Partial<HomeJourneyInput> = {}): HomeJourneyInput {
  return {
    branches: ready({ revisions: [1] }),
    currentSnapshot: ready({ snapshotId: committedSnapshotId }),
    evidence: ready({ assets: [{ kind: "photograph", status: "ready" }] }),
    fusion: ready({ jobs: [{ state: "proposed" }] }),
    intake: ready({
      evidenceAvailable: { photographs: true, plans: false, roomCapture: false, video: false },
      goals: ["Improve the kitchen"],
    }),
    projectId: project.id,
    property: ready({ confirmed: true }),
    reconstruction: ready({ jobs: [{ state: "completed" }] }),
    role: "owner",
    scenes: ready({
      jobs: [],
      snapshots: [{ profile: "existing", snapshotId: committedSnapshotId }],
    }),
    ...overrides,
  };
}

describe("C14.1 bridge integration acceptance", () => {
  it("carries the exact persisted C9 operations and branch pins through preview, then commits only after a distinct call", async () => {
    const previewCall = vi.fn().mockResolvedValue(preview);
    const commitCall = vi.fn().mockResolvedValue({
      branch: {
        ...branch,
        headSnapshotId: commit.snapshotId,
        headSnapshotSha256: commit.snapshotSha256,
        revision: commit.revision,
      },
      commit,
      findings: [],
    });
    const exactPreview = await previewPersistedDraft({ preview: previewCall }, project.id, draft);

    expect(previewCall).toHaveBeenCalledExactlyOnceWith(
      project.id,
      "existing",
      draft.branchId,
      draft.operations,
      draft.expectedBranchRevision,
      draft.expectedHeadSnapshotSha256,
    );
    expect(commitCall).not.toHaveBeenCalled();

    await commitPersistedDraftPreview(
      { commit: commitCall },
      project.id,
      draft,
      exactPreview,
      new Date("2026-08-23T18:02:00.000Z"),
    );
    expect(commitCall).toHaveBeenCalledExactlyOnceWith(project.id, "existing", draft.branchId, {
      commitMessage: "Homeowner confirmed reviewed reconstruction corrections for exploration",
      expectedHeadSnapshotSha256: draft.expectedHeadSnapshotSha256,
      expectedRevision: draft.expectedBranchRevision,
      previewId,
    });
  });

  it("does not submit C10 until the current workspace exposes the exact committed ID/hash tuple", async () => {
    const createJob = vi.fn();
    const mismatched = {
      createJob,
      loadWorkspace: vi.fn().mockResolvedValue({
        jobs: [],
        project,
        session: { actor: { role: "owner" } },
        snapshots: [
          {
            modelId: snapshotRecord.modelId,
            profile: "existing",
            projectId: project.id,
            schemaVersion: "c4-canonical-home-v1",
            snapshotId: committedSnapshotId,
            snapshotSha256: "f".repeat(64),
          },
        ],
      }),
    } as unknown as Parameters<typeof createSceneFromCommittedCurrent>[0];
    await expect(
      createSceneFromCommittedCurrent(mismatched, project.id, commit),
    ).rejects.toMatchObject({
      code: "CURRENT_SNAPSHOT_UNAVAILABLE",
    });
    expect(createJob).not.toHaveBeenCalled();

    const sourceSnapshot = {
      modelId: snapshotRecord.modelId,
      profile: "existing" as const,
      projectId: project.id,
      schemaVersion: "c4-canonical-home-v1" as const,
      snapshotId: committedSnapshotId,
      snapshotSha256: resultHash,
    };
    const queued = { id: "e1410000-0000-4000-8000-000000000006", state: "queued" };
    const exact = {
      createJob: vi.fn().mockResolvedValue(queued),
      loadWorkspace: vi.fn().mockResolvedValue({
        jobs: [],
        project,
        session: { actor: { role: "owner" } },
        snapshots: [sourceSnapshot],
      }),
    } as unknown as Parameters<typeof createSceneFromCommittedCurrent>[0];
    await expect(createSceneFromCommittedCurrent(exact, project.id, commit)).resolves.toBe(queued);
    expect(exact.createJob).toHaveBeenCalledExactlyOnceWith(
      project.id,
      expect.objectContaining({ sourceSnapshot }),
    );
  });

  it("counts only a scene job with the current existing-profile snapshot and leaves stale/proposed jobs non-current", () => {
    const stale = deriveHomeJourney(
      journeyInput({
        scenes: ready({
          jobs: [
            {
              id: "e1410000-0000-4000-8000-000000000007",
              sourceProfile: "existing",
              sourceSnapshotId: "e1410000-0000-4000-8000-000000000008",
              state: "succeeded",
            },
            {
              id: "e1410000-0000-4000-8000-000000000009",
              sourceProfile: "proposed",
              sourceSnapshotId: committedSnapshotId,
              state: "succeeded",
            },
          ],
          snapshots: [{ profile: "existing", snapshotId: committedSnapshotId }],
        }),
      }),
    );
    expect(stale.stages.find(({ id }) => id === "twin")).toMatchObject({
      href: `/viewer/${project.id}`,
      status: "not-started",
    });

    const current = deriveHomeJourney(
      journeyInput({
        scenes: ready({
          jobs: [
            {
              id: "e1410000-0000-4000-8000-000000000010",
              sourceProfile: "existing",
              sourceSnapshotId: committedSnapshotId,
              state: "succeeded",
            },
          ],
          snapshots: [{ profile: "existing", snapshotId: committedSnapshotId }],
        }),
      }),
    );
    expect(current.stages.find(({ id }) => id === "twin")).toMatchObject({
      href: `/viewer/${project.id}?jobId=e1410000-0000-4000-8000-000000000010`,
      status: "complete",
    });
  });

  it("degrades only the proposal stage when either C8 or C9 is unavailable", () => {
    for (const input of [
      journeyInput({ reconstruction: unavailable("offline") }),
      journeyInput({ fusion: unavailable("unavailable") }),
    ]) {
      const state = deriveHomeJourney(input);
      const proposalStage = state.stages.find(({ id }) => id === "proposal");
      expect(proposalStage).toMatchObject({ degraded: true });
      expect(proposalStage?.detail).toContain("One proposal source is unavailable");
      expect(state.stages.find(({ id }) => id === "property")?.status).toBe("complete");
      expect(state.stages.find(({ id }) => id === "goals")?.status).toBe("complete");
      expect(state.stages.find(({ id }) => id === "evidence")?.status).toBe("complete");
    }
  });
});
