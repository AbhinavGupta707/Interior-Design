import { projectIdSchema } from "@interior-design/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { ZodType } from "zod";

import {
  accessTokenFrom,
  backendRequest,
  expireSession,
  problemResponse,
} from "../../c1/_shared/backend";

export interface C12RouteContext {
  readonly params: Promise<{ readonly segments: string[] }>;
}

export interface C12RouteBase {
  readonly accessToken: string;
  readonly projectId: string;
  readonly remainder: readonly string[];
}

interface SafeUpstreamProblem {
  readonly code?: unknown;
}

const idempotencyKeySchema = z.uuid();
const maximumRequestBytes = 16 * 1024;
const maximumUpstreamBytes = 8 * 1024 * 1024;
const upstreamTimeoutMs = 15_000;

type BoundedJson = { readonly ok: false } | { readonly ok: true; readonly payload: unknown };

async function boundedJson(
  message: Request | Response,
  maximumBytes: number,
): Promise<BoundedJson> {
  const declaredLength = Number(message.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) return { ok: false };
  if (!message.body) return { ok: false };

  const reader = message.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        return { ok: false };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false };
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, payload: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
  } catch {
    return { ok: false };
  }
}

export async function c12RouteBase(
  request: Request,
  context: C12RouteContext,
): Promise<C12RouteBase | NextResponse> {
  const accessToken = accessTokenFrom(request);
  if (accessToken instanceof NextResponse) return accessToken;
  const segments = (await context.params).segments;
  if (
    segments.length < 3 ||
    segments.length > 7 ||
    segments[0] !== "projects" ||
    segments[2] !== "design-option-jobs"
  ) {
    return problemResponse(
      404,
      "Design-option route unavailable",
      "This design-option route is not available.",
    );
  }
  const projectId = projectIdSchema.safeParse(segments[1]);
  if (!projectId.success) {
    return problemResponse(
      404,
      "Design-option workspace unavailable",
      "This project is not available.",
    );
  }
  return { accessToken, projectId: projectId.data, remainder: segments.slice(3) };
}

export function parseC12Id(value: string | undefined, label: string): string | NextResponse {
  const parsed = z.uuid().safeParse(value);
  return parsed.success
    ? parsed.data
    : problemResponse(404, `${label} unavailable`, `This ${label.toLowerCase()} is not available.`);
}

export function requireC12IdempotencyKey(request: Request): string | NextResponse {
  const parsed = idempotencyKeySchema.safeParse(request.headers.get("idempotency-key")?.trim());
  return parsed.success
    ? parsed.data
    : problemResponse(
        400,
        "Invalid idempotency key",
        "A UUID Idempotency-Key is required for this design-option action.",
      );
}

export async function parseC12Body<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T | NextResponse> {
  const result = await boundedJson(request, maximumRequestBytes);
  if (!result.ok) {
    return problemResponse(
      400,
      "Invalid design-option request",
      "The submitted data is malformed or exceeds the bounded C12 request size.",
    );
  }
  const parsed = schema.safeParse(result.payload);
  return parsed.success
    ? parsed.data
    : problemResponse(
        400,
        "Invalid design-option request",
        "The submitted data does not match the frozen C12 contracts.",
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
      detail: "Your project role does not allow this design-option action.",
      title: "Action not permitted",
    };
  if (status === 404)
    return {
      detail: "The requested design-option resource is not available.",
      title: "Design-option resource unavailable",
    };
  if (status === 409)
    return {
      detail:
        "The brief, source model, job, option, or branch changed. Reload the exact latest pins.",
      title: "Pinned state changed",
    };
  if (status === 410)
    return {
      detail:
        "This option expired without creating a branch. Generate or retry a fresh option set.",
      title: "Option expired",
    };
  if (status === 422)
    return {
      detail:
        "The option service safely rejected this request. Review constraints and review routes.",
      title: "Design-option request rejected",
    };
  if (status === 429)
    return {
      detail: "The bounded option-job limit was reached. Wait before retrying.",
      title: "Option-job limit reached",
    };
  return {
    detail: "The design-option service could not complete this request.",
    title: "Design-option request failed",
  };
}

export async function safeC12Problem(response: Response): Promise<NextResponse> {
  const result = await boundedJson(response, maximumRequestBytes);
  const copy = safeProblemCopy(response.status);
  const code = result.ok ? upstreamCode(result.payload) : undefined;
  const next = NextResponse.json(
    {
      ...(code ? { code } : {}),
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

export async function validatedC12Backend<T>(options: {
  readonly accessToken: string;
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly matches?: (value: T) => boolean;
  readonly method?: "GET" | "POST";
  readonly path: string;
  readonly schema: ZodType<T>;
}): Promise<NextResponse> {
  try {
    const headers = new Headers();
    if (options.body !== undefined) headers.set("content-type", "application/json");
    if (options.idempotencyKey) headers.set("idempotency-key", options.idempotencyKey);
    const response = await backendRequest(options.path, {
      accessToken: options.accessToken,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      headers,
      method: options.method ?? "GET",
      signal: AbortSignal.timeout(upstreamTimeoutMs),
    });
    if (!response.ok) return await safeC12Problem(response);
    const result = await boundedJson(response, maximumUpstreamBytes);
    if (!result.ok) {
      return problemResponse(
        502,
        "Invalid design-option service response",
        "The design-option service returned malformed or oversized C12 data.",
      );
    }
    const parsed = options.schema.safeParse(result.payload);
    if (!parsed.success || (options.matches && !options.matches(parsed.data))) {
      return problemResponse(
        502,
        "Invalid design-option service response",
        "The design-option service returned mismatched or malformed C12 data.",
      );
    }
    return NextResponse.json(parsed.data, {
      headers: { "cache-control": "no-store" },
      status: response.status,
    });
  } catch {
    return problemResponse(
      503,
      "Design-option service unavailable",
      "The local design-option service could not be reached. Reconnect and retry.",
    );
  }
}
