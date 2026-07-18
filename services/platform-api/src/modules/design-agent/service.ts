import {
  briefPatchProposalSchema,
  c11BriefPolicy,
  confirmBriefPatchProposalRequestSchema,
  consultationSessionSchema,
  createConsultationSessionRequestSchema,
  designBriefSchema,
  submitConsultationTurnRequestSchema,
  updateBriefRequestSchema,
  type BriefPatchProposal,
  type ConsultationSession,
} from "@interior-design/contracts";
import { randomUUID } from "node:crypto";
import { z, type ZodType } from "zod";

import { notFound } from "../identity/http.js";
import { requestHash } from "../projects/idempotency.js";
import {
  designAgentCancelled,
  designAgentConflict,
  designAgentInvalid,
  designAgentInvalidModelOutput,
  designAgentTimeout,
  designAgentUnavailable,
} from "./errors.js";
import { parseDesignAgentModelOutput } from "./model-output.js";
import { designAgentTelemetry } from "./telemetry.js";
import type {
  BriefCommandPort,
  CancelConsultationSessionCommand,
  ConfirmConsultationProposalCommand,
  ConfirmedConsultationProposal,
  ConsultationTurn,
  CreateConsultationSessionCommand,
  DesignAgentClock,
  DesignAgentModelPort,
  DesignAgentModelRequest,
  DesignAgentRepository,
  DesignAgentTelemetry,
  DesignAgentTelemetryEvent,
  DesignAgentUuidFactory,
  ProposalConfirmation,
  SubmitConsultationTurnCommand,
} from "./types.js";

const systemClock: DesignAgentClock = { now: () => new Date() };
const systemUuidFactory: DesignAgentUuidFactory = { randomUUID };
const cancelIdempotencySchema = z.uuid();
const modelTimeoutMs = 2_000;
const persistedTurnSchema = z
  .object({
    message: z
      .object({
        body: z.string().trim().min(1).max(c11BriefPolicy.maximumUserMessageCharacters),
        createdAt: z.iso.datetime({ offset: true }),
        id: z.uuid(),
        projectId: z.uuid(),
        sender: z.literal("household"),
        sessionId: z.uuid(),
      })
      .strict(),
    proposal: briefPatchProposalSchema,
    session: consultationSessionSchema,
  })
  .strict();
function safeParse<T>(schema: ZodType<T>, value: unknown, code: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw designAgentInvalid(code, "The consultation request did not match the frozen schema.");
  }
  return result.data;
}

function exactDraftBrief(
  brief: ReturnType<typeof designBriefSchema.parse> | undefined,
  projectId: string,
  briefId: string,
  revision: number,
): ReturnType<typeof designBriefSchema.parse> {
  if (brief === undefined) throw notFound();
  const parsed = designBriefSchema.safeParse(brief);
  if (!parsed.success) {
    throw designAgentUnavailable(
      "DESIGN_AGENT_BRIEF_INVALID",
      "The current brief projection is invalid.",
    );
  }
  if (parsed.data.id !== briefId || parsed.data.projectId !== projectId) {
    throw notFound();
  }
  if (parsed.data.revision !== revision) {
    throw designAgentConflict(
      "DESIGN_AGENT_STALE_BRIEF",
      "The consultation base brief revision is no longer current.",
    );
  }
  if (parsed.data.status !== "draft") {
    throw designAgentConflict(
      "DESIGN_AGENT_BRIEF_NOT_DRAFT",
      "Only a current draft brief can receive consultation proposals.",
    );
  }
  return parsed.data;
}

function timestampAfter(now: Date, ...lowerBounds: readonly string[]): Date {
  const lowerBound = Math.max(...lowerBounds.map((value) => Date.parse(value)));
  return now.getTime() > lowerBound ? now : new Date(lowerBound + 1);
}

function adapterFor(session: ConsultationSession): DesignAgentTelemetryEvent["adapter"] {
  return session.providerMode === "deterministic-local"
    ? "deterministic-local-v1"
    : "external-disabled";
}

function emptyTelemetry(
  stage: DesignAgentTelemetryEvent["stage"],
  adapter: DesignAgentTelemetryEvent["adapter"],
  outcome: DesignAgentTelemetryEvent["outcome"],
  durationMs = 0,
): DesignAgentTelemetryEvent {
  return {
    adapter,
    clarificationCount: 0,
    durationMs,
    operationCount: 0,
    outcome,
    professionalReviewCount: 0,
    stage,
  };
}

function modelSafeCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("safeCode" in error)) return undefined;
  return typeof error.safeCode === "string" ? error.safeCode : undefined;
}

function mapModelError(error: unknown): never {
  const safeCode = modelSafeCode(error);
  switch (safeCode) {
    case "MODEL_CANCELLED":
      throw designAgentCancelled();
    case "MODEL_TIMEOUT":
      throw designAgentTimeout();
    case "MODEL_INVALID_OUTPUT":
      throw designAgentInvalidModelOutput();
    case "MODEL_INVALID_REQUEST":
    case "MODEL_RESOURCE_LIMIT":
      throw designAgentInvalid(
        "DESIGN_AGENT_MODEL_REQUEST_REJECTED",
        "The bounded local model request was rejected.",
      );
    case "MODEL_ADAPTER_DISABLED":
      throw designAgentUnavailable(
        "DESIGN_AGENT_EXTERNAL_DISABLED",
        "External consultation providers are disabled.",
      );
    default:
      throw designAgentUnavailable(
        "DESIGN_AGENT_LOCAL_UNAVAILABLE",
        "The deterministic local consultation capability is unavailable.",
      );
  }
}

function validateSession(value: ConsultationSession): ConsultationSession {
  const result = consultationSessionSchema.safeParse(value);
  if (!result.success) {
    throw designAgentUnavailable(
      "DESIGN_AGENT_SESSION_INVALID",
      "The persisted consultation session is invalid.",
    );
  }
  return result.data;
}

function validateProposal(value: BriefPatchProposal): BriefPatchProposal {
  const result = briefPatchProposalSchema.safeParse(value);
  if (!result.success) {
    throw designAgentUnavailable(
      "DESIGN_AGENT_PROPOSAL_INVALID",
      "The persisted consultation proposal is invalid.",
    );
  }
  return result.data;
}

function validateTurn(value: ConsultationTurn): ConsultationTurn {
  const result = persistedTurnSchema.safeParse(value);
  if (!result.success) {
    throw designAgentUnavailable(
      "DESIGN_AGENT_TURN_INVALID",
      "The persisted consultation turn is invalid.",
    );
  }
  const { message, proposal, session } = result.data;
  if (
    message.projectId !== session.projectId ||
    message.sessionId !== session.id ||
    proposal.projectId !== session.projectId ||
    proposal.sessionId !== session.id ||
    proposal.sourceMessageId !== message.id ||
    proposal.baseBriefId !== session.baseBriefId ||
    proposal.baseBriefRevision !== session.baseBriefRevision
  ) {
    throw designAgentUnavailable(
      "DESIGN_AGENT_TURN_SCOPE_INVALID",
      "The persisted consultation turn has inconsistent scope.",
    );
  }
  return result.data;
}

function exactCreatedSession(
  session: ConsultationSession,
  input: {
    readonly actorUserId: string;
    readonly baseBriefId: string;
    readonly baseBriefRevision: number;
    readonly projectId: string;
    readonly providerMode: ConsultationSession["providerMode"];
  },
): ConsultationSession {
  const persisted = validateSession(session);
  if (
    persisted.createdBy !== input.actorUserId ||
    persisted.baseBriefId !== input.baseBriefId ||
    persisted.baseBriefRevision !== input.baseBriefRevision ||
    persisted.projectId !== input.projectId ||
    persisted.providerMode !== input.providerMode
  ) {
    throw designAgentUnavailable(
      "DESIGN_AGENT_SESSION_SCOPE_INVALID",
      "The persisted consultation session has inconsistent scope.",
    );
  }
  return persisted;
}

export class DesignAgentService {
  readonly #briefs: BriefCommandPort;
  readonly #clock: DesignAgentClock;
  readonly #model: DesignAgentModelPort;
  readonly #repository: DesignAgentRepository;
  readonly #telemetry: DesignAgentTelemetry;
  readonly #uuid: DesignAgentUuidFactory;

  constructor(options: {
    readonly briefs: BriefCommandPort;
    readonly clock?: DesignAgentClock;
    readonly model: DesignAgentModelPort;
    readonly repository: DesignAgentRepository;
    readonly telemetry?: DesignAgentTelemetry;
    readonly uuid?: DesignAgentUuidFactory;
  }) {
    this.#briefs = options.briefs;
    this.#clock = options.clock ?? systemClock;
    this.#model = options.model;
    this.#repository = options.repository;
    this.#telemetry = options.telemetry ?? designAgentTelemetry;
    this.#uuid = options.uuid ?? systemUuidFactory;
  }

