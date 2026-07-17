import { authoriseProjectAction, type ProjectAction } from "@interior-design/authz";
import {
  c6RouteContract,
  createPlanCalibrationRequestSchema,
  createPlanOperationDraftRequestSchema,
  createPlanProcessingJobRequestSchema,
  listPlanProcessingJobsResponseSchema,
  planCalibrationSchema,
  planOperationDraftSchema,
  planParserResultSchema,
  planProcessingJobIdSchema,
  planProcessingJobSchema,
  projectIdSchema,
  transitionPlanProcessingJobRequestSchema,
  type Actor,
} from "@interior-design/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { getRequestCorrelation } from "../../correlation.js";
import { forbidden, notFound, parseRequest } from "../identity/http.js";
import type { IdentityService } from "../identity/service.js";
import { parseIdempotencyKey } from "../projects/idempotency.js";
import type { ProjectRepository } from "../projects/repository.js";
import type { PlanProcessingService } from "./service.js";

const projectParamsSchema = z.object({ projectId: projectIdSchema }).strict();
const jobParamsSchema = z
  .object({ jobId: planProcessingJobIdSchema, projectId: projectIdSchema })
  .strict();

async function authorisedProject(
  request: FastifyRequest,
  projectId: string,
  action: ProjectAction,
  identity: IdentityService,
  projects: ProjectRepository,
): Promise<Actor> {
  const session = await identity.authenticate(request.headers.authorization);
  if (
    !authoriseProjectAction(session.actor, action, { tenantId: session.actor.tenantId }).allowed
  ) {
    throw forbidden();
  }
  if ((await projects.findById(session.actor.tenantId, projectId)) === undefined) throw notFound();
  return session.actor;
}

export function registerPlanProcessingRoutes(
  server: FastifyInstance,
  identity: IdentityService,
  projects: ProjectRepository,
  service: PlanProcessingService,
): void {
  server.post(c6RouteContract.createJob, async (request, reply) => {
    const params = parseRequest(projectParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "plan:job:create",
      identity,
      projects,
    );
    const body = parseRequest(createPlanProcessingJobRequestSchema, request.body);
    const result = await service.createJob({
      actor,
      assetId: body.assetId,
      correlation: getRequestCorrelation(request),
      idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
      pageIndex: body.pageIndex,
      parserPreference: body.parserPreference,
      projectId: params.projectId,
    });
    if (result.replayed) reply.header("Idempotent-Replay", "true");
    return reply.status(201).send(planProcessingJobSchema.parse(result.job));
  });

  server.get(c6RouteContract.listJobs, async (request, reply) => {
    const params = parseRequest(projectParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "plan:job:read",
      identity,
      projects,
    );
    return reply.send(
      listPlanProcessingJobsResponseSchema.parse({
        jobs: await service.listJobs(actor.tenantId, params.projectId),
      }),
    );
  });

  server.get(c6RouteContract.getJob, async (request, reply) => {
    const params = parseRequest(jobParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "plan:job:read",
      identity,
      projects,
    );
    return reply.send(
      planProcessingJobSchema.parse(
        await service.getJob(actor.tenantId, params.projectId, params.jobId),
      ),
    );
  });

  server.post(c6RouteContract.cancelJob, async (request, reply) => {
    const params = parseRequest(jobParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "plan:job:cancel",
      identity,
      projects,
    );
    const body = parseRequest(transitionPlanProcessingJobRequestSchema, request.body);
    const result = await service.cancelJob({
      actor,
      correlation: getRequestCorrelation(request),
      expectedVersion: body.expectedVersion,
      idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
      jobId: params.jobId,
      projectId: params.projectId,
    });
    if (result.replayed) reply.header("Idempotent-Replay", "true");
    return reply.send(planProcessingJobSchema.parse(result.job));
  });

  server.post(c6RouteContract.retryJob, async (request, reply) => {
    const params = parseRequest(jobParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "plan:job:retry",
      identity,
      projects,
    );
    const body = parseRequest(transitionPlanProcessingJobRequestSchema, request.body);
    const result = await service.retryJob({
      actor,
      correlation: getRequestCorrelation(request),
      expectedVersion: body.expectedVersion,
      idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
      jobId: params.jobId,
      projectId: params.projectId,
    });
    if (result.replayed) reply.header("Idempotent-Replay", "true");
    return reply.send(planProcessingJobSchema.parse(result.job));
  });

  server.get(c6RouteContract.getProposal, async (request, reply) => {
    const params = parseRequest(jobParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "plan:proposal:read",
      identity,
      projects,
    );
    return reply.send(
      planParserResultSchema.parse(
        await service.getResult(actor.tenantId, params.projectId, params.jobId),
      ),
    );
  });

  server.post(c6RouteContract.calibrateProposal, async (request, reply) => {
    const params = parseRequest(jobParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "plan:proposal:calibrate",
      identity,
      projects,
    );
    const body = parseRequest(createPlanCalibrationRequestSchema, request.body);
    const result = await service.createCalibration({
      actor,
      correlation: getRequestCorrelation(request),
      idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
      jobId: params.jobId,
      projectId: params.projectId,
      request: body,
    });
    if (result.replayed) reply.header("Idempotent-Replay", "true");
    return reply.status(201).send(planCalibrationSchema.parse(result.calibration));
  });

  server.post(c6RouteContract.createOperationDraft, async (request, reply) => {
    const params = parseRequest(jobParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "plan:proposal:draft",
      identity,
      projects,
    );
    const body = parseRequest(createPlanOperationDraftRequestSchema, request.body);
    const result = await service.createOperationDraft({
      actor,
      correlation: getRequestCorrelation(request),
      idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
      jobId: params.jobId,
      projectId: params.projectId,
      request: body,
    });
    if (result.replayed) reply.header("Idempotent-Replay", "true");
    return reply.status(201).send(planOperationDraftSchema.parse(result.draft));
  });
}
