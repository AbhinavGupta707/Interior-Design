import { authoriseProjectAction } from "@interior-design/authz";
import {
  c1RouteContract,
  projectIdSchema,
  upsertProjectIntakeRequestSchema,
  type ProjectIntake,
} from "@interior-design/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { getRequestCorrelation } from "../../correlation.js";
import { forbidden, notFound, parseRequest } from "../identity/http.js";
import type { IdentityService } from "../identity/service.js";
import { parseIdempotencyKey } from "../projects/idempotency.js";
import type { ProjectRepository } from "../projects/repository.js";
import type { IntakeRepository } from "./repository.js";

const projectParamsSchema = z.object({ projectId: projectIdSchema }).strict();

export function registerIntakeRoutes(
  server: FastifyInstance,
  identity: IdentityService,
  projects: ProjectRepository,
  intakes: IntakeRepository,
): void {
  server.get<{ Params: { readonly projectId: string }; Reply: ProjectIntake | undefined }>(
    c1RouteContract.getProjectIntake,
    async (request, reply) => {
      const session = await identity.authenticate(request.headers.authorization);
      if (
        !authoriseProjectAction(session.actor, "intake:read", {
          tenantId: session.actor.tenantId,
        }).allowed
      ) {
        throw forbidden();
      }
      const params = parseRequest(projectParamsSchema, request.params);
      if ((await projects.findById(session.actor.tenantId, params.projectId)) === undefined) {
        throw notFound();
      }
      const intake = await intakes.find(session.actor.tenantId, params.projectId);
      if (intake === undefined) {
        return reply.status(204).send(undefined);
      }
      return reply.send(intake);
    },
  );

  server.put<{ Params: { readonly projectId: string }; Reply: ProjectIntake }>(
    c1RouteContract.upsertProjectIntake,
    async (request, reply) => {
      const session = await identity.authenticate(request.headers.authorization);
      if (
        !authoriseProjectAction(session.actor, "intake:update", {
          tenantId: session.actor.tenantId,
        }).allowed
      ) {
        throw forbidden();
      }
      const params = parseRequest(projectParamsSchema, request.params);
      const body = parseRequest(upsertProjectIntakeRequestSchema, request.body);
      const idempotencyKey = parseIdempotencyKey(request.headers["idempotency-key"]);
      return reply.send(
        await intakes.upsert({
          actor: session.actor,
          correlation: getRequestCorrelation(request),
          idempotencyKey,
          projectId: params.projectId,
          request: body,
        }),
      );
    },
  );
}
