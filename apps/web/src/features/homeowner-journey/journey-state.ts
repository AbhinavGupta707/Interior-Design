import type {
  AssetKind,
  AssetStatus,
  FusionJobState,
  HomeIntake,
  ReconstructionJobState,
  SceneJobState,
  Session,
} from "@interior-design/contracts";

import { exactSceneJobHref } from "../viewer-3d/deep-link";

import { homeJourneyHref } from "./navigation";

export type JourneyStageStatus =
  | "complete"
  | "confirmed"
  | "in-progress"
  | "needs-attention"
  | "not-started"
  | "proposal-ready"
  | "unavailable";

export type JourneyProblemKind = "expired" | "forbidden" | "offline" | "unavailable";

export type JourneyResource<T> =
  | { readonly kind: "ready"; readonly value: T }
  | { readonly kind: "unavailable"; readonly problem: JourneyProblemKind };

interface IntakeSummary {
  readonly evidenceAvailable: HomeIntake["evidenceAvailable"];
  readonly goals: readonly string[];
}

interface EvidenceSummary {
  readonly assets: readonly {
    readonly kind: AssetKind;
    readonly status: AssetStatus;
  }[];
}

interface ReconstructionSummary {
  readonly jobs: readonly { readonly state: ReconstructionJobState }[];
}

interface FusionSummary {
  readonly jobs: readonly { readonly state: FusionJobState }[];
}

interface BranchSummary {
  readonly revisions: readonly number[];
}

interface SceneSummary {
  readonly jobs: readonly {
    readonly id: string;
    readonly sourceProfile: "as-built" | "existing" | "proposed";
    readonly sourceSnapshotId: string;
    readonly state: SceneJobState;
  }[];
  readonly snapshots: readonly {
    readonly profile: "as-built" | "existing" | "proposed";
    readonly snapshotId: string;
  }[];
}

export interface HomeJourneyInput {
  readonly branches: JourneyResource<BranchSummary>;
  readonly currentSnapshot: JourneyResource<{ readonly snapshotId: string } | null>;
  readonly evidence: JourneyResource<EvidenceSummary>;
  readonly fusion: JourneyResource<FusionSummary>;
  readonly intake: JourneyResource<IntakeSummary | null>;
  readonly projectId: string;
  readonly property: JourneyResource<{ readonly confirmed: boolean }>;
  readonly reconstruction: JourneyResource<ReconstructionSummary>;
  readonly role: Session["actor"]["role"];
  readonly scenes: JourneyResource<SceneSummary>;
}

export interface JourneyStage {
  readonly actionLabel: string;
  readonly degraded?: boolean;
  readonly detail: string;
  readonly href: string;
  readonly id: "confirmation" | "evidence" | "goals" | "property" | "proposal" | "twin";
  readonly status: JourneyStageStatus;
  readonly title: string;
}

export interface HomeJourneyState {
  readonly primary: JourneyStage;
  readonly stages: readonly JourneyStage[];
}

const activeReconstructionStates = new Set<ReconstructionJobState>([
  "cancel-requested",
  "created",
  "preparing",
  "ready-for-reconstruction",
  "reconstructing-appearance",
  "reconstructing-geometry",
]);

const activeFusionStates = new Set<FusionJobState>([
  "cancel-requested",
  "comparing",
  "fitting",
  "queued",
  "registering",
]);

const activeSceneStates = new Set<SceneJobState>([
  "cancel-requested",
  "compiling",
  "leased",
  "publishing",
  "queued",
]);

const activeAssetStates = new Set<AssetStatus>([
  "pending-upload",
  "processing",
  "uploaded",
  "uploading",
]);

function unavailableDetail(problem: JourneyProblemKind): string {
  if (problem === "offline")
    return "This stage could not be read while offline. Other readable stages are preserved.";
  if (problem === "expired")
    return "The session expired while reading this stage. No state was changed.";
  if (problem === "forbidden") return "This stage is not available to the current project role.";
  return "This stage is temporarily unavailable. No completion state was inferred.";
}

function unavailableStage(
  id: JourneyStage["id"],
  title: string,
  problem: JourneyProblemKind,
  projectId: string,
): JourneyStage {
  return {
    actionLabel: "Retry from the journey",
    detail: unavailableDetail(problem),
    href: homeJourneyHref(projectId),
    id,
    status: "unavailable",
    title,
  };
}

