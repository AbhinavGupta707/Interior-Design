import type {
  Actor,
  BriefEntry,
  BriefPatchOperation,
  BriefPatchProposal,
  ConsultationSession,
  DesignBrief,
  UpdateBriefRequest,
} from "@interior-design/contracts";

import type { RequestCorrelation } from "../../correlation.js";

export interface DesignAgentClock {
  now(): Date;
}

export interface DesignAgentUuidFactory {
  randomUUID(): string;
}

export interface ConsultationMessage {
  readonly body: string;
  readonly createdAt: string;
  readonly id: string;
  readonly projectId: string;
  readonly sender: "household";
  readonly sessionId: string;
}

export interface ConsultationTurn {
  readonly message: ConsultationMessage;
  readonly proposal: BriefPatchProposal;
  readonly session: ConsultationSession;
}

export interface BriefCommandPort {
  confirmProposal(command: ConfirmBriefProposalCommand): Promise<{
    readonly brief: DesignBrief;
    readonly proposal: BriefPatchProposal;
    readonly replayed: boolean;
    readonly session: ConsultationSession;
  }>;
  findCurrent(
    tenantId: string,
    projectId: string,
    briefId: string,
  ): Promise<DesignBrief | undefined>;
}

export interface DesignAgentModelRequest {
  readonly adapterId: "deterministic-local-v1";
  readonly input: {
    readonly currentBriefEntries: readonly {
      readonly category: BriefEntry["category"];
      readonly classification: BriefEntry["classification"];
      readonly id: string;
      readonly statement: string;
      readonly status: BriefEntry["status"];
    }[];
    readonly evidenceExcerpts: readonly [];
    readonly generatedAt: string;
    readonly sourceMessage: { readonly id: string; readonly text: string };
  };
  readonly limits: { readonly timeoutMs: number };
  readonly promptId: "c11-consultation-extract-v1";
  readonly requestId: string;
  readonly schemaVersion: "model-gateway-request-v1";
  readonly toolId: "c11.propose-brief-patch-v1";
}

export interface DesignAgentModelPort {
  process(
    request: DesignAgentModelRequest,
    options: { readonly signal?: AbortSignal },
  ): Promise<unknown>;
}

export interface CreateConsultationSessionCommand {
  readonly actor: Actor;
  readonly correlation: RequestCorrelation;
  readonly projectId: string;
  readonly request: unknown;
}

export interface CancelConsultationSessionCommand {
  readonly actor: Actor;
  readonly correlation: RequestCorrelation;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly sessionId: string;
}

export interface SubmitConsultationTurnCommand {
  readonly actor: Actor;
  readonly correlation: RequestCorrelation;
  readonly projectId: string;
  readonly request: unknown;
  readonly sessionId: string;
  readonly signal?: AbortSignal;
}

export interface ConfirmConsultationProposalCommand {
  readonly actor: Actor;
  readonly correlation: RequestCorrelation;
  readonly projectId: string;
  readonly proposalId: string;
  readonly request: unknown;
  readonly sessionId: string;
}

export interface CreateSessionRepositoryCommand {
  readonly idempotencyKey: string;
  readonly requestSha256: string;
  readonly session: ConsultationSession;
  readonly tenantId: string;
}

export interface FindCreateSessionReplayCommand {
  readonly actorUserId: string;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly requestSha256: string;
  readonly tenantId: string;
}

export interface CancelSessionRepositoryCommand {
  readonly actorUserId: string;
  readonly cancelledAt: string;
  readonly correlation: RequestCorrelation;
  readonly expectedTurnCount: number;
  readonly expectedSessionState: "active";
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly tenantId: string;
}

export interface AppendTurnRepositoryCommand {
  readonly actorUserId: string;
  readonly expectedTurnCount: number;
  readonly message: ConsultationMessage;
  readonly messageSha256: string;
  readonly proposal: BriefPatchProposal;
  readonly tenantId: string;
}

export interface StoredConsultationTurn {
  readonly createdByUserId: string;
  readonly messageSha256: string;
  readonly turn: ConsultationTurn;
}

