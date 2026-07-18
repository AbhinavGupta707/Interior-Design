"use client";

import type { DesignOption, OptionConfirmation, OptionJob } from "@interior-design/contracts";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ActionButton,
  LoadingIndicator,
  PageContainer,
  StatePanel,
} from "../../components/ui-primitives";
import { ClientProblem, getProject, getSession } from "../auth/api";
import { DesignOptionsProblem, designOptionsClient } from "./api";
import type { ListDesignOptionsResponse } from "./api";
import type {
  DesignOptionEvidenceClassification,
  DesignOptionLaunchContext,
  DesignOptionsWorkspace as Workspace,
} from "./contracts";
import { designOptionsWorkspaceSchema } from "./contracts";
import styles from "./design-options.module.css";
import { GenerationPanel } from "./generation-panel";
import { OptionComparison } from "./option-comparison";
import { optionSafeCodeCopy, optionStageLabels, shortHash } from "./presentation";
import {
  clearDesignOptionRecovery,
  readDesignOptionRecovery,
  saveDesignOptionRecovery,
} from "./recovery";

type LoadState =
  | { readonly kind: "error" | "forbidden" | "offline"; readonly message: string }
  | { readonly kind: "expired" | "loading" | "ready" };

type BusyAction = "cancel" | "generate" | "refresh" | "retry";

function loadStateFrom(reason: unknown): LoadState {
  if (reason instanceof DesignOptionsProblem || reason instanceof ClientProblem) {
    if (reason.kind === "expired") return { kind: "expired" };
    if (reason.kind === "forbidden" || reason.kind === "not-found") {
      return { kind: "forbidden", message: reason.message };
    }
    if (reason.kind === "offline") return { kind: "offline", message: reason.message };
    return { kind: "error", message: reason.message };
  }
  return { kind: "error", message: "The design-option workspace could not be loaded." };
}

function actionMessage(reason: unknown): string {
  if (reason instanceof DesignOptionsProblem) {
    if (reason.kind === "conflict") {
      return "The accepted brief, source model, job, option, or branch changed. Reload the exact latest pins before trying again.";
    }
    if (reason.kind === "option-expired") {
      return "The option expired without creating a branch. Reload or generate a fresh option set.";
    }
    return reason.message;
  }
  return "The action could not be completed. No proposed branch was created or changed.";
}

