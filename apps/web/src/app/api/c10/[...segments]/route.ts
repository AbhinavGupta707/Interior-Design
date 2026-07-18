import {
  c4SchemaVersion,
  createSceneJobRequestSchema,
  modelProfilesResponseSchema,
  projectSchema,
  sceneAccessResponseSchema,
  sceneJobSchema,
  sceneRecordSchema,
  sessionSchema,
} from "@interior-design/contracts";
import { NextResponse } from "next/server";

import {
  sceneAccessRequestSchema,
  sceneJobsResponseSchema,
  sceneTransitionRequestSchema,
  sceneWorkspaceSchema,
} from "../../../../features/viewer-3d/contracts";
import { backendRequest, problemResponse, safeBackendAction } from "../../c1/_shared/backend";
import {
  c10RouteBase,
  parseC10Body,
  parseSceneJobId,
  requireC10IdempotencyKey,
  safeC10Problem,
  validatedC10Backend,
} from "../_shared/scene-proxy";
import type { C10RouteBase, C10RouteContext } from "../_shared/scene-proxy";

function jobsPath(base: C10RouteBase): string {
  return `/v1/projects/${base.projectId}/scene-jobs`;
}

async function jsonPayload(response: Response): Promise<unknown> {
  return response.json().catch(() => undefined) as Promise<unknown>;
}

function evidenceClassification(): "fixture-presentation" | "real-backend" {
  return process.env.C10_VIEWER_EVIDENCE_CLASSIFICATION === "fixture-presentation"
    ? "fixture-presentation"
    : "real-backend";
}

async function workspace(base: C10RouteBase): Promise<NextResponse> {
  return safeBackendAction(async () => {
    const root = `/v1/projects/${base.projectId}`;
    const [sessionResponse, projectResponse, jobsResponse, profilesResponse] = await Promise.all([
      backendRequest("/v1/session", { accessToken: base.accessToken }),
      backendRequest(root, { accessToken: base.accessToken }),
      backendRequest(jobsPath(base), { accessToken: base.accessToken }),
      backendRequest(`${root}/models`, { accessToken: base.accessToken }),
    ]);
    for (const response of [sessionResponse, projectResponse, jobsResponse, profilesResponse]) {
      if (!response.ok) return safeC10Problem(response);
    }
    const [sessionPayload, projectPayload, jobsPayload, profilesPayload] = await Promise.all([
      jsonPayload(sessionResponse),
      jsonPayload(projectResponse),
      jsonPayload(jobsResponse),
      jsonPayload(profilesResponse),
    ]);
    const session = sessionSchema.safeParse(sessionPayload);
    const project = projectSchema.safeParse(projectPayload);
    const jobs = sceneJobsResponseSchema.safeParse(jobsPayload);
    const profiles = modelProfilesResponseSchema.safeParse(profilesPayload);
    if (!session.success || !project.success || !jobs.success || !profiles.success) {
      return problemResponse(
        502,
        "Invalid scene workspace response",
        "The workspace dependencies did not satisfy the frozen contracts.",
      );
    }
    const snapshots = profiles.data.profiles.flatMap((profile) =>
      profile.status === "available"
        ? [
            {
              modelId: profile.modelId,
              profile: profile.profile,
              projectId: base.projectId,
              schemaVersion: c4SchemaVersion,
              snapshotId: profile.currentSnapshotId,
              snapshotSha256: profile.currentSnapshotSha256,
            },
          ]
        : [],
    );
    const parsed = sceneWorkspaceSchema.safeParse({
      evidenceClassification: evidenceClassification(),
      jobs: jobs.data.jobs,
      project: project.data,
      session: session.data,
      snapshots,
    });
    if (
      !parsed.success ||
      project.data.id !== base.projectId ||
      profiles.data.projectId !== base.projectId
    ) {
      return problemResponse(
        502,
        "Mismatched scene workspace response",
        "The workspace dependencies did not match the requested project.",
      );
    }
    return NextResponse.json(parsed.data, { headers: { "cache-control": "no-store" } });
  });
}

export async function GET(request: Request, context: C10RouteContext): Promise<NextResponse> {
  const base = await c10RouteBase(request, context);
  if (base instanceof NextResponse) return base;
  const [resource, jobValue, child, extra] = base.remainder;
  if (resource === "workspace" && !jobValue) return workspace(base);
  if (resource !== "scene-jobs" || base.remainder.length > 4) {
    return problemResponse(404, "Scene route unavailable", "This scene route is not available.");
  }
  if (!jobValue) {
    return validatedC10Backend({
      accessToken: base.accessToken,
      path: jobsPath(base),
      schema: sceneJobsResponseSchema,
    });
  }
  const jobId = parseSceneJobId(jobValue);
  if (jobId instanceof NextResponse) return jobId;
  if (child === "scene" && !extra) {
    return validatedC10Backend({
      accessToken: base.accessToken,
      path: `${jobsPath(base)}/${jobId}/scene`,
      schema: sceneRecordSchema,
    });
  }
  if (child) {
    return problemResponse(404, "Scene route unavailable", "This scene route is not available.");
  }
  return validatedC10Backend({
    accessToken: base.accessToken,
    path: `${jobsPath(base)}/${jobId}`,
    schema: sceneJobSchema,
  });
}

export async function POST(request: Request, context: C10RouteContext): Promise<NextResponse> {
  const base = await c10RouteBase(request, context);
  if (base instanceof NextResponse) return base;
  const [resource, jobValue, action, extra] = base.remainder;
  if (resource !== "scene-jobs" || base.remainder.length > 4) {
    return problemResponse(404, "Scene route unavailable", "This scene route is not available.");
  }
  const idempotencyKey = requireC10IdempotencyKey(request);
  if (idempotencyKey instanceof NextResponse) return idempotencyKey;
  if (!jobValue && !action) {
    const body = await parseC10Body(request, createSceneJobRequestSchema);
    if (body instanceof NextResponse) return body;
    return validatedC10Backend({
      accessToken: base.accessToken,
      body,
      idempotencyKey,
      method: "POST",
      path: jobsPath(base),
      schema: sceneJobSchema,
    });
  }
  const jobId = parseSceneJobId(jobValue);
  if (jobId instanceof NextResponse) return jobId;
  if ((action === "cancel" || action === "retry") && !extra) {
    const body = await parseC10Body(request, sceneTransitionRequestSchema);
    if (body instanceof NextResponse) return body;
    return validatedC10Backend({
      accessToken: base.accessToken,
      body,
      idempotencyKey,
      method: "POST",
      path: `${jobsPath(base)}/${jobId}/${action}`,
      schema: sceneJobSchema,
    });
  }
  if (action === "scene" && extra === "access" && base.remainder.length === 4) {
    const body = await parseC10Body(request, sceneAccessRequestSchema);
    if (body instanceof NextResponse) return body;
    return validatedC10Backend({
      accessToken: base.accessToken,
      idempotencyKey,
      method: "POST",
      path: `${jobsPath(base)}/${jobId}/scene/access`,
      schema: sceneAccessResponseSchema,
    });
  }
  return problemResponse(404, "Scene route unavailable", "This scene route is not available.");
}
