import {
  acceptBriefRequestSchema,
  briefPatchProposalSchema,
  designBriefSchema,
  updateBriefRequestSchema,
  type BriefPatchOperation,
  type DesignBrief,
} from "@interior-design/contracts";

import { notFound } from "../identity/http.js";
import { requestHash } from "../projects/idempotency.js";
import { briefConflict } from "./errors.js";
import { briefTelemetry } from "./telemetry.js";
import type {
  AcceptBriefCommand,
  BriefRepository,
  BriefProposalConfirmationCommand,
  BriefProposalConfirmationPort,
  BriefSourceVerifier,
  BriefTelemetry,
  UpdateBriefCommand,
  VerifiedBriefMessage,
} from "./types.js";

function assetsFromOperations(operations: readonly BriefPatchOperation[]): readonly string[] {
  const ids = new Set<string>();
  for (const operation of operations) {
    if ("entry" in operation && operation.entry.provenance.assetId !== undefined) {
      ids.add(operation.entry.provenance.assetId);
    }
    if (operation.kind === "reference.add") ids.add(operation.item.assetId);
  }
  return [...ids].sort((left, right) => left.localeCompare(right));
}

function snapshotsFromOperations(operations: readonly BriefPatchOperation[]): readonly string[] {
  const ids = new Set<string>();
  for (const operation of operations) {
    if ("entry" in operation && operation.entry.provenance.sourceSnapshotId !== undefined) {
      ids.add(operation.entry.provenance.sourceSnapshotId);
    }
  }
  return [...ids].sort((left, right) => left.localeCompare(right));
}

export class BriefService {
  readonly #confirmation: BriefProposalConfirmationPort | undefined;
  readonly #repository: BriefRepository;
  readonly #sources: BriefSourceVerifier;
  readonly #telemetry: BriefTelemetry;

  constructor(options: {
    readonly confirmation?: BriefProposalConfirmationPort;
    readonly repository: BriefRepository;
    readonly sources: BriefSourceVerifier;
    readonly telemetry?: BriefTelemetry;
  }) {
    this.#confirmation = options.confirmation;
    this.#repository = options.repository;
    this.#sources = options.sources;
    this.#telemetry = options.telemetry ?? briefTelemetry;
  }

