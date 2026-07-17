import {
  assetAccessResponseSchema,
  assetSchema,
  createPlanCalibrationRequestSchema,
  createPlanOperationDraftRequestSchema,
  createPlanProcessingJobRequestSchema,
  listModelBranchesResponseSchema,
  listPlanProcessingJobsResponseSchema,
  planCalibrationSchema,
  planOperationDraftSchema,
  planParserResultSchema,
  planProcessingJobSchema,
  projectSchema,
  sessionSchema,
  transitionPlanProcessingJobRequestSchema,
} from "@interior-design/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  planImportWorkspaceSchema,
  planSourcePreviewSchema,
  readyPlanAssetSchema,
} from "../../../../features/plan-import/contracts";
import { backendRequest, problemResponse, safeBackendAction } from "../../c1/_shared/backend";
import {
  c6RouteBase,
  parseC6Body,
  parseJobId,
  requireC6MutationKey,
  safeC6Problem,
  validatedC6Backend,
} from "../_shared/plan-proxy";
import type { C6RouteBase, C6RouteContext } from "../_shared/plan-proxy";

function jobsPath(base: C6RouteBase): string {
  return `/v1/projects/${base.projectId}/plan-processing-jobs`;
}

async function workspace(base: C6RouteBase): Promise<NextResponse> {
  return safeBackendAction(async () => {
    const requests = [
      backendRequest("/v1/session", { accessToken: base.accessToken }),
      backendRequest(`/v1/projects/${base.projectId}`, { accessToken: base.accessToken }),
      backendRequest(`/v1/projects/${base.projectId}/assets`, { accessToken: base.accessToken }),
      backendRequest(jobsPath(base), { accessToken: base.accessToken }),
      backendRequest(`/v1/projects/${base.projectId}/models/existing/branches`, {
        accessToken: base.accessToken,
      }),
    ] as const;
    const [sessionResponse, projectResponse, assetsResponse, jobsResponse, branchesResponse] =
      await Promise.all(requests);
    for (const response of [
      sessionResponse,
      projectResponse,
      assetsResponse,
      jobsResponse,
      branchesResponse,
    ]) {
      if (!response.ok) return safeC6Problem(response);
    }
    const sessionPayload: unknown = await sessionResponse.json().catch(() => undefined);
    const projectPayload: unknown = await projectResponse.json().catch(() => undefined);
    const assetsPayload: unknown = await assetsResponse.json().catch(() => undefined);
    const jobsPayload: unknown = await jobsResponse.json().catch(() => undefined);
    const branchesPayload: unknown = await branchesResponse.json().catch(() => undefined);
    const session = sessionSchema.safeParse(sessionPayload);
    const project = projectSchema.safeParse(projectPayload);
    const assets = z.array(assetSchema).safeParse(assetsPayload);
    const jobs = listPlanProcessingJobsResponseSchema.safeParse(jobsPayload);
    const branches = listModelBranchesResponseSchema.safeParse(branchesPayload);
    if (
      !session.success ||
      !project.success ||
      !assets.success ||
      !jobs.success ||
      !branches.success
    ) {
      return problemResponse(
        502,
        "Invalid plan workspace response",
        "The workspace dependencies did not satisfy the frozen contracts.",
      );
    }
    if (
      project.data.id !== base.projectId ||
      jobs.data.jobs.some(({ projectId }) => projectId !== base.projectId) ||
      branches.data.projectId !== base.projectId
    ) {
      return problemResponse(
        502,
        "Mismatched plan workspace response",
        "The workspace dependencies did not match the requested project.",
      );
    }
    const readyAssets = assets.data.filter(
      (asset) => readyPlanAssetSchema.safeParse(asset).success,
    );
    const parsed = planImportWorkspaceSchema.safeParse({
      assets: readyAssets,
      branches: branches.data.branches,
      jobs: jobs.data.jobs,
      project: project.data,
      session: session.data,
    });
    if (!parsed.success) {
      return problemResponse(
        502,
        "Invalid plan workspace response",
        "The ready-plan workspace did not satisfy the frozen consumer contract.",
      );
    }
    return NextResponse.json(parsed.data, { headers: { "cache-control": "no-store" } });
  });
}

