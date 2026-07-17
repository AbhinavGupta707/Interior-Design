import { authoriseProjectAction, type ProjectAction } from "@interior-design/authz";
import {
  c4RouteContract,
  c5RouteContract,
  commitModelOperationsRequestSchema,
  commitModelOperationsResponseSchema,
  createModelBranchRequestSchema,
  createModelSnapshotRequestSchema,
  listModelBranchesResponseSchema,
  modelBranchComparisonSchema,
  modelBranchIdSchema,
  modelBranchSchema,
  modelOperationHistoryResponseSchema,
  modelProfileSchema,
  modelSnapshotRecordSchema,
  previewModelOperationsRequestSchema,
  projectIdSchema,
  restoreModelBranchRequestSchema,
  type Actor,
} from "@interior-design/contracts";
import type { GeometryFinding } from "@interior-design/geometry-kernel";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { getRequestCorrelation } from "../../../correlation.js";
import { ApiError } from "../../../errors.js";
import { forbidden, notFound, parseRequest } from "../../identity/http.js";
import type { IdentityService } from "../../identity/service.js";
import { parseIdempotencyKey } from "../../projects/idempotency.js";
import type { ProjectRepository } from "../../projects/repository.js";
import { BranchRevisionConflictError, ModelOperationValidationError } from "./errors.js";
import type { ModelOperationService } from "./service.js";

export const c5OperationBodyLimitBytes = 10_486_784;

const projectProfileParamsSchema = z
  .object({ profile: modelProfileSchema, projectId: projectIdSchema })
  .strict();
const branchParamsSchema = z
  .object({
    branchId: modelBranchIdSchema,
    profile: modelProfileSchema,
    projectId: projectIdSchema,
  })
  .strict();
const compareParamsSchema = branchParamsSchema
  .extend({ targetBranchId: modelBranchIdSchema })
  .strict();
