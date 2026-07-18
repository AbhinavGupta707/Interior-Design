import {
  c13SpecificationSchemaVersion,
  c13SubstitutionPreviewSchemaVersion,
  c13CatalogPolicy,
  specificationSchema,
  substitutionPreviewSchema,
  type Specification,
} from "@interior-design/contracts";
import {
  SpecificationDomainError,
  buildInitialSpecificationLines,
  buildSpecificationRevision,
  initialSelectionBoard,
  previewCatalogReplacement,
  projectSpecificationSchedules,
} from "@interior-design/specification";
import { randomUUID } from "node:crypto";

import { notFound } from "../identity/http.js";
import { requestHash } from "../projects/idempotency.js";
import { specificationConflict } from "./errors.js";
import { specificationTelemetry } from "./telemetry.js";
import type {
  ConfirmSubstitutionCommand,
  CreateSpecificationCommand,
  PersistSubstitutionPreviewCommand,
  SpecificationClock,
  SpecificationRepository,
  SpecificationSceneJobPort,
  SpecificationTelemetry,
  SpecificationUuidFactory,
  UpdateSelectionBoardCommand,
} from "./types.js";

function mapDomainError(error: unknown): never {
  if (!(error instanceof SpecificationDomainError)) throw error;
  if (error.code === "GEOMETRY_INVALID") {
    throw specificationConflict("GEOMETRY_INVALID", error.message, 422);
  }
  if (error.code === "ASSET_NOT_SELECTABLE" || error.code === "ASSET_BINDING_MISMATCH") {
    throw specificationConflict("CATALOG_BINDING_CHANGED", error.message);
  }
  throw specificationConflict("CONFIRMATION_CONFLICT", error.message);
}

export class SpecificationService {
  readonly #clock: SpecificationClock;
  readonly #repository: SpecificationRepository;
  readonly #sceneJobs: SpecificationSceneJobPort;
  readonly #telemetry: SpecificationTelemetry;
  readonly #uuid: SpecificationUuidFactory;

  constructor(options: {
    readonly clock?: SpecificationClock;
    readonly repository: SpecificationRepository;
    readonly sceneJobs: SpecificationSceneJobPort;
    readonly telemetry?: SpecificationTelemetry;
    readonly uuid?: SpecificationUuidFactory;
  }) {
    this.#clock = options.clock ?? { now: () => new Date() };
    this.#repository = options.repository;
    this.#sceneJobs = options.sceneJobs;
    this.#telemetry = options.telemetry ?? specificationTelemetry;
    this.#uuid = options.uuid ?? { randomUUID };
  }