  async confirmProposal(command: BriefProposalConfirmationCommand) {
    if (this.#confirmation === undefined) {
      throw new Error("The atomic proposal-confirmation persistence port is not configured.");
    }
    const proposal = briefPatchProposalSchema.parse(command.proposal);
    const update = updateBriefRequestSchema.parse(command.update);
    const proposalMessage = await this.#requireMessage(
      command.actor.tenantId,
      command.projectId,
      proposal.sourceMessageId,
    );
    if (proposalMessage.sessionId !== proposal.sessionId) {
      throw briefConflict(
        "BRIEF_SOURCE_MESSAGE_SCOPE_INVALID",
        "The immutable proposal source message does not belong to its consultation session.",
      );
    }
    await this.#validateSources(command.actor.tenantId, command.projectId, update.operations, {
      actorUserId: command.actor.userId,
      proposalMessage,
    });
    return this.#confirmation.confirmProposal({ ...command, proposal, update });
  }

  async get(tenantId: string, projectId: string): Promise<DesignBrief> {
    const record = await this.getRecord(tenantId, projectId);
    return designBriefSchema.parse(record.brief);
  }

  async getRecord(tenantId: string, projectId: string) {
    const record = await this.#repository.findCurrent(tenantId, projectId);
    if (record === undefined) throw notFound();
    this.#telemetry.record({
      entryCount: record.brief.entries.length,
      outcome: "accepted",
      referenceCount: record.brief.referenceBoard.length,
      stage: "read",
    });
    return record;
  }

  async update(
    command: Pick<UpdateBriefCommand, "actor" | "correlation" | "projectId"> & {
      readonly request: unknown;
    },
  ) {
    const request = updateBriefRequestSchema.parse(command.request);
    await this.#validateSources(command.actor.tenantId, command.projectId, request.operations, {
      actorUserId: command.actor.userId,
    });
    const result = await this.#repository.update({
      actor: command.actor,
      correlation: command.correlation,
      expectedRevision: request.expectedRevision,
      idempotencyKey: request.idempotencyKey,
      operations: request.operations,
      projectId: command.projectId,
      requestSha256: requestHash({
        expectedRevision: request.expectedRevision,
        operations: request.operations,
        projectId: command.projectId,
      }),
    });
    this.#telemetry.record({
      entryCount: result.record.brief.entries.length,
      outcome: result.replayed ? "replayed" : "accepted",
      referenceCount: result.record.brief.referenceBoard.length,
      stage: "update",
    });
    return result;
  }

  async accept(
    command: Pick<AcceptBriefCommand, "actor" | "correlation" | "projectId"> & {
      readonly request: unknown;
    },
  ) {
    const request = acceptBriefRequestSchema.parse(command.request);
    const result = await this.#repository.accept({
      actor: command.actor,
      correlation: command.correlation,
      expectedRevision: request.expectedRevision,
      idempotencyKey: request.idempotencyKey,
      projectId: command.projectId,
      requestSha256: requestHash({
        expectedRevision: request.expectedRevision,
        projectId: command.projectId,
      }),
    });
    this.#telemetry.record({
      entryCount: result.record.brief.entries.length,
      outcome: result.replayed ? "replayed" : "accepted",
      referenceCount: result.record.brief.referenceBoard.length,
      stage: "accept",
    });
    return result;
  }

  history(tenantId: string, projectId: string) {
    return this.#repository.listHistory(tenantId, projectId);
  }

  async #validateSources(
    tenantId: string,
    projectId: string,
    operations: readonly BriefPatchOperation[],
    context: {
      readonly actorUserId: string;
      readonly proposalMessage?: VerifiedBriefMessage;
    },
  ): Promise<void> {
    const assets = new Map(
      await Promise.all(
        assetsFromOperations(operations).map(
          async (assetId) =>
            [assetId, await this.#sources.findAsset(tenantId, projectId, assetId)] as const,
        ),
      ),
    );
    for (const [assetId, asset] of assets) {
      if (
        asset === undefined ||
        asset.tenantId !== tenantId ||
        asset.projectId !== projectId ||
        asset.assetId !== assetId
      ) {
        throw briefConflict(
          "BRIEF_SOURCE_NOT_FOUND",
          "An exact immutable source is unavailable inside this project.",
        );
      }
      if (
        asset.status !== "ready" ||
        !asset.serviceProcessingConsent ||
        asset.trainingUseConsent !== "denied"
      ) {
        throw briefConflict(
          "BRIEF_SOURCE_RIGHTS_UNAVAILABLE",
          "The referenced source is not ready with active service-processing rights.",
        );
      }
    }
    for (const operation of operations) {
      if (operation.kind !== "reference.add") continue;
      if (
        assets.get(operation.item.assetId)?.rightsRecordSha256 !== operation.item.rightsRecordSha256
      ) {
        throw briefConflict(
          "BRIEF_SOURCE_RIGHTS_CHANGED",
          "The exact reference-board rights record changed before the brief update.",
        );
      }
    }
    for (const snapshotId of snapshotsFromOperations(operations)) {
      const snapshot = await this.#sources.findSnapshot(tenantId, projectId, snapshotId);
      if (
        snapshot === undefined ||
        snapshot.tenantId !== tenantId ||
        snapshot.projectId !== projectId ||
        snapshot.snapshotId !== snapshotId
      ) {
        throw briefConflict(
          "BRIEF_SNAPSHOT_NOT_FOUND",
          "An exact immutable canonical snapshot is unavailable inside this project.",
        );
      }
    }
    for (const operation of operations) {
      if (!("entry" in operation)) continue;
      const provenance = operation.entry.provenance;
      if (provenance.method === "user-stated") {
        const attributable =
          context.proposalMessage === undefined
            ? provenance.statedByUserId === context.actorUserId
            : provenance.statedByUserId === context.proposalMessage.createdByUserId &&
              provenance.capturedAt === context.proposalMessage.createdAt;
        if (!attributable) {
          throw briefConflict(
            "BRIEF_USER_PROVENANCE_FORGED",
            "A user-stated brief entry is not attributable to the authorised source actor.",
          );
        }
      }
      if (
        provenance.method === "assistant-extracted" ||
        provenance.method === "assistant-suggested"
      ) {
        if (context.proposalMessage === undefined) {
          throw briefConflict(
            "BRIEF_ASSISTANT_PROVENANCE_REQUIRES_PROPOSAL",
            "Assistant-derived provenance must be applied by exact pending-proposal confirmation.",
          );
        }
        const message = await this.#requireMessage(
          tenantId,
          projectId,
          provenance.sourceMessageId as string,
        );
        if (
          message.messageId !== context.proposalMessage.messageId ||
          message.sessionId !== context.proposalMessage.sessionId ||
          message.createdAt !== provenance.capturedAt
        ) {
          throw briefConflict(
            "BRIEF_SOURCE_MESSAGE_MISMATCH",
            "Assistant-derived provenance does not match the immutable source message timestamp.",
          );
        }
      }
    }
  }

  async #requireMessage(
    tenantId: string,
    projectId: string,
    messageId: string,
  ): Promise<VerifiedBriefMessage> {
    const message = await this.#sources.findMessage(tenantId, projectId, messageId);
    if (
      message === undefined ||
      message.tenantId !== tenantId ||
      message.projectId !== projectId ||
      message.messageId !== messageId
    ) {
      throw briefConflict(
        "BRIEF_SOURCE_MESSAGE_NOT_FOUND",
        "The exact immutable consultation source message is unavailable in this project.",
      );
    }
    return message;
  }
}
