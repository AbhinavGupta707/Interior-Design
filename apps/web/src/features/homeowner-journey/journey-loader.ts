import type { Project, Session } from "@interior-design/contracts";

import { ClientProblem, getProject, getProjectIntake, getSession } from "../auth/api";
import { listAssets, EvidenceProblem } from "../evidence/api";
import { fusionClient, FusionProblem } from "../discrepancy-review/api";
import { editorClient, EditorProblem } from "../editor-2d/api";
import { planImportClient, PlanImportProblem } from "../plan-import/api";
import { getPropertyDossier, PropertyProblem } from "../property/api";
import { reconstructionClient, ReconstructionProblem } from "../reconstruction/api";
import { sceneClient, SceneProblem } from "../viewer-3d/api";

import type { HomeJourneyInput, JourneyProblemKind, JourneyResource } from "./journey-state";

export interface LoadedHomeJourney {
  readonly input: HomeJourneyInput;
  readonly project: Project;
  readonly session: Session;
}

function problemKind(reason: unknown): JourneyProblemKind {
  if (
    reason instanceof ClientProblem ||
    reason instanceof EvidenceProblem ||
    reason instanceof FusionProblem ||
    reason instanceof EditorProblem ||
    reason instanceof PlanImportProblem ||
    reason instanceof PropertyProblem ||
    reason instanceof ReconstructionProblem ||
    reason instanceof SceneProblem
  ) {
    if (reason.kind === "expired") return "expired";
    if (reason.kind === "forbidden") return "forbidden";
    if (reason.kind === "offline") return "offline";
  }
  return "unavailable";
}

function resource<T, U>(
  result: PromiseSettledResult<T>,
  select: (value: T) => U,
): JourneyResource<U> {
  return result.status === "fulfilled"
    ? { kind: "ready", value: select(result.value) }
    : { kind: "unavailable", problem: problemKind(result.reason) };
}

async function currentSnapshot(projectId: string) {
  try {
    return await editorClient.getCurrentSnapshot(projectId, "existing");
  } catch (reason) {
    if (reason instanceof EditorProblem && reason.kind === "not-found") return null;
    throw reason;
  }
}

export async function loadHomeJourney(projectId: string): Promise<LoadedHomeJourney> {
  const [project, session] = await Promise.all([getProject(projectId), getSession()]);
  const [intake, property, evidence, plan, reconstruction, fusion, snapshot, branches, scenes] =
    await Promise.allSettled([
      getProjectIntake(projectId),
      getPropertyDossier(projectId),
      listAssets(projectId),
      planImportClient.loadWorkspace(projectId),
      reconstructionClient.loadWorkspace(projectId),
      fusionClient.loadWorkspace(projectId),
      currentSnapshot(projectId),
      editorClient.listBranches(projectId, "existing"),
      sceneClient.loadWorkspace(projectId),
    ]);

  return {
    input: {
      branches: resource(branches, (items) => ({
        branches: items.map(({ headSnapshotId, revision, sourceSnapshotId }) => ({
          headSnapshotId,
          revision,
          sourceSnapshotId,
        })),
      })),
      currentSnapshot: resource(snapshot, (item) =>
        item === null ? null : { snapshotId: item.id },
      ),
      evidence: resource(evidence, (assets) => ({
        assets: assets.map(({ kind, status }) => ({ kind, status })),
      })),
      fusion: resource(fusion, (workspace) => ({
        jobs: workspace.jobs.map(({ state }) => ({ state })),
      })),
      intake: resource(intake, (value) =>
        value === null
          ? null
          : {
              evidenceAvailable: value.intake.evidenceAvailable,
              goals: value.intake.goals,
            },
      ),
      plan: resource(plan, (workspace) => ({
        jobs: workspace.jobs.map(({ state }) => ({ state })),
      })),
      projectId,
      property: resource(property, (dossier) => ({ confirmed: dossier !== null })),
      reconstruction: resource(reconstruction, (workspace) => ({
        jobs: workspace.jobs.map(({ state }) => ({ state })),
      })),
      role: session.actor.role,
      scenes: resource(scenes, (workspace) => ({
        jobs: workspace.jobs.map(({ id, request, state }) => ({
          id,
          sourceProfile: request.sourceSnapshot.profile,
          sourceSnapshotId: request.sourceSnapshot.snapshotId,
          state,
        })),
        snapshots: workspace.snapshots.map(({ profile, snapshotId }) => ({ profile, snapshotId })),
      })),
    },
    project,
    session,
  };
}
