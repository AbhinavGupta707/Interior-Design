import {
  createFusionJobRequestSchema,
  createFusionOperationDraftRequestSchema,
  reviewFusionDiscrepanciesRequestSchema,
  type CreateFusionJobRequest,
  type FusionJob,
  type FusionProposal,
  type FusionSource,
} from "@interior-design/contracts";

import { notFound } from "../identity/http.js";
import { requestHash } from "../projects/idempotency.js";
import { fusionConflict } from "./errors.js";
import { fusionTelemetry } from "./telemetry.js";
import type {
  CreateFusionJobCommand,
  CreateFusionOperationDraftCommand,
  FusionBaseVerifier,
  FusionRepository,
  FusionSourceVerifier,
  FusionTelemetry,
  ReviewFusionDiscrepanciesCommand,
  TransitionFusionJobCommand,
  VerifiedFusionSource,
} from "./types.js";

function exactSourceMatches(requested: FusionSource, verified: VerifiedFusionSource): boolean {
  return (
    verified.tenantId.length > 0 &&
    verified.projectId.length > 0 &&
    verified.kind === requested.kind &&
    verified.referenceId === requested.referenceId &&
    verified.schemaVersion === requested.schemaVersion &&
    verified.sha256 === requested.sha256 &&
    verified.elementCount === requested.elementCount &&
    verified.evidenceState === requested.evidenceState &&
    verified.rightsActive
  );
}

function sourceManifestSha256(request: CreateFusionJobRequest): string {
  return requestHash({
    baseSnapshot: request.baseSnapshot,
    sources: request.sources
      .map((source) => ({
        coordinateFrame: source.coordinateFrame,
        elementCount: source.elementCount,
        evidenceState: source.evidenceState,
        id: source.id,
        kind: source.kind,
        referenceId: source.referenceId,
        rights: source.rights,
        scaleStatus: source.scaleStatus,
        schemaVersion: source.schemaVersion,
        sha256: source.sha256,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  });
}

export class ModelFusionService {
  readonly #baseVerifier: FusionBaseVerifier;
  readonly #repository: FusionRepository;
  readonly #sourceVerifier: FusionSourceVerifier;
  readonly #telemetry: FusionTelemetry;

  constructor(options: {
    readonly baseVerifier: FusionBaseVerifier;
    readonly repository: FusionRepository;
    readonly sourceVerifier: FusionSourceVerifier;
    readonly telemetry?: FusionTelemetry;
  }) {
    this.#baseVerifier = options.baseVerifier;
    this.#repository = options.repository;
    this.#sourceVerifier = options.sourceVerifier;
    this.#telemetry = options.telemetry ?? fusionTelemetry;
  }

  async createJob(
    command: Omit<CreateFusionJobCommand, "requestSha256" | "sourceManifestSha256">,
  ): Promise<{ readonly job: FusionJob; readonly replayed: boolean }> {
    const request = createFusionJobRequestSchema.parse(command.request);
    const base = await this.#baseVerifier.findExact(
      command.actor.tenantId,
      command.projectId,
      request.baseSnapshot,
    );
    if (base === undefined || base.snapshot.profile !== "existing") {
      throw fusionConflict(
        "FUSION_BASE_SNAPSHOT_MISMATCH",
        "The exact committed existing-condition base snapshot is unavailable or stale.",
      );
    }
    const verified = await Promise.all(
      request.sources.map((source) =>
        this.#sourceVerifier.verify(command.actor.tenantId, command.projectId, source),
      ),
    );
    for (const [index, source] of request.sources.entries()) {
      const current = verified[index];
      if (current === undefined) {
        throw fusionConflict(
          "FUSION_SOURCE_NOT_FOUND",
          "An exact immutable source is unavailable inside this project.",
        );
      }
      if (
        current.tenantId !== command.actor.tenantId ||
        current.projectId !== command.projectId ||
        !exactSourceMatches(source, current)
      ) {
        throw fusionConflict(
          current.rightsActive ? "FUSION_SOURCE_CHANGED" : "FUSION_SOURCE_RIGHTS_WITHDRAWN",
          current.rightsActive
            ? "An exact source reference, schema, hash, evidence state, or element count changed."
            : "Service-processing permission for an exact source is no longer active.",
        );
      }
    }
    const result = await this.#repository.createJob({
      ...command,
      request,
      requestSha256: requestHash(request),
      sourceManifestSha256: sourceManifestSha256(request),
    });
    this.#telemetry.record({
      outcome: result.replayed ? "replayed" : "accepted",
      stage: "create",
    });
    return result;
  }

  listJobs(tenantId: string, projectId: string): Promise<readonly FusionJob[]> {
    return this.#repository.listJobs(tenantId, projectId);
  }

  async getJob(tenantId: string, projectId: string, fusionJobId: string): Promise<FusionJob> {
    const job = await this.#repository.findJob(tenantId, projectId, fusionJobId);
    if (job === undefined) throw notFound();
    return job;
  }

  async getProposal(
    tenantId: string,
    projectId: string,
    fusionJobId: string,
  ): Promise<FusionProposal> {
    await this.getJob(tenantId, projectId, fusionJobId);
    const proposal = await this.#repository.findProposal(tenantId, projectId, fusionJobId);
    if (proposal === undefined) {
      throw fusionConflict(
        "FUSION_PROPOSAL_UNAVAILABLE",
        "This job has not atomically published an immutable proposal or abstention.",
      );
    }
    return proposal;
  }

  async cancelJob(command: TransitionFusionJobCommand) {
    const result = await this.#repository.cancelJob(command);
    this.#telemetry.record({
      outcome: result.replayed ? "replayed" : "accepted",
      stage: "cancel",
    });
    return result;
  }

  async retryJob(command: TransitionFusionJobCommand) {
    const current = await this.getJob(
      command.actor.tenantId,
      command.projectId,
      command.fusionJobId,
    );
    const verified = await Promise.all(
      current.request.sources.map((source) =>
        this.#sourceVerifier.verify(command.actor.tenantId, command.projectId, source),
      ),
    );
    if (
      current.request.sources.some((source, index) => {
        const exact = verified[index];
        return exact === undefined || !exactSourceMatches(source, exact);
      })
    ) {
      throw fusionConflict(
        "FUSION_SOURCE_RIGHTS_WITHDRAWN",
        "An exact source, immutable hash, or processing right changed before retry.",
      );
    }
    const result = await this.#repository.retryJob(command);
    this.#telemetry.record({
      outcome: result.replayed ? "replayed" : "accepted",
      stage: "retry",
    });
    return result;
  }

  async reviewDiscrepancies(command: ReviewFusionDiscrepanciesCommand) {
    const request = reviewFusionDiscrepanciesRequestSchema.parse(command.request);
    const result = await this.#repository.reviewDiscrepancies({ ...command, request });
    this.#telemetry.record({
      outcome: result.replayed ? "replayed" : "accepted",
      stage: "review",
    });
    return result;
  }

  async createOperationDraft(command: CreateFusionOperationDraftCommand) {
    const request = createFusionOperationDraftRequestSchema.parse(command.request);
    const result = await this.#repository.createOperationDraft({ ...command, request });
    this.#telemetry.record({
      outcome: result.replayed ? "replayed" : "accepted",
      stage: "draft",
    });
    return result;
  }
}
