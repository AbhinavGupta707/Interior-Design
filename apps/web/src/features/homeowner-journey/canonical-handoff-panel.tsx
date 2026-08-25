"use client";

import type {
  FusionOperationDraft,
  ModelBranch,
  ModelOperationsPreview,
  SceneJob,
} from "@interior-design/contracts";
import Link from "next/link";
import { useState } from "react";

import { ActionButton } from "../../components/ui-primitives";
import { EditorProblem, editorClient } from "../editor-2d/api";
import { SceneProblem, sceneClient } from "../viewer-3d/api";
import { exactSceneJobHref } from "../viewer-3d/deep-link";

import {
  commitPersistedDraftPreview,
  createSceneFromCommittedCurrent,
  HandoffProblem,
  previewPersistedDraft,
  type CanonicalCommitResult,
} from "./canonical-handoff";

type HandoffAction = "commit" | "preview" | "scene";

function shortHash(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function safeHandoffFailure(reason: unknown, action: HandoffAction): string {
  if (reason instanceof HandoffProblem) {
    if (reason.code === "PREVIEW_BLOCKED") {
      return "Blocking findings prevent confirmation. Nothing was committed; correct the proposal and rebuild the draft.";
    }
    if (reason.code === "PREVIEW_EXPIRED") {
      return "The preview expired. Nothing was committed; reload the branch and rebuild the draft and preview.";
    }
    if (reason.code === "CURRENT_SNAPSHOT_UNAVAILABLE") {
      return "The committed current profile is not available to C10 yet. Reload exact state before creating a scene.";
    }
    if (reason.code === "VIEWER_CANNOT_COMPILE") {
      return "Viewer access is read-only. An owner or editor must create the scene job.";
    }
    return "The exact draft and preview pins no longer match. Nothing was committed; reload and rebuild them.";
  }
  if (reason instanceof EditorProblem) {
    if (reason.kind === "conflict") {
      return "The branch revision or head changed. Nothing was committed; reload exact state and rebuild the draft and preview.";
    }
    if (reason.kind === "offline") {
      return "You appear to be offline. Nothing was committed; reconnect, reload and rebuild the exact preview.";
    }
    if (reason.kind === "forbidden" || reason.kind === "not-found") {
      return "This role cannot complete the canonical handoff. No model state was changed.";
    }
    if (reason.code?.includes("EXPIRED") === true) {
      return "The preview expired. Nothing was committed; reload the branch and rebuild the draft and preview.";
    }
  }
  if (reason instanceof SceneProblem) {
    if (reason.kind === "offline") {
      return "You appear to be offline. No scene job was created; reconnect and reload the current profile.";
    }
    if (reason.kind === "conflict") {
      return "The current scene source changed. No scene job was created; reload exact committed state.";
    }
    if (reason.kind === "forbidden" || reason.kind === "not-found") {
      return "This role cannot create a scene job. The committed model remains unchanged.";
    }
  }
  return action === "scene"
    ? "The scene job was not created. Reload the current committed profile before trying again."
    : action === "commit"
      ? "The correction commit was not created. Reload the branch and rebuild the exact draft and preview."
      : "The exact preview was not created. Reload the branch and rebuild the draft.";
}

export function CanonicalHandoffPanel({
  draft,
  editable,
  onCommitted,
  projectId,
}: {
  readonly draft: FusionOperationDraft;
  readonly editable: boolean;
  readonly onCommitted?: (branch: ModelBranch) => void;
  readonly projectId: string;
}) {
  const [busy, setBusy] = useState<HandoffAction>();
  const [preview, setPreview] = useState<ModelOperationsPreview>();
  const [commitResult, setCommitResult] = useState<CanonicalCommitResult>();
  const [sceneJob, setSceneJob] = useState<SceneJob>();
  const [alert, setAlert] = useState<string>();
  const [liveMessage, setLiveMessage] = useState("");
  const previewExpired = preview ? new Date(preview.expiresAt).getTime() <= Date.now() : false;
  const canCommit =
    editable &&
    preview !== undefined &&
    !preview.hasBlockingFindings &&
    !previewExpired &&
    commitResult === undefined &&
    busy === undefined;

  async function createPreview(): Promise<void> {
    if (!editable || busy) return;
    setBusy("preview");
    setAlert(undefined);
    setCommitResult(undefined);
    setSceneJob(undefined);
    try {
      const next = await previewPersistedDraft(editorClient, projectId, draft);
      setPreview(next);
      setLiveMessage(
        next.hasBlockingFindings
          ? "Preview complete with blocking findings. Confirmation is disabled."
          : "Preview complete. Review it before a separate confirmation action.",
      );
    } catch (reason) {
      setPreview(undefined);
      setAlert(safeHandoffFailure(reason, "preview"));
    } finally {
      setBusy(undefined);
    }
  }

  async function commitPreview(): Promise<void> {
    if (!preview || !canCommit) return;
    setBusy("commit");
    setAlert(undefined);
    try {
      const result = await commitPersistedDraftPreview(editorClient, projectId, draft, preview);
      setCommitResult(result);
      onCommitted?.(result.branch);
      setLiveMessage(
        `Corrections committed at revision ${String(result.commit.revision)}. No scene was created automatically.`,
      );
    } catch (reason) {
      setAlert(safeHandoffFailure(reason, "commit"));
    } finally {
      setBusy(undefined);
    }
  }

  async function createScene(): Promise<void> {
    if (!commitResult || !editable || busy) return;
    setBusy("scene");
    setAlert(undefined);
    try {
      const job = await createSceneFromCommittedCurrent(
        sceneClient,
        projectId,
        commitResult.commit,
      );
      setSceneJob(job);
      setLiveMessage(`Scene job ${job.id} created from the current committed C10 profile.`);
    } catch (reason) {
      setAlert(safeHandoffFailure(reason, "scene"));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <section className="canonical-handoff" aria-labelledby="canonical-handoff-title">
      <div aria-atomic="true" aria-live="polite" className="sr-only">
        {liveMessage}
      </div>
      <header>
        <div>
          <span className="fusion-eyebrow">04 · Safe canonical handoff</span>
          <h3 id="canonical-handoff-title">Preview, then explicitly confirm</h3>
          <p>
            Preview is non-mutating. Confirmation is a separate action using the unchanged branch
            revision and head-hash pins from this persisted C9 draft.
          </p>
        </div>
      </header>

      {alert ? (
        <div className="inline-alert" role="alert">
          <strong>Handoff stopped safely</strong>
          <span>{alert}</span>
        </div>
      ) : null}

      {!editable ? (
        <p className="read-only-note">
          Viewer access is read-only. Preview, commit and scene-creation controls are unavailable.
        </p>
      ) : (
        <div className="canonical-handoff__actions">
          <ActionButton
            disabled={busy !== undefined || commitResult !== undefined}
            onClick={() => void createPreview()}
            tone="secondary"
          >
            {busy === "preview" ? "Previewing exact draft…" : "Preview typed corrections"}
          </ActionButton>
        </div>
      )}

      {preview ? (
        <div
          className="canonical-preview"
          data-blocking={preview.hasBlockingFindings}
          role="status"
        >
          <header>
            <div>
              <strong>
                {preview.hasBlockingFindings ? "Preview blocked" : "Preview ready · not committed"}
              </strong>
              <span>{preview.findings.length} geometry finding(s)</span>
            </div>
            <span>
              {previewExpired
                ? "Expired"
                : `Expires ${new Date(preview.expiresAt).toLocaleString("en-GB")}`}
            </span>
          </header>
          <dl>
            <div>
              <dt>Base revision</dt>
              <dd>{preview.baseRevision}</dd>
            </div>
            <div>
              <dt>Base head hash</dt>
              <dd>
                <code>{shortHash(preview.baseHeadSnapshotSha256)}</code>
              </dd>
            </div>
            <div>
              <dt>Result hash</dt>
              <dd>
                <code>{preview.resultSnapshotSha256}</code>
              </dd>
            </div>
            <div>
              <dt>Blocking</dt>
              <dd>{preview.hasBlockingFindings ? "yes" : "no"}</dd>
            </div>
          </dl>
          {preview.findings.length > 0 ? (
            <ul className="canonical-findings">
              {preview.findings.map((finding, index) => (
                <li data-severity={finding.severity} key={`${finding.code}-${String(index)}`}>
                  <strong>
                    {finding.severity} · {finding.code}
                  </strong>
                  <span>{finding.message}</span>
                  {finding.affectedElementIds.length > 0 ? (
                    <small>{finding.affectedElementIds.length} affected element(s)</small>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p>No geometry findings were returned for this exact preview.</p>
          )}
          {editable && commitResult === undefined ? (
            <div className="canonical-confirmation">
              <div>
                <strong>Separate confirmation</strong>
                <span>
                  This commits only the preview above. Blocking or expired previews cannot be
                  confirmed.
                </span>
              </div>
              <ActionButton disabled={!canCommit} onClick={() => void commitPreview()}>
                {busy === "commit" ? "Committing exact preview…" : "Confirm corrections and commit"}
              </ActionButton>
            </div>
          ) : null}
        </div>
      ) : null}

      {commitResult ? (
        <div className="canonical-commit" role="status">
          <header>
            <div>
              <strong>Homeowner-confirmed exploration model</strong>
              <span>Committed successfully; no scene was created automatically.</span>
            </div>
            <span>Revision {commitResult.commit.revision}</span>
          </header>
          <dl>
            <div>
              <dt>Committed snapshot</dt>
              <dd>{commitResult.commit.snapshotId}</dd>
            </div>
            <div>
              <dt>Snapshot hash</dt>
              <dd>
                <code>{commitResult.commit.snapshotSha256}</code>
              </dd>
            </div>
          </dl>
          <p>
            This version is confirmed for homeowner exploration. It is not a measured survey,
            structural conclusion, regulatory approval or professionally issued record.
          </p>
          {editable && !sceneJob ? (
            <ActionButton
              disabled={busy !== undefined}
              onClick={() => void createScene()}
              tone="secondary"
            >
              {busy === "scene"
                ? "Creating exact scene job…"
                : "Create scene from current committed profile"}
            </ActionButton>
          ) : null}
        </div>
      ) : null}

      {sceneJob ? (
        <div className="canonical-scene" role="status">
          <div>
            <strong>Exact viewer job available</strong>
            <span>
              {sceneJob.state.replaceAll("-", " ")} · job {sceneJob.id}
            </span>
          </div>
          <Link
            className="ui-action"
            data-tone="primary"
            href={exactSceneJobHref(projectId, sceneJob.id)}
          >
            Open exact viewer job
          </Link>
          <p>
            The viewer remains read-only. If WebGL is unavailable it keeps the honest DOM/2D
            fallback instead of claiming an interactive canvas.
          </p>
        </div>
      ) : null}
    </section>
  );
}
