import { authoriseProjectAction, type ProjectAction } from "@interior-design/authz";
import {
  c14RouteContract,
  createRenderJobRequestSchema,
  projectIdSchema,
  renderArtifactAccessSchema,
  renderArtifactIdSchema,
  renderJobIdSchema,
  renderJobSchema,
  renderResultSchema,
  type Actor,
} from "@interior-design/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { getRequestCorrelation } from "../../correlation.js";
import { forbidden, notFound, parseRequest } from "../identity/http.js";
import type { IdentityService } from "../identity/service.js";
import { parseIdempotencyKey } from "../projects/idempotency.js";
import type { ProjectRepository } from "../projects/repository.js";
import type { RenderStillService } from "./service.js";

const projectParamsSchema = z.object({ projectId: projectIdSchema }).strict();
const jobParamsSchema = z.object({ jobId: renderJobIdSchema, projectId: projectIdSchema }).strict();
const artifactParamsSchema = z
  .object({
    artifactId: renderArtifactIdSchema,
    jobId: renderJobIdSchema,
    projectId: projectIdSchema,
  })
  .strict();
const transitionSchema = z.object({ expectedVersion: z.int().positive() }).strict();
const emptySchema = z.object({}).strict();
const listResponseSchema = z.object({ jobs: z.array(renderJobSchema).max(100) }).strict();
const capabilitiesSchema = z
  .object({
    acceptingNewJobs: z.boolean(),
    enhancementProvider: z.enum(["disabled", "enabled"]),
    hardwareEvidence: z.enum(["deferred", "verified-authorised-host"]),
    profiles: z
      .array(
        z
          .object({
            available: z.boolean(),
            capability: z.string().regex(/^[A-Za-z0-9_.:+-]{3,120}$/u),
            profileId: createRenderJobRequestSchema.shape.profileId,
            reason: z.string().trim().min(1).max(240).optional(),
          })
          .strict(),
      )
      .max(5),
  })
  .strict();
const enhancementResponseSchema = z
  .object({
    attempt: z.int().positive().max(3),
    baseArtifactSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    createdAt: z.iso.datetime({ offset: true }),
    createdBy: z.uuid(),
    id: z.uuid(),
    projectId: projectIdSchema,
    renderJobId: renderJobIdSchema,
    result: z.unknown().optional(),
    safeCode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{2,79}$/u)
      .optional(),
    state: z.enum([
      "queued",
      "running",
      "succeeded",
      "disabled",
      "rejected",
      "failed",
      "cancelled",
    ]),
    updatedAt: z.iso.datetime({ offset: true }),
    version: z.int().positive(),
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

export function registerRenderStillRoutes(
  server: FastifyInstance,
  identity: IdentityService,
  projects: ProjectRepository,
  service: RenderStillService,
): void {
  server.get(c14RouteContract.getCapabilities, async (request, reply) => {
    const params = parseRequest(projectParamsSchema, request.params);
    await authorisedProject(request, params.projectId, "render:job:read", identity, projects);
    reply.header("cache-control", "private, no-store");
    return reply.send(capabilitiesSchema.parse(service.capabilities()));
  });

  server.post(c14RouteContract.createJob, async (request, reply) => {
    const params = parseRequest(projectParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "render:job:create",
      identity,
      projects,
    );
    const result = await service.createJob({
      actor,
      correlation: getRequestCorrelation(request),
      idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
      projectId: params.projectId,
      request: parseRequest(createRenderJobRequestSchema, request.body),
    });
    if (result.replayed) reply.header("Idempotent-Replay", "true");
    reply.header("cache-control", "private, no-store");
    return reply.status(201).send(renderJobSchema.parse(result.job));
  });

  server.get(c14RouteContract.listJobs, async (request, reply) => {
    const params = parseRequest(projectParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "render:job:read",
      identity,
      projects,
    );
    reply.header("cache-control", "private, no-store");
    return reply.send(
      listResponseSchema.parse({ jobs: await service.listJobs(actor.tenantId, params.projectId) }),
    );
  });

  server.get(c14RouteContract.getJob, async (request, reply) => {
    const params = parseRequest(jobParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "render:job:read",
      identity,
      projects,
    );
    reply.header("cache-control", "private, no-store");
    return reply.send(
      renderJobSchema.parse(await service.getJob(actor.tenantId, params.projectId, params.jobId)),
    );
  });

  for (const transition of ["cancel", "retry"] as const) {
    server.post(
      transition === "cancel" ? c14RouteContract.cancelJob : c14RouteContract.retryJob,
      async (request, reply) => {
        const params = parseRequest(jobParamsSchema, request.params);
        const actor = await authorisedProject(
          request,
          params.projectId,
          transition === "cancel" ? "render:job:cancel" : "render:job:retry",
          identity,
          projects,
        );
        const body = parseRequest(transitionSchema, request.body);
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
        reply.header("cache-control", "private, no-store");
        return reply.send(renderJobSchema.parse(result.job));
      },
    );
  }

  server.get(c14RouteContract.getResult, async (request, reply) => {
    const params = parseRequest(jobParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "render:job:read",
      identity,
      projects,
    );
    reply.header("cache-control", "private, no-store");
    return reply.send(
      renderResultSchema.parse(
        await service.getResult(actor.tenantId, params.projectId, params.jobId),
      ),
    );
  });

  server.post(c14RouteContract.getArtifactAccess, async (request, reply) => {
    const params = parseRequest(artifactParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "render:artifact:read",
      identity,
      projects,
    );
    parseRequest(emptySchema, request.body ?? {});
    const response = await service.createArtifactAccess({
      actor,
      artifactId: params.artifactId,
      correlation: getRequestCorrelation(request),
      jobId: params.jobId,
      projectId: params.projectId,
    });
    reply.header("cache-control", "private, no-store");
    return reply.send(renderArtifactAccessSchema.parse(response));
  });

  server.get(c14RouteContract.getEnhancement, async (request, reply) => {
    const params = parseRequest(jobParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "render:job:read",
      identity,
      projects,
    );
    const enhancement = await service.getEnhancement(
      actor.tenantId,
      params.projectId,
      params.jobId,
    );
    if (enhancement === undefined) throw notFound();
    reply.header("cache-control", "private, no-store");
    return reply.send(enhancementResponseSchema.parse(enhancement));
  });

  server.post(c14RouteContract.requestEnhancement, async (request, reply) => {
    const params = parseRequest(jobParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "render:job:create",
      identity,
      projects,
    );
    const body = parseRequest(transitionSchema, request.body);
    const result = await service.requestEnhancement({
      actor,
      correlation: getRequestCorrelation(request),
      expectedVersion: body.expectedVersion,
      idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
      jobId: params.jobId,
      projectId: params.projectId,
    });
    if (result.replayed) reply.header("Idempotent-Replay", "true");
    reply.header("cache-control", "private, no-store");
    return reply.send(enhancementResponseSchema.parse(result.enhancement));
  });
}
