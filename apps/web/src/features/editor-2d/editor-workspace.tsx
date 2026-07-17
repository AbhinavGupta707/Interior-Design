"use client";

import {
  createEditorSession,
  defaultEditorSnapGridMm,
  editorSessionReducer,
  editorSnapGridsMm,
  isEditorSnapGridMm,
  projectCanonicalSnapshotToPlan,
  selectCanonicalElement,
} from "@interior-design/editor-core";
import type {
  EditorSessionAction,
  EditorSessionState,
  EditorSnapGridMm,
} from "@interior-design/editor-core";
import {
  modelOperationHistoryResponseSchema,
  modelProfileSchema,
} from "@interior-design/contracts";
import type {
  MemberRole,
  ModelBranch,
  ModelOperationRequest,
  ModelProfile,
  ModelSnapshotRecord,
  Session,
} from "@interior-design/contracts";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SyntheticEvent } from "react";
import type { z } from "zod";

import { ActionButton, LoadingIndicator, PageContainer } from "../../components/ui-primitives";
import { ClientProblem, getSession } from "../auth/api";
import { editorClient, EditorProblem } from "./api";
import type { EditorBranchComparison, EditorBranchWorkspace } from "./contracts";
import { EditorInspector } from "./inspector";
import { ElementList, PlanView } from "./plan-view";
import { formatDateTime, truncateHash } from "./presentation";
import { HistoryPanel, SessionPanel } from "./session-panel";

type OperationHistory = z.infer<typeof modelOperationHistoryResponseSchema>;
type LoadState =
  | { readonly kind: "empty" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "expired" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "loading" }
  | { readonly kind: "offline" }
  | { readonly kind: "ready" };

interface EditorWorkspaceProps {
  readonly projectId: string;
}

function emptyHistory(): OperationHistory {
  return modelOperationHistoryResponseSchema.parse({ operations: [] });
}

function roleCanEdit(role: MemberRole): boolean {
  return role === "owner" || role === "editor";
}

function loadStateFrom(reason: unknown): LoadState {
  if (reason instanceof EditorProblem || reason instanceof ClientProblem) {
    if (reason.kind === "expired") return { kind: "expired" };
    if (reason.kind === "forbidden" || reason.kind === "not-found") return { kind: "forbidden" };
    if (reason.kind === "offline") return { kind: "offline" };
    return { kind: "error", message: reason.message };
  }
  return { kind: "error", message: "The 2D editor could not be loaded." };
}

async function optionalCurrentSnapshot(
  projectId: string,
  profile: ModelProfile,
): Promise<ModelSnapshotRecord | undefined> {
  try {
    return await editorClient.getCurrentSnapshot(projectId, profile);
  } catch (reason) {
    if (reason instanceof EditorProblem && reason.kind === "not-found") return undefined;
    throw reason;
  }
}

