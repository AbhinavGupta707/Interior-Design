"use client";

import type {
  Project,
  PropertyCandidate,
  PropertyDossier,
  PropertyJurisdiction,
  PropertyResolutionResponse,
  PropertySourceRecord,
  Session,
} from "@interior-design/contracts";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SyntheticEvent } from "react";

import { ActionButton, LoadingIndicator, PageContainer } from "../../components/ui-primitives";
import { ClientProblem, getProject, getSession } from "../auth/api";
import {
  getPropertyDossier,
  listPropertySourceRecords,
  PropertyProblem,
  refreshPropertyDossier,
  resolveProperty,
  selectProjectProperty,
} from "./api";
import { DossierView } from "./dossier-view";
import { formatPropertyDate } from "./presentation";

type LoadState =
  | { kind: "error"; message: string; title: string }
  | { kind: "expired" }
  | { kind: "forbidden" }
  | { kind: "loading" }
  | {
      dossier: PropertyDossier | null;
      kind: "ready";
      project: Project;
      session: Session;
      sources: PropertySourceRecord[];
    };

interface OperationError {
  readonly message: string;
  readonly title: string;
}

interface ManualDraft {
  jurisdiction: PropertyJurisdiction;
  line1: string;
  line2: string;
  locality: string;
  postcode: string;
}

const emptyManualDraft: ManualDraft = {
  jurisdiction: "unknown",
  line1: "",
  line2: "",
  locality: "",
  postcode: "",
};

function stateFromProblem(reason: unknown): LoadState {
  if (reason instanceof ClientProblem) {
    if (reason.kind === "expired") return { kind: "expired" };
    if (reason.kind === "forbidden") return { kind: "forbidden" };
    if (reason.kind === "offline") {
      return { kind: "error", message: reason.message, title: "You’re offline" };
    }
    return { kind: "error", message: reason.message, title: "Property dossier unavailable" };
  }
  if (reason instanceof PropertyProblem) {
    if (reason.kind === "expired") return { kind: "expired" };
    if (reason.kind === "forbidden" || reason.kind === "not-found") return { kind: "forbidden" };
    if (reason.kind === "offline") {
      return { kind: "error", message: reason.message, title: "You’re offline" };
    }
    return { kind: "error", message: reason.message, title: "Property dossier unavailable" };
  }
  return {
    kind: "error",
    message: "The property workspace could not be loaded.",
    title: "Property dossier unavailable",
  };
}

function operationErrorFrom(reason: unknown, fallback: string): OperationError {
  if (reason instanceof PropertyProblem) {
    if (reason.kind === "offline") return { message: reason.message, title: "You’re offline" };
    if (reason.kind === "resolution-expired") {
      return {
        message: "The saved candidates expired after 15 minutes. Search again or use manual entry.",
        title: "Search results expired",
      };
    }
    if (reason.kind === "forbidden" || reason.kind === "not-found") {
      return {
        message:
          "This project or action is unavailable. Project existence is not disclosed across tenants.",
        title: "Property action unavailable",
      };
    }
    return { message: reason.message, title: fallback };
  }
  return { message: "Nothing was changed. Try again.", title: fallback };
}

