import {
  captureProposalResultSchema,
  captureSessionSchema,
  createFusionJobRequestSchema,
  createFusionOperationDraftRequestSchema,
  fusionJobSchema,
  fusionOperationDraftSchema,
  fusionProposalSchema,
  listModelBranchesResponseSchema,
  listPlanProcessingJobsResponseSchema,
  modelSnapshotRecordSchema,
  planParserResultSchema,
  projectSchema,
  reconstructionResultSchema,
  reviewFusionDiscrepanciesRequestSchema,
  sessionSchema,
  type FusionSource,
} from "@interior-design/contracts";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  fusionReviewResponseSchema,
  fusionWorkspaceSchema,
  listFusionJobsResponseSchema,
  transitionFusionJobRequestSchema,
  type FusionWorkspaceSource,
} from "../../../../features/discrepancy-review/contracts";
import { listReconstructionJobsResponseSchema } from "../../../../features/reconstruction/contracts";
import { backendRequest, problemResponse, safeBackendAction } from "../../c1/_shared/backend";
import {
  c9RouteBase,
  parseC9Body,
  parseFusionJobId,
  requireC9MutationKey,
  safeC9Problem,
  validatedC9Backend,
} from "../_shared/fusion-proxy";
import type { C9RouteBase, C9RouteContext } from "../_shared/fusion-proxy";

