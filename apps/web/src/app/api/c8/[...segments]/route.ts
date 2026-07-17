import {
  assetSchema,
  createReconstructionJobRequestSchema,
  projectSchema,
  reconstructionJobSchema,
  reconstructionResultSchema,
  sessionSchema,
} from "@interior-design/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  listReconstructionJobsResponseSchema,
  readyReconstructionAssetSchema,
  reconstructionWorkspaceSchema,
  transitionReconstructionJobRequestSchema,
} from "../../../../features/reconstruction/contracts";
import { backendRequest, problemResponse, safeBackendAction } from "../../c1/_shared/backend";
import {
  c8RouteBase,
  parseC8Body,
  parseReconstructionJobId,
  requireC8MutationKey,
  safeC8Problem,
  validatedC8Backend,
} from "../_shared/reconstruction-proxy";
import type { C8RouteBase, C8RouteContext } from "../_shared/reconstruction-proxy";

function jobsPath(base: C8RouteBase): string {
  return `/v1/projects/${base.projectId}/reconstruction-jobs`;
}

function capability(name: string): "available" | "unavailable" {
  return process.env[name] === "available" ? "available" : "unavailable";
}

async function workspace(base: C8RouteBase): Promise<NextResponse> {
  return safeBackendAction(async () => {
    const [sessionResponse, projectResponse, assetsResponse, jobsResponse] = await Promise.all([
      backendRequest("/v1/session", { accessToken: base.accessToken }),
      backendRequest(`/v1/projects/${base.projectId}`, { accessToken: base.accessToken }),
      backendRequest(`/v1/projects/${base.projectId}/assets`, { accessToken: base.accessToken }),
      backendRequest(jobsPath(base), { accessToken: base.accessToken }),
    ]);
    for (const response of [sessionResponse, projectResponse, assetsResponse, jobsResponse]) {
      if (!response.ok) return safeC8Problem(response);
    }
    const session = sessionSchema.safeParse(await sessionResponse.json().catch(() => undefined));
    const project = projectSchema.safeParse(await projectResponse.json().catch(() => undefined));
    const assets = z
      .array(assetSchema)
      .safeParse(await assetsResponse.json().catch(() => undefined));
    const jobs = listReconstructionJobsResponseSchema.safeParse(
      await jobsResponse.json().catch(() => undefined),
    );
    if (!session.success || !project.success || !assets.success || !jobs.success) {
      return problemResponse(
        502,
        "Invalid reconstruction workspace response",
        "The workspace dependencies did not satisfy the frozen contracts.",
      );
    }
    if (
      project.data.id !== base.projectId ||
      jobs.data.jobs.some(({ projectId }) => projectId !== base.projectId)
    ) {
      return problemResponse(
        502,
        "Mismatched reconstruction workspace response",
        "The workspace dependencies did not match the requested project.",
      );
    }
    const eligibleAssets = assets.data.filter(
      (asset) => readyReconstructionAssetSchema.safeParse(asset).success,
    );
    const parsed = reconstructionWorkspaceSchema.safeParse({
      assets: eligibleAssets,
      capabilities: {
        appearanceProvider: capability("C8_APPEARANCE_PROVIDER_STATUS"),
        geometryWorker: capability("C8_GEOMETRY_WORKER_STATUS"),
        gpu: capability("C8_GPU_STATUS"),
      },
      jobs: jobs.data.jobs,
      project: project.data,
      session: session.data,
    });
    if (!parsed.success) {
      return problemResponse(
        502,
        "Invalid reconstruction workspace response",
        "The eligible reconstruction workspace did not satisfy the bounded consumer contract.",
      );
    }
    return NextResponse.json(parsed.data, { headers: { "cache-control": "no-store" } });
  });
}

export async function GET(request: Request, context: C8RouteContext): Promise<NextResponse> {
  const base = await c8RouteBase(request, context);
  if (base instanceof NextResponse) return base;
  const [resource, jobValue, action, extra] = base.remainder;
  if (resource === "workspace" && !jobValue) return workspace(base);
  if (resource !== "reconstruction-jobs" || extra) {
    return problemResponse(
      404,
      "Reconstruction route unavailable",
      "This reconstruction route is not available.",
    );
  }
  if (!jobValue) {
    return validatedC8Backend({
      accessToken: base.accessToken,
      path: jobsPath(base),
      schema: listReconstructionJobsResponseSchema,
    });
  }
  const jobId = parseReconstructionJobId(jobValue);
  if (jobId instanceof NextResponse) return jobId;
  if (action === "result") {
    return validatedC8Backend({
      accessToken: base.accessToken,
      path: `${jobsPath(base)}/${jobId}/result`,
      schema: reconstructionResultSchema,
    });
  }
  if (action) {
    return problemResponse(
      404,
      "Reconstruction route unavailable",
      "This reconstruction route is not available.",
    );
  }
  return validatedC8Backend({
    accessToken: base.accessToken,
    path: `${jobsPath(base)}/${jobId}`,
    schema: reconstructionJobSchema,
  });
}

export async function POST(request: Request, context: C8RouteContext): Promise<NextResponse> {
  const base = await c8RouteBase(request, context);
  if (base instanceof NextResponse) return base;
  const [resource, jobValue, action, extra] = base.remainder;
  if (resource !== "reconstruction-jobs" || extra) {
    return problemResponse(
      404,
      "Reconstruction route unavailable",
      "This reconstruction route is not available.",
    );
  }
  const key = requireC8MutationKey(request);
  if (key instanceof NextResponse) return key;
  if (!jobValue && !action) {
    const body = await parseC8Body(request, createReconstructionJobRequestSchema);
    if (body instanceof NextResponse) return body;
    return validatedC8Backend({
      accessToken: base.accessToken,
      body,
      idempotencyKey: key,
      method: "POST",
      path: jobsPath(base),
      schema: reconstructionJobSchema,
    });
  }
  const jobId = parseReconstructionJobId(jobValue);
  if (jobId instanceof NextResponse) return jobId;
  if (action !== "cancel" && action !== "retry") {
    return problemResponse(
      404,
      "Reconstruction route unavailable",
      "This reconstruction mutation is not available.",
    );
  }
  const body = await parseC8Body(request, transitionReconstructionJobRequestSchema);
  if (body instanceof NextResponse) return body;
  return validatedC8Backend({
    accessToken: base.accessToken,
    body,
    idempotencyKey: key,
    method: "POST",
    path: `${jobsPath(base)}/${jobId}/${action}`,
    schema: reconstructionJobSchema,
  });
}
