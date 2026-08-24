import { describe, expect, it } from "vitest";

import {
  buildUnmeasuredHomeWorkspaceRequest,
  homeWorkspaceAcknowledgementSchema,
} from "../../../apps/web/src/app/api/c5/_shared/home-workspace";
import {
  deriveHomeJourney,
  type HomeJourneyInput,
} from "../../../apps/web/src/features/homeowner-journey/journey-state";
import { buildOperationDraftInput } from "../../../apps/web/src/features/plan-import/review-model";
import {
  calibration,
  proposal,
  session,
} from "../../../apps/web/test/plan-import/fixtures";

const projectId = "e1420000-0000-4000-8000-000000000001";
const setupSnapshotId = "e1420000-0000-4000-8000-000000000002";
const committedSnapshotId = "e1420000-0000-4000-8000-000000000005";
const sceneJobId = "e1420000-0000-4000-8000-00000000000b";

function journey(overrides: Partial<HomeJourneyInput> = {}): HomeJourneyInput {
  return {
    branches: {
      kind: "ready",
      value: {
        branches: [
          {
            headSnapshotId: setupSnapshotId,
            revision: 1,
            sourceSnapshotId: setupSnapshotId,
          },
        ],
      },
    },
    currentSnapshot: { kind: "ready", value: { snapshotId: setupSnapshotId } },
    evidence: { kind: "ready", value: { assets: [{ kind: "plan", status: "ready" }] } },
    fusion: { kind: "ready", value: { jobs: [] } },
    intake: {
      kind: "ready",
      value: {
        evidenceAvailable: {
          photographs: false,
          plans: true,
          roomCapture: false,
          video: false,
        },
        goals: ["Correct the plan"],
      },
    },
    plan: { kind: "ready", value: { jobs: [{ state: "proposed" }] } },
    projectId,
    property: { kind: "ready", value: { confirmed: true } },
    reconstruction: { kind: "ready", value: { jobs: [] } },
    role: "owner",
    scenes: {
      kind: "ready",
      value: {
        jobs: [],
        snapshots: [{ profile: "existing", snapshotId: setupSnapshotId }],
      },
    },
    ...overrides,
  };
}

