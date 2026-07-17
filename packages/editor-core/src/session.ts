import type { ModelOperationRequest, ModelOperationsPreview } from "@interior-design/contracts";

export const maximumPendingEditorCommands = 50;
export type EditorFinding = ModelOperationsPreview["findings"][number];

export interface EditorConflict {
  readonly currentHeadSnapshotSha256: string;
  readonly currentRevision: number;
  readonly detail: string;
}

export interface EditorSessionBase {
  readonly headSnapshotSha256: string;
  readonly revision: number;
}

export type EditorSessionPhase =
  "clean" | "editing" | "previewing" | "preview-ready" | "committing" | "conflict";

export interface EditorSessionState {
  readonly acknowledgedWarningKeys: readonly string[];
  readonly base: EditorSessionBase;
  readonly conflict?: EditorConflict;
  readonly findings: readonly EditorFinding[];
  readonly pending: readonly ModelOperationRequest[];
  readonly phase: EditorSessionPhase;
  readonly preview?: ModelOperationsPreview;
  readonly redo: readonly ModelOperationRequest[];
}

export type EditorSessionAction =
  | { readonly operation: ModelOperationRequest; readonly type: "command.append" }
  | { readonly type: "command.undo" }
  | { readonly type: "command.redo" }
  | { readonly type: "session.discard" }
  | { readonly type: "preview.requested" }
  | { readonly preview: ModelOperationsPreview; readonly type: "preview.received" }
  | { readonly findings?: readonly EditorFinding[]; readonly type: "preview.failed" }
  | { readonly findingKey: string; readonly type: "warning.acknowledge" }
  | { readonly type: "commit.requested" }
  | { readonly base: EditorSessionBase; readonly type: "commit.succeeded" }
  | { readonly conflict: EditorConflict; readonly type: "conflict.received" }
  | { readonly base: EditorSessionBase; readonly type: "conflict.reapply" };

export function createEditorSession(base: EditorSessionBase): EditorSessionState {
  return Object.freeze({
    acknowledgedWarningKeys: Object.freeze([]),
    base: Object.freeze({ ...base }),
    findings: Object.freeze([]),
    pending: Object.freeze([]),
    phase: "clean",
    redo: Object.freeze([]),
  });
}

function invalidatePreview(
  state: EditorSessionState,
  pending: readonly ModelOperationRequest[],
  redo: readonly ModelOperationRequest[],
): EditorSessionState {
  return {
    acknowledgedWarningKeys: [],
    base: state.base,
    findings: [],
    pending,
    phase: pending.length === 0 ? "clean" : "editing",
    redo,
  };
}

export function editorFindingKey(finding: EditorFinding): string {
  return [
    finding.severity,
    finding.code,
    ...finding.affectedElementIds,
    finding.location?.levelId ?? "",
    finding.location?.xMm ?? "",
    finding.location?.yMm ?? "",
  ].join(":");
}

export function editorSessionReducer(
  state: EditorSessionState,
  action: EditorSessionAction,
): EditorSessionState {
  switch (action.type) {
    case "command.append": {
      if (state.pending.length >= maximumPendingEditorCommands) {
        throw new RangeError("An editor session cannot hold more than 50 pending commands.");
      }
      if (
        state.pending.some(
          ({ clientOperationId }) => clientOperationId === action.operation.clientOperationId,
        )
      ) {
        throw new Error("Pending command IDs must be unique within an editor session.");
      }
      return invalidatePreview(state, [...state.pending, action.operation], []);
    }
    case "command.undo": {
      const operation = state.pending.at(-1);
      if (!operation) return state;
      return invalidatePreview(state, state.pending.slice(0, -1), [...state.redo, operation]);
    }
    case "command.redo": {
      const operation = state.redo.at(-1);
      if (!operation || state.pending.length >= maximumPendingEditorCommands) return state;
      return invalidatePreview(state, [...state.pending, operation], state.redo.slice(0, -1));
    }
    case "session.discard":
      return createEditorSession(state.base);
    case "preview.requested":
      return {
        acknowledgedWarningKeys: state.acknowledgedWarningKeys,
        base: state.base,
        findings: state.findings,
        pending: state.pending,
        phase: "previewing",
        redo: state.redo,
      };
    case "preview.received":
      return {
        acknowledgedWarningKeys: [],
        base: state.base,
        findings: action.preview.findings,
        pending: state.pending,
        phase: "preview-ready",
        preview: action.preview,
        redo: state.redo,
      };
    case "preview.failed":
      return {
        acknowledgedWarningKeys: state.acknowledgedWarningKeys,
        base: state.base,
        findings: action.findings ?? [],
        pending: state.pending,
        phase: state.pending.length === 0 ? "clean" : "editing",
        redo: state.redo,
      };
    case "warning.acknowledge":
      return state.acknowledgedWarningKeys.includes(action.findingKey)
        ? state
        : {
            ...state,
            acknowledgedWarningKeys: [...state.acknowledgedWarningKeys, action.findingKey],
          };
    case "commit.requested":
      return { ...state, phase: "committing" };
    case "commit.succeeded":
      return createEditorSession(action.base);
    case "conflict.received":
      return {
        acknowledgedWarningKeys: state.acknowledgedWarningKeys,
        base: state.base,
        conflict: action.conflict,
        findings: state.findings,
        pending: state.pending,
        phase: "conflict",
        redo: state.redo,
      };
    case "conflict.reapply":
      return {
        acknowledgedWarningKeys: [],
        base: Object.freeze({ ...action.base }),
        findings: [],
        pending: state.pending,
        phase: state.pending.length === 0 ? "clean" : "editing",
        redo: state.redo,
      };
  }
}

export function editorWarningsAcknowledged(state: EditorSessionState): boolean {
  const warningKeys = state.findings
    .filter(({ severity }) => severity === "warning")
    .map(editorFindingKey);
  return warningKeys.every((key) => state.acknowledgedWarningKeys.includes(key));
}

export function editorCanPreview(state: EditorSessionState): boolean {
  return state.pending.length > 0 && state.phase !== "previewing" && state.phase !== "committing";
}

export function editorCanCommit(state: EditorSessionState, now = Date.now()): boolean {
  return Boolean(
    state.preview &&
    state.phase === "preview-ready" &&
    !state.preview.hasBlockingFindings &&
    new Date(state.preview.expiresAt).getTime() > now &&
    editorWarningsAcknowledged(state),
  );
}
