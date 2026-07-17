"use client";

import type { ReconstructionJob, ReconstructionResult } from "@interior-design/contracts";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SyntheticEvent } from "react";

import { ActionButton, LoadingIndicator, PageContainer } from "../../components/ui-primitives";
import { reconstructionClient, ReconstructionProblem } from "./api";
import type { ReadyReconstructionAsset, ReconstructionWorkspace as Workspace } from "./contracts";
import { isActiveReconstructionState, reconstructionStages } from "./presentation";
import { ReconstructionResultPanel } from "./result-panel";
import { RuntimeStatus } from "./runtime-status";

type LoadState =
  | { readonly kind: "error" | "forbidden" | "offline"; readonly message: string }
  | { readonly kind: "expired" | "loading" | "ready" };

type BusyAction = "cancel" | "refresh" | "retry" | "start";

function loadStateFrom(reason: unknown): LoadState {
  if (reason instanceof ReconstructionProblem) {
    if (reason.kind === "expired") return { kind: "expired" };
    if (reason.kind === "forbidden" || reason.kind === "not-found") {
      return { kind: "forbidden", message: reason.message };
    }
    if (reason.kind === "offline") return { kind: "offline", message: reason.message };
    return { kind: "error", message: reason.message };
  }
  return { kind: "error", message: "The reconstruction workspace could not be loaded." };
}

function formattedBytes(bytes: number): string {
  return new Intl.NumberFormat("en-GB", {
    maximumFractionDigits: 1,
    style: "unit",
    unit: bytes >= 1_000_000 ? "megabyte" : "kilobyte",
    unitDisplay: "short",
  }).format(bytes / (bytes >= 1_000_000 ? 1_000_000 : 1_000));
}

function formattedTime(value: string): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function sourceKind(asset: ReadyReconstructionAsset): "rgb-image" | "rgb-video" {
  return asset.kind === "video" ? "rgb-video" : "rgb-image";
}

function canCancel(job: ReconstructionJob): boolean {
  return [
    "created",
    "preparing",
    "ready-for-reconstruction",
    "reconstructing-geometry",
    "reconstructing-appearance",
  ].includes(job.state);
}