describe("C14.2 persisted homeowner setup integration", () => {
  it("accepts only the acknowledgement and server-binds actor, property and unknown provenance", () => {
    expect(homeWorkspaceAcknowledgementSchema.parse({ confirmUnmeasuredInterior: true })).toEqual({
      confirmUnmeasuredInterior: true,
    });
    expect(() =>
      homeWorkspaceAcknowledgementSchema.parse({
        actorUserId: session.actor.userId,
        confirmUnmeasuredInterior: true,
      }),
    ).toThrow();

    const request = buildUnmeasuredHomeWorkspaceRequest({
      actorUserId: session.actor.userId,
      idempotencyKey: "integration-acknowledgement-key",
      projectId,
      propertyId: "e1420000-0000-4000-8000-000000000012",
    });
    const level = request.snapshot.elements.levels[0];
    expect(request.expectedCurrentSnapshotSha256).toBeNull();
    expect(request.snapshot).toMatchObject({
      coordinateSystem: { globalAnchor: { status: "not-established" } },
      profile: "existing",
      projectId,
      propertyId: "e1420000-0000-4000-8000-000000000012",
    });
    expect(level?.origin).toMatchObject({
      actorUserId: session.actor.userId,
      evidenceIds: [],
      state: "user-asserted",
    });
    expect(level?.name).toMatchObject({ knowledge: "unknown" });
    expect(level?.elevationMm).toMatchObject({ knowledge: "unknown" });
    expect(level?.storeyHeightMm).toMatchObject({ knowledge: "unknown" });
    expect(request.snapshot.knownLimitations.map(({ code }) => code)).toContain(
      "PROPERTY_CONTEXT_PROVES_NO_INTERIOR",
    );
    for (const [kind, values] of Object.entries(request.snapshot.elements)) {
      if (kind !== "levels") expect(values).toEqual([]);
    }
  });

  it("keeps setup and proposal non-canonical until an exact changed current branch is committed", () => {
    const initialized = deriveHomeJourney(journey());
    expect(initialized.stages.find(({ id }) => id === "setup")?.status).toBe("complete");
    expect(initialized.stages.find(({ id }) => id === "proposal")?.status).toBe(
      "proposal-ready",
    );
    expect(initialized.stages.find(({ id }) => id === "confirmation")?.status).toBe(
      "proposal-ready",
    );
    expect(initialized.stages.find(({ id }) => id === "twin")?.status).toBe("needs-attention");

    const committed = journey({
      branches: {
        kind: "ready",
        value: {
          branches: [
            {
              headSnapshotId: committedSnapshotId,
              revision: 2,
              sourceSnapshotId: setupSnapshotId,
            },
          ],
        },
      },
      currentSnapshot: { kind: "ready", value: { snapshotId: committedSnapshotId } },
      scenes: {
        kind: "ready",
        value: {
          jobs: [],
          snapshots: [{ profile: "existing", snapshotId: committedSnapshotId }],
        },
      },
    });
    const committedState = deriveHomeJourney(committed);
    expect(committedState.stages.find(({ id }) => id === "confirmation")?.status).toBe(
      "confirmed",
    );
    expect(committedState.stages.find(({ id }) => id === "twin")?.actionLabel).toBe(
      "Compile committed twin",
    );

    const wrongScene = deriveHomeJourney({
      ...committed,
      scenes: {
        kind: "ready",
        value: {
          jobs: [
            {
              id: sceneJobId,
              sourceProfile: "existing",
              sourceSnapshotId: setupSnapshotId,
              state: "succeeded",
            },
          ],
          snapshots: [{ profile: "existing", snapshotId: committedSnapshotId }],
        },
      },
    });
    expect(wrongScene.stages.find(({ id }) => id === "twin")?.status).toBe("not-started");

    const exactScene = deriveHomeJourney({
      ...committed,
      scenes: {
        kind: "ready",
        value: {
          jobs: [
            {
              id: sceneJobId,
              sourceProfile: "existing",
              sourceSnapshotId: committedSnapshotId,
              state: "succeeded",
            },
          ],
          snapshots: [{ profile: "existing", snapshotId: committedSnapshotId }],
        },
      },
    });
    expect(exactScene.stages.find(({ id }) => id === "twin")).toMatchObject({
      actionLabel: "Explore exact viewer job",
      status: "complete",
    });
  });

  it("builds actor-bound typed operations while the C6 proposal itself remains only a draft input", () => {
    const reviews = Object.fromEntries(
      proposal.candidates.map(({ candidateId }) => [candidateId, { decision: "accepted" }]),
    );
    const result = buildOperationDraftInput({
      actorUserId: session.actor.userId,
      calibration,
      proposal,
      reviews,
    });
    expect(result.decisions).toHaveLength(proposal.candidates.length);
    expect(result.decisions.every(({ decision }) => decision === "accepted")).toBe(true);
    expect(result.operations).toHaveLength(proposal.candidates.length);
    expect(result.operations.every(({ schemaVersion }) => schemaVersion === "c5-model-operation-v1"))
      .toBe(true);
    expect(result).not.toHaveProperty("commit");
    expect(result).not.toHaveProperty("snapshot");
  });

  it("preserves readable unavailable state without inferring completion", () => {
    const unavailable = deriveHomeJourney(
      journey({
        currentSnapshot: { kind: "unavailable", problem: "unavailable" },
        scenes: { kind: "unavailable", problem: "offline" },
      }),
    );
    expect(unavailable.stages.find(({ id }) => id === "setup")?.status).toBe("unavailable");
    expect(unavailable.stages.find(({ id }) => id === "proposal")?.status).toBe("unavailable");
    expect(unavailable.stages.find(({ id }) => id === "twin")?.status).toBe("unavailable");
  });
});
