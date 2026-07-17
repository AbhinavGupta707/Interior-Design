import { projectIdSchema } from "@interior-design/contracts";
import { NextResponse } from "next/server";
import type { ZodType } from "zod";

import {
  accessTokenFrom,
  backendRequest,
  expireSession,
  problemResponse,
  safeBackendAction,
} from "../../c1/_shared/backend";

export interface PropertyRouteContext {
  params: Promise<{ projectId: string }>;
}

interface UpstreamProblem {
  readonly code?: unknown;
  readonly detail?: unknown;
  readonly instance?: unknown;
  readonly requestId?: unknown;
  readonly status?: unknown;
  readonly title?: unknown;
  readonly traceId?: unknown;
  readonly type?: unknown;
}

export async function propertyRouteDetails(
  request: Request,
  context: PropertyRouteContext,
): Promise<{ accessToken: string; projectId: string } | NextResponse> {
  const accessToken = accessTokenFrom(request);
  if (accessToken instanceof NextResponse) return accessToken;
  const projectId = projectIdSchema.safeParse((await context.params).projectId);
  if (!projectId.success) {
    return problemResponse(404, "Property unavailable", "This property is not available.");
  }
  return { accessToken, projectId: projectId.data };
}

export function requireC3MutationKey(request: Request): string | NextResponse {
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key || key.length < 8 || key.length > 128 || !/^[A-Za-z0-9._:-]+$/u.test(key)) {
    return problemResponse(
      400,
      "Invalid idempotency key",
      "An 8–128 character Idempotency-Key is required for this change.",
    );
  }
  return key;
}

export async function parseC3Request<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T | NextResponse> {
  const payload: unknown = await request.json().catch(() => undefined);
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return problemResponse(
      400,
      "Invalid property request",
      "The submitted data does not match c3-property-v1.",
    );
  }
  return parsed.data;
}

function safeProblemField(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 && value.length <= 500 ? value : fallback;
}

async function sanitizedUpstreamProblem(response: Response): Promise<NextResponse> {
  const payload: unknown = await response.json().catch(() => undefined);
  const problem =
    typeof payload === "object" && payload !== null ? (payload as UpstreamProblem) : undefined;
  const body = {
    code: safeProblemField(problem?.code, "PROPERTY_REQUEST_FAILED"),
    detail: safeProblemField(problem?.detail, "The property request could not be completed."),
    instance: safeProblemField(problem?.instance, "/api/c3/property"),
    requestId: safeProblemField(problem?.requestId, "unavailable"),
    status: response.status,
    title: safeProblemField(problem?.title, "Property request failed"),
    traceId: safeProblemField(problem?.traceId, "unavailable"),
    type: safeProblemField(problem?.type, "about:blank"),
  };
  return NextResponse.json(body, {
    headers: { "cache-control": "no-store", "content-type": "application/problem+json" },
    status: response.status,
  });
}

export async function proxyC3Response<T>(options: {
  readonly accessToken: string;
  readonly body?: unknown;
  readonly emptyProblemCode?: string;
  readonly idempotencyKey?: string;
  readonly method?: "GET" | "POST" | "PUT";
  readonly path: string;
  readonly responseSchema: ZodType<T>;
}): Promise<NextResponse> {
  return safeBackendAction(async () => {
    const headers = new Headers();
    if (options.body !== undefined) headers.set("content-type", "application/json");
    if (options.idempotencyKey) headers.set("idempotency-key", options.idempotencyKey);

    const upstream = await backendRequest(options.path, {
      accessToken: options.accessToken,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      headers,
      method: options.method ?? "GET",
    });
    if (!upstream.ok) {
      if (options.emptyProblemCode) {
        const payload: unknown = await upstream
          .clone()
          .json()
          .catch(() => undefined);
        if (
          typeof payload === "object" &&
          payload !== null &&
          "code" in payload &&
          payload.code === options.emptyProblemCode
        ) {
          return new NextResponse(null, {
            headers: { "cache-control": "no-store" },
            status: 204,
          });
        }
      }
      const response = await sanitizedUpstreamProblem(upstream);
      return upstream.status === 401 ? expireSession(response) : response;
    }

    const payload: unknown = await upstream.json().catch(() => undefined);
    const parsed = options.responseSchema.safeParse(payload);
    if (!parsed.success) {
      return problemResponse(
        502,
        "Invalid property service response",
        "The property service returned data that does not match c3-property-v1.",
      );
    }

    return NextResponse.json(parsed.data, {
      headers: { "cache-control": "no-store" },
      status: upstream.status,
    });
  });
}
