import {
  createReconstructionJobRequestSchema,
  reconstructionSourceMimeTypeSchema,
  type CreateReconstructionJobRequest,
  type ReconstructionJob,
  type ReconstructionResult,
} from "@interior-design/contracts";
import { createHash } from "node:crypto";

import { notFound } from "../identity/http.js";
import { requestHash } from "../projects/idempotency.js";
import { reconstructionConflict } from "./errors.js";
import { reconstructionTelemetry } from "./telemetry.js";
import type {
  CreateReconstructionJobCommand,
  ParsedReconstructionSource,
  ReconstructionRepository,
  ReconstructionTelemetry,
  TransitionReconstructionJobCommand,
} from "./types.js";

function sourceUnavailable(code: string, detail: string): never {
  throw reconstructionConflict(code, detail);
}

function parseEligibleSource(
  source: Awaited<ReturnType<ReconstructionRepository["findSource"]>>,
  requested: CreateReconstructionJobRequest["sources"][number],
  rights: CreateReconstructionJobRequest["rights"],
): ParsedReconstructionSource {
  if (source === undefined) throw notFound();
  if (source.withdrawn) {
    sourceUnavailable(
      "RECONSTRUCTION_SOURCE_RIGHTS_WITHDRAWN",
      "Processing permission for the selected immutable source has been withdrawn.",
    );
  }
  if (source.status !== "ready") {
    sourceUnavailable(
      "RECONSTRUCTION_SOURCE_NOT_READY",
      "The selected source has not completed immutable evidence validation.",
    );
  }
  const mime = reconstructionSourceMimeTypeSchema.safeParse(source.detectedMimeType);
  if (!mime.success || mime.data !== requested.detectedMimeType) {
    sourceUnavailable(
      "RECONSTRUCTION_SOURCE_CHANGED",
      "The selected source detected type no longer matches the exact request.",
    );
  }
  if (
    source.assetId !== requested.assetId ||
    source.byteSize !== requested.byteSize ||
    source.sha256 !== requested.sha256
  ) {
    sourceUnavailable(
      "RECONSTRUCTION_SOURCE_CHANGED",
      "The selected immutable source fingerprint no longer matches the exact request.",
    );
  }
  if (
    !source.rights.serviceProcessingConsent ||
    source.rights.trainingUseConsent !== "denied" ||
    source.rights.basis !== rights.basis
  ) {
    sourceUnavailable(
      "RECONSTRUCTION_SOURCE_RIGHTS_NOT_PERMITTED",
      "The exact source rights state does not permit this provider-free workflow.",
    );
  }
  return {
    ...source,
    detectedMimeType: mime.data,
    rights,
    status: "ready",
    withdrawn: false,
  };
}

function sourceManifestSha256(
  request: CreateReconstructionJobRequest,
  sources: readonly ParsedReconstructionSource[],
): string {
  const manifest = sources
    .map((source) => ({
      assetId: source.assetId,
      byteSize: source.byteSize,
      detectedMimeType: source.detectedMimeType,
      rights: source.rights,
      sha256: source.sha256,
    }))
    .sort((left, right) => left.assetId.localeCompare(right.assetId));
  return createHash("sha256")
    .update(JSON.stringify({ mode: request.mode, sources: manifest }))
    .digest("hex");
}

export class ReconstructionService {
  readonly #repository: ReconstructionRepository;
  readonly #telemetry: ReconstructionTelemetry;

  constructor(
    repository: ReconstructionRepository,
    telemetry: ReconstructionTelemetry = reconstructionTelemetry,
  ) {
    this.#repository = repository;
    this.#telemetry = telemetry;
  }

  async createJob(
    command: Omit<CreateReconstructionJobCommand, "requestSha256" | "sourceManifestSha256">,
  ): Promise<{ readonly job: ReconstructionJob; readonly replayed: boolean }> {
    const request = createReconstructionJobRequestSchema.parse(command.request);
    const sources = await Promise.all(
      request.sources.map(async (requested) =>
        parseEligibleSource(
          await this.#repository.findSource(
            command.actor.tenantId,
            command.projectId,
            requested.assetId,
          ),
          requested,
          request.rights,
        ),
      ),
    );
    const result = await this.#repository.createJob({
      ...command,
      request,
      requestSha256: requestHash(request),
      sourceManifestSha256: sourceManifestSha256(request, sources),
    });
    this.#telemetry.record({
      outcome: result.replayed ? "replayed" : "accepted",
      stage: "create",
    });
    return result;
  }

  listJobs(tenantId: string, projectId: string): Promise<readonly ReconstructionJob[]> {
    return this.#repository.listJobs(tenantId, projectId);
  }

  async getJob(
    tenantId: string,
    projectId: string,
    reconstructionJobId: string,
  ): Promise<ReconstructionJob> {
    const job = await this.#repository.findJob(tenantId, projectId, reconstructionJobId);
    if (job === undefined) throw notFound();
    return job;
  }

  async getResult(
    tenantId: string,
    projectId: string,
    reconstructionJobId: string,
  ): Promise<ReconstructionResult> {
    const job = await this.getJob(tenantId, projectId, reconstructionJobId);
    const result = await this.#repository.findResult(tenantId, projectId, reconstructionJobId);
    if (result !== undefined) return result;
    throw reconstructionConflict(
      "RECONSTRUCTION_RESULT_UNAVAILABLE",
      job.safeCode === undefined
        ? "This job has not published an immutable reconstruction result."
        : `This job ended without a result (${job.safeCode}).`,
    );
  }

  async cancelJob(
    command: TransitionReconstructionJobCommand,
  ): Promise<{ readonly job: ReconstructionJob; readonly replayed: boolean }> {
    const result = await this.#repository.cancelJob(command);
    this.#telemetry.record({
      outcome: result.replayed ? "replayed" : "accepted",
      stage: "cancel",
    });
    return result;
  }

  async retryJob(
    command: TransitionReconstructionJobCommand,
  ): Promise<{ readonly job: ReconstructionJob; readonly replayed: boolean }> {
    const result = await this.#repository.retryJob(command);
    this.#telemetry.record({
      outcome: result.replayed ? "replayed" : "accepted",
      stage: "retry",
    });
    return result;
  }
}
