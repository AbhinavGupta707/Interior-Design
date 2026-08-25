"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  ActionButton,
  LoadingIndicator,
  PageContainer,
  StatePanel,
} from "../../components/ui-primitives";
import { ClientProblem } from "../auth/api";

import { deriveHomeJourney, journeyStatusLabel } from "./journey-state";
import { loadHomeJourney, type LoadedHomeJourney } from "./journey-loader";

type LoadState =
  | { readonly kind: "error" | "forbidden" | "offline"; readonly message: string }
  | { readonly data: LoadedHomeJourney; readonly kind: "ready" }
  | { readonly kind: "expired" | "loading" };

function stateFrom(reason: unknown): LoadState {
  if (reason instanceof ClientProblem) {
    if (reason.kind === "expired") return { kind: "expired" };
    if (reason.kind === "forbidden") {
      return { kind: "forbidden", message: "This project is unavailable to the current role." };
    }
    if (reason.kind === "offline") {
      return {
        kind: "offline",
        message: "Reconnect to load this project journey. No state was changed.",
      };
    }
  }
  return { kind: "error", message: "The project journey could not be loaded safely." };
}

export function HomeownerJourney({ projectId }: { readonly projectId: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      setState({ data: await loadHomeJourney(projectId), kind: "ready" });
    } catch (reason) {
      setState(stateFrom(reason));
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === "loading") {
    return (
      <PageContainer className="workspace-state">
        <LoadingIndicator label="Loading each readable home-journey stage" />
      </PageContainer>
    );
  }
  if (state.kind === "expired") {
    return (
      <PageContainer className="workspace-state">
        <StatePanel
          actions={
            <Link className="ui-action" href="/sign-in">
              Sign in again
            </Link>
          }
          message="Your session expired while reading the journey. No project or canonical state was changed."
          title="Session expired"
          tone="error"
        />
      </PageContainer>
    );
  }
  if (state.kind !== "ready") {
    return (
      <PageContainer className="workspace-state">
        <StatePanel
          actions={<ActionButton onClick={() => void load()}>Try again</ActionButton>}
          message={
            "message" in state ? state.message : "The project journey could not be loaded safely."
          }
          title={state.kind === "offline" ? "You’re offline" : "Journey unavailable"}
          tone="error"
        />
      </PageContainer>
    );
  }

  const { input, project, session } = state.data;
  const journey = deriveHomeJourney(input);
  const degradedCount = journey.stages.filter(
    ({ degraded, status }) => degraded === true || status === "unavailable",
  ).length;

  return (
    <PageContainer className="home-journey-shell">
      <a className="ui-skip-link" href="#journey-stages">
        Skip to journey stages
      </a>
      <header className="home-journey-hero">
        <nav aria-label="Project navigation">
          <Link href="/projects">Projects</Link>
          <span aria-hidden="true">/</span>
          <span>{project.name}</span>
        </nav>
        <div className="home-journey-hero__grid">
          <div>
            <span className="home-journey-eyebrow">Home journey · {session.actor.role} access</span>
            <h1>Model your home, then design it</h1>
            <p>
              Move from property context and renovation intent to rights-cleared evidence, explicit
              model confirmation and an exact twin—then continue through a structured brief,
              comparable design choices, specification, exploration and geometry-safe stills.
            </p>
          </div>
          <div className="home-journey-truth" role="note">
            <strong>Context is not interior truth</strong>
            <span>
              Address data identifies or contextualises a home. Only evidence-backed, validated and
              explicitly committed operations can change its current model.
            </span>
          </div>
        </div>
      </header>

      {degradedCount > 0 ? (
        <div className="home-journey-degraded" role="status">
          <strong>Partial journey available</strong>
          <span>
            {degradedCount} stage{degradedCount === 1 ? " has" : "s have"} unavailable state.
            Readable results below were kept and no missing completion was inferred.
          </span>
        </div>
      ) : null}

      <section className="home-journey-next" aria-labelledby="journey-next-title">
        <div>
          <span>Primary next action</span>
          <h2 id="journey-next-title">{journey.primary.title}</h2>
          <p>{journey.primary.detail}</p>
        </div>
        <Link className="ui-action" data-tone="primary" href={journey.primary.href}>
          {journey.primary.actionLabel}
        </Link>
      </section>

      <section className="home-journey-phase" id="journey-stages">
        <header className="home-journey-phase__header">
          <span className="home-journey-eyebrow">Phase 1 · Understand the home</span>
          <h2>Evidence to confirmed digital twin</h2>
          <p>
            Context, evidence and proposals stay distinct until typed corrections are explicitly
            committed and compiled from the exact current snapshot.
          </p>
        </header>
        <ol className="home-journey-stages">
          {journey.modelStages.map((stage, index) => (
            <li data-stage-state={stage.status} key={stage.id}>
              <div className="home-journey-stage__number" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </div>
              <div className="home-journey-stage__copy">
                <div>
                  <h2>{stage.title}</h2>
                  <span className="home-journey-status">{journeyStatusLabel(stage.status)}</span>
                </div>
                <p>{stage.detail}</p>
                <Link className="home-journey-stage__link" href={stage.href}>
                  {stage.actionLabel}
                </Link>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {journey.designStages.length > 0 ? (
        <section className="home-journey-phase home-journey-phase--design">
          <header className="home-journey-phase__header">
            <span className="home-journey-eyebrow">Phase 2 · Design your home</span>
            <h2>Confirmed twin to useful design outputs</h2>
            <p>
              The brief records intent; options change only proposed state; specifications and
              visual media retain exact model, catalog and tool versions.
            </p>
          </header>
          <ol className="home-journey-stages">
            {journey.designStages.map((stage, index) => (
              <li data-stage-state={stage.status} key={stage.id}>
                <div className="home-journey-stage__number" aria-hidden="true">
                  {String(journey.modelStages.length + index + 1).padStart(2, "0")}
                </div>
                <div className="home-journey-stage__copy">
                  <div>
                    <h2>{stage.title}</h2>
                    <span className="home-journey-status">{journeyStatusLabel(stage.status)}</span>
                  </div>
                  <p>{stage.detail}</p>
                  <Link className="home-journey-stage__link" href={stage.href}>
                    {stage.actionLabel}
                  </Link>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="home-journey-rights" aria-labelledby="journey-rights-title">
        <div>
          <span className="home-journey-eyebrow">Evidence boundary</span>
          <h2 id="journey-rights-title">Your sources stay attributable</h2>
        </div>
        <ul>
          <li>Original evidence is immutable; derived previews and proposals remain separate.</li>
          <li>Processing requires an explicit rights basis and service-processing consent.</li>
          <li>Training permission is separate and denied by default.</li>
          <li>
            After explicit workspace setup, plans continue to C6; ready media continues to C8.
          </li>
        </ul>
      </section>

      <details className="home-journey-tools">
        <summary>Specialist checkpoint tools</summary>
        <nav aria-label="Specialist project tools">
          <Link href={`/editor/${encodeURIComponent(projectId)}`}>2D editor</Link>
          <Link href={`/plan-import/${encodeURIComponent(projectId)}`}>Floor-plan correction</Link>
          <Link href={`/reconstruction/${encodeURIComponent(projectId)}`}>
            Media reconstruction
          </Link>
          <Link href={`/fusion/${encodeURIComponent(projectId)}`}>Source reconciliation</Link>
          <Link href={`/viewer/${encodeURIComponent(projectId)}`}>3D viewer</Link>
          <Link href={`/design-consultation/${encodeURIComponent(projectId)}`}>
            Design consultation
          </Link>
          <Link href={`/design-options/${encodeURIComponent(projectId)}`}>Design options</Link>
          <Link href={`/materials-products/${encodeURIComponent(projectId)}`}>
            Materials and room specification
          </Link>
          <Link href={`/render-stills/${encodeURIComponent(projectId)}`}>Geometry-safe stills</Link>
        </nav>
      </details>
    </PageContainer>
  );
}
