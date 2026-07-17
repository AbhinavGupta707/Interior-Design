import { NextResponse } from "next/server";

import {
  proxyEvidenceRequest,
  requireMutationKey,
  validateEvidenceIdentifiers,
} from "../../../../../_shared/evidence-proxy";

interface RouteContext {
  params: Promise<{ projectId: string; sessionId: string }>;
}

async function details(context: RouteContext) {
  return validateEvidenceIdentifiers(await context.params);
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  const identifiers = await details(context);
  if (identifiers instanceof NextResponse) return identifiers;
  const sessionId = identifiers.sessionId;
  if (!sessionId) return new NextResponse(null, { status: 404 });
  return proxyEvidenceRequest(
    request,
    `/v1/projects/${identifiers.projectId}/assets/upload-sessions/${sessionId}`,
  );
}

export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
  const identifiers = await details(context);
  if (identifiers instanceof NextResponse) return identifiers;
  const sessionId = identifiers.sessionId;
  if (!sessionId) return new NextResponse(null, { status: 404 });
  const key = requireMutationKey(request);
  if (key instanceof NextResponse) return key;
  return proxyEvidenceRequest(
    request,
    `/v1/projects/${identifiers.projectId}/assets/upload-sessions/${sessionId}`,
    { method: "DELETE" },
  );
}
