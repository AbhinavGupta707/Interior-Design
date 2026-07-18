import {
  c13SpecificationSchemaVersion,
  c13SubstitutionConfirmationSchemaVersion,
  specificationSchema,
  substitutionConfirmationSchema,
  substitutionPreviewSchema,
  type Specification,
  type SpecificationRevision,
  type SubstitutionPreview,
} from "@interior-design/contracts";
import {
  applySelectionBoard,
  buildSpecificationRevision,
  initialSelectionBoard,
  previewCatalogReplacement,
  substituteSpecificationLine,
} from "@interior-design/specification";
import { randomUUID } from "node:crypto";

import { notFound } from "../identity/http.js";
import { specificationConflict } from "./errors.js";
import type {
  ConfirmSubstitutionCommand,
  ConfirmationPersistenceResult,
  CreateSpecificationCommand,
  PersistSubstitutionPreviewCommand,
  SpecificationClock,
  SpecificationRepository,
  SpecificationSceneBinding,
  SpecificationUuidFactory,
  UpdateSelectionBoardCommand,
  VerifiedSpecificationCreationSource,
  VerifiedSubstitutionSource,
} from "./types.js";

interface Effect {
  readonly operation: string;
  readonly requestSha256: string;
  readonly value: unknown;
}

interface RetainedPreview {
  readonly command: PersistSubstitutionPreviewCommand;
  readonly preview: SubstitutionPreview;
  state: "confirmed" | "pending";
}

function scoped(...parts: readonly string[]): string {
  return parts.join(":");
}

export class InMemorySpecificationRepository implements SpecificationRepository {
  readonly #clock: SpecificationClock;
  readonly #uuid: SpecificationUuidFactory;
  readonly creationSources = new Map<string, VerifiedSpecificationCreationSource>();
  readonly effects = new Map<string, Effect>();
  readonly previews = new Map<string, RetainedPreview>();
  readonly revisions = new Map<string, SpecificationRevision[]>();
  readonly sceneBindings = new Map<string, SpecificationSceneBinding>();
  readonly sceneStates = new Map<string, "requested" | "retry-required">();
  readonly specifications = new Map<string, Specification>();
  readonly substitutionSources = new Map<string, VerifiedSubstitutionSource>();
  failureStage: "after-model" | "after-specification" | undefined;

  constructor(options?: {
    readonly clock?: SpecificationClock;
    readonly uuid?: SpecificationUuidFactory;
  }) {
    this.#clock = options?.clock ?? { now: () => new Date() };
    this.#uuid = options?.uuid ?? { randomUUID };
  }

  static creationKey(
    tenantId: string,
    projectId: string,
    confirmationId: string,
    releaseId: string,
  ) {
    return scoped(tenantId, projectId, confirmationId, releaseId);
  }

  static specificationKey(tenantId: string, projectId: string, specificationId: string) {
    return scoped(tenantId, projectId, specificationId);
  }

