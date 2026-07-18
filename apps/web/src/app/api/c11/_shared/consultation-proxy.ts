import { projectIdSchema } from "@interior-design/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { ZodType } from "zod";

import {
  accessTokenFrom,
  backendRequest,
  expireSession,
  problemResponse,
  safeBackendAction,
} from "../../c1/_shared/backend";

export interface C11RouteContext {
  readonly params: Promise<{ readonly segments: string[] }>;
}

export interface C11RouteBase {
  readonly accessToken: string;
  readonly projectId: string;
  readonly remainder: readonly string[];
}

interface SafeUpstreamProblem {
  readonly code?: unknown;
}

const idempotencyKeySchema = z.uuid();

export async function c11RouteBase(
  request: Request,
  context: C11RouteContext,
): Promise<C11RouteBase | NextResponse> {
  const accessToken = accessTokenFrom(request);
  if (accessToken instanceof NextResponse) return accessToken;
  const segments = (await context.params).segments;
  if (segments.length < 3 || segments.length > 7 || segments[0] !== "projects") {
    return problemResponse(
      404,
      "Consultation route unavailable",
      "This consultation route is not available.",
    );
  }
  const projectId = projectIdSchema.safeParse(segments[1]);
  if (!projectId.success) {
    return problemResponse(
      404,
      "Consultation workspace unavailable",
      "This project is not available.",
    );
  }
  return { accessToken, projectId: projectId.data, remainder: segments.slice(2) };
}

export function parseC11Id(value: string | undefined, label: string): string | NextResponse {
  const parsed = z.uuid().safeParse(value);
  return parsed.success
    ? parsed.data
    : problemResponse(404, `${label} unavailable`, `This ${label.toLowerCase()} is not available.`);
}

export function requireC11IdempotencyKey(request: Request): string | NextResponse {
  const parsed = idempotencyKeySchema.safeParse(request.headers.get("idempotency-key")?.trim());
  return parsed.success
    ? parsed.data
    : problemResponse(
        400,
        "Invalid idempotency key",
        "A UUID Idempotency-Key is required for this consultation action.",
      );
}

export async function parseC11Body<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T | NextResponse> {
  const payload: unknown = await request.json().catch(() => undefined);
  const parsed = schema.safeParse(payload);
  return parsed.success
    ? parsed.data
    : problemResponse(
        400,
        "Invalid consultation request",
        "The submitted data does not match the frozen C11 contracts.",
      );
}

function upstreamCode(payload: unknown): string | undefined {
  const problem =
    typeof payload === "object" && payload !== null ? (payload as SafeUpstreamProblem) : undefined;
  return typeof problem?.code === "string" && /^[A-Z0-9_]{3,80}$/u.test(problem.code)
    ? problem.code
    : undefined;
}

function safeProblemCopy(status: number): { readonly detail: string; readonly title: string } {
  if (status === 401)
    return { detail: "Your session has expired. Sign in and retry.", title: "Session expired" };
  if (status === 403)
    return {
      detail: "Your project role does not allow this consultation action.",
      title: "Action not permitted",
    };
  if (status === 404)
    return {
      detail: "The requested consultation resource is not available.",
      title: "Consultation resource unavailable",
    };
  if (status === 409)
    return {
      detail: "The brief changed before this action completed. Reload the latest revision.",
      title: "Brief revision changed",
    };
  if (status === 410)
    return {
      detail: "This proposal has expired. Submit the message again for a fresh proposal.",
      title: "Proposal expired",
    };
  if (status === 422)
    return {
      detail: "The consultation service safely rejected this request.",
      title: "Consultation request rejected",
    };
  if (status === 429)
    return {
      detail: "The consultation limit has been reached. Wait and retry.",
      title: "Consultation limit reached",
    };
  return {
    detail: "The consultation service could not complete this request.",
    title: "Consultation request failed",
  };
}

export async function safeC11Problem(response: Response): Promise<NextResponse> {
  const payload: unknown = await response.json().catch(() => undefined);
  const copy = safeProblemCopy(response.status);
  const next = NextResponse.json(
    {
      ...(upstreamCode(payload) ? { code: upstreamCode(payload) } : {}),
      detail: copy.detail,
      status: response.status,
      title: copy.title,
      type: "about:blank",
    },
    {
      headers: { "cache-control": "no-store", "content-type": "application/problem+json" },
      status: response.status,
    },
  );
  return response.status === 401 ? expireSession(next) : next;
}

export async function validatedC11Backend<T>(options: {
  readonly accessToken: string;
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly matches?: (value: T) => boolean;
  readonly method?: "GET" | "POST" | "PUT";
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
    if (!response.ok) return safeC11Problem(response);
    const payload: unknown = await response.json().catch(() => undefined);
    const parsed = options.schema.safeParse(payload);
    if (!parsed.success || (options.matches && !options.matches(parsed.data))) {
      return problemResponse(
        502,
        "Invalid consultation service response",
        "The consultation service returned mismatched or malformed C11 data.",
      );
    }
    return NextResponse.json(parsed.data, {
      headers: { "cache-control": "no-store" },
      status: response.status,
    });
  });
}
