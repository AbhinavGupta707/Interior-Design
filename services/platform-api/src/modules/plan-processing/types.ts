import type {
  Actor,
  C6SupportedPlanMimeType,
  ModelBranch,
  PlanCalibration,
  PlanOperationDraft,
  PlanParserResult,
  PlanProcessingJob,
} from "@interior-design/contracts";
import type {
  createPlanCalibrationRequestSchema,
  createPlanOperationDraftRequestSchema,
} from "@interior-design/contracts";
import type { z } from "zod";

import type { RequestCorrelation } from "../../correlation.js";

export interface PlanProcessingClock {
  now(): Date;
}

export interface PlanProcessingUuidFactory {
  randomUUID(): string;
}

export interface EligiblePlanSource {
  readonly assetId: string;
  readonly byteSize: number;
  readonly detectedMimeType?: string;
  readonly kind: string;
  readonly projectId: string;
  readonly rights: {
    readonly basis: string;
    readonly serviceProcessingConsent: boolean;
    readonly trainingUseConsent: string;
  };
  readonly sha256: string;
  readonly status: string;
  readonly tenantId: string;
}

interface MutationCommand {
  readonly actor: Actor;
  readonly correlation: RequestCorrelation;
  readonly idempotencyKey: string;
  readonly projectId: string;
}

export interface CreatePlanJobCommand extends MutationCommand {
  readonly assetId: string;
  readonly pageIndex: number;
  readonly parserPreference: "auto" | "fixture" | "raster" | "vector";
  readonly sourceSha256: string;
}

export interface TransitionPlanJobCommand extends MutationCommand {
  readonly expectedVersion: number;
  readonly jobId: string;
}

export interface CreateCalibrationCommand extends MutationCommand {
  readonly jobId: string;
  readonly request: z.infer<typeof createPlanCalibrationRequestSchema>;
  readonly residualMillimetres: number;
}

export interface CreateOperationDraftCommand extends MutationCommand {
  readonly jobId: string;
  readonly request: z.infer<typeof createPlanOperationDraftRequestSchema>;
}

export interface BranchTarget {
  readonly branch: ModelBranch;
  readonly snapshot: unknown;
}

export interface PlanProcessingRepository {
  cancelJob(
    command: TransitionPlanJobCommand,
  ): Promise<{ readonly job: PlanProcessingJob; readonly replayed: boolean }>;
  createCalibration(
    command: CreateCalibrationCommand,
  ): Promise<{ readonly calibration: PlanCalibration; readonly replayed: boolean }>;
  createJob(
    command: CreatePlanJobCommand,
  ): Promise<{ readonly job: PlanProcessingJob; readonly replayed: boolean }>;
  createOperationDraft(
    command: CreateOperationDraftCommand,
  ): Promise<{ readonly draft: PlanOperationDraft; readonly replayed: boolean }>;
  findBranchTarget(
    tenantId: string,
    projectId: string,
    profile: "as-built" | "existing" | "proposed",
    branchId: string,
  ): Promise<BranchTarget | undefined>;
  findCalibration(
    tenantId: string,
    projectId: string,
    jobId: string,
    calibrationId: string,
  ): Promise<PlanCalibration | undefined>;
  findJob(
    tenantId: string,
    projectId: string,
    jobId: string,
  ): Promise<PlanProcessingJob | undefined>;
  findPlanSource(
    tenantId: string,
    projectId: string,
    assetId: string,
  ): Promise<EligiblePlanSource | undefined>;
  findResult(
    tenantId: string,
    projectId: string,
    jobId: string,
  ): Promise<PlanParserResult | undefined>;
  listJobs(tenantId: string, projectId: string): Promise<readonly PlanProcessingJob[]>;
  retryJob(
    command: TransitionPlanJobCommand,
  ): Promise<{ readonly job: PlanProcessingJob; readonly replayed: boolean }>;
}

export interface ParsedEligiblePlanSource extends EligiblePlanSource {
  readonly detectedMimeType: C6SupportedPlanMimeType;
  readonly kind: "plan";
  readonly rights: {
    readonly basis: "licensed" | "owned-by-user" | "permission-granted" | "public-domain";
    readonly serviceProcessingConsent: true;
    readonly trainingUseConsent: "denied";
  };
  readonly status: "ready";
}
