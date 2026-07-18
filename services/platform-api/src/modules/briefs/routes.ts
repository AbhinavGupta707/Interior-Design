import { authoriseProjectAction, type ProjectAction } from "@interior-design/authz";
import {
  acceptBriefRequestSchema,
  c11RouteContract,
  designBriefSchema,
  projectIdSchema,
  updateBriefRequestSchema,
  type Actor,
} from "@interior-design/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { getRequestCorrelation } from "../../correlation.js";
import { forbidden, notFound, parseRequest } from "../identity/http.js";
import type { IdentityService } from "../identity/service.js";
import type { ProjectRepository } from "../projects/repository.js";
import type { BriefService } from "./service.js";

const projectParamsSchema = z.object({ projectId: projectIdSchema }).strict();

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

export function registerBriefRoutes(
  server: FastifyInstance,
  identity: IdentityService,
  projects: ProjectRepository,
  service: BriefService,
): void {
  server.get(c11RouteContract.getBrief, async (request, reply) => {
    const params = parseRequest(projectParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "brief:read",
      identity,
      projects,
    );
    reply.header("cache-control", "private, no-store");
    return reply.send(designBriefSchema.parse(await service.get(actor.tenantId, params.projectId)));
  });

  server.put(c11RouteContract.updateBrief, async (request, reply) => {
    const params = parseRequest(projectParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "brief:update",
      identity,
      projects,
    );
    const body = parseRequest(updateBriefRequestSchema, request.body);
    const result = await service.update({
      actor,
      correlation: getRequestCorrelation(request),
      projectId: params.projectId,
      request: body,
    });
    if (result.replayed) reply.header("Idempotent-Replay", "true");
    reply.header("cache-control", "private, no-store");
    return reply.send(designBriefSchema.parse(result.record.brief));
  });

  server.post(c11RouteContract.acceptBrief, async (request, reply) => {
    const params = parseRequest(projectParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "brief:accept",
      identity,
      projects,
    );
    const body = parseRequest(acceptBriefRequestSchema, request.body);
    const result = await service.accept({
      actor,
      correlation: getRequestCorrelation(request),
      projectId: params.projectId,
      request: body,
    });
    if (result.replayed) reply.header("Idempotent-Replay", "true");
    reply.header("cache-control", "private, no-store");
    return reply.send(designBriefSchema.parse(result.record.brief));
  });
}
