import { describe, expect, it } from "vitest";

import {
  deriveHomeJourney,
  type HomeJourneyInput,
  type JourneyResource,
} from "../../src/features/homeowner-journey/journey-state";
import { homeJourneyHref } from "../../src/features/homeowner-journey/navigation";

const projectId = "00000000-0000-4000-8000-000000000101";
const sceneJobId = "00000000-0000-4000-8000-000000000102";
const currentSnapshotId = "00000000-0000-4000-8000-000000000103";
const sourceSnapshotId = "00000000-0000-4000-8000-000000000104";
const staleSnapshotId = "00000000-0000-4000-8000-000000000105";

function ready<T>(value: T): JourneyResource<T> {
  return { kind: "ready", value };
}

function unavailable<T>(
  problem: "expired" | "forbidden" | "offline" | "unavailable",
): JourneyResource<T> {
  return { kind: "unavailable", problem };
}

function input(overrides: Partial<HomeJourneyInput> = {}): HomeJourneyInput {
  return {
    branches: ready({ branches: [] }),
    currentSnapshot: ready(null),
    evidence: ready({ assets: [] }),
    fusion: ready({ jobs: [] }),
    intake: ready(null),
    projectId,
    property: ready({ confirmed: false }),
    reconstruction: ready({ jobs: [] }),
    role: "owner",
    scenes: ready({ jobs: [], snapshots: [] }),
    ...overrides,
  };
}