export function EditorWorkspace({ projectId }: EditorWorkspaceProps) {
  const [profile, setProfile] = useState<ModelProfile>("existing");
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [session, setSession] = useState<Session>();
  const [sourceSnapshot, setSourceSnapshot] = useState<ModelSnapshotRecord>();
  const [branches, setBranches] = useState<ModelBranch[]>([]);
  const [workspace, setWorkspace] = useState<EditorBranchWorkspace>();
  const [history, setHistory] = useState<OperationHistory>(emptyHistory);
  const [localSession, setLocalSession] = useState<EditorSessionState>();
  const [selectedLevelId, setSelectedLevelId] = useState<string>();
  const [selectedElementId, setSelectedElementId] = useState<string>();
  const [snapGridMm, setSnapGridMm] = useState<EditorSnapGridMm>(defaultEditorSnapGridMm);
  const [comparison, setComparison] = useState<EditorBranchComparison>();
  const [busy, setBusy] = useState(false);
  const [asyncMessage, setAsyncMessage] = useState("");
  const [alert, setAlert] = useState<string>();

  const dispatch = useCallback((action: EditorSessionAction) => {
    setLocalSession((current) => (current ? editorSessionReducer(current, action) : current));
  }, []);

  const installWorkspace = useCallback(
    (
      nextWorkspace: EditorBranchWorkspace,
      nextHistory: OperationHistory,
      resetLocalSession: boolean,
    ) => {
      setWorkspace(nextWorkspace);
      setSourceSnapshot(nextWorkspace.sourceSnapshot);
      setHistory(nextHistory);
      setSelectedLevelId(nextWorkspace.headSnapshot.snapshot.elements.levels[0]?.id);
      setSelectedElementId(undefined);
      setComparison(undefined);
      if (resetLocalSession) {
        setLocalSession(
          createEditorSession({
            headSnapshotSha256: nextWorkspace.branch.headSnapshotSha256,
            revision: nextWorkspace.branch.revision,
          }),
        );
      }
    },
    [],
  );

  const loadOverview = useCallback(
    async (nextProfile: ModelProfile, preferredBranchId?: string) => {
      setLoadState({ kind: "loading" });
      setAlert(undefined);
      try {
        const [nextSession, nextBranches, nextSource] = await Promise.all([
          getSession(),
          editorClient.listBranches(projectId, nextProfile),
          optionalCurrentSnapshot(projectId, nextProfile),
        ]);
        setSession(nextSession);
        setBranches(nextBranches);
        setSourceSnapshot(nextSource);
        const branch = nextBranches.find(({ id }) => id === preferredBranchId) ?? nextBranches[0];
        if (!branch) {
          setWorkspace(undefined);
          setLocalSession(undefined);
          setHistory(emptyHistory());
          setLoadState({ kind: "empty" });
          return;
        }
        const [nextWorkspace, nextHistory] = await Promise.all([
          editorClient.loadBranch(projectId, nextProfile, branch.id),
          editorClient.listHistory(projectId, nextProfile, branch.id),
        ]);
        installWorkspace(nextWorkspace, nextHistory, true);
        setLoadState({ kind: "ready" });
      } catch (reason) {
        setLoadState(loadStateFrom(reason));
      }
    },
    [installWorkspace, projectId],
  );

  useEffect(() => {
    void loadOverview(profile);
  }, [loadOverview, profile]);

  const plan = useMemo(
    () =>
      workspace
        ? projectCanonicalSnapshotToPlan(workspace.headSnapshot.snapshot, {
            ...(selectedElementId ? { selectedElementId } : {}),
            ...(selectedLevelId ? { levelId: selectedLevelId } : {}),
          })
        : undefined,
    [selectedElementId, selectedLevelId, workspace],
  );
  const selection = useMemo(
    () =>
      workspace
        ? selectCanonicalElement(workspace.headSnapshot.snapshot, selectedElementId)
        : undefined,
    [selectedElementId, workspace],
  );
  const editable = session ? roleCanEdit(session.actor.role) : false;

  async function loadBranch(branchId: string, resetLocalSession = true): Promise<void> {
    setBusy(true);
    setAlert(undefined);
    try {
      const [nextWorkspace, nextHistory] = await Promise.all([
        editorClient.loadBranch(projectId, profile, branchId),
        editorClient.listHistory(projectId, profile, branchId),
      ]);
      installWorkspace(nextWorkspace, nextHistory, resetLocalSession);
      setBranches((current) =>
        current.map((branch) =>
          branch.id === nextWorkspace.branch.id ? nextWorkspace.branch : branch,
        ),
      );
      setLoadState({ kind: "ready" });
      setAsyncMessage(
        `Loaded ${nextWorkspace.branch.name}, revision ${String(nextWorkspace.branch.revision)}.`,
      );
    } catch (reason) {
      if (reason instanceof EditorProblem && reason.kind === "expired") {
        setLoadState({ kind: "expired" });
      } else {
        setAlert(reason instanceof Error ? reason.message : "The branch could not be loaded.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function createBranch(event: SyntheticEvent<HTMLFormElement, SubmitEvent>): Promise<void> {
    event.preventDefault();
    if (!sourceSnapshot) return;
    setBusy(true);
    setAlert(undefined);
    try {
      const form = new FormData(event.currentTarget);
      const name = form.get("name");
      if (typeof name !== "string") throw new Error("A branch name is required.");
      const branch = await editorClient.createBranch(projectId, profile, {
        name: name.trim(),
        sourceSnapshotId: sourceSnapshot.id,
        sourceSnapshotSha256: sourceSnapshot.snapshotSha256,
      });
      await loadOverview(profile, branch.id);
      setAsyncMessage(`Created ${branch.name} from the exact source snapshot.`);
    } catch (reason) {
      setAlert(reason instanceof Error ? reason.message : "The branch could not be created.");
    } finally {
      setBusy(false);
    }
  }

  function appendCommand(operation: ModelOperationRequest): void {
    try {
      dispatch({ operation, type: "command.append" });
      setAlert(undefined);
      setAsyncMessage(`Added ${operation.type} to the local pending session.`);
    } catch (reason) {
      setAlert(reason instanceof Error ? reason.message : "The command could not be added.");
    }
  }

  function receiveConflict(reason: EditorProblem): boolean {
    if (
      reason.kind !== "conflict" ||
      reason.currentRevision === undefined ||
      !reason.currentHeadSnapshotSha256
    ) {
      return false;
    }
    dispatch({
      conflict: {
        currentHeadSnapshotSha256: reason.currentHeadSnapshotSha256,
        currentRevision: reason.currentRevision,
        detail: reason.message,
      },
      type: "conflict.received",
    });
    setAsyncMessage("The branch changed. Local intent is retained for recovery.");
    return true;
  }

  async function preview(): Promise<void> {
    if (!workspace || !localSession) return;
    dispatch({ type: "preview.requested" });
    setBusy(true);
    setAlert(undefined);
    try {
      const result = await editorClient.preview(
        projectId,
        profile,
        workspace.branch.id,
        localSession.pending,
        localSession.base.revision,
        localSession.base.headSnapshotSha256,
      );
      dispatch({ preview: result, type: "preview.received" });
      setAsyncMessage(
        `Preview ready with ${String(result.findings.length)} validation finding${result.findings.length === 1 ? "" : "s"}.`,
      );
    } catch (reason) {
      if (!(reason instanceof EditorProblem && receiveConflict(reason))) {
        dispatch({ type: "preview.failed" });
        setAlert(reason instanceof Error ? reason.message : "The preview could not be created.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function commit(message: string): Promise<void> {
    if (!workspace || !localSession?.preview) return;
    dispatch({ type: "commit.requested" });
    setBusy(true);
    setAlert(undefined);
    try {
      const result = await editorClient.commit(projectId, profile, workspace.branch.id, {
        commitMessage: message,
        expectedHeadSnapshotSha256: localSession.base.headSnapshotSha256,
        expectedRevision: localSession.base.revision,
        previewId: localSession.preview.id,
      });
      dispatch({
        base: {
          headSnapshotSha256: result.branch.headSnapshotSha256,
          revision: result.branch.revision,
        },
        type: "commit.succeeded",
      });
      await loadBranch(result.branch.id, true);
      setAsyncMessage(
        `Committed revision ${String(result.branch.revision)}. History was appended without rewriting earlier revisions.`,
      );
    } catch (reason) {
      if (!(reason instanceof EditorProblem && receiveConflict(reason))) {
        setAlert(reason instanceof Error ? reason.message : "The preview could not be committed.");
        dispatch({ type: "preview.failed" });
      }
    } finally {
      setBusy(false);
    }
  }

  async function reloadConflictHead(): Promise<void> {
    if (!workspace) return;
    await loadBranch(workspace.branch.id, false);
    setAsyncMessage("Current head loaded. Pending local intent is still retained.");
  }

  async function reapplyConflictIntent(): Promise<void> {
    if (!workspace) return;
    setBusy(true);
    try {
      const latest = await editorClient.loadBranch(projectId, profile, workspace.branch.id);
      setWorkspace(latest);
      dispatch({
        base: {
          headSnapshotSha256: latest.branch.headSnapshotSha256,
          revision: latest.branch.revision,
        },
        type: "conflict.reapply",
      });
      setAsyncMessage(
        "Retained commands now target the current head. Preview them again before commit.",
      );
    } catch (reason) {
      setAlert(reason instanceof Error ? reason.message : "The current head could not be loaded.");
    } finally {
      setBusy(false);
    }
  }

  async function compare(targetBranchId: string): Promise<void> {
    if (!workspace) return;
    setBusy(true);
    setAlert(undefined);
    try {
      const nextComparison = await editorClient.compare(
        projectId,
        profile,
        workspace.branch.id,
        targetBranchId,
      );
      setComparison(nextComparison);
      setAsyncMessage(
        `Comparison returned ${String(nextComparison.changes.length)} stable-ID changes.`,
      );
    } catch (reason) {
      setAlert(reason instanceof Error ? reason.message : "The branches could not be compared.");
    } finally {
      setBusy(false);
    }
  }

  async function loadMoreHistory(): Promise<void> {
    if (!workspace || !history.nextCursor) return;
    setBusy(true);
    try {
      const nextPage = await editorClient.listHistory(
        projectId,
        profile,
        workspace.branch.id,
        history.nextCursor,
      );
      setHistory({
        ...(nextPage.nextCursor ? { nextCursor: nextPage.nextCursor } : {}),
        operations: [...history.operations, ...nextPage.operations],
      });
    } catch (reason) {
      setAlert(reason instanceof Error ? reason.message : "More history could not be loaded.");
    } finally {
      setBusy(false);
    }
  }

  async function restoreSource(): Promise<void> {
    if (!workspace) return;
    setBusy(true);
    setAlert(undefined);
    try {
      const result = await editorClient.restore(projectId, profile, workspace.branch.id, {
        expectedHeadSnapshotSha256: workspace.branch.headSnapshotSha256,
        expectedRevision: workspace.branch.revision,
        reason: "Restore the exact immutable branch source from the 2D editor",
        sourceSnapshotId: workspace.sourceSnapshot.id,
        sourceSnapshotSha256: workspace.sourceSnapshot.snapshotSha256,
      });
      await loadBranch(result.branch.id, true);
      setAsyncMessage(
        `Restored the branch source as new revision ${String(result.branch.revision)}.`,
      );
    } catch (reason) {
      if (!(reason instanceof EditorProblem && receiveConflict(reason))) {
        setAlert(
          reason instanceof Error ? reason.message : "The source snapshot could not be restored.",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  if (loadState.kind === "loading") {
    return (
      <PageContainer className="editor-state">
        <LoadingIndicator label="Loading exact branch and snapshot data" />
      </PageContainer>
    );
  }
  if (loadState.kind === "expired") {
    return (
      <EditorState
        title="Your session has expired"
        message="Sign in again. No pending command was submitted by this page state."
        actionLabel="Sign in again"
        actionHref="/sign-in"
      />
    );
  }
  if (loadState.kind === "forbidden") {
    return (
      <EditorState
        title="Editor unavailable"
        message="This project or branch is not available to the current tenant and role."
        actionLabel="Return to projects"
        actionHref="/projects"
      />
    );
  }
  if (loadState.kind === "offline") {
    return (
      <EditorState
        title="You’re offline"
        message="Reconnect to load exact branch state. No local command has been sent."
        actionLabel="Retry"
        action={() => loadOverview(profile)}
      />
    );
  }
  if (loadState.kind === "error") {
    return (
      <EditorState
        title="Editor could not be loaded"
        message={loadState.message}
        actionLabel="Retry"
        action={() => loadOverview(profile)}
      />
    );
  }
  if (!session) return null;

  if (loadState.kind === "empty" || !workspace || !plan || !localSession) {
    return (
      <PageContainer className="editor-empty-state">
        <Link className="back-link" href="/projects">
          ← Projects
        </Link>
        <span>2D model editor</span>
        <h1>{sourceSnapshot ? "Create the first branch" : "No canonical model yet"}</h1>
        <p>
          {sourceSnapshot
            ? "A branch pins one exact immutable snapshot before any typed operation can be previewed."
            : "This profile has no canonical snapshot. C5 does not fabricate a model; create or import one through the canonical model workflow first."}
        </p>
        {alert ? (
          <p className="editor-session__alert" role="alert">
            {alert}
          </p>
        ) : null}
        {sourceSnapshot && editable ? (
          <form onSubmit={(event) => void createBranch(event)}>
            <label>
              <span>Branch name</span>
              <input defaultValue="Main study" maxLength={80} name="name" required />
            </label>
            <dl>
              <div>
                <dt>Source snapshot</dt>
                <dd>
                  <code>{sourceSnapshot.id}</code>
                </dd>
              </div>
              <div>
                <dt>SHA-256</dt>
                <dd>
                  <code>{sourceSnapshot.snapshotSha256}</code>
                </dd>
              </div>
            </dl>
            <ActionButton disabled={busy} type="submit">
              {busy ? "Creating…" : "Create exact branch"}
            </ActionButton>
          </form>
        ) : sourceSnapshot ? (
          <div className="editor-readonly-note" role="note">
            <strong>Viewer access is read-only</strong>
            <span>An owner or editor must create the first branch.</span>
          </div>
        ) : null}
      </PageContainer>
    );
  }

  return (
    <PageContainer className="editor-workspace">
      <p aria-live="polite" className="editor-live-region">
        {asyncMessage}
      </p>
      <header className="editor-heading">
        <div>
          <Link className="back-link" href="/projects">
            ← Projects
          </Link>
          <h1>2D model editor</h1>
          <p>Previewable typed operations against one exact canonical branch head.</p>
        </div>
        <div className="editor-role" data-readonly={!editable}>
          <strong>{session.actor.displayName}</strong>
          <span>
            {session.actor.role} · {editable ? "editing enabled" : "read-only"}
          </span>
        </div>
      </header>

      <section className="editor-branch-metadata" aria-label="Exact branch state">
        <dl>
          <div>
            <dt>Branch</dt>
            <dd>{workspace.branch.name}</dd>
          </div>
          <div>
            <dt>Revision</dt>
            <dd>{workspace.branch.revision}</dd>
          </div>
          <div>
            <dt>Profile</dt>
            <dd>{workspace.branch.profile}</dd>
          </div>
          <div>
            <dt>Head snapshot</dt>
            <dd>
              <code title={workspace.branch.headSnapshotId}>
                {workspace.branch.headSnapshotId.slice(0, 8)}
              </code>
            </dd>
          </div>
          <div>
            <dt>Head SHA-256</dt>
            <dd>
              <code title={workspace.branch.headSnapshotSha256}>
                {truncateHash(workspace.branch.headSnapshotSha256)}
              </code>
            </dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{formatDateTime(workspace.branch.updatedAt)}</dd>
          </div>
          <div>
            <dt>Units</dt>
            <dd>integer mm</dd>
          </div>
        </dl>
      </section>

      <section className="editor-toolbar" aria-label="Editor view controls">
        <label>
          <span>Profile</span>
          <select
            onChange={(event) => {
              setProfile(modelProfileSchema.parse(event.target.value));
            }}
            value={profile}
          >
            {modelProfileSchema.options.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Branch</span>
          <select
            disabled={busy}
            onChange={(event) => void loadBranch(event.target.value)}
            value={workspace.branch.id}
          >
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name} · r{branch.revision}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Level</span>
          <select
            onChange={(event) => {
              setSelectedLevelId(event.target.value);
              setSelectedElementId(undefined);
            }}
            value={plan.levelId}
          >
            {plan.levels.map((level) => (
              <option key={level.id} value={level.id}>
                {level.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Snap assistance</span>
          <select
            onChange={(event) => {
              const next = Number(event.target.value);
              if (isEditorSnapGridMm(next)) setSnapGridMm(next);
            }}
            value={snapGridMm}
          >
            {editorSnapGridsMm.map((grid) => (
              <option key={grid} value={grid}>
                {grid} mm
              </option>
            ))}
          </select>
        </label>
        <span className="editor-toolbar__note">
          Snap is local preview assistance; the server validates exact submitted integers.
        </span>
      </section>

      {alert ? (
        <p className="editor-global-alert" role="alert">
          {alert}
        </p>
      ) : null}
      <div className="editor-primary-grid">
        <ElementList onSelect={setSelectedElementId} plan={plan} />
        <PlanView onSelect={setSelectedElementId} plan={plan} />
        <EditorInspector
          actorUserId={session.actor.userId}
          editable={editable}
          onCommand={appendCommand}
          selection={selection}
          snapGridMm={snapGridMm}
          snapshot={workspace.headSnapshot.snapshot}
        />
      </div>

      <section className="editor-limitations" aria-labelledby="limitations-title">
        <header>
          <span>Epistemic boundary</span>
          <h2 id="limitations-title">Known limitations</h2>
        </header>
        <ul>
          {workspace.headSnapshot.snapshot.knownLimitations.map((limitation) => (
            <li key={`${limitation.code}-${limitation.detail}`}>
              <strong>{limitation.code}</strong>
              <span>{limitation.detail}</span>
            </li>
          ))}
        </ul>
      </section>

      {editable ? (
        <SessionPanel
          alert={alert}
          busy={busy}
          dispatch={dispatch}
          onCommit={commit}
          onConflictReload={reloadConflictHead}
          onConflictReapply={reapplyConflictIntent}
          onPreview={preview}
          state={localSession}
        />
      ) : null}
      <HistoryPanel
        activeBranch={workspace.branch}
        branches={branches}
        busy={busy}
        comparison={comparison}
        editable={editable}
        history={history}
        onCompare={compare}
        onLoadMore={loadMoreHistory}
        onRestoreSource={restoreSource}
      />
    </PageContainer>
  );
}

interface EditorStateProps {
  readonly action?: () => Promise<void>;
  readonly actionHref?: string;
  readonly actionLabel: string;
  readonly message: string;
  readonly title: string;
}

function EditorState({ action, actionHref, actionLabel, message, title }: EditorStateProps) {
  return (
    <PageContainer className="editor-state">
      <section className="standalone-state">
        <h1>{title}</h1>
        <p>{message}</p>
        {actionHref ? (
          <Link className="ui-action" data-tone="primary" href={actionHref}>
            {actionLabel}
          </Link>
        ) : null}
        {action ? <ActionButton onClick={() => void action()}>{actionLabel}</ActionButton> : null}
      </section>
    </PageContainer>
  );
}
