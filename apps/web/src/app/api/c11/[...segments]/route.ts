import {
  acceptBriefRequestSchema,
  briefPatchProposalSchema,
  confirmBriefPatchProposalRequestSchema,
  consultationSessionSchema,
  createConsultationSessionRequestSchema,
  designBriefSchema,
  projectIntakeSchema,
  projectSchema,
  sessionSchema,
  submitConsultationTurnRequestSchema,
  updateBriefRequestSchema,
} from "@interior-design/contracts";
import { NextResponse } from "next/server";

import { consultationWorkspaceSchema } from "../../../../features/design-consultation/contracts";
import { backendRequest, problemResponse, safeBackendAction } from "../../c1/_shared/backend";
import {
  c11RouteBase,
  parseC11Body,
  parseC11Id,
  requireC11IdempotencyKey,
  safeC11Problem,
  validatedC11Backend,
} from "../_shared/consultation-proxy";
import type { C11RouteBase, C11RouteContext } from "../_shared/consultation-proxy";

function briefPath(base: C11RouteBase): string {
  return `/v1/projects/${base.projectId}/design-brief`;
}

function consultationPath(base: C11RouteBase, sessionId?: string): string {
  return `/v1/projects/${base.projectId}/design-consultations${sessionId ? `/${sessionId}` : ""}`;
}

function evidenceClassification(): "fixture-presentation" | "real-backend" {
  return process.env.C11_CONSULTATION_EVIDENCE_CLASSIFICATION === "fixture-presentation"
    ? "fixture-presentation"
    : "real-backend";
}

async function jsonPayload(response: Response): Promise<unknown> {
  return response.json().catch(() => undefined) as Promise<unknown>;
}

async function workspace(base: C11RouteBase): Promise<NextResponse> {
  return safeBackendAction(async () => {
    const [sessionResponse, projectResponse, briefResponse] = await Promise.all([
      backendRequest("/v1/session", { accessToken: base.accessToken }),
      backendRequest(`/v1/projects/${base.projectId}`, { accessToken: base.accessToken }),
      backendRequest(briefPath(base), { accessToken: base.accessToken }),
    ]);
    for (const response of [sessionResponse, projectResponse]) {
      if (!response.ok) return safeC11Problem(response);
    }
    if (!briefResponse.ok && briefResponse.status !== 404) return safeC11Problem(briefResponse);
    const [sessionPayload, projectPayload] = await Promise.all([
      jsonPayload(sessionResponse),
      jsonPayload(projectResponse),
    ]);
    const session = sessionSchema.safeParse(sessionPayload);
    const project = projectSchema.safeParse(projectPayload);
    if (!session.success || !project.success) {
      return problemResponse(
        502,
        "Invalid consultation workspace response",
        "The workspace dependencies did not satisfy the frozen contracts.",
      );
    }
    const brief =
      briefResponse.status === 404
        ? null
        : designBriefSchema.safeParse(await jsonPayload(briefResponse));
    if (brief !== null && !brief.success) {
      return problemResponse(
        502,
        "Invalid consultation brief response",
        "The consultation brief did not satisfy the frozen C11 contract.",
      );
    }
    let intake: {
      readonly accessibilityNeeds: readonly string[];
      readonly goals: readonly string[];
      readonly mustChange: readonly string[];
      readonly mustKeep: readonly string[];
      readonly projectId: string;
      readonly styleWords: readonly string[];
      readonly updatedAt: string;
      readonly updatedBy: string;
      readonly version: number;
    } | null = null;
    if (brief === null) {
      const intakeResponse = await backendRequest(`/v1/projects/${base.projectId}/intake`, {
        accessToken: base.accessToken,
      });
      if (intakeResponse.ok) {
        const parsedIntake = projectIntakeSchema.safeParse(await jsonPayload(intakeResponse));
        if (!parsedIntake.success || parsedIntake.data.projectId !== base.projectId) {
          return problemResponse(
            502,
            "Invalid consultation intake response",
            "The saved intake did not match the requested project.",
          );
        }
        const saved = parsedIntake.data;
        intake = {
          accessibilityNeeds: saved.intake.accessibilityNeeds,
          goals: saved.intake.goals,
          mustChange: saved.intake.mustChange,
          mustKeep: saved.intake.mustKeep,
          projectId: saved.projectId,
          styleWords: saved.intake.styleWords,
          updatedAt: saved.updatedAt,
          updatedBy: saved.updatedBy,
          version: saved.version,
        };
      } else if (intakeResponse.status !== 204 && intakeResponse.status !== 404) {
        return safeC11Problem(intakeResponse);
      }
    }
    const parsed = consultationWorkspaceSchema.safeParse({
      brief: brief?.data ?? null,
      capability: {
        activeAdapter: "deterministic-local-v1",
        evidenceClassification: evidenceClassification(),
        externalNetworkUsed: false,
        externalProviders: "disabled",
      },
      intake,
      project: project.data,
      session: session.data,
    });
    if (!parsed.success || project.data.id !== base.projectId) {
      return problemResponse(
        502,
        "Mismatched consultation workspace response",
        "The workspace dependencies did not match the requested project.",
      );
    }
    return NextResponse.json(parsed.data, { headers: { "cache-control": "no-store" } });
  });
}

