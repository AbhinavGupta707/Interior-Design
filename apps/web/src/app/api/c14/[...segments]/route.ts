import {
  createRenderJobRequestSchema,
  renderArtifactAccessSchema,
  renderEligibleSourcesResponseSchema,
  renderHostCapabilitiesSchema,
  renderJobSchema,
  renderResultSchema,
} from "@interior-design/contracts";
import { NextResponse } from "next/server";

import {
  listRenderJobsResponseSchema,
  renderEnhancementJobSchema,
  renderEnhancementStatusSchema,
  requestEnhancementSchema,
  transitionRenderJobRequestSchema,
} from "../../../../features/render-stills/contracts";
import { problemResponse } from "../../c1/_shared/backend";
import {
  c14RouteBase,
  parseC14Body,
  parseRenderArtifactId,
  parseRenderJobId,
  requireC14IdempotencyKey,
  validatedC14Backend,
} from "../_shared/render-stills-proxy";
import type { C14RouteBase, C14RouteContext } from "../_shared/render-stills-proxy";

function routeUnavailable(): NextResponse {
  return problemResponse(404, "C14 route unavailable", "This C14 route is not available.");
}

function jobsPath(base: C14RouteBase): string {
  return `/v1/projects/${base.projectId}/render-jobs`;
}

export async function GET(request: Request, context: C14RouteContext): Promise<NextResponse> {
  const base = await c14RouteBase(request, context);
  if (base instanceof NextResponse) return base;
  const [resource, jobValue, action, artifactValue, accessAction] = base.remainder;
  if (resource === "render-capabilities" && !jobValue) {
    return validatedC14Backend({
      accessToken: base.accessToken,
      path: `/v1/projects/${base.projectId}/render-capabilities`,
      schema: renderHostCapabilitiesSchema,
    });
  }
  if (resource === "render-eligible-sources" && !jobValue) {
    return validatedC14Backend({
      accessToken: base.accessToken,
      matches: (result) => result.projectId === base.projectId,
      path: `/v1/projects/${base.projectId}/render-eligible-sources`,
      schema: renderEligibleSourcesResponseSchema,
    });
  }
  if (resource !== "render-jobs") return routeUnavailable();
  if (!jobValue) {
    if (action) return routeUnavailable();
    return validatedC14Backend({
      accessToken: base.accessToken,
      matches: (result) => result.jobs.every(({ projectId }) => projectId === base.projectId),
      path: jobsPath(base),
      schema: listRenderJobsResponseSchema,
    });
  }
  const jobId = parseRenderJobId(jobValue);
  if (jobId instanceof NextResponse) return jobId;
  if (!action) {
    return validatedC14Backend({
      accessToken: base.accessToken,
      matches: (job) => job.id === jobId && job.projectId === base.projectId,
      path: `${jobsPath(base)}/${jobId}`,
      schema: renderJobSchema,
    });
  }
  if (action === "result" && !artifactValue) {
    return validatedC14Backend({
      accessToken: base.accessToken,
      matches: (result) => result.jobId === jobId && result.projectId === base.projectId,
      path: `${jobsPath(base)}/${jobId}/result`,
      schema: renderResultSchema,
    });
  }
  if (action === "enhancement" && !artifactValue) {
    return validatedC14Backend({
      accessToken: base.accessToken,
      path: `${jobsPath(base)}/${jobId}/enhancement`,
      schema: renderEnhancementStatusSchema,
    });
  }
  if (action !== "artifacts" || !artifactValue || accessAction !== "access") {
    return routeUnavailable();
  }
  const artifactId = parseRenderArtifactId(artifactValue);
  if (artifactId instanceof NextResponse || base.remainder.length !== 5) {
    return artifactId instanceof NextResponse ? artifactId : routeUnavailable();
  }
  return validatedC14Backend({
    accessToken: base.accessToken,
    matches: (access) => access.artifactId === artifactId,
    path: `${jobsPath(base)}/${jobId}/artifacts/${artifactId}/access`,
    schema: renderArtifactAccessSchema,
  });
}

export async function POST(request: Request, context: C14RouteContext): Promise<NextResponse> {
  const base = await c14RouteBase(request, context);
  if (base instanceof NextResponse) return base;
  const [resource, jobValue, action, extra] = base.remainder;
  if (resource !== "render-jobs" || extra) return routeUnavailable();
  const idempotencyKey = requireC14IdempotencyKey(request);
  if (idempotencyKey instanceof NextResponse) return idempotencyKey;
  if (!jobValue && !action) {
    const body = await parseC14Body(request, createRenderJobRequestSchema);
    if (body instanceof NextResponse) return body;
    return validatedC14Backend({
      accessToken: base.accessToken,
      body,
      idempotencyKey,
      matches: (job) =>
        job.projectId === base.projectId && job.request.sourceSceneJobId === body.sourceSceneJobId,
      method: "POST",
      path: jobsPath(base),
      schema: renderJobSchema,
    });
  }
  const jobId = parseRenderJobId(jobValue);
  if (jobId instanceof NextResponse) return jobId;
  if (action === "cancel" || action === "retry") {
    const body = await parseC14Body(request, transitionRenderJobRequestSchema);
    if (body instanceof NextResponse) return body;
    return validatedC14Backend({
      accessToken: base.accessToken,
      body,
      idempotencyKey,
      matches: (job) => job.id === jobId && job.projectId === base.projectId,
      method: "POST",
      path: `${jobsPath(base)}/${jobId}/${action}`,
      schema: renderJobSchema,
    });
  }
  if (action !== "enhancement") return routeUnavailable();
  const body = await parseC14Body(request, requestEnhancementSchema);
  if (body instanceof NextResponse) return body;
  return validatedC14Backend({
    accessToken: base.accessToken,
    body,
    idempotencyKey,
    matches: (job) => job.renderJobId === jobId && job.projectId === base.projectId,
    method: "POST",
    path: `${jobsPath(base)}/${jobId}/enhancement`,
    schema: renderEnhancementJobSchema,
  });
}
