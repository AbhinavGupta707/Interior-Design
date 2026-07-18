import { authoriseProjectAction, type ProjectAction } from "@interior-design/authz";
import {
  c12RouteContract,
  confirmOptionRequestSchema,
  createOptionJobRequestSchema,
  designOptionSchema,
  listDesignOptionsResponseSchema,
  listOptionJobsResponseSchema,
  optionConfirmationSchema,
  optionJobSchema,
  projectIdSchema,
  type Actor,
} from "@interior-design/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { getRequestCorrelation } from "../../correlation.js";
import { ApiError } from "../../errors.js";
import { forbidden, notFound, parseRequest } from "../identity/http.js";
import type { IdentityService } from "../identity/service.js";
import { parseIdempotencyKey } from "../projects/idempotency.js";
import type { ProjectRepository } from "../projects/repository.js";
import type { DesignOptionService } from "./service.js";

const projectParamsSchema = z.object({ projectId: projectIdSchema }).strict();
const jobParamsSchema = z.object({ jobId: z.uuid(), projectId: projectIdSchema }).strict();
const optionParamsSchema = z
  .object({ jobId: z.uuid(), optionId: z.uuid(), projectId: projectIdSchema })
  .strict();
const transitionRequestSchema = z.object({ expectedVersion: z.int().positive() }).strict();

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

export function registerDesignOptionRoutes(
  server: FastifyInstance,
  identity: IdentityService,
  projects: ProjectRepository,
  service: DesignOptionService,
): void {
  server.post(c12RouteContract.createJob, async (request, reply) => {
    const params = parseRequest(projectParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "design-option:job:create",
      identity,
      projects,
    );
    const result = await service.createJob({
      actor,
      correlation: getRequestCorrelation(request),
      idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
      projectId: params.projectId,
      request: parseRequest(createOptionJobRequestSchema, request.body),
    });
    if (result.replayed) reply.header("Idempotent-Replay", "true");
    return reply.status(201).send(optionJobSchema.parse(result.job));
  });

  server.get(c12RouteContract.listJobs, async (request, reply) => {
    const params = parseRequest(projectParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "design-option:job:read",
      identity,
      projects,
    );
    return reply.send(
      listOptionJobsResponseSchema.parse({
        jobs: await service.listJobs(actor.tenantId, params.projectId),
        projectId: params.projectId,
      }),
    );
  });

  server.get(c12RouteContract.getJob, async (request, reply) => {
    const params = parseRequest(jobParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "design-option:job:read",
      identity,
      projects,
    );
    return reply.send(
      optionJobSchema.parse(await service.getJob(actor.tenantId, params.projectId, params.jobId)),
    );
  });

  for (const transition of ["cancel", "retry"] as const) {
    server.post(
      transition === "cancel" ? c12RouteContract.cancelJob : c12RouteContract.retryJob,
      async (request, reply) => {
        const params = parseRequest(jobParamsSchema, request.params);
        const actor = await authorisedProject(
          request,
          params.projectId,
          transition === "cancel" ? "design-option:job:cancel" : "design-option:job:retry",
          identity,
          projects,
        );
        const body = parseRequest(transitionRequestSchema, request.body);
        const command = {
          actor,
          correlation: getRequestCorrelation(request),
          expectedVersion: body.expectedVersion,
          idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
          jobId: params.jobId,
          projectId: params.projectId,
        };
        const result =
          transition === "cancel"
            ? await service.cancelJob(command)
            : await service.retryJob(command);
        if (result.replayed) reply.header("Idempotent-Replay", "true");
        return reply.send(optionJobSchema.parse(result.job));
      },
    );
  }

  server.get(c12RouteContract.listOptions, async (request, reply) => {
    const params = parseRequest(jobParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "design-option:proposal:read",
      identity,
      projects,
    );
    const result = await service.listOptions(actor.tenantId, params.projectId, params.jobId);
    return reply.send(
      listDesignOptionsResponseSchema.parse({
        jobId: params.jobId,
        ...(result.optionSet === undefined ? {} : { optionSet: result.optionSet }),
        options: result.options,
        projectId: params.projectId,
      }),
    );
  });

  server.get(c12RouteContract.getOption, async (request, reply) => {
    const params = parseRequest(optionParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "design-option:proposal:read",
      identity,
      projects,
    );
    return reply.send(
      designOptionSchema.parse(
        await service.getOption(actor.tenantId, params.projectId, params.jobId, params.optionId),
      ),
    );
  });

  server.post(c12RouteContract.confirmOption, async (request, reply) => {
    const params = parseRequest(optionParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "design-option:proposal:confirm",
      identity,
      projects,
    );
    if (/^(?:machine|service):/u.test(actor.subject)) throw forbidden();
    const body = parseRequest(confirmOptionRequestSchema, request.body);
    const headerIdempotencyKey = parseRequest(
      z.uuid(),
      parseIdempotencyKey(request.headers["idempotency-key"]),
    );
    if (headerIdempotencyKey !== body.idempotencyKey) {
      throw new ApiError({
        code: "IDEMPOTENCY_KEY_MISMATCH",
        detail: "The Idempotency-Key header must match the confirmation body key.",
        statusCode: 400,
        title: "Idempotency Key Mismatch",
      });
    }
    const result = await service.confirmOption({
      actor,
      correlation: getRequestCorrelation(request),
      jobId: params.jobId,
      optionId: params.optionId,
      projectId: params.projectId,
      request: body,
    });
    if (result.replayed) reply.header("Idempotent-Replay", "true");
    return reply.status(201).send(optionConfirmationSchema.parse(result.confirmation));
  });
}
