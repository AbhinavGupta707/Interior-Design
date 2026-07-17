import {
  createReconstructionJobRequestSchema,
  reconstructionJobSchema,
  reconstructionResultSchema,
  type CreateReconstructionJobRequest,
  type ReconstructionJob,
  type ReconstructionResult,
} from "@interior-design/contracts";
import type { ZodType } from "zod";

import {
  reconstructionWorkspaceSchema,
  transitionReconstructionJobRequestSchema,
  type ReconstructionWorkspace,
} from "./contracts";

export type ReconstructionProblemKind =
  | "conflict"
  | "expired"
  | "forbidden"
  | "invalid-response"
  | "not-found"
  | "offline"
  | "unavailable";

interface ProblemPayload {
  readonly code?: unknown;
  readonly detail?: unknown;
}

export class ReconstructionProblem extends Error {
  constructor(
    readonly kind: ReconstructionProblemKind,
    message: string,
    readonly status = 0,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ReconstructionProblem";
  }
}

export type ReconstructionTransport = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function problemKind(status: number): ReconstructionProblemKind {
  if (status === 401) return "expired";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 409) return "conflict";
  return "unavailable";
}

async function responseProblem(response: Response): Promise<ReconstructionProblem> {
  const payload: unknown = await response.json().catch(() => undefined);
  const problem =
    typeof payload === "object" && payload !== null ? (payload as ProblemPayload) : undefined;
  return new ReconstructionProblem(
    problemKind(response.status),
    typeof problem?.detail === "string"
      ? problem.detail
      : "The reconstruction request could not be completed.",
    response.status,
    typeof problem?.code === "string" ? problem.code : undefined,
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
  return `/api/c8/projects/${encodeURIComponent(projectId)}`;
}

export function createReconstructionClient(transport: ReconstructionTransport = fetch) {
  async function request<T>(url: string, schema: ZodType<T>, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await transport(url, { ...init, cache: "no-store" });
    } catch {
      throw new ReconstructionProblem(
        "offline",
        "You appear to be offline. Reconnect and try again; no job state was changed.",
      );
    }
    if (!response.ok) throw await responseProblem(response);
    const payload: unknown = await response.json().catch(() => undefined);
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new ReconstructionProblem(
        "invalid-response",
        "The service response did not match the frozen C2/C8 contracts.",
        502,
        "INVALID_UPSTREAM_RESPONSE",
      );
    }
    return parsed.data;
  }

  return Object.freeze({
    cancel(projectId: string, job: ReconstructionJob): Promise<ReconstructionJob> {
      const body = transitionReconstructionJobRequestSchema.parse({
        expectedVersion: job.version,
      });
      return request(
        `${base(projectId)}/reconstruction-jobs/${encodeURIComponent(job.id)}/cancel`,
        reconstructionJobSchema,
        mutation(body),
      );
    },
    createJob(
      projectId: string,
      value: CreateReconstructionJobRequest,
    ): Promise<ReconstructionJob> {
      const body = createReconstructionJobRequestSchema.parse(value);
      return request(
        `${base(projectId)}/reconstruction-jobs`,
        reconstructionJobSchema,
        mutation(body),
      );
    },
    getJob(projectId: string, jobId: string): Promise<ReconstructionJob> {
      return request(
        `${base(projectId)}/reconstruction-jobs/${encodeURIComponent(jobId)}`,
        reconstructionJobSchema,
      );
    },
    getResult(projectId: string, jobId: string): Promise<ReconstructionResult> {
      return request(
        `${base(projectId)}/reconstruction-jobs/${encodeURIComponent(jobId)}/result`,
        reconstructionResultSchema,
      );
    },
    loadWorkspace(projectId: string): Promise<ReconstructionWorkspace> {
      return request(`${base(projectId)}/workspace`, reconstructionWorkspaceSchema);
    },
    retry(projectId: string, job: ReconstructionJob): Promise<ReconstructionJob> {
      const body = transitionReconstructionJobRequestSchema.parse({
        expectedVersion: job.version,
      });
      return request(
        `${base(projectId)}/reconstruction-jobs/${encodeURIComponent(job.id)}/retry`,
        reconstructionJobSchema,
        mutation(body),
      );
    },
  });
}

export const reconstructionClient = createReconstructionClient();
