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

export interface C13RouteContext {
  readonly params: Promise<{ readonly segments: string[] }>;
}

export interface C13RouteBase {
  readonly accessToken: string;
  readonly projectId: string;
  readonly remainder: readonly string[];
}

interface SafeUpstreamProblem {
  readonly code?: unknown;
}

const idempotencyKeySchema = z.uuid();
const maximumRequestBytes = 32 * 1024;
const maximumUpstreamBytes = 12 * 1024 * 1024;
const upstreamTimeoutMs = 20_000;

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

export async function c13RouteBase(
  request: Request,
  context: C13RouteContext,
): Promise<C13RouteBase | NextResponse> {
  const accessToken = accessTokenFrom(request);
  if (accessToken instanceof NextResponse) return accessToken;
  const segments = (await context.params).segments;
  if (segments.length < 3 || segments.length > 8 || segments[0] !== "projects") {
    return problemResponse(404, "C13 route unavailable", "This C13 route is not available.");
  }
  const projectId = projectIdSchema.safeParse(segments[1]);
  if (!projectId.success) {
    return problemResponse(
      404,
      "Materials workspace unavailable",
      "This project is not available.",
    );
  }
  return { accessToken, projectId: projectId.data, remainder: segments.slice(2) };
}

export function parseC13Id(value: string | undefined, label: string): string | NextResponse {
  const parsed = z.uuid().safeParse(value);
  return parsed.success
    ? parsed.data
    : problemResponse(404, `${label} unavailable`, `This ${label.toLowerCase()} is not available.`);
}

export function requireC13IdempotencyKey(request: Request): string | NextResponse {
  const parsed = idempotencyKeySchema.safeParse(request.headers.get("idempotency-key")?.trim());
  return parsed.success
    ? parsed.data
    : problemResponse(
        400,
        "Invalid idempotency key",
        "A UUID Idempotency-Key is required for this C13 action.",
      );
}

export async function parseC13Body<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T | NextResponse> {
  const result = await boundedJson(request, maximumRequestBytes);
  if (!result.ok) {
    return problemResponse(
      400,
      "Invalid C13 request",
      "The submitted data is malformed or exceeds the bounded C13 request size.",
    );
  }
  const parsed = schema.safeParse(result.payload);
  return parsed.success
    ? parsed.data
    : problemResponse(
        400,
        "Invalid C13 request",
        "The submitted data does not match the frozen C13 contracts.",
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
  if (status === 401) {
    return { detail: "Your session expired. Sign in and retry.", title: "Session expired" };
  }
  if (status === 403) {
    return {
      detail: "Your project role does not allow this catalog or specification action.",
      title: "Action not permitted",
    };
  }
  if (status === 404) {
    return {
      detail: "The requested catalog or specification resource is not available.",
      title: "C13 resource unavailable",
    };
  }
  if (status === 409) {
    return {
      detail:
        "The specification, branch, catalog release, rights record, or preview pin changed. Reload exact state.",
      title: "Pinned state changed",
    };
  }
  if (status === 410) {
    return {
      detail:
        "The bounded preview expired or its rights state changed. Prepare a fresh preview; nothing was committed.",
      title: "Preview unavailable",
    };
  }
  if (status === 422) {
    return {
      detail:
        "The service safely rejected this catalog or specification action. Review kind, geometry, rights, and exact pins.",
      title: "C13 request rejected",
    };
  }
  if (status === 429) {
    return {
      detail: "The bounded request limit was reached. Wait before retrying.",
      title: "C13 request limit reached",
    };
  }
  return {
    detail: "The local C13 service could not complete this request. Reconnect and retry.",
    title: "C13 service unavailable",
  };
}

async function safeC13Problem(response: Response): Promise<NextResponse> {
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

export async function validatedC13Backend<T>(options: {
  readonly accessToken: string;
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly matches?: (value: T) => boolean;
  readonly method?: "GET" | "POST" | "PUT";
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
    if (!response.ok) return await safeC13Problem(response);
    const result = await boundedJson(response, maximumUpstreamBytes);
    if (!result.ok) {
      return problemResponse(
        502,
        "Invalid C13 service response",
        "The C13 service returned malformed or oversized data.",
      );
    }
    const parsed = options.schema.safeParse(result.payload);
    if (!parsed.success || (options.matches && !options.matches(parsed.data))) {
      return problemResponse(
        502,
        "Invalid C13 service response",
        "The C13 service returned mismatched or malformed frozen-contract data.",
      );
    }
    return NextResponse.json(parsed.data, {
      headers: { "cache-control": "no-store" },
      status: response.status,
    });
  } catch {
    return problemResponse(
      503,
      "C13 service unavailable",
      "The local C13 service could not be reached. Reconnect and retry.",
    );
  }
}
