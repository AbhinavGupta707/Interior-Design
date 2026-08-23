import {
  createModelSnapshotRequestSchema,
  modelSnapshotRecordSchema,
  propertyDossierSchema,
  sessionSchema,
  type KnownAttribution,
} from "@interior-design/contracts";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  backendRequest,
  expireSession,
  problemResponse,
  safeBackendAction,
} from "../../c1/_shared/backend";
import type { C5RouteBase } from "./editor-proxy";

export const homeWorkspaceAcknowledgementSchema = z
  .object({ confirmUnmeasuredInterior: z.literal(true) })
  .strict();

type CreateModelSnapshotRequest = z.infer<typeof createModelSnapshotRequestSchema>;

interface HomeWorkspaceScope {
  readonly actorUserId: string;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly propertyId: string;
}

const method = Object.freeze({
  kind: "manual" as const,
  name: "Homeowner unmeasured workspace acknowledgement",
  version: "c14.2-v1",
});

function deterministicUuid(scope: HomeWorkspaceScope, purpose: string): string {
  const bytes = Buffer.from(
    createHash("sha256")
      .update(
        JSON.stringify([
          "c14.2-existing-home-workspace-v1",
          scope.actorUserId,
          scope.projectId,
          scope.idempotencyKey,
          purpose,
        ]),
        "utf8",
      )
      .digest()
      .subarray(0, 16),
  );
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hexadecimal = bytes.toString("hex");
  return `${hexadecimal.slice(0, 8)}-${hexadecimal.slice(8, 12)}-${hexadecimal.slice(12, 16)}-${hexadecimal.slice(16, 20)}-${hexadecimal.slice(20)}`;
}

function userAssertion(scope: HomeWorkspaceScope, purpose: string): KnownAttribution {
  return {
    actorUserId: scope.actorUserId,
    claimId: deterministicUuid(scope, purpose),
    evidenceIds: [],
    method,
    state: "user-asserted",
    verification: { status: "not-reviewed" },
  };
}

function unknown(scope: HomeWorkspaceScope, purpose: string) {
  return {
    attribution: {
      claimId: deterministicUuid(scope, purpose),
      evidenceIds: [],
      method,
      reason: "not-provided" as const,
      state: "unknown" as const,
      verification: { status: "not-reviewed" as const },
    },
    knowledge: "unknown" as const,
  };
}

export function buildUnmeasuredHomeWorkspaceRequest(
  scope: HomeWorkspaceScope,
): CreateModelSnapshotRequest {
  return createModelSnapshotRequestSchema.parse({
    expectedCurrentSnapshotSha256: null,
    snapshot: {
      coordinateSystem: {
        axes: { x: "east", y: "north", z: "up" },
        globalAnchor: { status: "not-established" },
        handedness: "right",
        kind: "local-cartesian",
        lengthUnit: "mm",
        originConvention: "project-local-model-origin",
      },
      elements: {
        cameras: [],
        finishes: [],
        fixedObjects: [],
        furnishings: [],
        levels: [
          {
            elementType: "level",
            elevationMm: unknown(scope, "level-elevation-claim"),
            id: deterministicUuid(scope, "placeholder-level"),
            name: unknown(scope, "level-name-claim"),
            origin: userAssertion(scope, "level-origin-claim"),
            storeyHeightMm: unknown(scope, "level-storey-height-claim"),
          },
        ],
        lights: [],
        openings: [],
        spaces: [],
        stairs: [],
        surfaces: [],
        walls: [],
      },
      knownLimitations: [
        {
          code: "PROPERTY_CONTEXT_PROVES_NO_INTERIOR",
          detail:
            "The selected property links this project only; its address and provider context establish no interior geometry or dimensions.",
        },
        {
          code: "PLACEHOLDER_LEVEL_UNMEASURED",
          detail:
            "The single placeholder level is unmeasured and not reviewed; its name, elevation and storey height remain unknown.",
        },
      ],
      modelId: deterministicUuid(scope, "existing-model"),
      profile: "existing",
      projectId: scope.projectId,
      propertyId: scope.propertyId,
      schemaVersion: "c4-canonical-home-v1",
    },
  });
}

function safeSessionProblem(response: Response): NextResponse {
  const next = problemResponse(
    response.status,
    response.status === 401 ? "Session expired" : "Session unavailable",
    response.status === 401
      ? "Your session expired. Sign in again before setting up the model workspace."
      : "The current session could not be verified. No model state was changed.",
  );
  return response.status === 401 ? expireSession(next) : next;
}

