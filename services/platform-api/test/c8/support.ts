import {
  createReconstructionJobRequestSchema,
  reconstructionJobSchema,
  reconstructionResultSchema,
  type CreateReconstructionJobRequest,
  type ReconstructionJob,
  type ReconstructionResult,
} from "@interior-design/contracts";
import { randomUUID } from "node:crypto";

import { reconstructionConflict } from "../../src/modules/reconstruction/errors.js";
import type {
  AcknowledgeReconstructionCancellationCommand,
  AdvanceReconstructionAttemptCommand,
  ClaimReconstructionAttemptCommand,
  CreateReconstructionJobCommand,
  EligibleReconstructionSource,
  FailReconstructionAttemptCommand,
  PublishReconstructionResultCommand,
  ReconstructionRepository,
  TransitionReconstructionJobCommand,
  WithdrawReconstructionSourceCommand,
} from "../../src/modules/reconstruction/types.js";
import { alphaProjectId, alphaTenantId } from "../c4/fixtures.js";
import { c6Now } from "../c6/support.js";

export const imageAssetId = "89000000-0000-4000-8000-000000000001";
export const videoAssetId = "89000000-0000-4000-8000-000000000002";
export const imageSha256 = "8".repeat(64);
export const videoSha256 = "9".repeat(64);

export const reconstructionRequest = createReconstructionJobRequestSchema.parse({
  appearanceMode: "optional",
  label: "Visibly synthetic ground-floor reconstruction",
  mode: "rgb-sfm",
  registrationAnchors: [],
  rights: {
    basis: "owned-by-user",
    serviceProcessingConsent: true,
    trainingUseConsent: "denied",
  },
  sources: [
    {
      assetId: imageAssetId,
      byteSize: 1_024,
      detectedMimeType: "image/jpeg",
      kind: "rgb-image",
      sha256: imageSha256,
    },
  ],
});

export function eligibleSource(
  assetId = imageAssetId,
  overrides: Partial<EligibleReconstructionSource> = {},
): EligibleReconstructionSource {
  const video = assetId === videoAssetId;
  return {
    assetId,
    byteSize: video ? 2_048 : 1_024,
    detectedMimeType: video ? "video/mp4" : "image/jpeg",
    projectId: alphaProjectId,
    rights: {
      basis: "owned-by-user",
      serviceProcessingConsent: true,
      trainingUseConsent: "denied",
    },
    sha256: video ? videoSha256 : imageSha256,
    status: "ready",
    tenantId: alphaTenantId,
    withdrawn: false,
    ...overrides,
  };
}

function updatedAt(version: number): string {
  return new Date(new Date(c6Now).getTime() + version).toISOString();
}

export class MemoryReconstructionRepository implements ReconstructionRepository {
  readonly idempotency = new Map<
    string,
    { readonly body: string; readonly job: ReconstructionJob }
  >();
  readonly jobs = new Map<string, ReconstructionJob>();
  readonly results = new Map<string, ReconstructionResult>();
  readonly sources = new Map<string, EligibleReconstructionSource>([
    [imageAssetId, eligibleSource()],
    [videoAssetId, eligibleSource(videoAssetId)],
  ]);
  lastCreate?: CreateReconstructionJobCommand;

  findSource(tenantId: string, projectId: string, assetId: string) {
    const source = this.sources.get(assetId);
    return Promise.resolve(
      source?.tenantId === tenantId && source.projectId === projectId ? source : undefined,
    );
  }

  createJob(command: CreateReconstructionJobCommand) {
    this.lastCreate = command;
    const key = `${command.actor.tenantId}:${command.idempotencyKey}`;
    const body = JSON.stringify({ projectId: command.projectId, request: command.request });
    const stored = this.idempotency.get(key);
    if (stored) {
      if (stored.body !== body) {
        throw reconstructionConflict(
          "IDEMPOTENCY_CONFLICT",
          "The key is bound to different synthetic request bytes.",
        );
      }
      return Promise.resolve({ job: stored.job, replayed: true });
    }
    const job = reconstructionJobSchema.parse({
      attempt: 1,
      createdAt: c6Now,
      id: randomUUID(),
      projectId: command.projectId,
      request: command.request,
      retryable: false,
      schemaVersion: "c8-reconstruction-job-v1",
      state: "created",
      updatedAt: c6Now,
      version: 1,
    });
    this.jobs.set(job.id, job);
    this.idempotency.set(key, { body, job });
    return Promise.resolve({ job, replayed: false });
  }

  listJobs(tenantId: string, projectId: string) {
    return Promise.resolve(
      tenantId === alphaTenantId && projectId === alphaProjectId ? [...this.jobs.values()] : [],
    );
  }

  findJob(tenantId: string, projectId: string, reconstructionJobId: string) {
    return Promise.resolve(
      tenantId === alphaTenantId && projectId === alphaProjectId
        ? this.jobs.get(reconstructionJobId)
        : undefined,
    );
  }

  findResult(tenantId: string, projectId: string, reconstructionJobId: string) {
    return Promise.resolve(
      tenantId === alphaTenantId && projectId === alphaProjectId
        ? this.results.get(reconstructionJobId)
        : undefined,
    );
  }

