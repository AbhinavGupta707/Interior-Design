import type {
  Actor,
  BriefEntry,
  BriefPatchProposal,
  ConsultationSession,
  DesignBrief,
} from "@interior-design/contracts";

import type { RequestCorrelation } from "../../../src/correlation.js";
import type {
  AppendTurnRepositoryCommand,
  BriefCommandPort,
  CancelSessionRepositoryCommand,
  ConfirmBriefProposalCommand,
  ConsultationTurn,
  CreateSessionRepositoryCommand,
  DesignAgentModelPort,
  DesignAgentModelRequest,
  DesignAgentRepository,
  DesignAgentTelemetry,
  DesignAgentTelemetryEvent,
  DesignAgentUuidFactory,
  ExpireProposalRepositoryCommand,
  FindCreateSessionReplayCommand,
  ProposalConfirmation,
  StoredConsultationTurn,
} from "../../../src/modules/design-agent/index.js";

export const fixtureIds = Object.freeze({
  alphaProject: "11111111-1111-4111-8111-111111111111",
  alphaTenant: "22222222-2222-4222-8222-222222222222",
  alphaUser: "33333333-3333-4333-8333-333333333333",
  betaProject: "44444444-4444-4444-8444-444444444444",
  betaTenant: "55555555-5555-4555-8555-555555555555",
  brief: "66666666-6666-4666-8666-666666666666",
  cancelIdempotency: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  confirmIdempotency: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  entry: "77777777-7777-4777-8777-777777777777",
  idempotency: "88888888-8888-4888-8888-888888888888",
  message: "99999999-9999-4999-8999-999999999999",
  modelRequest: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  proposal: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  secondMessage: "19999999-9999-4999-8999-999999999999",
  secondModelRequest: "1aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  secondProposal: "1bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  session: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
});

export const alphaOwner: Actor = {
  displayName: "Synthetic Alpha Owner",
  role: "owner",
  subject: "fixture|c11-alpha-owner",
  tenantId: fixtureIds.alphaTenant,
  userId: fixtureIds.alphaUser,
};

export const correlation: RequestCorrelation = {
  requestId: "c11-design-agent-request-0001",
  spanId: "a".repeat(16),
  traceId: "b".repeat(32),
  traceParent: `00-${"b".repeat(32)}-${"a".repeat(16)}-01`,
};

export class SequenceUuidFactory implements DesignAgentUuidFactory {
  readonly #values: string[];

  constructor(
    values: readonly string[] = [
      fixtureIds.session,
      fixtureIds.modelRequest,
      fixtureIds.proposal,
      fixtureIds.secondModelRequest,
      fixtureIds.secondProposal,
    ],
  ) {
    this.#values = [...values];
  }

  randomUUID(): string {
    const value = this.#values.shift();
    if (value === undefined) throw new Error("Synthetic UUID sequence exhausted.");
    return value;
  }
}

export class MutableClock {
  current = new Date("2026-07-18T10:00:00.000Z");

  now(): Date {
    return new Date(this.current);
  }
}

export class CapturingTelemetry implements DesignAgentTelemetry {
  readonly events: DesignAgentTelemetryEvent[] = [];

  record(event: DesignAgentTelemetryEvent): void {
    this.events.push(event);
  }
}

export class MemoryBriefCommandPort implements BriefCommandPort {
  readonly #repository: MemoryDesignAgentRepository;
  readonly updateCalls: {
    readonly actor: Actor;
    readonly briefId: string;
    readonly projectId: string;
    readonly request: {
      readonly expectedRevision: number;
      readonly operations: readonly unknown[];
    };
  }[] = [];
  current: DesignBrief = {
    createdAt: "2026-07-18T09:00:00.000Z",
    entries: [],
    id: fixtureIds.brief,
    projectId: fixtureIds.alphaProject,
    referenceBoard: [],
    revision: 1,
    schemaVersion: "c11-design-brief-v1",
    status: "draft",
    updatedAt: "2026-07-18T09:00:00.000Z",
    updatedBy: fixtureIds.alphaUser,
  };

  constructor(repository: MemoryDesignAgentRepository) {
    this.#repository = repository;
  }