function formattedTime(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function isActive(job: OptionJob): boolean {
  return ["queued", "running", "cancel-requested"].includes(job.state);
}

function requestFromJob(job: OptionJob): DesignOptionLaunchContext {
  return {
    baseBrief: job.baseBrief,
    requestedDirections: job.requestedDirections,
    requestedOptionCount: job.requestedOptionCount,
    sourceModel: job.sourceModel,
  };
}

export function DesignOptionsWorkspace({
  evidenceClassification,
  launchContext,
  projectId,
}: {
  readonly evidenceClassification: DesignOptionEvidenceClassification;
  readonly launchContext?: DesignOptionLaunchContext;
  readonly projectId: string;
}) {
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [workspace, setWorkspace] = useState<Workspace>();
  const [selectedJobId, setSelectedJobId] = useState<string>();
  const [selectedJob, setSelectedJob] = useState<OptionJob>();
  const [optionsResponse, setOptionsResponse] = useState<ListDesignOptionsResponse>();
  const [selectionLoading, setSelectionLoading] = useState(false);
  const [busy, setBusy] = useState<BusyAction>();
  const [busyOptionId, setBusyOptionId] = useState<string>();
  const [alert, setAlert] = useState<string>();
  const [statusMessage, setStatusMessage] = useState("");
  const [leftOptionId, setLeftOptionId] = useState<string>();
  const [rightOptionId, setRightOptionId] = useState<string>();
  const [acknowledgements, setAcknowledgements] = useState<Readonly<Record<string, boolean>>>({});
  const [confirmations, setConfirmations] = useState<Readonly<Record<string, OptionConfirmation>>>(
    {},
  );
  const alertRef = useRef<HTMLDivElement>(null);

  const loadWorkspace = useCallback(
    async (initial = false) => {
      if (initial) setLoadState({ kind: "loading" });
      else setBusy("refresh");
      setAlert(undefined);
      try {
        const [session, project, jobs] = await Promise.all([
          getSession(),
          getProject(projectId),
          designOptionsClient.listJobs(projectId),
        ]);
        const next = designOptionsWorkspaceSchema.parse({
          evidenceClassification,
          jobs,
          project,
          session,
        });
        setWorkspace(next);
        setLoadState({ kind: "ready" });
        const jobIds = new Set(next.jobs.jobs.map(({ id }) => id));
        const recovery = readDesignOptionRecovery(window.localStorage, projectId);
        const nextJobId =
          (recovery && jobIds.has(recovery.selectedJobId) ? recovery.selectedJobId : undefined) ??
          next.jobs.jobs[0]?.id;
        setSelectedJobId((current) => (current && jobIds.has(current) ? current : nextJobId));
        if (recovery) {
          setLeftOptionId(recovery.leftOptionId);
          setRightOptionId(recovery.rightOptionId);
          setStatusMessage(
            "Recovered the last job and comparison selection. No brief narrative or asset payload was stored in this browser.",
          );
        } else if (!initial) {
          setStatusMessage("Job list and exact source pins refreshed.");
        }
      } catch (reason) {
        setLoadState(loadStateFrom(reason));
      } finally {
        setBusy(undefined);
      }
    },
    [evidenceClassification, projectId],
  );

  const loadSelectedJob = useCallback(
    async (jobId: string, announce = false) => {
      setSelectionLoading(true);
      try {
        const [job, options] = await Promise.all([
          designOptionsClient.getJob(projectId, jobId),
          designOptionsClient.listOptions(projectId, jobId),
        ]);
        setSelectedJob(job);
        setOptionsResponse(options);
        setWorkspace((current) =>
          current
            ? {
                ...current,
                jobs: {
                  ...current.jobs,
                  jobs: current.jobs.jobs.map((candidate) =>
                    candidate.id === job.id ? job : candidate,
                  ),
                },
              }
            : current,
        );
        const ids = new Set(options.options.map(({ id }) => id));
        const defaultLeft = options.options[0]?.id;
        const defaultRight = options.options.find(({ id }) => id !== defaultLeft)?.id;
        setLeftOptionId((current) => (current && ids.has(current) ? current : defaultLeft));
        setRightOptionId((current) =>
          current && ids.has(current) && current !== defaultLeft ? current : defaultRight,
        );
        if (announce) {
          setStatusMessage(
            `Job version ${String(job.version)} refreshed in state ${job.state}. ${String(options.options.length)} options available.`,
          );
        }
      } catch (reason) {
        setAlert(actionMessage(reason));
      } finally {
        setSelectionLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    void loadWorkspace(true);
  }, [loadWorkspace]);

  useEffect(() => {
    if (!selectedJobId || loadState.kind !== "ready") {
      setSelectedJob(undefined);
      setOptionsResponse(undefined);
      return;
    }
    void loadSelectedJob(selectedJobId);
  }, [loadSelectedJob, loadState.kind, selectedJobId]);

  useEffect(() => {
    if (!selectedJob || !isActive(selectedJob)) return;
    const timeout = window.setTimeout(() => {
      void loadSelectedJob(selectedJob.id);
    }, 2_000);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [loadSelectedJob, selectedJob]);

  useEffect(() => {
    if (!alert) return;
    alertRef.current?.focus();
  }, [alert]);

  useEffect(() => {
    if (!selectedJobId) return;
    saveDesignOptionRecovery(window.localStorage, {
      ...(leftOptionId ? { leftOptionId } : {}),
      projectId,
      ...(rightOptionId ? { rightOptionId } : {}),
      savedAt: new Date().toISOString(),
      schemaVersion: "c12-design-options-recovery-v1",
      selectedJobId,
    });
  }, [leftOptionId, projectId, rightOptionId, selectedJobId]);

  const sortedJobs = useMemo(
    () =>
      [...(workspace?.jobs.jobs ?? [])].sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      ),
    [workspace?.jobs.jobs],
  );
  const generationSource =
    launchContext ?? (sortedJobs[0] ? requestFromJob(sortedJobs[0]) : undefined);
  const editable = workspace ? workspace.session.actor.role !== "viewer" : false;

  async function generate(request: DesignOptionLaunchContext): Promise<void> {
    if (!workspace || !editable || busy) return;
    setBusy("generate");
    setAlert(undefined);
    try {
      const job = await designOptionsClient.createJob(projectId, request);
      setWorkspace((current) =>
        current
          ? {
              ...current,
              jobs: { ...current.jobs, jobs: [job, ...current.jobs.jobs] },
            }
          : current,
      );
      setSelectedJobId(job.id);
      setAcknowledgements({});
      setStatusMessage(
        "Option generation queued. The canonical model remains unchanged until an explicit option confirmation.",
      );
    } catch (reason) {
      setAlert(actionMessage(reason));
    } finally {
      setBusy(undefined);
    }
  }

  async function cancelSelected(): Promise<void> {
    if (!selectedJob || !editable || busy) return;
    setBusy("cancel");
    setAlert(undefined);
    try {
      const job = await designOptionsClient.cancelJob(projectId, selectedJob.id);
      setSelectedJob(job);
      setStatusMessage(
        "Cancellation requested. No unpublished or partial option can be confirmed.",
      );
      await loadWorkspace(false);
    } catch (reason) {
      setAlert(actionMessage(reason));
    } finally {
      setBusy(undefined);
    }
  }

  async function retrySelected(): Promise<void> {
    if (!selectedJob || !editable || busy || !selectedJob.retryable) return;
    setBusy("retry");
    setAlert(undefined);
    try {
      const job = await designOptionsClient.retryJob(projectId, selectedJob.id);
      setSelectedJobId(job.id);
      setSelectedJob(job);
      setAcknowledgements({});
      setStatusMessage("A bounded retry was queued against exact source pins.");
      await loadWorkspace(false);
    } catch (reason) {
      setAlert(actionMessage(reason));
    } finally {
      setBusy(undefined);
    }
  }

  async function confirmOption(option: DesignOption): Promise<void> {
    const optionSet = optionsResponse?.optionSet;
    if (!selectedJob || !optionSet || !editable || busyOptionId) return;
    setBusyOptionId(option.id);
    setAlert(undefined);
    try {
      const confirmation = await designOptionsClient.confirmOption(
        projectId,
        selectedJob,
        option,
        optionSet.setSha256,
      );
      setConfirmations((current) => ({ ...current, [option.id]: confirmation }));
      setAcknowledgements((current) => ({ ...current, [option.id]: false }));
      setStatusMessage(
        `Option confirmed into proposed branch ${confirmation.branchId}, revision ${String(confirmation.branchRevision)}. Sibling options remain available.`,
      );
      await loadSelectedJob(selectedJob.id);
    } catch (reason) {
      setAlert(actionMessage(reason));
    } finally {
      setBusyOptionId(undefined);
    }
  }

  if (loadState.kind === "loading") {
    return (
      <PageContainer className={styles.statePage}>
        <LoadingIndicator label="Loading exact brief, model, job, and role pins…" />
      </PageContainer>
    );
  }
  if (loadState.kind === "expired") {
    return (
      <PageContainer className={styles.statePage}>
        <StatePanel
          actions={
            <a className="ui-action" data-tone="primary" href="/sign-in">
              Sign in again
            </a>
          }
          message={<p>Your session expired before any option or proposed branch was changed.</p>}
          status="Session expired"
          title="Return safely to design options"
          tone="error"
        />
      </PageContainer>
    );
  }
  if (loadState.kind !== "ready" || !workspace) {
    return (
      <PageContainer className={styles.statePage}>
        <StatePanel
          actions={
            <ActionButton onClick={() => void loadWorkspace(true)} tone="primary">
              Retry workspace
            </ActionButton>
          }
          message={
            <p>
              {loadState.kind === "offline"
                ? "Reconnect, then retry. No option or canonical state was changed."
                : "message" in loadState
                  ? loadState.message
                  : "The design-option workspace could not be loaded."}
            </p>
          }
          status={loadState.kind === "forbidden" ? "Read unavailable" : "Workspace unavailable"}
          title={
            loadState.kind === "offline" ? "You appear to be offline" : "Pinned state stayed safe"
          }
          tone="error"
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer
      className={styles.shell}
      data-existing-profile-mutations="0"
      data-testid="design-options-workspace"
    >
      <p aria-atomic="true" aria-live="polite" className={styles.visuallyHidden} role="status">
        {statusMessage}
      </p>
      <header className={styles.hero}>
        <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
          <Link href="/projects">Projects</Link>
          <span aria-hidden="true">/</span>
          <Link href={`/design-consultation/${projectId}`}>Accepted brief</Link>
          <span aria-hidden="true">/</span>
          <span>Design options</span>
        </nav>
        <div className={styles.heroGrid}>
          <div>
            <h1>Compare what actually changes</h1>
            <p>
              Generate bounded furnishing, finish, and lighting proposals. Inspect exact pins,
              computational limits, real differences, and review routes before creating any proposed
              branch.
            </p>
          </div>
          <dl className={styles.heroMeta}>
            <div>
              <dt>Project</dt>
              <dd>{workspace.project.name}</dd>
            </div>
            <div>
              <dt>Access</dt>
              <dd>
                {workspace.session.actor.role} · {editable ? "can confirm" : "read-only"}
              </dd>
            </div>
            <div>
              <dt>Jobs</dt>
              <dd>{sortedJobs.length}</dd>
            </div>
          </dl>
        </div>
        <div className={styles.capabilityBar} role="note">
          <div>
            <strong>Deterministic local design engine</strong>
            <span>No external network, provider key, GPU, or training use</span>
          </div>
          <div>
            <strong>Proposal-only generation</strong>
            <span>Only explicit owner/editor confirmation can create a proposed branch</span>
          </div>
          <div>
            <strong>
              {workspace.evidenceClassification === "synthetic-fixture"
                ? "Synthetic fixture presentation"
                : "Production-composed backend evidence"}
            </strong>
            <span>Fixtures are never relabelled as live backend or human-quality evidence</span>
          </div>
        </div>
      </header>

      {!editable ? (
        <div className={styles.readOnlyBanner} role="note">
          <strong>Viewer access is read-only.</strong>
          <span>
            You can inspect options and differences but cannot generate, cancel, retry, or confirm.
          </span>
        </div>
      ) : null}
      {alert ? (
        <div aria-atomic="true" className={styles.alert} ref={alertRef} role="alert" tabIndex={-1}>
          <div>
            <strong>Action not completed</strong>
            <span>{alert}</span>
          </div>
          <ActionButton
            disabled={busy !== undefined || busyOptionId !== undefined}
            onClick={() => {
              if (selectedJobId) void loadSelectedJob(selectedJobId, true);
              else void loadWorkspace(false);
            }}
            tone="quiet"
          >
            Reload exact pins
          </ActionButton>
        </div>
      ) : null}

      <GenerationPanel
        busy={busy === "generate"}
        editable={editable}
        onGenerate={generate}
        projectId={projectId}
        {...(generationSource ? { source: generationSource } : {})}
      />

      <section aria-labelledby="jobs-title" className={styles.jobWorkspace}>
        <aside className={styles.jobRail}>
          <header>
            <div>
              <p className={styles.sectionLabel}>History</p>
              <h2 id="jobs-title">Option jobs</h2>
            </div>
            <ActionButton
              disabled={busy !== undefined}
              onClick={() => void loadWorkspace(false)}
              tone="quiet"
            >
              {busy === "refresh" ? "Refreshing…" : "Refresh"}
            </ActionButton>
          </header>
          {sortedJobs.length === 0 ? (
            <div className={styles.emptyRail}>
              <strong>No option jobs yet</strong>
              <span>Generation will appear here with exact source pins and state history.</span>
            </div>
          ) : (
            <ul>
              {sortedJobs.map((job) => (
                <li key={job.id}>
                  <button
                    aria-pressed={selectedJobId === job.id}
                    data-selected={String(selectedJobId === job.id)}
                    onClick={() => {
                      setAlert(undefined);
                      setSelectedJobId(job.id);
                    }}
                    type="button"
                  >
                    <strong>{optionStageLabels[job.stage]}</strong>
                    <span>
                      {job.state} · version {job.version} · {formattedTime(job.updatedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <div className={styles.jobMain}>
          {selectionLoading ? (
            <LoadingIndicator label="Loading the selected job and immutable option set…" />
          ) : selectedJob ? (
            <>
              <header className={styles.jobHeader}>
                <div>
                  <p className={styles.sectionLabel}>Job state</p>
                  <h2>{optionStageLabels[selectedJob.stage]}</h2>
                  <p>
                    {selectedJob.state} · attempt {selectedJob.attempt} · version{" "}
                    {selectedJob.version}
                  </p>
                </div>
                <div className={styles.jobActions}>
                  {isActive(selectedJob) && editable ? (
                    <ActionButton
                      disabled={busy !== undefined || selectedJob.state === "cancel-requested"}
                      onClick={() => void cancelSelected()}
                      tone="quiet"
                    >
                      {busy === "cancel" ? "Requesting cancel…" : "Cancel safely"}
                    </ActionButton>
                  ) : null}
                  {selectedJob.retryable && editable ? (
                    <ActionButton
                      disabled={busy !== undefined}
                      onClick={() => void retrySelected()}
                      tone="quiet"
                    >
                      {busy === "retry" ? "Retrying…" : "Retry from exact pins"}
                    </ActionButton>
                  ) : null}
                </div>
              </header>
              <dl className={styles.pinGrid}>
                <div>
                  <dt>Accepted brief</dt>
                  <dd>
                    Revision {selectedJob.baseBrief.revision} ·{" "}
                    <code>{selectedJob.baseBrief.briefId}</code>
                  </dd>
                </div>
                <div>
                  <dt>Brief hash</dt>
                  <dd>
                    <code title={selectedJob.baseBrief.contentSha256}>
                      {shortHash(selectedJob.baseBrief.contentSha256)}
                    </code>
                  </dd>
                </div>
                <div>
                  <dt>Source snapshot</dt>
                  <dd>
                    {selectedJob.sourceModel.profile} · version{" "}
                    {selectedJob.sourceModel.snapshotVersion}
                  </dd>
                </div>
                <div>
                  <dt>Source hash</dt>
                  <dd>
                    <code title={selectedJob.sourceModel.snapshotSha256}>
                      {shortHash(selectedJob.sourceModel.snapshotSha256)}
                    </code>
                  </dd>
                </div>
                <div>
                  <dt>Derived constraints</dt>
                  <dd>
                    {selectedJob.constraints.length} ·{" "}
                    <code>{shortHash(selectedJob.constraintsSha256)}</code>
                  </dd>
                </div>
                <div>
                  <dt>Asset manifest</dt>
                  <dd>
                    <code>{shortHash(selectedJob.assetManifestSha256)}</code>
                  </dd>
                </div>
              </dl>
              {selectedJob.safeCode ? (
                <div className={styles.jobOutcome} data-state={selectedJob.state}>
                  <strong>
                    {selectedJob.state === "abstained"
                      ? "The engine abstained"
                      : "Job stopped safely"}
                  </strong>
                  <p>{optionSafeCodeCopy[selectedJob.safeCode]}</p>
                  <span>No partial option set or proposed branch is available.</span>
                </div>
              ) : null}
              {selectedJob.state === "cancelled" ? (
                <div className={styles.jobOutcome} data-state="cancelled">
                  <strong>Generation cancelled</strong>
                  <p>
                    No unpublished result can be confirmed. Retry only from the displayed exact
                    pins.
                  </p>
                </div>
              ) : null}
              {isActive(selectedJob) ? (
                <div className={styles.progressPanel} role="status">
                  <span className={styles.progressTrack}>
                    <span data-stage={selectedJob.stage} />
                  </span>
                  <p>
                    {optionStageLabels[selectedJob.stage]}. The workspace will refresh
                    automatically.
                  </p>
                </div>
              ) : null}
              {selectedJob.state === "succeeded" &&
              optionsResponse?.optionSet &&
              leftOptionId &&
              rightOptionId ? (
                <OptionComparison
                  acknowledgements={acknowledgements}
                  {...(busyOptionId ? { busyOptionId } : {})}
                  confirmations={confirmations}
                  editable={editable}
                  job={selectedJob}
                  leftOptionId={leftOptionId}
                  onAcknowledgedChange={(optionId, checked) => {
                    setAcknowledgements((current) => ({ ...current, [optionId]: checked }));
                  }}
                  onConfirm={(option) => void confirmOption(option)}
                  onSelectionChange={(side, optionId) => {
                    setAcknowledgements({});
                    if (side === "left") setLeftOptionId(optionId);
                    else setRightOptionId(optionId);
                  }}
                  optionSet={optionsResponse.optionSet}
                  options={optionsResponse.options}
                  rightOptionId={rightOptionId}
                />
              ) : selectedJob.state === "succeeded" ? (
                <div className={styles.jobOutcome} data-state="failed">
                  <strong>Complete option set unavailable</strong>
                  <p>
                    A successful job must contain at least two options and a complete pairwise
                    matrix. Reload before taking any action.
                  </p>
                </div>
              ) : null}
            </>
          ) : (
            <div className={styles.emptyBody}>
              <h2>Select an option job</h2>
              <p>Inspect source pins, progress, outcomes, and immutable options here.</p>
            </div>
          )}
        </div>
      </section>
      <footer className={styles.boundaryFooter}>
        <strong>Professional boundary</strong>
        <p>
          “Valid” means the frozen computational constraints passed. Review-required questions
          remain unresolved until an accountable person with the relevant competence reviews them.
          Existing and as-built profiles never change through this workspace.
        </p>
        <button
          className={styles.clearRecovery}
          onClick={() => {
            clearDesignOptionRecovery(window.localStorage, projectId);
            setStatusMessage(
              "Local job selection recovery cleared. Server options were unchanged.",
            );
          }}
          type="button"
        >
          Clear local selection recovery
        </button>
      </footer>
    </PageContainer>
  );
}
