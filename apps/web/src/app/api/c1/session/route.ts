import {
  localSessionRequestSchema,
  localSessionResponseSchema,
  sessionSchema,
} from "@interior-design/contracts";
import { NextResponse } from "next/server";

import {
  accessTokenFrom,
  backendRequest,
  expireSession,
  parseRequest,
  safeBackendAction,
  sessionCookieName,
  upstreamProblem,
  validatedUpstream,
} from "../_shared/backend";

export async function POST(request: Request): Promise<NextResponse> {
  return safeBackendAction(async () => {
    const body = await parseRequest(request, localSessionRequestSchema);
    if (body instanceof NextResponse) return body;

    const upstream = await backendRequest("/v1/auth/local/session", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (!upstream.ok) return upstreamProblem(upstream);

    const payload = await validatedUpstream(upstream, localSessionResponseSchema);
    if (payload instanceof NextResponse) return payload;

    const response = NextResponse.json(sessionSchema.parse(payload.session), {
      headers: { "cache-control": "no-store" },
    });
    response.cookies.set(sessionCookieName, payload.accessToken, {
      expires: new Date(payload.session.expiresAt),
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    return response;
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  return safeBackendAction(async () => {
    const accessToken = accessTokenFrom(request);
    if (accessToken instanceof NextResponse) return accessToken;

    const upstream = await backendRequest("/v1/session", { accessToken });
    if (!upstream.ok) {
      const response = await upstreamProblem(upstream);
      return upstream.status === 401 ? expireSession(response) : response;
    }

    const session = await validatedUpstream(upstream, sessionSchema);
    return session instanceof NextResponse
      ? session
      : NextResponse.json(session, { headers: { "cache-control": "no-store" } });
  });
}

export function DELETE(): NextResponse {
  return expireSession(new NextResponse(null, { status: 204 }));
}
