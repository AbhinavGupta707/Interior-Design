import {
  createSceneJobRequestSchema,
  sceneAccessResponseSchema,
  sceneJobSchema,
  sceneRecordSchema,
} from "@interior-design/contracts";
import type {
  CreateSceneJobRequest,
  SceneAccessResponse,
  SceneJob,
  SceneRecord,
} from "@interior-design/contracts";
import type { ZodType } from "zod";

import {
  sceneAccessRequestSchema,
  sceneTransitionRequestSchema,
  sceneWorkspaceSchema,
} from "./contracts";
import type { SceneWorkspace } from "./contracts";

export type SceneProblemKind =
  | "conflict"
  | "expired"
  | "expired-link"
  | "forbidden"
  | "invalid-response"
  | "not-found"
  | "offline"
  | "unavailable";

interface ProblemPayload {
  readonly code?: unknown;
  readonly detail?: unknown;
}

export class SceneProblem extends Error {
  constructor(
    readonly kind: SceneProblemKind,
    message: string,
    readonly status = 0,
    readonly code?: string,
  ) {
    super(message);
    this.name = "SceneProblem";
  }
}

export type SceneTransport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function problemKind(status: number, code?: string): SceneProblemKind {
  if (status === 401) return "expired";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 409) return "conflict";
  if (status === 410 || code === "SCENE_ACCESS_EXPIRED") return "expired-link";
  return "unavailable";
}

async function responseProblem(response: Response): Promise<SceneProblem> {
  const payload: unknown = await response.json().catch(() => undefined);
  const problem =
    typeof payload === "object" && payload !== null ? (payload as ProblemPayload) : undefined;
  const code = typeof problem?.code === "string" ? problem.code : undefined;
  return new SceneProblem(
    problemKind(response.status, code),
    typeof problem?.detail === "string"
      ? problem.detail
      : "The scene request could not be completed.",
    response.status,
    code,
  );
}

function mutation(body: unknown): RequestInit {
  return {
    body: JSON.stringify(body),
    headers: {
      accept: "application/json, application/problem+json",
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    method: "POST",
  };
}

function base(projectId: string): string {
  return `/api/c10/projects/${encodeURIComponent(projectId)}`;
}

export function createSceneClient(transport: SceneTransport = fetch) {
  async function request<T>(url: string, schema: ZodType<T>, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await transport(url, { ...init, cache: "no-store" });
    } catch {
      throw new SceneProblem(
        "offline",
        "You appear to be offline. Reconnect and reload; no scene state was changed.",
      );
    }
    if (!response.ok) throw await responseProblem(response);
    const payload: unknown = await response.json().catch(() => undefined);
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new SceneProblem(
        "invalid-response",
        "The service response did not match the frozen C4/C10 contracts.",
        502,
        "INVALID_UPSTREAM_RESPONSE",
      );
    }
    return parsed.data;
  }

  return Object.freeze({
    cancel(projectId: string, job: SceneJob): Promise<SceneJob> {
      const body = sceneTransitionRequestSchema.parse({ expectedVersion: job.version });
      return request(
        `${base(projectId)}/scene-jobs/${encodeURIComponent(job.id)}/cancel`,
        sceneJobSchema,
        mutation(body),
      );
    },
    createJob(projectId: string, value: CreateSceneJobRequest): Promise<SceneJob> {
      const body = createSceneJobRequestSchema.parse(value);
      return request(`${base(projectId)}/scene-jobs`, sceneJobSchema, mutation(body));
    },
    getJob(projectId: string, jobId: string): Promise<SceneJob> {
      return request(`${base(projectId)}/scene-jobs/${encodeURIComponent(jobId)}`, sceneJobSchema);
    },
    getScene(projectId: string, jobId: string): Promise<SceneRecord> {
      return request(
        `${base(projectId)}/scene-jobs/${encodeURIComponent(jobId)}/scene`,
        sceneRecordSchema,
      );
    },
    loadWorkspace(projectId: string): Promise<SceneWorkspace> {
      return request(`${base(projectId)}/workspace`, sceneWorkspaceSchema);
    },
    requestAccess(projectId: string, jobId: string): Promise<SceneAccessResponse> {
      const body = sceneAccessRequestSchema.parse({});
      return request(
        `${base(projectId)}/scene-jobs/${encodeURIComponent(jobId)}/scene/access`,
        sceneAccessResponseSchema,
        mutation(body),
      );
    },
    retry(projectId: string, job: SceneJob): Promise<SceneJob> {
      const body = sceneTransitionRequestSchema.parse({ expectedVersion: job.version });
      return request(
        `${base(projectId)}/scene-jobs/${encodeURIComponent(job.id)}/retry`,
        sceneJobSchema,
        mutation(body),
      );
    },
  });
}

export const sceneClient = createSceneClient();