describe("C14.2 homeowner journey derivation", () => {
  it("orders the seven stages and selects one primary next action", () => {
    const result = deriveHomeJourney(input());
    expect(result.stages.map(({ id }) => id)).toEqual([
      "property",
      "goals",
      "evidence",
      "setup",
      "proposal",
      "confirmation",
      "twin",
    ]);
    expect(result.primary).toMatchObject({
      href: `/property/${projectId}`,
      id: "property",
      status: "not-started",
    });
    expect(result.stages.filter(({ href }) => href === result.primary.href)).not.toHaveLength(0);
  });

  it("preserves readable stages when independent requests fail", () => {
    const result = deriveHomeJourney(
      input({
        evidence: ready({
          assets: [{ kind: "photograph", status: "ready" }],
        }),
        currentSnapshot: ready({ snapshotId: currentSnapshotId }),
        fusion: unavailable("unavailable"),
        intake: ready({
          evidenceAvailable: {
            photographs: true,
            plans: false,
            roomCapture: false,
            video: false,
          },
          goals: ["Improve the kitchen"],
        }),
        property: unavailable("offline"),
        reconstruction: ready({ jobs: [{ state: "completed" }] }),
      }),
    );
    expect(result.stages.find(({ id }) => id === "property")).toMatchObject({
      status: "unavailable",
    });
    expect(result.stages.find(({ id }) => id === "goals")).toMatchObject({
      status: "complete",
    });
    expect(result.stages.find(({ id }) => id === "evidence")).toMatchObject({
      status: "complete",
    });
    expect(result.primary).toMatchObject({
      href: `/fusion/${projectId}`,
      id: "proposal",
      status: "needs-attention",
    });
    expect(result.primary).toMatchObject({ degraded: true });
    expect(result.primary.detail).toContain("One proposal source is unavailable");
  });

  it("routes ready plans to C6 and ready photo/video evidence to C8", () => {
    const plan = deriveHomeJourney(
      input({
        currentSnapshot: ready({ snapshotId: currentSnapshotId }),
        evidence: ready({ assets: [{ kind: "plan", status: "ready" }] }),
      }),
    );
    expect(plan.stages.find(({ id }) => id === "proposal")).toMatchObject({
      href: `/plan-import/${projectId}`,
      status: "not-started",
    });

    const media = deriveHomeJourney(
      input({
        currentSnapshot: ready({ snapshotId: currentSnapshotId }),
        evidence: ready({ assets: [{ kind: "video", status: "ready" }] }),
      }),
    );
    expect(media.stages.find(({ id }) => id === "proposal")).toMatchObject({
      href: `/reconstruction/${projectId}`,
      status: "not-started",
    });
  });
  it("routes a project with no existing snapshot to explicit setup before C6 or C9", () => {
    const missing = deriveHomeJourney(
      input({
        evidence: ready({ assets: [{ kind: "plan", status: "ready" }] }),
        intake: ready({
          evidenceAvailable: {
            photographs: false,
            plans: true,
            roomCapture: false,
            video: false,
          },
          goals: ["Correct the ready floor plan"],
        }),
        property: ready({ confirmed: true }),
      }),
    );
    expect(missing.primary).toMatchObject({
      href: `/editor/${projectId}`,
      id: "setup",
      status: "not-started",
    });
    expect(missing.stages.find(({ id }) => id === "proposal")).toMatchObject({
      href: `/editor/${projectId}`,
      status: "not-started",
    });

    const initialized = deriveHomeJourney(
      input({
        branches: ready({
          branches: [
            {
              headSnapshotId: currentSnapshotId,
              revision: 1,
              sourceSnapshotId: currentSnapshotId,
            },
          ],
        }),
        currentSnapshot: ready({ snapshotId: currentSnapshotId }),
        property: ready({ confirmed: true }),
      }),
    );
    expect(initialized.stages.find(({ id }) => id === "setup")).toMatchObject({
      status: "complete",
    });
    expect(initialized.stages.find(({ id }) => id === "confirmation")).toMatchObject({
      status: "not-started",
    });
    expect(initialized.stages.find(({ id }) => id === "twin")).toMatchObject({
      status: "needs-attention",
    });
  });

  it("confirms only a changed branch whose head is the exact current snapshot", () => {
    const confirmation = (branches: HomeJourneyInput["branches"]) =>
      deriveHomeJourney(
        input({
          branches,
          currentSnapshot: ready({ snapshotId: currentSnapshotId }),
        }),
      ).stages.find(({ id }) => id === "confirmation");

    const initializationOnly = confirmation(
      ready({
        branches: [
          {
            headSnapshotId: currentSnapshotId,
            revision: 1,
            sourceSnapshotId: currentSnapshotId,
          },
        ],
      }),
    );
    const staleChangedBranch = confirmation(
      ready({
        branches: [{ headSnapshotId: staleSnapshotId, revision: 3, sourceSnapshotId }],
      }),
    );
    const exactChangedBranch = confirmation(
      ready({
        branches: [{ headSnapshotId: currentSnapshotId, revision: 1, sourceSnapshotId }],
      }),
    );

    expect(initializationOnly).toMatchObject({ status: "not-started" });
    expect(staleChangedBranch).toMatchObject({ status: "not-started" });
    expect(exactChangedBranch).toMatchObject({ status: "confirmed" });
  });

  it("keeps viewer proposal, confirmation and scene controls read-only", () => {
    const result = deriveHomeJourney(
      input({
        branches: ready({
          branches: [{ headSnapshotId: currentSnapshotId, revision: 1, sourceSnapshotId }],
        }),
        currentSnapshot: ready({ snapshotId: currentSnapshotId }),
        fusion: ready({ jobs: [{ state: "proposed" }] }),
        role: "viewer",
        scenes: ready({
          jobs: [],
          snapshots: [{ profile: "existing", snapshotId: currentSnapshotId }],
        }),
      }),
    );
    expect(result.stages.find(({ id }) => id === "confirmation")).toMatchObject({
      actionLabel: "Inspect confirmed model",
      status: "confirmed",
    });
    expect(result.stages.find(({ id }) => id === "twin")).toMatchObject({
      actionLabel: "View scene status",
      status: "needs-attention",
    });
    expect(result.primary.actionLabel).not.toMatch(/compile|commit|preview/iu);
  });

  it("gates C10 on committed state and links the exact succeeded job", () => {
    const uncommitted = deriveHomeJourney(
      input({
        currentSnapshot: ready({ snapshotId: currentSnapshotId }),
        scenes: ready({
          jobs: [],
          snapshots: [{ profile: "existing", snapshotId: currentSnapshotId }],
        }),
      }),
    );
    expect(uncommitted.stages.find(({ id }) => id === "twin")).toMatchObject({
      href: homeJourneyHref(projectId),
      status: "needs-attention",
    });

    const committed = deriveHomeJourney(
      input({
        branches: ready({
          branches: [{ headSnapshotId: currentSnapshotId, revision: 2, sourceSnapshotId }],
        }),
        currentSnapshot: ready({ snapshotId: currentSnapshotId }),
        scenes: ready({
          jobs: [
            {
              id: sceneJobId,
              sourceProfile: "existing",
              sourceSnapshotId: currentSnapshotId,
              state: "succeeded",
            },
          ],
          snapshots: [{ profile: "existing", snapshotId: currentSnapshotId }],
        }),
      }),
    );
    expect(committed.stages.find(({ id }) => id === "twin")).toMatchObject({
      href: `/viewer/${projectId}?jobId=${sceneJobId}`,
      status: "complete",
    });

    const staleJob = deriveHomeJourney(
      input({
        branches: ready({
          branches: [{ headSnapshotId: currentSnapshotId, revision: 2, sourceSnapshotId }],
        }),
        currentSnapshot: ready({ snapshotId: currentSnapshotId }),
        scenes: ready({
          jobs: [
            {
              id: sceneJobId,
              sourceProfile: "existing",
              sourceSnapshotId: staleSnapshotId,
              state: "succeeded",
            },
          ],
          snapshots: [{ profile: "existing", snapshotId: currentSnapshotId }],
        }),
      }),
    );
    expect(staleJob.stages.find(({ id }) => id === "twin")).toMatchObject({
      href: `/viewer/${projectId}`,
      status: "not-started",
    });
  });

  it("uses the encoded home route for creation and resume navigation", () => {
    expect(homeJourneyHref("project id/unsafe")).toBe("/home/project%20id%2Funsafe");
  });
});
