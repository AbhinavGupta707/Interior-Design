"use client";

import type {
  BriefPatchOperation,
  BriefPatchProposal,
  ConsultationSession,
  DesignBrief,
} from "@interior-design/contracts";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SyntheticEvent } from "react";

import {
  ActionButton,
  LoadingIndicator,
  PageContainer,
  StatePanel,
} from "../../components/ui-primitives";
import { consultationClient, ConsultationProblem } from "./api";
import { BriefInitializer } from "./brief-initializer";
import { BriefOverview } from "./brief-overview";
import styles from "./consultation.module.css";
import type { ConsultationWorkspace as Workspace } from "./contracts";
import { canAcceptBrief } from "./presentation";
import { ProposalInspector } from "./proposal-inspector";
import {
  clearConsultationRecovery,
  readConsultationRecovery,
  saveConsultationRecovery,
} from "./recovery";
import { ReferenceBoard } from "./reference-board";

type LoadState =
  | { readonly kind: "error" | "forbidden" | "offline"; readonly message: string }
  | { readonly kind: "expired" | "loading" | "ready" };
type BusyAction = "accept" | "cancel" | "confirm" | "refresh" | "send" | "start";

function loadStateFrom(reason: unknown): LoadState {
  if (reason instanceof ConsultationProblem) {
    if (reason.kind === "expired") return { kind: "expired" };
    if (reason.kind === "forbidden" || reason.kind === "not-found") {
      return { kind: "forbidden", message: reason.message };
    }
    if (reason.kind === "offline") return { kind: "offline", message: reason.message };
    return { kind: "error", message: reason.message };
  }
  return { kind: "error", message: "The design consultation workspace could not be loaded." };
}

function actionMessage(reason: unknown): string {
  if (reason instanceof ConsultationProblem) {
    if (reason.kind === "conflict") {
      return "The brief changed before this action completed. Reload the latest revision and inspect the proposal again.";
    }
    if (reason.kind === "proposal-expired") {
      return "This proposal expired without changing the brief. Submit the message again for a fresh proposal.";
    }
    return reason.message;
  }
  if (reason instanceof Error && reason.name === "ZodError") {
    return "A corrected patch is incomplete or incompatible with its fixed provenance. Review the named fields and try again.";
  }
  return "The action could not be completed. No brief change was applied.";
}

function formattedTime(value: string): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