async function sourcePreview(base: C6RouteBase, jobId: string, key: string): Promise<NextResponse> {
  return safeBackendAction(async () => {
    const jobResponse = await backendRequest(`${jobsPath(base)}/${jobId}`, {
      accessToken: base.accessToken,
    });
    if (!jobResponse.ok) return safeC6Problem(jobResponse);
    const jobPayload: unknown = await jobResponse.json().catch(() => undefined);
    const job = planProcessingJobSchema.safeParse(jobPayload);
    if (!job.success || job.data.projectId !== base.projectId) {
      return problemResponse(
        502,
        "Invalid plan job response",
        "The plan job did not satisfy the frozen project scope.",
      );
    }
    const response = await backendRequest(
      `/v1/projects/${base.projectId}/assets/${job.data.assetId}/access`,
      {
        accessToken: base.accessToken,
        body: JSON.stringify({ representation: "preview" }),
        headers: {
          "content-type": "application/json",
          "idempotency-key": key,
        },
        method: "POST",
      },
    );
    if (!response.ok) return safeC6Problem(response);
    const payload: unknown = await response.json().catch(() => undefined);
    const access = assetAccessResponseSchema.safeParse(payload);
    if (!access.success || access.data.contentDisposition !== "inline") {
      return problemResponse(
        502,
        "Invalid source preview response",
        "The evidence service did not return a safe inline derived preview.",
      );
    }
    const parsed = planSourcePreviewSchema.safeParse(access.data);
    if (!parsed.success) {
      return problemResponse(
        502,
        "Invalid source preview response",
        "The evidence preview did not satisfy the bounded browser contract.",
      );
    }
    return NextResponse.json(parsed.data, { headers: { "cache-control": "no-store" } });
  });
}

export async function GET(request: Request, context: C6RouteContext): Promise<NextResponse> {
  const base = await c6RouteBase(request, context);
  if (base instanceof NextResponse) return base;
  const [resource, jobValue, action, extra] = base.remainder;
  if (resource === "workspace" && !jobValue) return workspace(base);
  if (resource !== "plan-processing-jobs" || extra) {
    return problemResponse(404, "Plan route unavailable", "This plan route is not available.");
  }
  if (!jobValue) {
    return validatedC6Backend({
      accessToken: base.accessToken,
      path: jobsPath(base),
      schema: listPlanProcessingJobsResponseSchema,
    });
  }
  const jobId = parseJobId(jobValue);
  if (jobId instanceof NextResponse) return jobId;
  if (!action) {
    return validatedC6Backend({
      accessToken: base.accessToken,
      path: `${jobsPath(base)}/${jobId}`,
      schema: planProcessingJobSchema,
    });
  }
  if (action === "proposal") {
    return validatedC6Backend({
      accessToken: base.accessToken,
      path: `${jobsPath(base)}/${jobId}/proposal`,
      schema: planParserResultSchema,
    });
  }
  return problemResponse(404, "Plan route unavailable", "This plan route is not available.");
}

export async function POST(request: Request, context: C6RouteContext): Promise<NextResponse> {
  const base = await c6RouteBase(request, context);
  if (base instanceof NextResponse) return base;
  const [resource, jobValue, action, subaction, extra] = base.remainder;
  if (resource !== "plan-processing-jobs" || extra) {
    return problemResponse(404, "Plan route unavailable", "This plan route is not available.");
  }
  const key = requireC6MutationKey(request);
  if (key instanceof NextResponse) return key;
  if (!jobValue) {
    const body = await parseC6Body(request, createPlanProcessingJobRequestSchema);
    if (body instanceof NextResponse) return body;
    return validatedC6Backend({
      accessToken: base.accessToken,
      body,
      idempotencyKey: key,
      method: "POST",
      path: jobsPath(base),
      schema: planProcessingJobSchema,
    });
  }
  const jobId = parseJobId(jobValue);
  if (jobId instanceof NextResponse) return jobId;
  if (action === "source-preview" && !subaction) return sourcePreview(base, jobId, key);
  if ((action === "cancel" || action === "retry") && !subaction) {
    const body = await parseC6Body(request, transitionPlanProcessingJobRequestSchema);
    if (body instanceof NextResponse) return body;
    return validatedC6Backend({
      accessToken: base.accessToken,
      body,
      idempotencyKey: key,
      method: "POST",
      path: `${jobsPath(base)}/${jobId}/${action}`,
      schema: planProcessingJobSchema,
    });
  }
  if (action === "proposal" && subaction === "calibrations") {
    const body = await parseC6Body(request, createPlanCalibrationRequestSchema);
    if (body instanceof NextResponse) return body;
    return validatedC6Backend({
      accessToken: base.accessToken,
      body,
      idempotencyKey: key,
      method: "POST",
      path: `${jobsPath(base)}/${jobId}/proposal/calibrations`,
      schema: planCalibrationSchema,
    });
  }
  if (action === "proposal" && subaction === "operation-drafts") {
    const body = await parseC6Body(request, createPlanOperationDraftRequestSchema);
    if (body instanceof NextResponse) return body;
    return validatedC6Backend({
      accessToken: base.accessToken,
      body,
      idempotencyKey: key,
      method: "POST",
      path: `${jobsPath(base)}/${jobId}/proposal/operation-drafts`,
      schema: planOperationDraftSchema,
    });
  }
  return problemResponse(404, "Plan route unavailable", "This plan route is not available.");
}
