import {
  catalogAssetVersionSchema,
  catalogReleaseSchema,
  confirmSubstitutionRequestSchema,
  createSpecificationRequestSchema,
  createSubstitutionPreviewRequestSchema,
  specificationSchema,
  substitutionConfirmationSchema,
  substitutionPreviewSchema,
  updateSelectionBoardRequestSchema,
} from "@interior-design/contracts";
import type { CatalogAssetVersion, Specification } from "@interior-design/contracts";
import { NextResponse } from "next/server";

import { problemResponse } from "../../c1/_shared/backend";
import {
  catalogArtifactResponseSchema,
  catalogAssetPageSchema,
  catalogFiltersSchema,
  catalogReleaseListSchema,
  specificationListSchema,
  specificationRevisionListSchema,
  specificationScheduleLinesSchema,
} from "../../../../features/materials-products/contracts";
import {
  c13RouteBase,
  parseC13Body,
  parseC13Id,
  requireC13IdempotencyKey,
  validatedC13Backend,
} from "../_shared/materials-products-proxy";
import type { C13RouteBase, C13RouteContext } from "../_shared/materials-products-proxy";

function routeUnavailable(): NextResponse {
  return problemResponse(404, "C13 route unavailable", "This C13 route is not available.");
}

function rootPath(base: C13RouteBase): string {
  return `/v1/projects/${base.projectId}`;
}

function specificationMatches(
  specification: Specification,
  projectId: string,
  id?: string,
): boolean {
  return specification.projectId === projectId && (!id || specification.specificationId === id);
}

function assetPagePath(
  request: Request,
  base: C13RouteBase,
  releaseId: string,
): string | NextResponse {
  const search = new URL(request.url).searchParams;
  const parsed = catalogFiltersSchema.safeParse({
    ...(search.has("cursor") ? { cursor: search.get("cursor") } : {}),
    kind: search.get("kind") ?? "all",
    pageSize: Number(search.get("limit") ?? "9"),
    query: search.get("query") ?? "",
    rights: search.get("rights") ?? "all",
    source: search.get("source") ?? "all",
  });
  if (!parsed.success) {
    return problemResponse(
      400,
      "Invalid catalog filters",
      "Catalog filters exceed the bounded C13 query contract.",
    );
  }
  const query = new URLSearchParams({
    kind: parsed.data.kind,
    limit: String(parsed.data.pageSize),
    query: parsed.data.query,
    rights: parsed.data.rights,
    source: parsed.data.source,
  });
  if (parsed.data.cursor) query.set("cursor", parsed.data.cursor);
  return `${rootPath(base)}/catalog/releases/${releaseId}/assets?${query.toString()}`;
}

export async function GET(request: Request, context: C13RouteContext): Promise<NextResponse> {
  const base = await c13RouteBase(request, context);
  if (base instanceof NextResponse) return base;
  const [resource, first, second, third] = base.remainder;
  if (base.remainder.length > 5) return routeUnavailable();

  if (resource === "catalog" && first === "releases" && !second) {
    return validatedC13Backend({
      accessToken: base.accessToken,
      matches: (result) =>
        new Set(result.releases.map(({ releaseId }) => releaseId)).size === result.releases.length,
      path: `${rootPath(base)}/catalog/releases`,
      schema: catalogReleaseListSchema,
    });
  }
  if (resource === "catalog" && first === "artifacts" && second && !third) {
    const artifactId = parseC13Id(second, "Catalog artifact");
    if (artifactId instanceof NextResponse) return artifactId;
    return validatedC13Backend({
      accessToken: base.accessToken,
      matches: (artifact) => artifact.artifactId === artifactId,
      path: `${rootPath(base)}/catalog/artifacts/${artifactId}`,
      schema: catalogArtifactResponseSchema,
    });
  }
  if (resource === "catalog" && first === "releases" && second) {
    const releaseId = parseC13Id(second, "Catalog release");
    if (releaseId instanceof NextResponse) return releaseId;
    if (!third) {
      return validatedC13Backend({
        accessToken: base.accessToken,
        matches: (release) => release.releaseId === releaseId,
        path: `${rootPath(base)}/catalog/releases/${releaseId}`,
        schema: catalogReleaseSchema,
      });
    }
    if (third !== "assets") return routeUnavailable();
    const assetValue = base.remainder[4];
    if (!assetValue) {
      const path = assetPagePath(request, base, releaseId);
      if (path instanceof NextResponse) return path;
      return validatedC13Backend({
        accessToken: base.accessToken,
        matches: (page) =>
          page.releaseId === releaseId &&
          new Set(page.assets.map(({ versionId }) => versionId)).size === page.assets.length,
        path,
        schema: catalogAssetPageSchema,
      });
    }
    const assetVersionId = parseC13Id(assetValue, "Catalog asset version");
    if (assetVersionId instanceof NextResponse || base.remainder.length !== 5) {
      return assetVersionId instanceof NextResponse ? assetVersionId : routeUnavailable();
    }
    return validatedC13Backend({
      accessToken: base.accessToken,
      matches: (asset: CatalogAssetVersion) => asset.versionId === assetVersionId,
      path: `${rootPath(base)}/catalog/releases/${releaseId}/assets/${assetVersionId}`,
      schema: catalogAssetVersionSchema,
    });
  }

  if (resource !== "specifications") return routeUnavailable();
  if (!first) {
    return validatedC13Backend({
      accessToken: base.accessToken,
      matches: (result) =>
        result.projectId === base.projectId &&
        result.specifications.every((item) => specificationMatches(item, base.projectId)),
      path: `${rootPath(base)}/specifications`,
      schema: specificationListSchema,
    });
  }
  const specificationId = parseC13Id(first, "Specification");
  if (specificationId instanceof NextResponse) return specificationId;
  if (!second) {
    return validatedC13Backend({
      accessToken: base.accessToken,
      matches: (item) => specificationMatches(item, base.projectId, specificationId),
      path: `${rootPath(base)}/specifications/${specificationId}`,
      schema: specificationSchema,
    });
  }
  if (second === "revisions" && !third) {
    return validatedC13Backend({
      accessToken: base.accessToken,
      matches: (result) => result.specificationId === specificationId,
      path: `${rootPath(base)}/specifications/${specificationId}/revisions`,
      schema: specificationRevisionListSchema,
    });
  }
  if (second === "schedule-lines" && !third) {
    return validatedC13Backend({
      accessToken: base.accessToken,
      matches: (result) => result.specificationId === specificationId,
      path: `${rootPath(base)}/specifications/${specificationId}/schedule-lines`,
      schema: specificationScheduleLinesSchema,
    });
  }
  if (second === "substitutions" && third && base.remainder.length === 4) {
    const previewId = parseC13Id(third, "Substitution preview");
    if (previewId instanceof NextResponse) return previewId;
    return validatedC13Backend({
      accessToken: base.accessToken,
      matches: (result) =>
        result.previewId === previewId && result.specificationId === specificationId,
      path: `${rootPath(base)}/specifications/${specificationId}/substitutions/${previewId}`,
      schema: substitutionPreviewSchema,
    });
  }
  return routeUnavailable();
}