function propertyStage(input: HomeJourneyInput): JourneyStage {
  if (input.property.kind === "unavailable") {
    return unavailableStage(
      "property",
      "Confirm property context",
      input.property.problem,
      input.projectId,
    );
  }
  return input.property.value.confirmed
    ? {
        actionLabel: "Review property context",
        detail:
          "A property identity is selected. Address and provider context still establish no interior geometry.",
        href: `/property/${encodeURIComponent(input.projectId)}`,
        id: "property",
        status: "complete",
        title: "Confirm property context",
      }
    : {
        actionLabel: input.role === "viewer" ? "View property status" : "Confirm property",
        detail:
          "Select a fixture/manual identity or record that provider context is unavailable. Interior facts remain unknown.",
        href: `/property/${encodeURIComponent(input.projectId)}`,
        id: "property",
        status: "not-started",
        title: "Confirm property context",
      };
}

function goalsStage(input: HomeJourneyInput): JourneyStage {
  if (input.intake.kind === "unavailable") {
    return unavailableStage(
      "goals",
      "Renovation goals and available evidence",
      input.intake.problem,
      input.projectId,
    );
  }
  const complete = (input.intake.value?.goals.length ?? 0) > 0;
  return {
    actionLabel:
      input.role === "viewer" ? "Review recorded goals" : complete ? "Review goals" : "Add goals",
    detail: complete
      ? "The C1 structured intake remains the authority for renovation intent and evidence availability."
      : "Record at least one renovation goal. A prose summary will not become a canonical model fact.",
    href: `/onboarding/${encodeURIComponent(input.projectId)}`,
    id: "goals",
    status: complete ? "complete" : "not-started",
    title: "Renovation goals and available evidence",
  };
}

function evidenceStage(input: HomeJourneyInput): JourneyStage {
  if (input.evidence.kind === "unavailable") {
    return unavailableStage(
      "evidence",
      "Rights-cleared source evidence",
      input.evidence.problem,
      input.projectId,
    );
  }
  const assets = input.evidence.value.assets;
  const hasReady = assets.some(({ status }) => status === "ready");
  const hasActive = assets.some(({ status }) => activeAssetStates.has(status));
  const hasRejected = assets.some(
    ({ status }) => status === "quarantined" || status === "rejected",
  );
  const status: JourneyStageStatus = hasReady
    ? "complete"
    : hasActive
      ? "in-progress"
      : hasRejected
        ? "needs-attention"
        : "not-started";
  return {
    actionLabel:
      input.role === "viewer"
        ? "Inspect evidence"
        : hasReady
          ? "Review evidence"
          : "Supply evidence",
    detail: hasReady
      ? "At least one immutable source is ready. Service processing and rights remain separate from training, which is denied by default."
      : hasActive
        ? "An immutable source is still uploading or being processed. No spatial understanding is implied."
        : hasRejected
          ? "Evidence needs attention after bounded processing. Rejected input was not promoted."
          : "Add a rights-cleared plan, photo, video or document with explicit service-processing consent.",
    href: `/evidence/${encodeURIComponent(input.projectId)}`,
    id: "evidence",
    status,
    title: "Rights-cleared source evidence",
  };
}

