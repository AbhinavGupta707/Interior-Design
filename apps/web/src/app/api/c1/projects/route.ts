import { createProjectRequestSchema, projectSchema } from "@interior-design/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  accessTokenFrom,
  backendRequest,
  expireSession,
  parseRequest,
  requireIdempotencyKey,
  safeBackendAction,
  upstreamProblem,
  validatedUpstream,
} from "../_shared/backend";

export async function GET(request: Request): Promise<NextResponse> {
  return safeBackendAction(async () => {
    const accessToken = accessTokenFrom(request);
    if (accessToken instanceof NextResponse) return accessToken;

    const upstream = await backendRequest("/v1/projects", { accessToken });
    if (!upstream.ok) {
      const response = await upstreamProblem(upstream);
      return upstream.status === 401 ? expireSession(response) : response;
    }

    const projects = await validatedUpstream(upstream, z.array(projectSchema));
    return projects instanceof NextResponse
      ? projects
      : NextResponse.json(projects, { headers: { "cache-control": "no-store" } });
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  return safeBackendAction(async () => {
    const accessToken = accessTokenFrom(request);
    if (accessToken instanceof NextResponse) return accessToken;
    const idempotencyKey = requireIdempotencyKey(request);
    if (idempotencyKey instanceof NextResponse) return idempotencyKey;
    const body = await parseRequest(request, createProjectRequestSchema);
    if (body instanceof NextResponse) return body;

    const upstream = await backendRequest("/v1/projects", {
      accessToken,
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      method: "POST",
    });
    if (!upstream.ok) {
      const response = await upstreamProblem(upstream);
      return upstream.status === 401 ? expireSession(response) : response;
    }

    const project = await validatedUpstream(upstream, projectSchema);
    return project instanceof NextResponse
      ? project
      : NextResponse.json(project, {
          headers: { "cache-control": "no-store" },
          status: upstream.status,
        });
  });
}
