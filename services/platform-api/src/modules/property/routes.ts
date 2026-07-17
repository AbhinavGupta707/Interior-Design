import { authoriseProjectAction, type ProjectAction } from "@interior-design/authz";
import {
  c3RouteContract,
  projectIdSchema,
  propertySourceRecordsResponseSchema,
  refreshPropertyDossierRequestSchema,
  resolvePropertyRequestSchema,
  selectProjectPropertyRequestSchema,
  type Actor,
  type ProjectProperty,
  type PropertyDossier,
  type PropertyResolutionResponse,
  type PropertySourceRecord,
} from "@interior-design/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { getRequestCorrelation } from "../../correlation.js";
import { forbidden, notFound, parseRequest } from "../identity/http.js";
import type { IdentityService } from "../identity/service.js";
import { parseIdempotencyKey } from "../projects/idempotency.js";
import type { ProjectRepository } from "../projects/repository.js";
import type { PropertyBackend } from "./types.js";

const projectParamsSchema = z.object({ projectId: projectIdSchema }).strict();

async function authorisedProject(
  request: FastifyRequest,
  untrustedParams: unknown,
  action: ProjectAction,
  identity: IdentityService,
  projects: ProjectRepository,
): Promise<{ readonly actor: Actor; readonly projectId: string }> {
  const session = await identity.authenticate(request.headers.authorization);
  if (
    !authoriseProjectAction(session.actor, action, { tenantId: session.actor.tenantId }).allowed
  ) {
    throw forbidden();
  }
  const params = parseRequest(projectParamsSchema, untrustedParams);
  if ((await projects.findById(session.actor.tenantId, params.projectId)) === undefined) {
    throw notFound();
  }
  return { actor: session.actor, projectId: params.projectId };
}

export function registerPropertyRoutes(
  server: FastifyInstance,
  identity: IdentityService,
  projects: ProjectRepository,
  properties: PropertyBackend,
): void {
  server.post<{ Params: { readonly projectId: string }; Reply: PropertyResolutionResponse }>(
    c3RouteContract.resolveProperty,
    async (request, reply) => {
      const { actor, projectId } = await authorisedProject(
        request,
        request.params,
        "property:resolve",
        identity,
        projects,
      );
      const body = parseRequest(resolvePropertyRequestSchema, request.body);
      const idempotencyKey = parseIdempotencyKey(request.headers["idempotency-key"]);
      const resolution = await properties.resolve({
        actor,
        correlation: getRequestCorrelation(request),
        idempotencyKey,
        projectId,
        request: body,
      });
      return reply.status(201).send(resolution);
    },
  );

  server.put<{ Params: { readonly projectId: string }; Reply: ProjectProperty }>(
    c3RouteContract.selectProperty,
    async (request, reply) => {
      const { actor, projectId } = await authorisedProject(
        request,
        request.params,
        "property:update",
        identity,
        projects,
      );
      const body = parseRequest(selectProjectPropertyRequestSchema, request.body);
      const idempotencyKey = parseIdempotencyKey(request.headers["idempotency-key"]);
      return reply.send(
        await properties.select({
          actor,
          correlation: getRequestCorrelation(request),
          idempotencyKey,
          projectId,
          request: body,
        }),
      );
    },
  );

  server.get<{ Params: { readonly projectId: string }; Reply: PropertyDossier }>(
    c3RouteContract.getDossier,
    async (request, reply) => {
      const { actor, projectId } = await authorisedProject(
        request,
        request.params,
        "property:read",
        identity,
        projects,
      );
      const dossier = await properties.getDossier(actor.tenantId, projectId);
      if (dossier === undefined) {
        throw notFound();
      }
      return reply.send(dossier);
    },
  );

  server.post<{ Params: { readonly projectId: string }; Reply: PropertyDossier }>(
    c3RouteContract.refreshDossier,
    async (request, reply) => {
      const { actor, projectId } = await authorisedProject(
        request,
        request.params,
        "property:refresh",
        identity,
        projects,
      );
      const body = parseRequest(refreshPropertyDossierRequestSchema, request.body);
      const idempotencyKey = parseIdempotencyKey(request.headers["idempotency-key"]);
      return reply.send(
        await properties.refreshDossier({
          actor,
          correlation: getRequestCorrelation(request),
          idempotencyKey,
          projectId,
          request: body,
        }),
      );
    },
  );

  server.get<{
    Params: { readonly projectId: string };
    Reply: { readonly sources: readonly PropertySourceRecord[] };
  }>(c3RouteContract.listSourceRecords, async (request, reply) => {
    const { actor, projectId } = await authorisedProject(
      request,
      request.params,
      "property:read",
      identity,
      projects,
    );
    const sources = await properties.listSourceRecords(actor.tenantId, projectId);
    if (sources === undefined) {
      throw notFound();
    }
    return reply.send(propertySourceRecordsResponseSchema.parse({ sources }));
  });
}
