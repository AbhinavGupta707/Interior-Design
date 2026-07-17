import { authoriseProjectAction, type ProjectAction } from "@interior-design/authz";
import {
  c7RouteContract,
  captureArtifactUploadSessionSchema,
  capturePackageSchema,
  captureProposalResultSchema,
  captureSessionIdSchema,
  captureSessionSchema,
  completeCaptureArtifactUploadRequestSchema,
  createCaptureArtifactUploadRequestSchema,
  createCapturePackageRequestSchema,
  createCaptureSessionRequestSchema,
  projectIdSchema,
  signCaptureArtifactPartRequestSchema,
  signedCaptureArtifactPartSchema,
  type Actor,
} from "@interior-design/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { getRequestCorrelation } from "../../correlation.js";
import { forbidden, notFound, parseRequest } from "../identity/http.js";
import type { IdentityService } from "../identity/service.js";
import { parseIdempotencyKey } from "../projects/idempotency.js";
import type { ProjectRepository } from "../projects/repository.js";
import type { CaptureBackend } from "./types.js";

const projectParamsSchema = z.object({ projectId: projectIdSchema }).strict();
const sessionParamsSchema = z
  .object({ captureSessionId: captureSessionIdSchema, projectId: projectIdSchema })
  .strict();
const uploadParamsSchema = sessionParamsSchema.extend({ uploadSessionId: z.uuid() }).strict();
const emptyMutationSchema = z.union([z.undefined(), z.object({}).strict()]);

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

function replayHeader(
  reply: { header(name: string, value: string): unknown },
  replayed: boolean,
): void {
  if (replayed) reply.header("Idempotent-Replay", "true");
}

export function registerCaptureRoutes(
  server: FastifyInstance,
  identity: IdentityService,
  projects: ProjectRepository,
  backend: CaptureBackend,
): void {
  server.post(c7RouteContract.createSession, async (request, reply) => {
    const params = parseRequest(projectParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "capture:session:create",
      identity,
      projects,
    );
    const body = parseRequest(createCaptureSessionRequestSchema, request.body);
    const result = await backend.createSession({
      actor,
      correlation: getRequestCorrelation(request),
      idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
      projectId: params.projectId,
      request: body,
    });
    replayHeader(reply, result.replayed);
    return reply.status(201).send(captureSessionSchema.parse(result.value));
  });

  server.get(c7RouteContract.listSessions, async (request, reply) => {
    const params = parseRequest(projectParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "capture:session:read",
      identity,
      projects,
    );
    return reply.send(
      z
        .array(captureSessionSchema)
        .max(10_000)
        .parse(await backend.listSessions(actor.tenantId, params.projectId)),
    );
  });

  server.get(c7RouteContract.getSession, async (request, reply) => {
    const params = parseRequest(sessionParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "capture:session:read",
      identity,
      projects,
    );
    const capture = await backend.findSession(
      actor.tenantId,
      params.projectId,
      params.captureSessionId,
    );
    if (capture === undefined) throw notFound();
    return reply.send(captureSessionSchema.parse(capture));
  });

  for (const transition of ["cancel", "retry"] as const) {
    const route =
      transition === "cancel" ? c7RouteContract.cancelSession : c7RouteContract.retrySession;
    const action = transition === "cancel" ? "capture:session:cancel" : "capture:proposal:retry";
    server.post(route, async (request, reply) => {
      const params = parseRequest(sessionParamsSchema, request.params);
      const actor = await authorisedProject(request, params.projectId, action, identity, projects);
      parseRequest(emptyMutationSchema, request.body);
      const command = {
        actor,
        captureSessionId: params.captureSessionId,
        correlation: getRequestCorrelation(request),
        idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
        projectId: params.projectId,
      };
      const result =
        transition === "cancel"
          ? await backend.cancelSession(command)
          : await backend.retrySession(command);
      replayHeader(reply, result.replayed);
      return reply.send(captureSessionSchema.parse(result.value));
    });
  }

  server.post(c7RouteContract.createArtifactUpload, async (request, reply) => {
    const params = parseRequest(sessionParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "capture:artifact:upload",
      identity,
      projects,
    );
    const result = await backend.createArtifactUpload({
      actor,
      captureSessionId: params.captureSessionId,
      correlation: getRequestCorrelation(request),
      idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
      projectId: params.projectId,
      request: parseRequest(createCaptureArtifactUploadRequestSchema, request.body),
    });
    replayHeader(reply, result.replayed);
    return reply.status(201).send(captureArtifactUploadSessionSchema.parse(result.value));
  });

  server.get(c7RouteContract.getArtifactUpload, async (request, reply) => {
    const params = parseRequest(uploadParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "capture:artifact:upload",
      identity,
      projects,
    );
    const upload = await backend.findArtifactUpload(
      actor.tenantId,
      params.projectId,
      params.captureSessionId,
      params.uploadSessionId,
    );
    if (upload === undefined) throw notFound();
    return reply.send(captureArtifactUploadSessionSchema.parse(upload));
  });

  server.post(c7RouteContract.signArtifactPart, async (request, reply) => {
    const params = parseRequest(uploadParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "capture:artifact:upload",
      identity,
      projects,
    );
    const result = await backend.signArtifactPart({
      actor,
      captureSessionId: params.captureSessionId,
      correlation: getRequestCorrelation(request),
      idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
      projectId: params.projectId,
      request: parseRequest(signCaptureArtifactPartRequestSchema, request.body),
      uploadSessionId: params.uploadSessionId,
    });
    replayHeader(reply, result.replayed);
    return reply.send(signedCaptureArtifactPartSchema.parse(result.value));
  });

  server.post(c7RouteContract.completeArtifactUpload, async (request, reply) => {
    const params = parseRequest(uploadParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "capture:artifact:upload",
      identity,
      projects,
    );
    const result = await backend.completeArtifactUpload({
      actor,
      captureSessionId: params.captureSessionId,
      correlation: getRequestCorrelation(request),
      idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
      projectId: params.projectId,
      request: parseRequest(completeCaptureArtifactUploadRequestSchema, request.body),
      uploadSessionId: params.uploadSessionId,
    });
    replayHeader(reply, result.replayed);
    return reply.send(captureArtifactUploadSessionSchema.parse(result.value));
  });

  server.post(c7RouteContract.finalizePackage, async (request, reply) => {
    const params = parseRequest(sessionParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "capture:package:finalize",
      identity,
      projects,
    );
    const result = await backend.finalizePackage({
      actor,
      captureSessionId: params.captureSessionId,
      correlation: getRequestCorrelation(request),
      idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
      projectId: params.projectId,
      request: parseRequest(createCapturePackageRequestSchema, request.body),
    });
    replayHeader(reply, result.replayed);
    return reply.status(201).send(capturePackageSchema.parse(result.value));
  });

  server.get(c7RouteContract.getProposal, async (request, reply) => {
    const params = parseRequest(sessionParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "capture:proposal:read",
      identity,
      projects,
    );
    const result = await backend.findProposal(
      actor.tenantId,
      params.projectId,
      params.captureSessionId,
    );
    if (result === undefined) throw notFound();
    return reply.send(captureProposalResultSchema.parse(result));
  });
}
