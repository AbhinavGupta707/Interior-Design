import {
  createProjectRequestSchema,
  homeIntakeSchema,
  localSessionRequestSchema,
  projectIntakeSchema,
  projectSchema,
  sessionSchema,
  upsertProjectIntakeRequestSchema,
} from "@interior-design/contracts";
import type {
  HomeIntake,
  LocalPersona,
  Project,
  ProjectIntake,
  Session,
} from "@interior-design/contracts";
import { z } from "zod";

export type ClientProblemKind =
  "expired" | "forbidden" | "invalid-response" | "offline" | "stale" | "unavailable";

export class ClientProblem extends Error {
  readonly kind: ClientProblemKind;
  readonly status: number;

  constructor(kind: ClientProblemKind, message: string, status = 0) {
    super(message);
    this.name = "ClientProblem";
    this.kind = kind;
    this.status = status;
  }
}

function problemKind(status: number): ClientProblemKind {
  if (status === 401) return "expired";
  if (status === 403 || status === 404) return "forbidden";
  if (status === 409) return "stale";
  return "unavailable";
}

async function request<T>(input: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    const headers = new Headers(init?.headers);
    headers.set("accept", "application/json, application/problem+json");
    response = await fetch(input, {
      ...init,
      cache: "no-store",
      headers,
    });
  } catch {
    throw new ClientProblem(
      "offline",
      "You appear to be offline. Check the connection and try again.",
    );
  }

  if (!response.ok) {
    const problem: unknown = await response.json().catch(() => undefined);
    const detail =
      typeof problem === "object" &&
      problem !== null &&
      "detail" in problem &&
      typeof problem.detail === "string"
        ? problem.detail
        : "The request could not be completed.";
    throw new ClientProblem(problemKind(response.status), detail, response.status);
  }

  const payload: unknown = await response.json().catch(() => undefined);
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new ClientProblem(
      "invalid-response",
      "The service response did not match the frozen C1 contract.",
      502,
    );
  }
  return result.data;
}

function mutationHeaders(): HeadersInit {
  return {
    "content-type": "application/json",
    "idempotency-key": crypto.randomUUID(),
  };
}

export function signIn(persona: LocalPersona): Promise<Session> {
  const body = localSessionRequestSchema.parse({ persona });
  return request("/api/c1/session", sessionSchema, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

export function getSession(): Promise<Session> {
  return request("/api/c1/session", sessionSchema);
}

export async function signOut(): Promise<void> {
  try {
    await fetch("/api/c1/session", { method: "DELETE" });
  } catch {
    // A local sign-out remains useful while offline; the HTTP-only cookie expires server-side next time.
  }
}

export function listProjects(): Promise<Project[]> {
  return request("/api/c1/projects", z.array(projectSchema));
}

export function createProject(name: string): Promise<Project> {
  const body = createProjectRequestSchema.parse({ name });
  return request("/api/c1/projects", projectSchema, {
    body: JSON.stringify(body),
    headers: mutationHeaders(),
    method: "POST",
  });
}

export function getProject(projectId: string): Promise<Project> {
  return request(`/api/c1/projects/${encodeURIComponent(projectId)}`, projectSchema);
}

export async function getProjectIntake(projectId: string): Promise<ProjectIntake | null> {
  let response: Response;
  try {
    response = await fetch(`/api/c1/projects/${encodeURIComponent(projectId)}/intake`, {
      cache: "no-store",
      headers: { accept: "application/json, application/problem+json" },
    });
  } catch {
    throw new ClientProblem(
      "offline",
      "You appear to be offline. Check the connection and try again.",
    );
  }

  if (response.status === 204) return null;
  if (!response.ok) {
    const problem: unknown = await response.json().catch(() => undefined);
    const detail =
      typeof problem === "object" &&
      problem !== null &&
      "detail" in problem &&
      typeof problem.detail === "string"
        ? problem.detail
        : "The intake could not be loaded.";
    throw new ClientProblem(problemKind(response.status), detail, response.status);
  }

  const payload: unknown = await response.json().catch(() => undefined);
  const parsed = projectIntakeSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ClientProblem(
      "invalid-response",
      "The service response did not match the frozen C1 contract.",
      502,
    );
  }
  return parsed.data;
}

export function saveProjectIntake(
  projectId: string,
  intake: HomeIntake,
  expectedVersion: number,
): Promise<ProjectIntake> {
  const body = upsertProjectIntakeRequestSchema.parse({ expectedVersion, intake });
  return request(`/api/c1/projects/${encodeURIComponent(projectId)}/intake`, projectIntakeSchema, {
    body: JSON.stringify(body),
    headers: mutationHeaders(),
    method: "PUT",
  });
}

export function validateHomeIntake(value: HomeIntake) {
  return homeIntakeSchema.safeParse(value);
}