export interface ProposalConfirmation {
  readonly actorUserId: string;
  readonly briefId: string;
  readonly briefRevision: number;
  readonly confirmedAt: string;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly proposalId: string;
  readonly sessionId: string;
}

export interface ConfirmBriefProposalCommand {
  readonly actor: Actor;
  readonly correlation: RequestCorrelation;
  readonly confirmation: ProposalConfirmation;
  readonly expectedProposalStatus: "pending";
  readonly expectedSessionState: "active";
  readonly expectedTurnCount: number;
  readonly projectId: string;
  readonly proposal: BriefPatchProposal;
  readonly request: UpdateBriefRequest;
}

export interface ExpireProposalRepositoryCommand {
  readonly expiredAt: string;
  readonly projectId: string;
  readonly proposalId: string;
  readonly sessionId: string;
  readonly tenantId: string;
}

export interface DesignAgentRepository {
  appendTurn(
    command: AppendTurnRepositoryCommand,
  ): Promise<{ readonly replayed: boolean; readonly turn: ConsultationTurn }>;
  cancelSession(
    command: CancelSessionRepositoryCommand,
  ): Promise<{ readonly replayed: boolean; readonly session: ConsultationSession }>;
  createSession(
    command: CreateSessionRepositoryCommand,
  ): Promise<{ readonly replayed: boolean; readonly session: ConsultationSession }>;
  expireProposal(command: ExpireProposalRepositoryCommand): Promise<BriefPatchProposal>;
  findCreateSessionReplay(
    command: FindCreateSessionReplayCommand,
  ): Promise<ConsultationSession | undefined>;
  findConfirmation(
    tenantId: string,
    projectId: string,
    sessionId: string,
    proposalId: string,
  ): Promise<ProposalConfirmation | undefined>;
  findProposal(
    tenantId: string,
    projectId: string,
    sessionId: string,
    proposalId: string,
  ): Promise<BriefPatchProposal | undefined>;
  findSession(
    tenantId: string,
    projectId: string,
    sessionId: string,
  ): Promise<ConsultationSession | undefined>;
  findTurnByClientMessageId(
    tenantId: string,
    projectId: string,
    sessionId: string,
    clientMessageId: string,
  ): Promise<StoredConsultationTurn | undefined>;
}

export interface ConfirmedConsultationProposal {
  readonly brief: DesignBrief;
  readonly briefRevision: number;
  readonly proposal: BriefPatchProposal;
  readonly replayed: boolean;
}

export type DesignAgentTelemetryStage =
  | "session-create"
  | "session-cancel"
  | "turn"
  | "proposal-read"
  | "proposal-expire"
  | "proposal-confirm";

export interface DesignAgentTelemetryEvent {
  readonly adapter: "deterministic-local-v1" | "external-disabled";
  readonly clarificationCount: number;
  readonly durationMs: number;
  readonly operationCount: number;
  readonly outcome: "accepted" | "cancelled" | "failed" | "replayed" | "review-required";
  readonly professionalReviewCount: number;
  readonly safeCode?: string;
  readonly stage: DesignAgentTelemetryStage;
}

export interface DesignAgentTelemetry {
  record(event: DesignAgentTelemetryEvent): void;
}

export interface ValidatedDesignAgentModelOutput {
  readonly manifest: {
    readonly adapter: "deterministic-local-v1";
    readonly externalNetworkUsed: false;
    readonly promptRegistryVersion: "c11-brief-consultation-prompts-v1";
    readonly toolRegistryVersion: "c11-brief-tools-v1";
  };
  readonly output: {
    readonly clarifyingQuestions: readonly string[];
    readonly operations: readonly BriefPatchOperation[];
    readonly professionalReview: readonly {
      readonly question: string;
      readonly reason: BriefPatchProposal["professionalReview"][number]["reason"];
      readonly status: BriefPatchProposal["professionalReview"][number]["status"];
    }[];
    readonly summary: string;
  };
  readonly requestId: string;
  readonly schemaVersion: "model-gateway-result-v1";
}
