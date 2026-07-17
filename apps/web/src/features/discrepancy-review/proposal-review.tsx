"use client";

import type {
  fusionDiscrepancyDecisionSchema,
  reviewFusionDiscrepanciesRequestSchema,
  FusionProposal,
} from "@interior-design/contracts";
import { useMemo, useState } from "react";
import type { SyntheticEvent } from "react";
import type { z } from "zod";

import { ActionButton } from "../../components/ui-primitives";
import { connectedComponentCount, proposalStatusLabel, registrationLabel } from "./presentation";

type FusionDecision = z.infer<typeof fusionDiscrepancyDecisionSchema>;
type ReviewRequest = z.infer<typeof reviewFusionDiscrepanciesRequestSchema>;
type DecisionChoice = FusionDecision["choice"];

interface DecisionDraft {
  readonly choice: DecisionChoice;
  readonly reason: string;
}

interface ProposalReviewProps {
  readonly busy: boolean;
  readonly decisions: readonly FusionDecision[];
  readonly editable: boolean;
  readonly onReview: (value: ReviewRequest) => Promise<void>;
  readonly proposal: FusionProposal;
}

function shortHash(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

export function ProposalReview({
  busy,
  decisions,
  editable,
  onReview,
  proposal,
}: ProposalReviewProps) {
  const [drafts, setDrafts] = useState<Readonly<Record<string, DecisionDraft>>>({});
  const decidedIds = useMemo(
    () => new Set(decisions.map(({ discrepancyId }) => discrepancyId)),
    [decisions],
  );
  const pending = proposal.discrepancies.filter(({ id }) => !decidedIds.has(id));
  const batch = pending.slice(0, 50);

  async function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>): Promise<void> {
    event.preventDefault();
    const selected = batch.flatMap((discrepancy) => {
      const draft = drafts[discrepancy.id];
      if (!draft || draft.reason.trim().length === 0) return [];
      return [
        {
          choice: draft.choice,
          correctedOperations: draft.choice === "correct" ? discrepancy.suggestedOperations : [],
          discrepancyId: discrepancy.id,
          reason: draft.reason.trim(),
        },
      ];
    });
    if (selected.length === 0) return;
    await onReview({ decisions: selected, expectedProposalVersion: proposal.version });
    setDrafts({});
  }

  const status = proposalStatusLabel(proposal.status);
  const componentCount = connectedComponentCount(proposal);

  return (
    <section className="fusion-proposal" aria-labelledby="fusion-proposal-title">
      <header>
        <div>
          <span className="fusion-eyebrow">Proposal only · no canonical write</span>
          <h2 id="fusion-proposal-title">{status}</h2>
          <p>
            Based on snapshot <code>{shortHash(proposal.baseSnapshot.snapshotSha256)}</code>. Every
            discrepancy remains a human decision.
          </p>
        </div>
        <span className="fusion-status-pill" data-status={proposal.status}>
          {proposal.status.replaceAll("-", " ")}
        </span>
      </header>

      <dl className="fusion-metrics">
        <div>
          <dt>Sources registered</dt>
          <dd>
            {proposal.coverage.registeredSourceCount}/{proposal.coverage.inputSourceCount}
          </dd>
        </div>
        <div>
          <dt>Connected components</dt>
          <dd>{componentCount || "None"}</dd>
        </div>
        <div>
          <dt>Levels covered</dt>
          <dd>{proposal.coverage.levelsCovered}</dd>
        </div>
        <div>
          <dt>Unknown regions</dt>
          <dd>{proposal.coverage.unknownRegionCount}</dd>
        </div>
      </dl>

      <section className="fusion-section" aria-labelledby="registrations-title">
        <header>
          <div>
            <span className="fusion-eyebrow">Registration evidence</span>
            <h3 id="registrations-title">Source alignment</h3>
          </div>
        </header>
        <div className="registration-grid">
          {proposal.registrations.map((registration) => (
            <article key={registration.sourceId}>
              <div className="registration-heading">
                <strong>{registrationLabel(registration)}</strong>
                <code>{registration.sourceId.slice(0, 8)}</code>
              </div>
              {registration.status === "unregistered" ? (
                <p className="unknown-label">Unknown alignment · no transform was inferred.</p>
              ) : (
                <dl>
                  <div>
                    <dt>Method</dt>
                    <dd>{registration.method.replaceAll("-", " ")}</dd>
                  </div>
                  <div>
                    <dt>Scale</dt>
                    <dd>{registration.scaleStatus.replaceAll("-", " ")}</dd>
                  </div>
                  <div>
                    <dt>Median residual</dt>
                    <dd>{registration.residuals.medianMm} mm</dd>
                  </div>
                  <div>
                    <dt>P90 / max</dt>
                    <dd>
                      {registration.residuals.p90Mm} / {registration.residuals.maximumMm} mm
                    </dd>
                  </div>
                </dl>
              )}
              {registration.findings.map((finding) => (
                <p className="registration-finding" key={`${finding.code}:${finding.detail}`}>
                  <strong>{finding.code}</strong> {finding.detail}
                </p>
              ))}
            </article>
          ))}
        </div>
      </section>

      {proposal.status === "abstained" ? (
        <section className="fusion-abstention" role="status">
          <span className="fusion-eyebrow">Honest abstention · {proposal.safeCode}</span>
          <h3>No candidate snapshot was published</h3>
          <p>
            The system could not produce a bounded, defensible fusion. Source evidence and the base
            model were left unchanged.
          </p>
          <ul>
            {proposal.findings.map((finding) => (
              <li key={`${finding.code}:${finding.detail}`}>
                <strong>{finding.code}</strong> · {finding.detail}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="fusion-section" aria-labelledby="discrepancies-title">
          <header>
            <div>
              <span className="fusion-eyebrow">Attributed review</span>
              <h3 id="discrepancies-title">Discrepancies</h3>
              <p>
                Values labelled inferred or unknown never become dimensional truth without a typed
                decision and a later C5 workflow.
              </p>
            </div>
            <span>{pending.length} pending</span>
          </header>

          {pending.length === 0 ? (
            <div className="fusion-complete-note" role="status">
              This session’s visible discrepancies have attributed decisions.
            </div>
          ) : (
            <form onSubmit={(event) => void submit(event)}>
              {pending.length > 50 ? (
                <p className="batch-note">
                  Showing the next 50 discrepancies, the maximum atomic review batch.
                </p>
              ) : null}
              <div className="discrepancy-list">
                {batch.map((discrepancy, index) => {
                  const decision = drafts[discrepancy.id];
                  return (
                    <article className="discrepancy-card" key={discrepancy.id}>
                      <header>
                        <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                        <div>
                          <strong>{discrepancy.kind.replaceAll("-", " ")}</strong>
                          <p>{discrepancy.message}</p>
                        </div>
                        <span data-severity={discrepancy.severity}>{discrepancy.severity}</span>
                      </header>
                      <div className="claim-grid">
                        {discrepancy.sourceClaims.map((claim) => (
                          <div key={claim.sourceId}>
                            <strong>{claim.state.replaceAll("-", " ")}</strong>
                            <span>Source {claim.sourceId.slice(0, 8)}</span>
                            <code>{shortHash(claim.valueSha256)}</code>
                            {claim.confidenceBasisPoints === undefined ? (
                              <span className="unknown-label">Confidence unknown</span>
                            ) : (
                              <span>{claim.confidenceBasisPoints / 100}% confidence</span>
                            )}
                          </div>
                        ))}
                      </div>
                      {discrepancy.magnitudeMm === undefined ? (
                        <p className="unknown-label">Magnitude unknown</p>
                      ) : (
                        <p className="magnitude-label">
                          Measured difference: {discrepancy.magnitudeMm} mm
                        </p>
                      )}
                      <fieldset disabled={!editable || busy}>
                        <legend>Decision</legend>
                        <div className="decision-options">
                          {(
                            [
                              ["accept-candidate", "Accept candidate"],
                              ["keep-base", "Keep base"],
                              ["correct", "Correct"],
                              ["mark-unknown", "Mark unknown"],
                              ["defer", "Defer"],
                            ] as const
                          ).map(([value, label]) => (
                            <label key={value}>
                              <input
                                checked={decision?.choice === value}
                                disabled={
                                  value === "correct" &&
                                  discrepancy.suggestedOperations.length === 0
                                }
                                name={`choice-${discrepancy.id}`}
                                onChange={() => {
                                  setDrafts((current) => ({
                                    ...current,
                                    [discrepancy.id]: {
                                      choice: value,
                                      reason: current[discrepancy.id]?.reason ?? "",
                                    },
                                  }));
                                }}
                                type="radio"
                                value={value}
                              />
                              <span>{label}</span>
                            </label>
                          ))}
                        </div>
                        {decision?.choice === "correct" ? (
                          <p className="correction-note">
                            Correction uses the {discrepancy.suggestedOperations.length} exact typed
                            operation{discrepancy.suggestedOperations.length === 1 ? "" : "s"} shown
                            by this proposal. It is still only a draft.
                          </p>
                        ) : null}
                        <label className="decision-reason">
                          <span>Decision reason</span>
                          <textarea
                            maxLength={500}
                            onChange={(event) => {
                              const value = event.target.value;
                              setDrafts((current) => {
                                const currentDraft = current[discrepancy.id];
                                return currentDraft
                                  ? {
                                      ...current,
                                      [discrepancy.id]: { ...currentDraft, reason: value },
                                    }
                                  : current;
                              });
                            }}
                            placeholder="Record why this evidence should be handled this way"
                            required={decision !== undefined}
                            value={decision?.reason ?? ""}
                          />
                        </label>
                      </fieldset>
                    </article>
                  );
                })}
              </div>
              {editable ? (
                <ActionButton
                  disabled={
                    busy || !Object.values(drafts).some(({ reason }) => reason.trim().length > 0)
                  }
                  type="submit"
                >
                  {busy ? "Recording decisions…" : "Record attributed decisions"}
                </ActionButton>
              ) : (
                <p className="read-only-note">
                  Viewer access is read-only. No decisions can be recorded.
                </p>
              )}
            </form>
          )}
        </section>
      )}
    </section>
  );
}
