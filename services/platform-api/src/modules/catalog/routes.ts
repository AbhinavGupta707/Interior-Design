import { authoriseProjectAction } from "@interior-design/authz";
import {
  c13RouteContract,
  catalogArtifactSchema,
  catalogAssetVersionSchema,
  catalogReleaseSchema,
  projectIdSchema,
  type Actor,
} from "@interior-design/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { getRequestCorrelation } from "../../correlation.js";
import { forbidden, notFound, parseRequest } from "../identity/http.js";
import type { IdentityService } from "../identity/service.js";
import type { ProjectRepository } from "../projects/repository.js";
import type { CatalogService } from "./service.js";

const uuidSchema = z.uuid();
const projectParamsSchema = z.object({ projectId: projectIdSchema }).strict();
const releaseParamsSchema = z
  .object({ projectId: projectIdSchema, releaseId: uuidSchema })
  .strict();
const assetParamsSchema = z
  .object({ assetVersionId: uuidSchema, projectId: projectIdSchema, releaseId: uuidSchema })
  .strict();
const artifactParamsSchema = z
  .object({ artifactId: uuidSchema, projectId: projectIdSchema })
  .strict();
const releasesResponseSchema = z
  .object({ releases: z.array(catalogReleaseSchema).max(512) })
  .strict();
const boundedSearchSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/u)
  .refine((value) => value === value.trim());
const assetsQuerySchema = z
  .object({
    cursor: z
      .string()
      .min(1)
      .max(500)
      .regex(/^[A-Za-z0-9_-]+$/u)
      .optional(),
    kind: z
      .enum(["all", "finish", "furnishing", "light"])
      .transform((value) => (value === "all" ? undefined : value))
      .optional(),
    limit: z
      .string()
      .regex(/^(?:[1-9]|1\d|2[0-4])$/u)
      .default("24")
      .transform((value) => Number(value)),
    query: z
      .union([z.literal(""), boundedSearchSchema])
      .transform((value) => (value.length === 0 ? undefined : value))
      .optional(),
    rights: z
      .enum(["all", "approved", "expired", "withdrawn"])
      .transform((value) => (value === "all" ? undefined : value))
      .optional(),
    source: z
      .enum(["all", "creator-owned-synthetic", "licensed-local"])
      .transform((value) => (value === "all" ? undefined : value))
      .optional(),
  })
  .strict();
const assetsResponseSchema = z
  .object({
    assets: z.array(catalogAssetVersionSchema).max(24),
    nextCursor: z.string().min(1).max(500).optional(),
    releaseId: uuidSchema,
    total: z.int().min(0).max(512),
  })
  .strict();
const artifactAccessResponseSchema = z
  .object({
    artifactId: uuidSchema,
    byteLength: z.int().positive(),
    expiresAt: z.iso.datetime({ offset: true }),
    mediaType: catalogArtifactSchema.shape.mediaType,
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    url: z.url().max(2_048),
  })
  .strict();

async function authorisedProject(
  request: FastifyRequest,
  projectId: string,
  identity: IdentityService,
  projects: ProjectRepository,
): Promise<Actor> {
  const session = await identity.authenticate(request.headers.authorization);
  if (
    !authoriseProjectAction(session.actor, "catalog:asset:read", {
      tenantId: session.actor.tenantId,
    }).allowed
  ) {
    throw forbidden();
  }
  if ((await projects.findById(session.actor.tenantId, projectId)) === undefined) throw notFound();
  return session.actor;
}

export function registerCatalogRoutes(
  server: FastifyInstance,
  identity: IdentityService,
  projects: ProjectRepository,
  service: CatalogService,
): void {
  server.get(c13RouteContract.listCatalogReleases, async (request, reply) => {
    const params = parseRequest(projectParamsSchema, request.params);
    const actor = await authorisedProject(request, params.projectId, identity, projects);
    return reply.send(
      releasesResponseSchema.parse({
        releases: await service.listReleases(actor.tenantId, params.projectId),
      }),
    );
  });

  server.get(c13RouteContract.getCatalogRelease, async (request, reply) => {
    const params = parseRequest(releaseParamsSchema, request.params);
    const actor = await authorisedProject(request, params.projectId, identity, projects);
    return reply.send(
      catalogReleaseSchema.parse(
        await service.getRelease(actor.tenantId, params.projectId, params.releaseId),
      ),
    );
  });

  server.get(c13RouteContract.listCatalogAssets, async (request, reply) => {
    const params = parseRequest(releaseParamsSchema, request.params);
    const actor = await authorisedProject(request, params.projectId, identity, projects);
    const query = parseRequest(assetsQuerySchema, request.query);
    return reply.send(
      assetsResponseSchema.parse(
        await service.listAssets(actor.tenantId, params.projectId, params.releaseId, query),
      ),
    );
  });

  server.get(c13RouteContract.getCatalogAsset, async (request, reply) => {
    const params = parseRequest(assetParamsSchema, request.params);
    const actor = await authorisedProject(request, params.projectId, identity, projects);
    return reply.send(
      catalogAssetVersionSchema.parse(
        await service.getAsset(
          actor.tenantId,
          params.projectId,
          params.releaseId,
          params.assetVersionId,
        ),
      ),
    );
  });

  server.get(c13RouteContract.getCatalogArtifact, async (request, reply) => {
    const params = parseRequest(artifactParamsSchema, request.params);
    const actor = await authorisedProject(request, params.projectId, identity, projects);
    const response = await service.createArtifactAccess({
      actor,
      artifactId: params.artifactId,
      correlation: getRequestCorrelation(request),
      projectId: params.projectId,
    });
    reply.header("cache-control", "private, no-store");
    return reply.send(artifactAccessResponseSchema.parse(response));
  });
}
