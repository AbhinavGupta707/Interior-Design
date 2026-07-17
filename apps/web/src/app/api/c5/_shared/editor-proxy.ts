import {
  modelBranchIdSchema,
  modelProfileSchema,
  projectIdSchema,
} from "@interior-design/contracts";
import { NextResponse } from "next/server";
import type { ZodType } from "zod";

import {
  accessTokenFrom,
  backendRequest,
  expireSession,
  problemResponse,
  safeBackendAction,
} from "../../c1/_shared/backend";

export interface C5RouteContext {
  readonly params: Promise<{ readonly segments: string[] }>;
}

export interface C5RouteBase {
  readonly accessToken: string;
  readonly profile: "as-built" | "existing" | "proposed";
  readonly projectId: string;
  readonly remainder: readonly string[];
}

interface SafeUpstreamProblem {
  readonly code?: unknown;
  readonly currentHeadSnapshotSha256?: unknown;
  readonly currentRevision?: unknown;
  readonly detail?: unknown;
  readonly status?: unknown;
  readonly title?: unknown;
  readonly type?: unknown;
}

export async function c5RouteBase(
  request: Request,
  context: C5RouteContext,
): Promise<C5RouteBase | NextResponse> {
  const accessToken = accessTokenFrom(request);
  if (accessToken instanceof NextResponse) return accessToken;
  const segments = (await context.params).segments;
  if (segments.length < 5 || segments[0] !== "projects" || segments[2] !== "models") {
    return problemResponse(404, "Editor route unavailable", "This editor route is not available.");
  }
  const projectId = projectIdSchema.safeParse(segments[1]);
  const profile = modelProfileSchema.safeParse(segments[3]);
  if (!projectId.success || !profile.success) {
    return problemResponse(404, "Editor unavailable", "This model editor is not available.");
  }
  return {
    accessToken,
    profile: profile.data,
    projectId: projectId.data,
    remainder: segments.slice(4),
  };
}

export function parseBranchId(value: string | undefined): string | NextResponse {
  const parsed = modelBranchIdSchema.safeParse(value);
  return parsed.success
    ? parsed.data
    : problemResponse(404, "Branch unavailable", "This model branch is not available.");
}

export function requireC5MutationKey(request: Request): string | NextResponse {
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key || key.length < 8 || key.length > 128 || !/^[A-Za-z0-9._:-]+$/u.test(key)) {
    return problemResponse(
      400,
      "Invalid idempotency key",
      "An 8–128 character Idempotency-Key is required for this model change.",
    );
  }
  return key;
}

export async function parseC5Body<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T | NextResponse> {
  const payload: unknown = await request.json().catch(() => undefined);
  const parsed = schema.safeParse(payload);
  return parsed.success
    ? parsed.data
    : problemResponse(
        400,
        "Invalid model request",
        "The submitted data does not match c5-model-operation-v1.",
      );
}

function boundedString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 && value.length <= 500 ? value : fallback;
}

function boundedRevision(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function boundedHash(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value) ? value : undefined;
}

export async function safeC5Problem(response: Response): Promise<NextResponse> {
  const payload: unknown = await response.json().catch(() => undefined);
  const problem =
    typeof payload === "object" && payload !== null ? (payload as SafeUpstreamProblem) : undefined;
  const currentRevision = boundedRevision(problem?.currentRevision);
  const currentHeadSnapshotSha256 = boundedHash(problem?.currentHeadSnapshotSha256);
  const body = {
    code: boundedString(problem?.code, "MODEL_OPERATION_REQUEST_FAILED"),
    ...(currentHeadSnapshotSha256 ? { currentHeadSnapshotSha256 } : {}),
    ...(currentRevision === undefined ? {} : { currentRevision }),
    detail: boundedString(problem?.detail, "The model operation request could not be completed."),
    status: response.status,
    title: boundedString(problem?.title, "Model operation request failed"),
    type: boundedString(problem?.type, "about:blank"),
  };
  const next = NextResponse.json(body, {
    headers: { "cache-control": "no-store", "content-type": "application/problem+json" },
    status: response.status,
  });
  return response.status === 401 ? expireSession(next) : next;
}

export async function validatedBackend<T>(options: {
  readonly accessToken: string;
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly method?: "GET" | "POST";
  readonly path: string;
  readonly schema: ZodType<T>;
}): Promise<NextResponse> {
  return safeBackendAction(async () => {
    const headers = new Headers();
    if (options.body !== undefined) headers.set("content-type", "application/json");
    if (options.idempotencyKey) headers.set("idempotency-key", options.idempotencyKey);
    const response = await backendRequest(options.path, {
      accessToken: options.accessToken,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      headers,
      method: options.method ?? "GET",
    });
    if (!response.ok) return safeC5Problem(response);
    const payload: unknown = await response.json().catch(() => undefined);
    const parsed = options.schema.safeParse(payload);
    if (!parsed.success) {
      return problemResponse(
        502,
        "Invalid model service response",
        "The model service returned data outside the frozen C4/C5 contracts.",
      );
    }
    return NextResponse.json(parsed.data, {
      headers: { "cache-control": "no-store" },
      status: response.status,
    });
  });
}