function jobsPath(base: C9RouteBase): string {
  return `/v1/projects/${base.projectId}/fusion-jobs`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  throw new Error("Unsupported fusion source value.");
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function source(label: string, descriptor: FusionSource): FusionWorkspaceSource {
  return { label, source: descriptor, sourceStatus: "eligible" };
}

function producerCapability(name: string): "available" | "unavailable" {
  return process.env[name] === "available" ? "available" : "unavailable";
}

async function jsonPayload(response: Response): Promise<unknown> {
  return response.json().catch(() => undefined) as Promise<unknown>;
}

async function workspace(base: C9RouteBase): Promise<NextResponse> {
  return safeBackendAction(async () => {
    const root = `/v1/projects/${base.projectId}`;
    const requests = [
      backendRequest("/v1/session", { accessToken: base.accessToken }),
      backendRequest(root, { accessToken: base.accessToken }),
      backendRequest(jobsPath(base), { accessToken: base.accessToken }),
      backendRequest(`${root}/models/existing`, { accessToken: base.accessToken }),
      backendRequest(`${root}/models/existing/branches`, { accessToken: base.accessToken }),
      backendRequest(`${root}/plan-processing-jobs`, { accessToken: base.accessToken }),
      backendRequest(`${root}/capture-sessions`, { accessToken: base.accessToken }),
      backendRequest(`${root}/reconstruction-jobs`, { accessToken: base.accessToken }),
    ] as const;
    const [
      sessionResponse,
      projectResponse,
      jobsResponse,
      baseResponse,
      branchesResponse,
      planJobsResponse,
      captureSessionsResponse,
      reconstructionJobsResponse,
    ] = await Promise.all(requests);
    for (const response of [
      sessionResponse,
      projectResponse,
      jobsResponse,
      branchesResponse,
      planJobsResponse,
      captureSessionsResponse,
      reconstructionJobsResponse,
    ]) {
      if (!response.ok) return safeC9Problem(response);
    }
    if (!baseResponse.ok && baseResponse.status !== 404) return safeC9Problem(baseResponse);

    const [
      sessionPayload,
      projectPayload,
      jobsPayload,
      basePayload,
      branchesPayload,
      planJobsPayload,
      captureSessionsPayload,
      reconstructionJobsPayload,
    ]: readonly unknown[] = await Promise.all([
      jsonPayload(sessionResponse),
      jsonPayload(projectResponse),
      jsonPayload(jobsResponse),
      baseResponse.ok ? jsonPayload(baseResponse) : Promise.resolve(undefined),
      jsonPayload(branchesResponse),
      jsonPayload(planJobsResponse),
      jsonPayload(captureSessionsResponse),
      jsonPayload(reconstructionJobsResponse),
    ]);
    const session = sessionSchema.safeParse(sessionPayload);
    const project = projectSchema.safeParse(projectPayload);
    const jobs = listFusionJobsResponseSchema.safeParse(jobsPayload);
    const baseSnapshot =
      basePayload === undefined
        ? { success: true as const, data: undefined }
        : modelSnapshotRecordSchema.safeParse(basePayload);
    const branches = listModelBranchesResponseSchema.safeParse(branchesPayload);
    const planJobs = listPlanProcessingJobsResponseSchema.safeParse(planJobsPayload);
    const captureSessions = z
      .array(captureSessionSchema)
      .max(10_000)
      .safeParse(captureSessionsPayload);
    const reconstructionJobs =
      listReconstructionJobsResponseSchema.safeParse(reconstructionJobsPayload);
    if (
      !session.success ||
      !project.success ||
      !jobs.success ||
      !baseSnapshot.success ||
      !branches.success ||
      !planJobs.success ||
      !captureSessions.success ||
      !reconstructionJobs.success
    ) {
      return problemResponse(
        502,
        "Invalid fusion workspace response",
        "The workspace dependencies did not satisfy the frozen contracts.",
      );
    }
    if (
      project.data.id !== base.projectId ||
      jobs.data.jobs.some(({ projectId }) => projectId !== base.projectId) ||
      branches.data.projectId !== base.projectId ||
      planJobs.data.jobs.some(({ projectId }) => projectId !== base.projectId) ||
      captureSessions.data.some(({ projectId }) => projectId !== base.projectId) ||
      reconstructionJobs.data.jobs.some(({ projectId }) => projectId !== base.projectId) ||
      (baseSnapshot.data !== undefined && baseSnapshot.data.projectId !== base.projectId)
    ) {
      return problemResponse(
        502,
        "Mismatched fusion workspace response",
        "The workspace dependencies did not match the requested project.",
      );
    }

    const terminalPlans = planJobs.data.jobs.filter((job) => job.state === "proposed").slice(0, 32);
    const terminalCaptures = captureSessions.data
      .filter((capture) => capture.state === "proposed")
      .slice(0, 32);
    const terminalReconstructions = reconstructionJobs.data.jobs
      .filter((job) => job.state === "completed")
      .slice(0, 32);
    const [planResults, captureResults, reconstructionResults] = await Promise.all([
      Promise.all(
        terminalPlans.map((job) =>
          backendRequest(`${root}/plan-processing-jobs/${job.id}/proposal`, {
            accessToken: base.accessToken,
          }),
        ),
      ),
      Promise.all(
        terminalCaptures.map((capture) =>
          backendRequest(`${root}/capture-sessions/${capture.id}/proposal`, {
            accessToken: base.accessToken,
          }),
        ),
      ),
      Promise.all(
        terminalReconstructions.map((job) =>
          backendRequest(`${root}/reconstruction-jobs/${job.id}/result`, {
            accessToken: base.accessToken,
          }),
        ),
      ),
    ]);
    for (const response of [...planResults, ...captureResults, ...reconstructionResults]) {
      if (!response.ok) return safeC9Problem(response);
    }
    const sources: FusionWorkspaceSource[] = [];
    for (const response of planResults) {
      const parsed = planParserResultSchema.safeParse(await jsonPayload(response));
      if (!parsed.success || parsed.data.status !== "proposal") continue;
      sources.push(
        source(`Plan proposal · ${parsed.data.proposalId.slice(0, 8)}`, {
          coordinateFrame: "source-local-arbitrary",
          elementCount: parsed.data.candidates.length,
          evidenceState: "source-derived",
          id: parsed.data.proposalId,
          kind: "plan-proposal",
          referenceId: parsed.data.proposalId,
          rights: { serviceProcessingConsent: true, trainingUseConsent: "denied" },
          scaleStatus: "unknown",
          schemaVersion: parsed.data.schemaVersion,
          sha256: sha256({ ...parsed.data, createdAt: undefined }),
        }),
      );
    }
    for (const response of captureResults) {
      const parsed = captureProposalResultSchema.safeParse(await jsonPayload(response));
      if (!parsed.success || parsed.data.status !== "proposal") continue;
      sources.push(
        source(`RoomPlan proposal · ${parsed.data.proposalId.slice(0, 8)}`, {
          coordinateFrame: "source-local-metric",
          elementCount: parsed.data.elementSources.length,
          evidenceState: "source-derived",
          id: parsed.data.proposalId,
          kind: "roomplan-proposal",
          referenceId: parsed.data.proposalId,
          rights: { serviceProcessingConsent: true, trainingUseConsent: "denied" },
          scaleStatus: "metric-estimated",
          schemaVersion: parsed.data.schemaVersion,
          sha256: sha256(parsed.data),
        }),
      );
    }
    for (const response of reconstructionResults) {
      const parsed = reconstructionResultSchema.safeParse(await jsonPayload(response));
      if (!parsed.success || parsed.data.status !== "completed") continue;
      const scaleStatus = parsed.data.geometry.scaleStatus;
      sources.push(
        source(`Reconstruction result · ${parsed.data.resultId.slice(0, 8)}`, {
          coordinateFrame:
            scaleStatus === "unknown" ? "source-local-arbitrary" : "source-local-metric",
          elementCount: parsed.data.geometry.registeredFrameCount,
          evidenceState: "source-derived",
          id: parsed.data.resultId,
          kind: "reconstruction-result",
          referenceId: parsed.data.resultId,
          rights: { serviceProcessingConsent: true, trainingUseConsent: "denied" },
          scaleStatus,
          schemaVersion: parsed.data.schemaVersion,
          sha256: sha256(parsed.data),
        }),
      );
    }
    const parsed = fusionWorkspaceSchema.safeParse({
      ...(baseSnapshot.data === undefined ? {} : { baseSnapshot: baseSnapshot.data }),
      branches: branches.data.branches,
      capabilities: {
        geometryProducer: producerCapability("C9_GEOMETRY_PRODUCER_STATUS"),
        semanticProducer: producerCapability("C9_SEMANTIC_PRODUCER_STATUS"),
      },
      jobs: jobs.data.jobs,
      project: project.data,
      session: session.data,
      sources: sources.slice(0, 32),
    });
    if (!parsed.success) {
      return problemResponse(
        502,
        "Invalid fusion workspace response",
        "The bounded fusion workspace did not satisfy the frozen consumer contract.",
      );
    }
    return NextResponse.json(parsed.data, { headers: { "cache-control": "no-store" } });
  });
}

export async function GET(request: Request, context: C9RouteContext): Promise<NextResponse> {
  const base = await c9RouteBase(request, context);
  if (base instanceof NextResponse) return base;
  const [resource, jobValue, proposal, extra] = base.remainder;
  if (resource === "workspace" && !jobValue) return workspace(base);
  if (resource !== "fusion-jobs" || extra) {
    return problemResponse(404, "Fusion route unavailable", "This fusion route is not available.");
  }
  if (!jobValue) {
    return validatedC9Backend({
      accessToken: base.accessToken,
      path: jobsPath(base),
      schema: listFusionJobsResponseSchema,
    });
  }
  const jobId = parseFusionJobId(jobValue);
  if (jobId instanceof NextResponse) return jobId;
  if (proposal === "proposal") {
    return validatedC9Backend({
      accessToken: base.accessToken,
      path: `${jobsPath(base)}/${jobId}/proposal`,
      schema: fusionProposalSchema,
    });
  }
  if (proposal) {
    return problemResponse(404, "Fusion route unavailable", "This fusion route is not available.");
  }
  return validatedC9Backend({
    accessToken: base.accessToken,
    path: `${jobsPath(base)}/${jobId}`,
    schema: fusionJobSchema,
  });
}

export async function POST(request: Request, context: C9RouteContext): Promise<NextResponse> {
  const base = await c9RouteBase(request, context);
  if (base instanceof NextResponse) return base;
  const [resource, jobValue, action, subaction, extra] = base.remainder;
  if (resource !== "fusion-jobs" || extra) {
    return problemResponse(404, "Fusion route unavailable", "This fusion route is not available.");
  }
  const key = requireC9MutationKey(request);
  if (key instanceof NextResponse) return key;
  if (!jobValue && !action) {
    const body = await parseC9Body(request, createFusionJobRequestSchema);
    if (body instanceof NextResponse) return body;
    return validatedC9Backend({
      accessToken: base.accessToken,
      body,
      idempotencyKey: key,
      method: "POST",
      path: jobsPath(base),
      schema: fusionJobSchema,
    });
  }
  const jobId = parseFusionJobId(jobValue);
  if (jobId instanceof NextResponse) return jobId;
  if ((action === "cancel" || action === "retry") && !subaction) {
    const body = await parseC9Body(request, transitionFusionJobRequestSchema);
    if (body instanceof NextResponse) return body;
    return validatedC9Backend({
      accessToken: base.accessToken,
      body,
      idempotencyKey: key,
      method: "POST",
      path: `${jobsPath(base)}/${jobId}/${action}`,
      schema: fusionJobSchema,
    });
  }
  if (action === "proposal" && subaction === "discrepancy-decisions") {
    const body = await parseC9Body(request, reviewFusionDiscrepanciesRequestSchema);
    if (body instanceof NextResponse) return body;
    return validatedC9Backend({
      accessToken: base.accessToken,
      body,
      idempotencyKey: key,
      method: "POST",
      path: `${jobsPath(base)}/${jobId}/proposal/discrepancy-decisions`,
      schema: fusionReviewResponseSchema,
    });
  }
  if (action === "proposal" && subaction === "operation-drafts") {
    const body = await parseC9Body(request, createFusionOperationDraftRequestSchema);
    if (body instanceof NextResponse) return body;
    return validatedC9Backend({
      accessToken: base.accessToken,
      body,
      idempotencyKey: key,
      method: "POST",
      path: `${jobsPath(base)}/${jobId}/proposal/operation-drafts`,
      schema: fusionOperationDraftSchema,
    });
  }
  return problemResponse(404, "Fusion route unavailable", "This fusion route is not available.");
}