  findCurrent(
    tenantId: string,
    projectId: string,
    briefId: string,
  ): Promise<DesignBrief | undefined> {
    return Promise.resolve(
      tenantId === fixtureIds.alphaTenant &&
        projectId === this.current.projectId &&
        briefId === this.current.id
        ? this.current
        : undefined,
    );
  }

  async confirmProposal(command: ConfirmBriefProposalCommand) {
    const confirmationKey = proposalKey(
      command.actor.tenantId,
      command.confirmation.projectId,
      command.confirmation.sessionId,
      command.confirmation.proposalId,
    );
    const existing = this.#repository.confirmations.get(confirmationKey);
    if (existing?.idempotencyKey === command.confirmation.idempotencyKey) {
      const recorded = await this.#repository.commitConfirmation(command);
      return { brief: this.current, ...recorded };
    }
    if (
      command.actor.tenantId !== fixtureIds.alphaTenant ||
      command.projectId !== this.current.projectId ||
      command.confirmation.briefId !== this.current.id ||
      (command.proposal.status === "pending" &&
        command.request.expectedRevision !== this.current.revision)
    ) {
      throw new Error("Synthetic brief command rejected a stale or cross-scope request.");
    }
    const recorded = await this.#repository.commitConfirmation(command);
    this.updateCalls.push({
      actor: command.actor,
      briefId: command.confirmation.briefId,
      projectId: command.projectId,
      request: command.request,
    });
    this.current = {
      ...this.current,
      entries: [
        ...this.current.entries,
        ...command.request.operations.flatMap((operation) =>
          operation.kind === "entry.add" ? [operation.entry] : [],
        ),
      ],
      revision: this.current.revision + 1,
      updatedAt: command.confirmation.confirmedAt,
      updatedBy: command.actor.userId,
    };
    return { brief: this.current, ...recorded };
  }
}

function validEntry(request: DesignAgentModelRequest): BriefEntry {
  return {
    category: "material-colour",
    classification: "preference",
    id: fixtureIds.entry,
    priority: 3,
    provenance: {
      capturedAt: request.input.generatedAt,
      method: "assistant-extracted",
      sourceMessageId: request.input.sourceMessage.id,
    },
    roomOrLevelElementIds: [],
    statement: "Household preference: warm oak.",
    status: "active",
  };
}

export function validModelResult(request: DesignAgentModelRequest): unknown {
  return {
    manifest: {
      adapter: "deterministic-local-v1",
      externalNetworkUsed: false,
      promptRegistryVersion: "c11-brief-consultation-prompts-v1",
      toolRegistryVersion: "c11-brief-tools-v1",
    },
    output: {
      clarifyingQuestions: [],
      operations: [{ entry: validEntry(request), kind: "entry.add" }],
      professionalReview: [],
      summary: "One preference was extracted for explicit confirmation.",
    },
    requestId: request.requestId,
    schemaVersion: "model-gateway-result-v1",
  };
}

export class FakeModelPort implements DesignAgentModelPort {
  readonly requests: DesignAgentModelRequest[] = [];
  handler: (request: DesignAgentModelRequest) => Promise<unknown> = (request) =>
    Promise.resolve(validModelResult(request));

  process(request: DesignAgentModelRequest): Promise<unknown> {
    this.requests.push(request);
    return this.handler(request);
  }
}

interface StoredSession {
  readonly tenantId: string;
  readonly session: ConsultationSession;
}

function scopeKey(tenantId: string, projectId: string, sessionId: string): string {
  return `${tenantId}:${projectId}:${sessionId}`;
}

function proposalKey(
  tenantId: string,
  projectId: string,
  sessionId: string,
  proposalId: string,
): string {
  return `${scopeKey(tenantId, projectId, sessionId)}:${proposalId}`;
}

export class MemoryDesignAgentRepository implements DesignAgentRepository {
  readonly confirmations = new Map<string, ProposalConfirmation>();
  readonly proposals = new Map<string, BriefPatchProposal>();
  readonly sessions = new Map<string, StoredSession>();
  readonly turns = new Map<string, StoredConsultationTurn>();
  readonly #cancelKeys = new Map<string, ConsultationSession>();
  readonly #createKeys = new Map<
    string,
    {
      readonly actorUserId: string;
      readonly hash: string;
      readonly projectId: string;
      readonly session: ConsultationSession;
    }
  >();

