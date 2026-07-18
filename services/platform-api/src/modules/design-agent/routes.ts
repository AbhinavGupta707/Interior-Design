import { authoriseProjectAction, type ProjectAction } from "@interior-design/authz";
import {
  briefPatchProposalSchema,
  c11RouteContract,
  confirmBriefPatchProposalRequestSchema,
  consultationSessionSchema,
  createConsultationSessionRequestSchema,
  designBriefSchema,
  projectIdSchema,
  submitConsultationTurnRequestSchema,
  type Actor,
} from "@interior-design/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { getRequestCorrelation } from "../../correlation.js";
import { forbidden, invalidRequest, notFound, parseRequest } from "../identity/http.js";
import type { IdentityService } from "../identity/service.js";
import { parseIdempotencyKey } from "../projects/idempotency.js";
import type { ProjectRepository } from "../projects/repository.js";
import type { DesignAgentService } from "./service.js";

const projectParamsSchema = z.object({ projectId: projectIdSchema }).strict();
const sessionParamsSchema = z.object({ projectId: projectIdSchema, sessionId: z.uuid() }).strict();
const proposalParamsSchema = z
  .object({ projectId: projectIdSchema, proposalId: z.uuid(), sessionId: z.uuid() })
  .strict();
const emptyBodySchema = z.object({}).strict();

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

function matchingIdempotencyKey(request: FastifyRequest, bodyKey?: string): string {
  const headerKey = parseIdempotencyKey(request.headers["idempotency-key"]);
  if (bodyKey !== undefined && bodyKey !== headerKey) throw invalidRequest();
  return headerKey;
}

function privateNoStore(reply: { header(name: string, value: string): unknown }): void {
  reply.header("cache-control", "private, no-store");
}

export function registerDesignAgentRoutes(
  server: FastifyInstance,
  identity: IdentityService,
  projects: ProjectRepository,
  service: DesignAgentService,
): void {
  server.post(c11RouteContract.createConsultation, async (request, reply) => {
    const params = parseRequest(projectParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "consultation:session:create",
      identity,
      projects,
    );
    const body = parseRequest(createConsultationSessionRequestSchema, request.body);
    matchingIdempotencyKey(request, body.idempotencyKey);
    const result = await service.createSession({
      actor,
      correlation: getRequestCorrelation(request),
      projectId: params.projectId,
      request: body,
    });
    if (result.replayed) reply.header("Idempotent-Replay", "true");
    privateNoStore(reply);
    return reply.status(201).send(consultationSessionSchema.parse(result.session));
  });

  server.get(c11RouteContract.getConsultation, async (request, reply) => {
    const params = parseRequest(sessionParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "consultation:session:read",
      identity,
      projects,
    );
    const session = await service.getSession(actor.tenantId, params.projectId, params.sessionId);
    privateNoStore(reply);
    return reply.send(consultationSessionSchema.parse(session));
  });

  server.post(c11RouteContract.cancelConsultation, async (request, reply) => {
    const params = parseRequest(sessionParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "consultation:session:cancel",
      identity,
      projects,
    );
    parseRequest(emptyBodySchema, request.body ?? {});
    const result = await service.cancelSession({
      actor,
      correlation: getRequestCorrelation(request),
      idempotencyKey: matchingIdempotencyKey(request),
      projectId: params.projectId,
      sessionId: params.sessionId,
    });
    if (result.replayed) reply.header("Idempotent-Replay", "true");
    privateNoStore(reply);
    return reply.send(consultationSessionSchema.parse(result.session));
  });

  server.post(c11RouteContract.submitTurn, async (request, reply) => {
    const params = parseRequest(sessionParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "consultation:session:create",
      identity,
      projects,
    );
    const body = parseRequest(submitConsultationTurnRequestSchema, request.body);
    matchingIdempotencyKey(request, body.clientMessageId);
    const cancellation = new AbortController();
    const abort = () => {
      cancellation.abort();
    };
    request.raw.once("aborted", abort);
    try {
      const result = await service.submitTurn({
        actor,
        correlation: getRequestCorrelation(request),
        projectId: params.projectId,
        request: body,
        sessionId: params.sessionId,
        signal: cancellation.signal,
      });
      if (result.replayed) reply.header("Idempotent-Replay", "true");
      privateNoStore(reply);
      return await reply.status(201).send(briefPatchProposalSchema.parse(result.turn.proposal));
    } finally {
      request.raw.off("aborted", abort);
    }
  });

  server.get(c11RouteContract.getProposal, async (request, reply) => {
    const params = parseRequest(proposalParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "consultation:proposal:read",
      identity,
      projects,
    );
    const proposal = await service.getProposal(
      actor.tenantId,
      params.projectId,
      params.sessionId,
      params.proposalId,
    );
    privateNoStore(reply);
    return reply.send(briefPatchProposalSchema.parse(proposal));
  });

  server.post(c11RouteContract.confirmProposal, async (request, reply) => {
    const params = parseRequest(proposalParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "consultation:proposal:confirm",
      identity,
      projects,
    );
    const body = parseRequest(confirmBriefPatchProposalRequestSchema, request.body);
    matchingIdempotencyKey(request, body.idempotencyKey);
    const result = await service.confirmProposal({
      actor,
      correlation: getRequestCorrelation(request),
      projectId: params.projectId,
      proposalId: params.proposalId,
      request: body,
      sessionId: params.sessionId,
    });
    if (result.replayed) reply.header("Idempotent-Replay", "true");
    privateNoStore(reply);
    return reply.send(designBriefSchema.parse(result.brief));
  });
}
