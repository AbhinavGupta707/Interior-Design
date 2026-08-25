"use client";

import type { EnhancementResult, RenderJob, RenderResult } from "@interior-design/contracts";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  ActionButton,
  ActionLink,
  LoadingIndicator,
  PageContainer,
  StatePanel,
} from "../../components/ui-primitives";
import { ClientProblem, getProject, getSession } from "../auth/api";
import { homeJourneyHref } from "../homeowner-journey/navigation";
import { RenderStillsProblem, renderStillsClient } from "./api";
import type {
  RenderEnhancementStatus,
  RenderEnhancementJob,
  RenderEvidenceClassification,
  RenderWorkspace,
} from "./contracts";
import { renderWorkspaceSchema } from "./contracts";
import type { RenderLaunchContext } from "./launch-context";
import {
  artifactLabel,
  canCancel,
  canRetry,
  formatBytes,
  jobStateLabel,
  renderStages,
  shortHash,
  stageIndex,
} from "./presentation";
import styles from "./render-stills.module.css";
import { VerifiedArtifact } from "./verified-artifact";

type LoadState =
  | { readonly kind: "error" | "forbidden" | "offline"; readonly message: string }
  | { readonly kind: "expired" | "loading" | "ready" };

type BusyAction = "cancel" | "create" | "enhance" | "refresh" | "retry";

function loadStateFrom(reason: unknown): LoadState {
  if (reason instanceof RenderStillsProblem || reason instanceof ClientProblem) {
    if (reason.kind === "expired") return { kind: "expired" };
    if (reason.kind === "forbidden" || reason.kind === "not-found") {
      return { kind: "forbidden", message: reason.message };
    }
    if (reason.kind === "offline") return { kind: "offline", message: reason.message };
    return { kind: "error", message: reason.message };
  }
  return { kind: "error", message: "The render-stills workspace could not be loaded safely." };
}

function actionMessage(reason: unknown): string {
  if (reason instanceof RenderStillsProblem) {
    if (reason.kind === "conflict") {
      return "The durable job or one of its exact pins became stale. Current state was reloaded; review before retrying.";
    }
    return reason.message;
  }
  return "The action could not be completed. Existing durable render state remains unchanged.";
}

function isEnhancementResult(status: RenderEnhancementStatus): status is EnhancementResult {
  return "schemaVersion" in status;
}

function enhancementLabel(status: RenderEnhancementStatus | undefined): string {
  if (!status) return "Not requested";
  if (isEnhancementResult(status)) {
    const labels: Readonly<Record<EnhancementResult["state"], string>> = {
      disabled: "Provider disabled · safe result remains available",
      failed: "Enhancement failed · safe result remains available",
      "not-requested": "Not requested",
      rejected: "Rejected by geometry guard · safe result remains available",
      succeeded: "Optional comparison accepted",
    };
    return labels[status.state];
  }
  const labels: Readonly<Record<RenderEnhancementJob["state"], string>> = {
    cancelled: "Enhancement cancelled · safe result remains available",
    disabled: "Provider disabled · safe result remains available",
    failed: "Enhancement failed · safe result remains available",
    queued: "Optional enhancement queued",
    rejected: "Rejected by geometry guard · safe result remains available",
    running: "Optional enhancement running",
    succeeded: "Optional enhancement complete",
  };
  return labels[status.state];
}

