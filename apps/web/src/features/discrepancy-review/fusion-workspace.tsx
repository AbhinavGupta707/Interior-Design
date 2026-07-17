"use client";

import type {
  fusionDiscrepancyDecisionSchema,
  FusionJob,
  FusionOperationDraft,
  FusionProposal,
} from "@interior-design/contracts";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SyntheticEvent } from "react";
import type { z } from "zod";

import {
  ActionButton,
  LoadingIndicator,
  PageContainer,
  StatePanel,
} from "../../components/ui-primitives";
import {
  buildFusionAnchorGroups,
  minimumFusionAnchorDrafts,
  type FusionAnchorDraft,
  type FusionAnchorDrafts,
} from "./anchors";
import { fusionClient, FusionProblem } from "./api";
import type { FusionWorkspace as Workspace } from "./contracts";
import { ProposalReview } from "./proposal-review";
import {
  canCancelFusion,
  canRetryFusion,
  isActiveFusionState,
  materialDecisionIds,
} from "./presentation";

type FusionDecision = z.infer<typeof fusionDiscrepancyDecisionSchema>;
type LoadState =
  | { readonly kind: "error" | "forbidden" | "offline"; readonly message: string }
  | { readonly kind: "expired" | "loading" | "ready" };
type BusyAction = "cancel" | "draft" | "refresh" | "retry" | "review" | "start";

function loadStateFrom(reason: unknown): LoadState {
  if (reason instanceof FusionProblem) {
    if (reason.kind === "expired") return { kind: "expired" };
    if (reason.kind === "forbidden" || reason.kind === "not-found") {
      return { kind: "forbidden", message: reason.message };
    }
    if (reason.kind === "offline") return { kind: "offline", message: reason.message };
    return { kind: "error", message: reason.message };
  }
  return { kind: "error", message: "The fusion workspace could not be loaded." };
}

function formattedTime(value: string): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function jobStateLabel(job: FusionJob): string {
  return job.state.replaceAll("-", " ");
}

