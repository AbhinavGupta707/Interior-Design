import { propertySourceRecordsResponseSchema } from "@interior-design/contracts";
import { NextResponse } from "next/server";

import { propertyRouteDetails, proxyC3Response } from "../../../../_shared/property-proxy";
import type { PropertyRouteContext } from "../../../../_shared/property-proxy";

export async function GET(request: Request, context: PropertyRouteContext): Promise<NextResponse> {
  const details = await propertyRouteDetails(request, context);
  if (details instanceof NextResponse) return details;
  return proxyC3Response({
    accessToken: details.accessToken,
    path: `/v1/projects/${details.projectId}/property/source-records`,
    responseSchema: propertySourceRecordsResponseSchema,
  });
}
