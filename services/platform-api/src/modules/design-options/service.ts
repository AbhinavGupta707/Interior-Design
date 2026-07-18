import {
  canonicalHomeSnapshotSchema,
  createOptionJobRequestSchema,
  designConstraintSchema,
  optionJobSchema,
  type CanonicalHomeSnapshot,
  type ModelSnapshotRecord,
  type OptionJob,
  type OptionWorkingModelReference,
} from "@interior-design/contracts";
import { validateAndCanonicalizeSnapshot } from "@interior-design/model-operations";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { notFound } from "../identity/http.js";
import { requestHash } from "../projects/idempotency.js";
import { designOptionConflict } from "./errors.js";
import { constraintsSha256 } from "./hashes.js";
import { designOptionTelemetry } from "./telemetry.js";
import type {
  ConfirmOptionCommand,
  CreateOptionJobCommand,
  DesignConstraintDerivationPort,
  DesignOptionRepository,
  DesignOptionSourceVerifier,
  DesignOptionTelemetry,
  DesignOptionUuidFactory,
  CreateOptionJobRequest,
  TransitionOptionJobCommand,
  VerifiedOptionInputs,
} from "./types.js";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

function normalizedRequest(request: CreateOptionJobRequest): CreateOptionJobRequest {
  return createOptionJobRequestSchema.parse({
    ...request,
    requestedDirections: [...request.requestedDirections].sort(),
  });
}

function proposedClone(source: ModelSnapshotRecord): CanonicalHomeSnapshot {
  return canonicalHomeSnapshotSchema.parse(
    source.profile === "proposed"
      ? source.snapshot
      : {
          ...source.snapshot,
          derivedFromSnapshotSha256: source.snapshotSha256,
          profile: "proposed",
        },
  );
}

function workingModel(
  verified: VerifiedOptionInputs,
  workingSnapshotId: string,
): { readonly reference: OptionWorkingModelReference; readonly snapshot: CanonicalHomeSnapshot } {
  const canonical = validateAndCanonicalizeSnapshot(proposedClone(verified.source));
  if (canonical.hasBlockingFindings) {
    throw designOptionConflict(
      "CONSTRAINTS_FAILED",
      "The exact proposed working clone contains blocking canonical geometry findings.",
      422,
    );
  }
  if (verified.currentProposed !== undefined) {
    if (verified.currentProposed.snapshotSha256 !== canonical.snapshotSha256) {
      throw designOptionConflict(
        "PROPOSED_BASE_CONFLICT",
        "The current proposed profile does not match the exact derived C12 working base.",
      );
    }
    return {
      reference: {
        modelId: verified.currentProposed.modelId,
        profile: "proposed",
        snapshotId: verified.currentProposed.id,
        snapshotSha256: verified.currentProposed.snapshotSha256,
        snapshotVersion: verified.currentProposed.version,
      },
      snapshot: canonical.snapshot,
    };
  }
  return {
    reference: {
      modelId: verified.source.modelId,
      profile: "proposed",
      snapshotId: workingSnapshotId,
      snapshotSha256: canonical.snapshotSha256,
      snapshotVersion: 1,
    },
    snapshot: canonical.snapshot,
  };
}

export class DesignOptionService {
  readonly #constraintDeriver: DesignConstraintDerivationPort;
  readonly #repository: DesignOptionRepository;
  readonly #sourceVerifier: DesignOptionSourceVerifier;
  readonly #telemetry: DesignOptionTelemetry;
  readonly #uuid: DesignOptionUuidFactory;

  constructor(options: {
    readonly constraintDeriver: DesignConstraintDerivationPort;
    readonly repository: DesignOptionRepository;
    readonly sourceVerifier: DesignOptionSourceVerifier;
    readonly telemetry?: DesignOptionTelemetry;
    readonly uuid?: DesignOptionUuidFactory;
  }) {
    this.#constraintDeriver = options.constraintDeriver;
    this.#repository = options.repository;
    this.#sourceVerifier = options.sourceVerifier;
    this.#telemetry = options.telemetry ?? designOptionTelemetry;
    this.#uuid = options.uuid ?? { randomUUID };
  }

