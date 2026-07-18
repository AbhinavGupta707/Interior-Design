import { authoriseProjectAction, type ProjectAction } from "@interior-design/authz";
import {
  c13RouteContract,
  confirmSubstitutionRequestSchema,
  createSpecificationRequestSchema,
  createSubstitutionPreviewRequestSchema,
  projectIdSchema,
  specificationLineSchema,
  specificationRevisionSchema,
  specificationSchema,
  substitutionConfirmationSchema,
  substitutionPreviewSchema,
  updateSelectionBoardRequestSchema,
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
import type { SpecificationService } from "./service.js";

const projectParamsSchema = z.object({ projectId: projectIdSchema }).strict();
const specificationParamsSchema = z
  .object({ projectId: projectIdSchema, specificationId: z.uuid() })
  .strict();
const previewParamsSchema = specificationParamsSchema.extend({ previewId: z.uuid() }).strict();
const revisionParamsSchema = specificationParamsSchema
  .extend({ revision: z.coerce.number().int().positive() })
  .strict();
const sceneRetrySchema = z.object({ sceneJobId: z.uuid() }).strict();
const specificationListResponseSchema = z
  .object({
    projectId: projectIdSchema,
    specifications: z.array(specificationSchema).max(100),
  })
  .strict();
const specificationRevisionsResponseSchema = z
  .object({
    revisions: z.array(specificationRevisionSchema).max(1_000),
    specificationId: z.uuid(),
  })
  .strict();
const specificationScheduleLinesResponseSchema = z
  .object({
    lines: z.array(specificationLineSchema).max(1_024),
    revision: z.number().int().positive(),
    specificationId: z.uuid(),
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

export function registerSpecificationRoutes(
  server: FastifyInstance,
  identity: IdentityService,
  projects: ProjectRepository,
  service: SpecificationService,
): void {
  server.post(c13RouteContract.createSpecification, async (request, reply) => {
    const params = parseRequest(projectParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "specification:create",
      identity,
      projects,
    );
    const result = await service.create({
      actor,
      correlation: getRequestCorrelation(request),
      idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
      projectId: params.projectId,
      request: parseRequest(createSpecificationRequestSchema.strict(), request.body),
    });
    if (result.replayed) reply.header("Idempotent-Replay", "true");
    return reply.status(201).send(specificationSchema.parse(result.specification));
  });

  server.get(c13RouteContract.listSpecifications, async (request, reply) => {
    const params = parseRequest(projectParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "specification:read",
      identity,
      projects,
    );
    return reply.send(
      specificationListResponseSchema.parse({
        projectId: params.projectId,
        specifications: await service.list(actor.tenantId, params.projectId),
      }),
    );
  });

  server.get(c13RouteContract.getSpecification, async (request, reply) => {
    const params = parseRequest(specificationParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "specification:read",
      identity,
      projects,
    );
    return reply.send(
      specificationSchema.parse(
        await service.get(actor.tenantId, params.projectId, params.specificationId),
      ),
    );
  });

  server.get(c13RouteContract.getSpecificationRevisions, async (request, reply) => {
    const params = parseRequest(specificationParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "specification:history:read",
      identity,
      projects,
    );
    return reply.send(
      specificationRevisionsResponseSchema.parse({
        revisions: await service.revisions(
          actor.tenantId,
          params.projectId,
          params.specificationId,
        ),
        specificationId: params.specificationId,
      }),
    );
  });

  server.get(c13RouteContract.getSpecificationSchedule, async (request, reply) => {
    const params = parseRequest(specificationParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "specification:read",
      identity,
      projects,
    );
    const specification = await service.get(
      actor.tenantId,
      params.projectId,
      params.specificationId,
    );
    return reply.send(
      specificationScheduleLinesResponseSchema.parse({
        lines: specification.currentRevision.lines,
        revision: specification.currentRevision.revision,
        specificationId: params.specificationId,
      }),
    );
  });

  server.put(c13RouteContract.updateSelectionBoard, async (request, reply) => {
    const params = parseRequest(specificationParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "specification:update",
      identity,
      projects,
    );
    const result = await service.updateSelectionBoard({
      actor,
      correlation: getRequestCorrelation(request),
      idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
      projectId: params.projectId,
      request: parseRequest(updateSelectionBoardRequestSchema.strict(), request.body),
      specificationId: params.specificationId,
    });
    if (result.replayed) reply.header("Idempotent-Replay", "true");
    return reply.send(specificationSchema.parse(result.specification));
  });

  server.post(c13RouteContract.createSubstitutionPreview, async (request, reply) => {
    const params = parseRequest(specificationParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "specification:substitution:propose",
      identity,
      projects,
    );
    const result = await service.createPreview({
      actor,
      correlation: getRequestCorrelation(request),
      idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
      projectId: params.projectId,
      request: parseRequest(createSubstitutionPreviewRequestSchema.strict(), request.body),
      specificationId: params.specificationId,
    });
    if (result.replayed) reply.header("Idempotent-Replay", "true");
    return reply.status(201).send(substitutionPreviewSchema.parse(result.preview));
  });

  server.get(c13RouteContract.getSubstitutionPreview, async (request, reply) => {
    const params = parseRequest(previewParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "specification:read",
      identity,
      projects,
    );
    return reply.send(
      substitutionPreviewSchema.parse(
        await service.getPreview(
          actor.tenantId,
          params.projectId,
          params.specificationId,
          params.previewId,
        ),
      ),
    );
  });

  server.post(c13RouteContract.confirmSubstitution, async (request, reply) => {
    const params = parseRequest(previewParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "specification:substitution:confirm",
      identity,
      projects,
    );
    if (/^(?:machine|service):/u.test(actor.subject)) throw forbidden();
    const body = parseRequest(confirmSubstitutionRequestSchema.strict(), request.body);
    if (body.previewId !== params.previewId) {
      throw new ApiError({
        code: "PREVIEW_ID_MISMATCH",
        detail: "The exact preview ID in the route and body must match.",
        statusCode: 400,
        title: "Preview ID Mismatch",
      });
    }
    const result = await service.confirm({
      actor,
      correlation: getRequestCorrelation(request),
      idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
      projectId: params.projectId,
      request: body,
      specificationId: params.specificationId,
    });
    if (result.replayed) reply.header("Idempotent-Replay", "true");
    reply.header("Scene-Request-State", result.sceneState);
    return reply.status(201).send(substitutionConfirmationSchema.parse(result.confirmation));
  });

  server.post(c13RouteContract.createSceneJob, async (request, reply) => {
    const params = parseRequest(revisionParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "specification:substitution:confirm",
      identity,
      projects,
    );
    if (/^(?:machine|service):/u.test(actor.subject)) throw forbidden();
    const body = parseRequest(sceneRetrySchema, request.body);
    const result = await service.retryScene(
      actor.tenantId,
      params.projectId,
      params.specificationId,
      params.revision,
      body.sceneJobId,
    );
    return reply.status(202).send(result);
  });
}
