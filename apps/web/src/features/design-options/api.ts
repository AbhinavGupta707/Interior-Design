import {
  confirmOptionRequestSchema,
  createOptionJobRequestSchema,
  designOptionSchema,
  listDesignOptionsResponseSchema,
  listOptionJobsResponseSchema,
  optionConfirmationSchema,
  optionJobSchema,
} from "@interior-design/contracts";
import type { DesignOption, OptionConfirmation, OptionJob } from "@interior-design/contracts";
import { z } from "zod";

import type { DesignOptionLaunchContext } from "./contracts";

export type ListDesignOptionsResponse = z.infer<typeof listDesignOptionsResponseSchema>;

export type DesignOptionsProblemKind =
  | "conflict"
  | "expired"
  | "forbidden"
  | "invalid-response"
  | "not-found"
  | "offline"
  | "option-expired"
  | "rejected"
  | "throttled"
  | "unavailable";

interface ProblemPayload {
  readonly code?: unknown;
  readonly detail?: unknown;
}

const optionJobTransitionRequestSchema = z.object({ expectedVersion: z.int().positive() }).strict();

export class DesignOptionsProblem extends Error {
  constructor(
    readonly kind: DesignOptionsProblemKind,
    message: string,
    readonly status = 0,
    readonly code?: string,
  ) {
    super(message);
    this.name = "DesignOptionsProblem";
  }
}

export type DesignOptionsTransport = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function problemKind(status: number): DesignOptionsProblemKind {
  if (status === 401) return "expired";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 409) return "conflict";
  if (status === 410) return "option-expired";
  if (status === 422) return "rejected";
  if (status === 429) return "throttled";
  return "unavailable";
}

async function responseProblem(response: Response): Promise<DesignOptionsProblem> {
  const payload: unknown = await response.json().catch(() => undefined);
  const problem =
    typeof payload === "object" && payload !== null ? (payload as ProblemPayload) : undefined;
  const detail =
    typeof problem?.detail === "string" && problem.detail.length <= 500
      ? problem.detail
      : "The design-option request could not be completed.";
  const code =
    typeof problem?.code === "string" && /^[A-Z0-9_]{3,80}$/u.test(problem.code)
      ? problem.code
      : undefined;
  return new DesignOptionsProblem(problemKind(response.status), detail, response.status, code);
}

function jobBase(projectId: string): string {
  return `/api/c12/projects/${encodeURIComponent(projectId)}/design-option-jobs`;
}

function idempotentMutation(idempotencyKey: string, body?: unknown): RequestInit {
  const headers = new Headers({
    accept: "application/json, application/problem+json",
    "idempotency-key": idempotencyKey,
  });
  if (body !== undefined) headers.set("content-type", "application/json");
  return {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers,
    method: "POST",
  };
}

export function createDesignOptionsClient(
  transport: DesignOptionsTransport = fetch,
  createId: () => string = () => crypto.randomUUID(),
) {
  async function request<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await transport(url, { ...init, cache: "no-store" });
    } catch {
      throw new DesignOptionsProblem(
        "offline",
        "You appear to be offline. Reconnect and retry; no option or branch was changed.",
      );
    }
    if (!response.ok) throw await responseProblem(response);
    const payload: unknown = await response.json().catch(() => undefined);
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new DesignOptionsProblem(
        "invalid-response",
        "The service response did not match the frozen C12 contracts.",
        502,
        "INVALID_UPSTREAM_RESPONSE",
      );
    }
    return parsed.data;
  }

  return Object.freeze({
    cancelJob(projectId: string, job: OptionJob): Promise<OptionJob> {
      const key = createId();
      const body = optionJobTransitionRequestSchema.parse({ expectedVersion: job.version });
      return request(
        `${jobBase(projectId)}/${encodeURIComponent(job.id)}/cancel`,
        optionJobSchema,
        idempotentMutation(key, body),
      );
    },
    confirmOption(
      projectId: string,
      job: OptionJob,
      option: DesignOption,
      optionSetSha256: string,
    ): Promise<OptionConfirmation> {
      const idempotencyKey = createId();
      const body = confirmOptionRequestSchema.parse({
        expectedBriefContentSha256: option.baseBrief.contentSha256,
        expectedBriefRevision: option.baseBrief.revision,
        expectedJobVersion: job.version,
        expectedOptionSetSha256: optionSetSha256,
        expectedOptionStatus: "pending",
        expectedSourceSnapshotSha256: job.sourceModel.snapshotSha256,
        idempotencyKey,
      });
      return request(
        `${jobBase(projectId)}/${encodeURIComponent(job.id)}/options/${encodeURIComponent(option.id)}/confirm`,
        optionConfirmationSchema,
        idempotentMutation(idempotencyKey, body),
      );
    },
    createJob(projectId: string, value: DesignOptionLaunchContext): Promise<OptionJob> {
      const body = createOptionJobRequestSchema.parse(value);
      return request(jobBase(projectId), optionJobSchema, idempotentMutation(createId(), body));
    },
    getJob(projectId: string, jobId: string): Promise<OptionJob> {
      return request(`${jobBase(projectId)}/${encodeURIComponent(jobId)}`, optionJobSchema);
    },
    getOption(projectId: string, jobId: string, optionId: string): Promise<DesignOption> {
      return request(
        `${jobBase(projectId)}/${encodeURIComponent(jobId)}/options/${encodeURIComponent(optionId)}`,
        designOptionSchema,
      );
    },
    listJobs(projectId: string) {
      return request(jobBase(projectId), listOptionJobsResponseSchema);
    },
    listOptions(projectId: string, jobId: string): Promise<ListDesignOptionsResponse> {
      return request(
        `${jobBase(projectId)}/${encodeURIComponent(jobId)}/options`,
        listDesignOptionsResponseSchema,
      );
    },
    retryJob(projectId: string, job: OptionJob): Promise<OptionJob> {
      const key = createId();
      const body = optionJobTransitionRequestSchema.parse({ expectedVersion: job.version });
      return request(
        `${jobBase(projectId)}/${encodeURIComponent(job.id)}/retry`,
        optionJobSchema,
        idempotentMutation(key, body),
      );
    },
  });
}

export const designOptionsClient = createDesignOptionsClient();