export function ReconstructionWorkspace({ projectId }: { readonly projectId: string }) {
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [workspace, setWorkspace] = useState<Workspace>();
  const [selectedAssetIds, setSelectedAssetIds] = useState<readonly string[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>();
  const [result, setResult] = useState<ReconstructionResult>();
  const [label, setLabel] = useState("Ground-floor media reconstruction");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [appearanceRequested, setAppearanceRequested] = useState(false);
  const [busy, setBusy] = useState<BusyAction>();
  const [alert, setAlert] = useState<string>();
  const [liveMessage, setLiveMessage] = useState("");

  const loadWorkspace = useCallback(
    async (initial = false) => {
      if (initial) setLoadState({ kind: "loading" });
      else setBusy("refresh");
      setAlert(undefined);
      try {
        const next = await reconstructionClient.loadWorkspace(projectId);
        setWorkspace(next);
        setSelectedAssetIds((current) =>
          current.filter((id) => next.assets.some((asset) => asset.id === id)),
        );
        setSelectedJobId((current) =>
          next.jobs.some(({ id }) => id === current) ? current : next.jobs[0]?.id,
        );
        if (next.capabilities.appearanceProvider === "unavailable") {
          setAppearanceRequested(false);
        }
        setLoadState({ kind: "ready" });
        if (!initial) setLiveMessage("Reconstruction sources and jobs refreshed.");
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
  const selectedAssets = useMemo(
    () => workspace?.assets.filter(({ id }) => selectedAssetIds.includes(id)) ?? [],
    [selectedAssetIds, workspace?.assets],
  );
  const rightsBases = useMemo(
    () => new Set(selectedAssets.map(({ rights }) => rights.basis)),
    [selectedAssets],
  );
  const editable = workspace ? workspace.session.actor.role !== "viewer" : false;
  const canStart =
    editable &&
    consentConfirmed &&
    label.trim().length > 0 &&
    selectedAssets.length > 0 &&
    rightsBases.size === 1 &&
    !busy;

  const loadResult = useCallback(
    async (job: ReconstructionJob) => {
      if (job.state !== "completed" && job.state !== "abstained") {
        setResult(undefined);
        return;
      }
      try {
        setResult(await reconstructionClient.getResult(projectId, job.id));
      } catch (reason) {
        setAlert(reason instanceof Error ? reason.message : "The result could not be loaded.");
      }
    },
    [projectId],
  );

  useEffect(() => {
    if (selectedJob) void loadResult(selectedJob);
  }, [loadResult, selectedJob]);

  useEffect(() => {
    if (!selectedJob || !isActiveReconstructionState(selectedJob.state)) return;
    const timer = window.setInterval(() => {
      void reconstructionClient
        .getJob(projectId, selectedJob.id)
        .then((job) => {
          setWorkspace((current) =>
            current
              ? { ...current, jobs: current.jobs.map((item) => (item.id === job.id ? job : item)) }
              : current,
          );
          setLiveMessage(`Reconstruction status is ${job.state.replaceAll("-", " ")}.`);
        })
        .catch((reason: unknown) => {
          if (reason instanceof ReconstructionProblem && reason.kind === "expired") {
            setLoadState({ kind: "expired" });
          }
        });
    }, 2_500);
    return () => {
      window.clearInterval(timer);
    };
  }, [projectId, selectedJob]);

  function toggleAsset(assetId: string): void {
    setSelectedAssetIds((current) =>
      current.includes(assetId) ? current.filter((id) => id !== assetId) : [...current, assetId],
    );
  }

  async function startJob(event: SyntheticEvent<HTMLFormElement, SubmitEvent>): Promise<void> {
    event.preventDefault();
    if (!canStart) return;
    const basis = selectedAssets[0]?.rights.basis;
    if (!basis) return;
    setBusy("start");
    setAlert(undefined);
    try {
      const sources = selectedAssets.map((asset) => {
        if (!asset.detectedMimeType) throw new Error("A selected source has no detected type.");
        return {
          assetId: asset.id,
          byteSize: asset.source.byteSize,
          detectedMimeType: asset.detectedMimeType as
            "image/heic" | "image/jpeg" | "image/png" | "video/mp4" | "video/quicktime",
          kind: sourceKind(asset),
          sha256: asset.source.sha256,
        };
      });
      const job = await reconstructionClient.createJob(projectId, {
        appearanceMode: appearanceRequested ? "optional" : "disabled",
        label: label.trim(),
        mode: "rgb-sfm",
        registrationAnchors: [],
        rights: {
          basis,
          serviceProcessingConsent: true,
          trainingUseConsent: "denied",
        },
        sources,
      });
      setWorkspace((current) =>
        current
          ? { ...current, jobs: [job, ...current.jobs.filter(({ id }) => id !== job.id)] }
          : current,
      );
      setSelectedJobId(job.id);
      setConsentConfirmed(false);
      setLiveMessage("Reconstruction job started and is durably queued.");
    } catch (reason) {
      setAlert(reason instanceof Error ? reason.message : "The job could not be started.");
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
          ? await reconstructionClient.cancel(projectId, selectedJob)
          : await reconstructionClient.retry(projectId, selectedJob);
      setWorkspace((current) =>
        current
          ? { ...current, jobs: current.jobs.map((item) => (item.id === job.id ? job : item)) }
          : current,
      );
      setLiveMessage(`Reconstruction job is now ${job.state.replaceAll("-", " ")}.`);
    } catch (reason) {
      setAlert(reason instanceof Error ? reason.message : `The job could not be ${action}led.`);
    } finally {
      setBusy(undefined);
    }
  }

  if (loadState.kind === "loading") {
    return (
      <PageContainer className="workspace-state">
        <LoadingIndicator label="Loading reconstruction sources and jobs" />
      </PageContainer>
    );
  }
  if (loadState.kind !== "ready" || !workspace) {
    const expired = loadState.kind === "expired";
    const message =
      "message" in loadState
        ? loadState.message
        : "Your fixture session expired. No reconstruction job was changed.";
    return (
      <PageContainer className="workspace-state">
        <section className="standalone-state" role="status">
          <h1>{expired ? "Your session has expired" : "Reconstruction is unavailable"}</h1>
          <p>{message}</p>
          {expired ? (
            <Link className="ui-action" data-tone="primary" href="/sign-in">
              Sign in again
            </Link>
          ) : (
            <ActionButton onClick={() => void loadWorkspace(true)}>Try again</ActionButton>
          )}
        </section>
      </PageContainer>
    );
  }

  const stages = selectedJob
    ? reconstructionStages(selectedJob, workspace.capabilities, result)
    : undefined;

  return (
    <PageContainer className="reconstruction-shell">
      <div aria-atomic="true" aria-live="polite" className="sr-only">
        {liveMessage}
      </div>
      <header className="reconstruction-hero">
        <div>
          <span className="eyebrow">C8 · independent media proposal</span>
          <h1>Reconstruct what the evidence supports</h1>
          <p>
            Prepare rights-cleared photos or video, follow every durable stage, and keep partial,
            disconnected or unknown-scale results honest.
          </p>
        </div>
        <div className="reconstruction-hero__boundary" role="note">
          <strong>Canonical model unchanged</strong>
          <span>C8 publishes proposals only. Fusion and confirmation happen later.</span>
        </div>
      </header>

      <RuntimeStatus capabilities={workspace.capabilities} />

      {alert ? (
        <div className="inline-alert" role="alert">
          <strong>Action not completed</strong>
          <span>{alert}</span>
        </div>
      ) : null}

      <div className="reconstruction-grid">
        <section
          aria-labelledby="source-selection-title"
          className="reconstruction-card source-card"
        >
          <header>
            <span className="step-number">01</span>
            <div>
              <h2 id="source-selection-title">Choose immutable evidence</h2>
              <p>Only ready C2 photos and videos with service-processing rights are shown.</p>
            </div>
          </header>
          {workspace.assets.length === 0 ? (
            <div className="compact-empty">
              <h3>No eligible media yet</h3>
              <p>Upload and validate a rights-cleared photograph or video first.</p>
              <Link className="ui-action" data-tone="secondary" href={`/evidence/${projectId}`}>
                Open evidence
              </Link>
            </div>
          ) : (
            <div className="source-list">
              {workspace.assets.map((asset, index) => (
                <label className="source-option" key={asset.id}>
                  <input
                    checked={selectedAssetIds.includes(asset.id)}
                    disabled={!editable || busy !== undefined}
                    onChange={() => {
                      toggleAsset(asset.id);
                    }}
                    type="checkbox"
                  />
                  <span className="source-option__index" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span>
                    <strong>{asset.kind === "video" ? "Video evidence" : "Photo evidence"}</strong>
                    <small>
                      {asset.detectedMimeType} · {formattedBytes(asset.source.byteSize)} · hash{" "}
                      {asset.source.sha256.slice(0, 8)}…
                    </small>
                    <small>{asset.rights.basis.replaceAll("-", " ")} · training denied</small>
                  </span>
                </label>
              ))}
            </div>
          )}
          {rightsBases.size > 1 ? (
            <p className="field-warning" role="alert">
              Selected sources have different rights bases. Start separate jobs for each basis.
            </p>
          ) : null}
        </section>

        <form className="reconstruction-card start-card" onSubmit={(event) => void startJob(event)}>
          <header>
            <span className="step-number">02</span>
            <div>
              <h2>Consent and start</h2>
              <p>RGB geometry is available as a durable request even when no worker is running.</p>
            </div>
          </header>
          <label className="field-stack" htmlFor="reconstruction-label">
            <span>Job label</span>
            <input
              disabled={!editable || busy !== undefined}
              id="reconstruction-label"
              maxLength={120}
              onChange={(event) => {
                setLabel(event.target.value);
              }}
              required
              value={label}
            />
          </label>
          <fieldset className="mode-fieldset">
            <legend>Reconstruction mode</legend>
            <label>
              <input checked readOnly type="radio" />
              <span>
                <strong>RGB camera reconstruction</strong>
                <small>Photos and video · scale may remain unknown</small>
              </span>
            </label>
            <label aria-disabled="true" className="disabled-option">
              <input disabled type="radio" />
              <span>
                <strong>RGB-D / hybrid</strong>
                <small>No eligible depth/pose source is exposed by C2 in this journey.</small>
              </span>
            </label>
          </fieldset>
          <label className="consent-option">
            <input
              checked={appearanceRequested}
              disabled={
                !editable ||
                busy !== undefined ||
                workspace.capabilities.appearanceProvider === "unavailable"
              }
              onChange={(event) => {
                setAppearanceRequested(event.target.checked);
              }}
              type="checkbox"
            />
            <span>
              <strong>Request optional appearance layer</strong>
              <small>Non-dimensional. Currently {workspace.capabilities.appearanceProvider}.</small>
            </span>
          </label>
          <label className="consent-option consent-option--required">
            <input
              checked={consentConfirmed}
              disabled={!editable || busy !== undefined}
              onChange={(event) => {
                setConsentConfirmed(event.target.checked);
              }}
              type="checkbox"
            />
            <span>
              <strong>I confirm service processing for these exact sources</strong>
              <small>Training use remains denied and cannot be enabled here.</small>
            </span>
          </label>
          {!editable ? (
            <p className="read-only-note">Viewer access is read-only. Job controls are hidden.</p>
          ) : null}
          <ActionButton disabled={!canStart} type="submit">
            {busy === "start" ? "Starting…" : "Start reconstruction"}
          </ActionButton>
        </form>
      </div>

      <section aria-labelledby="job-status-title" className="job-workspace">
        <div className="job-list-panel">
          <header>
            <div>
              <span className="eyebrow">Durable history</span>
              <h2 id="job-status-title">Reconstruction jobs</h2>
            </div>
            <button
              className="text-action"
              disabled={busy !== undefined}
              onClick={() => void loadWorkspace(false)}
              type="button"
            >
              {busy === "refresh" ? "Refreshing…" : "Refresh"}
            </button>
          </header>
          {workspace.jobs.length === 0 ? (
            <div className="compact-empty">
              <h3>No reconstruction jobs</h3>
              <p>Select eligible evidence and confirm processing to create one.</p>
            </div>
          ) : (
            <div className="job-list" role="list">
              {workspace.jobs.map((job) => (
                <button
                  aria-current={job.id === selectedJobId ? "true" : undefined}
                  className="job-list__item"
                  key={job.id}
                  onClick={() => {
                    setSelectedJobId(job.id);
                  }}
                  role="listitem"
                  type="button"
                >
                  <span>
                    <strong>{job.request.label}</strong>
                    <small>
                      {formattedTime(job.updatedAt)} · attempt {job.attempt}/3
                    </small>
                  </span>
                  <span className="status-chip" data-state={job.state}>
                    {job.state.replaceAll("-", " ")}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="job-detail-panel">
          {selectedJob && stages ? (
            <>
              <header className="job-detail-heading">
                <div>
                  <span className="eyebrow">
                    Attempt {selectedJob.attempt} · version {selectedJob.version}
                  </span>
                  <h2>{selectedJob.request.label}</h2>
                  <p>{selectedJob.request.sources.length} immutable source record(s)</p>
                </div>
                {editable ? (
                  <div className="job-actions">
                    {canCancel(selectedJob) ? (
                      <ActionButton
                        disabled={busy !== undefined}
                        onClick={() => void transitionJob("cancel")}
                        tone="secondary"
                      >
                        {busy === "cancel" ? "Cancelling…" : "Cancel job"}
                      </ActionButton>
                    ) : null}
                    {selectedJob.retryable ? (
                      <ActionButton
                        disabled={busy !== undefined}
                        onClick={() => void transitionJob("retry")}
                      >
                        {busy === "retry" ? "Retrying…" : "Retry as next attempt"}
                      </ActionButton>
                    ) : null}
                  </div>
                ) : null}
              </header>
              <ol className="stage-timeline">
                {stages.map((stage) => (
                  <li data-state={stage.state} key={stage.label}>
                    <span className="stage-marker" aria-hidden="true" />
                    <div>
                      <strong>{stage.label}</strong>
                      <p>{stage.detail}</p>
                    </div>
                    <span className="stage-state">{stage.state}</span>
                  </li>
                ))}
              </ol>
              {selectedJob.state === "failed" || selectedJob.state === "cancelled" ? (
                <div className="truth-boundary" role="status">
                  <strong>
                    {selectedJob.state === "failed" ? "Job failed safely" : "Job cancelled"}
                  </strong>
                  <p>
                    {selectedJob.safeCode
                      ? `${selectedJob.safeCode}. No result or canonical change was published.`
                      : "No result or canonical change was published."}
                  </p>
                </div>
              ) : null}
            </>
          ) : (
            <div className="compact-empty">
              <h2>Select a job</h2>
              <p>Its exact stages, diagnostics and immutable result will appear here.</p>
            </div>
          )}
        </div>
      </section>

      {result ? <ReconstructionResultPanel result={result} /> : null}
    </PageContainer>
  );
}