  findCreateSessionReplay(
    command: FindCreateSessionReplayCommand,
  ): Promise<ConsultationSession | undefined> {
    const existing = this.#createKeys.get(`${command.tenantId}:${command.idempotencyKey}`);
    if (existing === undefined) return Promise.resolve(undefined);
    if (
      existing.actorUserId !== command.actorUserId ||
      existing.hash !== command.requestSha256 ||
      existing.projectId !== command.projectId
    ) {
      throw new Error("Synthetic idempotency conflict.");
    }
    return Promise.resolve(existing.session);
  }

  createSession(command: CreateSessionRepositoryCommand): Promise<{
    readonly replayed: boolean;
    readonly session: ConsultationSession;
  }> {
    const existing = this.#createKeys.get(`${command.tenantId}:${command.idempotencyKey}`);
    if (existing !== undefined) {
      if (
        existing.actorUserId !== command.session.createdBy ||
        existing.hash !== command.requestSha256 ||
        existing.projectId !== command.session.projectId
      ) {
        throw new Error("Synthetic idempotency conflict.");
      }
      return Promise.resolve({ replayed: true, session: existing.session });
    }
    const key = scopeKey(command.tenantId, command.session.projectId, command.session.id);
    this.sessions.set(key, { session: command.session, tenantId: command.tenantId });
    this.#createKeys.set(`${command.tenantId}:${command.idempotencyKey}`, {
      actorUserId: command.session.createdBy,
      hash: command.requestSha256,
      projectId: command.session.projectId,
      session: command.session,
    });
    return Promise.resolve({ replayed: false, session: command.session });
  }

  findSession(
    tenantId: string,
    projectId: string,
    sessionId: string,
  ): Promise<ConsultationSession | undefined> {
    return Promise.resolve(this.sessions.get(scopeKey(tenantId, projectId, sessionId))?.session);
  }

  cancelSession(command: CancelSessionRepositoryCommand): Promise<{
    readonly replayed: boolean;
    readonly session: ConsultationSession;
  }> {
    const replayKey = `${command.tenantId}:${command.idempotencyKey}`;
    const replay = this.#cancelKeys.get(replayKey);
    if (replay !== undefined) return Promise.resolve({ replayed: true, session: replay });
    const key = scopeKey(command.tenantId, command.projectId, command.sessionId);
    const stored = this.sessions.get(key);
    if (
      stored === undefined ||
      stored.session.turnCount !== command.expectedTurnCount ||
      stored.session.state !== command.expectedSessionState
    ) {
      throw new Error("Synthetic cancellation conflict.");
    }
    const session: ConsultationSession = {
      ...stored.session,
      cancelledAt: command.cancelledAt,
      state: "cancelled",
      updatedAt: command.cancelledAt,
    };
    this.sessions.set(key, { ...stored, session });
    this.#cancelKeys.set(replayKey, session);
    return Promise.resolve({ replayed: false, session });
  }

  findTurnByClientMessageId(
    tenantId: string,
    projectId: string,
    sessionId: string,
    clientMessageId: string,
  ): Promise<StoredConsultationTurn | undefined> {
    return Promise.resolve(
      this.turns.get(`${scopeKey(tenantId, projectId, sessionId)}:${clientMessageId}`),
    );
  }

  appendTurn(command: AppendTurnRepositoryCommand): Promise<{
    readonly replayed: boolean;
    readonly turn: ConsultationTurn;
  }> {
    const sessionKey = [...this.sessions.entries()].find(
      ([, stored]) =>
        stored.tenantId === command.tenantId && stored.session.id === command.message.sessionId,
    )?.[0];
    const stored = sessionKey === undefined ? undefined : this.sessions.get(sessionKey);
    if (
      sessionKey === undefined ||
      stored === undefined ||
      stored.session.projectId !== command.message.projectId ||
      stored.session.state !== "active" ||
      stored.session.turnCount !== command.expectedTurnCount
    ) {
      throw new Error("Synthetic append conflict.");
    }
    const turnKey = `${sessionKey}:${command.message.id}`;
    const prior = this.turns.get(turnKey);
    if (prior !== undefined) {
      if (prior.messageSha256 !== command.messageSha256) {
        throw new Error("Synthetic message conflict.");
      }
      return Promise.resolve({ replayed: true, turn: prior.turn });
    }
    const session: ConsultationSession = {
      ...stored.session,
      turnCount: stored.session.turnCount + 1,
      updatedAt: command.message.createdAt,
    };
    const turn: ConsultationTurn = {
      message: command.message,
      proposal: command.proposal,
      session,
    };
    this.sessions.set(sessionKey, { ...stored, session });
    for (const [key, candidate] of this.proposals) {
      if (key.startsWith(`${sessionKey}:`) && candidate.status === "pending") {
        this.proposals.set(key, { ...candidate, status: "rejected" });
      }
    }
    this.proposals.set(
      proposalKey(
        command.tenantId,
        command.message.projectId,
        command.message.sessionId,
        command.proposal.id,
      ),
      command.proposal,
    );
    this.turns.set(turnKey, {
      createdByUserId: command.actorUserId,
      messageSha256: command.messageSha256,
      turn,
    });
    return Promise.resolve({ replayed: false, turn });
  }

  findProposal(
    tenantId: string,
    projectId: string,
    sessionId: string,
    proposalId: string,
  ): Promise<BriefPatchProposal | undefined> {
    return Promise.resolve(
      this.proposals.get(proposalKey(tenantId, projectId, sessionId, proposalId)),
    );
  }

  expireProposal(command: ExpireProposalRepositoryCommand): Promise<BriefPatchProposal> {
    const key = proposalKey(
      command.tenantId,
      command.projectId,
      command.sessionId,
      command.proposalId,
    );
    const proposal = this.proposals.get(key);
    if (proposal === undefined || proposal.status !== "pending") {
      throw new Error("Synthetic proposal expiry conflict.");
    }
    const expired: BriefPatchProposal = { ...proposal, status: "expired" };
    this.proposals.set(key, expired);
    return Promise.resolve(expired);
  }

  commitConfirmation(command: ConfirmBriefProposalCommand): Promise<{
    readonly proposal: BriefPatchProposal;
    readonly replayed: boolean;
    readonly session: ConsultationSession;
  }> {
    const proposalMapKey = proposalKey(
      command.actor.tenantId,
      command.confirmation.projectId,
      command.confirmation.sessionId,
      command.confirmation.proposalId,
    );
    const sessionMapKey = scopeKey(
      command.actor.tenantId,
      command.confirmation.projectId,
      command.confirmation.sessionId,
    );
    const existingConfirmation = this.confirmations.get(proposalMapKey);
    const existingProposal = this.proposals.get(proposalMapKey);
    const stored = this.sessions.get(sessionMapKey);
    if (
      existingConfirmation !== undefined &&
      existingProposal !== undefined &&
      stored !== undefined &&
      existingConfirmation.idempotencyKey === command.confirmation.idempotencyKey
    ) {
      return Promise.resolve({
        proposal: existingProposal,
        replayed: true,
        session: stored.session,
      });
    }
    if (
      existingProposal === undefined ||
      existingProposal.status !== command.expectedProposalStatus ||
      stored === undefined ||
      stored.session.state !== command.expectedSessionState ||
      stored.session.turnCount !== command.expectedTurnCount
    ) {
      throw new Error("Synthetic proposal confirmation conflict.");
    }
    const proposal: BriefPatchProposal = { ...existingProposal, status: "confirmed" };
    const session: ConsultationSession = {
      ...stored.session,
      state: "completed",
      updatedAt: command.confirmation.confirmedAt,
    };
    this.proposals.set(proposalMapKey, proposal);
    this.sessions.set(sessionMapKey, { ...stored, session });
    this.confirmations.set(proposalMapKey, command.confirmation);
    return Promise.resolve({ proposal, replayed: false, session });
  }

  findConfirmation(
    tenantId: string,
    projectId: string,
    sessionId: string,
    proposalId: string,
  ): Promise<ProposalConfirmation | undefined> {
    return Promise.resolve(
      this.confirmations.get(proposalKey(tenantId, projectId, sessionId, proposalId)),
    );
  }
}