  async createSession(
    command: CreateConsultationSessionCommand,
  ): Promise<{ readonly replayed: boolean; readonly session: ConsultationSession }> {
    const request = safeParse(
      createConsultationSessionRequestSchema,
      command.request,
      "DESIGN_AGENT_CREATE_INVALID",
    );
    const requestSha256 = requestHash(request);
    const replay = await this.#repository.findCreateSessionReplay({
      actorUserId: command.actor.userId,
      idempotencyKey: request.idempotencyKey,
      projectId: command.projectId,
      requestSha256,
      tenantId: command.actor.tenantId,
    });
    if (replay !== undefined) {
      const persisted = exactCreatedSession(replay, {
        actorUserId: command.actor.userId,
        baseBriefId: request.baseBriefId,
        baseBriefRevision: request.baseBriefRevision,
        projectId: command.projectId,
        providerMode: request.providerMode,
      });
      this.#telemetry.record(emptyTelemetry("session-create", adapterFor(persisted), "replayed"));
      return { replayed: true, session: persisted };
    }
    await this.requireExactBrief(
      command.actor.tenantId,
      command.projectId,
      request.baseBriefId,
      request.baseBriefRevision,
    );
    const now = this.#clock.now().toISOString();
    const session = consultationSessionSchema.parse({
      baseBriefId: request.baseBriefId,
      baseBriefRevision: request.baseBriefRevision,
      createdAt: now,
      createdBy: command.actor.userId,
      id: this.#uuid.randomUUID(),
      projectId: command.projectId,
      providerMode: request.providerMode,
      schemaVersion: "c11-consultation-session-v1",
      state: "active",
      turnCount: 0,
      updatedAt: now,
    });
    const result = await this.#repository.createSession({
      idempotencyKey: request.idempotencyKey,
      requestSha256,
      session,
      tenantId: command.actor.tenantId,
    });
    const persisted = exactCreatedSession(result.session, {
      actorUserId: command.actor.userId,
      baseBriefId: request.baseBriefId,
      baseBriefRevision: request.baseBriefRevision,
      projectId: command.projectId,
      providerMode: request.providerMode,
    });
    this.#telemetry.record(
      emptyTelemetry(
        "session-create",
        adapterFor(persisted),
        result.replayed ? "replayed" : "accepted",
      ),
    );
    return { replayed: result.replayed, session: persisted };
  }

  async getSession(
    tenantId: string,
    projectId: string,
    sessionId: string,
  ): Promise<ConsultationSession> {
    const session = await this.#repository.findSession(tenantId, projectId, sessionId);
    if (session === undefined) throw notFound();
    const validated = validateSession(session);
    if (validated.projectId !== projectId || validated.id !== sessionId) throw notFound();
    return validated;
  }

  async cancelSession(
    command: CancelConsultationSessionCommand,
  ): Promise<{ readonly replayed: boolean; readonly session: ConsultationSession }> {
    const idempotencyKey = safeParse(
      cancelIdempotencySchema,
      command.idempotencyKey,
      "DESIGN_AGENT_CANCEL_INVALID",
    );
    const session = await this.getSession(
      command.actor.tenantId,
      command.projectId,
      command.sessionId,
    );
    if (session.state === "completed") {
      throw designAgentConflict(
        "DESIGN_AGENT_SESSION_COMPLETED",
        "A completed consultation cannot be cancelled.",
      );
    }
    const result = await this.#repository.cancelSession({
      actorUserId: command.actor.userId,
      cancelledAt: timestampAfter(this.#clock.now(), session.updatedAt).toISOString(),
      correlation: command.correlation,
      expectedTurnCount: session.turnCount,
      expectedSessionState: "active",
      idempotencyKey,
      projectId: command.projectId,
      sessionId: command.sessionId,
      tenantId: command.actor.tenantId,
    });
    const persisted = validateSession(result.session);
    if (
      persisted.id !== command.sessionId ||
      persisted.projectId !== command.projectId ||
      persisted.state !== "cancelled"
    ) {
      throw designAgentUnavailable(
        "DESIGN_AGENT_SESSION_SCOPE_INVALID",
        "The cancelled consultation session has inconsistent scope.",
      );
    }
    this.#telemetry.record(
      emptyTelemetry(
        "session-cancel",
        adapterFor(persisted),
        result.replayed ? "replayed" : "cancelled",
      ),
    );
    return { replayed: result.replayed, session: persisted };
  }

  async submitTurn(
    command: SubmitConsultationTurnCommand,
  ): Promise<{ readonly replayed: boolean; readonly turn: ConsultationTurn }> {
    const request = safeParse(
      submitConsultationTurnRequestSchema,
      command.request,
      "DESIGN_AGENT_TURN_INVALID",
    );
    const session = await this.getSession(
      command.actor.tenantId,
      command.projectId,
      command.sessionId,
    );
    const messageSha256 = requestHash({ message: request.message });
    const existing = await this.#repository.findTurnByClientMessageId(
      command.actor.tenantId,
      command.projectId,
      command.sessionId,
      request.clientMessageId,
    );
    if (existing !== undefined) {
      if (
        existing.createdByUserId !== command.actor.userId ||
        existing.messageSha256 !== messageSha256
      ) {
        throw designAgentConflict(
          "DESIGN_AGENT_MESSAGE_ID_CONFLICT",
          "The client message ID was already used by another message command.",
        );
      }
      this.#telemetry.record(emptyTelemetry("turn", adapterFor(session), "replayed"));
      return { replayed: true, turn: validateTurn(existing.turn) };
    }
    if (session.state !== "active") {
      throw designAgentConflict(
        "DESIGN_AGENT_SESSION_INACTIVE",
        "Only an active consultation can accept a message.",
      );
    }
    if (session.turnCount >= c11BriefPolicy.maximumConsultationTurns) {
      throw designAgentInvalid(
        "DESIGN_AGENT_TURN_LIMIT",
        "The consultation reached its safe turn limit.",
      );
    }
    if (request.expectedBriefRevision !== session.baseBriefRevision) {
      throw designAgentConflict(
        "DESIGN_AGENT_STALE_BRIEF",
        "The message expected a different brief revision.",
      );
    }
    const currentBrief = await this.requireExactBrief(
      command.actor.tenantId,
      command.projectId,
      session.baseBriefId,
      session.baseBriefRevision,
    );
    if (session.providerMode === "external-disabled") {
      this.#telemetry.record({
        ...emptyTelemetry("turn", "external-disabled", "failed"),
        safeCode: "MODEL_ADAPTER_DISABLED",
      });
      throw designAgentUnavailable(
        "DESIGN_AGENT_EXTERNAL_DISABLED",
        "External consultation providers are disabled and no network request was attempted.",
      );
    }

    const generatedAt = timestampAfter(this.#clock.now(), session.updatedAt);
    const modelRequest: DesignAgentModelRequest = {
      adapterId: "deterministic-local-v1",
      input: {
        currentBriefEntries: currentBrief.entries.map((entry) => ({
          category: entry.category,
          classification: entry.classification,
          id: entry.id,
          statement: entry.statement,
          status: entry.status,
        })),
        evidenceExcerpts: [],
        generatedAt: generatedAt.toISOString(),
        sourceMessage: { id: request.clientMessageId, text: request.message },
      },
      limits: { timeoutMs: modelTimeoutMs },
      promptId: "c11-consultation-extract-v1",
      requestId: this.#uuid.randomUUID(),
      schemaVersion: "model-gateway-request-v1",
      toolId: "c11.propose-brief-patch-v1",
    };
    const startedAt = Date.now();
    let candidate: unknown;
    try {
      candidate = await this.#model.process(
        modelRequest,
        command.signal === undefined ? {} : { signal: command.signal },
      );
    } catch (error) {
      const safeCode = modelSafeCode(error) ?? "MODEL_INTERNAL_ERROR";
      this.#telemetry.record({
        ...emptyTelemetry(
          "turn",
          "deterministic-local-v1",
          safeCode === "MODEL_CANCELLED" ? "cancelled" : "failed",
          Math.max(0, Date.now() - startedAt),
        ),
        safeCode,
      });
      mapModelError(error);
    }

    let modelResult: ReturnType<typeof parseDesignAgentModelOutput>;
    try {
      modelResult = parseDesignAgentModelOutput(candidate);
    } catch {
      this.#telemetry.record({
        ...emptyTelemetry(
          "turn",
          "deterministic-local-v1",
          "failed",
          Math.max(0, Date.now() - startedAt),
        ),
        safeCode: "MODEL_INVALID_OUTPUT",
      });
      throw designAgentInvalidModelOutput();
    }
    if (modelResult.requestId !== modelRequest.requestId) {
      throw designAgentInvalidModelOutput();
    }

    const proposal = briefPatchProposalSchema.parse({
      baseBriefId: session.baseBriefId,
      baseBriefRevision: session.baseBriefRevision,
      clarifyingQuestions: modelResult.output.clarifyingQuestions,
      createdAt: generatedAt.toISOString(),
      expiresAt: new Date(
        generatedAt.getTime() + c11BriefPolicy.consultationProposalTtlSeconds * 1_000,
      ).toISOString(),
      id: this.#uuid.randomUUID(),
      operations: modelResult.output.operations,
      professionalReview: modelResult.output.professionalReview,
      projectId: command.projectId,
      providerManifest: modelResult.manifest,
      schemaVersion: "c11-brief-patch-proposal-v1",
      sessionId: session.id,
      sourceMessageId: request.clientMessageId,
      status: "pending",
      summary: modelResult.output.summary,
    });
    const result = await this.#repository.appendTurn({
      actorUserId: command.actor.userId,
      expectedTurnCount: session.turnCount,
      message: {
        body: request.message,
        createdAt: generatedAt.toISOString(),
        id: request.clientMessageId,
        projectId: command.projectId,
        sender: "household",
        sessionId: session.id,
      },
      messageSha256,
      proposal,
      tenantId: command.actor.tenantId,
    });
    const turn = validateTurn(result.turn);
    this.#telemetry.record({
      adapter: "deterministic-local-v1",
      clarificationCount: proposal.clarifyingQuestions.length,
      durationMs: Math.max(0, Date.now() - startedAt),
      operationCount: proposal.operations.length,
      outcome: proposal.professionalReview.length > 0 ? "review-required" : "accepted",
      professionalReviewCount: proposal.professionalReview.length,
      stage: "turn",
    });
    return { replayed: result.replayed, turn };
  }

  async getProposal(
    tenantId: string,
    projectId: string,
    sessionId: string,
    proposalId: string,
  ): Promise<BriefPatchProposal> {
    const session = await this.getSession(tenantId, projectId, sessionId);
    const found = await this.#repository.findProposal(tenantId, projectId, sessionId, proposalId);
    if (found === undefined) throw notFound();
    if (session.providerMode !== "deterministic-local") {
      throw designAgentUnavailable(
        "DESIGN_AGENT_PROVIDER_SCOPE_INVALID",
        "A disabled external-provider session cannot contain a proposal.",
      );
    }
    let proposal = validateProposal(found);
    if (
      proposal.projectId !== projectId ||
      proposal.sessionId !== session.id ||
      proposal.id !== proposalId
    ) {
      throw notFound();
    }
    if (
      proposal.status === "pending" &&
      Date.parse(proposal.expiresAt) <= this.#clock.now().getTime()
    ) {
      proposal = validateProposal(
        await this.#repository.expireProposal({
          expiredAt: this.#clock.now().toISOString(),
          projectId,
          proposalId,
          sessionId,
          tenantId,
        }),
      );
      this.#telemetry.record(emptyTelemetry("proposal-expire", adapterFor(session), "accepted"));
    } else {
      this.#telemetry.record(emptyTelemetry("proposal-read", adapterFor(session), "accepted"));
    }
    return proposal;
  }

  async confirmProposal(
    command: ConfirmConsultationProposalCommand,
  ): Promise<ConfirmedConsultationProposal> {
    const request = safeParse(
      confirmBriefPatchProposalRequestSchema,
      command.request,
      "DESIGN_AGENT_CONFIRM_INVALID",
    );
    const session = await this.getSession(
      command.actor.tenantId,
      command.projectId,
      command.sessionId,
    );
    const proposal = await this.getProposal(
      command.actor.tenantId,
      command.projectId,
      command.sessionId,
      command.proposalId,
    );
    if (proposal.status === "expired") {
      throw designAgentConflict(
        "DESIGN_AGENT_PROPOSAL_EXPIRED",
        "The consultation proposal expired and must be regenerated.",
      );
    }
    if (proposal.status !== "pending" && proposal.status !== "confirmed") {
      throw designAgentConflict(
        "DESIGN_AGENT_PROPOSAL_INACTIVE",
        "Only a pending consultation proposal can be confirmed.",
      );
    }
    if (proposal.status === "pending" && session.state !== "active") {
      throw designAgentConflict(
        "DESIGN_AGENT_SESSION_INACTIVE",
        "The consultation session is not active.",
      );
    }
    if (
      proposal.projectId !== command.projectId ||
      proposal.sessionId !== session.id ||
      proposal.baseBriefId !== session.baseBriefId ||
      proposal.baseBriefRevision !== session.baseBriefRevision ||
      request.expectedBriefRevision !== proposal.baseBriefRevision
    ) {
      throw designAgentConflict(
        "DESIGN_AGENT_PROPOSAL_SCOPE_MISMATCH",
        "The proposal no longer matches its project, session or exact base brief.",
      );
    }
    if (proposal.operations.length === 0) {
      throw designAgentInvalid(
        "DESIGN_AGENT_PROPOSAL_HAS_NO_PATCH",
        "A clarification or review-only proposal has no brief patch to confirm.",
      );
    }
    if (proposal.status === "pending") {
      await this.requireExactBrief(
        command.actor.tenantId,
        command.projectId,
        proposal.baseBriefId,
        proposal.baseBriefRevision,
      );
    }
    const updateRequest = updateBriefRequestSchema.parse({
      expectedRevision: request.expectedBriefRevision,
      idempotencyKey: request.idempotencyKey,
      operations: proposal.operations,
    });
    const confirmation: ProposalConfirmation = {
      actorUserId: command.actor.userId,
      briefId: proposal.baseBriefId,
      briefRevision: proposal.baseBriefRevision + 1,
      confirmedAt: timestampAfter(
        this.#clock.now(),
        session.updatedAt,
        proposal.createdAt,
      ).toISOString(),
      idempotencyKey: request.idempotencyKey,
      projectId: command.projectId,
      proposalId: proposal.id,
      sessionId: session.id,
    };
    const recorded = await this.#briefs.confirmProposal({
      actor: command.actor,
      confirmation,
      correlation: command.correlation,
      expectedProposalStatus: "pending",
      expectedSessionState: "active",
      expectedTurnCount: session.turnCount,
      projectId: command.projectId,
      proposal: briefPatchProposalSchema.parse({ ...proposal, status: "pending" }),
      request: updateRequest,
    });
    const updatedBrief = designBriefSchema.safeParse(recorded.brief);
    if (
      !updatedBrief.success ||
      updatedBrief.data.id !== proposal.baseBriefId ||
      updatedBrief.data.projectId !== command.projectId ||
      updatedBrief.data.revision !== proposal.baseBriefRevision + 1 ||
      updatedBrief.data.status !== "draft"
    ) {
      throw designAgentUnavailable(
        "DESIGN_AGENT_BRIEF_COMMAND_INVALID",
        "The brief command returned an invalid revision result.",
      );
    }
    const confirmed = validateProposal(recorded.proposal);
    const completedSession = validateSession(recorded.session);
    if (
      confirmed.status !== "confirmed" ||
      confirmed.id !== proposal.id ||
      confirmed.projectId !== command.projectId ||
      confirmed.sessionId !== command.sessionId ||
      confirmed.baseBriefId !== proposal.baseBriefId ||
      confirmed.baseBriefRevision !== proposal.baseBriefRevision ||
      completedSession.state !== "completed" ||
      completedSession.id !== command.sessionId ||
      completedSession.projectId !== command.projectId ||
      completedSession.baseBriefId !== proposal.baseBriefId ||
      completedSession.baseBriefRevision !== proposal.baseBriefRevision ||
      (proposal.status === "confirmed" && !recorded.replayed)
    ) {
      throw designAgentUnavailable(
        "DESIGN_AGENT_CONFIRMATION_INVALID",
        "The proposal confirmation was not recorded atomically.",
      );
    }
    this.#telemetry.record(
      emptyTelemetry(
        "proposal-confirm",
        adapterFor(session),
        recorded.replayed ? "replayed" : "accepted",
      ),
    );
    return {
      brief: updatedBrief.data,
      briefRevision: updatedBrief.data.revision,
      proposal: confirmed,
      replayed: recorded.replayed,
    };
  }

  private async requireExactBrief(
    tenantId: string,
    projectId: string,
    briefId: string,
    revision: number,
  ): Promise<ReturnType<typeof designBriefSchema.parse>> {
    const brief = await this.#briefs.findCurrent(tenantId, projectId, briefId);
    return exactDraftBrief(brief, projectId, briefId, revision);
  }
}
