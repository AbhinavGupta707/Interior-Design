import { NextResponse } from "next/server";

import {
  mutationBody,
  proxyEvidenceRequest,
  requireMutationKey,
  validateEvidenceIdentifiers,
} from "../../../_shared/evidence-proxy";

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  const identifiers = validateEvidenceIdentifiers(await context.params);
  if (identifiers instanceof NextResponse) return identifiers;
  return proxyEvidenceRequest(request, `/v1/projects/${identifiers.projectId}/assets`);
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const identifiers = validateEvidenceIdentifiers(await context.params);
  if (identifiers instanceof NextResponse) return identifiers;
  const key = requireMutationKey(request);
  if (key instanceof NextResponse) return key;
  return proxyEvidenceRequest(
    request,
    `/v1/projects/${identifiers.projectId}/assets/upload-sessions`,
    {
      body: await mutationBody(request),
      method: "POST",
    },
  );
}
