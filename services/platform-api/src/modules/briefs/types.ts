import type {
  Actor,
  BriefPatchProposal,
  BriefPatchOperation,
  ConsultationSession,
  DesignBrief,
  ReferenceBoardItem,
  UpdateBriefRequest,
} from "@interior-design/contracts";

import type { RequestCorrelation } from "../../correlation.js";

export type BriefRevisionReason = "accepted" | "created" | "reopened" | "updated";

export interface BriefRevisionRecord {
  readonly brief: DesignBrief;
  readonly canonicalByteLength: number;
  readonly contentSha256: string;
  readonly reason: BriefRevisionReason;
  readonly snapshotSha256: string;
}

export interface BriefDomainKernel {
  accept(input: {
    readonly actor: Actor;
    readonly at: string;
    readonly current: DesignBrief;
  }): BriefRevisionRecord;
  create(input: {
    readonly actor: Actor;
    readonly at: string;
    readonly briefId: string;
    readonly operations: readonly BriefPatchOperation[];
    readonly projectId: string;
  }): BriefRevisionRecord;
  revise(input: {
    readonly actor: Actor;
    readonly at: string;
    readonly current: DesignBrief;
    readonly operations: readonly BriefPatchOperation[];
  }): BriefRevisionRecord;
}

export interface BriefClock {
  now(): Date;
}

export interface BriefUuidFactory {
  randomUUID(): string;
}

interface BriefMutationCommand {
  readonly actor: Actor;
  readonly correlation: RequestCorrelation;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly requestSha256: string;
}

export interface UpdateBriefCommand extends BriefMutationCommand {
  readonly operations: readonly BriefPatchOperation[];
}

export type AcceptBriefCommand = BriefMutationCommand;

export interface BriefMutationResult {
  readonly record: BriefRevisionRecord;
  readonly replayed: boolean;
}

export interface BriefProposalConfirmationCommand {
  readonly actor: Actor;
  readonly confirmation: {
    readonly actorUserId: string;
    readonly briefId: string;
    readonly briefRevision: number;
    readonly confirmedAt: string;
    readonly idempotencyKey: string;
    readonly projectId: string;
    readonly proposalId: string;
    readonly sessionId: string;
  };
  readonly correlation: RequestCorrelation;
  readonly expectedProposalStatus: "pending";
  readonly expectedSessionState: "active";
  readonly expectedTurnCount: number;
  readonly projectId: string;
  readonly proposal: BriefPatchProposal;
  readonly update: UpdateBriefRequest;
}

export interface BriefProposalConfirmationResult {
  readonly brief: DesignBrief;
  readonly proposal: BriefPatchProposal;
  readonly replayed: boolean;
  readonly session: ConsultationSession;
}

export interface BriefProposalConfirmationPort {
  confirmProposal(
    command: BriefProposalConfirmationCommand,
  ): Promise<BriefProposalConfirmationResult>;
}

export interface BriefAcceptanceRecord {
  readonly acceptedAt: string;
  readonly acceptedBy: string;
  readonly briefId: string;
  readonly revision: number;
}

export interface BriefAuditRecord {
  readonly action: "brief.accept" | "brief.create" | "brief.reopen" | "brief.update";
  readonly actorUserId: string;
  readonly contentSha256: string;
  readonly occurredAt: string;
  readonly projectId: string;
  readonly requestId: string;
  readonly revision: number;
  readonly tenantId: string;
  readonly traceId: string;
}

export interface BriefRepository {
  accept(command: AcceptBriefCommand): Promise<BriefMutationResult>;
  findCurrent(tenantId: string, projectId: string): Promise<BriefRevisionRecord | undefined>;
  listAcceptances(tenantId: string, projectId: string): Promise<readonly BriefAcceptanceRecord[]>;
  listAudit(tenantId: string, projectId: string): Promise<readonly BriefAuditRecord[]>;
  listHistory(tenantId: string, projectId: string): Promise<readonly BriefRevisionRecord[]>;
  update(command: UpdateBriefCommand): Promise<BriefMutationResult>;
}

export interface VerifiedBriefAsset {
  readonly assetId: string;
  readonly projectId: string;
  readonly rightsRecordSha256: string;
  readonly serviceProcessingConsent: boolean;
  readonly sourceSha256: string;
  readonly status: string;
  readonly tenantId: string;
  readonly trainingUseConsent: string;
}

export interface VerifiedBriefSnapshot {
  readonly projectId: string;
  readonly snapshotId: string;
  readonly snapshotSha256: string;
  readonly tenantId: string;
}

export interface VerifiedBriefMessage {
  readonly contentSha256: string;
  readonly createdAt: string;
  readonly createdByUserId?: string;
  readonly messageId: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly tenantId: string;
}

export interface BriefSourceVerifier {
  findAsset(
    tenantId: string,
    projectId: string,
    assetId: string,
  ): Promise<VerifiedBriefAsset | undefined>;
  findSnapshot(
    tenantId: string,
    projectId: string,
    snapshotId: string,
  ): Promise<VerifiedBriefSnapshot | undefined>;
  findMessage(
    tenantId: string,
    projectId: string,
    messageId: string,
  ): Promise<VerifiedBriefMessage | undefined>;
}

export interface BriefTelemetry {
  record(event: {
    readonly entryCount: number;
    readonly outcome: "accepted" | "conflict" | "failed" | "replayed";
    readonly referenceCount: number;
    readonly stage: "accept" | "read" | "update";
  }): void;
}

export interface BriefReferenceExpectation {
  readonly assetId: string;
  readonly rightsRecordSha256: ReferenceBoardItem["rightsRecordSha256"];
}
