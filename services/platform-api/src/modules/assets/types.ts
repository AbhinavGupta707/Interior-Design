import {
  assetUploadSessionSchema,
  type Actor,
  type Asset,
  type AssetProcessingCommand,
  type AssetProcessingResult,
  type AssetUploadSession,
  type CompleteAssetUploadRequest,
  type InitiateAssetUploadRequest,
  type SignAssetUploadPartRequest,
  type SignedAssetUploadPart,
} from "@interior-design/contracts";
import { z } from "zod";

import type { RequestCorrelation } from "../../correlation.js";

function hasSortedUniqueParts(parts: readonly number[]): boolean {
  for (let index = 1; index < parts.length; index += 1) {
    const previous = parts[index - 1];
    const current = parts[index];
    if (previous === undefined || current === undefined || current <= previous) {
      return false;
    }
  }
  return true;
}

/*
 * This local strict extension is intentionally shaped for the orchestrator-owned shared-schema
 * amendment. It can be replaced by that export without changing repository or route responses.
 */
export const resumableAssetUploadSessionSchema = assetUploadSessionSchema
  .extend({
    recordedPartNumbers: z.array(z.int().min(1).max(10_000)).max(10_000),
  })
  .strict()
  .refine((session) => hasSortedUniqueParts(session.recordedPartNumbers), {
    message: "Recorded upload parts must be sorted and unique.",
  });
export type ResumableAssetUploadSession = z.infer<typeof resumableAssetUploadSessionSchema>;

/*
 * Keep the types below public and locator-free. Provider identifiers and object keys only occur in
 * storage and processing command boundaries.
 */
export interface AssetAccessRequest {
  readonly representation: "original" | "preview" | "thumbnail";
}

export interface AssetAccessResponse {
  readonly contentDisposition: "attachment" | "inline";
  readonly expiresAt: string;
  readonly url: string;
}

interface UserMutationCommand {
  readonly actor: Actor;
  readonly correlation: RequestCorrelation;
  readonly idempotencyKey: string;
  readonly projectId: string;
}

export interface CreateUploadSessionCommand extends UserMutationCommand {
  readonly request: InitiateAssetUploadRequest;
}

export interface SignUploadPartCommand extends UserMutationCommand {
  readonly request: SignAssetUploadPartRequest;
  readonly sessionId: string;
}

export interface CompleteUploadCommand extends UserMutationCommand {
  readonly request: CompleteAssetUploadRequest;
  readonly sessionId: string;
}

export interface AbortUploadCommand extends UserMutationCommand {
  readonly sessionId: string;
}

export interface IssueAssetAccessCommand extends UserMutationCommand {
  readonly assetId: string;
  readonly request: AssetAccessRequest;
}

export interface AssetBackend {
  abortUpload(command: AbortUploadCommand): Promise<void>;
  cleanupExpiredSessions(limit?: number): Promise<number>;
  completeUpload(command: CompleteUploadCommand): Promise<Asset>;
  createUploadSession(command: CreateUploadSessionCommand): Promise<AssetUploadSession>;
  findAsset(tenantId: string, projectId: string, assetId: string): Promise<Asset | undefined>;
  findUploadSession(
    tenantId: string,
    projectId: string,
    sessionId: string,
  ): Promise<ResumableAssetUploadSession | undefined>;
  issueAccess(command: IssueAssetAccessCommand): Promise<AssetAccessResponse>;
  listAssets(tenantId: string, projectId: string): Promise<readonly Asset[]>;
  signUploadPart(command: SignUploadPartCommand): Promise<SignedAssetUploadPart>;
}

export interface LeasedAssetProcessingJob {
  readonly command: AssetProcessingCommand;
  readonly jobId: string;
  readonly leaseExpiresAt: string;
}

export interface CompleteProcessingJobCommand {
  readonly jobId: string;
  readonly result: AssetProcessingResult;
  readonly workerId: string;
}

export interface FailProcessingJobCommand {
  readonly errorCode: string;
  readonly jobId: string;
  readonly retryDelaySeconds: number;
  readonly workerId: string;
}

export interface AssetProcessingJobRepository {
  claimNext(workerId: string, leaseSeconds?: number): Promise<LeasedAssetProcessingJob | undefined>;
  complete(command: CompleteProcessingJobCommand): Promise<void>;
  fail(command: FailProcessingJobCommand): Promise<"failed" | "retryable">;
}