export function PropertyWorkspace({ projectId }: { projectId: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [query, setQuery] = useState("");
  const [resolution, setResolution] = useState<PropertyResolutionResponse>();
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualDraft, setManualDraft] = useState<ManualDraft>(emptyManualDraft);
  const [resolving, setResolving] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [operationError, setOperationError] = useState<OperationError>();
  const [notice, setNotice] = useState("");
  const operationErrorRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    setConflict(false);
    try {
      const [session, project] = await Promise.all([getSession(), getProject(projectId)]);
      const sources = await listPropertySourceRecords(projectId);
      const dossier = sources.length > 0 ? await getPropertyDossier(projectId) : null;
      setState({ dossier, kind: "ready", project, session, sources });
    } catch (reason) {
      setState(stateFromProblem(reason));
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (operationError) operationErrorRef.current?.focus();
  }, [operationError]);

  async function handleResolve(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    setResolving(true);
    setResolution(undefined);
    setSelectedCandidateId("");
    setOperationError(undefined);
    setNotice("");
    try {
      const result = await resolveProperty(projectId, { countryCode: "GB", query });
      setResolution(result);
      if (result.status === "matched")
        setSelectedCandidateId(result.candidates[0]?.candidateId ?? "");
    } catch (reason) {
      setOperationError(operationErrorFrom(reason, "Search unavailable"));
    } finally {
      setResolving(false);
    }
  }

  async function handleCandidateSelection(candidateId: string) {
    if (state.kind !== "ready" || !resolution) return;
    setSelecting(true);
    setOperationError(undefined);
    setConflict(false);
    setNotice("");
    try {
      await selectProjectProperty(projectId, {
        candidateId,
        expectedVersion: state.dossier?.property.version ?? 0,
        mode: "candidate",
        resolutionId: resolution.resolutionId,
      });
      await load();
      setResolution(undefined);
      setNotice("Property selected. The source-aware dossier is now loaded.");
    } catch (reason) {
      if (reason instanceof PropertyProblem && reason.kind === "conflict") setConflict(true);
      if (reason instanceof PropertyProblem && reason.kind === "resolution-expired") {
        setResolution(undefined);
        setSelectedCandidateId("");
      }
      setOperationError(operationErrorFrom(reason, "Property not selected"));
    } finally {
      setSelecting(false);
    }
  }

  async function handleManualSelection(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    if (state.kind !== "ready") return;
    setSelecting(true);
    setOperationError(undefined);
    setConflict(false);
    setNotice("");
    try {
      await selectProjectProperty(projectId, {
        address: {
          countryCode: "GB",
          line1: manualDraft.line1,
          ...(manualDraft.line2.trim() ? { line2: manualDraft.line2 } : {}),
          ...(manualDraft.locality.trim() ? { locality: manualDraft.locality } : {}),
          ...(manualDraft.postcode.trim() ? { postcode: manualDraft.postcode } : {}),
        },
        expectedVersion: state.dossier?.property.version ?? 0,
        jurisdiction: manualDraft.jurisdiction,
        mode: "manual",
      });
      await load();
      setManualOpen(false);
      setManualDraft(emptyManualDraft);
      setResolution(undefined);
      setNotice("Manual property identity saved without an invented UPRN or coordinate.");
    } catch (reason) {
      if (reason instanceof PropertyProblem && reason.kind === "conflict") setConflict(true);
      setOperationError(operationErrorFrom(reason, "Manual property not saved"));
    } finally {
      setSelecting(false);
    }
  }

  async function handleRefresh() {
    if (state.kind !== "ready" || !state.dossier) return;
    setRefreshing(true);
    setOperationError(undefined);
    setConflict(false);
    setNotice("");
    try {
      const dossier = await refreshPropertyDossier(projectId, state.dossier.version);
      const sources = await listPropertySourceRecords(projectId);
      setState((current) =>
        current.kind === "ready" ? { ...current, dossier, sources } : current,
      );
      setNotice(`Dossier refreshed to version ${String(dossier.version)}.`);
    } catch (reason) {
      if (reason instanceof PropertyProblem && reason.kind === "conflict") {
        setConflict(true);
      } else {
        setOperationError(operationErrorFrom(reason, "Dossier not refreshed"));
      }
    } finally {
      setRefreshing(false);
    }
  }

  if (state.kind === "loading") {
    return (
      <PageContainer className="workspace-state">
        <LoadingIndicator label="Loading the property dossier" />
      </PageContainer>
    );
  }

  if (state.kind === "expired") {
    return (
      <PropertyState
        actionHref="/sign-in"
        actionLabel="Sign in again"
        message="Your local fixture session expired. No property selection or dossier refresh was submitted."
        title="Your session has expired"
      />
    );
  }

  if (state.kind === "forbidden") {
    return (
      <PropertyState
        action={load}
        actionLabel="Try again"
        message="This project is unavailable. Projects from another tenant and unknown project identifiers are not disclosed."
        title="Project unavailable"
      />
    );
  }

  if (state.kind === "error") {
    return (
      <PropertyState
        action={load}
        actionLabel="Retry property loading"
        message={state.message}
        title={state.title}
      />
    );
  }

  const canMutate = state.session.actor.role !== "viewer";
  const searchPanel = (
    <PropertySearchPanel
      currentVersion={state.dossier?.property.version ?? 0}
      manualDraft={manualDraft}
      manualOpen={manualOpen}
      onCandidateSelect={(candidateId) => {
        void handleCandidateSelection(candidateId);
      }}
      onManualChange={setManualDraft}
      onManualSubmit={(event) => {
        void handleManualSelection(event);
      }}
      onManualToggle={() => {
        setManualOpen((value) => !value);
        setOperationError(undefined);
      }}
      onQueryChange={setQuery}
      onResolve={(event) => {
        void handleResolve(event);
      }}
      onSelectedCandidateChange={setSelectedCandidateId}
      query={query}
      resolving={resolving}
      resolution={resolution}
      selectedCandidateId={selectedCandidateId}
      selecting={selecting}
    />
  );

  return (
    <PageContainer className="property-layout">
      <aside aria-label="Property dossier navigation" className="property-rail">
        <Link className="back-link" href="/projects">
          ← Projects
        </Link>
        <div>
          <strong>{state.project.name}</strong>
          <span>Property dossier</span>
          <span>{state.session.actor.role} access</span>
        </div>
        <nav aria-label="On this page">
          <a href="#property-summary">Summary</a>
          {state.dossier ? <a href="#dossier-items-title">Dossier items</a> : null}
          {state.dossier ? <a href="#sources-title">Sources</a> : null}
        </nav>
        <p>Fixture and manual data only. Never use this build for a real address.</p>
      </aside>

      <section aria-labelledby="property-title" className="property-main" id="property-summary">
        <div className="fixture-banner" role="note">
          <strong>Local fixture · Synthetic property data</strong>
          <span>
            Live address, EPC and planning providers are disabled. Do not enter a real address.
          </span>
        </div>

        <header className="property-heading">
          <div>
            <h1 id="property-title">Property and home dossier</h1>
            <p>
              Select an addressable identity, then inspect what each source supports and every gap
              it leaves unknown.
            </p>
          </div>
          <span>{state.session.actor.role === "viewer" ? "Read only" : "Can update"}</span>
        </header>

        <div aria-atomic="true" aria-live="polite" className="visually-announced">
          {notice}
        </div>

        {notice ? (
          <div className="success-note" role="status">
            {notice}
          </div>
        ) : null}
        {operationError ? (
          <div className="inline-alert" ref={operationErrorRef} role="alert" tabIndex={-1}>
            <strong>{operationError.title}</strong>
            <span>{operationError.message}</span>
          </div>
        ) : null}

        {!canMutate ? (
          <div className="viewer-note" role="note">
            <strong>Viewer access</strong>
            <p>
              You can inspect the selected identity, dossier and source records. Search, selection
              and refresh are unavailable.
            </p>
          </div>
        ) : null}

        {state.dossier ? (
          <>
            {canMutate ? (
              <details className="property-change">
                <summary>Search or change the selected property</summary>
                {searchPanel}
              </details>
            ) : null}
            <DossierView
              canMutate={canMutate}
              conflict={conflict}
              dossier={state.dossier}
              onRefresh={() => {
                void handleRefresh();
              }}
              onReload={() => {
                void load();
              }}
              refreshing={refreshing}
              sources={state.sources}
            />
          </>
        ) : canMutate ? (
          searchPanel
        ) : (
          <section className="property-empty-readonly">
            <h2>No property has been selected</h2>
            <p>
              An owner or editor must select a synthetic or manual property identity before a viewer
              can inspect a dossier.
            </p>
          </section>
        )}
      </section>
    </PageContainer>
  );
}

