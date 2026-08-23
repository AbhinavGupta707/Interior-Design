import { describe, expect, it } from "vitest";

import {
  deriveHomeJourney,
  type HomeJourneyInput,
  type JourneyResource,
} from "../../src/features/homeowner-journey/journey-state";
import { homeJourneyHref } from "../../src/features/homeowner-journey/navigation";

const projectId = "00000000-0000-4000-8000-000000000101";
const sceneJobId = "00000000-0000-4000-8000-000000000102";

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
    branches: ready({ revisions: [] }),
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

describe("C14.1 homeowner journey derivation", () => {
  it("orders the six stages and selects one primary next action", () => {
    const result = deriveHomeJourney(input());
    expect(result.stages.map(({ id }) => id)).toEqual([
      "property",
      "goals",
      "evidence",
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
      input({ evidence: ready({ assets: [{ kind: "plan", status: "ready" }] }) }),
    );
    expect(plan.stages.find(({ id }) => id === "proposal")).toMatchObject({
      href: `/plan-import/${projectId}`,
      status: "not-started",
    });

    const media = deriveHomeJourney(
      input({ evidence: ready({ assets: [{ kind: "video", status: "ready" }] }) }),
    );
    expect(media.stages.find(({ id }) => id === "proposal")).toMatchObject({
      href: `/reconstruction/${projectId}`,
      status: "not-started",
    });
  });

  it("keeps viewer proposal, confirmation and scene controls read-only", () => {
    const result = deriveHomeJourney(
      input({
        branches: ready({ revisions: [1] }),
        currentSnapshot: ready({ snapshotId: "00000000-0000-4000-8000-000000000103" }),
        fusion: ready({ jobs: [{ state: "proposed" }] }),
        role: "viewer",
        scenes: ready({
          jobs: [],
          snapshots: [{ profile: "existing", snapshotId: "00000000-0000-4000-8000-000000000103" }],
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
        currentSnapshot: ready({ snapshotId: "00000000-0000-4000-8000-000000000103" }),
        scenes: ready({
          jobs: [],
          snapshots: [{ profile: "existing", snapshotId: "00000000-0000-4000-8000-000000000103" }],
        }),
      }),
    );
    expect(uncommitted.stages.find(({ id }) => id === "twin")).toMatchObject({
      href: `/fusion/${projectId}`,
      status: "needs-attention",
    });

    const committed = deriveHomeJourney(
      input({
        branches: ready({ revisions: [2] }),
        currentSnapshot: ready({ snapshotId: "00000000-0000-4000-8000-000000000103" }),
        scenes: ready({
          jobs: [
            {
              id: sceneJobId,
              sourceProfile: "existing",
              sourceSnapshotId: "00000000-0000-4000-8000-000000000103",
              state: "succeeded",
            },
          ],
          snapshots: [{ profile: "existing", snapshotId: "00000000-0000-4000-8000-000000000103" }],
        }),
      }),
    );
    expect(committed.stages.find(({ id }) => id === "twin")).toMatchObject({
      href: `/viewer/${projectId}?jobId=${sceneJobId}`,
      status: "complete",
    });

    const staleJob = deriveHomeJourney(
      input({
        branches: ready({ revisions: [2] }),
        currentSnapshot: ready({ snapshotId: "00000000-0000-4000-8000-000000000103" }),
        scenes: ready({
          jobs: [
            {
              id: sceneJobId,
              sourceProfile: "existing",
              sourceSnapshotId: "00000000-0000-4000-8000-000000000104",
              state: "succeeded",
            },
          ],
          snapshots: [{ profile: "existing", snapshotId: "00000000-0000-4000-8000-000000000103" }],
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
