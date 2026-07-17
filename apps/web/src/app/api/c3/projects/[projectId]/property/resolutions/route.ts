import {
  propertyResolutionResponseSchema,
  resolvePropertyRequestSchema,
} from "@interior-design/contracts";
import { NextResponse } from "next/server";

import {
  parseC3Request,
  propertyRouteDetails,
  proxyC3Response,
  requireC3MutationKey,
} from "../../../../_shared/property-proxy";
import type { PropertyRouteContext } from "../../../../_shared/property-proxy";

export async function POST(request: Request, context: PropertyRouteContext): Promise<NextResponse> {
  const details = await propertyRouteDetails(request, context);
  if (details instanceof NextResponse) return details;
  const key = requireC3MutationKey(request);
  if (key instanceof NextResponse) return key;
  const body = await parseC3Request(request, resolvePropertyRequestSchema);
  if (body instanceof NextResponse) return body;

  return proxyC3Response({
    accessToken: details.accessToken,
    body,
    idempotencyKey: key,
    method: "POST",
    path: `/v1/projects/${details.projectId}/property/resolutions`,
    responseSchema: propertyResolutionResponseSchema,
  });
}
