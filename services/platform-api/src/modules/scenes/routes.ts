import { authoriseProjectAction, type ProjectAction } from "@interior-design/authz";
import {
  c10RouteContract,
  createSceneJobRequestSchema,
  projectIdSchema,
  sceneAccessResponseSchema,
  sceneJobIdSchema,
  sceneJobSchema,
  sceneRecordSchema,
  type Actor,
} from "@interior-design/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { getRequestCorrelation } from "../../correlation.js";
import { forbidden, notFound, parseRequest } from "../identity/http.js";
import type { IdentityService } from "../identity/service.js";
import { parseIdempotencyKey } from "../projects/idempotency.js";
import type { ProjectRepository } from "../projects/repository.js";
import type { SceneService } from "./service.js";

const projectParamsSchema = z.object({ projectId: projectIdSchema }).strict();
const jobParamsSchema = z
  .object({ projectId: projectIdSchema, sceneJobId: sceneJobIdSchema })
  .strict();
const transitionRequestSchema = z.object({ expectedVersion: z.int().positive() }).strict();
const accessRequestSchema = z.object({}).strict();
const listJobsResponseSchema = z.object({ jobs: z.array(sceneJobSchema).max(100) }).strict();

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

export function registerSceneRoutes(
  server: FastifyInstance,
  identity: IdentityService,
  projects: ProjectRepository,
  service: SceneService,
): void {
  server.post(c10RouteContract.createJob, async (request, reply) => {
    const params = parseRequest(projectParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "scene:job:create",
      identity,
      projects,
    );
    const result = await service.createJob({
      actor,
      correlation: getRequestCorrelation(request),
      idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
      projectId: params.projectId,
      request: parseRequest(createSceneJobRequestSchema, request.body),
    });
    if (result.replayed) reply.header("Idempotent-Replay", "true");
    return reply.status(201).send(sceneJobSchema.parse(result.job));
  });

  server.get(c10RouteContract.listJobs, async (request, reply) => {
    const params = parseRequest(projectParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "scene:job:read",
      identity,
      projects,
    );
    return reply.send(
      listJobsResponseSchema.parse({
        jobs: await service.listJobs(actor.tenantId, params.projectId),
      }),
    );
  });

  server.get(c10RouteContract.getJob, async (request, reply) => {
    const params = parseRequest(jobParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "scene:job:read",
      identity,
      projects,
    );
    return reply.send(
      sceneJobSchema.parse(
        await service.getJob(actor.tenantId, params.projectId, params.sceneJobId),
      ),
    );
  });

  for (const transition of ["cancel", "retry"] as const) {
    server.post(
      transition === "cancel" ? c10RouteContract.cancelJob : c10RouteContract.retryJob,
      async (request, reply) => {
        const params = parseRequest(jobParamsSchema, request.params);
        const actor = await authorisedProject(
          request,
          params.projectId,
          transition === "cancel" ? "scene:job:cancel" : "scene:job:retry",
          identity,
          projects,
        );
        const body = parseRequest(transitionRequestSchema, request.body);
        const command = {
          actor,
          correlation: getRequestCorrelation(request),
          expectedVersion: body.expectedVersion,
          idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
          projectId: params.projectId,
          sceneJobId: params.sceneJobId,
        };
        const result =
          transition === "cancel"
            ? await service.cancelJob(command)
            : await service.retryJob(command);
        if (result.replayed) reply.header("Idempotent-Replay", "true");
        return reply.send(sceneJobSchema.parse(result.job));
      },
    );
  }

  server.get(c10RouteContract.getScene, async (request, reply) => {
    const params = parseRequest(jobParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "scene:artifact:read",
      identity,
      projects,
    );
    reply.header("cache-control", "private, no-store");
    return reply.send(
      sceneRecordSchema.parse(
        await service.getScene(actor.tenantId, params.projectId, params.sceneJobId),
      ),
    );
  });

  server.post(c10RouteContract.createSceneAccess, async (request, reply) => {
    const params = parseRequest(jobParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "scene:artifact:read",
      identity,
      projects,
    );
    parseRequest(accessRequestSchema, request.body ?? {});
    const response = await service.createAccess({
      actor,
      correlation: getRequestCorrelation(request),
      projectId: params.projectId,
      sceneJobId: params.sceneJobId,
    });
    reply.header("cache-control", "private, no-store");
    return reply.send(sceneAccessResponseSchema.parse(response));
  });
}
