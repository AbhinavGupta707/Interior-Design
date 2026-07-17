import { fusionJobIdSchema, projectIdSchema } from "@interior-design/contracts";
import { NextResponse } from "next/server";
import type { ZodType } from "zod";

import {
  accessTokenFrom,
  backendRequest,
  expireSession,
  problemResponse,
  safeBackendAction,
} from "../../c1/_shared/backend";

export interface C9RouteContext {
  readonly params: Promise<{ readonly segments: string[] }>;
}

export interface C9RouteBase {
  readonly accessToken: string;
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

export async function c9RouteBase(
  request: Request,
  context: C9RouteContext,
): Promise<C9RouteBase | NextResponse> {
  const accessToken = accessTokenFrom(request);
  if (accessToken instanceof NextResponse) return accessToken;
  const segments = (await context.params).segments;
  if (segments.length < 3 || segments[0] !== "projects") {
    return problemResponse(404, "Fusion route unavailable", "This fusion route is not available.");
  }
  const projectId = projectIdSchema.safeParse(segments[1]);
  if (!projectId.success) {
    return problemResponse(404, "Fusion workspace unavailable", "This project is not available.");
  }
  return { accessToken, projectId: projectId.data, remainder: segments.slice(2) };
}

export function parseFusionJobId(value: string | undefined): string | NextResponse {
  const parsed = fusionJobIdSchema.safeParse(value);
  return parsed.success
    ? parsed.data
    : problemResponse(404, "Fusion job unavailable", "This fusion job is not available.");
}

export function requireC9MutationKey(request: Request): string | NextResponse {
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key || key.length < 8 || key.length > 128 || !/^[A-Za-z0-9._:-]+$/u.test(key)) {
    return problemResponse(
      400,
      "Invalid idempotency key",
      "An 8–128 character Idempotency-Key is required for this fusion action.",
    );
  }
  return key;
}

export async function parseC9Body<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T | NextResponse> {
  const payload: unknown = await request.json().catch(() => undefined);
  const parsed = schema.safeParse(payload);
  return parsed.success
    ? parsed.data
    : problemResponse(
        400,
        "Invalid fusion request",
        "The submitted data does not match the frozen C9 contracts.",
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

export async function safeC9Problem(response: Response): Promise<NextResponse> {
  const payload: unknown = await response.json().catch(() => undefined);
  const problem =
    typeof payload === "object" && payload !== null ? (payload as SafeUpstreamProblem) : undefined;
  const currentRevision = boundedRevision(problem?.currentRevision);
  const currentHeadSnapshotSha256 = boundedHash(problem?.currentHeadSnapshotSha256);
  const next = NextResponse.json(
    {
      code: boundedString(problem?.code, "FUSION_REQUEST_FAILED"),
      ...(currentHeadSnapshotSha256 ? { currentHeadSnapshotSha256 } : {}),
      ...(currentRevision === undefined ? {} : { currentRevision }),
      detail: boundedString(problem?.detail, "The fusion request could not be completed."),
      status: response.status,
      title: boundedString(problem?.title, "Fusion request failed"),
      type: boundedString(problem?.type, "about:blank"),
    },
    {
      headers: { "cache-control": "no-store", "content-type": "application/problem+json" },
      status: response.status,
    },
  );
  return response.status === 401 ? expireSession(next) : next;
}

export async function validatedC9Backend<T>(options: {
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
    if (!response.ok) return safeC9Problem(response);
    const payload: unknown = await response.json().catch(() => undefined);
    const parsed = options.schema.safeParse(payload);
    if (!parsed.success) {
      return problemResponse(
        502,
        "Invalid fusion service response",
        "The fusion service returned data outside the frozen C4/C5/C9 contracts.",
      );
    }
    return NextResponse.json(parsed.data, {
      headers: { "cache-control": "no-store" },
      status: response.status,
    });
  });
}
