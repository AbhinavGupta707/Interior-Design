"use client";

import { editorCanCommit, editorCanPreview, editorFindingKey } from "@interior-design/editor-core";
import type { EditorSessionAction, EditorSessionState } from "@interior-design/editor-core";
import type {
  modelBranchComparisonSchema,
  modelOperationHistoryResponseSchema,
} from "@interior-design/contracts";
import type { ModelBranch } from "@interior-design/contracts";
import { useState } from "react";
import type { SyntheticEvent } from "react";
import type { z } from "zod";

import { formatDateTime, operationLabel, truncateHash } from "./presentation";

type OperationHistory = z.infer<typeof modelOperationHistoryResponseSchema>;
type BranchComparison = z.infer<typeof modelBranchComparisonSchema>;

interface SessionPanelProps {
  readonly alert: string | undefined;
  readonly busy: boolean;
  readonly dispatch: (action: EditorSessionAction) => void;
  readonly onCommit: (message: string) => Promise<void>;
  readonly onConflictReload: () => Promise<void>;
  readonly onConflictReapply: () => Promise<void>;
  readonly onPreview: () => Promise<void>;
  readonly state: EditorSessionState;
}

export function SessionPanel({
  alert,
  busy,
  dispatch,
  onCommit,
  onConflictReload,
  onConflictReapply,
  onPreview,
  state,
}: SessionPanelProps) {
  const [commitMessage, setCommitMessage] = useState("Commit structured editor changes");
  const previewExpired = state.preview
    ? new Date(state.preview.expiresAt).getTime() <= Date.now()
    : false;

  function submitCommit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>): void {
    event.preventDefault();
    void onCommit(commitMessage);
  }

  return (
    <section className="editor-session" aria-labelledby="pending-title">
      <header>
        <div>
          <span>Local session</span>
          <h2 id="pending-title">Pending commands</h2>
        </div>
        <strong>{state.pending.length} / 50</strong>
      </header>
      <div aria-label="Pending command controls" className="editor-session__controls">
        <button
          disabled={state.pending.length === 0 || busy}
          onClick={() => {
            dispatch({ type: "command.undo" });
          }}
          type="button"
        >
          Undo
        </button>
        <button
          disabled={state.redo.length === 0 || busy}
          onClick={() => {
            dispatch({ type: "command.redo" });
          }}
          type="button"
        >
          Redo
        </button>
        <button
          disabled={state.pending.length === 0 || busy}
          onClick={() => {
            dispatch({ type: "session.discard" });
          }}
          type="button"
        >
          Discard
        </button>
      </div>
      {state.pending.length === 0 ? (
        <p className="editor-session__empty">
          No uncommitted intent. Select an element and use the inspector.
        </p>
      ) : (
        <ol className="editor-command-list">
          {state.pending.map((operation) => (
            <li key={operation.clientOperationId}>
              <strong>{operationLabel(operation)}</strong>
              <span>{operation.reason}</span>
              <code>{operation.clientOperationId.slice(0, 8)}</code>
            </li>
          ))}
        </ol>
      )}
      {state.conflict ? (
        <div className="editor-conflict" role="alert">
          <strong>Branch changed before your commit</strong>
          <p>
            {state.conflict.detail} Your {state.pending.length} local command
            {state.pending.length === 1 ? "" : "s"} remain in memory.
          </p>
          <dl>
            <div>
              <dt>Current revision</dt>
              <dd>{state.conflict.currentRevision}</dd>
            </div>
            <div>
              <dt>Current head</dt>
              <dd>
                <code>{truncateHash(state.conflict.currentHeadSnapshotSha256)}</code>
              </dd>
            </div>
          </dl>
          <div className="editor-conflict__actions">
            <button disabled={busy} onClick={() => void onConflictReload()} type="button">
              Reload current head
            </button>
            <button disabled={busy} onClick={() => void onConflictReapply()} type="button">
              Reapply retained intent
            </button>
            <a href="#history-title">Compare branches</a>
          </div>
        </div>
      ) : null}
      {alert ? (
        <p className="editor-session__alert" role="alert">
          {alert}
        </p>
      ) : null}
      {state.preview ? (
        <div className="editor-preview-summary" role="status">
          <strong>{previewExpired ? "Preview expired" : "Preview ready"}</strong>
          <span>Result {truncateHash(state.preview.resultSnapshotSha256)}</span>
          <span>{state.preview.canonicalByteLength.toLocaleString("en-GB")} canonical bytes</span>
          <span>Expires {formatDateTime(state.preview.expiresAt)}</span>
        </div>
      ) : null}
      {state.findings.length > 0 ? (
        <section className="editor-findings" aria-labelledby="findings-title">
          <h3 id="findings-title">Validation findings ({state.findings.length})</h3>
          <ul>
            {state.findings.map((finding) => {
              const key = editorFindingKey(finding);
              const acknowledged = state.acknowledgedWarningKeys.includes(key);
              return (
                <li data-severity={finding.severity} key={key}>
                  <strong>
                    {finding.severity}: {finding.code}
                  </strong>
                  <span>{finding.message}</span>
                  {finding.affectedElementIds.length > 0 ? (
                    <small>
                      Affects {finding.affectedElementIds.map((id) => id.slice(0, 8)).join(", ")}
                    </small>
                  ) : null}
                  {finding.severity === "warning" ? (
                    <label>
                      <input
                        checked={acknowledged}
                        onChange={() => {
                          dispatch({ findingKey: key, type: "warning.acknowledge" });
                        }}
                        type="checkbox"
                      />
                      <span>Acknowledge this warning before commit</span>
                    </label>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      <div className="editor-session__actions">
        <button
          className="editor-preview-action"
          disabled={!editorCanPreview(state) || busy}
          onClick={() => void onPreview()}
          type="button"
        >
          {state.phase === "previewing"
            ? "Previewing…"
            : previewExpired
              ? "Preview again"
              : "Preview changes"}
        </button>
        <form onSubmit={submitCommit}>
          <label>
            <span>Commit message</span>
            <input
              disabled={busy}
              maxLength={500}
              onChange={(event) => {
                setCommitMessage(event.target.value);
              }}
              required
              value={commitMessage}
            />
          </label>
          <button
            className="editor-commit-action"
            disabled={!editorCanCommit(state) || busy || commitMessage.trim().length === 0}
            type="submit"
          >
            {state.phase === "committing" ? "Committing…" : "Commit exact preview"}
          </button>
        </form>
      </div>
    </section>
  );
}

interface HistoryPanelProps {
  readonly activeBranch: ModelBranch;
  readonly branches: readonly ModelBranch[];
  readonly busy: boolean;
  readonly comparison: BranchComparison | undefined;
  readonly editable: boolean;
  readonly history: OperationHistory;
  readonly onCompare: (targetBranchId: string) => Promise<void>;
  readonly onLoadMore: () => Promise<void>;
  readonly onRestoreSource: () => Promise<void>;
}

export function HistoryPanel({
  activeBranch,
  branches,
  busy,
  comparison,
  editable,
  history,
  onCompare,
  onLoadMore,
  onRestoreSource,
}: HistoryPanelProps) {
  const targets = branches.filter(({ id }) => id !== activeBranch.id);
  const [targetBranchId, setTargetBranchId] = useState(targets[0]?.id ?? "");

  return (
    <section className="editor-history" aria-labelledby="history-title">
      <header>
        <div>
          <span>Immutable record</span>
          <h2 id="history-title">History and comparison</h2>
        </div>
        <code>Source {activeBranch.sourceSnapshotId.slice(0, 8)}</code>
      </header>
      <div className="editor-history__grid">
        <section aria-labelledby="operations-title">
          <h3 id="operations-title">Operation history</h3>
          {history.operations.length === 0 ? (
            <p>No committed operations are recorded on this branch.</p>
          ) : (
            <ol className="editor-history-list">
              {history.operations.map((operation) => (
                <li key={operation.id}>
                  <strong>{operation.type}</strong>
                  <span>
                    Revision {operation.revision} · position {operation.ordinal + 1}
                  </span>
                  <small>
                    {formatDateTime(operation.committedAt)} · actor{" "}
                    {operation.committedBy.slice(0, 8)}
                  </small>
                </li>
              ))}
            </ol>
          )}
          {history.nextCursor ? (
            <button
              className="editor-secondary-action"
              disabled={busy}
              onClick={() => void onLoadMore()}
              type="button"
            >
              Load more history
            </button>
          ) : null}
        </section>
        <section aria-labelledby="compare-title">
          <h3 id="compare-title">Compare exact branch heads</h3>
          {targets.length === 0 ? (
            <p>Create another branch before comparing stable element IDs.</p>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void onCompare(targetBranchId);
              }}
            >
              <label>
                <span>Target branch</span>
                <select
                  onChange={(event) => {
                    setTargetBranchId(event.target.value);
                  }}
                  value={targetBranchId}
                >
                  {targets.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name} · r{branch.revision}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="editor-secondary-action"
                disabled={busy || !targetBranchId}
                type="submit"
              >
                Compare heads
              </button>
            </form>
          )}
          {comparison ? (
            <div className="editor-comparison" role="status">
              <strong>
                {comparison.changes.length} stable-ID change
                {comparison.changes.length === 1 ? "" : "s"}
              </strong>
              <span>
                {comparison.truncated
                  ? "Result is explicitly truncated."
                  : "Complete bounded response."}
              </span>
              <ul>
                {comparison.changes.slice(0, 25).map((change) => (
                  <li key={`${change.kind}-${change.elementId}`}>
                    <span>{change.kind}</span>
                    <code>{change.elementId}</code>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {editable ? (
            <div className="editor-restore">
              <h3>Restore without rewriting history</h3>
              <p>
                Restore the exact branch source as a new immutable revision. Existing commits remain
                intact.
              </p>
              <button
                className="editor-danger-action"
                disabled={busy}
                onClick={() => void onRestoreSource()}
                type="button"
              >
                Restore branch source
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </section>
  );
}
