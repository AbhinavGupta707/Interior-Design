import type {
  AssetKind,
  AssetStatus,
  FusionJobState,
  HomeIntake,
  OptionJob,
  PlanJobState,
  ReconstructionJobState,
  RenderJobState,
  SceneJobState,
  Session,
} from "@interior-design/contracts";

import { designOptionLaunchHref } from "../design-options/launch-context";
import { renderStillsLaunchHref } from "../render-stills/launch-context";
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

interface PlanSummary {
  readonly jobs: readonly { readonly state: PlanJobState }[];
}

interface BranchSummary {
  readonly branches: readonly {
    readonly headSnapshotId: string;
    readonly revision: number;
    readonly sourceSnapshotId: string;
  }[];
}

interface SceneSummary {
  readonly jobs: readonly {
    readonly id: string;
    readonly sourceProfile: "as-built" | "existing" | "proposed";
    readonly sourceSnapshotId: string;
    readonly sourceSnapshotSha256?: string;
    readonly state: SceneJobState;
  }[];
  readonly snapshots: readonly {
    readonly profile: "as-built" | "existing" | "proposed";
    readonly snapshotId: string;
  }[];
}

interface ConsultationSummary {
  readonly brief: {
    readonly contentSha256: string | null;
    readonly id: string;
    readonly revision: number;
    readonly status: "accepted" | "draft" | "superseded";
  } | null;
}

interface DesignOptionsSummary {
  readonly confirmationInspectionComplete: boolean;
  readonly jobs: readonly {
    readonly baseBrief: {
      readonly briefId: string;
      readonly contentSha256: string;
      readonly revision: number;
    };
    readonly confirmedOptionCount: number | undefined;
    readonly id: string;
    readonly optionCount: number;
    readonly safeCode: string | undefined;
    readonly sourceModel: {
      readonly modelId: string;
      readonly profile: "existing" | "proposed";
      readonly snapshotId: string;
      readonly snapshotSha256: string;
      readonly snapshotVersion: number;
    };
    readonly state: OptionJob["state"];
  }[];
}

interface SpecificationsSummary {
  readonly specifications: readonly {
    readonly catalogReleaseId: string;
    readonly modelSnapshotId: string;
    readonly modelSnapshotSha256: string;
    readonly revision: number;
    readonly sourceConfirmation: {
      readonly acceptedBrief: {
        readonly briefId: string;
        readonly contentSha256: string;
        readonly revision: number;
      };
      readonly confirmationId: string;
      readonly jobId: string;
      readonly jobVersion: number;
      readonly optionId: string;
      readonly profile: "proposed";
      readonly resultSnapshotId: string;
      readonly resultSnapshotSha256: string;
      readonly resultSnapshotVersion: number;
    };
    readonly specificationId: string;
  }[];
}

interface RenderSummary {
  readonly jobs: readonly {
    readonly id: string;
    readonly request: {
      readonly sourceSceneJobId: string;
      readonly specification?: {
        readonly specificationId: string;
        readonly specificationRevision: number;
      };
    };
    readonly safeCode: string | undefined;
    readonly state: RenderJobState;
  }[];
  readonly renderer: {
    readonly hardwareGate: "deferred" | "not-run" | "satisfied";
    readonly reason: string;
    readonly state: "available" | "deferred" | "disabled" | "paused";
  };
  readonly sources: readonly {
    readonly sourceSceneJobId: string;
    readonly specifications: readonly {
      readonly specificationId: string;
      readonly specificationRevision: number;
    }[];
  }[];
}

interface HomeDesignInput {
  readonly consultation: JourneyResource<ConsultationSummary>;
  readonly options: JourneyResource<DesignOptionsSummary>;
  readonly renders: JourneyResource<RenderSummary>;
  readonly specifications: JourneyResource<SpecificationsSummary>;
}

