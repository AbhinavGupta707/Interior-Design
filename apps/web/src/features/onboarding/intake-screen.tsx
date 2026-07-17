"use client";

import type { HomeIntake, Project, ProjectIntake } from "@interior-design/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SyntheticEvent } from "react";

import { ActionButton, LoadingIndicator, PageContainer } from "../../components/ui-primitives";
import {
  ClientProblem,
  getProject,
  getProjectIntake,
  saveProjectIntake,
  validateHomeIntake,
} from "../auth/api";
import { createEmptyIntake, linesToList, listToLines, optionalCount } from "./intake-model";
import type { TextListField } from "./intake-model";

type LoadState =
  | { kind: "error"; message: string }
  | { kind: "expired" }
  | { kind: "forbidden" }
  | { kind: "loading" }
  | { kind: "offline" }
  | { intake: ProjectIntake | null; kind: "ready"; project: Project };

type SaveState = "idle" | "saved" | "saving" | "stale";

const dwellingOptions: Array<{ label: string; value: HomeIntake["dwellingType"] }> = [
  { label: "Flat", value: "flat" },
  { label: "Terraced house", value: "terraced-house" },
  { label: "Semi-detached house", value: "semi-detached-house" },
  { label: "Detached house", value: "detached-house" },
  { label: "Bungalow", value: "bungalow" },
  { label: "Other", value: "other" },
];

function stateFromProblem(problem: ClientProblem): LoadState {
  if (problem.kind === "expired") return { kind: "expired" };
  if (problem.kind === "forbidden") return { kind: "forbidden" };
  if (problem.kind === "offline") return { kind: "offline" };
  return { kind: "error", message: problem.message };
}