const historyQuerySchema = z
  .object({
    cursor: z.string().min(1).max(500).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

interface BranchConflictProblem {
  readonly branchId: string;
  readonly code: "BRANCH_REVISION_CONFLICT";
  readonly currentHeadSnapshotSha256: string;
  readonly currentRevision: number;
  readonly detail: string;
  readonly instance: string;
  readonly recoveryActions: readonly ["reload", "compare", "discard-local", "rebuild-preview"];
  readonly requestId: string;
  readonly status: 409;
  readonly title: "Branch Revision Conflict";
  readonly traceId: string;
  readonly type: "urn:interior-design:error:branch-revision-conflict";
}

interface ValidationProblem {
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

function sendBranchConflict(
  request: FastifyRequest,
  reply: FastifyReply,
  error: BranchRevisionConflictError,
): FastifyReply {
  const correlation = getRequestCorrelation(request);
  const problem: BranchConflictProblem = {
    branchId: error.branchId,
    code: "BRANCH_REVISION_CONFLICT",
    currentHeadSnapshotSha256: error.currentHeadSnapshotSha256,
    currentRevision: error.currentRevision,
    detail: "The branch changed. Reload or compare before rebuilding the same typed intent.",
    instance: requestPath(request),
    recoveryActions: ["reload", "compare", "discard-local", "rebuild-preview"],
    requestId: correlation.requestId,
    status: 409,
    title: "Branch Revision Conflict",
    traceId: correlation.traceId,
    type: "urn:interior-design:error:branch-revision-conflict",
  };
  request.log.warn(
    {
      errorCode: problem.code,
      requestId: correlation.requestId,
      statusCode: problem.status,
      traceId: correlation.traceId,
    },
    "request rejected",
  );
  return reply.status(409).type("application/problem+json").send(problem);
}

function sendValidationProblem(
  request: FastifyRequest,
  reply: FastifyReply,
  error: ModelOperationValidationError,
): FastifyReply {
  const correlation = getRequestCorrelation(request);
  const problem: ValidationProblem = {
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

async function withConflictProblem<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  operation: () => Promise<T>,
): Promise<T | FastifyReply> {
  try {
    return await operation();
  } catch (error: unknown) {
    if (error instanceof BranchRevisionConflictError) {
      return sendBranchConflict(request, reply, error);
    }
    if (error instanceof ModelOperationValidationError) {
      return sendValidationProblem(request, reply, error);
    }
    throw error;
  }
}

export function registerModelOperationRoutes(
  server: FastifyInstance,
  identity: IdentityService,
  projects: ProjectRepository,
  service: ModelOperationService,
): void {
  // Integrated C5 preserves the C4 import route only as a typed, one-time
  // initialization bridge. C4-only composition continues to own its legacy
  // route for checkpoint-isolated tests.
  server.post<{ Params: { readonly profile: string; readonly projectId: string } }>(
    c4RouteContract.createSnapshot,
    { bodyLimit: c5OperationBodyLimitBytes },
    async (request, reply) => {
      const params = parseRequest(projectProfileParamsSchema, request.params);
      const actor = await authorisedProject(
        request,
        params.projectId,
        "model:snapshot:create",
        identity,
        projects,
      );
      const body = parseRequest(createModelSnapshotRequestSchema, request.body);
      if (body.expectedCurrentSnapshotSha256 !== null) {
        throw new ApiError({
          code: "TYPED_OPERATION_REQUIRED",
          detail:
            "Only first initialization is accepted here; amendments require typed branch operations.",
          statusCode: 409,
          title: "Typed Operation Required",
        });
      }
      const result = await withConflictProblem(request, reply, () =>
        service.initialize({
          actor,
          correlation: getRequestCorrelation(request),
          expectedCurrentSnapshotSha256: null,
          idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
          profile: params.profile,
          projectId: params.projectId,
          snapshot: body.snapshot,
        }),
      );
      if ("statusCode" in result) return result;
      if (result.replayed) reply.header("Idempotent-Replay", "true");
      return reply.status(201).send(modelSnapshotRecordSchema.parse(result.record));
    },
  );

  server.get<{ Params: { readonly profile: string; readonly projectId: string } }>(
    c5RouteContract.listBranches,
    async (request, reply) => {
      const params = parseRequest(projectProfileParamsSchema, request.params);
      const actor = await authorisedProject(
        request,
        params.projectId,
        "model:branch:read",
        identity,
        projects,
      );
      return reply.send(
        listModelBranchesResponseSchema.parse({
          branches: await service.listBranches(actor.tenantId, params.projectId, params.profile),
          profile: params.profile,
          projectId: params.projectId,
        }),
      );
    },
  );

  server.post<{ Params: { readonly profile: string; readonly projectId: string } }>(
    c5RouteContract.createBranch,
    async (request, reply) => {
      const params = parseRequest(projectProfileParamsSchema, request.params);
      const actor = await authorisedProject(
        request,
        params.projectId,
        "model:branch:create",
        identity,
        projects,
      );
      const body = parseRequest(createModelBranchRequestSchema, request.body);
      const result = await service.createBranch({
        actor,
        correlation: getRequestCorrelation(request),
        idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
        name: body.name,
        profile: params.profile,
        projectId: params.projectId,
        sourceSnapshotId: body.sourceSnapshotId,
        sourceSnapshotSha256: body.sourceSnapshotSha256,
      });
      if (result.replayed) reply.header("Idempotent-Replay", "true");
      return reply.status(201).send(modelBranchSchema.parse(result.branch));
    },
  );

  server.get<{
    Params: { readonly branchId: string; readonly profile: string; readonly projectId: string };
  }>(c5RouteContract.getBranch, async (request, reply) => {
    const params = parseRequest(branchParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "model:branch:read",
      identity,
      projects,
    );
    const branch = await service.getBranch(
      actor.tenantId,
      params.projectId,
      params.profile,
      params.branchId,
    );
    if (branch === undefined) throw notFound();
    return reply.send(modelBranchSchema.parse(branch));
  });

  server.post<{
    Params: { readonly branchId: string; readonly profile: string; readonly projectId: string };
  }>(
    c5RouteContract.previewOperations,
    { bodyLimit: c5OperationBodyLimitBytes },
    async (request, reply) => {
      const params = parseRequest(branchParamsSchema, request.params);
      const actor = await authorisedProject(
        request,
        params.projectId,
        "model:operation:preview",
        identity,
        projects,
      );
      const body = parseRequest(previewModelOperationsRequestSchema, request.body);
      const result = await withConflictProblem(request, reply, () =>
        service.preview({
          actor,
          branchId: params.branchId,
          correlation: getRequestCorrelation(request),
          expectedHeadSnapshotSha256: body.expectedHeadSnapshotSha256,
          expectedRevision: body.expectedRevision,
          idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
          operations: body.operations,
          profile: params.profile,
          projectId: params.projectId,
        }),
      );
      if ("statusCode" in result) return result;
      if (result.replayed) reply.header("Idempotent-Replay", "true");
      return reply.status(201).send(result.preview);
    },
  );

  server.post<{
    Params: { readonly branchId: string; readonly profile: string; readonly projectId: string };
  }>(c5RouteContract.commitOperations, async (request, reply) => {
    const params = parseRequest(branchParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "model:operation:commit",
      identity,
      projects,
    );
    const body = parseRequest(commitModelOperationsRequestSchema, request.body);
    const result = await withConflictProblem(request, reply, () =>
      service.commit({
        actor,
        branchId: params.branchId,
        commitMessage: body.commitMessage,
        correlation: getRequestCorrelation(request),
        expectedHeadSnapshotSha256: body.expectedHeadSnapshotSha256,
        expectedRevision: body.expectedRevision,
        idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
        previewId: body.previewId,
        profile: params.profile,
        projectId: params.projectId,
      }),
    );
    if ("statusCode" in result) return result;
    if (result.replayed) reply.header("Idempotent-Replay", "true");
    return reply.status(201).send(commitModelOperationsResponseSchema.parse(result.response));
  });

  server.get<{
    Params: { readonly branchId: string; readonly profile: string; readonly projectId: string };
    Querystring: { readonly cursor?: string; readonly limit?: string };
  }>(c5RouteContract.listOperations, async (request, reply) => {
    const params = parseRequest(branchParamsSchema, request.params);
    const query = parseRequest(historyQuerySchema, request.query);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "model:operation:history",
      identity,
      projects,
    );
    return reply.send(
      modelOperationHistoryResponseSchema.parse(
        await service.listOperations(
          actor.tenantId,
          params.projectId,
          params.profile,
          params.branchId,
          query.cursor,
          query.limit,
        ),
      ),
    );
  });

  server.post<{
    Params: { readonly branchId: string; readonly profile: string; readonly projectId: string };
  }>(c5RouteContract.restoreBranch, async (request, reply) => {
    const params = parseRequest(branchParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "model:branch:restore",
      identity,
      projects,
    );
    const body = parseRequest(restoreModelBranchRequestSchema, request.body);
    const result = await withConflictProblem(request, reply, () =>
      service.restore({
        actor,
        branchId: params.branchId,
        correlation: getRequestCorrelation(request),
        expectedHeadSnapshotSha256: body.expectedHeadSnapshotSha256,
        expectedRevision: body.expectedRevision,
        idempotencyKey: parseIdempotencyKey(request.headers["idempotency-key"]),
        profile: params.profile,
        projectId: params.projectId,
        reason: body.reason,
        sourceSnapshotId: body.sourceSnapshotId,
        sourceSnapshotSha256: body.sourceSnapshotSha256,
      }),
    );
    if ("statusCode" in result) return result;
    if (result.replayed) reply.header("Idempotent-Replay", "true");
    return reply.status(201).send(commitModelOperationsResponseSchema.parse(result.response));
  });

  server.get<{
    Params: {
      readonly branchId: string;
      readonly profile: string;
      readonly projectId: string;
      readonly targetBranchId: string;
    };
  }>(c5RouteContract.compareBranch, async (request, reply) => {
    const params = parseRequest(compareParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "model:branch:compare",
      identity,
      projects,
    );
    const comparison = await service.compareBranches(
      actor.tenantId,
      params.projectId,
      params.profile,
      params.branchId,
      params.targetBranchId,
    );
    if (comparison === undefined) throw notFound();
    return reply.send(modelBranchComparisonSchema.parse(comparison));
  });
}
