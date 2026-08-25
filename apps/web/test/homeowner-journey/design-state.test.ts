import { describe, expect, it } from "vitest";

import {
  deriveHomeJourney,
  type HomeJourneyInput,
  type JourneyResource,
} from "../../src/features/homeowner-journey/journey-state";

const id = (value: number) => `14300000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const hash = (value: string) => value.repeat(64);
const ids = {
  brief: id(8),
  catalog: id(17),
  confirmation: id(12),
  current: id(4),
  existingScene: id(6),
  job: id(9),
  model: id(3),
  option: id(11),
  project: id(1),
  proposed: id(14),
  proposedScene: id(15),
  render: id(18),
  source: id(5),
  specification: id(16),
};

function ready<T>(value: T): JourneyResource<T> {
  return { kind: "ready", value };
}

function designInput(overrides: Partial<HomeJourneyInput> = {}): HomeJourneyInput {
  return {
    branches: ready({
      branches: [{ headSnapshotId: ids.current, revision: 2, sourceSnapshotId: ids.source }],
    }),
    currentSnapshot: ready({
      modelId: ids.model,
      snapshotId: ids.current,
      snapshotSha256: hash("a"),
      snapshotVersion: 4,
    }),
    design: {
      consultation: ready({ brief: null }),
      options: ready({ confirmationInspectionComplete: true, jobs: [] }),
      renders: ready({
        jobs: [],
        renderer: { hardwareGate: "not-run", reason: "Synthetic adapter.", state: "available" },
        sources: [],
      }),
      specifications: ready({ specifications: [] }),
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
      goals: ["Create a calm living and dining room"],
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
      ],
      snapshots: [{ profile: "existing", snapshotId: ids.current }],
    }),
    ...overrides,
  };
}

const acceptedBrief = {
  contentSha256: hash("b"),
  id: ids.brief,
  revision: 3,
  status: "accepted" as const,
};

const exactOptionJob = {
  baseBrief: {
    briefId: ids.brief,
    contentSha256: hash("b"),
    revision: 3,
  },
  confirmedOptionCount: 0,
  id: ids.job,
  optionCount: 2,
  safeCode: undefined,
  sourceModel: {
    modelId: ids.model,
    profile: "existing" as const,
    snapshotId: ids.current,
    snapshotSha256: hash("a"),
    snapshotVersion: 4,
  },
  state: "succeeded" as const,
};

const specification = {
  catalogReleaseId: ids.catalog,
  modelSnapshotId: ids.proposed,
  modelSnapshotSha256: hash("d"),
  revision: 2,
  sourceConfirmation: {
    acceptedBrief: exactOptionJob.baseBrief,
    confirmationId: ids.confirmation,
    jobId: ids.job,
    jobVersion: 3,
    optionId: ids.option,
    profile: "proposed" as const,
    resultSnapshotId: id(13),
    resultSnapshotSha256: hash("c"),
    resultSnapshotVersion: 1,
  },
  specificationId: ids.specification,
};

function withAcceptedBrief(input: HomeJourneyInput): HomeJourneyInput {
  if (!input.design) throw new Error("Expected design state");
  return {
    ...input,
    design: { ...input.design, consultation: ready({ brief: acceptedBrief }) },
  };
}

describe("C14.3 persisted homeowner design journey", () => {
  it("extends one normal journey from an exact confirmed twin into C11-C14", () => {
    const result = deriveHomeJourney(designInput());
    expect(result.stages.map(({ id }) => id)).toEqual([
      "property",
      "goals",
      "evidence",
      "setup",
      "proposal",
      "confirmation",
      "twin",
      "consultation",
      "design-options",
      "specification",
      "design-exploration",
      "stills",
    ]);
    expect(result.primary).toMatchObject({
      href: `/design-consultation/${ids.project}`,
      id: "consultation",
      status: "not-started",
    });
  });

  it("launches two options only from the accepted brief and full current snapshot pins", () => {
    const result = deriveHomeJourney(withAcceptedBrief(designInput()));
    const stage = result.designStages.find(({ id }) => id === "design-options");
    expect(stage).toMatchObject({ actionLabel: "Generate two options", status: "not-started" });
    expect(stage?.href).toContain(`/design-options/${ids.project}?`);
    expect(stage?.href).toContain(`snapshotId=${ids.current}`);
    expect(stage?.href).toContain("optionCount=2");
  });

  it("does not advance from an option job pinned to an older twin", () => {
    const base = withAcceptedBrief(designInput());
    if (!base.design) throw new Error("Expected design state");
    const result = deriveHomeJourney({
      ...base,
      design: {
        ...base.design,
        options: ready({
          confirmationInspectionComplete: true,
          jobs: [
            {
              ...exactOptionJob,
              confirmedOptionCount: 1,
              sourceModel: { ...exactOptionJob.sourceModel, snapshotId: id(99) },
            },
          ],
        }),
      },
    });
    expect(result.designStages.find(({ id }) => id === "design-options")).toMatchObject({
      status: "not-started",
    });
    expect(result.designStages.find(({ id }) => id === "specification")).toMatchObject({
      status: "needs-attention",
    });
  });

  it("marks a genuinely comparable exact option set proposal-ready before confirmation", () => {
    const base = withAcceptedBrief(designInput());
    if (!base.design) throw new Error("Expected design state");
    const result = deriveHomeJourney({
      ...base,
      design: {
        ...base.design,
        options: ready({ confirmationInspectionComplete: true, jobs: [exactOptionJob] }),
      },
    });
    expect(result.primary).toMatchObject({ id: "design-options", status: "proposal-ready" });
  });

  it("follows a confirmed option through an evolved C13 revision and exact proposed C10 scene", () => {
    const base = withAcceptedBrief(designInput());
    if (!base.design || base.scenes.kind !== "ready") throw new Error("Expected ready state");
    const result = deriveHomeJourney({
      ...base,
      design: {
        ...base.design,
        options: ready({
          confirmationInspectionComplete: true,
          jobs: [{ ...exactOptionJob, confirmedOptionCount: 1 }],
        }),
        renders: ready({
          jobs: [],
          renderer: {
            hardwareGate: "not-run",
            reason: "Synthetic adapter.",
            state: "available",
          },
          sources: [
            {
              sourceSceneJobId: ids.proposedScene,
              specifications: [{ specificationId: ids.specification, specificationRevision: 2 }],
            },
          ],
        }),
        specifications: ready({ specifications: [specification] }),
      },
      scenes: ready({
        ...base.scenes.value,
        jobs: [
          ...base.scenes.value.jobs,
          {
            id: ids.proposedScene,
            sourceProfile: "proposed",
            sourceSnapshotId: ids.proposed,
            sourceSnapshotSha256: hash("d"),
            state: "succeeded",
          },
        ],
      }),
    });
    expect(result.designStages.map(({ status }) => status)).toEqual([
      "complete",
      "confirmed",
      "complete",
      "complete",
      "not-started",
    ]);
    const stills = result.designStages.find(({ id }) => id === "stills");
    expect(stills?.href).toContain(`sourceSceneJobId=${ids.proposedScene}`);
    expect(stills?.href).toContain(`specificationId=${ids.specification}`);
    expect(stills?.href).toContain("specificationRevision=2");
  });

  it("keeps design mutations unavailable to a viewer while retaining readable progress", () => {
    const result = deriveHomeJourney(withAcceptedBrief(designInput({ role: "viewer" })));
    expect(result.designStages.find(({ id }) => id === "consultation")).toMatchObject({
      status: "complete",
    });
    expect(result.designStages.find(({ id }) => id === "design-options")).toMatchObject({
      actionLabel: "Inspect option readiness",
      status: "unavailable",
    });
  });
});
