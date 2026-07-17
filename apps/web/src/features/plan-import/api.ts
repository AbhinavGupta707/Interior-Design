import {
  createPlanCalibrationRequestSchema,
  createPlanOperationDraftRequestSchema,
  createPlanProcessingJobRequestSchema,
  planCalibrationSchema,
  planOperationDraftSchema,
  planParserResultSchema,
  planProcessingJobSchema,
  transitionPlanProcessingJobRequestSchema,
} from "@interior-design/contracts";
import type {
  PlanCalibration,
  PlanOperationDraft,
  PlanParserResult,
  PlanProcessingJob,
} from "@interior-design/contracts";
import type { z } from "zod";

import { planImportWorkspaceSchema, planSourcePreviewSchema } from "./contracts";
import type { PlanImportWorkspace, PlanSourcePreview } from "./contracts";

export type PlanImportProblemKind =
  | "conflict"
  | "expired"
  | "forbidden"
  | "invalid-response"
  | "not-found"
  | "offline"
  | "unavailable";

interface ProblemPayload {
  readonly code?: unknown;
  readonly currentHeadSnapshotSha256?: unknown;
  readonly currentRevision?: unknown;
  readonly detail?: unknown;
}

export class PlanImportProblem extends Error {
  constructor(
    readonly kind: PlanImportProblemKind,
    message: string,
    readonly status = 0,
    readonly code?: string,
    readonly currentRevision?: number,
    readonly currentHeadSnapshotSha256?: string,
  ) {
    super(message);
    this.name = "PlanImportProblem";
  }
}

export type PlanImportTransport = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function problemKind(status: number, code?: string): PlanImportProblemKind {
  if (status === 401) return "expired";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 409 || code === "BRANCH_REVISION_CONFLICT") return "conflict";
  return "unavailable";
}

async function responseProblem(response: Response): Promise<PlanImportProblem> {
  const payload: unknown = await response.json().catch(() => undefined);
  const problem =
    typeof payload === "object" && payload !== null ? (payload as ProblemPayload) : undefined;
  const code = typeof problem?.code === "string" ? problem.code : undefined;
  const revision =
    typeof problem?.currentRevision === "number" && Number.isInteger(problem.currentRevision)
      ? problem.currentRevision
      : undefined;
  const head =
    typeof problem?.currentHeadSnapshotSha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(problem.currentHeadSnapshotSha256)
      ? problem.currentHeadSnapshotSha256
      : undefined;
  return new PlanImportProblem(
    problemKind(response.status, code),
    typeof problem?.detail === "string"
      ? problem.detail
      : "The plan request could not be completed.",
    response.status,
    code,
    revision,
    head,
  );
}

function mutation(body?: unknown): RequestInit {
  return {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      accept: "application/json, application/problem+json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      "idempotency-key": crypto.randomUUID(),
    },
    method: "POST",
  };
}

function base(projectId: string): string {
  return `/api/c6/projects/${encodeURIComponent(projectId)}`;
}

export function createPlanImportClient(transport: PlanImportTransport = fetch) {
  async function request<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await transport(url, { ...init, cache: "no-store" });
    } catch {
      throw new PlanImportProblem("offline", "You appear to be offline. Reconnect and try again.");
    }
    if (!response.ok) throw await responseProblem(response);
    const payload: unknown = await response.json().catch(() => undefined);
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new PlanImportProblem(
        "invalid-response",
        "The service response did not match the frozen C2/C5/C6 contracts.",
        502,
        "INVALID_UPSTREAM_RESPONSE",
      );
    }
    return parsed.data;
  }

  return Object.freeze({
    calibrate(
      projectId: string,
      jobId: string,
      value: z.input<typeof createPlanCalibrationRequestSchema>,
    ): Promise<PlanCalibration> {
      const body = createPlanCalibrationRequestSchema.parse(value);
      return request(
        `${base(projectId)}/plan-processing-jobs/${encodeURIComponent(jobId)}/proposal/calibrations`,
        planCalibrationSchema,
        mutation(body),
      );
    },
    cancel(projectId: string, job: PlanProcessingJob): Promise<PlanProcessingJob> {
      const body = transitionPlanProcessingJobRequestSchema.parse({ expectedVersion: job.version });
      return request(
        `${base(projectId)}/plan-processing-jobs/${encodeURIComponent(job.id)}/cancel`,
        planProcessingJobSchema,
        mutation(body),
      );
    },
    createDraft(
      projectId: string,
      jobId: string,
      value: z.input<typeof createPlanOperationDraftRequestSchema>,
    ): Promise<PlanOperationDraft> {
      const body = createPlanOperationDraftRequestSchema.parse(value);
      return request(
        `${base(projectId)}/plan-processing-jobs/${encodeURIComponent(jobId)}/proposal/operation-drafts`,
        planOperationDraftSchema,
        mutation(body),
      );
    },
    createJob(
      projectId: string,
      value: z.input<typeof createPlanProcessingJobRequestSchema>,
    ): Promise<PlanProcessingJob> {
      const body = createPlanProcessingJobRequestSchema.parse(value);
      return request(
        `${base(projectId)}/plan-processing-jobs`,
        planProcessingJobSchema,
        mutation(body),
      );
    },
    getJob(projectId: string, jobId: string): Promise<PlanProcessingJob> {
      return request(
        `${base(projectId)}/plan-processing-jobs/${encodeURIComponent(jobId)}`,
        planProcessingJobSchema,
      );
    },
    getProposal(projectId: string, jobId: string): Promise<PlanParserResult> {
      return request(
        `${base(projectId)}/plan-processing-jobs/${encodeURIComponent(jobId)}/proposal`,
        planParserResultSchema,
      );
    },
    loadWorkspace(projectId: string): Promise<PlanImportWorkspace> {
      return request(`${base(projectId)}/workspace`, planImportWorkspaceSchema);
    },
    requestSourcePreview(projectId: string, jobId: string): Promise<PlanSourcePreview> {
      return request(
        `${base(projectId)}/plan-processing-jobs/${encodeURIComponent(jobId)}/source-preview`,
        planSourcePreviewSchema,
        mutation(),
      );
    },
    retry(projectId: string, job: PlanProcessingJob): Promise<PlanProcessingJob> {
      const body = transitionPlanProcessingJobRequestSchema.parse({ expectedVersion: job.version });
      return request(
        `${base(projectId)}/plan-processing-jobs/${encodeURIComponent(job.id)}/retry`,
        planProcessingJobSchema,
        mutation(body),
      );
    },
  });
}

export const planImportClient = createPlanImportClient();
