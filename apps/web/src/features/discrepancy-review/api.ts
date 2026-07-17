import {
  createFusionJobRequestSchema,
  createFusionOperationDraftRequestSchema,
  fusionJobSchema,
  fusionOperationDraftSchema,
  fusionProposalSchema,
  reviewFusionDiscrepanciesRequestSchema,
  type CreateFusionJobRequest,
  type FusionJob,
  type FusionOperationDraft,
  type FusionProposal,
} from "@interior-design/contracts";
import type { z, ZodType } from "zod";

import {
  fusionReviewResponseSchema,
  fusionWorkspaceSchema,
  transitionFusionJobRequestSchema,
  type FusionWorkspace,
} from "./contracts";

type ReviewRequest = z.infer<typeof reviewFusionDiscrepanciesRequestSchema>;
type DraftRequest = z.infer<typeof createFusionOperationDraftRequestSchema>;

export type FusionProblemKind =
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

export class FusionProblem extends Error {
  constructor(
    readonly kind: FusionProblemKind,
    message: string,
    readonly status = 0,
    readonly code?: string,
  ) {
    super(message);
    this.name = "FusionProblem";
  }
}

export type FusionTransport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function problemKind(status: number): FusionProblemKind {
  if (status === 401) return "expired";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 409) return "conflict";
  return "unavailable";
}

async function responseProblem(response: Response): Promise<FusionProblem> {
  const payload: unknown = await response.json().catch(() => undefined);
  const problem =
    typeof payload === "object" && payload !== null ? (payload as ProblemPayload) : undefined;
  return new FusionProblem(
    problemKind(response.status),
    typeof problem?.detail === "string"
      ? problem.detail
      : "The fusion request could not be completed.",
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
  return `/api/c9/projects/${encodeURIComponent(projectId)}`;
}

export function createFusionClient(transport: FusionTransport = fetch) {
  async function request<T>(url: string, schema: ZodType<T>, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await transport(url, { ...init, cache: "no-store" });
    } catch {
      throw new FusionProblem(
        "offline",
        "You appear to be offline. Reconnect and reload; no fusion state was changed.",
      );
    }
    if (!response.ok) throw await responseProblem(response);
    const payload: unknown = await response.json().catch(() => undefined);
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new FusionProblem(
        "invalid-response",
        "The service response did not match the frozen C4/C5/C9 contracts.",
        502,
        "INVALID_UPSTREAM_RESPONSE",
      );
    }
    return parsed.data;
  }

  return Object.freeze({
    cancel(projectId: string, job: FusionJob): Promise<FusionJob> {
      const body = transitionFusionJobRequestSchema.parse({ expectedVersion: job.version });
      return request(
        `${base(projectId)}/fusion-jobs/${encodeURIComponent(job.id)}/cancel`,
        fusionJobSchema,
        mutation(body),
      );
    },
    createDraft(
      projectId: string,
      jobId: string,
      value: DraftRequest,
    ): Promise<FusionOperationDraft> {
      const body = createFusionOperationDraftRequestSchema.parse(value);
      return request(
        `${base(projectId)}/fusion-jobs/${encodeURIComponent(jobId)}/proposal/operation-drafts`,
        fusionOperationDraftSchema,
        mutation(body),
      );
    },
    createJob(projectId: string, value: CreateFusionJobRequest): Promise<FusionJob> {
      const body = createFusionJobRequestSchema.parse(value);
      return request(`${base(projectId)}/fusion-jobs`, fusionJobSchema, mutation(body));
    },
    getJob(projectId: string, jobId: string): Promise<FusionJob> {
      return request(
        `${base(projectId)}/fusion-jobs/${encodeURIComponent(jobId)}`,
        fusionJobSchema,
      );
    },
    getProposal(projectId: string, jobId: string): Promise<FusionProposal> {
      return request(
        `${base(projectId)}/fusion-jobs/${encodeURIComponent(jobId)}/proposal`,
        fusionProposalSchema,
      );
    },
    loadWorkspace(projectId: string): Promise<FusionWorkspace> {
      return request(`${base(projectId)}/workspace`, fusionWorkspaceSchema);
    },
    retry(projectId: string, job: FusionJob): Promise<FusionJob> {
      const body = transitionFusionJobRequestSchema.parse({ expectedVersion: job.version });
      return request(
        `${base(projectId)}/fusion-jobs/${encodeURIComponent(job.id)}/retry`,
        fusionJobSchema,
        mutation(body),
      );
    },
    review(projectId: string, jobId: string, value: ReviewRequest) {
      const body = reviewFusionDiscrepanciesRequestSchema.parse(value);
      return request(
        `${base(projectId)}/fusion-jobs/${encodeURIComponent(jobId)}/proposal/discrepancy-decisions`,
        fusionReviewResponseSchema,
        mutation(body),
      );
    },
  });
}

export const fusionClient = createFusionClient();
