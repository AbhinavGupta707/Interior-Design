import {
  c6PlanPolicy,
  c6SupportedPlanMimeTypeSchema,
  planParserResultSchema,
  type PlanCalibration,
  type PlanOperationDraft,
  type PlanParserResult,
  type PlanProcessingJob,
} from "@interior-design/contracts";

import { ApiError } from "../../errors.js";
import { notFound } from "../identity/http.js";
import { assertValidCalibrationResidual, calibrationResidualMillimetres } from "./calibration.js";
import { planConflict } from "./errors.js";
import { validateOperationDraft } from "./mapping.js";
import type {
  CreateCalibrationCommand,
  CreateOperationDraftCommand,
  CreatePlanJobCommand,
  ParsedEligiblePlanSource,
  PlanProcessingRepository,
  TransitionPlanJobCommand,
} from "./types.js";

function invalidSource(code: string, detail: string): ApiError {
  return new ApiError({ code, detail, statusCode: 409, title: "Plan Source Unavailable" });
}

function parseEligibleSource(
  source: Awaited<ReturnType<PlanProcessingRepository["findPlanSource"]>>,
): ParsedEligiblePlanSource {
  if (source === undefined) throw notFound();
  if (source.kind !== "plan")
    throw invalidSource("PLAN_SOURCE_KIND_INVALID", "The selected asset is not a floor plan.");
  if (source.status !== "ready")
    throw invalidSource(
      "PLAN_SOURCE_NOT_READY",
      "The selected plan has not completed C2 validation.",
    );
  if (source.byteSize > c6PlanPolicy.maximumAssetBytes)
    throw invalidSource(
      "PLAN_SOURCE_RESOURCE_LIMIT",
      "The selected plan exceeds the 25 MiB processing limit.",
    );
  const mime = c6SupportedPlanMimeTypeSchema.safeParse(source.detectedMimeType);
  if (!mime.success)
    throw invalidSource(
      "PLAN_SOURCE_UNSUPPORTED",
      "The selected plan does not have a supported detected MIME type.",
    );
  if (!source.rights.serviceProcessingConsent || source.rights.trainingUseConsent !== "denied") {
    throw invalidSource(
      "PLAN_SOURCE_RIGHTS_NOT_PERMITTED",
      "The exact C2 rights state does not permit this provider-free processing workflow.",
    );
  }
  const basis = ["owned-by-user", "permission-granted", "public-domain", "licensed"].includes(
    source.rights.basis,
  )
    ? (source.rights.basis as ParsedEligiblePlanSource["rights"]["basis"])
    : undefined;
  if (basis === undefined)
    throw invalidSource(
      "PLAN_SOURCE_RIGHTS_NOT_PERMITTED",
      "The plan has no supported rights basis.",
    );
  return {
    ...source,
    detectedMimeType: mime.data,
    kind: "plan",
    rights: { basis, serviceProcessingConsent: true, trainingUseConsent: "denied" },
    status: "ready",
  };
}

export class PlanProcessingService {
  readonly #repository: PlanProcessingRepository;

  constructor(repository: PlanProcessingRepository) {
    this.#repository = repository;
  }

  async createJob(
    command: Omit<CreatePlanJobCommand, "sourceSha256">,
  ): Promise<{ readonly job: PlanProcessingJob; readonly replayed: boolean }> {
    const source = parseEligibleSource(
      await this.#repository.findPlanSource(
        command.actor.tenantId,
        command.projectId,
        command.assetId,
      ),
    );
    return this.#repository.createJob({ ...command, sourceSha256: source.sha256 });
  }

  listJobs(tenantId: string, projectId: string): Promise<readonly PlanProcessingJob[]> {
    return this.#repository.listJobs(tenantId, projectId);
  }

  async getJob(tenantId: string, projectId: string, jobId: string): Promise<PlanProcessingJob> {
    const job = await this.#repository.findJob(tenantId, projectId, jobId);
    if (job === undefined) throw notFound();
    return job;
  }

  async getResult(tenantId: string, projectId: string, jobId: string): Promise<PlanParserResult> {
    const job = await this.getJob(tenantId, projectId, jobId);
    const result = await this.#repository.findResult(tenantId, projectId, jobId);
    if (result !== undefined) return planParserResultSchema.parse(result);
    throw planConflict(
      "PLAN_RESULT_UNAVAILABLE",
      job.safeCode === undefined
        ? "The plan job has not produced an immutable proposal or abstention yet."
        : `The plan job ended without a proposal (${job.safeCode}).`,
    );
  }

  cancelJob(
    command: TransitionPlanJobCommand,
  ): Promise<{ readonly job: PlanProcessingJob; readonly replayed: boolean }> {
    return this.#repository.cancelJob(command);
  }

  retryJob(
    command: TransitionPlanJobCommand,
  ): Promise<{ readonly job: PlanProcessingJob; readonly replayed: boolean }> {
    return this.#repository.retryJob(command);
  }

  async createCalibration(
    command: Omit<CreateCalibrationCommand, "residualMillimetres">,
  ): Promise<{ readonly calibration: PlanCalibration; readonly replayed: boolean }> {
    const result = await this.getResult(command.actor.tenantId, command.projectId, command.jobId);
    if (result.status !== "proposal")
      throw planConflict("PLAN_PROPOSAL_REQUIRED", "An abstention cannot be calibrated.");
    const residualMillimetres = calibrationResidualMillimetres(
      command.request.evidence,
      command.request.sourceToModel,
    );
    assertValidCalibrationResidual(residualMillimetres);
    return this.#repository.createCalibration({ ...command, residualMillimetres });
  }

  async createOperationDraft(
    command: CreateOperationDraftCommand,
  ): Promise<{ readonly draft: PlanOperationDraft; readonly replayed: boolean }> {
    const result = await this.getResult(command.actor.tenantId, command.projectId, command.jobId);
    if (result.status !== "proposal")
      throw planConflict("PLAN_PROPOSAL_REQUIRED", "An abstention cannot produce C5 operations.");
    const calibration = await this.#repository.findCalibration(
      command.actor.tenantId,
      command.projectId,
      command.jobId,
      command.request.calibrationId,
    );
    if (calibration === undefined || calibration.proposalId !== result.proposalId) throw notFound();
    const target = await this.#repository.findBranchTarget(
      command.actor.tenantId,
      command.projectId,
      command.request.target.profile,
      command.request.target.branchId,
    );
    if (target === undefined) throw notFound();
    validateOperationDraft(result, calibration, command.request, target);
    return this.#repository.createOperationDraft(command);
  }
}