export function IntakeScreen({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [draft, setDraft] = useState<HomeIntake>(createEmptyIntake);
  const [version, setVersion] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string>();
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const errorSummaryRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoadState({ kind: "loading" });
    try {
      const [project, intake] = await Promise.all([
        getProject(projectId),
        getProjectIntake(projectId),
      ]);
      setDraft(intake?.intake ?? createEmptyIntake());
      setVersion(intake?.version ?? 0);
      setSaveState("idle");
      setSaveError(undefined);
      setLoadState({ intake, kind: "ready", project });
    } catch (reason) {
      setLoadState(
        reason instanceof ClientProblem
          ? stateFromProblem(reason)
          : { kind: "error", message: "The home intake could not be loaded." },
      );
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (validationErrors.length > 0 || saveError) errorSummaryRef.current?.focus();
  }, [saveError, validationErrors]);

  function updateList(field: TextListField, value: string) {
    setDraft((current) => ({ ...current, [field]: linesToList(value) }));
    setSaveState("idle");
  }

  function updateHousehold(field: keyof HomeIntake["household"], value: string) {
    setDraft((current) => ({
      ...current,
      household: { ...current.household, [field]: Number(value) },
    }));
    setSaveState("idle");
  }

  function updateEvidence(field: keyof HomeIntake["evidenceAvailable"], checked: boolean) {
    setDraft((current) => ({
      ...current,
      evidenceAvailable: { ...current.evidenceAvailable, [field]: checked },
    }));
    setSaveState("idle");
  }

  async function handleSave(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const submitter = event.nativeEvent.submitter as HTMLButtonElement | null;
    const shouldContinue = submitter?.value === "continue";
    const validation = validateHomeIntake(draft);
    if (!validation.success) {
      setValidationErrors(
        validation.error.issues.map((issue) => {
          const field = issue.path.length > 0 ? issue.path.join(" · ") : "Home intake";
          return `${field}: ${issue.message}`;
        }),
      );
      return;
    }

    setValidationErrors([]);
    setSaveError(undefined);
    setSaveState("saving");
    try {
      const saved = await saveProjectIntake(projectId, validation.data, version);
      setDraft(saved.intake);
      setVersion(saved.version);
      setSaveState("saved");
      if (shouldContinue) router.push("/projects");
    } catch (reason) {
      if (reason instanceof ClientProblem && reason.kind === "stale") {
        setSaveState("stale");
        return;
      }
      setSaveState("idle");
      setSaveError(
        reason instanceof ClientProblem ? reason.message : "The intake could not be saved.",
      );
    }
  }

  if (loadState.kind === "loading") {
    return (
      <PageContainer className="workspace-state">
        <LoadingIndicator label="Loading the structured home intake" />
      </PageContainer>
    );
  }

  if (loadState.kind !== "ready") {
    const content = {
      error: {
        action: "Retry loading",
        message: loadState.kind === "error" ? loadState.message : "The intake could not be loaded.",
        title: "Intake unavailable",
      },
      expired: {
        action: "Sign in again",
        message: "Your fixture session expired. No intake changes were submitted.",
        title: "Your session has expired",
      },
      forbidden: {
        action: "Return to projects",
        message: "This project is unavailable. Projects from another tenant are not disclosed.",
        title: "Project unavailable",
      },
      offline: {
        action: "Try again",
        message: "Reconnect before loading or saving this intake. Nothing has been submitted.",
        title: "You’re offline",
      },
    }[loadState.kind];
    const href = loadState.kind === "expired" ? "/sign-in" : "/projects";

    return (
      <PageContainer className="workspace-state">
        <section className="standalone-state" role="status">
          <h1>{content.title}</h1>
          <p>{content.message}</p>
          {loadState.kind === "offline" || loadState.kind === "error" ? (
            <ActionButton
              onClick={() => {
                void load();
              }}
            >
              {content.action}
            </ActionButton>
          ) : (
            <Link className="ui-action" data-tone="primary" href={href}>
              {content.action}
            </Link>
          )}
        </section>
      </PageContainer>
    );
  }

  const { project } = loadState;
  const goalInvalid = validationErrors.some((message) => message.startsWith("goals"));

  return (
    <PageContainer className="intake-layout">
      <aside className="intake-rail" aria-label="Intake progress">
        <Link className="back-link" href="/projects">
          ← Projects
        </Link>
        <div>
          <span>Selected project</span>
          <strong>{project.name}</strong>
          <small>Synthetic project · {project.status}</small>
        </div>
        <ol>
          <li aria-current="step">Home basics</li>
          <li>Household</li>
          <li>Design direction</li>
          <li>Evidence available</li>
        </ol>
        <p>You can save and return. Optional fields may remain unknown.</p>
      </aside>

      <section className="intake-main" aria-labelledby="intake-title">
        <header className="intake-heading">
          <div>
            <h1 id="intake-title">Tell us about your home</h1>
            <p>
              Add what you know now. You can save and return without filling every optional field.
            </p>
          </div>
          <div className="save-status" aria-live="polite" data-state={saveState}>
            {saveState === "saving"
              ? "Saving…"
              : saveState === "saved"
                ? `Saved · version ${String(version)}`
                : version > 0
                  ? `Saved version ${String(version)}`
                  : "Not saved yet"}
          </div>
        </header>

        {saveState === "stale" ? (
          <div className="stale-alert" role="alert">
            <div>
              <strong>A newer intake was saved elsewhere.</strong>
              <span>
                Your edits were not overwritten. Load the latest saved version before editing again.
              </span>
            </div>
            <ActionButton
              onClick={() => {
                void load();
              }}
              tone="secondary"
            >
              Load latest saved version
            </ActionButton>
          </div>
        ) : null}

        {validationErrors.length > 0 || saveError ? (
          <div className="error-summary" ref={errorSummaryRef} role="alert" tabIndex={-1}>
            <strong>
              {saveError ? "The intake was not saved" : "Check the intake before saving"}
            </strong>
            {saveError ? <p>{saveError}</p> : null}
            {validationErrors.length > 0 ? (
              <ul>
                {validationErrors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <form
          className="intake-form"
          onSubmit={(event) => {
            void handleSave(event);
          }}
        >
          <fieldset disabled={saveState === "saving" || saveState === "stale"}>
            <legend>Home basics</legend>
            <div className="form-grid form-grid--four">
              <label>
                <span>Dwelling type</span>
                <select
                  onChange={(event) => {
                    setDraft((current) => ({
                      ...current,
                      dwellingType: event.target.value as HomeIntake["dwellingType"],
                    }));
                    setSaveState("idle");
                  }}
                  value={draft.dwellingType}
                >
                  {dwellingOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <OptionalNumber
                label="Bedrooms"
                max={30}
                onChange={(value) => {
                  setDraft((current) => ({ ...current, bedrooms: value }));
                  setSaveState("idle");
                }}
                value={draft.bedrooms}
              />
              <OptionalNumber
                label="Bathrooms"
                max={20}
                onChange={(value) => {
                  setDraft((current) => ({ ...current, bathrooms: value }));
                  setSaveState("idle");
                }}
                value={draft.bathrooms}
              />
              <OptionalNumber
                label="Levels"
                max={10}
                min={1}
                onChange={(value) => {
                  setDraft((current) => ({ ...current, levels: value }));
                  setSaveState("idle");
                }}
                value={draft.levels}
              />
            </div>
            <label className="field-wide">
              <span>
                Address summary <small>Optional</small>
              </span>
              <input
                maxLength={160}
                onChange={(event) => {
                  setDraft((current) => ({
                    ...current,
                    addressSummary: event.target.value || undefined,
                  }));
                  setSaveState("idle");
                }}
                placeholder="Synthetic summary only, for example North-facing sample flat"
                value={draft.addressSummary ?? ""}
              />
              <small className="field-description">
                Do not enter a real address in this C1 fixture build.
              </small>
            </label>
          </fieldset>

          <fieldset disabled={saveState === "saving" || saveState === "stale"}>
            <legend>Household</legend>
            <div className="form-grid form-grid--three">
              {(["adults", "children", "pets"] as const).map((field) => (
                <label key={field}>
                  <span>{field.charAt(0).toUpperCase() + field.slice(1)}</span>
                  <input
                    max={30}
                    min={0}
                    onChange={(event) => {
                      updateHousehold(field, event.target.value);
                    }}
                    required
                    type="number"
                    value={draft.household[field]}
                  />
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset disabled={saveState === "saving" || saveState === "stale"}>
            <legend>Design direction</legend>
            <p className="field-description">
              Use one concise item per line. Goals require at least one item.
            </p>
            <div className="form-grid form-grid--two">
              <ListField
                invalid={goalInvalid}
                label="Goals"
                onChange={(value) => {
                  updateList("goals", value);
                }}
                required
                value={draft.goals}
              />
              <ListField
                label="Must keep"
                onChange={(value) => {
                  updateList("mustKeep", value);
                }}
                value={draft.mustKeep}
              />
              <ListField
                label="Must change"
                onChange={(value) => {
                  updateList("mustChange", value);
                }}
                value={draft.mustChange}
              />
              <ListField
                label="Style words"
                onChange={(value) => {
                  updateList("styleWords", value);
                }}
                value={draft.styleWords}
              />
              <ListField
                label="Accessibility needs"
                onChange={(value) => {
                  updateList("accessibilityNeeds", value);
                }}
                value={draft.accessibilityNeeds}
              />
              <label>
                <span>
                  Notes <small>Optional</small>
                </span>
                <textarea
                  maxLength={2000}
                  onChange={(event) => {
                    setDraft((current) => ({ ...current, notes: event.target.value || undefined }));
                    setSaveState("idle");
                  }}
                  rows={4}
                  value={draft.notes ?? ""}
                />
              </label>
            </div>
          </fieldset>

          <fieldset disabled={saveState === "saving" || saveState === "stale"}>
            <legend>Evidence you already have</legend>
            <div className="evidence-grid">
              <EvidenceOption
                checked={draft.evidenceAvailable.plans}
                label="Plans"
                onChange={(checked) => {
                  updateEvidence("plans", checked);
                }}
              />
              <EvidenceOption
                checked={draft.evidenceAvailable.photographs}
                label="Photographs"
                onChange={(checked) => {
                  updateEvidence("photographs", checked);
                }}
              />
              <EvidenceOption
                checked={draft.evidenceAvailable.video}
                label="Video"
                onChange={(checked) => {
                  updateEvidence("video", checked);
                }}
              />
              <EvidenceOption
                checked={draft.evidenceAvailable.roomCapture}
                description="Selection only — native capture is not implemented in C1."
                label="Room capture"
                onChange={(checked) => {
                  updateEvidence("roomCapture", checked);
                }}
              />
            </div>
          </fieldset>

          <div className="intake-actions">
            <span>Changes are sent only when you choose save.</span>
            <div>
              <ActionButton
                disabled={saveState === "saving" || saveState === "stale"}
                tone="secondary"
                type="submit"
                value="draft"
              >
                Save draft
              </ActionButton>
              <ActionButton
                disabled={saveState === "saving" || saveState === "stale"}
                type="submit"
                value="continue"
              >
                Save and continue
              </ActionButton>
            </div>
          </div>
        </form>
      </section>
    </PageContainer>
  );
}

function OptionalNumber({
  label,
  max,
  min = 0,
  onChange,
  value,
}: {
  label: string;
  max: number;
  min?: number;
  onChange: (value: number | undefined) => void;
  value: number | undefined;
}) {
  return (
    <label>
      <span>
        {label} <small>Optional</small>
      </span>
      <input
        max={max}
        min={min}
        onChange={(event) => {
          onChange(optionalCount(event.target.value));
        }}
        type="number"
        value={value ?? ""}
      />
    </label>
  );
}

function ListField({
  invalid = false,
  label,
  onChange,
  required = false,
  value,
}: {
  invalid?: boolean;
  label: string;
  onChange: (value: string) => void;
  required?: boolean;
  value: readonly string[];
}) {
  return (
    <label>
      <span>
        {label}
        {required ? " *" : ""}
      </span>
      <textarea
        aria-invalid={invalid || undefined}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        required={required}
        rows={4}
        value={listToLines(value)}
      />
    </label>
  );
}

function EvidenceOption({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description?: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="evidence-option">
      <input
        checked={checked}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
        type="checkbox"
      />
      <span>
        <strong>{label}</strong>
        <small>{description ?? "Mark this source as available for a later evidence step."}</small>
      </span>
    </label>
  );
}
