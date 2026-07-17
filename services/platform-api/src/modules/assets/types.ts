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

import type { RequestCorrelation } from "../../correlation.js";

export const resumableAssetUploadSessionSchema = assetUploadSessionSchema;
export type ResumableAssetUploadSession = AssetUploadSession;

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
