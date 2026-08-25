import { describe, expect, it } from "vitest";

import {
  deriveHomeJourney,
  type HomeJourneyInput,
  type JourneyResource,
} from "../../../apps/web/src/features/homeowner-journey/journey-state";

const id = (value: number) => `14330000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const hash = (value: string) => value.repeat(64);
const ids = {
  brief: id(7),
  catalog: id(13),
  confirmation: id(10),
  current: id(3),
  existingScene: id(5),
  job: id(8),
  model: id(2),
  option: id(9),
  project: id(1),
  proposed: id(11),
  proposedScene: id(12),
  render: id(15),
  source: id(4),
  specification: id(14),
};

function ready<T>(value: T): JourneyResource<T> {
  return { kind: "ready", value };
}

function completeJourney(): HomeJourneyInput {
  const acceptedBrief = {
    contentSha256: hash("b"),
    id: ids.brief,
    revision: 2,
    status: "accepted" as const,
  };
  const optionJob = {
    baseBrief: {
      briefId: ids.brief,
      contentSha256: hash("b"),
      revision: 2,
    },
    confirmedOptionCount: 1,
    id: ids.job,
    optionCount: 2,
    safeCode: undefined,
    sourceModel: {
      modelId: ids.model,
      profile: "existing" as const,
      snapshotId: ids.current,
      snapshotSha256: hash("a"),
      snapshotVersion: 3,
    },
    state: "succeeded" as const,
  };
  const specification = {
    catalogReleaseId: ids.catalog,
    modelSnapshotId: ids.proposed,
    modelSnapshotSha256: hash("d"),
    revision: 4,
    sourceConfirmation: {
      acceptedBrief: optionJob.baseBrief,
      confirmationId: ids.confirmation,
      jobId: ids.job,
      jobVersion: 3,
      optionId: ids.option,
      profile: "proposed" as const,
      resultSnapshotId: id(16),
      resultSnapshotSha256: hash("c"),
      resultSnapshotVersion: 1,
    },
    specificationId: ids.specification,
  };

  return {
    branches: ready({
      branches: [{ headSnapshotId: ids.current, revision: 2, sourceSnapshotId: ids.source }],
    }),
    currentSnapshot: ready({
      modelId: ids.model,
      snapshotId: ids.current,
      snapshotSha256: hash("a"),
      snapshotVersion: 3,
    }),
    design: {
      consultation: ready({ brief: acceptedBrief }),
      options: ready({ confirmationInspectionComplete: true, jobs: [optionJob] }),
      renders: ready({
        jobs: [
          {
            id: ids.render,
            request: {
              sourceSceneJobId: ids.proposedScene,
              specification: {
                specificationId: ids.specification,
                specificationRevision: 4,
              },
            },
            safeCode: undefined,
            state: "succeeded",
          },
        ],
        renderer: {
          hardwareGate: "not-run",
          reason: "Creator-owned deterministic acceptance adapter.",
          state: "available",
        },
        sources: [
          {
            sourceSceneJobId: ids.proposedScene,
            specifications: [{ specificationId: ids.specification, specificationRevision: 4 }],
          },
        ],
      }),
      specifications: ready({ specifications: [specification] }),
    },
    evidence: ready({ assets: [{ kind: "plan", status: "ready" }] }),
    fusion: ready({ jobs: [] }),
    intake: ready({
      evidenceAvailable: {
        photographs: false,
        plans: true,
        roomCapture: false,
        video: false,
      },
      goals: ["Create a calm one-bedroom apartment"],
    }),
    plan: ready({ jobs: [{ state: "proposed" }] }),
    projectId: ids.project,
    property: ready({ confirmed: true }),
    reconstruction: ready({ jobs: [] }),
    role: "owner",
    scenes: ready({
      jobs: [
        {
          id: ids.existingScene,
          sourceProfile: "existing",
          sourceSnapshotId: ids.current,
          sourceSnapshotSha256: hash("a"),
          state: "succeeded",
        },
        {
          id: ids.proposedScene,
          sourceProfile: "proposed",
          sourceSnapshotId: ids.proposed,
          sourceSnapshotSha256: hash("d"),
          state: "succeeded",
        },
      ],
      snapshots: [{ profile: "existing", snapshotId: ids.current }],
    }),
  };
}

describe("C14.3 complete homeowner design-loop integration", () => {
  it("restores all five design stages from exact persisted service records", () => {
    const state = deriveHomeJourney(completeJourney());

    expect(state.designStages.map(({ status }) => status)).toEqual([
      "complete",
      "confirmed",
      "complete",
      "complete",
      "complete",
    ]);
    expect(state.primary).toMatchObject({
      href: `/render-stills/${ids.project}?jobId=${ids.render}`,
      id: "stills",
    });
  });

  it("accepts an evolved specification only when its original C12 source stays exact", () => {
    const state = deriveHomeJourney(completeJourney());
    const specification = state.designStages.find(({ id: stageId }) => stageId === "specification");
    const exploration = state.designStages.find(
      ({ id: stageId }) => stageId === "design-exploration",
    );

    expect(specification?.status).toBe("complete");
    expect(exploration).toMatchObject({
      href: `/viewer/${ids.project}?jobId=${ids.proposedScene}`,
      status: "complete",
    });
  });

  it("fails closed when the current twin changes without hiding readable earlier state", () => {
    const input = completeJourney();
    const state = deriveHomeJourney({
      ...input,
      currentSnapshot: ready({
        modelId: ids.model,
        snapshotId: id(99),
        snapshotSha256: hash("f"),
        snapshotVersion: 4,
      }),
    });

    expect(state.designStages.find(({ id: stageId }) => stageId === "consultation")?.status).toBe(
      "needs-attention",
    );
    expect(state.designStages.find(({ id: stageId }) => stageId === "design-options")?.status).toBe(
      "not-started",
    );
    expect(state.designStages.find(({ id: stageId }) => stageId === "stills")?.status).toBe(
      "needs-attention",
    );
  });

  it("degrades only C14 when the exact render host is unavailable", () => {
    const input = completeJourney();
    if (!input.design) throw new Error("Expected design state");
    const state = deriveHomeJourney({
      ...input,
      design: {
        ...input.design,
        renders: ready({
          jobs: [],
          renderer: {
            hardwareGate: "deferred",
            reason: "No authorised render host is configured.",
            state: "deferred",
          },
          sources: [],
        }),
      },
    });

    expect(state.designStages.slice(0, 4).map(({ status }) => status)).toEqual([
      "complete",
      "confirmed",
      "complete",
      "complete",
    ]);
    expect(state.designStages[4]).toMatchObject({ degraded: true, status: "unavailable" });
  });
});
