"use client";

import type { Project, Session } from "@interior-design/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SyntheticEvent } from "react";

import { ActionButton, LoadingIndicator, PageContainer } from "../../components/ui-primitives";
import { ClientProblem, createProject, getSession, listProjects, signOut } from "../auth/api";

type ProjectViewState =
  | { kind: "empty"; session: Session }
  | { kind: "error"; message: string }
  | { kind: "expired" }
  | { kind: "forbidden" }
  | { kind: "loading" }
  | { kind: "offline" }
  | { kind: "ready"; projects: Project[]; session: Session };

function formatUpdate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function stateFromProblem(problem: ClientProblem): ProjectViewState {
  if (problem.kind === "expired") return { kind: "expired" };
  if (problem.kind === "forbidden") return { kind: "forbidden" };
  if (problem.kind === "offline") return { kind: "offline" };
  return { kind: "error", message: problem.message };
}

export function ProjectsScreen() {
  const router = useRouter();
  const [state, setState] = useState<ProjectViewState>({ kind: "loading" });
  const [projectName, setProjectName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string>();
  const createErrorRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const [session, projects] = await Promise.all([getSession(), listProjects()]);
      setState(
        projects.length === 0 ? { kind: "empty", session } : { kind: "ready", projects, session },
      );
    } catch (reason) {
      setState(
        reason instanceof ClientProblem
          ? stateFromProblem(reason)
          : { kind: "error", message: "Projects could not be loaded." },
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (createError) createErrorRef.current?.focus();
  }, [createError]);

  async function handleCreate(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    setCreating(true);
    setCreateError(undefined);
    try {
      const project = await createProject(projectName);
      router.push(`/onboarding/${project.id}`);
    } catch (reason) {
      setCreateError(
        reason instanceof ClientProblem ? reason.message : "The project could not be created.",
      );
      setCreating(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    router.push("/sign-in");
  }

  if (state.kind === "loading") {
    return (
      <PageContainer className="workspace-state">
        <LoadingIndicator label="Loading your synthetic projects" />
      </PageContainer>
    );
  }

  if (state.kind === "expired") {
    return (
      <ProjectState
        actionHref="/sign-in"
        actionLabel="Sign in again"
        message="Your local fixture session has expired. No project or intake data was changed."
        title="Your session has expired"
      />
    );
  }

  if (state.kind === "forbidden") {
    return (
      <ProjectState
        action={load}
        actionLabel="Try again"
        message="This persona is not allowed to view these projects. Project existence is not disclosed across tenants."
        title="Projects are unavailable"
      />
    );
  }

  if (state.kind === "offline") {
    return (
      <ProjectState
        action={load}
        actionLabel="Try again"
        message="You appear to be offline. Reconnect to load or change projects; nothing has been submitted."
        title="You’re offline"
      />
    );
  }

  if (state.kind === "error") {
    return (
      <ProjectState
        action={load}
        actionLabel="Retry project loading"
        message={state.message}
        title="Projects could not be loaded"
      />
    );
  }

  const session = state.session;
  const projects = state.kind === "ready" ? state.projects : [];
  const canCreate = session.actor.role !== "viewer";

  return (
    <PageContainer className="workspace-layout">
      <aside className="workspace-rail" aria-label="Fixture session">
        <div className="persona-summary">
          <span aria-hidden="true" className="persona-avatar">
            {session.actor.displayName
              .split(" ")
              .map((part) => part[0])
              .join("")
              .slice(0, 2)}
          </span>
          <div>
            <strong>{session.actor.displayName}</strong>
            <span>Synthetic local persona</span>
            <span>{session.actor.role}</span>
          </div>
        </div>
        <button
          className="text-action"
          onClick={() => {
            void handleSignOut();
          }}
          type="button"
        >
          Sign out
        </button>
      </aside>

      <section className="workspace-main" aria-labelledby="projects-title">
        <div className="fixture-banner" role="note">
          <strong>Local fixture · Synthetic data</strong>
          <span>No provider key is required. Do not enter a real address.</span>
        </div>
        <header className="workspace-heading">
          <div>
            <h1 id="projects-title">Choose a project</h1>
            <p>Resume a structured intake or start a new synthetic project.</p>
          </div>
        </header>

        {canCreate ? (
          <form
            className="create-project"
            onSubmit={(event) => {
              void handleCreate(event);
            }}
          >
            <label htmlFor="project-name">New project name</label>
            <div>
              <input
                autoComplete="off"
                disabled={creating}
                id="project-name"
                maxLength={120}
                onChange={(event) => {
                  setProjectName(event.target.value);
                }}
                placeholder="For example, Sample terrace refresh"
                required
                value={projectName}
              />
              <ActionButton disabled={creating || projectName.trim().length === 0} type="submit">
                {creating ? "Creating project…" : "New project"}
              </ActionButton>
            </div>
          </form>
        ) : (
          <p className="read-only-note">Viewer fixture: projects can be resumed read-only.</p>
        )}

        {createError ? (
          <div className="inline-alert" ref={createErrorRef} role="alert" tabIndex={-1}>
            <strong>Project not created</strong>
            <span>{createError}</span>
          </div>
        ) : null}

        {projects.length === 0 ? (
          <div className="empty-state">
            <span aria-hidden="true">＋</span>
            <h2>No projects yet</h2>
            <p>Create a synthetic project to start its home and design intake.</p>
          </div>
        ) : (
          <div className="project-list" aria-label="Your synthetic projects">
            {projects.map((project) => (
              <article className="project-row" key={project.id}>
                <div>
                  <h2>{project.name}</h2>
                  <p>
                    <span>{project.status}</span>
                    <span>Updated {formatUpdate(project.updatedAt)}</span>
                  </p>
                </div>
                <div className="project-row__actions">
                  <Link className="project-row__action" href={`/onboarding/${project.id}`}>
                    Resume intake
                  </Link>
                  <Link className="project-row__action" href={`/design-consultation/${project.id}`}>
                    Design consultation
                  </Link>
                  <Link className="project-row__action" href={`/evidence/${project.id}`}>
                    Evidence
                  </Link>
                  <Link className="project-row__action" href={`/property/${project.id}`}>
                    Property dossier
                  </Link>
                  <Link className="project-row__action" href={`/editor/${project.id}`}>
                    2D editor
                  </Link>
                  <Link className="project-row__action" href={`/plan-import/${project.id}`}>
                    Correct floor plan
                  </Link>
                  <Link className="project-row__action" href={`/reconstruction/${project.id}`}>
                    Reconstruct media
                  </Link>
                  <Link className="project-row__action" href={`/fusion/${project.id}`}>
                    Reconcile sources
                  </Link>
                  <Link className="project-row__action" href={`/viewer/${project.id}`}>
                    3D walkthrough
                  </Link>
                  <Link className="project-row__action" href={`/design-options/${project.id}`}>
                    Design options
                  </Link>
                  <Link className="project-row__action" href={`/materials-products/${project.id}`}>
                    Materials &amp; room specification
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </PageContainer>
  );
}

interface ProjectStateProps {
  action?: () => Promise<void>;
  actionHref?: string;
  actionLabel: string;
  message: string;
  title: string;
}

function ProjectState({ action, actionHref, actionLabel, message, title }: ProjectStateProps) {
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