  #claim<T>(
    tenantId: string,
    idempotencyKey: string,
    operation: string,
    requestSha256: string,
    deserialize: (value: unknown) => T,
  ): T | undefined {
    const effect = this.effects.get(scoped(tenantId, idempotencyKey));
    if (effect === undefined) return undefined;
    if (effect.operation !== operation || effect.requestSha256 !== requestSha256) {
      throw specificationConflict(
        "IDEMPOTENCY_CONFLICT",
        "The C13 idempotency key was already used for a different exact request.",
      );
    }
    return deserialize(structuredClone(effect.value));
  }

  #complete(
    tenantId: string,
    idempotencyKey: string,
    operation: string,
    requestSha256: string,
    value: unknown,
  ): void {
    this.effects.set(scoped(tenantId, idempotencyKey), {
      operation,
      requestSha256,
      value: structuredClone(value),
    });
  }

  resolveCreationSource(
    tenantId: string,
    projectId: string,
    request: CreateSpecificationCommand["request"],
  ) {
    return Promise.resolve(
      this.creationSources.get(
        InMemorySpecificationRepository.creationKey(
          tenantId,
          projectId,
          request.confirmationId,
          request.catalogReleaseId,
        ),
      ),
    );
  }

  createSpecification(command: CreateSpecificationCommand) {
    const replay = this.#claim<Specification>(
      command.actor.tenantId,
      command.idempotencyKey,
      "specification.create",
      command.requestSha256,
      (value) => specificationSchema.parse(value),
    );
    if (replay !== undefined) return Promise.resolve({ replayed: true, specification: replay });
    const source = this.creationSources.get(
      InMemorySpecificationRepository.creationKey(
        command.actor.tenantId,
        command.projectId,
        command.request.confirmationId,
        command.request.catalogReleaseId,
      ),
    );
    if (
      source === undefined ||
      source.source.resultSnapshotSha256 !== command.verified.source.resultSnapshotSha256 ||
      source.source.branchRevision !== command.verified.source.branchRevision
    ) {
      throw specificationConflict(
        "SOURCE_CHANGED",
        "The authoritative C12 source changed before creation.",
      );
    }
    const key = InMemorySpecificationRepository.specificationKey(
      command.actor.tenantId,
      command.projectId,
      command.specification.specificationId,
    );
    this.specifications.set(key, structuredClone(command.specification));
    this.revisions.set(key, [structuredClone(command.specification.currentRevision)]);
    this.#complete(
      command.actor.tenantId,
      command.idempotencyKey,
      "specification.create",
      command.requestSha256,
      command.specification,
    );
    return Promise.resolve({ replayed: false, specification: command.specification });
  }

  listSpecifications(tenantId: string, projectId: string) {
    const prefix = scoped(tenantId, projectId, "");
    return Promise.resolve(
      [...this.specifications.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([, value]) => structuredClone(value)),
    );
  }

  findSpecification(tenantId: string, projectId: string, specificationId: string) {
    return Promise.resolve(
      this.specifications.get(
        InMemorySpecificationRepository.specificationKey(tenantId, projectId, specificationId),
      ),
    );
  }

  listRevisions(tenantId: string, projectId: string, specificationId: string) {
    return Promise.resolve(
      this.revisions.get(
        InMemorySpecificationRepository.specificationKey(tenantId, projectId, specificationId),
      ) ?? [],
    );
  }

  updateSelectionBoard(command: UpdateSelectionBoardCommand) {
    const replay = this.#claim<Specification>(
      command.actor.tenantId,
      command.idempotencyKey,
      "specification.update",
      command.requestSha256,
      (value) => specificationSchema.parse(value),
    );
    if (replay !== undefined) return Promise.resolve({ replayed: true, specification: replay });
    const key = InMemorySpecificationRepository.specificationKey(
      command.actor.tenantId,
      command.projectId,
      command.specificationId,
    );
    const current = this.specifications.get(key);
    if (current === undefined) throw notFound();
    if (current.currentRevision.revision !== command.request.expectedRevision) {
      throw specificationConflict(
        "SPECIFICATION_REVISION_CONFLICT",
        "The specification revision changed before the selection-board update.",
      );
    }
    const nextRevision = applySelectionBoard(current.currentRevision, command.request.entries, {
      branchId: current.currentRevision.branchId,
      branchRevision: current.currentRevision.branchRevision,
      catalogReleaseId: current.currentRevision.catalogReleaseId,
      catalogReleaseSha256: current.currentRevision.catalogReleaseSha256,
      createdAt: this.#clock.now().toISOString(),
      createdBy: command.actor.userId,
      modelSnapshotId: current.currentRevision.modelSnapshotId,
      modelSnapshotSha256: current.currentRevision.modelSnapshotSha256,
      revision: current.currentRevision.revision + 1,
    });
    const next = specificationSchema.parse({
      ...current,
      currentRevision: nextRevision,
      selectionBoard: initialSelectionBoard(nextRevision.lines, nextRevision.revision),
    });
    this.specifications.set(key, next);
    this.revisions.set(key, [...(this.revisions.get(key) ?? []), nextRevision]);
    this.#complete(
      command.actor.tenantId,
      command.idempotencyKey,
      "specification.update",
      command.requestSha256,
      next,
    );
    return Promise.resolve({ replayed: false, specification: next });
  }

  resolveSubstitutionSource(
    tenantId: string,
    projectId: string,
    specificationId: string,
    request: PersistSubstitutionPreviewCommand["request"],
  ) {
    return Promise.resolve(
      this.substitutionSources.get(
        scoped(tenantId, projectId, specificationId, request.replacementAssetVersionId),
      ),
    );
  }

  persistSubstitutionPreview(command: PersistSubstitutionPreviewCommand) {
    const replay = this.#claim<SubstitutionPreview>(
      command.actor.tenantId,
      command.idempotencyKey,
      "specification.substitution.preview",
      command.requestSha256,
      (value) => substitutionPreviewSchema.parse(value),
    );
    if (replay !== undefined) return Promise.resolve({ preview: replay, replayed: true });
    const key = InMemorySpecificationRepository.specificationKey(
      command.actor.tenantId,
      command.projectId,
      command.preview.specificationId,
    );
    const current = this.specifications.get(key);
    if (
      current === undefined ||
      current.currentRevision.revision !== command.request.expectedSpecificationRevision ||
      current.currentRevision.branchRevision !== command.request.expectedBranchRevision ||
      current.currentRevision.modelSnapshotSha256 !== command.preview.baseSnapshotSha256 ||
      command.verified.currentRevision.revision !== current.currentRevision.revision ||
      command.verified.branchRevision !== current.currentRevision.branchRevision ||
      command.verified.branchSnapshotId !== current.currentRevision.modelSnapshotId ||
      command.verified.branchSnapshotSha256 !== current.currentRevision.modelSnapshotSha256
    ) {
      throw specificationConflict(
        "SOURCE_CHANGED",
        "The preview source changed before publication.",
      );
    }
    this.previews.set(
      scoped(command.actor.tenantId, command.projectId, command.preview.previewId),
      {
        command: structuredClone(command),
        preview: structuredClone(command.preview),
        state: "pending",
      },
    );
    this.#complete(
      command.actor.tenantId,
      command.idempotencyKey,
      "specification.substitution.preview",
      command.requestSha256,
      command.preview,
    );
    return Promise.resolve({ preview: command.preview, replayed: false });
  }

  findSubstitutionPreview(
    tenantId: string,
    projectId: string,
    specificationId: string,
    previewId: string,
  ) {
    const retained = this.previews.get(scoped(tenantId, projectId, previewId));
    return Promise.resolve(
      retained?.preview.specificationId === specificationId ? retained.preview : undefined,
    );
  }

  confirmSubstitution(command: ConfirmSubstitutionCommand): Promise<ConfirmationPersistenceResult> {
    const replay = this.#claim<ConfirmationPersistenceResult>(
      command.actor.tenantId,
      command.idempotencyKey,
      "specification.substitution.confirm",
      command.requestSha256,
      (value) => value as ConfirmationPersistenceResult,
    );
    if (replay !== undefined) return Promise.resolve({ ...replay, replayed: true });
    const retained = this.previews.get(
      scoped(command.actor.tenantId, command.projectId, command.request.previewId),
    );
    if (retained === undefined || retained.preview.specificationId !== command.specificationId) {
      throw notFound();
    }
    if (retained.state !== "pending") {
      throw specificationConflict(
        "PREVIEW_NOT_PENDING",
        "The substitution preview is no longer pending.",
      );
    }
    if (Date.parse(retained.preview.expiresAt) <= this.#clock.now().getTime()) {
      throw specificationConflict("PREVIEW_EXPIRED", "The substitution preview expired.", 410);
    }
    const specKey = InMemorySpecificationRepository.specificationKey(
      command.actor.tenantId,
      command.projectId,
      command.specificationId,
    );
    const current = this.specifications.get(specKey);
    if (
      current === undefined ||
      current.currentRevision.revision !== command.request.expectedSpecificationRevision ||
      retained.preview.candidateSnapshotSha256 !== command.request.expectedCandidateSnapshotSha256
    ) {
      throw specificationConflict(
        "CONFIRMATION_CONFLICT",
        "The candidate or specification revision is stale or forged.",
      );
    }
    const recalculated = previewCatalogReplacement({
      currentLine: retained.command.verified.line,
      replacementAsset: retained.command.verified.asset,
      snapshot: retained.command.verified.snapshot,
    });
    if (recalculated.result.snapshotSha256 !== retained.preview.candidateSnapshotSha256) {
      throw specificationConflict(
        "CONFIRMATION_CONFLICT",
        "The exact C5 candidate no longer replays.",
      );
    }
    const before = structuredClone(current);
    if (this.failureStage === "after-model") {
      throw new Error("Injected failure after in-memory C5 candidate validation.");
    }
    const line = current.currentRevision.lines.find(
      ({ elementId }) => elementId === retained.preview.elementId,
    );
    if (line === undefined) throw new Error("Retained preview line disappeared.");
    const nextLine = substituteSpecificationLine({
      confirmationId: command.confirmationId,
      current: line,
      replacementAsset: retained.command.verified.asset,
    });
    const nextLines = current.currentRevision.lines.map((candidate) =>
      candidate.elementId === nextLine.elementId ? nextLine : candidate,
    );
    const snapshotId = this.#uuid.randomUUID();
    const nextRevision = buildSpecificationRevision({
      branchId: current.currentRevision.branchId,
      branchRevision: current.currentRevision.branchRevision + 1,
      catalogReleaseId: current.currentRevision.catalogReleaseId,
      catalogReleaseSha256: current.currentRevision.catalogReleaseSha256,
      createdAt: this.#clock.now().toISOString(),
      createdBy: command.actor.userId,
      lines: nextLines,
      modelSnapshotId: snapshotId,
      modelSnapshotSha256: recalculated.result.snapshotSha256,
      revision: current.currentRevision.revision + 1,
      sourceConfirmation: current.currentRevision.sourceConfirmation,
    });
    const next = specificationSchema.parse({
      ...before,
      currentRevision: nextRevision,
      schemaVersion: c13SpecificationSchemaVersion,
      selectionBoard: initialSelectionBoard(nextLines, nextRevision.revision),
    });
    if (this.failureStage === "after-specification") {
      throw new Error("Injected failure after in-memory specification candidate validation.");
    }
    const confirmation = substitutionConfirmationSchema.parse({
      commitId: this.#uuid.randomUUID(),
      confirmationId: command.confirmationId,
      elementId: retained.preview.elementId,
      resultSnapshotId: snapshotId,
      resultSnapshotSha256: recalculated.result.snapshotSha256,
      sceneJobId: command.sceneJobId,
      schemaVersion: c13SubstitutionConfirmationSchemaVersion,
      specificationId: command.specificationId,
      specificationRevision: nextRevision.revision,
    });
    const sceneRequest = {
      branchId: nextRevision.branchId,
      branchRevision: nextRevision.branchRevision,
      modelId: retained.command.verified.snapshot.modelId,
      modelSnapshotId: nextRevision.modelSnapshotId,
      modelSnapshotSha256: nextRevision.modelSnapshotSha256,
      projectId: command.projectId,
      sceneJobId: command.sceneJobId,
      specificationId: command.specificationId,
      specificationRevision: nextRevision.revision,
      specificationRevisionSha256: nextRevision.revisionSha256,
    };
    this.specifications.set(specKey, next);
    this.revisions.set(specKey, [...(this.revisions.get(specKey) ?? []), nextRevision]);
    retained.state = "confirmed";
    const binding: SpecificationSceneBinding = {
      branchId: nextRevision.branchId,
      branchRevision: nextRevision.branchRevision,
      catalogReleaseId: nextRevision.catalogReleaseId,
      catalogReleaseSha256: nextRevision.catalogReleaseSha256,
      lines: nextRevision.lines,
      modelId: retained.command.verified.snapshot.modelId,
      modelSnapshotId: nextRevision.modelSnapshotId,
      modelSnapshotSha256: nextRevision.modelSnapshotSha256,
      projectId: command.projectId,
      revisionSha256: nextRevision.revisionSha256,
      sceneJobId: command.sceneJobId,
      specificationId: command.specificationId,
      specificationRevision: nextRevision.revision,
    };
    this.sceneBindings.set(
      scoped(command.actor.tenantId, command.projectId, command.sceneJobId),
      binding,
    );
    const result = { confirmation, replayed: false, sceneRequest };
    this.#complete(
      command.actor.tenantId,
      command.idempotencyKey,
      "specification.substitution.confirm",
      command.requestSha256,
      result,
    );
    return Promise.resolve(result);
  }

  resolveConfirmedSceneBinding(tenantId: string, projectId: string, sceneJobId: string) {
    return Promise.resolve(this.sceneBindings.get(scoped(tenantId, projectId, sceneJobId)));
  }

  recordSceneRequest(
    tenantId: string,
    projectId: string,
    sceneJobId: string,
    outcome: "requested" | "retry-required",
  ) {
    if (!this.sceneBindings.has(scoped(tenantId, projectId, sceneJobId))) throw notFound();
    this.sceneStates.set(scoped(tenantId, projectId, sceneJobId), outcome);
    return Promise.resolve();
  }
}
