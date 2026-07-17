import { authoriseProjectAction } from "@interior-design/authz";
import {
  c1RouteContract,
  createProjectRequestSchema,
  projectIdSchema,
  type Project,
} from "@interior-design/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { getRequestCorrelation } from "../../correlation.js";
import { forbidden, notFound, parseRequest } from "../identity/http.js";
import type { IdentityService } from "../identity/service.js";
import { parseIdempotencyKey } from "./idempotency.js";
import type { ProjectRepository } from "./repository.js";

const projectParamsSchema = z.object({ projectId: projectIdSchema }).strict();

export function registerProjectRoutes(
  server: FastifyInstance,
  identity: IdentityService,
  projects: ProjectRepository,
): void {
  server.post<{ Reply: Project }>(c1RouteContract.createProject, async (request, reply) => {
    const session = await identity.authenticate(request.headers.authorization);
    if (
      !authoriseProjectAction(session.actor, "project:create", {
        tenantId: session.actor.tenantId,
      }).allowed
    ) {
      throw forbidden();
    }
    const body = parseRequest(createProjectRequestSchema, request.body);
    const idempotencyKey = parseIdempotencyKey(request.headers["idempotency-key"]);
    const project = await projects.create({
      actor: session.actor,
      correlation: getRequestCorrelation(request),
      idempotencyKey,
      request: body,
    });
    return reply.status(201).send(project);
  });

  server.get<{ Reply: readonly Project[] }>(
    c1RouteContract.listProjects,
    async (request, reply) => {
      const session = await identity.authenticate(request.headers.authorization);
      if (
        !authoriseProjectAction(session.actor, "project:read", {
          tenantId: session.actor.tenantId,
        }).allowed
      ) {
        throw forbidden();
      }
      return reply.send(await projects.list(session.actor.tenantId));
    },
  );

  server.get<{ Params: { readonly projectId: string }; Reply: Project }>(
    c1RouteContract.getProject,
    async (request, reply) => {
      const session = await identity.authenticate(request.headers.authorization);
      if (
        !authoriseProjectAction(session.actor, "project:read", {
          tenantId: session.actor.tenantId,
        }).allowed
      ) {
        throw forbidden();
      }
      const params = parseRequest(projectParamsSchema, request.params);
      const project = await projects.findById(session.actor.tenantId, params.projectId);
      if (project === undefined) {
        throw notFound();
      }
      return reply.send(project);
    },
  );
}
