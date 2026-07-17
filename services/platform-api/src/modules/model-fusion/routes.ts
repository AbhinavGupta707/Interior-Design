import { authoriseProjectAction, type ProjectAction } from "@interior-design/authz";
import {
  c9RouteContract,
  createFusionJobRequestSchema,
  createFusionOperationDraftRequestSchema,
  fusionDiscrepancyDecisionSchema,
  fusionJobIdSchema,
  fusionJobSchema,
  fusionOperationDraftSchema,
  fusionProposalSchema,
  projectIdSchema,
  reviewFusionDiscrepanciesRequestSchema,
  type Actor,
} from "@interior-design/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { getRequestCorrelation } from "../../correlation.js";
import { forbidden, notFound, parseRequest } from "../identity/http.js";
import type { IdentityService } from "../identity/service.js";
import { parseIdempotencyKey } from "../projects/idempotency.js";
import type { ProjectRepository } from "../projects/repository.js";
import type { ModelFusionService } from "./service.js";

const projectParamsSchema = z.object({ projectId: projectIdSchema }).strict();
const jobParamsSchema = z
  .object({ fusionJobId: fusionJobIdSchema, projectId: projectIdSchema })
  .strict();
const transitionRequestSchema = z.object({ expectedVersion: z.int().positive() }).strict();
const listJobsResponseSchema = z.object({ jobs: z.array(fusionJobSchema).max(100) }).strict();
const reviewResponseSchema = z
  .object({
    decisions: z.array(fusionDiscrepancyDecisionSchema).max(50),
    proposal: fusionProposalSchema,
  })
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

export function registerModelFusionRoutes(
  server: FastifyInstance,
  identity: IdentityService,
  projects: ProjectRepository,
  service: ModelFusionService,
): void {
  server.post(c9RouteContract.createJob, async (request, reply) => {
    const params = parseRequest(projectParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "fusion:job:create",
      identity,
      projects,
    );
    const result = await service.createJob({
      actor,
      correlation: getRequestCorrelation(request),
      idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
      projectId: params.projectId,
      request: parseRequest(createFusionJobRequestSchema, request.body),
    });
    if (result.replayed) reply.header("Idempotent-Replay", "true");
    return reply.status(201).send(fusionJobSchema.parse(result.job));
  });

  server.get(c9RouteContract.listJobs, async (request, reply) => {
    const params = parseRequest(projectParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "fusion:job:read",
      identity,
      projects,
    );
    return reply.send(
      listJobsResponseSchema.parse({
        jobs: await service.listJobs(actor.tenantId, params.projectId),
      }),
    );
  });

  server.get(c9RouteContract.getJob, async (request, reply) => {
    const params = parseRequest(jobParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "fusion:job:read",
      identity,
      projects,
    );
    return reply.send(
      fusionJobSchema.parse(
        await service.getJob(actor.tenantId, params.projectId, params.fusionJobId),
      ),
    );
  });

  for (const transition of ["cancel", "retry"] as const) {
    server.post(
      transition === "cancel" ? c9RouteContract.cancelJob : c9RouteContract.retryJob,
      async (request, reply) => {
        const params = parseRequest(jobParamsSchema, request.params);
        const actor = await authorisedProject(
          request,
          params.projectId,
          transition === "cancel" ? "fusion:job:cancel" : "fusion:job:retry",
          identity,
          projects,
        );
        const body = parseRequest(transitionRequestSchema, request.body);
        const command = {
          actor,
          correlation: getRequestCorrelation(request),
          expectedVersion: body.expectedVersion,
          fusionJobId: params.fusionJobId,
          idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
          projectId: params.projectId,
        };
        const result =
          transition === "cancel"
            ? await service.cancelJob(command)
            : await service.retryJob(command);
        if (result.replayed) reply.header("Idempotent-Replay", "true");
        return reply.send(fusionJobSchema.parse(result.job));
      },
    );
  }

  server.get(c9RouteContract.getProposal, async (request, reply) => {
    const params = parseRequest(jobParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "fusion:proposal:read",
      identity,
      projects,
    );
    return reply.send(
      fusionProposalSchema.parse(
        await service.getProposal(actor.tenantId, params.projectId, params.fusionJobId),
      ),
    );
  });

  server.post(c9RouteContract.reviewDiscrepancies, async (request, reply) => {
    const params = parseRequest(jobParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "fusion:proposal:review",
      identity,
      projects,
    );
    const result = await service.reviewDiscrepancies({
      actor,
      correlation: getRequestCorrelation(request),
      fusionJobId: params.fusionJobId,
      idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
      projectId: params.projectId,
      request: parseRequest(reviewFusionDiscrepanciesRequestSchema, request.body),
    });
    if (result.replayed) reply.header("Idempotent-Replay", "true");
    return reply.send(
      reviewResponseSchema.parse({ decisions: result.decisions, proposal: result.proposal }),
    );
  });

  server.post(c9RouteContract.createOperationDraft, async (request, reply) => {
    const params = parseRequest(jobParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "fusion:proposal:draft",
      identity,
      projects,
    );
    const result = await service.createOperationDraft({
      actor,
      correlation: getRequestCorrelation(request),
      fusionJobId: params.fusionJobId,
      idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
      projectId: params.projectId,
      request: parseRequest(createFusionOperationDraftRequestSchema, request.body),
    });
    if (result.replayed) reply.header("Idempotent-Replay", "true");
    return reply.status(201).send(fusionOperationDraftSchema.parse(result.draft));
  });
}
