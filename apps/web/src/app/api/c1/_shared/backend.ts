import { NextResponse } from "next/server";
import type { ZodType } from "zod";

export const sessionCookieName = "hds_c1_session";

const defaultAPIBaseURL = "http://127.0.0.1:4100";
const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"]);

export function apiBaseURL(): string {
  const configured = process.env.HOME_DESIGN_API_BASE_URL?.trim() || defaultAPIBaseURL;
  const url = new URL(configured);

  if (url.username || url.password || url.search || url.hash) {
    throw new Error("The C1 API base URL cannot include credentials, a query, or a fragment.");
  }

  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopbackHosts.has(url.hostname))) {
    throw new Error("The C1 API base URL must use HTTPS or loopback HTTP.");
  }

  return url.toString().replace(/\/$/u, "");
}

export function backendRequest(
  path: string,
  init: RequestInit & { accessToken?: string } = {},
): Promise<Response> {
  const { accessToken, headers, ...requestInit } = init;
  const requestHeaders = new Headers(headers);
  requestHeaders.set("accept", "application/json, application/problem+json");

  if (accessToken) {
    requestHeaders.set("authorization", `Bearer ${accessToken}`);
  }

  return fetch(`${apiBaseURL()}${path}`, {
    ...requestInit,
    cache: "no-store",
    headers: requestHeaders,
  });
}

export function problemResponse(
  status: number,
  title: string,
  detail: string,
  type = "about:blank",
): NextResponse {
  return NextResponse.json(
    { detail, status, title, type },
    {
      headers: { "cache-control": "no-store" },
      status,
    },
  );
}

export async function upstreamProblem(response: Response): Promise<NextResponse> {
  const body = await response.text();
  const contentType = response.headers.get("content-type") ?? "application/problem+json";

  return new NextResponse(body || null, {
    headers: {
      "cache-control": "no-store",
      "content-type": contentType,
    },
    status: response.status,
  });
}

export async function validatedUpstream<T>(
  response: Response,
  schema: ZodType<T>,
): Promise<T | NextResponse> {
  const payload: unknown = await response.json().catch(() => undefined);
  const result = schema.safeParse(payload);

  if (!result.success) {
    return problemResponse(
      502,
      "Invalid service response",
      "The project service returned data that does not match the frozen C1 contract.",
    );
  }

  return result.data;
}

export function unavailableResponse(): NextResponse {
  return problemResponse(
    503,
    "Project service unavailable",
    "The local project service could not be reached. Check the connection and try again.",
  );
}

export function requireIdempotencyKey(request: Request): string | NextResponse {
  const key = request.headers.get("idempotency-key")?.trim();

  if (!key || key.length > 128 || !/^[A-Za-z0-9._:-]+$/u.test(key)) {
    return problemResponse(
      400,
      "Invalid idempotency key",
      "A bounded Idempotency-Key is required for this change.",
    );
  }

  return key;
}

export async function parseRequest<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T | NextResponse> {
  const payload: unknown = await request.json().catch(() => undefined);
  const result = schema.safeParse(payload);

  if (!result.success) {
    return problemResponse(
      400,
      "Invalid request",
      "The submitted data does not match the frozen C1 contract.",
    );
  }

  return result.data;
}

export function accessTokenFrom(request: Request): string | NextResponse {
  const requestWithCookies = request as Request & {
    cookies?: { get(name: string): { value: string } | undefined };
  };
  const token = requestWithCookies.cookies?.get(sessionCookieName)?.value;

  if (!token) {
    return problemResponse(401, "Session required", "Sign in with a local fixture to continue.");
  }

  return token;
}

export function expireSession(response: NextResponse): NextResponse {
  response.cookies.set(sessionCookieName, "", {
    expires: new Date(0),
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}

export async function safeBackendAction(
  action: () => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    return await action();
  } catch {
    return unavailableResponse();
  }
}
