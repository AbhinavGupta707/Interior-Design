import {
  commitModelOperationsRequestSchema,
  commitModelOperationsResponseSchema,
  createModelBranchRequestSchema,
  listModelBranchesResponseSchema,
  modelBranchComparisonSchema,
  modelBranchSchema,
  modelOperationHistoryResponseSchema,
  modelOperationsPreviewSchema,
  modelSnapshotRecordSchema,
  previewModelOperationsRequestSchema,
  restoreModelBranchRequestSchema,
} from "@interior-design/contracts";
import { NextResponse } from "next/server";

import { editorBranchWorkspaceSchema } from "../../../../features/editor-2d/contracts";
import {
  c5RouteBase,
  parseBranchId,
  parseC5Body,
  requireC5MutationKey,
  safeC5Problem,
  validatedBackend,
} from "../_shared/editor-proxy";
import type { C5RouteBase, C5RouteContext } from "../_shared/editor-proxy";
import { backendRequest, problemResponse, safeBackendAction } from "../../c1/_shared/backend";

function branchesPath(base: C5RouteBase): string {
  return `/v1/projects/${base.projectId}/models/${base.profile}/branches`;
}

async function branchWorkspace(base: C5RouteBase, branchId: string): Promise<NextResponse> {
  return safeBackendAction(async () => {
    const branchResponse = await backendRequest(`${branchesPath(base)}/${branchId}`, {
      accessToken: base.accessToken,
    });
    if (!branchResponse.ok) return safeC5Problem(branchResponse);
    const branchPayload: unknown = await branchResponse.json().catch(() => undefined);
    const branch = modelBranchSchema.safeParse(branchPayload);
    if (!branch.success) {
      return problemResponse(
        502,
        "Invalid branch response",
        "The model service returned a branch outside c5-model-operation-v1.",
      );
    }
    const snapshotPath = (snapshotId: string) =>
      `/v1/projects/${base.projectId}/models/${base.profile}/snapshots/${snapshotId}`;
    const headPromise = backendRequest(snapshotPath(branch.data.headSnapshotId), {
      accessToken: base.accessToken,
    });
    const sourcePromise =
      branch.data.sourceSnapshotId === branch.data.headSnapshotId
        ? headPromise
        : backendRequest(snapshotPath(branch.data.sourceSnapshotId), {
            accessToken: base.accessToken,
          });
    const [headResponse, sourceResponse] = await Promise.all([headPromise, sourcePromise]);
    if (!headResponse.ok) return safeC5Problem(headResponse);
    if (!sourceResponse.ok) return safeC5Problem(sourceResponse);
    const headPayload: unknown = await headResponse.json().catch(() => undefined);
    const sourcePayload: unknown =
      sourceResponse === headResponse
        ? headPayload
        : await sourceResponse.json().catch(() => undefined);
    const parsed = editorBranchWorkspaceSchema.safeParse({
      branch: branch.data,
      headSnapshot: headPayload,
      sourceSnapshot: sourcePayload,
    });
    if (!parsed.success) {
      return problemResponse(
        502,
        "Invalid branch snapshot response",
        "The branch and exact snapshots did not satisfy the frozen C4/C5 contracts.",
      );
    }
    return NextResponse.json(parsed.data, { headers: { "cache-control": "no-store" } });
  });
}

function validCursor(request: Request): string | NextResponse | undefined {
  const cursor = new URL(request.url).searchParams.get("cursor")?.trim();
  if (!cursor) return undefined;
  return cursor.length <= 500
    ? cursor
    : problemResponse(400, "Invalid cursor", "The operation-history cursor is too long.");
}

export async function GET(request: Request, context: C5RouteContext): Promise<NextResponse> {
  const base = await c5RouteBase(request, context);
  if (base instanceof NextResponse) return base;
  const [resource, branchValue, action, targetValue] = base.remainder;
  if (resource === "source" && base.remainder.length === 1) {
    return validatedBackend({
      accessToken: base.accessToken,
      path: `/v1/projects/${base.projectId}/models/${base.profile}`,
      schema: modelSnapshotRecordSchema,
    });
  }
  if (resource !== "branches") {
    return problemResponse(404, "Editor route unavailable", "This editor route is not available.");
  }
  if (!branchValue) {
    return validatedBackend({
      accessToken: base.accessToken,
      path: branchesPath(base),
      schema: listModelBranchesResponseSchema,
    });
  }
  const branchId = parseBranchId(branchValue);
  if (branchId instanceof NextResponse) return branchId;
  if (!action) return branchWorkspace(base, branchId);
  if (action === "operations" && !targetValue) {
    const cursor = validCursor(request);
    if (cursor instanceof NextResponse) return cursor;
    return validatedBackend({
      accessToken: base.accessToken,
      path: `${branchesPath(base)}/${branchId}/operations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      schema: modelOperationHistoryResponseSchema,
    });
  }
  if (action === "compare" && targetValue) {
    const targetBranchId = parseBranchId(targetValue);
    if (targetBranchId instanceof NextResponse) return targetBranchId;
    return validatedBackend({
      accessToken: base.accessToken,
      path: `${branchesPath(base)}/${branchId}/compare/${targetBranchId}`,
      schema: modelBranchComparisonSchema,
    });
  }
  return problemResponse(404, "Editor route unavailable", "This editor route is not available.");
}

export async function POST(request: Request, context: C5RouteContext): Promise<NextResponse> {
  const base = await c5RouteBase(request, context);
  if (base instanceof NextResponse) return base;
  const [resource, branchValue, action, extra] = base.remainder;
  if (resource !== "branches" || extra) {
    return problemResponse(404, "Editor route unavailable", "This editor route is not available.");
  }
  const key = requireC5MutationKey(request);
  if (key instanceof NextResponse) return key;
  if (!branchValue && !action) {
    const body = await parseC5Body(request, createModelBranchRequestSchema);
    if (body instanceof NextResponse) return body;
    return validatedBackend({
      accessToken: base.accessToken,
      body,
      idempotencyKey: key,
      method: "POST",
      path: branchesPath(base),
      schema: modelBranchSchema,
    });
  }
  const branchId = parseBranchId(branchValue);
  if (branchId instanceof NextResponse) return branchId;
  if (action === "previews") {
    const body = await parseC5Body(request, previewModelOperationsRequestSchema);
    if (body instanceof NextResponse) return body;
    return validatedBackend({
      accessToken: base.accessToken,
      body,
      idempotencyKey: key,
      method: "POST",
      path: `${branchesPath(base)}/${branchId}/previews`,
      schema: modelOperationsPreviewSchema,
    });
  }
  if (action === "commits") {
    const body = await parseC5Body(request, commitModelOperationsRequestSchema);
    if (body instanceof NextResponse) return body;
    return validatedBackend({
      accessToken: base.accessToken,
      body,
      idempotencyKey: key,
      method: "POST",
      path: `${branchesPath(base)}/${branchId}/commits`,
      schema: commitModelOperationsResponseSchema,
    });
  }
  if (action === "restores") {
    const body = await parseC5Body(request, restoreModelBranchRequestSchema);
    if (body instanceof NextResponse) return body;
    return validatedBackend({
      accessToken: base.accessToken,
      body,
      idempotencyKey: key,
      method: "POST",
      path: `${branchesPath(base)}/${branchId}/restores`,
      schema: commitModelOperationsResponseSchema,
    });
  }
  return problemResponse(404, "Editor route unavailable", "This editor route is not available.");
}