function replaceDeepLink(jobId: string | undefined): void {
  const url = new URL(window.location.href);
  if (jobId) url.searchParams.set("jobId", jobId);
  else url.searchParams.delete("jobId");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function updateJobList(jobs: readonly RenderJob[], next: RenderJob): RenderJob[] {
  const remaining = jobs.filter(({ id }) => id !== next.id);
  return [next, ...remaining].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

const terminalStates = new Set(["cancelled", "failed", "succeeded"]);

export function RenderStillsWorkspace({
  evidenceClassification,
  initialJobId,
  launchContext,
  invalidDeepLink,
  projectId,
}: {
  readonly evidenceClassification: RenderEvidenceClassification;
  readonly initialJobId?: string;
  readonly launchContext?: RenderLaunchContext;
  readonly invalidDeepLink: boolean;
  readonly projectId: string;
}) {
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [workspace, setWorkspace] = useState<RenderWorkspace>();
  const [selectedJobId, setSelectedJobId] = useState(initialJobId);
  const [result, setResult] = useState<RenderResult>();
  const [enhancement, setEnhancement] = useState<RenderEnhancementStatus>();
  const [enhancementProblem, setEnhancementProblem] = useState<string>();
  const [selectedDiagnosticId, setSelectedDiagnosticId] = useState<string>();
  const [showComparison, setShowComparison] = useState(false);
  const [busy, setBusy] = useState<BusyAction>();
  const [alert, setAlert] = useState<string>(
    invalidDeepLink ? "The job deep link is malformed and was not trusted." : "",
  );
  const [statusMessage, setStatusMessage] = useState("");
  const [online, setOnline] = useState(true);
  const [sourceSceneJobId, setSourceSceneJobId] = useState("");
  const [specificationKey, setSpecificationKey] = useState("");
  const [cameraId, setCameraId] = useState("");
  const [lightingPresetId, setLightingPresetId] = useState("canonical-lights-neutral-world-v1");
  const [profileId, setProfileId] = useState("cycles-cpu-geometry-safe-v1");
  const [enhancementRequested, setEnhancementRequested] = useState(false);
  const [label, setLabel] = useState("Review still");
  const alertRef = useRef<HTMLDivElement>(null);
  const jobHeadingRef = useRef<HTMLHeadingElement>(null);
  const initialLoadStarted = useRef(false);

  const editable = workspace ? workspace.session.actor.role !== "viewer" : false;
  const selectedJob = workspace?.jobs.find(({ id }) => id === selectedJobId);
  const selectedSource = workspace?.capabilities.sources.find(
    ({ sourceSceneJobId: id }) => id === sourceSceneJobId,
  );
  const selectedProfile = workspace?.capabilities.profiles.find(
    ({ profileId: id }) => id === profileId,
  );
  const rendererAvailable = workspace?.capabilities.renderer.state === "available";

  const selectSourceDefaults = useCallback(
    (next: RenderWorkspace) => {
      const requestedSource = launchContext
        ? next.capabilities.sources.find(
            ({ sourceSceneJobId: id }) => id === launchContext.sourceSceneJobId,
          )
        : undefined;
      const source = requestedSource ?? next.capabilities.sources[0];
      const profile =
        next.capabilities.profiles.find(({ state }) => state === "available") ??
        next.capabilities.profiles[0];
      setSourceSceneJobId(source?.sourceSceneJobId ?? "");
      setCameraId(source?.cameras[0]?.cameraId ?? "");
      const requestedSpecification =
        requestedSource && launchContext?.specificationId
          ? requestedSource.specifications.find(
              ({ specificationId, specificationRevision }) =>
                specificationId === launchContext.specificationId &&
                specificationRevision === launchContext.specificationRevision,
            )
          : undefined;
      const specification = requestedSpecification ?? source?.specifications[0];
      setSpecificationKey(
        specification
          ? `${specification.specificationId}:${String(specification.specificationRevision)}`
          : "",
      );
      setLightingPresetId(
        next.capabilities.lightingPresets[0]?.lightingPresetId ??
          "canonical-lights-neutral-world-v1",
      );
      setProfileId(profile?.profileId ?? "cycles-cpu-geometry-safe-v1");
      setEnhancementRequested(false);
      if (
        launchContext &&
        (!requestedSource || (launchContext.specificationId && !requestedSpecification))
      ) {
        setAlert(
          "The exact scene/specification handoff is not currently an eligible render source. No alternate source was presented as that requested result.",
        );
      }
    },
    [launchContext],
  );

  const loadWorkspace = useCallback(
    async (initial = false) => {
      if (initial) setLoadState({ kind: "loading" });
      else setBusy("refresh");
      try {
        const [session, project, capabilities, jobs] = await Promise.all([
          getSession(),
          getProject(projectId),
          renderStillsClient.getCapabilities(projectId),
          renderStillsClient.listJobs(projectId),
        ]);
        const next = renderWorkspaceSchema.parse({
          capabilities,
          jobs: jobs.jobs,
          project,
          session,
        });
        setWorkspace(next);
        if (!workspace) selectSourceDefaults(next);
        if (!selectedJobId && next.jobs[0]) {
          setSelectedJobId(next.jobs[0].id);
          replaceDeepLink(next.jobs[0].id);
        }
        setLoadState({ kind: "ready" });
        if (!initial) setStatusMessage("Durable render jobs and capability state refreshed.");
      } catch (reason) {
        if (initial || !workspace) setLoadState(loadStateFrom(reason));
        else setAlert(actionMessage(reason));
      } finally {
        setBusy(undefined);
      }
    },
    [projectId, selectSourceDefaults, selectedJobId, workspace],
  );

  useEffect(() => {
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    setOnline(navigator.onLine);
    void loadWorkspace(true);
  }, [loadWorkspace]);

  useEffect(() => {
    const offline = () => {
      setOnline(false);
      setStatusMessage("Offline inspection mode. Existing verified result state remains visible.");
    };
    const restored = () => {
      setOnline(true);
      setStatusMessage("Connection restored. Refresh before taking a durable action.");
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", restored);
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", restored);
    };
  }, []);

  useEffect(() => {
    if (alert) alertRef.current?.focus();
  }, [alert]);

  useEffect(() => {
    const source = workspace?.capabilities.sources.find(
      ({ sourceSceneJobId: id }) => id === sourceSceneJobId,
    );
    if (!source) return;
    if (!source.cameras.some(({ cameraId: id }) => id === cameraId)) {
      setCameraId(source.cameras[0]?.cameraId ?? "");
    }
    const keys = new Set(
      source.specifications.map(
        (item) => `${item.specificationId}:${String(item.specificationRevision)}`,
      ),
    );
    if (!keys.has(specificationKey)) {
      const first = source.specifications[0];
      setSpecificationKey(
        first ? `${first.specificationId}:${String(first.specificationRevision)}` : "",
      );
    }
  }, [cameraId, sourceSceneJobId, specificationKey, workspace?.capabilities.sources]);

  useEffect(() => {
    setResult(undefined);
    setEnhancement(undefined);
    setEnhancementProblem(undefined);
    setSelectedDiagnosticId(undefined);
    setShowComparison(false);
    if (!selectedJob || selectedJob.state !== "succeeded") return;
    let cancelled = false;
    const load = async () => {
      try {
        const nextResult = await renderStillsClient.getResult(projectId, selectedJob.id);
        if (cancelled) return;
        setResult(nextResult);
        setSelectedDiagnosticId(
          nextResult.manifest.artifacts.find(({ role }) => role === "segmentation-png")?.id,
        );
      } catch (reason) {
        if (!cancelled) setAlert(actionMessage(reason));
      }
      try {
        const nextEnhancement = await renderStillsClient.getEnhancement(projectId, selectedJob.id);
        if (!cancelled) setEnhancement(nextEnhancement);
      } catch (reason) {
        if (!cancelled && !(reason instanceof RenderStillsProblem && reason.kind === "not-found")) {
          setEnhancementProblem(actionMessage(reason));
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId, selectedJob]);

  useEffect(() => {
    if (!selectedJob || terminalStates.has(selectedJob.state) || !online) return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await renderStillsClient.getJob(projectId, selectedJob.id);
        if (cancelled) return;
        setWorkspace((current) =>
          current ? { ...current, jobs: updateJobList(current.jobs, next) } : current,
        );
        setStatusMessage(`Job status updated: ${jobStateLabel(next.state)}.`);
        if (!terminalStates.has(next.state)) timeout = setTimeout(() => void poll(), 2_000);
      } catch (reason) {
        if (!cancelled) setAlert(actionMessage(reason));
      }
    };
    timeout = setTimeout(() => void poll(), 2_000);
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [online, projectId, selectedJob]);

  const chooseJob = (jobId: string) => {
    setSelectedJobId(jobId);
    replaceDeepLink(jobId);
    window.requestAnimationFrame(() => jobHeadingRef.current?.focus());
  };

  const createJob = async () => {
    if (!workspace || !selectedSource || !selectedProfile) return;
    setBusy("create");
    setAlert("");
    try {
      const specification = selectedSource.specifications.find(
        (item) =>
          `${item.specificationId}:${String(item.specificationRevision)}` === specificationKey,
      );
      const job = await renderStillsClient.createJob(projectId, {
        cameraId,
        enhancement: enhancementRequested ? "optional-provider" : "disabled",
        label,
        lightingPresetId: "canonical-lights-neutral-world-v1",
        profileId: selectedProfile.profileId,
        sourceSceneJobId: selectedSource.sourceSceneJobId,
        ...(specification
          ? {
              specification: {
                specificationId: specification.specificationId,
                specificationRevision: specification.specificationRevision,
              },
            }
          : {}),
      });
      setWorkspace({ ...workspace, jobs: updateJobList(workspace.jobs, job) });
      chooseJob(job.id);
      setStatusMessage("Durable render job created from server-resolved exact pins.");
    } catch (reason) {
      setAlert(actionMessage(reason));
    } finally {
      setBusy(undefined);
    }
  };

  const transition = async (action: "cancel" | "retry") => {
    if (!selectedJob) return;
    setBusy(action);
    setAlert("");
    try {
      const next = await renderStillsClient[action](projectId, selectedJob);
      setWorkspace((current) =>
        current ? { ...current, jobs: updateJobList(current.jobs, next) } : current,
      );
      setStatusMessage(
        action === "cancel"
          ? "Cancellation requested against the exact durable job version."
          : "Retry created a new fenced attempt for the exact durable job.",
      );
    } catch (reason) {
      setAlert(actionMessage(reason));
      if (reason instanceof RenderStillsProblem && reason.kind === "conflict") {
        void loadWorkspace(false);
      }
    } finally {
      setBusy(undefined);
    }
  };

  const requestEnhancement = async () => {
    if (!selectedJob) return;
    setBusy("enhance");
    setEnhancementProblem(undefined);
    try {
      const next = await renderStillsClient.requestEnhancement(projectId, selectedJob);
      setEnhancement(next);
      setStatusMessage(
        "Optional enhancement requested. The safe result remains independently visible.",
      );
    } catch (reason) {
      setEnhancementProblem(actionMessage(reason));
    } finally {
      setBusy(undefined);
    }
  };

  if (loadState.kind === "loading") {
    return (
      <PageContainer className={styles.statePage}>
        <LoadingIndicator label="Loading durable render jobs and capability state…" />
      </PageContainer>
    );
  }
  if (loadState.kind === "expired") {
    return (
      <PageContainer className={styles.statePage}>
        <StatePanel
          actions={<ActionLink href="/sign-in">Sign in again</ActionLink>}
          message={
            <p>
              Your session ended. No URL, blob, private artifact payload or job mutation was
              retained.
            </p>
          }
          status="Session expired"
          title="Durable render state stayed unchanged"
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
            <ActionButton onClick={() => void loadWorkspace(true)}>
              Retry safe workspace load
            </ActionButton>
          }
          message={
            <p>{"message" in loadState ? loadState.message : "Workspace state is unavailable."}</p>
          }
          status={loadState.kind === "offline" ? "Offline" : "Unavailable"}
          title="Render details were not disclosed"
          tone="error"
        />
      </PageContainer>
    );
  }

  const safeArtifact = result?.manifest.artifacts.find(({ role }) => role === "geometry-safe-png");
  const diagnostics = result?.manifest.artifacts.filter(
    ({ role }) => role !== "geometry-safe-png" && role !== "illustrative-enhancement-png",
  );
  const selectedDiagnostic = diagnostics?.find(({ id }) => id === selectedDiagnosticId);
  const acceptedEnhancement =
    enhancement && isEnhancementResult(enhancement) && enhancement.state === "succeeded"
      ? enhancement
      : undefined;
  const activeStage = selectedJob ? stageIndex(selectedJob.state) : -1;
  const canCreate =
    editable &&
    online &&
    rendererAvailable &&
    selectedProfile?.state === "available" &&
    Boolean(sourceSceneJobId && cameraId && label.trim());

  return (
    <div className={styles.shell}>
      <header className={styles.hero}>
        <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
          <Link href="/projects">Projects</Link>
          <span aria-hidden="true">/</span>
          <Link href={homeJourneyHref(projectId)}>Home journey</Link>
          <span aria-hidden="true">/</span>
          <span>Render stills</span>
        </nav>
        <div className={styles.heroGrid}>
          <div>
            <p className={styles.eyebrow}>C14 · derived media workspace</p>
            <h1>Render with the model held still.</h1>
            <p>
              Create, monitor and inspect exact-source still jobs without promoting an image into
              dimensional or professional truth.
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
                {workspace.session.actor.role} · {editable ? "can create" : "inspect-only"}
              </dd>
            </div>
            <div>
              <dt>Renderer</dt>
              <dd>{workspace.capabilities.renderer.state}</dd>
            </div>
          </dl>
        </div>
        <div className={styles.truthGrid}>
          <p>
            <strong>“Geometry-locked deterministic render”</strong> is derived visualisation only.
          </p>
          <p>
            <strong>“Illustrative optional enhancement”</strong> is never canonical.
          </p>
          <p>
            No survey, as-built, structural, regulatory, cost, availability or professional
            certainty is established here.
          </p>
        </div>
      </header>

      <PageContainer className={styles.content}>
        <div aria-atomic="true" aria-live="polite" className={styles.visuallyHidden} role="status">
          {statusMessage}
        </div>

        <section className={styles.capabilityStrip} aria-labelledby="capability-title">
          <div>
            <p>Runtime truth</p>
            <h2 id="capability-title">Render capability on this configured host</h2>
            <span>{workspace.capabilities.renderer.reason}</span>
          </div>
          <dl>
            <div>
              <dt>Hardware gate</dt>
              <dd>{workspace.capabilities.renderer.hardwareGate}</dd>
            </div>
            <div>
              <dt>Enhancement provider</dt>
              <dd>{workspace.capabilities.enhancementProvider.state}</dd>
            </div>
            <div>
              <dt>Evidence</dt>
              <dd>
                {evidenceClassification === "synthetic-fixture"
                  ? "Synthetic fixture presentation · tests only"
                  : "Production capability response · no fixture render"}
              </dd>
            </div>
          </dl>
        </section>

        {!online ? (
          <div className={styles.offlineBanner} role="status">
            <strong>Offline inspection mode</strong>
            <span>Existing state stays visible; fresh access and mutations are paused.</span>
          </div>
        ) : null}
        {!editable ? (
          <div className={styles.readOnlyBanner}>
            <strong>Viewer access is inspect-only.</strong>
            <span>Create, cancel, retry and enhancement controls remain unavailable.</span>
          </div>
        ) : null}
        {alert ? (
          <div className={styles.alert} ref={alertRef} role="alert" tabIndex={-1}>
            <div>
              <strong>Action not completed</strong>
              <span>{alert}</span>
            </div>
            <ActionButton
              onClick={() => {
                setAlert("");
              }}
              tone="secondary"
            >
              Dismiss
            </ActionButton>
          </div>
        ) : null}

        <section className={styles.createCard} aria-labelledby="create-title">
          <header>
            <div>
              <p>01 · exact inputs</p>
              <h2 id="create-title">Prepare a durable still job</h2>
            </div>
            <span>{rendererAvailable ? "Capability available" : "Creation deferred"}</span>
          </header>
          <div className={styles.createForm}>
            <label>
              Source scene
              <select
                disabled={!editable || busy !== undefined}
                onChange={(event) => {
                  setSourceSceneJobId(event.target.value);
                }}
                value={sourceSceneJobId}
              >
                {workspace.capabilities.sources.length === 0 ? (
                  <option value="">No eligible exact C10 scene</option>
                ) : null}
                {workspace.capabilities.sources.map((source) => (
                  <option key={source.sourceSceneJobId} value={source.sourceSceneJobId}>
                    {source.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Specification
              <select
                disabled={!editable || !selectedSource || busy !== undefined}
                onChange={(event) => {
                  setSpecificationKey(event.target.value);
                }}
                value={specificationKey}
              >
                {selectedSource?.specifications.length ? null : (
                  <option value="">No exact C13 specification linked</option>
                )}
                {selectedSource?.specifications.map((specification) => {
                  const value = `${specification.specificationId}:${String(specification.specificationRevision)}`;
                  return (
                    <option key={value} value={value}>
                      {specification.label}
                    </option>
                  );
                })}
              </select>
            </label>
            <label>
              Canonical camera
              <select
                disabled={!editable || !selectedSource || busy !== undefined}
                onChange={(event) => {
                  setCameraId(event.target.value);
                }}
                value={cameraId}
              >
                {selectedSource?.cameras.map((camera) => (
                  <option key={camera.cameraId} value={camera.cameraId}>
                    {camera.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Lighting
              <select
                disabled={!editable || busy !== undefined}
                onChange={(event) => {
                  setLightingPresetId(event.target.value);
                }}
                value={lightingPresetId}
              >
                {workspace.capabilities.lightingPresets.map((preset) => (
                  <option key={preset.lightingPresetId} value={preset.lightingPresetId}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Render profile
              <select
                disabled={!editable || busy !== undefined}
                onChange={(event) => {
                  setProfileId(event.target.value);
                }}
                value={profileId}
              >
                {workspace.capabilities.profiles.map((profile) => (
                  <option key={profile.profileId} value={profile.profileId}>
                    {profile.label} · {profile.state}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Job label
              <input
                disabled={!editable || busy !== undefined}
                maxLength={160}
                onChange={(event) => {
                  setLabel(event.target.value);
                }}
                value={label}
              />
            </label>
            <label>
              Enhancement
              <select
                disabled={
                  !editable ||
                  busy !== undefined ||
                  workspace.capabilities.enhancementProvider.state !== "available"
                }
                onChange={(event) => {
                  setEnhancementRequested(event.target.value === "optional");
                }}
                value={enhancementRequested ? "optional" : "disabled"}
              >
                <option value="disabled">Disabled · safe result only</option>
                <option value="optional">Optional provider · separately guarded</option>
              </select>
            </label>
            <ActionButton
              disabled={!canCreate || busy !== undefined}
              onClick={() => void createJob()}
            >
              {busy === "create" ? "Creating durable job…" : "Create geometry-safe still job"}
            </ActionButton>
          </div>
          <p className={styles.formNote}>
            {rendererAvailable
              ? (selectedProfile?.reason ??
                "The server will resolve and revalidate all exact source pins.")
              : "No Blender invocation is permitted here. Deterministic fixtures exercise tests only and are never presented as a real render."}
          </p>
        </section>

        <section className={styles.jobWorkspace} aria-labelledby="jobs-title">
          <aside className={styles.jobList}>
            <header>
              <div>
                <p>02 · durable lifecycle</p>
                <h2 id="jobs-title">Render jobs</h2>
              </div>
              <ActionButton
                disabled={!online || busy !== undefined}
                onClick={() => void loadWorkspace(false)}
                tone="secondary"
              >
                {busy === "refresh" ? "Refreshing…" : "Refresh"}
              </ActionButton>
            </header>
            {workspace.jobs.length === 0 ? (
              <div className={styles.emptyJobs}>
                <strong>No render jobs yet</strong>
                <span>Eligible exact sources will appear in the preparation panel.</span>
              </div>
            ) : (
              <ol>
                {workspace.jobs.map((job) => (
                  <li key={job.id}>
                    <button
                      aria-current={job.id === selectedJobId ? "true" : undefined}
                      onClick={() => {
                        chooseJob(job.id);
                      }}
                      type="button"
                    >
                      <span>{job.request.label}</span>
                      <strong>{jobStateLabel(job.state)}</strong>
                      <small>
                        Attempt {String(job.attempt)} · updated{" "}
                        {new Date(job.updatedAt).toLocaleString("en-GB")}
                      </small>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </aside>

          <div className={styles.jobDetail}>
            {!selectedJob ? (
              <StatePanel
                message={
                  <p>
                    {selectedJobId
                      ? "The exact deep-linked job is not in this authorised project response. No other job was substituted."
                      : "Choose a durable job to inspect its exact lifecycle and result."}
                  </p>
                }
                status="No job selected"
                title="Exact job unavailable"
                tone={selectedJobId ? "error" : "neutral"}
              />
            ) : (
              <>
                <header className={styles.jobHeading}>
                  <div>
                    <p>Exact job</p>
                    <h2 ref={jobHeadingRef} tabIndex={-1}>
                      {selectedJob.request.label}
                    </h2>
                    <code>{selectedJob.id}</code>
                  </div>
                  <div className={styles.jobActions}>
                    <ActionButton
                      disabled={
                        !editable || !online || !canCancel(selectedJob) || busy !== undefined
                      }
                      onClick={() => void transition("cancel")}
                      tone="secondary"
                    >
                      {busy === "cancel" ? "Requesting…" : "Cancel job"}
                    </ActionButton>
                    <ActionButton
                      disabled={
                        !editable || !online || !canRetry(selectedJob) || busy !== undefined
                      }
                      onClick={() => void transition("retry")}
                      tone="secondary"
                    >
                      {busy === "retry" ? "Retrying…" : "Retry exact job"}
                    </ActionButton>
                  </div>
                </header>

                <ol className={styles.stages} aria-label="Render lifecycle stages">
                  {renderStages.map((stage, index) => {
                    const state =
                      selectedJob.state === "cancelled" || selectedJob.state === "failed"
                        ? "stopped"
                        : index < activeStage
                          ? "complete"
                          : index === activeStage
                            ? "current"
                            : "upcoming";
                    return (
                      <li
                        aria-current={state === "current" ? "step" : undefined}
                        data-stage-state={state}
                        key={stage.label}
                      >
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        <strong>{stage.label}</strong>
                      </li>
                    );
                  })}
                </ol>
                <div className={styles.jobStatus} role="status">
                  <strong>{jobStateLabel(selectedJob.state)}</strong>
                  {selectedJob.safeCode ? <code>{selectedJob.safeCode}</code> : null}
                  <span>
                    Version {String(selectedJob.version)} · attempt {String(selectedJob.attempt)}
                  </span>
                </div>

                <dl className={styles.pinGrid}>
                  <div>
                    <dt>Source scene job</dt>
                    <dd>
                      <code>{selectedJob.request.sourceSceneJobId}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Camera</dt>
                    <dd>
                      <code>{selectedJob.request.cameraId}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Lighting</dt>
                    <dd>{selectedJob.request.lightingPresetId}</dd>
                  </div>
                  <div>
                    <dt>Profile</dt>
                    <dd>{selectedJob.request.profileId}</dd>
                  </div>
                  <div>
                    <dt>Specification</dt>
                    <dd>
                      {selectedJob.request.specification
                        ? `Revision ${String(selectedJob.request.specification.specificationRevision)}`
                        : "No selected specification"}
                    </dd>
                  </div>
                  <div>
                    <dt>Enhancement request</dt>
                    <dd>{selectedJob.request.enhancement}</dd>
                  </div>
                </dl>

                {result && safeArtifact ? (
                  <section className={styles.resultSection} aria-labelledby="result-title">
                    <header>
                      <div>
                        <p>03 · safe result</p>
                        <h2 id="result-title">Geometry-locked deterministic render</h2>
                      </div>
                      <span>Derived visualisation only</span>
                    </header>
                    <VerifiedArtifact
                      alt={`Geometry-locked deterministic render for ${selectedJob.request.label}; derived visualisation only.`}
                      artifact={safeArtifact}
                      autoVerify
                      jobId={selectedJob.id}
                      manifestSha256={result.manifestSha256}
                      offline={!online}
                      projectId={projectId}
                    />

                    <div className={styles.diagnostics}>
                      <header>
                        <div>
                          <p>04 · diagnostic passes</p>
                          <h3>Inspect one immutable pass</h3>
                        </div>
                        <span>EXR checks do not claim pixel or Blender validation</span>
                      </header>
                      <div className={styles.diagnosticTabs}>
                        {diagnostics?.map((artifact) => (
                          <button
                            aria-pressed={artifact.id === selectedDiagnosticId}
                            key={artifact.id}
                            onClick={() => {
                              setSelectedDiagnosticId(artifact.id);
                            }}
                            type="button"
                          >
                            <span>{artifactLabel(artifact.role)}</span>
                            <small>{formatBytes(artifact.byteLength)}</small>
                          </button>
                        ))}
                      </div>
                      {selectedDiagnostic ? (
                        <VerifiedArtifact
                          alt={`Segmentation diagnostic for ${selectedJob.request.label}; canonical element palette only.`}
                          artifact={selectedDiagnostic}
                          autoVerify={selectedDiagnostic.role === "segmentation-png"}
                          jobId={selectedJob.id}
                          manifestSha256={result.manifestSha256}
                          offline={!online}
                          projectId={projectId}
                        />
                      ) : null}
                    </div>

                    <section className={styles.enhancementCard} aria-labelledby="enhancement-title">
                      <header>
                        <div>
                          <p>05 · optional child product</p>
                          <h3 id="enhancement-title">Illustrative optional enhancement</h3>
                        </div>
                        <strong>{enhancementLabel(enhancement)}</strong>
                      </header>
                      <p>
                        This child product is never canonical and cannot replace, delay, hide or
                        downgrade the safe result above.
                      </p>
                      {enhancementProblem ? (
                        <div className={styles.inlineError} role="status">
                          {enhancementProblem}
                        </div>
                      ) : null}
                      {acceptedEnhancement?.geometryGuard ? (
                        <dl className={styles.guardGrid}>
                          <div>
                            <dt>Camera locked</dt>
                            <dd>{acceptedEnhancement.geometryGuard.cameraLocked ? "Yes" : "No"}</dd>
                          </div>
                          <div>
                            <dt>Changed outside mask</dt>
                            <dd>
                              {String(
                                acceptedEnhancement.geometryGuard.changedOutsideAllowedMaskPixels,
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt>Protected edge agreement</dt>
                            <dd>
                              {(
                                acceptedEnhancement.geometryGuard
                                  .protectedEdgeAgreementBasisPoints / 100
                              ).toFixed(2)}
                              %
                            </dd>
                          </div>
                          <div>
                            <dt>Segmentation IoU</dt>
                            <dd>
                              {(
                                acceptedEnhancement.geometryGuard.segmentationIoUBasisPoints / 100
                              ).toFixed(2)}
                              %
                            </dd>
                          </div>
                        </dl>
                      ) : null}
                      <div className={styles.enhancementActions}>
                        <ActionButton
                          disabled={
                            !editable ||
                            !online ||
                            busy !== undefined ||
                            workspace.capabilities.enhancementProvider.state !== "available" ||
                            acceptedEnhancement !== undefined
                          }
                          onClick={() => void requestEnhancement()}
                          tone="secondary"
                        >
                          {busy === "enhance" ? "Requesting…" : "Request optional enhancement"}
                        </ActionButton>
                        <label>
                          <input
                            checked={showComparison}
                            disabled={!acceptedEnhancement}
                            onChange={(event) => {
                              setShowComparison(event.target.checked);
                            }}
                            type="checkbox"
                          />
                          Show separately labelled optional comparison
                        </label>
                      </div>
                      {showComparison && acceptedEnhancement?.artifact ? (
                        <div className={styles.comparisonGrid}>
                          <VerifiedArtifact
                            alt={`Illustrative optional enhancement for ${selectedJob.request.label}; never canonical.`}
                            artifact={acceptedEnhancement.artifact}
                            autoVerify
                            jobId={selectedJob.id}
                            manifestSha256={result.manifestSha256}
                            offline={!online}
                            projectId={projectId}
                          />
                          <div className={styles.comparisonBoundary}>
                            <strong>Comparison boundary</strong>
                            <p>
                              Compare appearance only. The geometry-locked deterministic render
                              remains the spatial reference.
                            </p>
                          </div>
                        </div>
                      ) : null}
                    </section>

                    <details className={styles.manifestDisclosure}>
                      <summary>Manifest and exact source disclosure</summary>
                      <dl>
                        <div>
                          <dt>Result manifest</dt>
                          <dd>
                            <code>{shortHash(result.manifestSha256)}</code>
                          </dd>
                        </div>
                        <div>
                          <dt>Render scene manifest</dt>
                          <dd>
                            <code>{shortHash(result.manifest.renderSceneManifestSha256)}</code>
                          </dd>
                        </div>
                        <div>
                          <dt>Source snapshot</dt>
                          <dd>
                            <code>{shortHash(result.manifest.source.sourceSnapshotSha256)}</code>
                          </dd>
                        </div>
                        <div>
                          <dt>Scene GLB</dt>
                          <dd>
                            <code>{shortHash(result.manifest.source.sceneGlbSha256)}</code>
                          </dd>
                        </div>
                        <div>
                          <dt>Replay scope</dt>
                          <dd>{result.manifest.exactByteReplayScope}</dd>
                        </div>
                        <div>
                          <dt>Authority</dt>
                          <dd>{result.manifest.authority}</dd>
                        </div>
                      </dl>
                    </details>
                  </section>
                ) : selectedJob.state === "succeeded" ? (
                  <div className={styles.resultLoading}>
                    <LoadingIndicator label="Loading the immutable safe result manifest…" />
                  </div>
                ) : null}
              </>
            )}
          </div>
        </section>
      </PageContainer>
    </div>
  );
}
