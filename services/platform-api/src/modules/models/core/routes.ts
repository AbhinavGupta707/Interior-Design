import { authoriseProjectAction, type ProjectAction } from "@interior-design/authz";
import {
  c4RouteContract,
  createModelSnapshotRequestSchema,
  modelProfileSchema,
  modelSnapshotIdSchema,
  projectIdSchema,
  type Actor,
  type ModelSnapshotRecord,
} from "@interior-design/contracts";
import type { GeometryFinding } from "@interior-design/geometry-kernel";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { getRequestCorrelation } from "../../../correlation.js";
import { forbidden, invalidRequest, notFound, parseRequest } from "../../identity/http.js";
import type { IdentityService } from "../../identity/service.js";
import { parseIdempotencyKey } from "../../projects/idempotency.js";
import type { ProjectRepository } from "../../projects/repository.js";
import { CanonicalGeometryValidationError } from "./service.js";
import type { CanonicalModelService } from "./service.js";

// The transport envelope needs a small allowance beyond the frozen 10 MiB
// canonical-record ceiling. The service separately enforces that exact ceiling.
export const c4CreateSnapshotBodyLimitBytes = 10_486_784;
const typedMutationCompositions = new WeakSet<FastifyInstance>();

/** App-composition seam: integrated C5 owns the one-time initialization route. */
export function disableRawCanonicalSnapshotMutationRoute(server: FastifyInstance): void {
  typedMutationCompositions.add(server);
}

const projectParamsSchema = z.object({ projectId: projectIdSchema }).strict();
const profileParamsSchema = z
  .object({ profile: modelProfileSchema, projectId: projectIdSchema })
  .strict();
const snapshotParamsSchema = z
  .object({
    profile: modelProfileSchema,
    projectId: projectIdSchema,
    snapshotId: modelSnapshotIdSchema,
  })
  .strict();

interface GeometryValidationProblem {
  readonly code: "CANONICAL_GEOMETRY_INVALID";
  readonly detail: string;
  readonly findings: readonly GeometryFinding[];
  readonly instance: string;
  readonly requestId: string;
  readonly status: 422;
  readonly title: "Canonical Geometry Invalid";
  readonly traceId: string;
  readonly type: "urn:interior-design:error:canonical-geometry-invalid";
}

function requestPath(request: FastifyRequest): string {
  return request.url.split("?", 1)[0] ?? "/";
}

function sendGeometryValidationProblem(
  request: FastifyRequest,
  reply: FastifyReply,
  error: CanonicalGeometryValidationError,
): FastifyReply {
  const correlation = getRequestCorrelation(request);
  const problem: GeometryValidationProblem = {
    code: "CANONICAL_GEOMETRY_INVALID",
    detail: "The canonical geometry contains blocking findings and was not persisted.",
    findings: error.findings,
    instance: requestPath(request),
    requestId: correlation.requestId,
    status: 422,
    title: "Canonical Geometry Invalid",
    traceId: correlation.traceId,
    type: "urn:interior-design:error:canonical-geometry-invalid",
  };
  request.log.warn(
    {
      errorCode: problem.code,
      findingCodes: problem.findings.map(({ code }) => code),
      requestId: correlation.requestId,
      statusCode: problem.status,
      traceId: correlation.traceId,
    },
    "request rejected",
  );
  return reply.status(422).type("application/problem+json").send(problem);
}

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
  if ((await projects.findById(session.actor.tenantId, projectId)) === undefined) {
    throw notFound();
  }
  return session.actor;
}

export function registerCanonicalModelRoutes(
  server: FastifyInstance,
  identity: IdentityService,
  projects: ProjectRepository,
  models: CanonicalModelService,
  options: { readonly registerCreateRoute?: boolean } = {},
): void {
  server.get<{ Params: { readonly projectId: string } }>(
    c4RouteContract.listProfiles,
    async (request, reply) => {
      const params = parseRequest(projectParamsSchema, request.params);
      const actor = await authorisedProject(
        request,
        params.projectId,
        "model:read",
        identity,
        projects,
      );
      return reply.send(await models.listProfiles(actor.tenantId, params.projectId));
    },
  );

  server.get<{ Params: { readonly profile: string; readonly projectId: string } }>(
    c4RouteContract.getCurrentProfile,
    async (request, reply) => {
      const params = parseRequest(profileParamsSchema, request.params);
      const actor = await authorisedProject(
        request,
        params.projectId,
        "model:read",
        identity,
        projects,
      );
      const record = await models.getCurrentSnapshot(
        actor.tenantId,
        params.projectId,
        params.profile,
      );
      if (record === undefined) {
        throw notFound();
      }
      return reply.send(record);
    },
  );

  server.get<{
    Params: { readonly profile: string; readonly projectId: string; readonly snapshotId: string };
  }>(c4RouteContract.getSnapshot, async (request, reply) => {
    const params = parseRequest(snapshotParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "model:read",
      identity,
      projects,
    );
    const record = await models.getSnapshot(
      actor.tenantId,
      params.projectId,
      params.profile,
      params.snapshotId,
    );
    if (record === undefined) {
      throw notFound();
    }
    return reply.send(record);
  });

  if (options.registerCreateRoute === false || typedMutationCompositions.has(server)) return;

  server.post<{
    Params: { readonly profile: string; readonly projectId: string };
  }>(
    c4RouteContract.createSnapshot,
    { bodyLimit: c4CreateSnapshotBodyLimitBytes },
    async (request, reply) => {
      const params = parseRequest(profileParamsSchema, request.params);
      const actor = await authorisedProject(
        request,
        params.projectId,
        "model:snapshot:create",
        identity,
        projects,
      );
      const body = parseRequest(createModelSnapshotRequestSchema, request.body);
      if (
        body.snapshot.projectId !== params.projectId ||
        body.snapshot.profile !== params.profile
      ) {
        throw invalidRequest();
      }
      const idempotencyKey = parseIdempotencyKey(request.headers["idempotency-key"]);
      let result: { readonly record: ModelSnapshotRecord; readonly replayed: boolean };
      try {
        result = await models.createSnapshot({
          actor,
          correlation: getRequestCorrelation(request),
          expectedCurrentSnapshotSha256: body.expectedCurrentSnapshotSha256,
          idempotencyKey,
          profile: params.profile,
          projectId: params.projectId,
          snapshot: body.snapshot,
        });
      } catch (error: unknown) {
        if (error instanceof CanonicalGeometryValidationError) {
          return sendGeometryValidationProblem(request, reply, error);
        }
        throw error;
      }
      if (result.replayed) {
        reply.header("Idempotent-Replay", "true");
      }
      return reply.status(201).send(result.record);
    },
  );
}
