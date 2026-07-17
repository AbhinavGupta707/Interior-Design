import {
  projectIdSchema,
  projectIntakeSchema,
  upsertProjectIntakeRequestSchema,
} from "@interior-design/contracts";
import { NextResponse } from "next/server";

import {
  accessTokenFrom,
  backendRequest,
  expireSession,
  parseRequest,
  problemResponse,
  requireIdempotencyKey,
  safeBackendAction,
  upstreamProblem,
  validatedUpstream,
} from "../../../_shared/backend";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

async function routeDetails(request: Request, context: RouteContext) {
  const accessToken = accessTokenFrom(request);
  if (accessToken instanceof NextResponse) return accessToken;
  const projectId = projectIdSchema.safeParse((await context.params).projectId);
  if (!projectId.success) {
    return problemResponse(404, "Project unavailable", "This project is not available.");
  }
  return { accessToken, projectId: projectId.data };
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  return safeBackendAction(async () => {
    const details = await routeDetails(request, context);
    if (details instanceof NextResponse) return details;

    const upstream = await backendRequest(`/v1/projects/${details.projectId}/intake`, {
      accessToken: details.accessToken,
    });
    if (upstream.status === 204) {
      return new NextResponse(null, { headers: { "cache-control": "no-store" }, status: 204 });
    }
    if (!upstream.ok) {
      const response = await upstreamProblem(upstream);
      return upstream.status === 401 ? expireSession(response) : response;
    }

    const intake = await validatedUpstream(upstream, projectIntakeSchema);
    return intake instanceof NextResponse
      ? intake
      : NextResponse.json(intake, { headers: { "cache-control": "no-store" } });
  });
}

export async function PUT(request: Request, context: RouteContext): Promise<NextResponse> {
  return safeBackendAction(async () => {
    const details = await routeDetails(request, context);
    if (details instanceof NextResponse) return details;
    const idempotencyKey = requireIdempotencyKey(request);
    if (idempotencyKey instanceof NextResponse) return idempotencyKey;
    const body = await parseRequest(request, upsertProjectIntakeRequestSchema);
    if (body instanceof NextResponse) return body;

    const upstream = await backendRequest(`/v1/projects/${details.projectId}/intake`, {
      accessToken: details.accessToken,
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      method: "PUT",
    });
    if (!upstream.ok) {
      const response = await upstreamProblem(upstream);
      return upstream.status === 401 ? expireSession(response) : response;
    }

    const intake = await validatedUpstream(upstream, projectIntakeSchema);
    return intake instanceof NextResponse
      ? intake
      : NextResponse.json(intake, { headers: { "cache-control": "no-store" } });
  });
}