function proposalStage(input: HomeJourneyInput): JourneyStage {
  const reconstruction =
    input.reconstruction.kind === "ready" ? input.reconstruction.value : undefined;
  const fusion = input.fusion.kind === "ready" ? input.fusion.value : undefined;
  if (!reconstruction && !fusion) {
    const problem =
      input.fusion.kind === "unavailable"
        ? input.fusion.problem
        : input.reconstruction.kind === "unavailable"
          ? input.reconstruction.problem
          : "unavailable";
    return unavailableStage(
      "proposal",
      "Reconstruction and fusion proposal",
      problem,
      input.projectId,
    );
  }
  const degraded = !reconstruction || !fusion;
  const degradedDetail = degraded
    ? " One proposal source is unavailable; readable state is preserved and no missing completion was inferred."
    : "";

  const fusionReady = fusion?.jobs.some(({ state }) => state === "proposed") ?? false;
  const fusionActive = fusion?.jobs.some(({ state }) => activeFusionStates.has(state)) ?? false;
  const reconstructionReady =
    reconstruction?.jobs.some(({ state }) => state === "completed") ?? false;
  const reconstructionActive =
    reconstruction?.jobs.some(({ state }) => activeReconstructionStates.has(state)) ?? false;
  const stopped =
    (fusion?.jobs.some(({ state }) => state === "abstained" || state === "failed") ?? false) ||
    (reconstruction?.jobs.some(({ state }) => state === "abstained" || state === "failed") ??
      false);

  if (fusionReady) {
    return {
      actionLabel: "Review full-house proposal",
      degraded,
      detail: `A C9 proposal is ready with discrepancies and uncertainty. It remains uncommitted.${degradedDetail}`,
      href: `/fusion/${encodeURIComponent(input.projectId)}`,
      id: "proposal",
      status: "proposal-ready",
      title: "Reconstruction and fusion proposal",
    };
  }
  if (fusionActive || reconstructionActive) {
    return {
      actionLabel: "Inspect proposal progress",
      degraded,
      detail: `Proposal work is in progress. Partial, disconnected and abstained results remain visible.${degradedDetail}`,
      href: fusionActive
        ? `/fusion/${encodeURIComponent(input.projectId)}`
        : `/reconstruction/${encodeURIComponent(input.projectId)}`,
      id: "proposal",
      status: "in-progress",
      title: "Reconstruction and fusion proposal",
    };
  }
  if (reconstructionReady) {
    return {
      actionLabel:
        input.role === "viewer" ? "Inspect fusion readiness" : "Reconcile source proposals",
      degraded,
      detail: `A media proposal is ready. Reconcile it with other eligible source claims before canonical confirmation.${degradedDetail}`,
      href: `/fusion/${encodeURIComponent(input.projectId)}`,
      id: "proposal",
      status: "needs-attention",
      title: "Reconstruction and fusion proposal",
    };
  }

  const assets = input.evidence.kind === "ready" ? input.evidence.value.assets : [];
  const readyPlan = assets.some(({ kind, status }) => kind === "plan" && status === "ready");
  const readyMedia = assets.some(
    ({ kind, status }) => (kind === "photograph" || kind === "video") && status === "ready",
  );
  return {
    actionLabel: stopped
      ? "Review stopped proposal"
      : readyMedia
        ? input.role === "viewer"
          ? "Inspect reconstruction"
          : "Create media proposal"
        : readyPlan
          ? "Correct ready plan"
          : "Review evidence first",
    degraded,
    detail: stopped
      ? `A job failed or abstained without inventing unsupported geometry. Review its safe diagnostics.${degradedDetail}`
      : readyMedia
        ? `Ready photo/video evidence can create an independent C8 proposal.${degradedDetail}`
        : readyPlan
          ? `A ready plan continues through C6 calibration and correction; it is not interior truth by itself.${degradedDetail}`
          : `No eligible proposal source is ready. Supply and validate evidence first.${degradedDetail}`,
    href: stopped
      ? `/fusion/${encodeURIComponent(input.projectId)}`
      : readyMedia
        ? `/reconstruction/${encodeURIComponent(input.projectId)}`
        : readyPlan
          ? `/plan-import/${encodeURIComponent(input.projectId)}`
          : `/evidence/${encodeURIComponent(input.projectId)}`,
    id: "proposal",
    status: stopped ? "needs-attention" : "not-started",
    title: "Reconstruction and fusion proposal",
  };
}

function confirmationStage(input: HomeJourneyInput): JourneyStage {
  const branchConfirmed =
    input.branches.kind === "ready" &&
    input.branches.value.revisions.some((revision) => revision > 0);
  const proposalReady =
    input.fusion.kind === "ready" &&
    input.fusion.value.jobs.some(({ state }) => state === "proposed");

  if (branchConfirmed) {
    return {
      actionLabel: "Inspect confirmed model",
      detail:
        "A typed C5 commit exists. This is homeowner-confirmed exploration state, not survey or professional truth.",
      href: `/fusion/${encodeURIComponent(input.projectId)}`,
      id: "confirmation",
      status: "confirmed",
      title: "Preview and explicitly confirm corrections",
    };
  }
  if (input.branches.kind === "unavailable" && input.fusion.kind === "unavailable") {
    return unavailableStage(
      "confirmation",
      "Preview and explicitly confirm corrections",
      input.branches.problem,
      input.projectId,
    );
  }
  return {
    actionLabel:
      input.role === "viewer"
        ? "Inspect confirmation status"
        : proposalReady
          ? "Preview typed corrections"
          : "Review proposal first",
    detail: proposalReady
      ? input.role === "viewer"
        ? "A proposal is ready, but viewers cannot preview or commit canonical mutations."
        : "Create an exact C9 draft, run a distinct non-mutating C5 preview, then confirm in a separate action."
      : "No homeowner-confirmed correction commit is visible yet. Nothing will commit automatically.",
    href: `/fusion/${encodeURIComponent(input.projectId)}`,
    id: "confirmation",
    status: proposalReady ? "proposal-ready" : "not-started",
    title: "Preview and explicitly confirm corrections",
  };
}