async function safePropertyProblem(response: Response): Promise<NextResponse> {
  const payload: unknown = await response
    .clone()
    .json()
    .catch(() => undefined);
  const code =
    typeof payload === "object" && payload !== null && "code" in payload
      ? (payload as { readonly code?: unknown }).code
      : undefined;
  if (code === "PROPERTY_NOT_SELECTED" || response.status === 404) {
    return NextResponse.json(
      {
        code: "PROPERTY_NOT_SELECTED",
        detail:
          "Confirm a project property before setting up the unmeasured existing-model workspace.",
        status: 409,
        title: "Property confirmation required",
        type: "about:blank",
      },
      { headers: { "cache-control": "no-store" }, status: 409 },
    );
  }
  const next = problemResponse(
    response.status,
    response.status === 401 ? "Session expired" : "Property unavailable",
    response.status === 401
      ? "Your session expired. Sign in again before setting up the model workspace."
      : "The selected property could not be verified. No model state was changed.",
  );
  return response.status === 401 ? expireSession(next) : next;
}
async function safeInitializationProblem(response: Response): Promise<NextResponse> {
  const payload: unknown = await response
    .clone()
    .json()
    .catch(() => undefined);
  const rawCode =
    typeof payload === "object" && payload !== null && "code" in payload
      ? (payload as { readonly code?: unknown }).code
      : undefined;
  const code =
    typeof rawCode === "string" &&
    (rawCode === "TYPED_OPERATION_REQUIRED" ||
      rawCode === "BRANCH_REVISION_CONFLICT" ||
      (/^[A-Z][A-Z0-9_]{0,79}$/u.test(rawCode) && rawCode.endsWith("_EXPIRED")))
      ? rawCode
      : undefined;
  const title =
    response.status === 401
      ? "Session expired"
      : code === "TYPED_OPERATION_REQUIRED"
        ? "Existing workspace already initialized"
        : response.status === 409
          ? "Workspace state changed"
          : "Model setup unavailable";
  const detail =
    response.status === 401
      ? "Your session expired. Sign in again before reloading the model workspace."
      : code === "TYPED_OPERATION_REQUIRED"
        ? "The existing profile is already initialized. Reload exact server state before continuing."
        : code?.endsWith("_EXPIRED")
          ? "The setup request expired. Reload exact server state before trying again."
          : response.status === 403
            ? "The current role cannot initialize this model workspace."
            : response.status === 409
              ? "Workspace state changed before setup completed. Reload exact server state before retrying."
              : "The model service could not initialize the workspace. No browser-supplied model state was accepted.";
  const next = NextResponse.json(
    {
      ...(code ? { code } : {}),
      detail,
      status: response.status,
      title,
      type: "about:blank",
    },
    { headers: { "cache-control": "no-store" }, status: response.status },
  );
  return response.status === 401 ? expireSession(next) : next;
}

function responseMatchesRequest(
  record: z.infer<typeof modelSnapshotRecordSchema>,
  request: CreateModelSnapshotRequest,
): boolean {
  const expectedLevel = request.snapshot.elements.levels[0];
  const actualLevels = record.snapshot.elements.levels;
  const actualLevel = actualLevels.at(0);
  if (expectedLevel === undefined || actualLevel === undefined || actualLevels.length !== 1) {
    return false;
  }
  return (
    record.createdBy === expectedLevel.origin.actorUserId &&
    record.modelId === request.snapshot.modelId &&
    record.profile === "existing" &&
    record.projectId === request.snapshot.projectId &&
    record.snapshot.modelId === request.snapshot.modelId &&
    record.snapshot.profile === "existing" &&
    record.snapshot.projectId === request.snapshot.projectId &&
    record.snapshot.propertyId === request.snapshot.propertyId &&
    actualLevel.id === expectedLevel.id &&
    isDeepStrictEqual(record.snapshot, request.snapshot)
  );
}

export async function initializeHomeWorkspace(
  base: C5RouteBase,
  idempotencyKey: string,
): Promise<NextResponse> {
  if (base.profile !== "existing") {
    return problemResponse(
      404,
      "Home workspace unavailable",
      "Only the existing-model profile can be initialized by this product action.",
    );
  }

  return safeBackendAction(async () => {
    const sessionPromise = backendRequest("/v1/session", { accessToken: base.accessToken });
    const propertyPromise = backendRequest(`/v1/projects/${base.projectId}/property/dossier`, {
      accessToken: base.accessToken,
    });
    const [sessionResponse, propertyResponse] = await Promise.all([
      sessionPromise,
      propertyPromise,
    ]);

    if (!sessionResponse.ok) return safeSessionProblem(sessionResponse);
    const sessionPayload: unknown = await sessionResponse.json().catch(() => undefined);
    const session = sessionSchema.safeParse(sessionPayload);
    if (!session.success) {
      return problemResponse(
        502,
        "Invalid session response",
        "The session service returned data outside the frozen C1 contract.",
      );
    }
    if (Date.parse(session.data.expiresAt) <= Date.now()) {
      return expireSession(
        problemResponse(
          401,
          "Session expired",
          "Your session expired. Sign in again before setting up the model workspace.",
        ),
      );
    }
    if (session.data.actor.role === "viewer") {
      return problemResponse(
        403,
        "Model setup unavailable",
        "Viewer access is read-only. An owner or editor must set up this workspace.",
      );
    }

    if (!propertyResponse.ok) return safePropertyProblem(propertyResponse);
    const propertyPayload: unknown = await propertyResponse.json().catch(() => undefined);
    const dossier = propertyDossierSchema.safeParse(propertyPayload);
    if (!dossier.success || dossier.data.property.projectId !== base.projectId) {
      return problemResponse(
        502,
        "Invalid property response",
        "The property service returned data outside the frozen C3 project dossier contract.",
      );
    }

    const request = buildUnmeasuredHomeWorkspaceRequest({
      actorUserId: session.data.actor.userId,
      idempotencyKey,
      projectId: base.projectId,
      propertyId: dossier.data.property.propertyId,
    });
    const upstream = await backendRequest(
      `/v1/projects/${base.projectId}/models/existing/snapshots`,
      {
        accessToken: base.accessToken,
        body: JSON.stringify(request),
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        method: "POST",
      },
    );
    if (!upstream.ok) return safeInitializationProblem(upstream);
    const payload: unknown = await upstream.json().catch(() => undefined);
    const record = modelSnapshotRecordSchema.safeParse(payload);
    if (!record.success || !responseMatchesRequest(record.data, request)) {
      return problemResponse(
        502,
        "Invalid model service response",
        "The model service returned data outside the exact unmeasured workspace request.",
      );
    }
    return NextResponse.json(record.data, {
      headers: { "cache-control": "no-store" },
      status: upstream.status,
    });
  });
}
