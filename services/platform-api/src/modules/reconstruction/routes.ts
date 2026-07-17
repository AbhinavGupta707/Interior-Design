import { authoriseProjectAction, type ProjectAction } from "@interior-design/authz";
import {
  c8RouteContract,
  createReconstructionJobRequestSchema,
  projectIdSchema,
  reconstructionJobIdSchema,
  reconstructionJobSchema,
  reconstructionResultSchema,
  type Actor,
} from "@interior-design/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { getRequestCorrelation } from "../../correlation.js";
import { forbidden, notFound, parseRequest } from "../identity/http.js";
import type { IdentityService } from "../identity/service.js";
import { parseIdempotencyKey } from "../projects/idempotency.js";
import type { ProjectRepository } from "../projects/repository.js";
import type { ReconstructionService } from "./service.js";

const projectParamsSchema = z.object({ projectId: projectIdSchema }).strict();
const jobParamsSchema = z
  .object({ projectId: projectIdSchema, reconstructionJobId: reconstructionJobIdSchema })
  .strict();
const transitionRequestSchema = z.object({ expectedVersion: z.int().positive() }).strict();
const listJobsResponseSchema = z.object({ jobs: z.array(reconstructionJobSchema) }).strict();

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

export function registerReconstructionRoutes(
  server: FastifyInstance,
  identity: IdentityService,
  projects: ProjectRepository,
  service: ReconstructionService,
): void {
  server.post(c8RouteContract.createJob, async (request, reply) => {
    const params = parseRequest(projectParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "reconstruction:job:create",
      identity,
      projects,
    );
    const body = parseRequest(createReconstructionJobRequestSchema, request.body);
    const result = await service.createJob({
      actor,
      correlation: getRequestCorrelation(request),
      idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
      projectId: params.projectId,
      request: body,
    });
    if (result.replayed) reply.header("Idempotent-Replay", "true");
    return reply.status(201).send(reconstructionJobSchema.parse(result.job));
  });

  server.get(c8RouteContract.listJobs, async (request, reply) => {
    const params = parseRequest(projectParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "reconstruction:job:read",
      identity,
      projects,
    );
    return reply.send(
      listJobsResponseSchema.parse({
        jobs: await service.listJobs(actor.tenantId, params.projectId),
      }),
    );
  });

  server.get(c8RouteContract.getJob, async (request, reply) => {
    const params = parseRequest(jobParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "reconstruction:job:read",
      identity,
      projects,
    );
    return reply.send(
      reconstructionJobSchema.parse(
        await service.getJob(actor.tenantId, params.projectId, params.reconstructionJobId),
      ),
    );
  });

  server.post(c8RouteContract.cancelJob, async (request, reply) => {
    const params = parseRequest(jobParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "reconstruction:job:cancel",
      identity,
      projects,
    );
    const body = parseRequest(transitionRequestSchema, request.body);
    const result = await service.cancelJob({
      actor,
      correlation: getRequestCorrelation(request),
      expectedVersion: body.expectedVersion,
      idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
      projectId: params.projectId,
      reconstructionJobId: params.reconstructionJobId,
    });
    if (result.replayed) reply.header("Idempotent-Replay", "true");
    return reply.send(reconstructionJobSchema.parse(result.job));
  });

  server.post(c8RouteContract.retryJob, async (request, reply) => {
    const params = parseRequest(jobParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "reconstruction:job:retry",
      identity,
      projects,
    );
    const body = parseRequest(transitionRequestSchema, request.body);
    const result = await service.retryJob({
      actor,
      correlation: getRequestCorrelation(request),
      expectedVersion: body.expectedVersion,
      idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
      projectId: params.projectId,
      reconstructionJobId: params.reconstructionJobId,
    });
    if (result.replayed) reply.header("Idempotent-Replay", "true");
    return reply.send(reconstructionJobSchema.parse(result.job));
  });

  server.get(c8RouteContract.getResult, async (request, reply) => {
    const params = parseRequest(jobParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "reconstruction:result:read",
      identity,
      projects,
    );
    return reply.send(
      reconstructionResultSchema.parse(
        await service.getResult(actor.tenantId, params.projectId, params.reconstructionJobId),
      ),
    );
  });
}
