"use client";

import {
  c10DefaultCompileConfiguration,
  type SceneJob,
  type SceneManifest,
  type SceneRecord,
} from "@interior-design/contracts";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SyntheticEvent } from "react";

import { ActionButton, LoadingIndicator, PageContainer } from "../../components/ui-primitives";
import { sceneClient, SceneProblem } from "./api";
import { detectViewerCapabilities } from "./capabilities";
import type { ViewerCapabilities } from "./capabilities";
import type { SceneWorkspace as Workspace } from "./contracts";
import { selectedSceneJobId } from "./deep-link";
import { DomSceneFallback, ElementInspector, ElementList } from "./dom-fallback";
import {
  canCancelScene,
  canRetryScene,
  formattedSceneBytes,
  isActiveSceneState,
  sceneJobStateLabel,
} from "./presentation";
import {
  fetchVerifiedGlb,
  SceneIntegrityError,
  verifySceneRecord,
  verifySceneTuple,
} from "./scene-verification";
import type { SceneLoadProgress } from "./scene-verification";
import type {
  ViewerControlMode,
  ViewerMaterialMode,
  WalkCommand,
  WalkDirection,
} from "./scene-canvas";
import { ViewerErrorBoundary } from "./viewer-error-boundary";

const LazySceneCanvas = dynamic(
  () => import("./scene-canvas").then(({ SceneCanvas }) => SceneCanvas),
  {
    loading: () => (
      <div className="scene-canvas-loading" role="status">
        <span aria-hidden="true" />
        <strong>Loading interactive renderer</strong>
        <p>The Three.js and React Three Fiber bundle is loaded only after you request 3D.</p>
      </div>
    ),
    ssr: false,
  },
);

type LoadState =
  | { readonly kind: "error" | "forbidden" | "offline"; readonly message: string }
  | { readonly kind: "expired" | "loading" | "ready" };

type BusyAction = "cancel" | "create" | "refresh" | "retry";

type SceneDisplay =
  | { readonly kind: "idle" }
  | { readonly kind: "loading"; readonly progress?: SceneLoadProgress }
  | { readonly glb: ArrayBuffer; readonly kind: "verified"; readonly scene: SceneRecord }
  | {
      readonly code:
        "context-loss" | "expired" | "integrity" | "offline" | "over-budget" | "renderer" | "webgl";
      readonly kind: "fallback";
      readonly reason: string;
      readonly scene: SceneRecord;
    };

type SceneFallbackCode = Extract<SceneDisplay, { readonly kind: "fallback" }>["code"];

function loadStateFrom(reason: unknown): LoadState {
  if (reason instanceof SceneProblem) {
    if (reason.kind === "expired") return { kind: "expired" };
    if (reason.kind === "forbidden" || reason.kind === "not-found") {
      return { kind: "forbidden", message: reason.message };
    }
    if (reason.kind === "offline") return { kind: "offline", message: reason.message };
    return { kind: "error", message: reason.message };
  }
  return { kind: "error", message: "The 3D scene workspace could not be loaded." };
}

function formattedTime(value: string): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function selectedManifest(display: SceneDisplay): SceneManifest | undefined {
  return display.kind === "verified" || display.kind === "fallback"
    ? display.scene.manifest
    : undefined;
}

function fallbackCode(reason: unknown): SceneFallbackCode {
  if (reason instanceof SceneIntegrityError) {
    if (reason.code === "OVER_CLIENT_BUDGET") return "over-budget";
    if (reason.code === "ACCESS_EXPIRED") return "expired";
    return "integrity";
  }
  if (reason instanceof SceneProblem && reason.kind === "offline") return "offline";
  if (reason instanceof SceneProblem && reason.kind === "expired-link") return "expired";
  return "integrity";
}