export async function GET(request: Request, context: C11RouteContext): Promise<NextResponse> {
  const base = await c11RouteBase(request, context);
  if (base instanceof NextResponse) return base;
  const [resource, sessionValue, proposals, proposalValue, action] = base.remainder;
  if (resource === "workspace" && base.remainder.length === 1) return workspace(base);
  if (resource === "design-brief" && base.remainder.length === 1) {
    return validatedC11Backend({
      accessToken: base.accessToken,
      matches: (brief) => brief.projectId === base.projectId,
      path: briefPath(base),
      schema: designBriefSchema,
    });
  }
  if (resource !== "design-consultations" || action || !sessionValue) {
    return problemResponse(
      404,
      "Consultation route unavailable",
      "This consultation route is not available.",
    );
  }
  const sessionId = parseC11Id(sessionValue, "Consultation session");
  if (sessionId instanceof NextResponse) return sessionId;
  if (base.remainder.length === 2) {
    return validatedC11Backend({
      accessToken: base.accessToken,
      matches: (session) => session.projectId === base.projectId && session.id === sessionId,
      path: consultationPath(base, sessionId),
      schema: consultationSessionSchema,
    });
  }
  if (proposals === "proposals" && proposalValue && base.remainder.length === 4) {
    const proposalId = parseC11Id(proposalValue, "Consultation proposal");
    if (proposalId instanceof NextResponse) return proposalId;
    return validatedC11Backend({
      accessToken: base.accessToken,
      matches: (proposal) =>
        proposal.projectId === base.projectId &&
        proposal.sessionId === sessionId &&
        proposal.id === proposalId,
      path: `${consultationPath(base, sessionId)}/proposals/${proposalId}`,
      schema: briefPatchProposalSchema,
    });
  }
  return problemResponse(
    404,
    "Consultation route unavailable",
    "This consultation route is not available.",
  );
}

export async function POST(request: Request, context: C11RouteContext): Promise<NextResponse> {
  const base = await c11RouteBase(request, context);
  if (base instanceof NextResponse) return base;
  const [resource, sessionValue, child, childValue, action] = base.remainder;
  const idempotencyKey = requireC11IdempotencyKey(request);
  if (idempotencyKey instanceof NextResponse) return idempotencyKey;

  if (resource === "design-brief" && base.remainder.length === 1) {
    const body = await parseC11Body(request, updateBriefRequestSchema);
    if (body instanceof NextResponse) return body;
    if (body.idempotencyKey !== idempotencyKey) {
      return problemResponse(400, "Idempotency mismatch", "Body and header keys must match.");
    }
    return validatedC11Backend({
      accessToken: base.accessToken,
      body,
      idempotencyKey,
      matches: (brief) => brief.projectId === base.projectId,
      method: "PUT",
      path: briefPath(base),
      schema: designBriefSchema,
    });
  }
  if (resource === "design-brief" && sessionValue === "accept" && base.remainder.length === 2) {
    const body = await parseC11Body(request, acceptBriefRequestSchema);
    if (body instanceof NextResponse) return body;
    if (body.idempotencyKey !== idempotencyKey) {
      return problemResponse(400, "Idempotency mismatch", "Body and header keys must match.");
    }
    return validatedC11Backend({
      accessToken: base.accessToken,
      body,
      idempotencyKey,
      matches: (brief) => brief.projectId === base.projectId,
      method: "POST",
      path: `${briefPath(base)}/accept`,
      schema: designBriefSchema,
    });
  }
  if (resource !== "design-consultations") {
    return problemResponse(
      404,
      "Consultation route unavailable",
      "This consultation route is not available.",
    );
  }
  if (!sessionValue && base.remainder.length === 1) {
    const body = await parseC11Body(request, createConsultationSessionRequestSchema);
    if (body instanceof NextResponse) return body;
    if (body.idempotencyKey !== idempotencyKey) {
      return problemResponse(400, "Idempotency mismatch", "Body and header keys must match.");
    }
    return validatedC11Backend({
      accessToken: base.accessToken,
      body,
      idempotencyKey,
      matches: (session) => session.projectId === base.projectId,
      method: "POST",
      path: consultationPath(base),
      schema: consultationSessionSchema,
    });
  }
  const sessionId = parseC11Id(sessionValue, "Consultation session");
  if (sessionId instanceof NextResponse) return sessionId;
  if (child === "cancel" && base.remainder.length === 3) {
    return validatedC11Backend({
      accessToken: base.accessToken,
      idempotencyKey,
      matches: (session) => session.projectId === base.projectId && session.id === sessionId,
      method: "POST",
      path: `${consultationPath(base, sessionId)}/cancel`,
      schema: consultationSessionSchema,
    });
  }
  if (child === "turns" && base.remainder.length === 3) {
    const body = await parseC11Body(request, submitConsultationTurnRequestSchema);
    if (body instanceof NextResponse) return body;
    if (body.clientMessageId !== idempotencyKey) {
      return problemResponse(400, "Idempotency mismatch", "Message and header keys must match.");
    }
    return validatedC11Backend({
      accessToken: base.accessToken,
      body,
      idempotencyKey,
      matches: (proposal) =>
        proposal.projectId === base.projectId && proposal.sessionId === sessionId,
      method: "POST",
      path: `${consultationPath(base, sessionId)}/turns`,
      schema: briefPatchProposalSchema,
    });
  }
  if (child === "proposals" && childValue && action === "confirm" && base.remainder.length === 5) {
    const proposalId = parseC11Id(childValue, "Consultation proposal");
    if (proposalId instanceof NextResponse) return proposalId;
    const body = await parseC11Body(request, confirmBriefPatchProposalRequestSchema);
    if (body instanceof NextResponse) return body;
    if (body.idempotencyKey !== idempotencyKey) {
      return problemResponse(400, "Idempotency mismatch", "Body and header keys must match.");
    }
    return validatedC11Backend({
      accessToken: base.accessToken,
      body,
      idempotencyKey,
      matches: (brief) => brief.projectId === base.projectId,
      method: "POST",
      path: `${consultationPath(base, sessionId)}/proposals/${proposalId}/confirm`,
      schema: designBriefSchema,
    });
  }
  return problemResponse(
    404,
    "Consultation route unavailable",
    "This consultation route is not available.",
  );
}
