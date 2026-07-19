import {
  createRenderJobRequestSchema,
  renderArtifactAccessSchema,
  renderArtifactSchema,
  renderJobSchema,
  renderResultSchema,
} from "@interior-design/contracts";
import type {
  CreateRenderJobRequest,
  RenderArtifact,
  RenderJob,
  RenderResult,
} from "@interior-design/contracts";
import type { ZodType } from "zod";

import {
  listRenderJobsResponseSchema,
  renderCapabilitiesSchema,
  renderEnhancementJobSchema,
  renderEnhancementStatusSchema,
  requestEnhancementSchema,
  transitionRenderJobRequestSchema,
} from "./contracts";
import type {
  ListRenderJobsResponse,
  RenderArtifactAccess,
  RenderCapabilities,
  RenderEnhancementStatus,
} from "./contracts";

export type RenderStillsProblemKind =
  | "conflict"
  | "expired"
  | "forbidden"
  | "gone"
  | "interrupted"
  | "invalid-response"
  | "not-found"
  | "offline"
  | "rejected"
  | "throttled"
  | "unavailable";

interface ProblemPayload {
  readonly code?: unknown;
  readonly detail?: unknown;
}

export class RenderStillsProblem extends Error {
  constructor(
    readonly kind: RenderStillsProblemKind,
    message: string,
    readonly status = 0,
    readonly code?: string,
  ) {
    super(message);
    this.name = "RenderStillsProblem";
  }
}

export type RenderStillsTransport = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function problemKind(status: number): RenderStillsProblemKind {
  if (status === 401) return "expired";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 409) return "conflict";
  if (status === 410) return "gone";
  if (status === 422) return "rejected";
  if (status === 429) return "throttled";
  return "unavailable";
}

async function responseProblem(response: Response): Promise<RenderStillsProblem> {
  const payload: unknown = await response.json().catch(() => undefined);
  const problem =
    typeof payload === "object" && payload !== null ? (payload as ProblemPayload) : undefined;
  const message =
    typeof problem?.detail === "string" && problem.detail.length <= 500
      ? problem.detail
      : "The render-stills request could not be completed.";
  const code =
    typeof problem?.code === "string" && /^[A-Z0-9_]{3,80}$/u.test(problem.code)
      ? problem.code
      : undefined;
  return new RenderStillsProblem(problemKind(response.status), message, response.status, code);
}

function base(projectId: string): string {
  return `/api/c14/projects/${encodeURIComponent(projectId)}`;
}

function mutation(body: unknown, createId: () => string, signal?: AbortSignal): RequestInit {
  return {
    body: JSON.stringify(body),
    headers: {
      accept: "application/json, application/problem+json",
      "content-type": "application/json",
      "idempotency-key": createId(),
    },
    method: "POST",
    ...(signal ? { signal } : {}),
  };
}

export function createRenderStillsClient(
  transport: RenderStillsTransport = fetch,
  createId: () => string = () => crypto.randomUUID(),
) {
  async function request<T>(url: string, schema: ZodType<T>, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await transport(url, { ...init, cache: "no-store" });
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") {
        throw new RenderStillsProblem(
          "interrupted",
          "The render request was interrupted before confirmation. Durable server state was not inferred.",
        );
      }
      throw new RenderStillsProblem(
        "offline",
        "You appear to be offline. Existing durable render results remain unchanged.",
      );
    }
    if (!response.ok) throw await responseProblem(response);
    const payload: unknown = await response.json().catch(() => undefined);
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new RenderStillsProblem(
        "invalid-response",
        "The service response did not match the strict C14 consumer contract.",
        502,
        "INVALID_UPSTREAM_RESPONSE",
      );
    }
    return parsed.data;
  }

  function jobs(projectId: string): string {
    return `${base(projectId)}/render-jobs`;
  }

  return Object.freeze({
    cancel(projectId: string, job: RenderJob): Promise<RenderJob> {
      const body = transitionRenderJobRequestSchema.parse({ expectedVersion: job.version });
      return request(
        `${jobs(projectId)}/${encodeURIComponent(job.id)}/cancel`,
        renderJobSchema,
        mutation(body, createId),
      );
    },
    createJob(projectId: string, input: CreateRenderJobRequest): Promise<RenderJob> {
      const body = createRenderJobRequestSchema.parse(input);
      return request(jobs(projectId), renderJobSchema, mutation(body, createId));
    },
    getArtifactAccess(
      projectId: string,
      jobId: string,
      artifact: RenderArtifact,
    ): Promise<RenderArtifactAccess> {
      return request(
        `${jobs(projectId)}/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(artifact.id)}/access`,
        renderArtifactAccessSchema.refine(
          (access) =>
            access.artifactId === artifact.id &&
            access.byteLength === artifact.byteLength &&
            access.mediaType === artifact.mediaType &&
            access.role === artifact.role &&
            access.sha256 === artifact.sha256,
          "Fresh artifact access must match the immutable result artifact.",
        ),
      );
    },
    getCapabilities(projectId: string): Promise<RenderCapabilities> {
      return request(`${base(projectId)}/render-capabilities`, renderCapabilitiesSchema);
    },
    getEnhancement(projectId: string, jobId: string): Promise<RenderEnhancementStatus> {
      return request(
        `${jobs(projectId)}/${encodeURIComponent(jobId)}/enhancement`,
        renderEnhancementStatusSchema,
      );
    },
    getJob(projectId: string, jobId: string): Promise<RenderJob> {
      return request(`${jobs(projectId)}/${encodeURIComponent(jobId)}`, renderJobSchema);
    },
    getResult(projectId: string, jobId: string): Promise<RenderResult> {
      return request(`${jobs(projectId)}/${encodeURIComponent(jobId)}/result`, renderResultSchema);
    },
    listJobs(projectId: string): Promise<ListRenderJobsResponse> {
      return request(jobs(projectId), listRenderJobsResponseSchema);
    },
    requestEnhancement(projectId: string, job: RenderJob) {
      const body = requestEnhancementSchema.parse({ expectedVersion: job.version });
      return request(
        `${jobs(projectId)}/${encodeURIComponent(job.id)}/enhancement`,
        renderEnhancementJobSchema,
        mutation(body, createId),
      );
    },
    retry(projectId: string, job: RenderJob): Promise<RenderJob> {
      const body = transitionRenderJobRequestSchema.parse({ expectedVersion: job.version });
      return request(
        `${jobs(projectId)}/${encodeURIComponent(job.id)}/retry`,
        renderJobSchema,
        mutation(body, createId),
      );
    },
  });
}

export const renderStillsClient = createRenderStillsClient();

export function artifactFromResult(result: RenderResult, artifactId: string): RenderArtifact {
  return renderArtifactSchema.parse(
    result.manifest.artifacts.find((artifact) => artifact.id === artifactId),
  );
}
