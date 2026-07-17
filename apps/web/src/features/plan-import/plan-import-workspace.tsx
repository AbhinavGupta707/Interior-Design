"use client";

import type {
  ModelOperationsPreview,
  PlanCalibration,
  PlanOperationDraft,
  PlanParserResult,
  PlanProcessingJob,
  PlanProposal,
  PlanSourcePoint,
} from "@interior-design/contracts";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SyntheticEvent } from "react";

import {
  ActionButton,
  LoadingIndicator,
  PageContainer,
  StatePanel,
} from "../../components/ui-primitives";
import { editorClient, EditorProblem } from "../editor-2d/api";
import { PlanOverlay } from "../editor-2d/plan-overlay/plan-overlay";
import { CandidateInspector, CandidateList } from "./candidate-review";
import { planImportClient, PlanImportProblem } from "./api";
import type { PlanImportWorkspace, PlanSourcePreview } from "./contracts";
import {
  buildOperationDraftInput,
  calibrationRequestFromKnownLength,
  defaultReview,
} from "./review-model";
import type { CandidateReview, CandidateReviewMap } from "./review-model";

type LoadState =
  | { kind: "error" | "forbidden" | "offline"; message: string }
  | { kind: "expired" }
  | { kind: "loading" }
  | { kind: "ready" };

type BusyAction =
  | "calibrate"
  | "cancel"
  | "commit"
  | "draft"
  | "preview"
  | "refresh"
  | "retry"
  | "source-preview"
  | "start";