function twinStage(input: HomeJourneyInput): JourneyStage {
  if (input.scenes.kind === "unavailable") {
    return unavailableStage(
      "twin",
      "Build and explore the committed twin",
      input.scenes.problem,
      input.projectId,
    );
  }
  if (input.currentSnapshot.kind === "unavailable") {
    return unavailableStage(
      "twin",
      "Build and explore the committed twin",
      input.currentSnapshot.problem,
      input.projectId,
    );
  }
  const currentSnapshotId = input.currentSnapshot.value?.snapshotId;
  const existingJobs = input.scenes.value.jobs.filter(
    ({ sourceProfile }) => sourceProfile === "existing",
  );
  const succeeded = existingJobs.find(
    ({ sourceSnapshotId, state }) =>
      state === "succeeded" && sourceSnapshotId === currentSnapshotId,
  );
  const active = existingJobs.some(
    ({ sourceSnapshotId, state }) =>
      sourceSnapshotId === currentSnapshotId && activeSceneStates.has(state),
  );
  const hasCurrentSceneSource = input.scenes.value.snapshots.some(
    ({ profile, snapshotId }) => profile === "existing" && snapshotId === currentSnapshotId,
  );
  const branchConfirmed =
    input.branches.kind === "ready" &&
    input.branches.value.revisions.some((revision) => revision > 0);
  const hasCurrentSnapshot = currentSnapshotId !== undefined;

  if (succeeded) {
    return {
      actionLabel: "Explore exact viewer job",
      detail:
        "A C10 scene derived from an exact committed existing-profile snapshot is available with read-only fallback.",
      href: exactSceneJobHref(input.projectId, succeeded.id),
      id: "twin",
      status: "complete",
      title: "Build and explore the committed twin",
    };
  }
  if (active) {
    return {
      actionLabel: "View scene progress",
      detail: "Scene compilation is in progress against a committed current-profile snapshot.",
      href: `/viewer/${encodeURIComponent(input.projectId)}`,
      id: "twin",
      status: "in-progress",
      title: "Build and explore the committed twin",
    };
  }
  if (branchConfirmed && hasCurrentSnapshot && hasCurrentSceneSource) {
    return {
      actionLabel: input.role === "viewer" ? "View scene status" : "Compile committed twin",
      detail:
        input.role === "viewer"
          ? "A committed snapshot is available, but only an owner or editor can start C10 compilation."
          : "Start C10 explicitly from its current committed profile. No raw proposal or preview body is accepted.",
      href: `/viewer/${encodeURIComponent(input.projectId)}`,
      id: "twin",
      status: input.role === "viewer" ? "needs-attention" : "not-started",
      title: "Build and explore the committed twin",
    };
  }
  return {
    actionLabel: "Complete explicit confirmation",
    detail:
      "A scene is gated until typed corrections are explicitly committed and exposed as the current profile.",
    href: `/fusion/${encodeURIComponent(input.projectId)}`,
    id: "twin",
    status: "needs-attention",
    title: "Build and explore the committed twin",
  };
}

export function deriveHomeJourney(input: HomeJourneyInput): HomeJourneyState {
  const stages = [
    propertyStage(input),
    goalsStage(input),
    evidenceStage(input),
    proposalStage(input),
    confirmationStage(input),
    twinStage(input),
  ] as const;
  const primary =
    stages.find(({ status }) => !["complete", "confirmed", "unavailable"].includes(status)) ??
    stages.at(-1) ??
    stages[0];
  return { primary, stages };
}

export function journeyStatusLabel(status: JourneyStageStatus): string {
  return status.replaceAll("-", " ");
}