interface SearchPanelProps {
  currentVersion: number;
  manualDraft: ManualDraft;
  manualOpen: boolean;
  onCandidateSelect: (candidateId: string) => void;
  onManualChange: (draft: ManualDraft) => void;
  onManualSubmit: (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => void;
  onManualToggle: () => void;
  onQueryChange: (query: string) => void;
  onResolve: (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => void;
  onSelectedCandidateChange: (candidateId: string) => void;
  query: string;
  resolving: boolean;
  resolution: PropertyResolutionResponse | undefined;
  selectedCandidateId: string;
  selecting: boolean;
}

function PropertySearchPanel(props: SearchPanelProps) {
  return (
    <section aria-labelledby="property-search-title" className="property-search">
      <header>
        <p className="section-label">Property identity</p>
        <h2 id="property-search-title">Search synthetic fixtures or enter one manually</h2>
        <p>Search uses a repository-owned catalogue. It never calls a live address provider.</p>
      </header>
      <form className="property-search-form" onSubmit={props.onResolve}>
        <label htmlFor="property-query">Synthetic address search</label>
        <div>
          <input
            autoComplete="off"
            disabled={props.resolving || props.selecting}
            id="property-query"
            maxLength={160}
            minLength={3}
            onChange={(event) => {
              props.onQueryChange(event.target.value);
            }}
            placeholder="Try: Example Mews"
            required
            value={props.query}
          />
          <ActionButton disabled={props.resolving || props.query.trim().length < 3} type="submit">
            {props.resolving ? "Searching…" : "Search fixtures"}
          </ActionButton>
        </div>
      </form>

      {props.resolution ? (
        <ResolutionResult
          onCandidateSelect={props.onCandidateSelect}
          onSelectedCandidateChange={props.onSelectedCandidateChange}
          resolution={props.resolution}
          selectedCandidateId={props.selectedCandidateId}
          selecting={props.selecting}
        />
      ) : null}

      <div className="manual-entry-toggle">
        <div>
          <strong>Manual fallback</strong>
          <span>Saves only what you type. It adds no UPRN or coordinate.</span>
        </div>
        <ActionButton onClick={props.onManualToggle} tone="secondary">
          {props.manualOpen ? "Close manual entry" : "Enter manually"}
        </ActionButton>
      </div>

      {props.manualOpen ? (
        <ManualEntryForm
          draft={props.manualDraft}
          onChange={props.onManualChange}
          onSubmit={props.onManualSubmit}
          selecting={props.selecting}
        />
      ) : null}
      <p className="property-version-note">Expected property version: {props.currentVersion}</p>
    </section>
  );
}

function ResolutionResult({
  onCandidateSelect,
  onSelectedCandidateChange,
  resolution,
  selectedCandidateId,
  selecting,
}: {
  onCandidateSelect: (candidateId: string) => void;
  onSelectedCandidateChange: (candidateId: string) => void;
  resolution: PropertyResolutionResponse;
  selectedCandidateId: string;
  selecting: boolean;
}) {
  if (resolution.status === "no-match") {
    return (
      <div className="resolution-state" role="status">
        <strong>No synthetic match</strong>
        <p>No identity was selected. Try a different fixture query or use manual entry.</p>
      </div>
    );
  }

  if (resolution.status === "unavailable") {
    const disabled = resolution.providerState === "disabled";
    return (
      <div className="resolution-state" data-state={disabled ? "disabled" : "outage"} role="status">
        <strong>
          {disabled ? "Property provider disabled" : "Property search temporarily unavailable"}
        </strong>
        <p>
          {disabled
            ? "No live or fixture result was substituted. Manual entry remains available."
            : "The deterministic adapter reported an outage. Nothing was selected; retry or use manual entry."}
        </p>
      </div>
    );
  }

  const ambiguous = resolution.status === "ambiguous";
  return (
    <div className="resolution-results">
      <div className="resolution-results__heading">
        <div>
          <strong>
            {ambiguous ? "Choose one of the matching identities" : "One exact synthetic result"}
          </strong>
          <p>
            {ambiguous
              ? "The point is shared, so the system will not choose for you."
              : "Review the identity and source before selecting it."}
          </p>
        </div>
        <span>Expires {formatPropertyDate(resolution.expiresAt)}</span>
      </div>
      {ambiguous ? (
        <fieldset className="candidate-list">
          <legend>Select one property identity</legend>
          {resolution.candidates.map((candidate) => (
            <CandidateOption
              candidate={candidate}
              checked={selectedCandidateId === candidate.candidateId}
              key={candidate.candidateId}
              onChange={onSelectedCandidateChange}
            />
          ))}
          <ActionButton
            disabled={!selectedCandidateId || selecting}
            onClick={() => {
              onCandidateSelect(selectedCandidateId);
            }}
          >
            {selecting ? "Selecting property…" : "Choose this property"}
          </ActionButton>
        </fieldset>
      ) : (
        <div className="candidate-exact">
          <CandidateSummary candidate={resolution.candidates[0]} />
          <ActionButton
            disabled={selecting}
            onClick={() => {
              onCandidateSelect(resolution.candidates[0]?.candidateId ?? "");
            }}
          >
            {selecting ? "Selecting property…" : "Use this property"}
          </ActionButton>
        </div>
      )}
    </div>
  );
}

function CandidateOption({
  candidate,
  checked,
  onChange,
}: {
  candidate: PropertyCandidate;
  checked: boolean;
  onChange: (candidateId: string) => void;
}) {
  return (
    <label className="candidate-option" data-selected={checked}>
      <input
        checked={checked}
        name="property-candidate"
        onChange={() => {
          onChange(candidate.candidateId);
        }}
        type="radio"
        value={candidate.candidateId}
      />
      <CandidateSummary candidate={candidate} />
    </label>
  );
}

function CandidateSummary({ candidate }: { candidate: PropertyCandidate | undefined }) {
  if (!candidate) return <p>No candidate was returned.</p>;
  return (
    <div className="candidate-summary">
      <strong>{candidate.displayAddress}</strong>
      <span>UPRN {candidate.identifiers[0]?.value ?? "not supplied"}</span>
      <span>
        {candidate.source.dataset} · {candidate.source.datasetVersion} ·{" "}
        {candidate.source.coverage.replace("-", " ")}
      </span>
      <span>Licence: {candidate.source.licence.title}</span>
      {candidate.location ? (
        <small>
          Shared identity point: {candidate.location.crs}{" "}
          {candidate.location.coordinates.join(", ")} · not a boundary or interior
        </small>
      ) : null}
    </div>
  );
}

function ManualEntryForm({
  draft,
  onChange,
  onSubmit,
  selecting,
}: {
  draft: ManualDraft;
  onChange: (draft: ManualDraft) => void;
  onSubmit: (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => void;
  selecting: boolean;
}) {
  return (
    <form className="manual-entry-form" onSubmit={onSubmit}>
      <div className="manual-warning" role="note">
        <strong>Synthetic entries only</strong>
        <span>Do not enter a real address, customer data or provider output.</span>
      </div>
      <div className="manual-grid">
        <label>
          <span>Address line 1</span>
          <input
            autoComplete="off"
            disabled={selecting}
            maxLength={120}
            onChange={(event) => {
              onChange({ ...draft, line1: event.target.value });
            }}
            required
            value={draft.line1}
          />
        </label>
        <label>
          <span>
            Address line 2 <small>optional</small>
          </span>
          <input
            autoComplete="off"
            disabled={selecting}
            maxLength={120}
            onChange={(event) => {
              onChange({ ...draft, line2: event.target.value });
            }}
            value={draft.line2}
          />
        </label>
        <label>
          <span>
            Locality <small>optional</small>
          </span>
          <input
            autoComplete="off"
            disabled={selecting}
            maxLength={120}
            onChange={(event) => {
              onChange({ ...draft, locality: event.target.value });
            }}
            value={draft.locality}
          />
        </label>
        <label>
          <span>
            Postcode <small>optional</small>
          </span>
          <input
            autoComplete="off"
            disabled={selecting}
            maxLength={16}
            onChange={(event) => {
              onChange({ ...draft, postcode: event.target.value });
            }}
            value={draft.postcode}
          />
        </label>
        <label>
          <span>Jurisdiction</span>
          <select
            disabled={selecting}
            onChange={(event) => {
              onChange({ ...draft, jurisdiction: event.target.value as PropertyJurisdiction });
            }}
            value={draft.jurisdiction}
          >
            <option value="unknown">Unknown</option>
            <option value="england">England</option>
            <option value="wales">Wales</option>
            <option value="scotland">Scotland</option>
            <option value="northern-ireland">Northern Ireland</option>
          </select>
        </label>
      </div>
      <div className="manual-entry-actions">
        <p>No UPRN, coordinate, boundary, planning status or interior fact will be invented.</p>
        <ActionButton disabled={selecting || draft.line1.trim().length === 0} type="submit">
          {selecting ? "Saving manual identity…" : "Save manual identity"}
        </ActionButton>
      </div>
    </form>
  );
}

function PropertyState({
  action,
  actionHref,
  actionLabel,
  message,
  title,
}: {
  action?: () => Promise<void>;
  actionHref?: string;
  actionLabel: string;
  message: string;
  title: string;
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
          <ActionButton
            onClick={() => {
              void action?.();
            }}
          >
            {actionLabel}
          </ActionButton>
        )}
      </section>
    </PageContainer>
  );
}