export async function POST(request: Request, context: C13RouteContext): Promise<NextResponse> {
  const base = await c13RouteBase(request, context);
  if (base instanceof NextResponse) return base;
  const idempotencyKey = requireC13IdempotencyKey(request);
  if (idempotencyKey instanceof NextResponse) return idempotencyKey;
  const [resource, first, second, third] = base.remainder;
  if (resource !== "specifications") return routeUnavailable();

  if (first === "from-c12-confirmation" && !second) {
    const body = await parseC13Body(request, createSpecificationRequestSchema);
    if (body instanceof NextResponse) return body;
    return validatedC13Backend({
      accessToken: base.accessToken,
      body,
      idempotencyKey,
      matches: (item) =>
        specificationMatches(item, base.projectId) &&
        item.currentRevision.sourceConfirmation.confirmationId === body.confirmationId &&
        item.currentRevision.catalogReleaseId === body.catalogReleaseId,
      method: "POST",
      path: `${rootPath(base)}/specifications/from-c12-confirmation`,
      schema: specificationSchema,
    });
  }

  const specificationId = parseC13Id(first, "Specification");
  if (specificationId instanceof NextResponse) return specificationId;
  if (second === "selection-board" && !third) {
    const body = await parseC13Body(request, updateSelectionBoardRequestSchema);
    if (body instanceof NextResponse) return body;
    return validatedC13Backend({
      accessToken: base.accessToken,
      body,
      idempotencyKey,
      matches: (item) =>
        specificationMatches(item, base.projectId, specificationId) &&
        item.currentRevision.revision > body.expectedRevision,
      method: "PUT",
      path: `${rootPath(base)}/specifications/${specificationId}/selection-board`,
      schema: specificationSchema,
    });
  }
  if (second !== "substitutions") return routeUnavailable();
  if (!third) {
    const body = await parseC13Body(request, createSubstitutionPreviewRequestSchema);
    if (body instanceof NextResponse) return body;
    return validatedC13Backend({
      accessToken: base.accessToken,
      body,
      idempotencyKey,
      matches: (result) =>
        result.specificationId === specificationId &&
        result.elementId === body.elementId &&
        result.replacementAssetVersionId === body.replacementAssetVersionId,
      method: "POST",
      path: `${rootPath(base)}/specifications/${specificationId}/substitutions`,
      schema: substitutionPreviewSchema,
    });
  }
  const action = base.remainder[4];
  if (action !== "confirm" || base.remainder.length !== 5) return routeUnavailable();
  const previewId = parseC13Id(third, "Substitution preview");
  if (previewId instanceof NextResponse) return previewId;
  const body = await parseC13Body(request, confirmSubstitutionRequestSchema);
  if (body instanceof NextResponse) return body;
  if (body.previewId !== previewId) {
    return problemResponse(400, "Preview mismatch", "Body and path preview IDs must match.");
  }
  return validatedC13Backend({
    accessToken: base.accessToken,
    body,
    idempotencyKey,
    matches: (result) => result.specificationId === specificationId,
    method: "POST",
    path: `${rootPath(base)}/specifications/${specificationId}/substitutions/${previewId}/confirm`,
    schema: substitutionConfirmationSchema,
  });
}