  async create(
    command: Omit<CreateSpecificationCommand, "requestSha256" | "specification" | "verified">,
  ) {
    const verified = await this.#repository.resolveCreationSource(
      command.actor.tenantId,
      command.projectId,
      command.request,
    );
    if (verified === undefined) {
      throw specificationConflict(
        "SOURCE_CHANGED",
        "The exact confirmed C12 option, branch head, accepted brief, bundle, or release is unavailable.",
      );
    }
    const specificationId = this.#uuid.randomUUID();
    try {
      const lines = buildInitialSpecificationLines({
        ...verified,
        specificationId,
      });
      const revision = buildSpecificationRevision({
        branchId: verified.source.branchId,
        branchRevision: verified.source.branchRevision,
        catalogReleaseId: verified.catalogRelease.releaseId,
        catalogReleaseSha256: verified.catalogReleaseSha256,
        createdAt: this.#clock.now().toISOString(),
        createdBy: command.actor.userId,
        lines,
        modelSnapshotId: verified.source.resultSnapshotId,
        modelSnapshotSha256: verified.source.resultSnapshotSha256,
        revision: 1,
        sourceConfirmation: verified.source,
      });
      const specification = specificationSchema.parse({
        currentRevision: revision,
        projectId: command.projectId,
        schemaVersion: c13SpecificationSchemaVersion,
        selectionBoard: initialSelectionBoard(lines, 1),
        specificationId,
        status: "working",
      });
      const result = await this.#repository.createSpecification({
        ...command,
        requestSha256: requestHash({ projectId: command.projectId, request: command.request }),
        specification,
        verified,
      });
      this.#telemetry.record({
        count: result.specification.currentRevision.lines.length,
        outcome: result.replayed ? "replayed" : "accepted",
        stage: "create",
      });
      return result;
    } catch (error) {
      mapDomainError(error);
    }
  }

  list(tenantId: string, projectId: string) {
    return this.#repository.listSpecifications(tenantId, projectId);
  }

  async get(tenantId: string, projectId: string, specificationId: string): Promise<Specification> {
    const specification = await this.#repository.findSpecification(
      tenantId,
      projectId,
      specificationId,
    );
    if (specification === undefined) throw notFound();
    return specificationSchema.parse(specification);
  }

  async revisions(tenantId: string, projectId: string, specificationId: string) {
    await this.get(tenantId, projectId, specificationId);
    return this.#repository.listRevisions(tenantId, projectId, specificationId);
  }

  async schedules(tenantId: string, projectId: string, specificationId: string) {
    const specification = await this.get(tenantId, projectId, specificationId);
    const schedules = projectSpecificationSchedules(specification.currentRevision.lines);
    this.#telemetry.record({
      count: specification.currentRevision.lines.length,
      outcome: "accepted",
      stage: "schedule",
    });
    return schedules;
  }

  async updateSelectionBoard(command: Omit<UpdateSelectionBoardCommand, "requestSha256">) {
    const result = await this.#repository.updateSelectionBoard({
      ...command,
      requestSha256: requestHash({
        projectId: command.projectId,
        request: command.request,
        specificationId: command.specificationId,
      }),
    });
    this.#telemetry.record({
      outcome: result.replayed ? "replayed" : "accepted",
      stage: "update",
    });
    return result;
  }

  async createPreview(
    command: Omit<
      PersistSubstitutionPreviewCommand,
      "operation" | "preview" | "requestSha256" | "verified"
    > & { readonly idempotencyKey: string; readonly specificationId: string },
  ) {
    const verified = await this.#repository.resolveSubstitutionSource(
      command.actor.tenantId,
      command.projectId,
      command.specificationId,
      command.request,
    );
    if (verified === undefined) {
      throw specificationConflict(
        "SOURCE_CHANGED",
        "The exact specification, C5 branch, catalog version, or rights record is unavailable.",
      );
    }
    try {
      const bounded = previewCatalogReplacement({
        currentLine: verified.line,
        replacementAsset: verified.asset,
        snapshot: verified.snapshot,
      });
      const now = this.#clock.now();
      const preview = substitutionPreviewSchema.parse({
        baseSnapshotId: verified.branchSnapshotId,
        baseSnapshotSha256: verified.branchSnapshotSha256,
        candidateSnapshotSha256: bounded.result.snapshotSha256,
        elementId: command.request.elementId,
        expiresAt: new Date(
          now.getTime() + c13CatalogPolicy.substitutionPreviewTtlSeconds * 1_000,
        ).toISOString(),
        findings: bounded.result.findings.map(({ code, message }) => `${code}: ${message}`),
        modelPreviewId: this.#uuid.randomUUID(),
        previewId: this.#uuid.randomUUID(),
        replacementAssetVersionId: verified.asset.versionId,
        replacementAssetVersionSha256: verified.asset.versionSha256,
        schemaVersion: c13SubstitutionPreviewSchemaVersion,
        specificationId: command.specificationId,
        specificationRevision: verified.currentRevision.revision,
        visualisationStatus: "bounded-catalog-preview-only",
      });
      const result = await this.#repository.persistSubstitutionPreview({
        ...command,
        operation: bounded.operation,
        preview,
        requestSha256: requestHash({
          projectId: command.projectId,
          request: command.request,
          specificationId: command.specificationId,
        }),
        verified,
      });
      this.#telemetry.record({
        outcome: result.replayed ? "replayed" : "accepted",
        stage: "preview",
      });
      return result;
    } catch (error) {
      mapDomainError(error);
    }
  }

  async getPreview(
    tenantId: string,
    projectId: string,
    specificationId: string,
    previewId: string,
  ) {
    await this.get(tenantId, projectId, specificationId);
    const preview = await this.#repository.findSubstitutionPreview(
      tenantId,
      projectId,
      specificationId,
      previewId,
    );
    if (preview === undefined) throw notFound();
    return preview;
  }

  async confirm(
    command: Omit<ConfirmSubstitutionCommand, "confirmationId" | "requestSha256" | "sceneJobId">,
  ) {
    let persisted;
    try {
      persisted = await this.#repository.confirmSubstitution({
        ...command,
        confirmationId: this.#uuid.randomUUID(),
        requestSha256: requestHash({
          previewId: command.request.previewId,
          projectId: command.projectId,
          request: command.request,
          specificationId: command.specificationId,
        }),
        sceneJobId: this.#uuid.randomUUID(),
      });
    } catch (error) {
      mapDomainError(error);
    }
    let sceneState: "requested" | "retry-required" = "requested";
    try {
      await this.#sceneJobs.requestExactRevision(persisted.sceneRequest);
      await this.#repository.recordSceneRequest(
        command.actor.tenantId,
        command.projectId,
        persisted.sceneRequest.sceneJobId,
        "requested",
      );
    } catch {
      sceneState = "retry-required";
      await this.#repository.recordSceneRequest(
        command.actor.tenantId,
        command.projectId,
        persisted.sceneRequest.sceneJobId,
        "retry-required",
        "SCENE_REQUEST_FAILED",
      );
    }
    this.#telemetry.record({
      outcome:
        sceneState === "retry-required"
          ? "retry-required"
          : persisted.replayed
            ? "replayed"
            : "accepted",
      stage: "confirm",
    });
    return { ...persisted, sceneState };
  }

  async retryScene(
    tenantId: string,
    projectId: string,
    specificationId: string,
    specificationRevision: number,
    sceneJobId: string,
  ) {
    const binding = await this.#repository.resolveConfirmedSceneBinding(
      tenantId,
      projectId,
      sceneJobId,
    );
    if (
      binding === undefined ||
      binding.specificationId !== specificationId ||
      binding.specificationRevision !== specificationRevision
    ) {
      throw notFound();
    }
    const sceneRequest = {
      branchId: binding.branchId,
      branchRevision: binding.branchRevision,
      modelSnapshotId: binding.modelSnapshotId,
      modelSnapshotSha256: binding.modelSnapshotSha256,
      projectId,
      sceneJobId,
      specificationId: binding.specificationId,
      specificationRevision: binding.specificationRevision,
    };
    await this.#sceneJobs.requestExactRevision(sceneRequest);
    await this.#repository.recordSceneRequest(tenantId, projectId, sceneJobId, "requested");
    return { sceneJobId, state: "requested" as const };
  }
}