function shortHash(value: string): string {
  return `${value.slice(0, 12)}…`;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function loadStateFrom(reason: unknown): LoadState {
  if (reason instanceof PlanImportProblem) {
    if (reason.kind === "expired") return { kind: "expired" };
    if (reason.kind === "forbidden" || reason.kind === "not-found") {
      return { kind: "forbidden", message: reason.message };
    }
    if (reason.kind === "offline") return { kind: "offline", message: reason.message };
    return { kind: "error", message: reason.message };
  }
  return { kind: "error", message: "The plan workspace could not be loaded." };
}

function initialReviews(proposal: PlanProposal): CandidateReviewMap {
  return Object.fromEntries(
    proposal.candidates.map((candidate) => [candidate.candidateId, defaultReview(candidate)]),
  );
}

export function PlanImportWorkspace({ projectId }: { readonly projectId: string }) {
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [workspace, setWorkspace] = useState<PlanImportWorkspace>();
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [pageNumber, setPageNumber] = useState(1);
  const [parserPreference, setParserPreference] = useState<
    "auto" | "fixture" | "raster" | "vector"
  >("auto");
  const [selectedJobId, setSelectedJobId] = useState<string>();
  const [result, setResult] = useState<PlanParserResult>();
  const [sourcePreview, setSourcePreview] = useState<PlanSourcePreview>();
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>();
  const [reviews, setReviews] = useState<CandidateReviewMap>({});
  const [calibration, setCalibration] = useState<PlanCalibration>();
  const [calibrationStart, setCalibrationStart] = useState<PlanSourcePoint>({ x: 0, y: 0 });
  const [calibrationEnd, setCalibrationEnd] = useState<PlanSourcePoint>({ x: 1_000, y: 0 });
  const [knownLengthMillimetres, setKnownLengthMillimetres] = useState(1_000);
  const [calibrationConfirmed, setCalibrationConfirmed] = useState(false);
  const [calibrationPick, setCalibrationPick] = useState<"end" | "start">();
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [acknowledgedFindingCodes, setAcknowledgedFindingCodes] = useState<readonly string[]>([]);
  const [draft, setDraft] = useState<PlanOperationDraft>();
  const [preview, setPreview] = useState<ModelOperationsPreview>();
  const [commitMessage, setCommitMessage] = useState("Import reviewed floor-plan proposal");
  const [commitSummary, setCommitSummary] = useState<string>();
  const [busy, setBusy] = useState<BusyAction>();
  const [alert, setAlert] = useState<string>();
  const [liveMessage, setLiveMessage] = useState("");
  const [conflict, setConflict] = useState<{
    readonly currentHeadSnapshotSha256?: string;
    readonly currentRevision?: number;
    readonly detail: string;
  }>();
  const reviewStartedAt = useRef(Date.now());

  const loadWorkspace = useCallback(
    async (initial = false) => {
      if (initial) setLoadState({ kind: "loading" });
      else setBusy("refresh");
      setAlert(undefined);
      try {
        const next = await planImportClient.loadWorkspace(projectId);
        setWorkspace(next);
        setSelectedAssetId((current) =>
          next.assets.some(({ id }) => id === current) ? current : (next.assets[0]?.id ?? ""),
        );
        setSelectedBranchId((current) =>
          next.branches.some(({ id }) => id === current) ? current : (next.branches[0]?.id ?? ""),
        );
        setSelectedJobId((current) =>
          next.jobs.some(({ id }) => id === current) ? current : next.jobs[0]?.id,
        );
        setLoadState({ kind: "ready" });
        if (!initial) setLiveMessage("Plan jobs and branch targets refreshed from the server.");
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
  const selectedCandidate =
    result?.status === "proposal"
      ? result.candidates.find(({ candidateId }) => candidateId === selectedCandidateId)
      : undefined;
  const editable = workspace ? workspace.session.actor.role !== "viewer" : false;

  const loadResult = useCallback(
    async (job: PlanProcessingJob) => {
      if (job.state !== "proposed" && job.state !== "abstained") {
        setResult(undefined);
        return;
      }
      try {
        const next = await planImportClient.getProposal(projectId, job.id);
        setResult(next);
        setSourcePreview(undefined);
        setCalibration(undefined);
        setDraft(undefined);
        setPreview(undefined);
        setCommitSummary(undefined);
        setConflict(undefined);
        if (next.status === "proposal") {
          setReviews(initialReviews(next));
          setSelectedCandidateId(next.candidates[0]?.candidateId);
          const firstWall = next.candidates.find((candidate) => candidate.kind === "wall");
          if (firstWall?.kind === "wall") {
            setCalibrationStart(firstWall.start);
            setCalibrationEnd(firstWall.end);
          }
          reviewStartedAt.current = Date.now();
        }
      } catch (reason) {
        setAlert(reason instanceof Error ? reason.message : "The proposal could not be loaded.");
      }
    },
    [projectId],
  );

  useEffect(() => {
    if (selectedJob) void loadResult(selectedJob);
  }, [loadResult, selectedJob?.id, selectedJob?.state]);

  useEffect(() => {
    if (!selectedJob || !["queued", "processing", "cancel-requested"].includes(selectedJob.state)) {
      return;
    }
    const timer = window.setInterval(() => {
      void planImportClient
        .getJob(projectId, selectedJob.id)
        .then((job) => {
          setWorkspace((current) =>
            current
              ? { ...current, jobs: current.jobs.map((item) => (item.id === job.id ? job : item)) }
              : current,
          );
          setLiveMessage(`Plan job status changed to ${job.state}.`);
        })
        .catch((reason: unknown) => {
          if (reason instanceof PlanImportProblem && reason.kind === "expired") {
            setLoadState({ kind: "expired" });
          }
        });
    }, 2_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [projectId, selectedJob]);

  async function startJob(event: SyntheticEvent<HTMLFormElement, SubmitEvent>): Promise<void> {
    event.preventDefault();
    if (!selectedAssetId) return;
    setBusy("start");
    setAlert(undefined);
    try {
      const job = await planImportClient.createJob(projectId, {
        assetId: selectedAssetId,
        pageIndex: pageNumber - 1,
        parserPreference,
      });
      setWorkspace((current) =>
        current
          ? { ...current, jobs: [job, ...current.jobs.filter(({ id }) => id !== job.id)] }
          : current,
      );
      setSelectedJobId(job.id);
      setLiveMessage(`Plan job ${job.id} started in ${job.state} state.`);
    } catch (reason) {
      setAlert(reason instanceof Error ? reason.message : "The plan job could not be started.");
    } finally {
      setBusy(undefined);
    }
  }

  async function transitionJob(action: "cancel" | "retry"): Promise<void> {
    if (!selectedJob) return;
    setBusy(action);
    setAlert(undefined);
    try {
      const job =
        action === "cancel"
          ? await planImportClient.cancel(projectId, selectedJob)
          : await planImportClient.retry(projectId, selectedJob);
      setWorkspace((current) =>
        current
          ? { ...current, jobs: current.jobs.map((item) => (item.id === job.id ? job : item)) }
          : current,
      );
      setLiveMessage(`Plan job is now ${job.state}.`);
    } catch (reason) {
      setAlert(reason instanceof Error ? reason.message : `The job could not be ${action}led.`);
    } finally {
      setBusy(undefined);
    }
  }

  async function requestSourcePreview(): Promise<void> {
    if (!selectedJob) return;
    setBusy("source-preview");
    setAlert(undefined);
    try {
      const access = await planImportClient.requestSourcePreview(projectId, selectedJob.id);
      setSourcePreview(access);
      setLiveMessage("A short-lived safe derived source preview is loaded in the overlay.");
    } catch (reason) {
      setAlert(
        reason instanceof Error ? reason.message : "The derived source preview is unavailable.",
      );
    } finally {
      setBusy(undefined);
    }
  }

  async function submitCalibration(
    event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ): Promise<void> {
    event.preventDefault();
    if (!selectedJob || result?.status !== "proposal" || !calibrationConfirmed) return;
    setBusy("calibrate");
    setAlert(undefined);
    try {
      const request = calibrationRequestFromKnownLength({
        knownLengthMillimetres,
        sourceEnd: calibrationEnd,
        sourceStart: calibrationStart,
      });
      const next = await planImportClient.calibrate(projectId, selectedJob.id, request);
      setCalibration(next);
      setDraft(undefined);
      setPreview(undefined);
      setCalibrationConfirmed(false);
      setLiveMessage(`Calibration saved with ${String(next.residualMillimetres)} mm residual.`);
    } catch (reason) {
      setAlert(reason instanceof Error ? reason.message : "The calibration could not be saved.");
    } finally {
      setBusy(undefined);
    }
  }

  function updateReview(candidateId: string, review: CandidateReview): void {
    setReviews((current) => ({ ...current, [candidateId]: review }));
    setDraft(undefined);
    setPreview(undefined);
    setCommitSummary(undefined);
    setConflict(undefined);
    setLiveMessage(`Candidate ${candidateId} is ${review.decision}.`);
  }

  const reviewSummary = useMemo(() => {
    if (result?.status !== "proposal") return undefined;
    const counts = { accepted: 0, corrected: 0, excluded: 0, unresolved: 0 };
    for (const candidate of result.candidates) {
      const decision = (reviews[candidate.candidateId] ?? defaultReview(candidate)).decision;
      counts[decision] += 1;
    }
    return counts;
  }, [result, reviews]);

  const draftInput = useMemo(() => {
    if (!calibration || result?.status !== "proposal" || !workspace) return undefined;
    try {
      return {
        value: buildOperationDraftInput({
          actorUserId: workspace.session.actor.userId,
          calibration,
          proposal: result,
          reviews,
        }),
      } as const;
    } catch (reason) {
      return {
        error: reason instanceof Error ? reason.message : "Exact operations could not be built.",
      } as const;
    }
  }, [calibration, result, reviews, workspace]);

  const selectedBranch = workspace?.branches.find(({ id }) => id === selectedBranchId);
  const warningCodes =
    result?.status === "proposal"
      ? result.findings.filter(({ severity }) => severity === "warning").map(({ code }) => code)
      : [];
  const severeBlocked =
    result?.status === "proposal" &&
    (result.findings.some(({ severity }) => severity === "error") ||
      result.unresolvedRegions.length > 0);
  const allWarningsAcknowledged = warningCodes.every((code) =>
    acknowledgedFindingCodes.includes(code),
  );
  const operations = draftInput && "value" in draftInput ? draftInput.value.operations : [];
  const canCreateDraft = Boolean(
    editable &&
    calibration &&
    selectedBranch &&
    reviewSummary &&
    reviewSummary.unresolved === 0 &&
    !severeBlocked &&
    allWarningsAcknowledged &&
    operations.length >= 1 &&
    operations.length <= 50,
  );

  async function createDraft(): Promise<void> {
    if (
      !selectedJob ||
      result?.status !== "proposal" ||
      !calibration ||
      !selectedBranch ||
      !draftInput ||
      !("value" in draftInput)
    )
      return;
    setBusy("draft");
    setAlert(undefined);
    try {
      const next = await planImportClient.createDraft(projectId, selectedJob.id, {
        acknowledgedFindingCodes: [...acknowledgedFindingCodes],
        calibrationId: calibration.id,
        decisions: [...draftInput.value.decisions],
        operations: [...draftInput.value.operations],
        reviewDurationMilliseconds: Math.min(86_400_000, Date.now() - reviewStartedAt.current),
        target: {
          branchId: selectedBranch.id,
          expectedHeadSnapshotSha256: selectedBranch.headSnapshotSha256,
          expectedRevision: selectedBranch.revision,
          profile: selectedBranch.profile,
        },
      });
      setDraft(next);
      setPreview(undefined);
      setLiveMessage(
        `Immutable operation draft ${next.id} created with ${String(next.operations.length)} operations.`,
      );
    } catch (reason) {
      setAlert(
        reason instanceof Error ? reason.message : "The operation draft could not be created.",
      );
    } finally {
      setBusy(undefined);
    }
  }

  function receiveConflict(reason: EditorProblem): boolean {
    if (reason.kind !== "conflict") return false;
    setConflict({
      ...(reason.currentHeadSnapshotSha256
        ? { currentHeadSnapshotSha256: reason.currentHeadSnapshotSha256 }
        : {}),
      ...(reason.currentRevision === undefined ? {} : { currentRevision: reason.currentRevision }),
      detail: reason.message,
    });
    setLiveMessage("The C5 branch changed. Review decisions remain local for recovery.");
    return true;
  }

  async function previewDraft(): Promise<void> {
    if (!draft) return;
    setBusy("preview");
    setAlert(undefined);
    try {
      const next = await editorClient.preview(
        projectId,
        draft.target.profile,
        draft.target.branchId,
        draft.operations,
        draft.target.expectedRevision,
        draft.target.expectedHeadSnapshotSha256,
      );
      setPreview(next);
      setLiveMessage(`C5 preview ready with ${String(next.findings.length)} validation findings.`);
    } catch (reason) {
      if (!(reason instanceof EditorProblem && receiveConflict(reason))) {
        setAlert(reason instanceof Error ? reason.message : "The C5 preview could not be created.");
      }
    } finally {
      setBusy(undefined);
    }
  }

  async function commitPreview(event: SyntheticEvent<HTMLFormElement, SubmitEvent>): Promise<void> {
    event.preventDefault();
    if (!draft || !preview || preview.hasBlockingFindings) return;
    setBusy("commit");
    setAlert(undefined);
    try {
      const committed = await editorClient.commit(
        projectId,
        draft.target.profile,
        draft.target.branchId,
        {
          commitMessage,
          expectedHeadSnapshotSha256: draft.target.expectedHeadSnapshotSha256,
          expectedRevision: draft.target.expectedRevision,
          previewId: preview.id,
        },
      );
      setCommitSummary(
        `Committed C5 revision ${String(committed.branch.revision)} with snapshot ${shortHash(committed.branch.headSnapshotSha256)}.`,
      );
      setLiveMessage("The reviewed plan operations were committed through C5 append-only history.");
      await loadWorkspace(false);
    } catch (reason) {
      if (!(reason instanceof EditorProblem && receiveConflict(reason))) {
        setAlert(
          reason instanceof Error ? reason.message : "The C5 preview could not be committed.",
        );
      }
    } finally {
      setBusy(undefined);
    }
  }

  async function recoverConflict(): Promise<void> {
    await loadWorkspace(false);
    setDraft(undefined);
    setPreview(undefined);
    setConflict(undefined);
    setLiveMessage(
      "Current branch head loaded. Create a new immutable draft before previewing again.",
    );
  }

  if (loadState.kind === "loading") {
    return (
      <PageContainer className="plan-import-state">
        <LoadingIndicator label="Loading ready plan assets and durable jobs" />
      </PageContainer>
    );
  }
  if (loadState.kind === "expired") {
    return (
      <PlanState
        title="Your session has expired"
        message="Sign in again to reauthenticate current project membership. No review decision was submitted."
        actionHref="/sign-in"
        actionLabel="Sign in again"
      />
    );
  }
  if (loadState.kind === "forbidden") {
    return (
      <PlanState
        title="Plan workspace unavailable"
        message={loadState.message}
        actionHref="/projects"
        actionLabel="Return to projects"
      />
    );
  }
  if (loadState.kind === "offline" || loadState.kind === "error") {
    return (
      <PlanState
        title={
          loadState.kind === "offline" ? "You’re offline" : "Plan workspace could not be loaded"
        }
        message={loadState.message}
        action={() => loadWorkspace(true)}
        actionLabel="Retry"
      />
    );
  }
  if (!workspace) return null;

  return (
    <PageContainer className="plan-import-workspace">
      <p aria-live="polite" className="plan-import-live">
        {liveMessage}
      </p>
      <header className="plan-import-heading">
        <div>
          <Link className="back-link" href="/projects">
            ← Projects
          </Link>
          <h1>Floor-plan correction</h1>
          <p>
            Inspect a source-pinned proposal, keep unknowns visible, and hand exact operations to
            C5.
          </p>
        </div>
        <div className="plan-import-role" data-readonly={!editable}>
          <strong>{workspace.session.actor.displayName}</strong>
          <span>
            {workspace.session.actor.role} · {editable ? "review enabled" : "read-only"}
          </span>
        </div>
      </header>

      {alert ? (
        <p className="plan-import-alert" role="alert">
          {alert}
        </p>
      ) : null}

      <section className="plan-import-source" aria-labelledby="plan-source-title">
        <header>
          <div>
            <span>Step 1</span>
            <h2 id="plan-source-title">Choose a ready plan page</h2>
            <p>Supported results are proposals, not surveys or structural/regulatory findings.</p>
          </div>
          <button
            className="text-action"
            disabled={busy === "refresh"}
            onClick={() => void loadWorkspace(false)}
            type="button"
          >
            Refresh status
          </button>
        </header>
        {workspace.assets.length === 0 ? (
          <div className="plan-recovery-panel">
            <h3>No C6-ready plan asset</h3>
            <p>
              Upload or replace a plan that is ready, rights-cleared, under 25 MiB and detected as
              PDF, SVG, PNG or JPEG.
            </p>
            <Link className="ui-action" data-tone="secondary" href={`/evidence/${projectId}`}>
              Open evidence
            </Link>
          </div>
        ) : editable ? (
          <form className="plan-start-form" onSubmit={(event) => void startJob(event)}>
            <label className="plan-start-form__asset">
              <span>Ready plan asset</span>
              <select
                onChange={(event) => {
                  setSelectedAssetId(event.target.value);
                }}
                value={selectedAssetId}
              >
                {workspace.assets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.fileName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Page · 1–20</span>
              <input
                max={20}
                min={1}
                onChange={(event) => {
                  setPageNumber(Number(event.target.value));
                }}
                required
                type="number"
                value={pageNumber}
              />
            </label>
            <label>
              <span>Parser</span>
              <select
                onChange={(event) => {
                  setParserPreference(event.target.value as typeof parserPreference);
                }}
                value={parserPreference}
              >
                <option value="auto">Automatic deterministic</option>
                <option value="vector">Vector</option>
                <option value="raster">CPU raster</option>
                <option value="fixture">Fixture</option>
              </select>
            </label>
            <ActionButton disabled={busy === "start" || !selectedAssetId} type="submit">
              {busy === "start" ? "Starting…" : "Start proposal job"}
            </ActionButton>
          </form>
        ) : (
          <div className="plan-viewer-note" role="note">
            <strong>Viewer access is read-only</strong>
            <span>
              You may inspect ready assets, jobs and proposals; no start, cancel or retry controls
              are available.
            </span>
          </div>
        )}
        {selectedAssetId
          ? (() => {
              const asset = workspace.assets.find(({ id }) => id === selectedAssetId);
              return asset ? (
                <dl className="plan-source-context">
                  <div>
                    <dt>Filename</dt>
                    <dd>{asset.fileName}</dd>
                  </div>
                  <div>
                    <dt>Rights basis</dt>
                    <dd>{asset.rights.basis}</dd>
                  </div>
                  <div>
                    <dt>Training</dt>
                    <dd>{asset.rights.trainingUseConsent}</dd>
                  </div>
                  <div>
                    <dt>Page</dt>
                    <dd>{pageNumber} of first 20 supported pages</dd>
                  </div>
                  <div>
                    <dt>Detected MIME</dt>
                    <dd>{asset.detectedMimeType}</dd>
                  </div>
                  <div>
                    <dt>Immutable SHA-256</dt>
                    <dd>
                      <code title={asset.source.sha256}>{shortHash(asset.source.sha256)}</code>
                    </dd>
                  </div>
                </dl>
              ) : null;
            })()
          : null}
      </section>

      <div className="plan-job-layout">
        <section className="plan-job-list" aria-labelledby="plan-jobs-title">
          <header>
            <div>
              <span>Step 2</span>
              <h2 id="plan-jobs-title">Durable jobs</h2>
            </div>
            <strong>{workspace.jobs.length}</strong>
          </header>
          {workspace.jobs.length === 0 ? (
            <p>No plan jobs yet. Start one from a ready asset.</p>
          ) : (
            <ul>
              {workspace.jobs.map((job) => (
                <li key={job.id}>
                  <button
                    aria-pressed={job.id === selectedJobId}
                    data-selected={job.id === selectedJobId}
                    onClick={() => {
                      setSelectedJobId(job.id);
                    }}
                    type="button"
                  >
                    <span>{job.state}</span>
                    <small>
                      Page {job.pageIndex + 1} · attempt {job.attempt}/3
                    </small>
                    <code>{job.id.slice(0, 8)}</code>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <JobStatus
          busy={busy}
          editable={editable}
          job={selectedJob}
          onCancel={() => void transitionJob("cancel")}
          onRetry={() => void transitionJob("retry")}
          projectId={projectId}
          result={result}
        />
      </div>

      {selectedJob?.state === "proposed" && result?.status === "proposal" ? (
        <>
          <section className="plan-proposal-metadata" aria-label="Immutable proposal context">
            <dl>
              <div>
                <dt>Proposal</dt>
                <dd>
                  <code>{result.proposalId}</code>
                </dd>
              </div>
              <div>
                <dt>Overall confidence</dt>
                <dd>{result.overallConfidence}%</dd>
              </div>
              <div>
                <dt>Source page</dt>
                <dd>{result.source.pageIndex + 1}</dd>
              </div>
              <div>
                <dt>Source hash</dt>
                <dd>
                  <code title={result.source.sha256}>{shortHash(result.source.sha256)}</code>
                </dd>
              </div>
              <div>
                <dt>Normalized input</dt>
                <dd>
                  <code title={result.normalizedInputSha256}>
                    {shortHash(result.normalizedInputSha256)}
                  </code>
                </dd>
              </div>
              <div>
                <dt>Parser manifest</dt>
                <dd>
                  <code title={result.parser.manifestSha256}>
                    {shortHash(result.parser.manifestSha256)}
                  </code>
                </dd>
              </div>
            </dl>
            <ActionButton
              disabled={busy === "source-preview"}
              onClick={() => void requestSourcePreview()}
              tone="secondary"
            >
              {busy === "source-preview" ? "Loading…" : "Load safe derived source"}
            </ActionButton>
          </section>
          <div className="plan-review-grid">
            <CandidateList
              onSelect={setSelectedCandidateId}
              proposal={result}
              reviews={reviews}
              selectedCandidateId={selectedCandidateId}
            />
            <PlanOverlay
              calibrationPick={calibrationPick}
              onCalibrationPoint={(kind, point) => {
                if (kind === "start") setCalibrationStart(point);
                else setCalibrationEnd(point);
                setCalibrationPick(undefined);
              }}
              onSelect={setSelectedCandidateId}
              proposal={result}
              selectedCandidateId={selectedCandidateId}
              sourcePreviewUrl={sourcePreview?.url}
            />
            <CandidateInspector
              candidate={selectedCandidate}
              editable={editable}
              onReview={(review) => {
                if (selectedCandidate) updateReview(selectedCandidate.candidateId, review);
              }}
              proposal={result}
              review={selectedCandidate ? reviews[selectedCandidate.candidateId] : undefined}
            />
          </div>
          <CalibrationPanel
            busy={busy === "calibrate"}
            calibration={calibration}
            confirmed={calibrationConfirmed}
            editable={editable}
            end={calibrationEnd}
            knownLengthMillimetres={knownLengthMillimetres}
            onConfirmed={setCalibrationConfirmed}
            onEnd={setCalibrationEnd}
            onKnownLength={setKnownLengthMillimetres}
            onPick={setCalibrationPick}
            onStart={setCalibrationStart}
            onSubmit={submitCalibration}
            start={calibrationStart}
          />
          <ReviewAndHandoff
            acknowledgedFindingCodes={acknowledgedFindingCodes}
            allWarningsAcknowledged={allWarningsAcknowledged}
            branches={workspace.branches}
            busy={busy}
            canCreateDraft={canCreateDraft}
            commitMessage={commitMessage}
            commitSummary={commitSummary}
            conflict={conflict}
            draft={draft}
            draftError={draftInput && "error" in draftInput ? draftInput.error : undefined}
            editable={editable}
            onAcknowledge={(code, checked) => {
              setAcknowledgedFindingCodes((current) =>
                checked
                  ? [...new Set([...current, code])]
                  : current.filter((item) => item !== code),
              );
            }}
            onCommit={commitPreview}
            onCommitMessage={setCommitMessage}
            onCreateDraft={() => void createDraft()}
            onPreview={() => void previewDraft()}
            onRecover={() => void recoverConflict()}
            onSelectBranch={setSelectedBranchId}
            operationsCount={operations.length}
            preview={preview}
            projectId={projectId}
            proposal={result}
            reviewSummary={reviewSummary}
            selectedBranchId={selectedBranchId}
          />
        </>
      ) : null}
    </PageContainer>
  );
}

function JobStatus({
  busy,
  editable,
  job,
  onCancel,
  onRetry,
  projectId,
  result,
}: {
  readonly busy?: BusyAction | undefined;
  readonly editable: boolean;
  readonly job?: PlanProcessingJob | undefined;
  readonly onCancel: () => void;
  readonly onRetry: () => void;
  readonly projectId: string;
  readonly result?: PlanParserResult | undefined;
}) {
  if (!job)
    return (
      <section className="plan-job-status">
        <h2>Job status</h2>
        <p>Select or start a job to see its durable state and recovery actions.</p>
      </section>
    );
  const canCancel = editable && (job.state === "queued" || job.state === "processing");
  const canRetry =
    editable &&
    (job.state === "abstained" || job.state === "failed") &&
    job.retryable &&
    job.attempt < 3;
  return (
    <section className="plan-job-status" aria-labelledby="selected-job-title">
      <header>
        <div>
          <span>Selected job</span>
          <h2 id="selected-job-title">{job.state}</h2>
        </div>
        <code>{job.id}</code>
      </header>
      <p aria-live="polite">
        {job.state === "queued"
          ? "Queued for bounded processing. You may cancel before publication."
          : job.state === "processing"
            ? "Processing this exact source and page. Status survives refresh and reauthentication."
            : job.state === "proposed"
              ? "An immutable proposal is ready for calibration and review."
              : job.state === "abstained"
                ? "The parser abstained rather than presenting unsafe or low-confidence geometry."
                : job.state === "failed"
                  ? "Processing failed with a bounded safe code. Choose an explicit recovery action."
                  : job.state === "cancel-requested"
                    ? "Cancellation is requested. A completed immutable result cannot be erased."
                    : "This job is cancelled. Start a new job or use the manual editor."}
      </p>
      <dl>
        <div>
          <dt>Updated</dt>
          <dd>{formatDateTime(job.updatedAt)}</dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd>{job.version}</dd>
        </div>
        <div>
          <dt>Attempt</dt>
          <dd>{job.attempt}/3</dd>
        </div>
        <div>
          <dt>Safe code</dt>
          <dd>{job.safeCode ?? "none"}</dd>
        </div>
      </dl>
      {result?.status === "abstained" ? (
        <div className="plan-abstention" role="status">
          <strong>{result.code}</strong>
          <p>{result.detail}</p>
          <ul>
            {result.nextActions.map((action) => (
              <li key={action}>{action.replaceAll("-", " ")}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="plan-job-actions">
        {canCancel ? (
          <ActionButton disabled={busy === "cancel"} onClick={onCancel} tone="secondary">
            {busy === "cancel" ? "Cancelling…" : "Cancel job"}
          </ActionButton>
        ) : null}
        {canRetry ? (
          <ActionButton disabled={busy === "retry"} onClick={onRetry} tone="secondary">
            {busy === "retry" ? "Retrying…" : "Retry exact source"}
          </ActionButton>
        ) : null}
        <Link className="ui-action" data-tone="secondary" href={`/evidence/${projectId}`}>
          Replace source
        </Link>
        <Link className="ui-action" data-tone="secondary" href={`/editor/${projectId}`}>
          Use manual C5 editor
        </Link>
      </div>
    </section>
  );
}

function CalibrationPanel({
  busy,
  calibration,
  confirmed,
  editable,
  end,
  knownLengthMillimetres,
  onConfirmed,
  onEnd,
  onKnownLength,
  onPick,
  onStart,
  onSubmit,
  start,
}: {
  readonly busy: boolean;
  readonly calibration?: PlanCalibration | undefined;
  readonly confirmed: boolean;
  readonly editable: boolean;
  readonly end: PlanSourcePoint;
  readonly knownLengthMillimetres: number;
  readonly onConfirmed: (value: boolean) => void;
  readonly onEnd: (value: PlanSourcePoint) => void;
  readonly onKnownLength: (value: number) => void;
  readonly onPick: (value: "end" | "start") => void;
  readonly onStart: (value: PlanSourcePoint) => void;
  readonly onSubmit: (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => Promise<void>;
  readonly start: PlanSourcePoint;
}) {
  return (
    <section className="plan-calibration" aria-labelledby="plan-calibration-title">
      <header>
        <div>
          <span>Step 3</span>
          <h2 id="plan-calibration-title">Known-length calibration</h2>
          <p>
            Pointer selection is optional; every source point and millimetre value has a keyboard
            control.
          </p>
        </div>
        {calibration ? (
          <strong>Residual {calibration.residualMillimetres} mm</strong>
        ) : (
          <strong>Required for draft</strong>
        )}
      </header>
      {editable ? (
        <form onSubmit={(event) => void onSubmit(event)}>
          <div className="plan-calibration-grid">
            <CoordinateFields
              label="Start"
              onChange={onStart}
              onPick={() => {
                onPick("start");
              }}
              point={start}
            />
            <CoordinateFields
              label="End"
              onChange={onEnd}
              onPick={() => {
                onPick("end");
              }}
              point={end}
            />
            <label>
              <span>Known length · integer mm</span>
              <input
                min={1}
                onChange={(event) => {
                  onKnownLength(Number(event.target.value));
                }}
                required
                step={1}
                type="number"
                value={knownLengthMillimetres}
              />
            </label>
          </div>
          <label className="plan-confirmation">
            <input
              checked={confirmed}
              onChange={(event) => {
                onConfirmed(event.target.checked);
              }}
              type="checkbox"
            />
            <span>
              <strong>Confirm this scale evidence</strong>
              <small>
                A new calibration is immutable and will create new draft state rather than moving
                committed geometry.
              </small>
            </span>
          </label>
          <ActionButton disabled={busy || !confirmed} type="submit">
            {busy
              ? "Saving calibration…"
              : calibration
                ? "Create new calibration"
                : "Save calibration evidence"}
          </ActionButton>
        </form>
      ) : (
        <div className="plan-viewer-note" role="note">
          <strong>Calibration is read-only for viewers</strong>
          <span>An owner or editor must provide and confirm known-length evidence.</span>
        </div>
      )}
      {calibration ? (
        <dl className="plan-calibration-result">
          <div>
            <dt>Calibration ID</dt>
            <dd>
              <code>{calibration.id}</code>
            </dd>
          </div>
          <div>
            <dt>Scale</dt>
            <dd>
              {calibration.sourceToModel.a}/{calibration.sourceToModel.denominator} mm per source
              unit
            </dd>
          </div>
          <div>
            <dt>Rounding</dt>
            <dd>{calibration.sourceToModel.rounding}</dd>
          </div>
          <div>
            <dt>Known length</dt>
            <dd>{calibration.evidence.knownLengthMillimetres} mm</dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}

function CoordinateFields({
  label,
  onChange,
  onPick,
  point,
}: {
  readonly label: string;
  readonly onChange: (point: PlanSourcePoint) => void;
  readonly onPick: () => void;
  readonly point: PlanSourcePoint;
}) {
  return (
    <fieldset>
      <legend>{label} source point</legend>
      <label>
        <span>X · integer</span>
        <input
          onChange={(event) => {
            onChange({ ...point, x: Number(event.target.value) });
          }}
          required
          step={1}
          type="number"
          value={point.x}
        />
      </label>
      <label>
        <span>Y · integer</span>
        <input
          onChange={(event) => {
            onChange({ ...point, y: Number(event.target.value) });
          }}
          required
          step={1}
          type="number"
          value={point.y}
        />
      </label>
      <button className="plan-structured-action" onClick={onPick} type="button">
        Select {label.toLowerCase()} on overlay
      </button>
    </fieldset>
  );
}

function ReviewAndHandoff({
  acknowledgedFindingCodes,
  allWarningsAcknowledged,
  branches,
  busy,
  canCreateDraft,
  commitMessage,
  commitSummary,
  conflict,
  draft,
  draftError,
  editable,
  onAcknowledge,
  onCommit,
  onCommitMessage,
  onCreateDraft,
  onPreview,
  onRecover,
  onSelectBranch,
  operationsCount,
  preview,
  projectId,
  proposal,
  reviewSummary,
  selectedBranchId,
}: {
  readonly acknowledgedFindingCodes: readonly string[];
  readonly allWarningsAcknowledged: boolean;
  readonly branches: PlanImportWorkspace["branches"];
  readonly busy?: BusyAction | undefined;
  readonly canCreateDraft: boolean;
  readonly commitMessage: string;
  readonly commitSummary?: string | undefined;
  readonly conflict?:
    | {
        readonly currentHeadSnapshotSha256?: string;
        readonly currentRevision?: number;
        readonly detail: string;
      }
    | undefined;
  readonly draft?: PlanOperationDraft | undefined;
  readonly draftError?: string | undefined;
  readonly editable: boolean;
  readonly onAcknowledge: (code: string, checked: boolean) => void;
  readonly onCommit: (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => Promise<void>;
  readonly onCommitMessage: (value: string) => void;
  readonly onCreateDraft: () => void;
  readonly onPreview: () => void;
  readonly onRecover: () => void;
  readonly onSelectBranch: (value: string) => void;
  readonly operationsCount: number;
  readonly preview?: ModelOperationsPreview | undefined;
  readonly projectId: string;
  readonly proposal: PlanProposal;
  readonly reviewSummary?:
    { accepted: number; corrected: number; excluded: number; unresolved: number } | undefined;
  readonly selectedBranchId: string;
}) {
  const warnings = proposal.findings.filter(({ severity }) => severity === "warning");
  const severe = proposal.findings.filter(({ severity }) => severity === "error");
  return (
    <section className="plan-handoff" aria-labelledby="plan-handoff-title">
      <header>
        <div>
          <span>Step 4</span>
          <h2 id="plan-handoff-title">Operation draft and C5 handoff</h2>
          <p>
            The C6 draft never mutates canonical state. Preview and commit remain explicit C5
            actions.
          </p>
        </div>
      </header>
      <div className="plan-review-summary">
        <div>
          <strong>{operationsCount}</strong>
          <span>typed operations</span>
        </div>
        <div>
          <strong>{reviewSummary?.corrected ?? 0}</strong>
          <span>corrected</span>
        </div>
        <div>
          <strong>{reviewSummary?.excluded ?? 0}</strong>
          <span>excluded</span>
        </div>
        <div data-blocked={(reviewSummary?.unresolved ?? 0) > 0}>
          <strong>{reviewSummary?.unresolved ?? 0}</strong>
          <span>unresolved</span>
        </div>
      </div>
      {proposal.unresolvedRegions.length > 0 ? (
        <div className="plan-blocker" role="alert">
          <strong>Unresolved source regions block preview</strong>
          <ul>
            {proposal.unresolvedRegions.map((region) => (
              <li key={region.id}>
                <span>{region.detail}</span>
                <small>{region.nextAction.replaceAll("-", " ")}</small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {severe.length > 0 ? (
        <div className="plan-blocker" role="alert">
          <strong>Severe proposal findings block preview</strong>
          {severe.map((finding) => (
            <p key={finding.code}>
              {finding.code}: {finding.message}
            </p>
          ))}
        </div>
      ) : null}
      {warnings.length > 0 ? (
        <fieldset className="plan-warning-acknowledgements">
          <legend>Acknowledge proposal warnings</legend>
          {warnings.map((finding) => (
            <label key={finding.code}>
              <input
                checked={acknowledgedFindingCodes.includes(finding.code)}
                onChange={(event) => {
                  onAcknowledge(finding.code, event.target.checked);
                }}
                type="checkbox"
              />
              <span>
                <strong>{finding.code}</strong>
                <small>{finding.message}</small>
              </span>
            </label>
          ))}
        </fieldset>
      ) : (
        <p className="plan-no-warnings">No proposal warning requires acknowledgement.</p>
      )}
      {editable ? (
        <div className="plan-handoff-actions">
          <label>
            <span>Existing-model branch target</span>
            <select
              disabled={branches.length === 0}
              onChange={(event) => {
                onSelectBranch(event.target.value);
              }}
              value={selectedBranchId}
            >
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name} · r{branch.revision} · {shortHash(branch.headSnapshotSha256)}
                </option>
              ))}
            </select>
          </label>
          {branches.length === 0 ? (
            <p>
              No existing C5 branch is available. Use the manual editor to create the canonical
              branch first.
            </p>
          ) : null}
          {draftError ? (
            <p className="plan-import-alert" role="alert">
              {draftError}
            </p>
          ) : null}
          <ActionButton
            disabled={!canCreateDraft || busy === "draft" || !allWarningsAcknowledged}
            onClick={onCreateDraft}
          >
            {busy === "draft" ? "Creating immutable draft…" : "Create immutable operation draft"}
          </ActionButton>
        </div>
      ) : (
        <div className="plan-viewer-note" role="note">
          <strong>Viewer access is read-only</strong>
          <span>
            Review metrics and immutable proposal context remain visible; draft, preview and commit
            controls are absent.
          </span>
        </div>
      )}
      {draft ? (
        <div className="plan-draft">
          <header>
            <div>
              <span>Immutable draft</span>
              <h3>{draft.id}</h3>
            </div>
            <strong>{draft.operations.length} operations</strong>
          </header>
          <dl>
            <div>
              <dt>Target revision</dt>
              <dd>{draft.target.expectedRevision}</dd>
            </div>
            <div>
              <dt>Target head</dt>
              <dd>
                <code>{shortHash(draft.target.expectedHeadSnapshotSha256)}</code>
              </dd>
            </div>
            <div>
              <dt>Review duration</dt>
              <dd>{draft.metrics.reviewDurationMilliseconds} ms</dd>
            </div>
            <div>
              <dt>Accepted / corrected / excluded / unresolved</dt>
              <dd>
                {draft.metrics.acceptedCount} / {draft.metrics.correctedCount} /{" "}
                {draft.metrics.excludedCount} / {draft.metrics.unresolvedCount}
              </dd>
            </div>
          </dl>
          <p>Commit is append-only. Any later reversal requires compensating history.</p>
          <ActionButton disabled={busy === "preview"} onClick={onPreview} tone="secondary">
            {busy === "preview" ? "Previewing through C5…" : "Preview exact operations in C5"}
          </ActionButton>
        </div>
      ) : null}
      {conflict ? (
        <div className="plan-conflict" role="alert">
          <strong>Branch changed before handoff</strong>
          <p>{conflict.detail}</p>
          <dl>
            {conflict.currentRevision === undefined ? null : (
              <div>
                <dt>Current revision</dt>
                <dd>{conflict.currentRevision}</dd>
              </div>
            )}
            {conflict.currentHeadSnapshotSha256 ? (
              <div>
                <dt>Current head</dt>
                <dd>
                  <code>{shortHash(conflict.currentHeadSnapshotSha256)}</code>
                </dd>
              </div>
            ) : null}
          </dl>
          <p>
            Your candidate decisions remain local. Reload the current head, then create a new
            immutable C6 draft and C5 preview.
          </p>
          <ActionButton onClick={onRecover} tone="secondary">
            Reload current branch target
          </ActionButton>
        </div>
      ) : null}
      {preview ? (
        <div className="plan-c5-preview">
          <header>
            <div>
              <span>C5 preview</span>
              <h3>{preview.id}</h3>
            </div>
            <strong data-blocked={preview.hasBlockingFindings}>
              {preview.hasBlockingFindings ? "Blocked" : "Valid to commit"}
            </strong>
          </header>
          <dl>
            <div>
              <dt>Result snapshot</dt>
              <dd>
                <code>{shortHash(preview.resultSnapshotSha256)}</code>
              </dd>
            </div>
            <div>
              <dt>Findings</dt>
              <dd>{preview.findings.length}</dd>
            </div>
            <div>
              <dt>Expires</dt>
              <dd>{formatDateTime(preview.expiresAt)}</dd>
            </div>
          </dl>
          {preview.findings.length > 0 ? (
            <ul>
              {preview.findings.map((finding) => (
                <li data-severity={finding.severity} key={`${finding.code}-${finding.message}`}>
                  <strong>{finding.code}</strong>
                  <span>{finding.message}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <form onSubmit={(event) => void onCommit(event)}>
            <label>
              <span>Commit message</span>
              <input
                maxLength={500}
                minLength={1}
                onChange={(event) => {
                  onCommitMessage(event.target.value);
                }}
                required
                value={commitMessage}
              />
            </label>
            <ActionButton disabled={preview.hasBlockingFindings || busy === "commit"} type="submit">
              {busy === "commit"
                ? "Committing through C5…"
                : "Commit reviewed operations through C5"}
            </ActionButton>
          </form>
        </div>
      ) : null}
      {commitSummary ? (
        <div className="plan-commit-success" role="status">
          <strong>Committed through C5</strong>
          <p>{commitSummary}</p>
          <Link className="ui-action" data-tone="secondary" href={`/editor/${projectId}`}>
            Inspect append-only history in 2D editor
          </Link>
        </div>
      ) : null}
    </section>
  );
}

function PlanState({
  action,
  actionHref,
  actionLabel,
  message,
  title,
}: {
  readonly action?: () => Promise<void>;
  readonly actionHref?: string;
  readonly actionLabel: string;
  readonly message: string;
  readonly title: string;
}) {
  return (
    <PageContainer className="plan-import-state">
      <StatePanel
        actions={
          <>
            {actionHref ? (
              <Link className="ui-action" data-tone="primary" href={actionHref}>
                {actionLabel}
              </Link>
            ) : null}
            {action ? (
              <ActionButton onClick={() => void action()}>{actionLabel}</ActionButton>
            ) : null}
          </>
        }
        message={<p role="alert">{message}</p>}
        title={title}
      />
    </PageContainer>
  );
}
