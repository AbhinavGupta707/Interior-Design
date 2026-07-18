import {
  acceptBriefRequestSchema,
  briefPatchProposalSchema,
  confirmBriefPatchProposalRequestSchema,
  consultationSessionSchema,
  createConsultationSessionRequestSchema,
  designBriefSchema,
  submitConsultationTurnRequestSchema,
  updateBriefRequestSchema,
} from "@interior-design/contracts";
import type {
  BriefPatchOperation,
  BriefPatchProposal,
  ConsultationSession,
  DesignBrief,
  UpdateBriefRequest,
} from "@interior-design/contracts";
import type { ZodType } from "zod";

import { consultationWorkspaceSchema } from "./contracts";
import type { ConsultationWorkspace } from "./contracts";
import { normalizeCorrectedBriefOperations } from "./corrected-operations";

export type ConsultationProblemKind =
  | "conflict"
  | "expired"
  | "forbidden"
  | "invalid-response"
  | "not-found"
  | "offline"
  | "proposal-expired"
  | "unavailable";

interface ProblemPayload {
  readonly code?: unknown;
  readonly detail?: unknown;
}

export class ConsultationProblem extends Error {
  constructor(
    readonly kind: ConsultationProblemKind,
    message: string,
    readonly status = 0,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ConsultationProblem";
  }
}

export type ConsultationTransport = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type CorrectedBriefPatchResult =
  | {
      readonly brief: DesignBrief;
      readonly consultation: ConsultationSession;
      readonly kind: "closed";
    }
  | {
      readonly brief: DesignBrief;
      readonly cleanupProblem: ConsultationProblem;
      readonly kind: "cleanup-failed";
    };

function problemKind(status: number): ConsultationProblemKind {
  if (status === 401) return "expired";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 409) return "conflict";
  if (status === 410) return "proposal-expired";
  return "unavailable";
}

async function responseProblem(response: Response): Promise<ConsultationProblem> {
  const payload: unknown = await response.json().catch(() => undefined);
  const problem =
    typeof payload === "object" && payload !== null ? (payload as ProblemPayload) : undefined;
  const code = typeof problem?.code === "string" ? problem.code : undefined;
  const detail =
    typeof problem?.detail === "string" && problem.detail.length <= 500
      ? problem.detail
      : "The consultation request could not be completed.";
  return new ConsultationProblem(problemKind(response.status), detail, response.status, code);
}

function jsonMutation(body?: unknown, idempotencyKey?: string): RequestInit {
  const headers = new Headers({
    accept: "application/json, application/problem+json",
    "idempotency-key": idempotencyKey ?? crypto.randomUUID(),
  });
  if (body !== undefined) headers.set("content-type", "application/json");
  return {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers,
    method: "POST",
  };
}

function projectBase(projectId: string): string {
  return `/api/c11/projects/${encodeURIComponent(projectId)}`;
}

function consultationBase(projectId: string, sessionId: string): string {
  return `${projectBase(projectId)}/design-consultations/${encodeURIComponent(sessionId)}`;
}