  cancelJob(command: TransitionReconstructionJobCommand) {
    const current = this.jobs.get(command.reconstructionJobId);
    if (!current) throw reconstructionConflict("NOT_FOUND", "Synthetic job absent.");
    if (current.version !== command.expectedVersion) {
      throw reconstructionConflict("RECONSTRUCTION_JOB_VERSION_CONFLICT", "Reload the job.");
    }
    const job = reconstructionJobSchema.parse({
      ...current,
      retryable: true,
      state: "cancelled",
      updatedAt: updatedAt(current.version + 1),
      version: current.version + 1,
    });
    this.jobs.set(job.id, job);
    return Promise.resolve({ job, replayed: false });
  }

  retryJob(command: TransitionReconstructionJobCommand) {
    const current = this.jobs.get(command.reconstructionJobId);
    if (!current) throw reconstructionConflict("NOT_FOUND", "Synthetic job absent.");
    if (current.version !== command.expectedVersion || !current.retryable) {
      throw reconstructionConflict("RECONSTRUCTION_JOB_NOT_RETRYABLE", "Reload the job.");
    }
    const job = reconstructionJobSchema.parse({
      ...current,
      attempt: current.attempt + 1,
      retryable: false,
      state: "created",
      updatedAt: updatedAt(current.version + 1),
      version: current.version + 1,
    });
    this.jobs.set(job.id, job);
    return Promise.resolve({ job, replayed: false });
  }

  claimNext(command: ClaimReconstructionAttemptCommand) {
    void command;
    return Promise.resolve(undefined);
  }

  advanceAttempt(command: AdvanceReconstructionAttemptCommand) {
    void command;
    return Promise.reject(new Error("Worker flow is exercised by the Postgres fixture."));
  }

  publishResult(command: PublishReconstructionResultCommand) {
    void command;
    return Promise.reject(new Error("Worker flow is exercised by the Postgres fixture."));
  }

  failAttempt(command: FailReconstructionAttemptCommand) {
    void command;
    return Promise.reject(new Error("Worker flow is exercised by the Postgres fixture."));
  }

  acknowledgeCancellation(command: AcknowledgeReconstructionCancellationCommand) {
    void command;
    return Promise.reject(new Error("Worker flow is exercised by the Postgres fixture."));
  }

  withdrawSource(command: WithdrawReconstructionSourceCommand) {
    const source = this.sources.get(command.assetId);
    if (source) this.sources.set(command.assetId, { ...source, withdrawn: true });
    return Promise.resolve(source ? 1 : 0);
  }
}

export function completedResult(input: {
  readonly jobId: string;
  readonly projectId?: string;
  readonly sourceManifestSha256: string;
}): ReconstructionResult {
  const tool = {
    adapterId: "synthetic.geometry",
    adapterVersion: "1.0.0-fixture",
    configSha256: "a".repeat(64),
    executableVersion: "fixture-only",
  };
  const artifact = (kind: "calibrated-cameras" | "sparse-point-cloud", digit: string) => ({
    artifactId: randomUUID(),
    byteSize: 1_024,
    contentSha256: digit.repeat(64),
    dimensionalAuthority: "proposal-only" as const,
    kind,
    mediaType: "application/json",
    sourceManifestSha256: input.sourceManifestSha256,
    toolManifestSha256: "d".repeat(64),
  });
  return reconstructionResultSchema.parse({
    createdAt: c6Now,
    findings: [
      "SYNTHETIC_FIXTURE_ONLY",
      "PARTIAL_REGISTRATION",
      "DISCONNECTED_COMPONENTS",
      "SCALE_UNKNOWN",
    ],
    geometry: {
      alignment: { anchorCount: 0 },
      artifacts: [artifact("calibrated-cameras", "b"), artifact("sparse-point-cloud", "c")],
      componentCount: 2,
      coordinateSystem: "right-handed-local",
      inputFrameCount: 10,
      manifestSha256: "e".repeat(64),
      registeredFrameCount: 6,
      scaleStatus: "unknown",
      schemaVersion: "c8-geometry-result-v1",
      tool,
      unit: "arbitrary-units",
    },
    jobId: input.jobId,
    projectId: input.projectId ?? alphaProjectId,
    resultId: randomUUID(),
    schemaVersion: "c8-reconstruction-result-v1",
    sourceManifestSha256: input.sourceManifestSha256,
    status: "completed",
  });
}

export function abstainedResult(input: {
  readonly jobId: string;
  readonly projectId?: string;
  readonly sourceManifestSha256: string;
}): ReconstructionResult {
  return reconstructionResultSchema.parse({
    createdAt: c6Now,
    diagnosticArtifact: {
      artifactId: randomUUID(),
      byteSize: 512,
      contentSha256: "f".repeat(64),
      dimensionalAuthority: "proposal-only",
      kind: "diagnostics",
      mediaType: "application/json",
      sourceManifestSha256: input.sourceManifestSha256,
      toolManifestSha256: "d".repeat(64),
    },
    findings: ["INSUFFICIENT_OVERLAP", "SYNTHETIC_FIXTURE_ONLY"],
    jobId: input.jobId,
    projectId: input.projectId ?? alphaProjectId,
    resultId: randomUUID(),
    safeCode: "INSUFFICIENT_OVERLAP",
    schemaVersion: "c8-reconstruction-result-v1",
    sourceManifestSha256: input.sourceManifestSha256,
    status: "abstained",
  });
}

export function requestWithSources(
  sources: CreateReconstructionJobRequest["sources"],
): CreateReconstructionJobRequest {
  return createReconstructionJobRequestSchema.parse({ ...reconstructionRequest, sources });
}
