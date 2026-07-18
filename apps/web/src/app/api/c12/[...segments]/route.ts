import {
  confirmOptionRequestSchema,
  createOptionJobRequestSchema,
  designOptionSchema,
  listDesignOptionsResponseSchema,
  listOptionJobsResponseSchema,
  optionConfirmationSchema,
  optionJobSchema,
} from "@interior-design/contracts";
import type {
  AcceptedBriefReference,
  DesignOption,
  OptionSourceModelReference,
} from "@interior-design/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";

import { problemResponse } from "../../c1/_shared/backend";
import {
  c12RouteBase,
  parseC12Body,
  parseC12Id,
  requireC12IdempotencyKey,
  validatedC12Backend,
} from "../_shared/design-options-proxy";
import type { C12RouteBase, C12RouteContext } from "../_shared/design-options-proxy";

type ListDesignOptionsResponse = z.infer<typeof listDesignOptionsResponseSchema>;

const optionJobTransitionRequestSchema = z.object({ expectedVersion: z.int().positive() }).strict();

function jobsPath(base: C12RouteBase): string {
  return `/v1/projects/${base.projectId}/design-option-jobs`;
}

function routeUnavailable(): NextResponse {
  return problemResponse(
    404,
    "Design-option route unavailable",
    "This design-option route is not available.",
  );
}

function sameBrief(left: AcceptedBriefReference, right: AcceptedBriefReference): boolean {
  return (
    left.briefId === right.briefId &&
    left.contentSha256 === right.contentSha256 &&
    left.revision === right.revision
  );
}

function sameSource(left: OptionSourceModelReference, right: OptionSourceModelReference): boolean {
  return (
    left.modelId === right.modelId &&
    left.profile === right.profile &&
    left.snapshotId === right.snapshotId &&
    left.snapshotSha256 === right.snapshotSha256 &&
    left.snapshotVersion === right.snapshotVersion
  );
}

function optionMatches(option: DesignOption, projectId: string, jobId: string): boolean {
  return option.projectId === projectId && option.jobId === jobId;
}

function optionSetMatches(
  result: ListDesignOptionsResponse,
  projectId: string,
  jobId: string,
): boolean {
  if (result.projectId !== projectId || result.jobId !== jobId) return false;
  if (result.options.some((option) => !optionMatches(option, projectId, jobId))) return false;
  if (!result.optionSet) return result.options.length === 0;
  if (result.optionSet.projectId !== projectId || result.optionSet.jobId !== jobId) return false;
  const responseIds = [...result.options.map(({ id }) => id)].sort();
  const setIds = [...result.optionSet.optionIds].sort();
  return (
    responseIds.length === setIds.length && responseIds.every((id, index) => id === setIds[index])
  );
}

export async function GET(request: Request, context: C12RouteContext): Promise<NextResponse> {
  const base = await c12RouteBase(request, context);
  if (base instanceof NextResponse) return base;
  const [jobValue, child, optionValue, extra] = base.remainder;
  if (extra) return routeUnavailable();
  if (!jobValue && base.remainder.length === 0) {
    return validatedC12Backend({
      accessToken: base.accessToken,
      matches: (result) =>
        result.projectId === base.projectId &&
        result.jobs.every((job) => job.projectId === base.projectId),
      path: jobsPath(base),
      schema: listOptionJobsResponseSchema,
    });
  }
  const jobId = parseC12Id(jobValue, "Design-option job");
  if (jobId instanceof NextResponse) return jobId;
  if (!child && base.remainder.length === 1) {
    return validatedC12Backend({
      accessToken: base.accessToken,
      matches: (job) => job.projectId === base.projectId && job.id === jobId,
      path: `${jobsPath(base)}/${jobId}`,
      schema: optionJobSchema,
    });
  }
  if (child !== "options") return routeUnavailable();
  if (!optionValue && base.remainder.length === 2) {
    return validatedC12Backend({
      accessToken: base.accessToken,
      matches: (result) => optionSetMatches(result, base.projectId, jobId),
      path: `${jobsPath(base)}/${jobId}/options`,
      schema: listDesignOptionsResponseSchema,
    });
  }
  const optionId = parseC12Id(optionValue, "Design option");
  if (optionId instanceof NextResponse || base.remainder.length !== 3) {
    return optionId instanceof NextResponse ? optionId : routeUnavailable();
  }
  return validatedC12Backend({
    accessToken: base.accessToken,
    matches: (option) => optionMatches(option, base.projectId, jobId) && option.id === optionId,
    path: `${jobsPath(base)}/${jobId}/options/${optionId}`,
    schema: designOptionSchema,
  });
}

export async function POST(request: Request, context: C12RouteContext): Promise<NextResponse> {
  const base = await c12RouteBase(request, context);
  if (base instanceof NextResponse) return base;
  const [jobValue, child, optionValue, action] = base.remainder;
  const idempotencyKey = requireC12IdempotencyKey(request);
  if (idempotencyKey instanceof NextResponse) return idempotencyKey;
  if (!jobValue && base.remainder.length === 0) {
    const body = await parseC12Body(request, createOptionJobRequestSchema);
    if (body instanceof NextResponse) return body;
    return validatedC12Backend({
      accessToken: base.accessToken,
      body,
      idempotencyKey,
      matches: (job) =>
        job.projectId === base.projectId &&
        sameBrief(job.baseBrief, body.baseBrief) &&
        sameSource(job.sourceModel, body.sourceModel),
      method: "POST",
      path: jobsPath(base),
      schema: optionJobSchema,
    });
  }
  const jobId = parseC12Id(jobValue, "Design-option job");
  if (jobId instanceof NextResponse) return jobId;
  if ((child === "cancel" || child === "retry") && base.remainder.length === 2) {
    const body = await parseC12Body(request, optionJobTransitionRequestSchema);
    if (body instanceof NextResponse) return body;
    return validatedC12Backend({
      accessToken: base.accessToken,
      body,
      idempotencyKey,
      matches: (job) =>
        job.projectId === base.projectId && job.id === jobId && job.version > body.expectedVersion,
      method: "POST",
      path: `${jobsPath(base)}/${jobId}/${child}`,
      schema: optionJobSchema,
    });
  }
  if (child !== "options" || action !== "confirm" || base.remainder.length !== 4) {
    return routeUnavailable();
  }
  const optionId = parseC12Id(optionValue, "Design option");
  if (optionId instanceof NextResponse) return optionId;
  const body = await parseC12Body(request, confirmOptionRequestSchema);
  if (body instanceof NextResponse) return body;
  if (body.idempotencyKey !== idempotencyKey) {
    return problemResponse(400, "Idempotency mismatch", "Body and header keys must match.");
  }
  return validatedC12Backend({
    accessToken: base.accessToken,
    body,
    idempotencyKey,
    matches: (confirmation) =>
      confirmation.projectId === base.projectId &&
      confirmation.optionId === optionId &&
      confirmation.idempotencyKey === idempotencyKey,
    method: "POST",
    path: `${jobsPath(base)}/${jobId}/options/${optionId}/confirm`,
    schema: optionConfirmationSchema,
  });
}