export function createConsultationClient(transport: ConsultationTransport = fetch) {
  async function request<T>(url: string, schema: ZodType<T>, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await transport(url, { ...init, cache: "no-store" });
    } catch {
      throw new ConsultationProblem(
        "offline",
        "You appear to be offline. Reconnect and retry; no brief change was applied.",
      );
    }
    if (!response.ok) throw await responseProblem(response);
    const payload: unknown = await response.json().catch(() => undefined);
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new ConsultationProblem(
        "invalid-response",
        "The service response did not match the frozen C11 contracts.",
        502,
        "INVALID_UPSTREAM_RESPONSE",
      );
    }
    return parsed.data;
  }

  return Object.freeze({
    async applyCorrectedBriefPatch(
      projectId: string,
      sessionId: string,
      brief: DesignBrief,
      operations: readonly BriefPatchOperation[],
      confirmingActorUserId: string,
      correctedAt: string,
    ): Promise<CorrectedBriefPatchResult> {
      const correctedOperations = normalizeCorrectedBriefOperations(
        operations,
        confirmingActorUserId,
        correctedAt,
      );
      const body = updateBriefRequestSchema.parse({
        expectedRevision: brief.revision,
        idempotencyKey: crypto.randomUUID(),
        operations: correctedOperations,
      });
      const updatedBrief = await request(
        `${projectBase(projectId)}/design-brief`,
        designBriefSchema,
        jsonMutation(body, body.idempotencyKey),
      );
      try {
        const consultation = await request(
          `${consultationBase(projectId, sessionId)}/cancel`,
          consultationSessionSchema,
          jsonMutation(),
        );
        return { brief: updatedBrief, consultation, kind: "closed" };
      } catch (reason) {
        const cleanupProblem =
          reason instanceof ConsultationProblem
            ? reason
            : new ConsultationProblem(
                "unavailable",
                "The corrected brief was saved, but the consultation could not be closed.",
              );
        return { brief: updatedBrief, cleanupProblem, kind: "cleanup-failed" };
      }
    },
    acceptBrief(projectId: string, brief: DesignBrief): Promise<DesignBrief> {
      const body = acceptBriefRequestSchema.parse({
        expectedRevision: brief.revision,
        idempotencyKey: crypto.randomUUID(),
      });
      return request(
        `${projectBase(projectId)}/design-brief/accept`,
        designBriefSchema,
        jsonMutation(body, body.idempotencyKey),
      );
    },
    cancelSession(projectId: string, sessionId: string): Promise<ConsultationSession> {
      return request(
        `${consultationBase(projectId, sessionId)}/cancel`,
        consultationSessionSchema,
        jsonMutation(),
      );
    },
    confirmProposal(
      projectId: string,
      proposal: BriefPatchProposal,
      briefRevision: number,
    ): Promise<DesignBrief> {
      const body = confirmBriefPatchProposalRequestSchema.parse({
        expectedBriefRevision: briefRevision,
        idempotencyKey: crypto.randomUUID(),
      });
      return request(
        `${consultationBase(projectId, proposal.sessionId)}/proposals/${encodeURIComponent(proposal.id)}/confirm`,
        designBriefSchema,
        jsonMutation(body, body.idempotencyKey),
      );
    },
    createSession(projectId: string, brief: DesignBrief): Promise<ConsultationSession> {
      const body = createConsultationSessionRequestSchema.parse({
        baseBriefId: brief.id,
        baseBriefRevision: brief.revision,
        idempotencyKey: crypto.randomUUID(),
        providerMode: "deterministic-local",
      });
      return request(
        `${projectBase(projectId)}/design-consultations`,
        consultationSessionSchema,
        jsonMutation(body, body.idempotencyKey),
      );
    },
    getProposal(projectId: string, sessionId: string, proposalId: string) {
      return request(
        `${consultationBase(projectId, sessionId)}/proposals/${encodeURIComponent(proposalId)}`,
        briefPatchProposalSchema,
      );
    },
    getSession(projectId: string, sessionId: string): Promise<ConsultationSession> {
      return request(consultationBase(projectId, sessionId), consultationSessionSchema);
    },
    initializeBrief(projectId: string, initialization: UpdateBriefRequest): Promise<DesignBrief> {
      const body = updateBriefRequestSchema.parse(initialization);
      if (body.expectedRevision !== 0) {
        throw new ConsultationProblem(
          "conflict",
          "The first brief must be initialized against expected revision 0.",
        );
      }
      return request(
        projectBase(projectId) + "/design-brief",
        designBriefSchema,
        jsonMutation(body, body.idempotencyKey),
      );
    },
    loadWorkspace(projectId: string): Promise<ConsultationWorkspace> {
      return request(`${projectBase(projectId)}/workspace`, consultationWorkspaceSchema);
    },
    submitTurn(
      projectId: string,
      sessionId: string,
      expectedBriefRevision: number,
      message: string,
    ): Promise<BriefPatchProposal> {
      const body = submitConsultationTurnRequestSchema.parse({
        clientMessageId: crypto.randomUUID(),
        expectedBriefRevision,
        message,
      });
      return request(
        `${consultationBase(projectId, sessionId)}/turns`,
        briefPatchProposalSchema,
        jsonMutation(body, body.clientMessageId),
      );
    },
    updateBrief(
      projectId: string,
      brief: DesignBrief,
      operations: readonly BriefPatchOperation[],
    ): Promise<DesignBrief> {
      const body = updateBriefRequestSchema.parse({
        expectedRevision: brief.revision,
        idempotencyKey: crypto.randomUUID(),
        operations: [...operations],
      });
      return request(
        `${projectBase(projectId)}/design-brief`,
        designBriefSchema,
        jsonMutation(body, body.idempotencyKey),
      );
    },
  });
}

export const consultationClient = createConsultationClient();