export interface HomeJourneyInput {
  readonly branches: JourneyResource<BranchSummary>;
  readonly currentSnapshot: JourneyResource<{
    readonly modelId?: string;
    readonly snapshotId: string;
    readonly snapshotSha256?: string;
    readonly snapshotVersion?: number;
  } | null>;
  readonly design?: HomeDesignInput;
  readonly evidence: JourneyResource<EvidenceSummary>;
  readonly fusion: JourneyResource<FusionSummary>;
  readonly intake: JourneyResource<IntakeSummary | null>;
  readonly plan: JourneyResource<PlanSummary>;
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
  readonly id:
    | "confirmation"
    | "consultation"
    | "design-exploration"
    | "design-options"
    | "evidence"
    | "goals"
    | "property"
    | "proposal"
    | "setup"
    | "specification"
    | "stills"
    | "twin";
  readonly status: JourneyStageStatus;
  readonly title: string;
}

export interface HomeJourneyState {
  readonly designStages: readonly JourneyStage[];
  readonly modelStages: readonly JourneyStage[];
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

const activePlanStates = new Set<PlanJobState>(["cancel-requested", "processing", "queued"]);

const activeSceneStates = new Set<SceneJobState>([
  "cancel-requested",
  "compiling",
  "leased",
  "publishing",
  "queued",
]);

const activeRenderStates = new Set<RenderJobState>([
  "cancel-requested",
  "preparing",
  "publishing-safe",
  "queued",
  "rendering-safe",
  "validating-safe",
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
          "Select a provider or manual identity, or record that provider context is unavailable. Interior facts remain unknown.",
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

function hasCurrentChangedBranch(input: HomeJourneyInput): boolean {
  if (
    input.currentSnapshot.kind !== "ready" ||
    input.currentSnapshot.value === null ||
    input.branches.kind !== "ready"
  ) {
    return false;
  }
  const currentSnapshotId = input.currentSnapshot.value.snapshotId;
  return input.branches.value.branches.some(
    ({ headSnapshotId, revision, sourceSnapshotId }) =>
      revision > 0 && headSnapshotId === currentSnapshotId && headSnapshotId !== sourceSnapshotId,
  );
}

function exactExistingScene(input: HomeJourneyInput) {
  if (
    !hasCurrentChangedBranch(input) ||
    input.currentSnapshot.kind !== "ready" ||
    input.currentSnapshot.value === null ||
    input.scenes.kind !== "ready"
  ) {
    return undefined;
  }
  const snapshot = input.currentSnapshot.value;
  return input.scenes.value.jobs.find(
    ({ sourceProfile, sourceSnapshotId, sourceSnapshotSha256, state }) =>
      sourceProfile === "existing" &&
      sourceSnapshotId === snapshot.snapshotId &&
      sourceSnapshotSha256 === snapshot.snapshotSha256 &&
      state === "succeeded",
  );
}

function acceptedBrief(input: HomeJourneyInput) {
  if (input.design?.consultation.kind !== "ready") return undefined;
  const brief = input.design.consultation.value.brief;
  if (brief?.status !== "accepted" || !brief.contentSha256) return undefined;
  return { ...brief, contentSha256: brief.contentSha256 };
}

function exactCurrentOptionJobs(input: HomeJourneyInput) {
  const brief = acceptedBrief(input);
  if (
    !brief ||
    input.currentSnapshot.kind !== "ready" ||
    input.currentSnapshot.value === null ||
    input.design?.options.kind !== "ready"
  ) {
    return [];
  }
  const snapshot = input.currentSnapshot.value;
  return input.design.options.value.jobs.filter(
    ({ baseBrief, sourceModel }) =>
      baseBrief.briefId === brief.id &&
      baseBrief.revision === brief.revision &&
      baseBrief.contentSha256 === brief.contentSha256 &&
      sourceModel.profile === "existing" &&
      sourceModel.modelId === snapshot.modelId &&
      sourceModel.snapshotId === snapshot.snapshotId &&
      sourceModel.snapshotSha256 === snapshot.snapshotSha256 &&
      sourceModel.snapshotVersion === snapshot.snapshotVersion,
  );
}

function exactCurrentSpecifications(input: HomeJourneyInput) {
  const brief = acceptedBrief(input);
  if (!brief || input.design?.specifications.kind !== "ready") return [];
  const currentJobIds = new Set(exactCurrentOptionJobs(input).map(({ id }) => id));
  return input.design.specifications.value.specifications
    .filter(({ sourceConfirmation }) => {
      const sourceBrief = sourceConfirmation.acceptedBrief;
      return (
        currentJobIds.has(sourceConfirmation.jobId) &&
        sourceBrief.briefId === brief.id &&
        sourceBrief.revision === brief.revision &&
        sourceBrief.contentSha256 === brief.contentSha256 &&
        sourceConfirmation.profile === "proposed"
      );
    })
    .sort(
      (left, right) =>
        right.revision - left.revision || right.specificationId.localeCompare(left.specificationId),
    );
}

function exactProposedScene(input: HomeJourneyInput) {
  const specification = exactCurrentSpecifications(input)[0];
  if (!specification || input.scenes.kind !== "ready") return undefined;
  return input.scenes.value.jobs.find(
    ({ sourceProfile, sourceSnapshotId, sourceSnapshotSha256, state }) =>
      sourceProfile === "proposed" &&
      sourceSnapshotId === specification.modelSnapshotId &&
      sourceSnapshotSha256 === specification.modelSnapshotSha256 &&
      state === "succeeded",
  );
}

function setupStage(input: HomeJourneyInput): JourneyStage {
  if (input.currentSnapshot.kind === "unavailable") {
    return unavailableStage(
      "setup",
      "Set up the unmeasured model workspace",
      input.currentSnapshot.problem,
      input.projectId,
    );
  }
  const href = `/editor/${encodeURIComponent(input.projectId)}`;
  if (input.currentSnapshot.value !== null) {
    return {
      actionLabel: "Review model workspace",
      detail:
        "An existing-profile workspace is present. Its initialization revision is setup only, not a confirmed correction.",
      href,
      id: "setup",
      status: "complete",
      title: "Set up the unmeasured model workspace",
    };
  }
  if (input.role === "viewer") {
    return {
      actionLabel: "View setup status",
      detail:
        "No existing-model workspace is available. Viewer access is read-only; an owner or editor must acknowledge the unmeasured starting point.",
      href,
      id: "setup",
      status: "unavailable",
      title: "Set up the unmeasured model workspace",
    };
  }
  return {
    actionLabel: "Set up unmeasured workspace",
    detail:
      "Explicitly confirm at least one level and unknown measurements. The server will create no rooms, boundaries, dimensions or property-derived interior evidence.",
    href,
    id: "setup",
    status: "not-started",
    title: "Set up the unmeasured model workspace",
  };
}

function proposalStage(input: HomeJourneyInput): JourneyStage {
  if (input.currentSnapshot.kind === "unavailable") {
    return unavailableStage(
      "proposal",
      "Reconstruction and fusion proposal",
      input.currentSnapshot.problem,
      input.projectId,
    );
  }
  if (input.currentSnapshot.value === null) {
    return {
      actionLabel: input.role === "viewer" ? "View model setup status" : "Set up model workspace",
      detail:
        input.role === "viewer"
          ? "Proposal correction cannot begin because no existing-model workspace is available and viewer access is read-only."
          : "Set up the explicitly unmeasured existing-model workspace before C6 or C9 proposal correction.",
      href: `/editor/${encodeURIComponent(input.projectId)}`,
      id: "proposal",
      status: input.role === "viewer" ? "unavailable" : "not-started",
      title: "Reconstruction and fusion proposal",
    };
  }

  const plan = input.plan.kind === "ready" ? input.plan.value : undefined;
  const reconstruction =
    input.reconstruction.kind === "ready" ? input.reconstruction.value : undefined;
  const fusion = input.fusion.kind === "ready" ? input.fusion.value : undefined;
  if (!plan && !reconstruction && !fusion) {
    const problem =
      input.plan.kind === "unavailable"
        ? input.plan.problem
        : input.fusion.kind === "unavailable"
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
  const degraded = !plan || !reconstruction || !fusion;
  const degradedDetail = degraded
    ? " One or more proposal sources are unavailable; readable state is preserved and no missing completion was inferred."
    : "";

  const planReady = plan?.jobs.some(({ state }) => state === "proposed") ?? false;
  const planActive = plan?.jobs.some(({ state }) => activePlanStates.has(state)) ?? false;
  const fusionReady = fusion?.jobs.some(({ state }) => state === "proposed") ?? false;
  const fusionActive = fusion?.jobs.some(({ state }) => activeFusionStates.has(state)) ?? false;
  const reconstructionReady =
    reconstruction?.jobs.some(({ state }) => state === "completed") ?? false;
  const reconstructionActive =
    reconstruction?.jobs.some(({ state }) => activeReconstructionStates.has(state)) ?? false;
  const planStopped =
    plan?.jobs.some(({ state }) => state === "abstained" || state === "failed") ?? false;
  const stopped =
    planStopped ||
    (fusion?.jobs.some(({ state }) => state === "abstained" || state === "failed") ?? false) ||
    (reconstruction?.jobs.some(({ state }) => state === "abstained" || state === "failed") ??
      false);

  if (planReady) {
    const confirmed = hasCurrentChangedBranch(input);
    return {
      actionLabel: "Review plan proposal",
      degraded,
      detail: confirmed
        ? `An immutable C6 proposal is retained separately from the exact current confirmed model. Proposal generation is complete; confirmation remains a distinct C5 record.${degradedDetail}`
        : `An immutable source-pinned C6 proposal is ready for explicit candidate review, calibration and C5 preview. It remains uncommitted.${degradedDetail}`,
      href: `/plan-import/${encodeURIComponent(input.projectId)}`,
      id: "proposal",
      status: confirmed ? "complete" : "proposal-ready",
      title: "Reconstruction and fusion proposal",
    };
  }
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
  if (planActive || fusionActive || reconstructionActive) {
    return {
      actionLabel: "Inspect proposal progress",
      degraded,
      detail: `Proposal work is in progress. Partial, disconnected and abstained results remain visible.${degradedDetail}`,
      href: planActive
        ? `/plan-import/${encodeURIComponent(input.projectId)}`
        : fusionActive
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
      ? planStopped
        ? `/plan-import/${encodeURIComponent(input.projectId)}`
        : `/fusion/${encodeURIComponent(input.projectId)}`
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
  const branchConfirmed = hasCurrentChangedBranch(input);
  const planProposalReady =
    input.plan.kind === "ready" && input.plan.value.jobs.some(({ state }) => state === "proposed");
  const fusionProposalReady =
    input.fusion.kind === "ready" &&
    input.fusion.value.jobs.some(({ state }) => state === "proposed");
  const proposalReady = planProposalReady || fusionProposalReady;

  if (branchConfirmed) {
    return {
      actionLabel: "Inspect confirmed model",
      detail:
        "A post-initialization C5 branch head exactly matches the current existing snapshot and differs from its immutable source. This remains homeowner-confirmed exploration state, not survey or professional truth.",
      href: `/editor/${encodeURIComponent(input.projectId)}`,
      id: "confirmation",
      status: "confirmed",
      title: "Preview and explicitly confirm corrections",
    };
  }
  if (
    input.branches.kind === "unavailable" &&
    input.fusion.kind === "unavailable" &&
    input.plan.kind === "unavailable"
  ) {
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
        : planProposalReady
          ? "Review the source-pinned C6 candidates and calibration, create an immutable operation draft, run a distinct C5 preview, then confirm in a separate action."
          : "Create an exact C9 draft, run a distinct non-mutating C5 preview, then confirm in a separate action."
      : "No homeowner-confirmed correction commit is visible yet. Nothing will commit automatically.",
    href: planProposalReady
      ? `/plan-import/${encodeURIComponent(input.projectId)}`
      : `/fusion/${encodeURIComponent(input.projectId)}`,
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
  const branchConfirmed = hasCurrentChangedBranch(input);
  const hasCurrentSnapshot = currentSnapshotId !== undefined;

  if (branchConfirmed && succeeded) {
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
  if (branchConfirmed && active) {
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
    href: homeJourneyHref(input.projectId),
    id: "twin",
    status: "needs-attention",
    title: "Build and explore the committed twin",
  };
}

function consultationStage(input: HomeJourneyInput): JourneyStage {
  const twin = exactExistingScene(input);
  if (!twin) {
    return {
      actionLabel: "Complete the exact twin first",
      detail:
        "Design consultation unlocks only after a changed existing branch is exact-current and its C10 twin is available. Intent will not substitute for geometry.",
      href: `/viewer/${encodeURIComponent(input.projectId)}`,
      id: "consultation",
      status: "needs-attention",
      title: "Shape and accept the design brief",
    };
  }
  const consultation = input.design?.consultation;
  if (!consultation || consultation.kind === "unavailable") {
    return unavailableStage(
      "consultation",
      "Shape and accept the design brief",
      consultation?.problem ?? "unavailable",
      input.projectId,
    );
  }
  const brief = consultation.value.brief;
  if (brief?.status === "accepted" && brief.contentSha256) {
    return {
      actionLabel: "Review accepted brief",
      detail:
        "This exact C11 revision records attributable preferences, constraints, unknowns and review routes. It does not mutate or reinterpret the confirmed twin.",
      href: `/design-consultation/${encodeURIComponent(input.projectId)}`,
      id: "consultation",
      status: "complete",
      title: "Shape and accept the design brief",
    };
  }
  return {
    actionLabel:
      input.role === "viewer"
        ? "Inspect consultation status"
        : brief
          ? "Continue and accept the brief"
          : "Start design consultation",
    detail: brief
      ? "A persisted draft brief is in progress. Review uncertainty and accountable routes before explicitly accepting one exact revision."
      : "Turn the renovation intake into a structured, attributable brief. Consultation text remains intent, not model evidence.",
    href: `/design-consultation/${encodeURIComponent(input.projectId)}`,
    id: "consultation",
    status: brief ? "in-progress" : input.role === "viewer" ? "unavailable" : "not-started",
    title: "Shape and accept the design brief",
  };
}

function designOptionsStage(input: HomeJourneyInput): JourneyStage {
  const brief = acceptedBrief(input);
  if (!brief || input.currentSnapshot.kind !== "ready" || input.currentSnapshot.value === null) {
    return {
      actionLabel: "Accept the brief first",
      detail:
        "Options require an accepted C11 brief and the exact current confirmed existing snapshot. Neither can be inferred from a previous visit.",
      href: `/design-consultation/${encodeURIComponent(input.projectId)}`,
      id: "design-options",
      status: "needs-attention",
      title: "Generate and compare design options",
    };
  }
  const options = input.design?.options;
  if (!options || options.kind === "unavailable") {
    return unavailableStage(
      "design-options",
      "Generate and compare design options",
      options?.problem ?? "unavailable",
      input.projectId,
    );
  }
  const jobs = exactCurrentOptionJobs(input);
  const confirmed = jobs.find(({ confirmedOptionCount }) => (confirmedOptionCount ?? 0) > 0);
  if (confirmed || exactCurrentSpecifications(input).length > 0) {
    return {
      actionLabel: "Review selected option",
      degraded: !options.value.confirmationInspectionComplete,
      detail:
        "A persisted option from this accepted brief and exact current twin is confirmed only into proposed state. Existing and as-built profiles remain unchanged.",
      href: `/design-options/${encodeURIComponent(input.projectId)}`,
      id: "design-options",
      status: "confirmed",
      title: "Generate and compare design options",
    };
  }
  const succeeded = jobs.find(
    ({ optionCount, state }) => state === "succeeded" && optionCount >= 2,
  );
  if (succeeded) {
    return {
      actionLabel: "Compare at least two options",
      degraded: !options.value.confirmationInspectionComplete,
      detail:
        "At least two bounded C12 alternatives are ready against the exact brief/model pins. Compare assumptions, unknowns and trade-offs before explicitly selecting one proposed design.",
      href: `/design-options/${encodeURIComponent(input.projectId)}`,
      id: "design-options",
      status: "proposal-ready",
      title: "Generate and compare design options",
    };
  }
  if (jobs.some(({ state }) => ["cancel-requested", "queued", "running"].includes(state))) {
    return {
      actionLabel: "View option progress",
      detail:
        "Design alternatives are being generated from exact accepted-brief and current-twin pins. No proposed branch exists until explicit confirmation.",
      href: `/design-options/${encodeURIComponent(input.projectId)}`,
      id: "design-options",
      status: "in-progress",
      title: "Generate and compare design options",
    };
  }
  if (jobs.some(({ state }) => ["abstained", "cancelled", "failed"].includes(state))) {
    return {
      actionLabel: "Review stopped option job",
      detail:
        "The latest exact-source option attempt stopped safely. Review its bounded diagnostic before retrying; no partial option was promoted.",
      href: `/design-options/${encodeURIComponent(input.projectId)}`,
      id: "design-options",
      status: "needs-attention",
      title: "Generate and compare design options",
    };
  }
  const snapshot = input.currentSnapshot.value;
  if (
    snapshot.modelId === undefined ||
    snapshot.snapshotSha256 === undefined ||
    snapshot.snapshotVersion === undefined
  ) {
    return {
      actionLabel: "Reload the exact twin",
      detail:
        "The current snapshot could not be verified with its complete model, hash and version pins. No option request was prepared.",
      href: homeJourneyHref(input.projectId),
      id: "design-options",
      status: "unavailable",
      title: "Generate and compare design options",
    };
  }
  return {
    actionLabel: input.role === "viewer" ? "Inspect option readiness" : "Generate two options",
    detail:
      input.role === "viewer"
        ? "Viewer access is read-only. An owner or editor must generate alternatives from the exact accepted brief and confirmed twin."
        : "Generate two deliberately different, computationally valid directions. They remain proposals until a separate confirmation.",
    href: designOptionLaunchHref(input.projectId, {
      baseBrief: {
        briefId: brief.id,
        contentSha256: brief.contentSha256,
        revision: brief.revision,
      },
      requestedDirections: ["circulation-first", "conversation-first"],
      requestedOptionCount: 2,
      sourceModel: {
        modelId: snapshot.modelId,
        profile: "existing",
        snapshotId: snapshot.snapshotId,
        snapshotSha256: snapshot.snapshotSha256,
        snapshotVersion: snapshot.snapshotVersion,
      },
    }),
    id: "design-options",
    status: input.role === "viewer" ? "unavailable" : "not-started",
    title: "Generate and compare design options",
  };
}

function specificationStage(input: HomeJourneyInput): JourneyStage {
  const specifications = input.design?.specifications;
  if (!specifications || specifications.kind === "unavailable") {
    return unavailableStage(
      "specification",
      "Develop materials and room specification",
      specifications?.problem ?? "unavailable",
      input.projectId,
    );
  }
  const exact = exactCurrentSpecifications(input)[0];
  if (exact) {
    return {
      actionLabel: "Review working specification",
      detail:
        "A working C13 specification is bound to the exact confirmed option, proposed snapshot and catalog release. Prices, availability and professional approval remain unclaimed.",
      href: `/materials-products/${encodeURIComponent(input.projectId)}`,
      id: "specification",
      status: "complete",
      title: "Develop materials and room specification",
    };
  }
  const confirmed = exactCurrentOptionJobs(input).some(
    ({ confirmedOptionCount }) => (confirmedOptionCount ?? 0) > 0,
  );
  return {
    actionLabel: confirmed ? "Continue from selected option" : "Select a design option first",
    detail: confirmed
      ? "The proposed option is persisted. Resume its server-verified continuation to create specification revision 1 from an exact published catalog release."
      : "A working specification cannot start until one exact C12 option has been explicitly confirmed into proposed state.",
    href: `/design-options/${encodeURIComponent(input.projectId)}`,
    id: "specification",
    status: confirmed ? "not-started" : "needs-attention",
    title: "Develop materials and room specification",
  };
}

function designExplorationStage(input: HomeJourneyInput): JourneyStage {
  const specification = exactCurrentSpecifications(input)[0];
  if (!specification) {
    return {
      actionLabel: "Complete the specification first",
      detail:
        "Proposed exploration requires an exact C13-backed proposed snapshot. A confirmed option alone is not a renderable specification.",
      href: `/materials-products/${encodeURIComponent(input.projectId)}`,
      id: "design-exploration",
      status: "needs-attention",
      title: "Explore the proposed design",
    };
  }
  if (input.scenes.kind === "unavailable") {
    return unavailableStage(
      "design-exploration",
      "Explore the proposed design",
      input.scenes.problem,
      input.projectId,
    );
  }
  const matching = input.scenes.value.jobs.filter(
    ({ sourceProfile, sourceSnapshotId, sourceSnapshotSha256 }) =>
      sourceProfile === "proposed" &&
      sourceSnapshotId === specification.modelSnapshotId &&
      sourceSnapshotSha256 === specification.modelSnapshotSha256,
  );
  const succeeded = matching.find(({ state }) => state === "succeeded");
  if (succeeded) {
    return {
      actionLabel: "Explore exact proposed scene",
      detail:
        "A read-only C10 scene matches the exact proposed snapshot and working specification. WebGL capability is reported separately and the DOM fallback remains valid.",
      href: exactSceneJobHref(input.projectId, succeeded.id),
      id: "design-exploration",
      status: "complete",
      title: "Explore the proposed design",
    };
  }
  if (matching.some(({ state }) => activeSceneStates.has(state))) {
    return {
      actionLabel: "View proposed-scene progress",
      detail: "C10 is compiling the exact C13-backed proposed snapshot into derived visualisation.",
      href: `/viewer/${encodeURIComponent(input.projectId)}`,
      id: "design-exploration",
      status: "in-progress",
      title: "Explore the proposed design",
    };
  }
  const failed = matching.some(({ state }) => state === "failed" || state === "cancelled");
  return {
    actionLabel: failed ? "Retry exact proposed scene" : "Choose a material and create the scene",
    detail: failed
      ? "The exact scene attempt stopped without changing model or specification state. Retry explicitly from the current C13 revision."
      : "Confirm one bounded material substitution from the working specification. C13 commits the exact proposed revision and requests its C10 scene without accepting raw client geometry.",
    href: `/materials-products/${encodeURIComponent(input.projectId)}`,
    id: "design-exploration",
    status: failed ? "needs-attention" : input.role === "viewer" ? "unavailable" : "not-started",
    title: "Explore the proposed design",
  };
}

function stillsStage(input: HomeJourneyInput): JourneyStage {
  const specification = exactCurrentSpecifications(input)[0];
  const scene = exactProposedScene(input);
  if (!specification || !scene) {
    return {
      actionLabel: "Create the proposed scene first",
      detail:
        "Geometry-safe stills require an eligible exact C10 scene and matching C13 specification. Images cannot substitute for those source pins.",
      href: `/materials-products/${encodeURIComponent(input.projectId)}`,
      id: "stills",
      status: "needs-attention",
      title: "Create geometry-safe stills",
    };
  }
  const renders = input.design?.renders;
  if (!renders || renders.kind === "unavailable") {
    return unavailableStage(
      "stills",
      "Create geometry-safe stills",
      renders?.problem ?? "unavailable",
      input.projectId,
    );
  }
  const matches = renders.value.jobs.filter(
    ({ request }) =>
      request.sourceSceneJobId === scene.id &&
      request.specification?.specificationId === specification.specificationId &&
      request.specification.specificationRevision === specification.revision,
  );
  const succeeded = matches.find(({ state }) => state === "succeeded");
  if (succeeded) {
    return {
      actionLabel: "Inspect verified render artifacts",
      detail:
        "A geometry-safe C14 result is published from the exact scene/specification pins. Optional enhancement remains separate and illustrative.",
      href: `/render-stills/${encodeURIComponent(input.projectId)}?${new URLSearchParams({ jobId: succeeded.id }).toString()}`,
      id: "stills",
      status: "complete",
      title: "Create geometry-safe stills",
    };
  }
  if (matches.some(({ state }) => activeRenderStates.has(state))) {
    return {
      actionLabel: "View render progress",
      detail:
        "The safe render is running from exact immutable inputs. No partial artifact is presented as complete.",
      href: `/render-stills/${encodeURIComponent(input.projectId)}`,
      id: "stills",
      status: "in-progress",
      title: "Create geometry-safe stills",
    };
  }
  if (matches.some(({ state }) => state === "failed" || state === "cancelled")) {
    return {
      actionLabel: "Review stopped render",
      detail:
        "The durable render stopped safely. Existing model, scene and specification state remain unchanged and retry stays explicitly version-pinned.",
      href: `/render-stills/${encodeURIComponent(input.projectId)}`,
      id: "stills",
      status: "needs-attention",
      title: "Create geometry-safe stills",
    };
  }
  const eligibleSource = renders.value.sources.some(
    ({ sourceSceneJobId, specifications }) =>
      sourceSceneJobId === scene.id &&
      specifications.some(
        ({ specificationId, specificationRevision }) =>
          specificationId === specification.specificationId &&
          specificationRevision === specification.revision,
      ),
  );
  if (!eligibleSource || renders.value.renderer.state !== "available") {
    return {
      actionLabel: "Inspect render capability",
      degraded: true,
      detail: `This exact scene/specification is not currently renderable on the configured host. ${renders.value.renderer.reason}`,
      href: `/render-stills/${encodeURIComponent(input.projectId)}`,
      id: "stills",
      status: "unavailable",
      title: "Create geometry-safe stills",
    };
  }
  return {
    actionLabel:
      input.role === "viewer" ? "Inspect render readiness" : "Create geometry-safe still",
    detail:
      input.role === "viewer"
        ? "Viewer access can inspect eligible sources and results but cannot create a durable render job."
        : "Choose an accepted renderer profile and camera. The geometry-safe bundle remains authoritative over any optional enhancement.",
    href: renderStillsLaunchHref(input.projectId, {
      sourceSceneJobId: scene.id,
      specificationId: specification.specificationId,
      specificationRevision: specification.revision,
    }),
    id: "stills",
    status: input.role === "viewer" ? "unavailable" : "not-started",
    title: "Create geometry-safe stills",
  };
}

export function deriveHomeJourney(input: HomeJourneyInput): HomeJourneyState {
  const modelStages = [
    propertyStage(input),
    goalsStage(input),
    evidenceStage(input),
    setupStage(input),
    proposalStage(input),
    confirmationStage(input),
    twinStage(input),
  ] as const;
  const designStages = input.design
    ? [
        consultationStage(input),
        designOptionsStage(input),
        specificationStage(input),
        designExplorationStage(input),
        stillsStage(input),
      ]
    : [];
  const stages = [...modelStages, ...designStages];
  const primary =
    stages.find(({ status }) => !["complete", "confirmed", "unavailable"].includes(status)) ??
    stages.find(({ status }) => status === "unavailable") ??
    stages.at(-1) ??
    modelStages[0];
  return { designStages, modelStages, primary, stages };
}

export function journeyStatusLabel(status: JourneyStageStatus): string {
  return status.replaceAll("-", " ");
}