export function ConsultationWorkspace({ projectId }: { readonly projectId: string }) {
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [workspace, setWorkspace] = useState<Workspace>();
  const [consultation, setConsultation] = useState<ConsultationSession>();
  const [proposal, setProposal] = useState<BriefPatchProposal>();
  const [operations, setOperations] = useState<readonly BriefPatchOperation[]>([]);
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(new Set());
  const [message, setMessage] = useState("");
  const [lastMessage, setLastMessage] = useState<string>();
  const [messageError, setMessageError] = useState<string>();
  const [acknowledged, setAcknowledged] = useState(false);
  const [acceptAcknowledged, setAcceptAcknowledged] = useState(false);
  const [busy, setBusy] = useState<BusyAction>();
  const [alert, setAlert] = useState<string>();
  const [statusMessage, setStatusMessage] = useState("");
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const focusMessageAfterStartRef = useRef(false);

  const loadWorkspace = useCallback(
    async (initial = false) => {
      if (initial) setLoadState({ kind: "loading" });
      else setBusy("refresh");
      setAlert(undefined);
      try {
        const next = await consultationClient.loadWorkspace(projectId);
        setWorkspace(next);
        setLoadState({ kind: "ready" });

        const recovery = readConsultationRecovery(window.localStorage, projectId);
        if (recovery) {
          try {
            const [recoveredSession, recoveredProposal] = await Promise.all([
              consultationClient.getSession(projectId, recovery.sessionId),
              recovery.proposalId
                ? consultationClient
                    .getProposal(projectId, recovery.sessionId, recovery.proposalId)
                    .catch((reason: unknown) => {
                      if (
                        reason instanceof ConsultationProblem &&
                        ["not-found", "proposal-expired"].includes(reason.kind)
                      ) {
                        return undefined;
                      }
                      throw reason;
                    })
                : Promise.resolve(undefined),
            ]);
            setConsultation(recoveredSession);
            setProposal(recoveredProposal);
            setOperations(recoveredProposal?.operations ?? []);
            setExcluded(new Set());
            setAcknowledged(false);
            setStatusMessage(
              recoveredProposal
                ? "Consultation and pending proposal recovered. Review it before confirming."
                : "Consultation recovered. Private message text was not stored in this browser.",
            );
            if (!recoveredProposal) {
              saveConsultationRecovery(window.localStorage, {
                projectId,
                savedAt: new Date().toISOString(),
                schemaVersion: "c11-consultation-recovery-v1",
                sessionId: recoveredSession.id,
              });
            }
          } catch {
            clearConsultationRecovery(window.localStorage, projectId);
            setConsultation(undefined);
            setProposal(undefined);
            setOperations([]);
            setStatusMessage(
              "The previous consultation could not be recovered. Start a new session.",
            );
          }
        } else if (!initial) {
          setStatusMessage("Brief and capability state refreshed.");
        }
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

  const editable = workspace ? workspace.session.actor.role !== "viewer" : false;
  const activeSession = consultation?.state === "active";

  useEffect(() => {
    if (!activeSession || !focusMessageAfterStartRef.current) return;
    focusMessageAfterStartRef.current = false;
    window.requestAnimationFrame(() => messageRef.current?.focus());
  }, [activeSession]);

  function updateBrief(next: DesignBrief): void {
    setWorkspace((current) => (current ? { ...current, brief: next } : current));
  }

  function clearPrivateSessionState(): void {
    setMessage("");
    setLastMessage(undefined);
    setMessageError(undefined);
  }

  async function startConsultation(): Promise<void> {
    if (!workspace?.brief || !editable || busy) return;
    setBusy("start");
    setAlert(undefined);
    try {
      const next = await consultationClient.createSession(projectId, workspace.brief);
      clearPrivateSessionState();
      setConsultation(next);
      setProposal(undefined);
      setOperations([]);
      setExcluded(new Set());
      saveConsultationRecovery(window.localStorage, {
        projectId,
        savedAt: new Date().toISOString(),
        schemaVersion: "c11-consultation-recovery-v1",
        sessionId: next.id,
      });
      setStatusMessage("Local consultation started. The brief is still unchanged.");
      focusMessageAfterStartRef.current = true;
    } catch (reason) {
      setAlert(actionMessage(reason));
    } finally {
      setBusy(undefined);
    }
  }

  async function cancelConsultation(): Promise<void> {
    if (!consultation || !editable || busy) return;
    setBusy("cancel");
    setAlert(undefined);
    try {
      const next = await consultationClient.cancelSession(projectId, consultation.id);
      clearPrivateSessionState();
      setConsultation(next);
      setProposal(undefined);
      setOperations([]);
      setExcluded(new Set());
      clearConsultationRecovery(window.localStorage, projectId);
      setStatusMessage("Consultation cancelled. No pending assistant proposal was confirmed.");
    } catch (reason) {
      setAlert(actionMessage(reason));
    } finally {
      setBusy(undefined);
    }
  }

  async function submitTurn(event: SyntheticEvent<HTMLFormElement, SubmitEvent>): Promise<void> {
    event.preventDefault();
    if (!workspace?.brief || !consultation || !editable || busy) return;
    const nextMessage = message.trim();
    if (nextMessage.length === 0) {
      setMessageError("Enter the household need, preference or question you want to discuss.");
      messageRef.current?.focus();
      return;
    }
    setMessageError(undefined);
    setAlert(undefined);
    setBusy("send");
    try {
      const next = await consultationClient.submitTurn(
        projectId,
        consultation.id,
        workspace.brief.revision,
        nextMessage,
      );
      setLastMessage(nextMessage);
      setMessage("");
      setProposal(next);
      setOperations(next.operations);
      setExcluded(new Set());
      setAcknowledged(false);
      setConsultation((current) =>
        current
          ? { ...current, turnCount: current.turnCount + 1, updatedAt: next.createdAt }
          : current,
      );
      saveConsultationRecovery(window.localStorage, {
        projectId,
        proposalId: next.id,
        savedAt: new Date().toISOString(),
        schemaVersion: "c11-consultation-recovery-v1",
        sessionId: consultation.id,
      });
      setStatusMessage(
        `${String(next.operations.length)} proposed brief change${next.operations.length === 1 ? "" : "s"}, ${String(next.clarifyingQuestions.length)} clarification${next.clarifyingQuestions.length === 1 ? "" : "s"}, and ${String(next.professionalReview.length)} review item${next.professionalReview.length === 1 ? "" : "s"} ready. Focus remains in the consultation controls.`,
      );
    } catch (reason) {
      setAlert(actionMessage(reason));
    } finally {
      setBusy(undefined);
    }
  }

  async function confirmProposal(): Promise<void> {
    if (!workspace?.brief || !consultation || !proposal || !editable || busy || !acknowledged)
      return;
    const included = operations.filter((_, index) => !excluded.has(index));
    const corrected =
      excluded.size > 0 || JSON.stringify(operations) !== JSON.stringify(proposal.operations);
    setBusy("confirm");
    setAlert(undefined);
    try {
      if (corrected) {
        const result = await consultationClient.applyCorrectedBriefPatch(
          projectId,
          consultation.id,
          workspace.brief,
          included,
          workspace.session.actor.userId,
          new Date().toISOString(),
        );
        updateBrief(result.brief);
        setAcknowledged(false);
        if (result.kind === "cleanup-failed") {
          setAlert(
            `Brief revision ${String(result.brief.revision)} was applied, but consultation session ${consultation.id} could not be closed. The pending proposal is now superseded and recovery was retained. Retry Cancel session.`,
          );
          setStatusMessage(
            `Corrected brief patch applied as revision ${String(result.brief.revision)}. The original assistant proposal was not confirmed. Consultation closure needs attention.`,
          );
          return;
        }
        setConsultation(result.consultation);
        clearPrivateSessionState();
        setProposal(undefined);
        setOperations([]);
        setExcluded(new Set());
        clearConsultationRecovery(window.localStorage, projectId);
        setStatusMessage(
          `Corrected brief patch applied as revision ${String(result.brief.revision)}. The original assistant proposal was not confirmed; the consultation session was closed.`,
        );
        return;
      }
      const next = await consultationClient.confirmProposal(
        projectId,
        proposal,
        workspace.brief.revision,
      );
      updateBrief(next);
      clearPrivateSessionState();
      setProposal(undefined);
      setOperations([]);
      setExcluded(new Set());
      setAcknowledged(false);
      setConsultation(undefined);
      clearConsultationRecovery(window.localStorage, projectId);
      setStatusMessage(`Proposal confirmed and brief revision ${String(next.revision)} created.`);
    } catch (reason) {
      setAlert(actionMessage(reason));
    } finally {
      setBusy(undefined);
    }
  }

  async function acceptBrief(): Promise<void> {
    if (!workspace?.brief || !editable || busy || !acceptAcknowledged) return;
    setBusy("accept");
    setAlert(undefined);
    try {
      const next = await consultationClient.acceptBrief(projectId, workspace.brief);
      updateBrief(next);
      setAcceptAcknowledged(false);
      setStatusMessage(
        `Brief revision ${String(next.revision)} accepted with accountable attribution.`,
      );
    } catch (reason) {
      setAlert(actionMessage(reason));
    } finally {
      setBusy(undefined);
    }
  }

  if (loadState.kind === "loading") {
    return (
      <PageContainer className={styles.statePage}>
        <LoadingIndicator label="Loading the design brief and local consultation capability…" />
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
          message={<p>Your session expired before any consultation action was applied.</p>}
          status="Session expired"
          title="Return safely to the brief"
          tone="error"
        />
      </PageContainer>
    );
  }
  if (loadState.kind !== "ready" || !workspace) {
    const unavailableMessage =
      "message" in loadState
        ? loadState.message
        : "The design consultation workspace could not be loaded.";
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
                ? "Reconnect, then retry. No brief state was changed."
                : unavailableMessage}
            </p>
          }
          status={loadState.kind === "forbidden" ? "Read unavailable" : "Workspace unavailable"}
          title={
            loadState.kind === "offline" ? "You appear to be offline" : "The brief stayed safe"
          }
          tone="error"
        />
      </PageContainer>
    );
  }

  if (!workspace.brief) {
    return (
      <BriefInitializer
        onInitialized={async () => {
          await loadWorkspace(false);
        }}
        projectId={projectId}
        workspace={workspace}
      />
    );
  }

  return (
    <PageContainer
      className={styles.shell}
      data-canonical-mutation-count="0"
      data-testid="design-consultation-workspace"
    >
      <p aria-atomic="true" aria-live="polite" className={styles.visuallyHidden} role="status">
        {statusMessage}
      </p>

      <header className={styles.hero}>
        <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
          <Link href="/projects">Projects</Link>
          <span aria-hidden="true">/</span>
          <span>Design consultation</span>
        </nav>
        <div className={styles.heroGrid}>
          <div>
            <h1>Shape a brief that can stand up to scrutiny</h1>
            <p>
              Turn household needs and references into structured, attributable design inputs—then
              inspect every suggested change before it reaches the brief.
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
                {workspace.session.actor.role} · {editable ? "can edit" : "read-only"}
              </dd>
            </div>
            <div>
              <dt>Brief</dt>
              <dd>
                Revision {workspace.brief.revision} · {workspace.brief.status}
              </dd>
            </div>
          </dl>
        </div>
        <div className={styles.capabilityBar} role="note">
          <div>
            <span className={styles.capabilityDot} />
            <strong>Deterministic local assistant</strong>
            <span>{workspace.capability.activeAdapter}</span>
          </div>
          <div>
            <strong>External providers disabled</strong>
            <span>No external network or training use</span>
          </div>
          <div>
            <strong>
              {workspace.capability.evidenceClassification === "fixture-presentation"
                ? "Synthetic fixture presentation"
                : "Backend-composed workspace"}
            </strong>
            <span>Never represented as provider output</span>
          </div>
        </div>
      </header>

      {alert ? (
        <div aria-atomic="true" className={styles.alert} role="alert">
          <strong>
            {alert.includes("was applied, but")
              ? "Consultation closure incomplete"
              : "Action not completed"}
          </strong>
          <span>{alert}</span>
          {alert.includes("expired") || alert.includes("changed") ? (
            <ActionButton
              disabled={busy !== undefined}
              onClick={() => void loadWorkspace(false)}
              tone="quiet"
            >
              Reload latest brief
            </ActionButton>
          ) : null}
        </div>
      ) : null}

      {!editable ? (
        <aside className={styles.readOnlyBanner} role="note">
          <strong>Viewer access is read-only.</strong>
          <span>
            You can inspect classifications, provenance, references and review routes. No write
            controls are available.
          </span>
        </aside>
      ) : null}

      <div className={styles.workspaceGrid}>
        <div className={styles.briefColumn}>
          <BriefOverview brief={workspace.brief} />
          <ReferenceBoard brief={workspace.brief} />
          <section aria-labelledby="accept-brief-title" className={styles.acceptPanel}>
            <div>
              <p className={styles.sectionLabel}>Explicit acceptance</p>
              <h2 id="accept-brief-title">
                {workspace.brief.status === "accepted"
                  ? "Brief accepted"
                  : "Accept this brief revision"}
              </h2>
              <p>
                Acceptance records who accepted this exact C11 revision. It does not approve
                structure, regulations, cost, availability or a future design option.
              </p>
              {workspace.brief.status === "accepted" ? (
                <p className={styles.acceptedRecord}>
                  Accepted by <code>{workspace.brief.acceptedBy}</code> at{" "}
                  {formattedTime(workspace.brief.acceptedAt ?? workspace.brief.updatedAt)}.
                </p>
              ) : null}
            </div>
            {workspace.brief.status === "draft" && editable ? (
              <div className={styles.acceptControls}>
                <label>
                  <input
                    checked={acceptAcknowledged}
                    disabled={!canAcceptBrief(workspace.brief) || busy !== undefined}
                    onChange={(event) => {
                      setAcceptAcknowledged(event.target.checked);
                    }}
                    type="checkbox"
                  />
                  I reviewed this exact revision, including conflicts, unknowns and review-required
                  items.
                </label>
                <ActionButton
                  disabled={
                    !canAcceptBrief(workspace.brief) || !acceptAcknowledged || busy !== undefined
                  }
                  onClick={() => void acceptBrief()}
                  tone="primary"
                >
                  {busy === "accept"
                    ? "Accepting…"
                    : "Accept revision " + String(workspace.brief.revision)}
                </ActionButton>
                {!canAcceptBrief(workspace.brief) ? (
                  <p>Add at least one attributable entry before acceptance.</p>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>

        <aside aria-labelledby="consultation-title" className={styles.consultationColumn}>
          <div className={styles.consultationHeader}>
            <div>
              <p className={styles.sectionLabel}>Consultation</p>
              <h2 id="consultation-title">Talk through the household need</h2>
            </div>
            <span data-state={consultation?.state ?? "not-started"}>
              {consultation?.state.replaceAll("-", " ") ?? "not started"}
            </span>
          </div>
          <p className={styles.consultationIntro}>
            Describe needs, retained items, tensions and preferences. Prompt-like text is treated as
            household data, never as tool policy.
          </p>

          <section aria-label="Professional boundaries" className={styles.boundaryNote}>
            <strong>Questions routed, not guessed</strong>
            <p>
              Structural, regulatory, clinical-accessibility, fixed-cost and live-availability
              questions are marked for accountable review.
            </p>
          </section>

          {!activeSession ? (
            <div className={styles.startConsultation}>
              <p>
                {consultation
                  ? "The previous session is closed. Starting another does not change the brief."
                  : "No active session. Starting one does not change the brief."}
              </p>
              {editable ? (
                <ActionButton
                  disabled={busy !== undefined}
                  onClick={() => void startConsultation()}
                  tone="primary"
                >
                  {busy === "start"
                    ? "Starting…"
                    : consultation
                      ? "Start new local consultation"
                      : "Start local consultation"}
                </ActionButton>
              ) : null}
            </div>
          ) : null}
          {consultation ? (
            <div className={styles.sessionMeta}>
              <div>
                <span>Session</span>
                <code>{consultation.id}</code>
              </div>
              <div>
                <span>Turns</span>
                <strong>{consultation.turnCount} of 100</strong>
              </div>
              <div>
                <span>Adapter mode</span>
                <strong>{consultation.providerMode}</strong>
              </div>
            </div>
          ) : null}

          {activeSession ? (
            <form
              className={styles.messageForm}
              noValidate
              onSubmit={(event) => void submitTurn(event)}
            >
              <label htmlFor="consultation-message">Household message or question</label>
              <p className={styles.fieldHelp} id="consultation-message-help">
                Do not include credentials or unrelated personal data. Maximum 8,000 characters.
              </p>
              <textarea
                aria-describedby={`consultation-message-help${messageError ? " consultation-message-error" : ""}`}
                aria-invalid={messageError ? "true" : undefined}
                disabled={!editable || busy !== undefined}
                id="consultation-message"
                maxLength={8000}
                onChange={(event) => {
                  setMessage(event.target.value);
                  if (messageError) setMessageError(undefined);
                }}
                placeholder="For example: Keep the dining table, improve evening lighting, and explain any tension with wider circulation."
                ref={messageRef}
                rows={5}
                value={message}
              />
              {messageError ? (
                <p className={styles.fieldError} id="consultation-message-error">
                  {messageError}
                </p>
              ) : null}
              <div className={styles.messageActions}>
                <ActionButton
                  disabled={!editable || (busy !== undefined && busy !== "send")}
                  type="submit"
                  tone="primary"
                >
                  {busy === "send" ? "Preparing proposal…" : "Send for structured review"}
                </ActionButton>
                {editable ? (
                  <ActionButton
                    disabled={busy !== undefined}
                    onClick={() => void cancelConsultation()}
                    tone="quiet"
                  >
                    {busy === "cancel" ? "Cancelling…" : "Cancel session"}
                  </ActionButton>
                ) : null}
              </div>
            </form>
          ) : null}

          {lastMessage ? (
            <section aria-labelledby="latest-message-title" className={styles.transcript}>
              <h3 id="latest-message-title">Latest household message</h3>
              <p data-testid="displayed-household-message">{lastMessage}</p>
              <span>Treated as untrusted data · not stored in browser recovery</span>
            </section>
          ) : null}

          {proposal ? (
            <ProposalInspector
              acknowledged={acknowledged}
              busy={busy === "confirm"}
              editable={editable}
              excluded={excluded}
              onAcknowledgedChange={setAcknowledged}
              onConfirm={() => void confirmProposal()}
              onExcludedChange={setExcluded}
              onOperationsChange={setOperations}
              operations={operations}
              proposal={proposal}
              currentBriefRevision={workspace.brief.revision}
            />
          ) : null}
        </aside>
      </div>
    </PageContainer>
  );
}
