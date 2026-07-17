import {
  assetIdSchema,
  assetUploadSessionIdSchema,
  projectIdSchema,
} from "@interior-design/contracts";
import { NextResponse } from "next/server";

import {
  accessTokenFrom,
  backendRequest,
  expireSession,
  problemResponse,
  safeBackendAction,
  upstreamProblem,
} from "../../c1/_shared/backend";

export interface EvidenceRouteIdentifiers {
  assetId?: string;
  projectId: string;
  sessionId?: string;
}

export function validateEvidenceIdentifiers(
  identifiers: EvidenceRouteIdentifiers,
): EvidenceRouteIdentifiers | NextResponse {
  const projectId = projectIdSchema.safeParse(identifiers.projectId);
  const assetId = identifiers.assetId ? assetIdSchema.safeParse(identifiers.assetId) : undefined;
  const sessionId = identifiers.sessionId
    ? assetUploadSessionIdSchema.safeParse(identifiers.sessionId)
    : undefined;

  if (!projectId.success || assetId?.success === false || sessionId?.success === false) {
    return problemResponse(404, "Evidence unavailable", "This evidence is not available.");
  }

  return {
    ...(assetId?.data ? { assetId: assetId.data } : {}),
    projectId: projectId.data,
    ...(sessionId?.data ? { sessionId: sessionId.data } : {}),
  };
}

export async function proxyEvidenceRequest(
  request: Request,
  path: string,
  init: RequestInit = {},
): Promise<NextResponse> {
  return safeBackendAction(async () => {
    const accessToken = accessTokenFrom(request);
    if (accessToken instanceof NextResponse) return accessToken;

    const headers = new Headers(init.headers);
    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
    const contentType = request.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);

    const upstream = await backendRequest(path, { ...init, accessToken, headers });
    if (!upstream.ok) {
      const response = await upstreamProblem(upstream);
      return upstream.status === 401 ? expireSession(response) : response;
    }

    const body = await upstream.text();
    return new NextResponse(body || null, {
      headers: {
        "cache-control": "no-store",
        "content-type": upstream.headers.get("content-type") ?? "application/json",
      },
      status: upstream.status,
    });
  });
}

export function mutationBody(request: Request): Promise<string> {
  return request.text();
}

export function requireMutationKey(request: Request): string | NextResponse {
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
