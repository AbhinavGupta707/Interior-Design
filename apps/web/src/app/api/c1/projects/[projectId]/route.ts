import { projectIdSchema, projectSchema } from "@interior-design/contracts";
import { NextResponse } from "next/server";

import {
  accessTokenFrom,
  backendRequest,
  expireSession,
  problemResponse,
  safeBackendAction,
  upstreamProblem,
  validatedUpstream,
} from "../../_shared/backend";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  return safeBackendAction(async () => {
    const accessToken = accessTokenFrom(request);
    if (accessToken instanceof NextResponse) return accessToken;
    const projectId = projectIdSchema.safeParse((await context.params).projectId);
    if (!projectId.success) {
      return problemResponse(404, "Project unavailable", "This project is not available.");
    }

    const upstream = await backendRequest(`/v1/projects/${projectId.data}`, { accessToken });
    if (!upstream.ok) {
      const response = await upstreamProblem(upstream);
      return upstream.status === 401 ? expireSession(response) : response;
    }

    const project = await validatedUpstream(upstream, projectSchema);
    return project instanceof NextResponse
      ? project
      : NextResponse.json(project, { headers: { "cache-control": "no-store" } });
  });
}