export function ViewerWorkspace({
  initialJobId,
  projectId,
}: {
  readonly initialJobId?: string;
  readonly projectId: string;
}) {
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [workspace, setWorkspace] = useState<Workspace>();
  const [selectedJobId, setSelectedJobId] = useState<string>();
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string>();
  const [label, setLabel] = useState("Exact committed home walkthrough");
  const [busy, setBusy] = useState<BusyAction>();
  const [alert, setAlert] = useState<string>();
  const [liveMessage, setLiveMessage] = useState("");
  const [capabilities, setCapabilities] = useState<ViewerCapabilities>();
  const [sceneDisplay, setSceneDisplay] = useState<SceneDisplay>({ kind: "idle" });
  const [rendererReady, setRendererReady] = useState(false);
  const [selectedElementId, setSelectedElementId] = useState<string>();
  const [visibleLevelIds, setVisibleLevelIds] = useState<ReadonlySet<string>>(new Set());
  const [controlMode, setControlMode] = useState<ViewerControlMode>("orbit");
  const [materialMode, setMaterialMode] = useState<ViewerMaterialMode>("material");
  const [sectionEnabled, setSectionEnabled] = useState(false);
  const [sectionHeightMm, setSectionHeightMm] = useState(0);
  const [resetNonce, setResetNonce] = useState(0);
  const [walkCommand, setWalkCommand] = useState<WalkCommand>();

  useEffect(() => {
    setCapabilities(detectViewerCapabilities());
  }, []);

  const loadWorkspace = useCallback(
    async (initial = false) => {
      if (initial) setLoadState({ kind: "loading" });
      else setBusy("refresh");
      setAlert(undefined);
      try {
        const next = await sceneClient.loadWorkspace(projectId);
        setWorkspace(next);
        const exactJobAvailable =
          initialJobId !== undefined && next.jobs.some(({ id }) => id === initialJobId);
        setSelectedJobId((current) => selectedSceneJobId(next.jobs, current, initialJobId));
        if (initialJobId !== undefined && !exactJobAvailable) {
          setAlert(
            "The requested exact scene job is not available for this project. No substitute scene was presented as that result.",
          );
        }
        setSelectedSnapshotId((current) =>
          next.snapshots.some(({ snapshotId }) => snapshotId === current)
            ? current
            : next.snapshots[0]?.snapshotId,
        );
        setLoadState({ kind: "ready" });
        if (!initial) setLiveMessage("Scene jobs and exact snapshot references refreshed.");
      } catch (reason) {
        setLoadState(loadStateFrom(reason));
      } finally {
        setBusy(undefined);
      }
    },
    [initialJobId, projectId],
  );

  useEffect(() => {
    void loadWorkspace(true);
  }, [loadWorkspace]);

  const selectedJob = workspace?.jobs.find(({ id }) => id === selectedJobId);
  const editable = workspace ? workspace.session.actor.role !== "viewer" : false;
  const manifest = selectedManifest(sceneDisplay);
  const levels = useMemo(
    () => manifest?.elementMappings.filter(({ elementType }) => elementType === "level") ?? [],
    [manifest],
  );

  useEffect(() => {
    if (!selectedJob || !isActiveSceneState(selectedJob.state)) return;
    const timer = window.setInterval(() => {
      void sceneClient
        .getJob(projectId, selectedJob.id)
        .then((job) => {
          setWorkspace((current) =>
            current
              ? { ...current, jobs: current.jobs.map((item) => (item.id === job.id ? job : item)) }
              : current,
          );
          setLiveMessage(`Scene job status is ${sceneJobStateLabel(job.state).toLowerCase()}.`);
        })
        .catch((reason: unknown) => {
          if (reason instanceof SceneProblem && reason.kind === "expired") {
            setLoadState({ kind: "expired" });
          }
        });
    }, 2_500);
    return () => {
      window.clearInterval(timer);
    };
  }, [projectId, selectedJob]);

  useEffect(() => {
    setSceneDisplay({ kind: "idle" });
    setRendererReady(false);
    setSelectedElementId(undefined);
  }, [selectedJobId]);

  const move = useCallback((direction: WalkDirection) => {
    setWalkCommand((current) => ({ direction, nonce: (current?.nonce ?? 0) + 1 }));
  }, []);

  useEffect(() => {
    if (controlMode !== "walk") return;
    const keydown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      const direction: Partial<Record<string, WalkDirection>> = {
        ArrowDown: "backward",
        ArrowLeft: "left",
        ArrowRight: "right",
        ArrowUp: "forward",
        a: "left",
        d: "right",
        s: "backward",
        w: "forward",
      };
      const next = direction[event.key];
      if (!next) return;
      event.preventDefault();
      move(next);
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
    };
  }, [controlMode, move]);

  async function createJob(event: SyntheticEvent<HTMLFormElement, SubmitEvent>): Promise<void> {
    event.preventDefault();
    const snapshot = workspace?.snapshots.find(
      ({ snapshotId }) => snapshotId === selectedSnapshotId,
    );
    if (!snapshot || !editable) return;
    setBusy("create");
    setAlert(undefined);
    try {
      const job = await sceneClient.createJob(projectId, {
        configuration: c10DefaultCompileConfiguration,
        label: label.trim(),
        sourceSnapshot: snapshot,
      });
      setWorkspace((current) =>
        current
          ? { ...current, jobs: [job, ...current.jobs.filter(({ id }) => id !== job.id)] }
          : current,
      );
      setSelectedJobId(job.id);
      setLiveMessage("Scene compilation queued against the exact committed snapshot.");
    } catch (reason) {
      setAlert(reason instanceof Error ? reason.message : "The scene job could not be created.");
    } finally {
      setBusy(undefined);
    }
  }

  async function transitionJob(action: "cancel" | "retry"): Promise<void> {
    if (!selectedJob || !editable) return;
    setBusy(action);
    setAlert(undefined);
    try {
      const job = await sceneClient[action](projectId, selectedJob);
      setWorkspace((current) =>
        current
          ? { ...current, jobs: current.jobs.map((item) => (item.id === job.id ? job : item)) }
          : current,
      );
      setLiveMessage(
        action === "cancel"
          ? "Scene cancellation requested."
          : "Scene retry queued as a fenced attempt.",
      );
    } catch (reason) {
      setAlert(reason instanceof Error ? reason.message : "The scene job could not be updated.");
    } finally {
      setBusy(undefined);
    }
  }

  async function loadScene(): Promise<void> {
    if (!selectedJob || selectedJob.state !== "succeeded") return;
    let trustedScene: SceneRecord | undefined;
    setSceneDisplay({ kind: "loading" });
    setRendererReady(false);
    setAlert(undefined);
    try {
      if (capabilities?.webgl === false) {
        const scene = await sceneClient.getScene(projectId, selectedJob.id);
        await verifySceneRecord(selectedJob, scene);
        trustedScene = scene;
        setVisibleLevelIds(sceneLevelIds(scene.manifest));
        setSectionHeightMm(scene.manifest.boundsMm.maximum.zMm);
        setSceneDisplay({
          code: "webgl",
          kind: "fallback",
          reason: "WebGL is unavailable or exposes a major performance caveat on this browser.",
          scene,
        });
        setLiveMessage("WebGL unavailable; the exact DOM scene summary is ready.");
        return;
      }
      const [scene, access] = await Promise.all([
        sceneClient.getScene(projectId, selectedJob.id),
        sceneClient.requestAccess(projectId, selectedJob.id),
      ]);
      await verifySceneRecord(selectedJob, scene);
      trustedScene = scene;
      await verifySceneTuple(selectedJob, scene, access);
      setVisibleLevelIds(sceneLevelIds(scene.manifest));
      setSectionHeightMm(scene.manifest.boundsMm.maximum.zMm);
      const verified = await fetchVerifiedGlb(access, scene.manifest, {
        onProgress(progress) {
          setSceneDisplay({ kind: "loading", progress });
        },
      });
      setSceneDisplay({ glb: verified.bytes, kind: "verified", scene });
      setLiveMessage("Checksums and GLB semantics verified. Preparing interactive rendering.");
    } catch (reason) {
      if (!trustedScene) {
        setAlert(reason instanceof Error ? reason.message : "The scene could not be loaded.");
        setSceneDisplay({ kind: "idle" });
        setLiveMessage("Scene metadata failed verification and was not presented.");
        return;
      }
      const scene = trustedScene;
      setVisibleLevelIds(sceneLevelIds(scene.manifest));
      setSectionHeightMm(scene.manifest.boundsMm.maximum.zMm);
      setSceneDisplay({
        code: fallbackCode(reason),
        kind: "fallback",
        reason:
          reason instanceof Error ? reason.message : "The interactive scene could not be verified.",
        scene,
      });
      setLiveMessage(
        "Interactive 3D rejected before success; the exact DOM summary remains available.",
      );
    }
  }

  function rendererFallback(code: "context-loss" | "renderer", reason: string): void {
    if (sceneDisplay.kind !== "verified") return;
    setSceneDisplay({ code, kind: "fallback", reason, scene: sceneDisplay.scene });
    setRendererReady(false);
    setLiveMessage("The renderer stopped safely. The DOM model summary remains usable.");
  }

  function toggleLevel(elementId: string): void {
    setVisibleLevelIds((current) => {
      const next = new Set(current);
      if (next.has(elementId)) next.delete(elementId);
      else next.add(elementId);
      return next;
    });
  }

  if (loadState.kind === "loading") {
    return (
      <PageContainer className="workspace-state">
        <LoadingIndicator label="Loading the 3D scene workspace" />
      </PageContainer>
    );
  }
  if (loadState.kind === "expired") {
    return (
      <ViewerState
        actionHref="/sign-in"
        actionLabel="Sign in again"
        message="Your session expired. No scene or canonical model state was changed."
        title="Your session has expired"
      />
    );
  }
  if (loadState.kind === "forbidden") {
    return (
      <ViewerState
        action={() => loadWorkspace(true)}
        actionLabel="Try again"
        message={loadState.message}
        title="Scene workspace unavailable"
      />
    );
  }
  if (loadState.kind === "offline") {
    return (
      <ViewerState
        action={() => loadWorkspace(true)}
        actionLabel="Reconnect and retry"
        message={loadState.message}
        title="You’re offline"
      />
    );
  }
  if (loadState.kind === "error" || !workspace) {
    return (
      <ViewerState
        action={() => loadWorkspace(true)}
        actionLabel="Retry workspace loading"
        message={
          loadState.kind === "error" ? loadState.message : "The workspace response was incomplete."
        }
        title="Scene workspace could not be loaded"
      />
    );
  }

  return (
    <PageContainer className="viewer-shell">
      <div aria-live="polite" className="viewer-live">
        {liveMessage}
      </div>
      <header className="viewer-hero">
        <div>
          <Link className="viewer-back" href="/projects">
            ← Projects
          </Link>
          <span className="viewer-kicker">C10 · deterministic scene</span>
          <h1>Experience the exact committed model</h1>
          <p>
            Orbit, bounded walk, section and inspect a derived GLB. This view does not add survey,
            structural, regulatory, professional or traversability authority.
          </p>
        </div>
        <dl>
          <div>
            <dt>Project</dt>
            <dd>{workspace.project.name}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{workspace.session.actor.role}</dd>
          </div>
          <div>
            <dt>Renderer</dt>
            <dd>{capabilities?.webgl ? "WebGL available" : "DOM fallback available"}</dd>
          </div>
          <div>
            <dt>Motion</dt>
            <dd>{capabilities?.reducedMotion ? "Reduced" : "Standard"}</dd>
          </div>
        </dl>
      </header>

      {workspace.evidenceClassification === "fixture-presentation" ? (
        <div className="viewer-fixture" role="note">
          <strong>Fixture presentation evidence</strong>
          <span>
            This workspace uses a synthetic mock API/GLB and is not real-backend evidence.
          </span>
        </div>
      ) : null}

      {alert ? (
        <div className="viewer-alert" role="alert">
          <strong>Scene action not completed</strong>
          <span>{alert}</span>
        </div>
      ) : null}

      <section className="viewer-start" aria-labelledby="viewer-start-title">
        <header>
          <div>
            <span>Immutable source</span>
            <h2 id="viewer-start-title">Compile an exact snapshot</h2>
          </div>
          <p>
            {workspace.snapshots.length} committed profile
            {workspace.snapshots.length === 1 ? "" : "s"} available
          </p>
        </header>
        {editable ? (
          workspace.snapshots.length > 0 ? (
            <form onSubmit={(event) => void createJob(event)}>
              <label>
                Snapshot
                <select
                  disabled={busy === "create"}
                  onChange={(event) => {
                    setSelectedSnapshotId(event.target.value);
                  }}
                  value={selectedSnapshotId}
                >
                  {workspace.snapshots.map((snapshot) => (
                    <option key={snapshot.snapshotId} value={snapshot.snapshotId}>
                      {snapshot.profile} · {snapshot.snapshotSha256.slice(0, 12)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Scene label
                <input
                  disabled={busy === "create"}
                  maxLength={120}
                  onChange={(event) => {
                    setLabel(event.target.value);
                  }}
                  required
                  value={label}
                />
              </label>
              <ActionButton disabled={busy === "create" || label.trim().length === 0} type="submit">
                {busy === "create" ? "Queuing…" : "Compile derived scene"}
              </ActionButton>
            </form>
          ) : (
            <p className="viewer-empty-copy">
              No committed snapshot is available. Commit a validated model before compiling a
              derived scene.
            </p>
          )
        ) : (
          <p className="viewer-readonly">
            Viewer role · read-only. You can inspect jobs, request short-lived scene access and use
            every non-mutating view control.
          </p>
        )}
      </section>

      <section className="viewer-job-workspace" aria-label="Scene job lifecycle">
        <aside className="viewer-job-list">
          <header>
            <div>
              <span>Durable workflow</span>
              <h2>Scene jobs</h2>
            </div>
            <ActionButton disabled={busy === "refresh"} onClick={() => void loadWorkspace()}>
              {busy === "refresh" ? "Refreshing…" : "Refresh"}
            </ActionButton>
          </header>
          {workspace.jobs.length === 0 ? (
            <p>No scene jobs yet. The workspace is ready without pretending that a scene exists.</p>
          ) : (
            <ul>
              {workspace.jobs.map((job) => (
                <li key={job.id}>
                  <button
                    aria-current={job.id === selectedJobId}
                    onClick={() => {
                      setSelectedJobId(job.id);
                    }}
                    type="button"
                  >
                    <span>
                      <strong>{job.request.label}</strong>
                      <small>{formattedTime(job.updatedAt)}</small>
                    </span>
                    <span className="viewer-status" data-state={job.state}>
                      {sceneJobStateLabel(job.state)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <div className="viewer-job-detail">
          {selectedJob ? (
            <>
              <header>
                <div>
                  <span>Attempt {selectedJob.attempt} of 3</span>
                  <h2>{sceneJobStateLabel(selectedJob.state)}</h2>
                  <p>{selectedJob.request.label}</p>
                </div>
                {editable ? (
                  <div className="viewer-job-actions">
                    {canCancelScene(selectedJob) ? (
                      <ActionButton
                        disabled={busy === "cancel"}
                        onClick={() => void transitionJob("cancel")}
                      >
                        Cancel attempt
                      </ActionButton>
                    ) : null}
                    {canRetryScene(selectedJob) ? (
                      <ActionButton
                        disabled={busy === "retry"}
                        onClick={() => void transitionJob("retry")}
                      >
                        Retry as new attempt
                      </ActionButton>
                    ) : null}
                  </div>
                ) : null}
              </header>
              <SceneLifecycle job={selectedJob} />
              {selectedJob.state === "failed" ? (
                <p className="viewer-job-finding">
                  Safe code: <code>{selectedJob.safeCode}</code>. No scene was presented as
                  successful.
                </p>
              ) : null}
              {selectedJob.state === "cancelled" ? (
                <p className="viewer-job-finding">
                  This attempt is terminal. A retry creates a separately fenced attempt.
                </p>
              ) : null}
              {selectedJob.state === "succeeded" && sceneDisplay.kind === "idle" ? (
                <div className="viewer-open-scene">
                  <div>
                    <strong>Published scene is available</strong>
                    <span>
                      Request short-lived access, verify its tuple, hash, content and GLB semantics,
                      then lazy-load 3D.
                    </span>
                  </div>
                  <ActionButton onClick={() => void loadScene()}>
                    Request access and inspect
                  </ActionButton>
                </div>
              ) : null}
            </>
          ) : (
            <div className="viewer-empty-detail">
              <h2>Select a scene job</h2>
              <p>
                Queued, compiling, publishing, succeeded, failed and cancelled states remain
                distinct.
              </p>
            </div>
          )}
        </div>
      </section>

      {sceneDisplay.kind === "loading" ? <SceneLoading progress={sceneDisplay.progress} /> : null}
      {sceneDisplay.kind === "verified" ? (
        <section
          className="viewer-scene"
          aria-labelledby="viewer-scene-title"
          data-rendering={rendererReady ? "ready" : "preparing"}
        >
          <header>
            <div>
              <span>Checksum-bound GLB</span>
              <h2 id="viewer-scene-title">
                {rendererReady ? "Interactive 3D ready" : "Preparing interactive 3D"}
              </h2>
            </div>
            <p>
              {formattedSceneBytes(sceneDisplay.scene.artifact.byteSize)} ·{" "}
              {sceneDisplay.scene.manifest.counts.triangles.toLocaleString("en-GB")} triangles ·
              demand rendering
            </p>
          </header>
          <ViewerControls
            controlMode={controlMode}
            levels={levels}
            manifest={sceneDisplay.scene.manifest}
            materialMode={materialMode}
            onControlMode={setControlMode}
            onMaterialMode={setMaterialMode}
            onMove={move}
            onReset={() => {
              setResetNonce((value) => value + 1);
            }}
            onSectionEnabled={setSectionEnabled}
            onSectionHeight={setSectionHeightMm}
            onToggleLevel={toggleLevel}
            sectionEnabled={sectionEnabled}
            sectionHeightMm={sectionHeightMm}
            visibleLevelIds={visibleLevelIds}
          />
          <div className="viewer-scene-grid">
            <div className="viewer-canvas-frame">
              <ViewerErrorBoundary
                onError={() => {
                  rendererFallback(
                    "renderer",
                    "The verified GLB could not be rendered safely in this browser.",
                  );
                }}
                resetKey={sceneDisplay.scene.artifact.glbSha256}
              >
                <LazySceneCanvas
                  controlMode={controlMode}
                  glb={sceneDisplay.glb}
                  manifest={sceneDisplay.scene.manifest}
                  materialMode={materialMode}
                  movement={walkCommand}
                  onContextLost={() => {
                    rendererFallback(
                      "context-loss",
                      "The WebGL context was lost. The scene stopped and the DOM fallback is now active.",
                    );
                  }}
                  onReady={() => {
                    setRendererReady(true);
                    setLiveMessage("Interactive 3D ready. Canvas rendering stops when idle.");
                  }}
                  onSelect={(elementId) => {
                    setSelectedElementId(elementId || undefined);
                  }}
                  reducedMotion={capabilities?.reducedMotion ?? false}
                  resetNonce={resetNonce}
                  sectionEnabled={sectionEnabled}
                  sectionHeightMm={sectionHeightMm}
                  selectedElementId={selectedElementId}
                  visibleLevelIds={visibleLevelIds}
                />
              </ViewerErrorBoundary>
            </div>
            <div className="viewer-dom-panel">
              <ElementList
                mappings={sceneDisplay.scene.manifest.elementMappings}
                onSelect={setSelectedElementId}
                selectedElementId={selectedElementId}
              />
              <ElementInspector
                manifest={sceneDisplay.scene.manifest}
                selectedElementId={selectedElementId}
              />
            </div>
          </div>
        </section>
      ) : null}
      {sceneDisplay.kind === "fallback" ? (
        <section className="viewer-scene" data-rendering="fallback">
          <div className="viewer-fallback-actions">
            <span className="viewer-status" data-state="fallback">
              {sceneDisplay.code.replaceAll("-", " ")}
            </span>
            {sceneDisplay.code === "expired" ||
            sceneDisplay.code === "offline" ||
            sceneDisplay.code === "context-loss" ? (
              <ActionButton onClick={() => void loadScene()}>
                Request fresh access and retry 3D
              </ActionButton>
            ) : null}
          </div>
          <div className="viewer-fallback-grid">
            <DomSceneFallback
              manifest={sceneDisplay.scene.manifest}
              onSelect={setSelectedElementId}
              reason={sceneDisplay.reason}
              selectedElementId={selectedElementId}
              visibleLevelIds={visibleLevelIds}
            />
            <ElementInspector
              manifest={sceneDisplay.scene.manifest}
              selectedElementId={selectedElementId}
            />
          </div>
        </section>
      ) : null}
    </PageContainer>
  );
}

function sceneLevelIds(manifest: SceneManifest): ReadonlySet<string> {
  return new Set(
    manifest.elementMappings
      .filter(({ elementType, status }) => elementType === "level" && status === "mapped")
      .map(({ elementId }) => elementId),
  );
}

function SceneLifecycle({ job }: { readonly job: SceneJob }) {
  const stages = [
    { detail: "Durably queued against one exact snapshot hash.", key: "queued", label: "Queued" },
    {
      detail: "Worker lease and deterministic compiler are bounded.",
      key: "compiling",
      label: "Compiling",
    },
    {
      detail: "Validation precedes immutable artifact publication.",
      key: "publishing",
      label: "Publishing",
    },
    {
      detail: "Only a succeeded job can expose short-lived access.",
      key: "succeeded",
      label: "Available",
    },
  ] as const;
  const order = ["queued", "leased", "compiling", "publishing", "succeeded"];
  const index = order.indexOf(job.state);
  return (
    <ol className="viewer-lifecycle">
      {stages.map((stage) => {
        const stageIndex = order.indexOf(stage.key);
        const state =
          job.state === "failed" || job.state === "cancelled" || job.state === "cancel-requested"
            ? job.state
            : stageIndex < index
              ? "complete"
              : stageIndex === index || (stage.key === "compiling" && job.state === "leased")
                ? "current"
                : "pending";
        return (
          <li data-state={state} key={stage.key}>
            <span aria-hidden="true" />
            <div>
              <strong>{stage.label}</strong>
              <p>{stage.detail}</p>
            </div>
            <small>{state.replaceAll("-", " ")}</small>
          </li>
        );
      })}
    </ol>
  );
}

function SceneLoading({ progress }: { readonly progress: SceneLoadProgress | undefined }) {
  const percent = progress
    ? Math.min(100, Math.round((progress.loadedBytes / progress.totalBytes) * 100))
    : 0;
  return (
    <section className="viewer-scene-loading" aria-labelledby="scene-loading-title" role="status">
      <span aria-hidden="true" />
      <div>
        <h2 id="scene-loading-title">Verifying scene before presentation</h2>
        <p>
          {progress
            ? `${progress.phase} · ${String(percent)}% · ${formattedSceneBytes(progress.loadedBytes)} of ${formattedSceneBytes(progress.totalBytes)}`
            : "Requesting immutable scene and short-lived access in parallel."}
        </p>
      </div>
      <progress aria-label="Scene verification progress" max={100} value={percent} />
    </section>
  );
}

function ViewerControls({
  controlMode,
  levels,
  manifest,
  materialMode,
  onControlMode,
  onMaterialMode,
  onMove,
  onReset,
  onSectionEnabled,
  onSectionHeight,
  onToggleLevel,
  sectionEnabled,
  sectionHeightMm,
  visibleLevelIds,
}: {
  readonly controlMode: ViewerControlMode;
  readonly levels: SceneManifest["elementMappings"];
  readonly manifest: SceneManifest;
  readonly materialMode: ViewerMaterialMode;
  readonly onControlMode: (mode: ViewerControlMode) => void;
  readonly onMaterialMode: (mode: ViewerMaterialMode) => void;
  readonly onMove: (direction: WalkDirection) => void;
  readonly onReset: () => void;
  readonly onSectionEnabled: (enabled: boolean) => void;
  readonly onSectionHeight: (height: number) => void;
  readonly onToggleLevel: (elementId: string) => void;
  readonly sectionEnabled: boolean;
  readonly sectionHeightMm: number;
  readonly visibleLevelIds: ReadonlySet<string>;
}) {
  return (
    <div className="viewer-controls" aria-label="3D viewing controls">
      <fieldset>
        <legend>Navigation</legend>
        <label>
          <input
            checked={controlMode === "orbit"}
            name="viewer-control"
            onChange={() => {
              onControlMode("orbit");
            }}
            type="radio"
          />
          Orbit
        </label>
        <label>
          <input
            checked={controlMode === "walk"}
            name="viewer-control"
            onChange={() => {
              onControlMode("walk");
            }}
            type="radio"
          />
          Bounded walk
        </label>
      </fieldset>
      <div className="viewer-walk-controls" data-active={controlMode === "walk"}>
        <span>Walk buttons</span>
        <button
          aria-label="Walk forward"
          disabled={controlMode !== "walk"}
          onClick={() => {
            onMove("forward");
          }}
          type="button"
        >
          ↑
        </button>
        <button
          aria-label="Walk left"
          disabled={controlMode !== "walk"}
          onClick={() => {
            onMove("left");
          }}
          type="button"
        >
          ←
        </button>
        <button
          aria-label="Walk backward"
          disabled={controlMode !== "walk"}
          onClick={() => {
            onMove("backward");
          }}
          type="button"
        >
          ↓
        </button>
        <button
          aria-label="Walk right"
          disabled={controlMode !== "walk"}
          onClick={() => {
            onMove("right");
          }}
          type="button"
        >
          →
        </button>
        <small>
          Keyboard: W/A/S/D or arrow keys. Movement is clamped to model bounds and is not a
          route-safety claim.
        </small>
      </div>
      <label className="viewer-control-field">
        Material view
        <select
          onChange={(event) => {
            onMaterialMode(event.target.value as ViewerMaterialMode);
          }}
          value={materialMode}
        >
          <option value="material">Compiled materials</option>
          <option value="status">Mapping / finding status</option>
        </select>
      </label>
      <div className="viewer-section-control">
        <label>
          <input
            checked={sectionEnabled}
            onChange={(event) => {
              onSectionEnabled(event.target.checked);
            }}
            type="checkbox"
          />
          Section plane
        </label>
        <input
          aria-label="Section height"
          disabled={!sectionEnabled}
          max={manifest.boundsMm.maximum.zMm}
          min={manifest.boundsMm.minimum.zMm}
          onChange={(event) => {
            onSectionHeight(Number(event.target.value));
          }}
          step={50}
          type="range"
          value={sectionHeightMm}
        />
        <small>{sectionHeightMm.toLocaleString("en-GB")} mm</small>
      </div>
      <fieldset className="viewer-levels">
        <legend>Level visibility</legend>
        {levels.length === 0 ? (
          <span>No mapped level groups</span>
        ) : (
          levels.map((level) => (
            <label key={level.elementId}>
              <input
                checked={visibleLevelIds.has(level.elementId)}
                onChange={() => {
                  onToggleLevel(level.elementId);
                }}
                type="checkbox"
              />
              <code>{level.elementId}</code>
            </label>
          ))
        )}
      </fieldset>
      <ActionButton onClick={onReset}>Reset view</ActionButton>
    </div>
  );
}

function ViewerState({
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
    <PageContainer className="workspace-state">
      <section className="standalone-state" role="status">
        <h1>{title}</h1>
        <p>{message}</p>
        {actionHref ? (
          <Link className="ui-action" data-tone="primary" href={actionHref}>
            {actionLabel}
          </Link>
        ) : (
          <ActionButton onClick={() => void action?.()}>{actionLabel}</ActionButton>
        )}
      </section>
    </PageContainer>
  );
}