function shortHash(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

export function FusionWorkspace({ projectId }: { readonly projectId: string }) {
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [workspace, setWorkspace] = useState<Workspace>();
  const [selectedSourceIds, setSelectedSourceIds] = useState<readonly string[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>();
  const [proposal, setProposal] = useState<FusionProposal>();
  const [decisions, setDecisions] = useState<readonly FusionDecision[]>([]);
  const [draft, setDraft] = useState<FusionOperationDraft>();
  const [selectedBranchId, setSelectedBranchId] = useState<string>();
  const [label, setLabel] = useState("Whole-home evidence fusion");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [anchorDrafts, setAnchorDrafts] = useState<FusionAnchorDrafts>({});
  const [busy, setBusy] = useState<BusyAction>();
  const [alert, setAlert] = useState<string>();
  const [liveMessage, setLiveMessage] = useState("");

  const loadWorkspace = useCallback(
    async (initial = false) => {
      if (initial) setLoadState({ kind: "loading" });
      else setBusy("refresh");
      setAlert(undefined);
      try {
        const next = await fusionClient.loadWorkspace(projectId);
        setWorkspace(next);
        setSelectedSourceIds((current) =>
          current.filter((id) => next.sources.some(({ source }) => source.id === id)),
        );
        setSelectedJobId((current) =>
          next.jobs.some(({ id }) => id === current) ? current : next.jobs[0]?.id,
        );
        setSelectedBranchId((current) =>
          next.branches.some(({ id }) => id === current) ? current : next.branches[0]?.id,
        );
        setLoadState({ kind: "ready" });
        if (!initial) setLiveMessage("Fusion sources, branches and jobs refreshed.");
      } catch (reason) {
        setLoadState(loadStateFrom(reason));
      } finally {
        setBusy(undefined);
      }
    },
    [projectId],
  );

  useEffect(() => {
    void loadWorkspace(true);
  }, [loadWorkspace]);

  const selectedJob = workspace?.jobs.find(({ id }) => id === selectedJobId);
  const selectedSources = useMemo(
    () => workspace?.sources.filter(({ source }) => selectedSourceIds.includes(source.id)) ?? [],
    [selectedSourceIds, workspace?.sources],
  );
  const selectedKinds = useMemo(
    () => new Set(selectedSources.map(({ source }) => source.kind)),
    [selectedSources],
  );
  const selectedSourceDescriptors = useMemo(
    () => selectedSources.map(({ source }) => source),
    [selectedSources],
  );
  const registrationReady = useMemo(
    () =>
      buildFusionAnchorGroups(
        selectedSourceDescriptors,
        anchorDrafts,
        () => "00000000-0000-4000-8000-000000000001",
      ) !== undefined,
    [anchorDrafts, selectedSourceDescriptors],
  );
  const editable = workspace ? workspace.session.actor.role !== "viewer" : false;
  const canStart =
    editable &&
    workspace?.baseSnapshot !== undefined &&
    consentConfirmed &&
    label.trim().length > 0 &&
    selectedSources.length >= 2 &&
    selectedSources.length <= 32 &&
    selectedKinds.size >= 2 &&
    registrationReady &&
    !busy;

  const loadProposal = useCallback(
    async (job: FusionJob) => {
      if (job.state !== "proposed" && job.state !== "abstained") {
        setProposal(undefined);
        setDecisions([]);
        setDraft(undefined);
        return;
      }
      try {
        setProposal(await fusionClient.getProposal(projectId, job.id));
      } catch (reason) {
        setAlert(reason instanceof Error ? reason.message : "The proposal could not be loaded.");
      }
    },
    [projectId],
  );

  useEffect(() => {
    if (selectedJob) void loadProposal(selectedJob);
    else setProposal(undefined);
  }, [loadProposal, selectedJob]);

  useEffect(() => {
    if (!selectedJob || !isActiveFusionState(selectedJob.state)) return;
    const timer = window.setInterval(() => {
      void fusionClient
        .getJob(projectId, selectedJob.id)
        .then((job) => {
          setWorkspace((current) =>
            current
              ? { ...current, jobs: current.jobs.map((item) => (item.id === job.id ? job : item)) }
              : current,
          );
          setLiveMessage(`Fusion status is ${jobStateLabel(job)}.`);
          if (job.state === "proposed" || job.state === "abstained") void loadProposal(job);
        })
        .catch((reason: unknown) => {
          if (reason instanceof FusionProblem && reason.kind === "expired") {
            setLoadState({ kind: "expired" });
          }
        });
    }, 2_500);
    return () => {
      window.clearInterval(timer);
    };
  }, [loadProposal, projectId, selectedJob]);

  function toggleSource(source: Workspace["sources"][number]["source"]): void {
    setSelectedSourceIds((current) =>
      current.includes(source.id)
        ? current.filter((id) => id !== source.id)
        : current.length >= 32
          ? current
          : [...current, source.id],
    );
    if (source.coordinateFrame !== "project-local" && anchorDrafts[source.id] === undefined) {
      setAnchorDrafts((current) => ({
        ...current,
        [source.id]: minimumFusionAnchorDrafts(),
      }));
    }
  }

  function updateAnchor(
    sourceId: string,
    index: number,
    field: keyof FusionAnchorDraft,
    value: string,
  ): void {
    setAnchorDrafts((current) => {
      const rows = current[sourceId] ?? minimumFusionAnchorDrafts();
      return {
        ...current,
        [sourceId]: rows.map((row, rowIndex) =>
          rowIndex === index ? { ...row, [field]: value } : row,
        ),
      };
    });
  }

  async function startJob(event: SyntheticEvent<HTMLFormElement, SubmitEvent>): Promise<void> {
    event.preventDefault();
    if (!canStart || workspace.baseSnapshot === undefined) return;
    const anchorGroups = buildFusionAnchorGroups(selectedSourceDescriptors, anchorDrafts, () =>
      crypto.randomUUID(),
    );
    if (anchorGroups === undefined) return;
    setBusy("start");
    setAlert(undefined);
    try {
      const job = await fusionClient.createJob(projectId, {
        anchorGroups,
        baseSnapshot: {
          modelId: workspace.baseSnapshot.modelId,
          profile: "existing",
          snapshotId: workspace.baseSnapshot.id,
          snapshotSha256: workspace.baseSnapshot.snapshotSha256,
        },
        inferencePolicy: "label-and-expose",
        label: label.trim(),
        sources: selectedSourceDescriptors,
      });
      setWorkspace((current) =>
        current
          ? { ...current, jobs: [job, ...current.jobs.filter(({ id }) => id !== job.id)] }
          : current,
      );
      setSelectedJobId(job.id);
      setProposal(undefined);
      setDecisions([]);
      setDraft(undefined);
      setConsentConfirmed(false);
      setLiveMessage("Fusion job created with exact source and base hashes.");
    } catch (reason) {
      setAlert(reason instanceof Error ? reason.message : "The fusion job could not be created.");
    } finally {
      setBusy(undefined);
    }
  }

  async function transitionJob(action: "cancel" | "retry"): Promise<void> {
    if (!selectedJob) return;
    setBusy(action);
    setAlert(undefined);
    try {
      const job = await fusionClient[action](projectId, selectedJob);
      setWorkspace((current) =>
        current
          ? { ...current, jobs: current.jobs.map((item) => (item.id === job.id ? job : item)) }
          : current,
      );
      setLiveMessage(`Fusion job ${action === "cancel" ? "cancellation requested" : "requeued"}.`);
      if (action === "retry") {
        setProposal(undefined);
        setDecisions([]);
        setDraft(undefined);
      }
    } catch (reason) {
      if (reason instanceof FusionProblem && reason.kind === "conflict") {
        setAlert(`${reason.message} Reload the exact job version before trying again.`);
      } else {
        setAlert(reason instanceof Error ? reason.message : "The job could not be updated.");
      }
    } finally {
      setBusy(undefined);
    }
  }

  async function review(value: Parameters<typeof fusionClient.review>[2]): Promise<void> {
    if (!selectedJob) return;
    setBusy("review");
    setAlert(undefined);
    try {
      const result = await fusionClient.review(projectId, selectedJob.id, value);
      setProposal(result.proposal);
      setDecisions((current) => [
        ...current.filter(
          (decision) =>
            !result.decisions.some(({ discrepancyId }) => discrepancyId === decision.discrepancyId),
        ),
        ...result.decisions,
      ]);
      setDraft(undefined);
      setLiveMessage(`${String(result.decisions.length)} attributed decision(s) recorded.`);
    } catch (reason) {
      setAlert(
        reason instanceof FusionProblem && reason.kind === "conflict"
          ? `${reason.message} Reload the proposal before deciding.`
          : reason instanceof Error
            ? reason.message
            : "The decisions could not be recorded.",
      );
    } finally {
      setBusy(undefined);
    }
  }

  async function createDraft(): Promise<void> {
    if (!selectedJob || !proposal || !selectedBranchId || proposal.status === "abstained") return;
    const branch = workspace?.branches.find(({ id }) => id === selectedBranchId);
    const decisionIds = materialDecisionIds(decisions, proposal);
    if (!branch || decisionIds.length === 0) return;
    setBusy("draft");
    setAlert(undefined);
    try {
      const next = await fusionClient.createDraft(projectId, selectedJob.id, {
        branchId: branch.id,
        decisionIds: [...decisionIds],
        expectedBranchRevision: branch.revision,
        expectedHeadSnapshotSha256: branch.headSnapshotSha256,
        expectedProposalVersion: proposal.version,
      });
      setDraft(next);
      setLiveMessage("Exact branch-pinned operation draft created. Nothing was committed.");
    } catch (reason) {
      setAlert(
        reason instanceof FusionProblem && reason.kind === "conflict"
          ? `${reason.message} Reload the branch and proposal pins before rebuilding the draft.`
          : reason instanceof Error
            ? reason.message
            : "The operation draft could not be created.",
      );
    } finally {
      setBusy(undefined);
    }
  }

  if (loadState.kind === "loading") {
    return (
      <PageContainer className="workspace-state">
        <LoadingIndicator label="Loading source claims, model pins and fusion jobs" />
      </PageContainer>
    );
  }
  if (loadState.kind === "expired") {
    return (
      <PageContainer className="workspace-state">
        <StatePanel
          actions={
            <Link className="ui-action" href="/sign-in">
              Sign in again
            </Link>
          }
          message="Your session expired. No source, proposal, decision or model state was changed."
          title="Session expired"
          tone="error"
        />
      </PageContainer>
    );
  }
  if (loadState.kind !== "ready") {
    return (
      <PageContainer className="workspace-state">
        <StatePanel
          actions={<ActionButton onClick={() => void loadWorkspace(true)}>Try again</ActionButton>}
          message={"message" in loadState ? loadState.message : "The workspace is unavailable."}
          title={loadState.kind === "offline" ? "You’re offline" : "Fusion is unavailable"}
          tone="error"
        />
      </PageContainer>
    );
  }
  if (!workspace) return null;

  const materialIds = proposal ? materialDecisionIds(decisions, proposal) : [];
  const selectedBranch = workspace.branches.find(({ id }) => id === selectedBranchId);

  return (
    <PageContainer className="fusion-shell">
      <a className="ui-skip-link" href="#fusion-main">
        Skip to fusion workspace
      </a>
      <header className="fusion-hero">
        <div>
          <Link href="/projects">Projects</Link>
          <span aria-hidden="true">/</span>
          <span>{workspace.project.name}</span>
        </div>
        <div className="fusion-hero__copy">
          <div>
            <span className="fusion-eyebrow">Evidence reconciliation · C9</span>
            <h1>Model fusion</h1>
            <p>
              Align independent source claims, expose uncertainty, and prepare typed decisions. This
              workspace never writes the canonical home model.
            </p>
          </div>
          <ActionButton
            disabled={busy === "refresh"}
            onClick={() => void loadWorkspace()}
            tone="secondary"
          >
            {busy === "refresh" ? "Refreshing…" : "Refresh exact state"}
          </ActionButton>
        </div>
      </header>

      <div aria-atomic="true" aria-live="polite" className="sr-only">
        {liveMessage}
      </div>
      {alert ? (
        <div className="inline-alert fusion-alert" role="alert">
          <strong>Action not completed</strong>
          <span>{alert}</span>
          <ActionButton onClick={() => void loadWorkspace()} tone="secondary">
            Reload exact state
          </ActionButton>
        </div>
      ) : null}

      <main id="fusion-main">
        <section className="fusion-builder" aria-labelledby="builder-title">
          <header>
            <div>
              <span className="fusion-eyebrow">01 · Declare inputs</span>
              <h2 id="builder-title">Build a source manifest</h2>
              <p>Choose 2–32 immutable results from at least two source kinds.</p>
            </div>
            <div className="producer-status" aria-label="Fusion producer availability">
              <span data-available={workspace.capabilities.geometryProducer === "available"}>
                Geometry {workspace.capabilities.geometryProducer}
              </span>
              <span data-available={workspace.capabilities.semanticProducer === "available"}>
                Semantic {workspace.capabilities.semanticProducer}
              </span>
            </div>
          </header>

          {workspace.baseSnapshot ? (
            <div className="base-pin">
              <span>Exact existing-condition base</span>
              <strong>Snapshot v{workspace.baseSnapshot.version}</strong>
              <code>{shortHash(workspace.baseSnapshot.snapshotSha256)}</code>
            </div>
          ) : (
            <div className="fusion-blocker" role="status">
              <strong>No existing-condition base snapshot</strong>
              <span>Create or import the canonical existing model before fusion can start.</span>
              <Link href={`/editor/${projectId}`}>Open 2D editor</Link>
            </div>
          )}

          <form className="fusion-create-form" onSubmit={(event) => void startJob(event)}>
            <label className="fusion-label">
              <span>Job label</span>
              <input
                disabled={!editable || Boolean(busy)}
                maxLength={120}
                onChange={(event) => {
                  setLabel(event.target.value);
                }}
                required
                value={label}
              />
            </label>

            <fieldset disabled={!editable || Boolean(busy)}>
              <legend>Immutable source claims</legend>
              {workspace.sources.length === 0 ? (
                <div className="fusion-empty-source">
                  <strong>No eligible multi-source results yet</strong>
                  <span>
                    Complete proposals in plan import, RoomPlan capture, or media reconstruction.
                  </span>
                </div>
              ) : (
                <div className="fusion-source-grid">
                  {workspace.sources.map(({ label: sourceLabel, source, sourceStatus }) => (
                    <label className="fusion-source-card" key={source.id}>
                      <input
                        checked={selectedSourceIds.includes(source.id)}
                        disabled={sourceStatus !== "eligible"}
                        onChange={() => {
                          toggleSource(source);
                        }}
                        type="checkbox"
                      />
                      <span className="source-check" aria-hidden="true" />
                      <span className="source-copy">
                        <strong>{sourceLabel}</strong>
                        <span>{source.kind.replaceAll("-", " ")}</span>
                        <span>
                          {source.elementCount} elements · {source.scaleStatus.replaceAll("-", " ")}
                        </span>
                        <span className="source-claim-label">
                          {source.evidenceState.replaceAll("-", " ")} · training denied
                        </span>
                        <code>{shortHash(source.sha256)}</code>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>

            <div className="fusion-selection-summary" role="status">
              <strong>{selectedSources.length} sources selected</strong>
              <span>{selectedKinds.size} distinct kinds</span>
              <span>
                {registrationReady
                  ? "Every source-local input has a non-collinear registration basis."
                  : "Add three measured, non-collinear correspondences for every source-local input."}
              </span>
            </div>

            {selectedSources.some(({ source }) => source.coordinateFrame !== "project-local") ? (
              <section className="fusion-anchor-panel" aria-labelledby="fusion-anchor-title">
                <header>
                  <div>
                    <h3 id="fusion-anchor-title">Measured registration correspondences</h3>
                    <p>
                      Enter the same three physical points in source and project coordinates. Do not
                      guess: invalid, collinear or unsupported alignment must abstain.
                    </p>
                  </div>
                  <span>
                    {registrationReady ? "Registration ready" : "Registration incomplete"}
                  </span>
                </header>
                {selectedSources
                  .filter(({ source }) => source.coordinateFrame !== "project-local")
                  .map(({ label: sourceLabel, source }) => (
                    <fieldset
                      className="fusion-anchor-source"
                      disabled={!editable || Boolean(busy)}
                      key={source.id}
                    >
                      <legend>{sourceLabel}</legend>
                      <p>
                        {source.coordinateFrame.replaceAll("-", " ")} · values are exact integer
                        millimetres in each declared coordinate frame.
                      </p>
                      <div className="fusion-anchor-rows">
                        {(anchorDrafts[source.id] ?? minimumFusionAnchorDrafts()).map(
                          (row, index) => (
                            <div
                              className="fusion-anchor-row"
                              key={`${source.id}-${String(index)}`}
                            >
                              <strong>Point {index + 1}</strong>
                              {(
                                [
                                  ["sourceX", "Source X"],
                                  ["sourceY", "Source Y"],
                                  ["sourceZ", "Source Z"],
                                  ["projectX", "Project X"],
                                  ["projectY", "Project Y"],
                                  ["projectZ", "Project Z"],
                                ] as const
                              ).map(([field, fieldLabel]) => (
                                <label key={field}>
                                  <span>{fieldLabel} (mm)</span>
                                  <input
                                    data-testid={`anchor-${source.id}-${String(index)}-${field}`}
                                    inputMode="numeric"
                                    max={10_000_000}
                                    min={-10_000_000}
                                    onChange={(event) => {
                                      updateAnchor(source.id, index, field, event.target.value);
                                    }}
                                    required
                                    step={1}
                                    type="number"
                                    value={row[field]}
                                  />
                                </label>
                              ))}
                            </div>
                          ),
                        )}
                      </div>
                    </fieldset>
                  ))}
              </section>
            ) : null}

            <label className="consent-check">
              <input
                checked={consentConfirmed}
                disabled={!editable || Boolean(busy)}
                onChange={(event) => {
                  setConsentConfirmed(event.target.checked);
                }}
                type="checkbox"
              />
              <span>
                I confirm service processing is permitted for these exact source versions. Training
                use remains denied and rights will be rechecked during processing.
              </span>
            </label>
            {editable ? (
              <ActionButton disabled={!canStart} type="submit">
                {busy === "start" ? "Creating durable job…" : "Start proposal-only fusion"}
              </ActionButton>
            ) : (
              <p className="read-only-note">
                Viewer access is read-only. Source claims remain visible.
              </p>
            )}
          </form>
        </section>

        <section className="fusion-workbench" aria-labelledby="jobs-title">
          <aside className="fusion-jobs">
            <header>
              <span className="fusion-eyebrow">02 · Durable execution</span>
              <h2 id="jobs-title">Fusion jobs</h2>
            </header>
            {workspace.jobs.length === 0 ? (
              <p className="fusion-empty-jobs">
                No jobs yet. Declare a valid source manifest above.
              </p>
            ) : (
              <div className="fusion-job-list">
                {workspace.jobs.map((job) => (
                  <button
                    aria-pressed={job.id === selectedJobId}
                    className="fusion-job-button"
                    key={job.id}
                    onClick={() => {
                      setSelectedJobId(job.id);
                      setDecisions([]);
                      setDraft(undefined);
                    }}
                    type="button"
                  >
                    <span>
                      <strong>{job.request.label}</strong>
                      <small>{formattedTime(job.updatedAt)}</small>
                    </span>
                    <span data-state={job.state}>{jobStateLabel(job)}</span>
                  </button>
                ))}
              </div>
            )}
          </aside>

          <div className="fusion-job-detail">
            {selectedJob ? (
              <>
                <header>
                  <div>
                    <span className="fusion-eyebrow">
                      Attempt {selectedJob.attempt} · version {selectedJob.version}
                    </span>
                    <h2>{selectedJob.request.label}</h2>
                    <p>
                      {selectedJob.request.sources.length} exact sources · base{" "}
                      {shortHash(selectedJob.request.baseSnapshot.snapshotSha256)}
                    </p>
                  </div>
                  <div className="fusion-job-actions">
                    {editable && canCancelFusion(selectedJob) ? (
                      <ActionButton
                        disabled={Boolean(busy)}
                        onClick={() => void transitionJob("cancel")}
                        tone="secondary"
                      >
                        {busy === "cancel" ? "Requesting…" : "Cancel job"}
                      </ActionButton>
                    ) : null}
                    {editable && canRetryFusion(selectedJob) ? (
                      <ActionButton
                        disabled={Boolean(busy)}
                        onClick={() => void transitionJob("retry")}
                      >
                        {busy === "retry" ? "Rechecking rights…" : "Retry exact request"}
                      </ActionButton>
                    ) : null}
                  </div>
                </header>
                <ol className="fusion-stage-list" aria-label="Fusion stages">
                  {(["queued", "registering", "fitting", "comparing", "proposed"] as const).map(
                    (stage, index) => {
                      const order = ["queued", "registering", "fitting", "comparing", "proposed"];
                      const current = order.indexOf(selectedJob.state);
                      const complete = current > index || selectedJob.state === "proposed";
                      const active = selectedJob.state === stage;
                      return (
                        <li
                          data-state={complete ? "complete" : active ? "active" : "pending"}
                          key={stage}
                        >
                          <span aria-hidden="true">{complete ? "✓" : index + 1}</span>
                          <strong>{stage}</strong>
                        </li>
                      );
                    },
                  )}
                </ol>
                {selectedJob.safeCode ? (
                  <div className="fusion-safe-code" role="status">
                    <strong>{selectedJob.safeCode}</strong>
                    <span>The job stopped without changing the canonical model.</span>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="fusion-job-placeholder">
                <strong>Select a durable job</strong>
                <span>
                  Its registration, residuals and attributed discrepancies will appear here.
                </span>
              </div>
            )}
          </div>
        </section>

        {proposal ? (
          <>
            <ProposalReview
              busy={busy === "review"}
              decisions={decisions}
              editable={editable}
              onReview={review}
              proposal={proposal}
            />
            {proposal.status !== "abstained" ? (
              <section className="fusion-draft" aria-labelledby="draft-title">
                <header>
                  <div>
                    <span className="fusion-eyebrow">03 · Typed handoff</span>
                    <h2 id="draft-title">Exact C5 operation draft</h2>
                    <p>
                      Build a branch/revision/head-hash-pinned draft. This action never previews,
                      commits, or mutates a branch.
                    </p>
                  </div>
                </header>
                <div className="draft-controls">
                  <label>
                    <span>Target existing-model branch</span>
                    <select
                      disabled={!editable || Boolean(busy) || workspace.branches.length === 0}
                      onChange={(event) => {
                        setSelectedBranchId(event.target.value);
                      }}
                      value={selectedBranchId ?? ""}
                    >
                      {workspace.branches.length === 0 ? (
                        <option value="">No branch available</option>
                      ) : null}
                      {workspace.branches.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.name} · revision {branch.revision}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedBranch ? (
                    <div className="draft-pin">
                      <span>Expected revision {selectedBranch.revision}</span>
                      <code>{shortHash(selectedBranch.headSnapshotSha256)}</code>
                    </div>
                  ) : null}
                  <span>{materialIds.length} material decision(s)</span>
                  {editable ? (
                    <ActionButton
                      disabled={Boolean(busy) || !selectedBranch || materialIds.length === 0}
                      onClick={() => void createDraft()}
                    >
                      {busy === "draft" ? "Building exact draft…" : "Create operation draft"}
                    </ActionButton>
                  ) : null}
                </div>
                {draft ? (
                  <div className="operation-draft" role="status">
                    <header>
                      <div>
                        <strong>Draft ready · not committed</strong>
                        <span>{draft.operations.length} typed operation(s)</span>
                      </div>
                      <code>{draft.schemaVersion}</code>
                    </header>
                    <dl>
                      <div>
                        <dt>Branch</dt>
                        <dd>{draft.branchId}</dd>
                      </div>
                      <div>
                        <dt>Revision pin</dt>
                        <dd>{draft.expectedBranchRevision}</dd>
                      </div>
                      <div>
                        <dt>Head hash pin</dt>
                        <dd>
                          <code>{draft.expectedHeadSnapshotSha256}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>Proposal</dt>
                        <dd>{draft.proposalId}</dd>
                      </div>
                    </dl>
                    <ol>
                      {draft.operations.map((operation) => (
                        <li key={operation.clientOperationId}>
                          <strong>{operation.type.replaceAll(".", " · ")}</strong>
                          <pre>{JSON.stringify(operation, null, 2)}</pre>
                        </li>
                      ))}
                    </ol>
                    <p>
                      Continue in the 2D editor only after reloading the branch. C9 has made no C5
                      preview or commit call.
                    </p>
                  </div>
                ) : null}
              </section>
            ) : null}
          </>
        ) : null}
      </main>
    </PageContainer>
  );
}
