import {
  assetAccessRequestSchema,
  assetIdSchema,
  c2RouteContract,
  completeAssetUploadRequestSchema,
  initiateAssetUploadRequestSchema,
  projectIdSchema,
  signAssetUploadPartRequestSchema,
  type Asset,
  type AssetUploadSession,
  type SignedAssetUploadPart,
} from "@interior-design/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { getRequestCorrelation } from "../../correlation.js";
import { forbidden, notFound, parseRequest } from "../identity/http.js";
import type { IdentityService } from "../identity/service.js";
import { parseIdempotencyKey } from "../projects/idempotency.js";
import type { ProjectRepository } from "../projects/repository.js";
import { authoriseAssetAction, type AssetAction } from "./policy.js";
import type { AssetAccessResponse, AssetBackend, ResumableAssetUploadSession } from "./types.js";

const projectParamsSchema = z.object({ projectId: projectIdSchema }).strict();
const sessionParamsSchema = z.object({ projectId: projectIdSchema, sessionId: z.uuid() }).strict();
const assetParamsSchema = z.object({ assetId: assetIdSchema, projectId: projectIdSchema }).strict();

async function authorisedProject(
  request: FastifyRequest,
  projectId: string,
  action: AssetAction,
  identity: IdentityService,
  projects: ProjectRepository,
) {
  const session = await identity.authenticate(request.headers.authorization);
  if (!authoriseAssetAction(session.actor, action, session.actor.tenantId)) {
    throw forbidden();
  }
  const project = await projects.findById(session.actor.tenantId, projectId);
  if (project === undefined) {
    throw notFound();
  }
  return session.actor;
}

export function registerAssetRoutes(
  server: FastifyInstance,
  identity: IdentityService,
  projects: ProjectRepository,
  assets: AssetBackend,
): void {
  server.post<{ Params: { readonly projectId: string }; Reply: AssetUploadSession }>(
    c2RouteContract.createUploadSession,
    async (request, reply) => {
      const params = parseRequest(projectParamsSchema, request.params);
      const actor = await authorisedProject(
        request,
        params.projectId,
        "asset:create-upload",
        identity,
        projects,
      );
      const body = parseRequest(initiateAssetUploadRequestSchema, request.body);
      const idempotencyKey = parseIdempotencyKey(request.headers["idempotency-key"]);
      const upload = await assets.createUploadSession({
        actor,
        correlation: getRequestCorrelation(request),
        idempotencyKey,
        projectId: params.projectId,
        request: body,
      });
      return reply.status(201).send(upload);
    },
  );

  server.get<{
    Params: { readonly projectId: string; readonly sessionId: string };
    Reply: ResumableAssetUploadSession;
  }>(c2RouteContract.getUploadSession, async (request, reply) => {
    const params = parseRequest(sessionParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "asset:read",
      identity,
      projects,
    );
    const upload = await assets.findUploadSession(
      actor.tenantId,
      params.projectId,
      params.sessionId,
    );
    if (upload === undefined) {
      throw notFound();
    }
    return reply.send(upload);
  });

  server.post<{
    Params: { readonly projectId: string; readonly sessionId: string };
    Reply: SignedAssetUploadPart;
  }>(c2RouteContract.signUploadPart, async (request, reply) => {
    const params = parseRequest(sessionParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "asset:sign-part",
      identity,
      projects,
    );
    const body = parseRequest(signAssetUploadPartRequestSchema, request.body);
    const idempotencyKey = parseIdempotencyKey(request.headers["idempotency-key"]);
    return reply.send(
      await assets.signUploadPart({
        actor,
        correlation: getRequestCorrelation(request),
        idempotencyKey,
        projectId: params.projectId,
        request: body,
        sessionId: params.sessionId,
      }),
    );
  });

  server.post<{
    Params: { readonly projectId: string; readonly sessionId: string };
    Reply: Asset;
  }>(c2RouteContract.completeUpload, async (request, reply) => {
    const params = parseRequest(sessionParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "asset:complete-upload",
      identity,
      projects,
    );
    const body = parseRequest(completeAssetUploadRequestSchema, request.body);
    const idempotencyKey = parseIdempotencyKey(request.headers["idempotency-key"]);
    return reply.send(
      await assets.completeUpload({
        actor,
        correlation: getRequestCorrelation(request),
        idempotencyKey,
        projectId: params.projectId,
        request: body,
        sessionId: params.sessionId,
      }),
    );
  });

  server.delete<{ Params: { readonly projectId: string; readonly sessionId: string } }>(
    c2RouteContract.abortUpload,
    async (request, reply) => {
      const params = parseRequest(sessionParamsSchema, request.params);
      const actor = await authorisedProject(
        request,
        params.projectId,
        "asset:abort-upload",
        identity,
        projects,
      );
      const idempotencyKey = parseIdempotencyKey(request.headers["idempotency-key"]);
      await assets.abortUpload({
        actor,
        correlation: getRequestCorrelation(request),
        idempotencyKey,
        projectId: params.projectId,
        sessionId: params.sessionId,
      });
      return reply.status(204).send();
    },
  );

  server.get<{ Params: { readonly projectId: string }; Reply: readonly Asset[] }>(
    c2RouteContract.listAssets,
    async (request, reply) => {
      const params = parseRequest(projectParamsSchema, request.params);
      const actor = await authorisedProject(
        request,
        params.projectId,
        "asset:list",
        identity,
        projects,
      );
      return reply.send(await assets.listAssets(actor.tenantId, params.projectId));
    },
  );

  server.get<{
    Params: { readonly assetId: string; readonly projectId: string };
    Reply: Asset;
  }>(c2RouteContract.getAsset, async (request, reply) => {
    const params = parseRequest(assetParamsSchema, request.params);
    const actor = await authorisedProject(
      request,
      params.projectId,
      "asset:read",
      identity,
      projects,
    );
    const asset = await assets.findAsset(actor.tenantId, params.projectId, params.assetId);
    if (asset === undefined) {
      throw notFound();
    }
    return reply.send(asset);
  });

  server.post<{
    Params: { readonly assetId: string; readonly projectId: string };
    Reply: AssetAccessResponse;
  }>(c2RouteContract.issueAssetAccess, async (request, reply) => {
    const params = parseRequest(assetParamsSchema, request.params);
    const body = parseRequest(assetAccessRequestSchema, request.body);
    const action =
      body.representation === "original"
        ? "asset:issue-original-access"
        : "asset:issue-derived-access";
    const actor = await authorisedProject(request, params.projectId, action, identity, projects);
    const idempotencyKey = parseIdempotencyKey(request.headers["idempotency-key"]);
    return reply.send(
      await assets.issueAccess({
        actor,
        assetId: params.assetId,
        correlation: getRequestCorrelation(request),
        idempotencyKey,
        projectId: params.projectId,
        request: body,
      }),
    );
  });
}
