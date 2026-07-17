import { projectIdSchema, sceneJobIdSchema } from "@interior-design/contracts";
import { NextResponse } from "next/server";
import type { ZodType } from "zod";

import {
  accessTokenFrom,
  backendRequest,
  expireSession,
  problemResponse,
  safeBackendAction,
} from "../../c1/_shared/backend";

export interface C10RouteContext {
  readonly params: Promise<{ readonly segments: string[] }>;
}

export interface C10RouteBase {
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

export async function c10RouteBase(
  request: Request,
  context: C10RouteContext,
): Promise<C10RouteBase | NextResponse> {
  const accessToken = accessTokenFrom(request);
  if (accessToken instanceof NextResponse) return accessToken;
  const segments = (await context.params).segments;
  if (segments.length < 3 || segments[0] !== "projects") {
    return problemResponse(404, "Scene route unavailable", "This scene route is not available.");
  }
  const projectId = projectIdSchema.safeParse(segments[1]);
  if (!projectId.success) {
    return problemResponse(404, "Scene workspace unavailable", "This project is not available.");
  }
  return { accessToken, projectId: projectId.data, remainder: segments.slice(2) };
}

export function parseSceneJobId(value: string | undefined): string | NextResponse {
  const parsed = sceneJobIdSchema.safeParse(value);
  return parsed.success
    ? parsed.data
    : problemResponse(404, "Scene job unavailable", "This scene job is not available.");
}

export function requireC10IdempotencyKey(request: Request): string | NextResponse {
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key || key.length < 8 || key.length > 128 || !/^[A-Za-z0-9._:-]+$/u.test(key)) {
    return problemResponse(
      400,
      "Invalid idempotency key",
      "An 8–128 character Idempotency-Key is required for this scene action.",
    );
  }
  return key;
}

export async function parseC10Body<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T | NextResponse> {
  const payload: unknown = await request.json().catch(() => undefined);
  const parsed = schema.safeParse(payload);
  return parsed.success
    ? parsed.data
    : problemResponse(
        400,
        "Invalid scene request",
        "The submitted data does not match the frozen C10 contracts.",
      );
}

function boundedString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 && value.length <= 500 ? value : fallback;
}

export async function safeC10Problem(response: Response): Promise<NextResponse> {
  const payload: unknown = await response.json().catch(() => undefined);
  const problem =
    typeof payload === "object" && payload !== null ? (payload as SafeUpstreamProblem) : undefined;
  const next = NextResponse.json(
    {
      code: boundedString(problem?.code, "SCENE_REQUEST_FAILED"),
      detail: boundedString(problem?.detail, "The scene request could not be completed."),
      status: response.status,
      title: boundedString(problem?.title, "Scene request failed"),
      type: boundedString(problem?.type, "about:blank"),
    },
    {
      headers: { "cache-control": "no-store", "content-type": "application/problem+json" },
      status: response.status,
    },
  );
  return response.status === 401 ? expireSession(next) : next;
}

export async function validatedC10Backend<T>(options: {
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
    if (!response.ok) return safeC10Problem(response);
    const payload: unknown = await response.json().catch(() => undefined);
    const parsed = options.schema.safeParse(payload);
    if (!parsed.success) {
      return problemResponse(
        502,
        "Invalid scene service response",
        "The scene service returned data outside the frozen C4/C10 contracts.",
      );
    }
    return NextResponse.json(parsed.data, {
      headers: { "cache-control": "no-store" },
      status: response.status,
    });
  });
}
