"use client";

import type { DesignBrief } from "@interior-design/contracts";
import Link from "next/link";
import { useMemo, useState } from "react";

import { ActionButton, PageContainer, StatePanel } from "../../components/ui-primitives";
import { consultationClient } from "./api";
import { buildBriefInitializationRequest, intakeBriefFacts } from "./brief-initialization";
import styles from "./consultation.module.css";
import type { ConsultationWorkspace } from "./contracts";

export function BriefInitializer({
  onInitialized,
  projectId,
  workspace,
}: {
  readonly onInitialized: (brief: DesignBrief) => Promise<void>;
  readonly projectId: string;
  readonly workspace: ConsultationWorkspace;
}) {
  const facts = useMemo(
    () => (workspace.intake ? intakeBriefFacts(workspace.intake) : []),
    [workspace.intake],
  );
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(facts.map(({ key }) => key)),
  );
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<string>();
  const [status, setStatus] = useState("");
  const editable = workspace.session.actor.role !== "viewer";

  if (!workspace.intake) {
    return (
      <PageContainer className={styles.statePage}>
        <StatePanel
          actions={
            <Link className="ui-action" data-tone="primary" href={"/onboarding/" + projectId}>
              Complete home intake
            </Link>
          }
          message={
            <p>
              No design brief or saved intake facts are available. Complete the structured intake;
              opening this page never creates a brief automatically.
            </p>
          }
          status="Intake required"
          title="Start with attributable household facts"
          tone="neutral"
        />
      </PageContainer>
    );
  }
  const intake = workspace.intake;

  function toggle(key: string): void {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
    setAcknowledged(false);
  }

  async function initialize(): Promise<void> {
    if (!editable || busy || !acknowledged || selected.size === 0) return;
    const request = await buildBriefInitializationRequest(
      intake,
      selected,
      workspace.session.actor.userId,
    );
    setBusy(true);
    setAlert(undefined);
    try {
      const brief = await consultationClient.initializeBrief(projectId, request);
      setStatus(
        "Brief revision " +
          String(brief.revision) +
          " created from " +
          String(selected.size) +
          " selected saved intake facts. Reloading the consultation workspace.",
      );
      await onInitialized(brief);
    } catch {
      setAlert(
        "The brief could not be confirmed. No automatic mutation was attempted; retrying this unchanged selection reuses the same request key and exact body.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageContainer className={[styles.shell, styles.initializerShell].join(" ")}>
      <p aria-atomic="true" aria-live="polite" className={styles.visuallyHidden} role="status">
        {status}
      </p>
      <header className={styles.initializerHero}>
        <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
          <Link href="/projects">Projects</Link>
          <span aria-hidden="true">/</span>
          <span>Initialize design brief</span>
        </nav>
        <div>
          <p className={styles.sectionLabel}>Explicit initialization · expected revision 0</p>
          <h1>Create the first attributable design brief</h1>
          <p>
            Select saved household facts to reassert as the current actor. This page excludes the
            property address and does not create or change a brief until an authorised editor
            confirms.
          </p>
        </div>
      </header>
      {alert ? (
        <div aria-atomic="true" className={styles.alert} role="alert">
          <strong>Brief not initialized</strong>
          <span>{alert}</span>
        </div>
      ) : null}
      {!editable ? (
        <aside className={styles.readOnlyBanner} role="note">
          <strong>Viewer access is read-only.</strong>
          <span>An owner or editor must initialize revision 1.</span>
        </aside>
      ) : null}
      <section aria-labelledby="intake-facts-title" className={styles.initializerPanel}>
        <div className={styles.initializerHeading}>
          <div>
            <p className={styles.sectionLabel}>Saved intake version {intake.version}</p>
            <h2 id="intake-facts-title">Choose facts for revision 1</h2>
          </div>
          <strong>{selected.size} selected</strong>
        </div>
        <ul className={styles.intakeFacts}>
          {facts.map((fact) => (
            <li key={fact.key}>
              <label>
                <input
                  checked={selected.has(fact.key)}
                  disabled={!editable || busy}
                  onChange={() => {
                    toggle(fact.key);
                  }}
                  type="checkbox"
                />
                <span>
                  <strong>{fact.label}</strong>
                  <span>{fact.statement}</span>
                  <small>
                    {fact.classification.replaceAll("-", " ")} · reasserted by the confirming actor
                    · saved {new Date(intake.updatedAt).toLocaleDateString("en-GB")}
                  </small>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <div className={styles.initializerConfirmation}>
          <label>
            <input
              checked={acknowledged}
              disabled={!editable || busy || selected.size === 0}
              onChange={(event) => {
                setAcknowledged(event.target.checked);
              }}
              type="checkbox"
            />
            I reviewed these selected saved intake facts and want to create design brief revision 1.
          </label>
          <p>
            The request uses expected revision 0. An unchanged retry deterministically reuses the
            same idempotency key, entry IDs and body.
          </p>
          <ActionButton
            disabled={!editable || busy || !acknowledged || selected.size === 0}
            onClick={() => void initialize()}
            tone="primary"
          >
            {busy ? "Creating revision 1…" : "Create design brief revision 1"}
          </ActionButton>
        </div>
      </section>
    </PageContainer>
  );
}
