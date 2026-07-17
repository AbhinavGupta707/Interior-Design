import type {
  Actor,
  CaptureArtifactUploadSession,
  CaptureProposalResult,
  CaptureSession,
  CreateCapturePackageRequest,
  CreateCaptureSessionRequest,
} from "@interior-design/contracts";
import type {
  capturePackageSchema,
  completeCaptureArtifactUploadRequestSchema,
  createCaptureArtifactUploadRequestSchema,
  signCaptureArtifactPartRequestSchema,
  signedCaptureArtifactPartSchema,
} from "@interior-design/contracts";
import type { z } from "zod";

export type CapturePackage = z.infer<typeof capturePackageSchema>;
export type CompleteCaptureArtifactUploadRequest = z.infer<
  typeof completeCaptureArtifactUploadRequestSchema
>;
export type CreateCaptureArtifactUploadRequest = z.infer<
  typeof createCaptureArtifactUploadRequestSchema
>;
export type SignCaptureArtifactPartRequest = z.infer<typeof signCaptureArtifactPartRequestSchema>;
export type SignedCaptureArtifactPart = z.infer<typeof signedCaptureArtifactPartSchema>;

// RequestCorrelation lives in the API rather than the shared package. This structural alias keeps
// capture commands independent of Fastify while retaining the exact redacted audit fields.
export interface CaptureCorrelation {
  readonly requestId: string;
  readonly traceId: string;
}

export interface CaptureClock {
  now(): Date;
}

export interface CaptureUuidFactory {
  create(): string;
}

interface UserMutation {
  readonly actor: Actor;
  readonly correlation: CaptureCorrelation;
  readonly idempotencyKey: string;
  readonly projectId: string;
}

export interface CreateCaptureSessionCommand extends UserMutation {
  readonly request: CreateCaptureSessionRequest;
}

export interface CaptureSessionMutationCommand extends UserMutation {
  readonly captureSessionId: string;
}

export interface CreateArtifactUploadCommand extends CaptureSessionMutationCommand {
  readonly request: CreateCaptureArtifactUploadRequest;
}

export interface ArtifactUploadMutationCommand extends CaptureSessionMutationCommand {
  readonly uploadSessionId: string;
}

export interface SignArtifactPartCommand extends ArtifactUploadMutationCommand {
  readonly request: SignCaptureArtifactPartRequest;
}

export interface CompleteArtifactUploadCommand extends ArtifactUploadMutationCommand {
  readonly request: CompleteCaptureArtifactUploadRequest;
}

export interface FinalizeCapturePackageCommand extends CaptureSessionMutationCommand {
  readonly request: CreateCapturePackageRequest;
}

export interface WithdrawCaptureRightsCommand {
  readonly actorUserId?: string;
  readonly captureSessionId: string;
  readonly correlation: CaptureCorrelation;
  readonly projectId: string;
  readonly reasonCode: "RIGHTS_WITHDRAWN" | "SERVICE_PROCESSING_REVOKED";
  readonly tenantId: string;
}

export interface MutationResult<T> {
  readonly replayed: boolean;
  readonly value: T;
}

export interface CaptureBackend {
  cancelSession(command: CaptureSessionMutationCommand): Promise<MutationResult<CaptureSession>>;
  completeArtifactUpload(
    command: CompleteArtifactUploadCommand,
  ): Promise<MutationResult<CaptureArtifactUploadSession>>;
  createArtifactUpload(
    command: CreateArtifactUploadCommand,
  ): Promise<MutationResult<CaptureArtifactUploadSession>>;
  createSession(command: CreateCaptureSessionCommand): Promise<MutationResult<CaptureSession>>;
  expireOpenSessions(limit?: number): Promise<number>;
  finalizePackage(command: FinalizeCapturePackageCommand): Promise<MutationResult<CapturePackage>>;
  findArtifactUpload(
    tenantId: string,
    projectId: string,
    captureSessionId: string,
    uploadSessionId: string,
  ): Promise<CaptureArtifactUploadSession | undefined>;
  findProposal(
    tenantId: string,
    projectId: string,
    captureSessionId: string,
  ): Promise<CaptureProposalResult | undefined>;
  findSession(
    tenantId: string,
    projectId: string,
    captureSessionId: string,
  ): Promise<CaptureSession | undefined>;
  listSessions(tenantId: string, projectId: string): Promise<readonly CaptureSession[]>;
  retrySession(command: CaptureSessionMutationCommand): Promise<MutationResult<CaptureSession>>;
  signArtifactPart(
    command: SignArtifactPartCommand,
  ): Promise<MutationResult<SignedCaptureArtifactPart>>;
  withdrawRights(command: WithdrawCaptureRightsCommand): Promise<CaptureSession | undefined>;
}
