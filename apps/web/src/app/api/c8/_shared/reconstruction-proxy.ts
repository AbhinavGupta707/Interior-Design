import { projectIdSchema, reconstructionJobIdSchema } from "@interior-design/contracts";
import { NextResponse } from "next/server";
import type { ZodType } from "zod";

import {
  accessTokenFrom,
  backendRequest,
  expireSession,
  problemResponse,
  safeBackendAction,
} from "../../c1/_shared/backend";

export interface C8RouteContext {
  readonly params: Promise<{ readonly segments: string[] }>;
}

export interface C8RouteBase {
  readonly accessToken: string;
  readonly projectId: string;
  readonly remainder: readonly string[];
}

interface SafeUpstreamProblem {
  readonly code?: unknown;
  readonly detail?: unknown;
  readonly status?: unknown;
  readonly title?: unknown;
  readonly type?: unknown;
}

export async function c8RouteBase(
  request: Request,
  context: C8RouteContext,
): Promise<C8RouteBase | NextResponse> {
  const accessToken = accessTokenFrom(request);
  if (accessToken instanceof NextResponse) return accessToken;
  const segments = (await context.params).segments;
  if (segments.length < 3 || segments[0] !== "projects") {
    return problemResponse(
      404,
      "Reconstruction route unavailable",
      "This reconstruction route is not available.",
    );
  }
  const projectId = projectIdSchema.safeParse(segments[1]);
  if (!projectId.success) {
    return problemResponse(
      404,
      "Reconstruction workspace unavailable",
      "This project is not available.",
    );
  }
  return { accessToken, projectId: projectId.data, remainder: segments.slice(2) };
}

export function parseReconstructionJobId(value: string | undefined): string | NextResponse {
  const parsed = reconstructionJobIdSchema.safeParse(value);
  return parsed.success
    ? parsed.data
    : problemResponse(
        404,
        "Reconstruction job unavailable",
        "This reconstruction job is not available.",
      );
}

export function requireC8MutationKey(request: Request): string | NextResponse {
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key || key.length < 8 || key.length > 128 || !/^[A-Za-z0-9._:-]+$/u.test(key)) {
    return problemResponse(
      400,
      "Invalid idempotency key",
      "An 8–128 character Idempotency-Key is required for this reconstruction action.",
    );
  }
  return key;
}

export async function parseC8Body<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T | NextResponse> {
  const payload: unknown = await request.json().catch(() => undefined);
  const parsed = schema.safeParse(payload);
  return parsed.success
    ? parsed.data
    : problemResponse(
        400,
        "Invalid reconstruction request",
        "The submitted data does not match the frozen C8 contracts.",
      );
}

function boundedString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 && value.length <= 500 ? value : fallback;
}

export async function safeC8Problem(response: Response): Promise<NextResponse> {
  const payload: unknown = await response.json().catch(() => undefined);
  const problem =
    typeof payload === "object" && payload !== null ? (payload as SafeUpstreamProblem) : undefined;
  const next = NextResponse.json(
    {
      code: boundedString(problem?.code, "RECONSTRUCTION_REQUEST_FAILED"),
      detail: boundedString(problem?.detail, "The reconstruction request could not be completed."),
      status: response.status,
      title: boundedString(problem?.title, "Reconstruction request failed"),
      type: boundedString(problem?.type, "about:blank"),
    },
    {
      headers: { "cache-control": "no-store", "content-type": "application/problem+json" },
      status: response.status,
    },
  );
  return response.status === 401 ? expireSession(next) : next;
}

export async function validatedC8Backend<T>(options: {
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
    if (!response.ok) return safeC8Problem(response);
    const payload: unknown = await response.json().catch(() => undefined);
    const parsed = options.schema.safeParse(payload);
    if (!parsed.success) {
      return problemResponse(
        502,
        "Invalid reconstruction service response",
        "The reconstruction service returned data outside the frozen C8 contracts.",
      );
    }
    return NextResponse.json(parsed.data, {
      headers: { "cache-control": "no-store" },
      status: response.status,
    });
  });
}
