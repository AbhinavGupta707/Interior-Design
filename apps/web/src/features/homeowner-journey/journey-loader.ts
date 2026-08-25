import type { Project, Session } from "@interior-design/contracts";

import { ClientProblem, getProject, getProjectIntake, getSession } from "../auth/api";
import { consultationClient, ConsultationProblem } from "../design-consultation/api";
import { designOptionsClient, DesignOptionsProblem } from "../design-options/api";
import { listAssets, EvidenceProblem } from "../evidence/api";
import { fusionClient, FusionProblem } from "../discrepancy-review/api";
import { editorClient, EditorProblem } from "../editor-2d/api";
import { materialsProductsClient, MaterialsProductsProblem } from "../materials-products/api";
import { planImportClient, PlanImportProblem } from "../plan-import/api";
import { getPropertyDossier, PropertyProblem } from "../property/api";
import { reconstructionClient, ReconstructionProblem } from "../reconstruction/api";
import { renderStillsClient, RenderStillsProblem } from "../render-stills/api";
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
    reason instanceof ConsultationProblem ||
    reason instanceof DesignOptionsProblem ||
    reason instanceof EvidenceProblem ||
    reason instanceof FusionProblem ||
    reason instanceof EditorProblem ||
    reason instanceof MaterialsProductsProblem ||
    reason instanceof PlanImportProblem ||
    reason instanceof PropertyProblem ||
    reason instanceof ReconstructionProblem ||
    reason instanceof RenderStillsProblem ||
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

const maximumJourneyOptionInspections = 12;

async function loadDesignOptions(
  projectId: string,
  snapshot: Awaited<ReturnType<typeof currentSnapshot>> | undefined,
) {
  const response = await designOptionsClient.listJobs(projectId);
  const exactSucceeded = snapshot
    ? [...response.jobs]
        .reverse()
        .filter(
          ({ sourceModel, state }) =>
            state === "succeeded" &&
            sourceModel.modelId === snapshot.modelId &&
            sourceModel.snapshotId === snapshot.id &&
            sourceModel.snapshotSha256 === snapshot.snapshotSha256 &&
            sourceModel.snapshotVersion === snapshot.version,
        )
    : [];
  const inspected = exactSucceeded.slice(0, maximumJourneyOptionInspections);
  const optionResponses = await Promise.allSettled(
    inspected.map((job) => designOptionsClient.listOptions(projectId, job.id)),
  );
  const confirmationCounts = new Map<string, number | undefined>();
  inspected.forEach((job, index) => {
    const optionResponse = optionResponses[index];
    confirmationCounts.set(
      job.id,
      optionResponse?.status === "fulfilled"
        ? optionResponse.value.options.filter(({ status }) => status === "confirmed").length
        : undefined,
    );
  });

  return {
    confirmationInspectionComplete:
      exactSucceeded.length <= maximumJourneyOptionInspections &&
      optionResponses.every(({ status }) => status === "fulfilled"),
    jobs: response.jobs.map((job) => ({
      baseBrief: job.baseBrief,
      confirmedOptionCount: confirmationCounts.get(job.id),
      id: job.id,
      optionCount: job.optionCount,
      safeCode: job.safeCode,
      sourceModel: job.sourceModel,
      state: job.state,
    })),
  };
}

async function loadRenderState(projectId: string) {
  const [capabilities, jobs] = await Promise.all([
    renderStillsClient.getCapabilities(projectId),
    renderStillsClient.listJobs(projectId),
  ]);
  return {
    jobs: jobs.jobs.map(({ id, request, safeCode, state }) => ({
      id,
      request: {
        sourceSceneJobId: request.sourceSceneJobId,
        ...(request.specification ? { specification: request.specification } : {}),
      },
      safeCode,
      state,
    })),
    renderer: capabilities.renderer,
    sources: capabilities.sources,
  };
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

  const exactSnapshot = snapshot.status === "fulfilled" ? snapshot.value : undefined;
  const [consultation, designOptions, specifications, renders] = await Promise.allSettled([
    consultationClient.loadWorkspace(projectId),
    loadDesignOptions(projectId, exactSnapshot),
    materialsProductsClient.listSpecifications(projectId),
    loadRenderState(projectId),
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
        item === null
          ? null
          : {
              modelId: item.modelId,
              snapshotId: item.id,
              snapshotSha256: item.snapshotSha256,
              snapshotVersion: item.version,
            },
      ),
      design: {
        consultation: resource(consultation, (workspace) => ({
          brief:
            workspace.brief === null
              ? null
              : {
                  contentSha256: workspace.briefContentSha256,
                  id: workspace.brief.id,
                  revision: workspace.brief.revision,
                  status: workspace.brief.status,
                },
        })),
        options: resource(designOptions, (value) => value),
        renders: resource(renders, (value) => value),
        specifications: resource(specifications, (value) => ({
          specifications: value.specifications.map(({ currentRevision, specificationId }) => ({
            catalogReleaseId: currentRevision.catalogReleaseId,
            modelSnapshotId: currentRevision.modelSnapshotId,
            modelSnapshotSha256: currentRevision.modelSnapshotSha256,
            revision: currentRevision.revision,
            sourceConfirmation: currentRevision.sourceConfirmation,
            specificationId,
          })),
        })),
      },
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
          sourceSnapshotSha256: request.sourceSnapshot.snapshotSha256,
          state,
        })),
        snapshots: workspace.snapshots.map(({ profile, snapshotId }) => ({ profile, snapshotId })),
      })),
    },
    project,
    session,
  };
}