  async createJob(
    command: Omit<
      CreateOptionJobCommand,
      | "acceptedBrief"
      | "assetManifestSha256"
      | "constraints"
      | "constraintsSha256"
      | "jobId"
      | "requestSha256"
      | "sourceSnapshot"
      | "workingModel"
      | "workingSnapshot"
    >,
  ): Promise<{ readonly job: OptionJob; readonly replayed: boolean }> {
    const request = normalizedRequest(command.request);
    const verified = await this.#sourceVerifier.findExactAcceptedInputs(
      command.actor.tenantId,
      command.projectId,
      request,
    );
    if (verified === undefined) {
      throw designOptionConflict(
        "SOURCE_CHANGED",
        "The exact accepted brief or committed source snapshot is unavailable or stale.",
      );
    }
    const working = workingModel(verified, this.#uuid.randomUUID());
    const derived = await this.#constraintDeriver.derive({
      brief: verified.brief,
      request,
      source: verified.source,
      workingModel: working.reference,
      workingSnapshot: working.snapshot,
    });
    const constraints = z
      .array(designConstraintSchema)
      .min(1)
      .max(200)
      .parse(derived.constraints)
      .sort((left, right) => left.id.localeCompare(right.id));
    if (new Set(constraints.map(({ id }) => id)).size !== constraints.length) {
      throw designOptionConflict(
        "CONSTRAINTS_FAILED",
        "Server-derived C12 constraints must have unique stable identifiers.",
        422,
      );
    }
    const assetManifestSha256 = sha256Schema.parse(derived.assetManifestSha256);
    const result = await this.#repository.createJob({
      ...command,
      acceptedBrief: verified.brief,
      assetManifestSha256,
      constraints,
      constraintsSha256: constraintsSha256(constraints),
      jobId: this.#uuid.randomUUID(),
      request,
      requestSha256: requestHash({ projectId: command.projectId, request }),
      sourceSnapshot: verified.source,
      workingModel: working.reference,
      workingSnapshot: working.snapshot,
    });
    this.#telemetry.record({
      count: constraints.length,
      outcome: result.replayed ? "replayed" : "accepted",
      stage: "create",
    });
    return result;
  }

  listJobs(tenantId: string, projectId: string) {
    return this.#repository.listJobs(tenantId, projectId);
  }

  async getJob(tenantId: string, projectId: string, jobId: string): Promise<OptionJob> {
    const job = await this.#repository.findJob(tenantId, projectId, jobId);
    if (job === undefined) throw notFound();
    return optionJobSchema.parse(job);
  }

  async listOptions(tenantId: string, projectId: string, jobId: string) {
    await this.getJob(tenantId, projectId, jobId);
    return this.#repository.listOptions(tenantId, projectId, jobId);
  }

  async getOption(tenantId: string, projectId: string, jobId: string, optionId: string) {
    await this.getJob(tenantId, projectId, jobId);
    const option = await this.#repository.findOption(tenantId, projectId, jobId, optionId);
    if (option === undefined) throw notFound();
    return option;
  }

  async cancelJob(command: TransitionOptionJobCommand) {
    const result = await this.#repository.cancelJob(command);
    this.#telemetry.record({
      outcome: result.replayed ? "replayed" : "accepted",
      stage: "cancel",
    });
    return result;
  }

  async retryJob(command: TransitionOptionJobCommand) {
    const current = await this.getJob(command.actor.tenantId, command.projectId, command.jobId);
    const request = createOptionJobRequestSchema.parse({
      baseBrief: current.baseBrief,
      requestedDirections: current.requestedDirections,
      requestedOptionCount: current.requestedOptionCount,
      sourceModel: current.sourceModel,
    });
    if (
      (await this.#sourceVerifier.findExactAcceptedInputs(
        command.actor.tenantId,
        command.projectId,
        request,
      )) === undefined
    ) {
      throw designOptionConflict(
        "SOURCE_CHANGED",
        "The exact accepted brief or source snapshot changed before retry.",
      );
    }
    const result = await this.#repository.retryJob(command);
    this.#telemetry.record({
      outcome: result.replayed ? "replayed" : "accepted",
      stage: "retry",
    });
    return result;
  }

  async confirmOption(command: Omit<ConfirmOptionCommand, "requestSha256">) {
    const result = await this.#repository.confirmOption({
      ...command,
      requestSha256: requestHash({
        jobId: command.jobId,
        optionId: command.optionId,
        projectId: command.projectId,
        request: command.request,
      }),
    });
    this.#telemetry.record({
      outcome: result.replayed ? "replayed" : "accepted",
      stage: "confirm",
    });
    return result;
  }
}
