import {
  captureArtifactUploadSessionSchema,
  captureSessionSchema,
  type CaptureArtifactUploadSession,
  type CaptureProposalResult,
  type CaptureSession,
} from "@interior-design/contracts";

import { captureConflict } from "../../src/modules/capture/errors.js";
import type {
  CaptureBackend,
  CapturePackage,
  CaptureSessionMutationCommand,
  CompleteArtifactUploadCommand,
  CreateArtifactUploadCommand,
  CreateCaptureSessionCommand,
  FinalizeCapturePackageCommand,
  MutationResult,
  SignArtifactPartCommand,
  SignedCaptureArtifactPart,
  WithdrawCaptureRightsCommand,
} from "../../src/modules/capture/types.js";
import { c6Now, c6Project } from "../c6/support.js";

export const c7CaptureSessionId = "87000000-0000-4000-8000-000000000001";
export const c7ArtifactId = "87000000-0000-4000-8000-000000000002";
export const c7UploadSessionId = "87000000-0000-4000-8000-000000000003";

export class MemoryCaptureBackend implements CaptureBackend {
  readonly sessions = new Map<string, CaptureSession>();
  readonly uploads = new Map<string, CaptureArtifactUploadSession>();
  readonly idempotency = new Map<
    string,
    { readonly body: string; readonly value: CaptureSession }
  >();

  createSession(command: CreateCaptureSessionCommand): Promise<MutationResult<CaptureSession>> {
    const key = `${command.actor.tenantId}:${command.idempotencyKey}`;
    const body = JSON.stringify(command.request);
    const existing = this.idempotency.get(key);
    if (existing !== undefined) {
      if (existing.body !== body) {
        throw captureConflict(
          "IDEMPOTENCY_CONFLICT",
          "The idempotency key is bound to different synthetic request bytes.",
        );
      }
      return Promise.resolve({ replayed: true, value: existing.value });
    }
    const session = captureSessionSchema.parse({
      brief: {
        captureLabel: command.request.captureLabel,
        captureSessionId: c7CaptureSessionId,
        expiresAt: "2026-07-18T12:00:00.000Z",
        ...(command.request.expectedRoomCount === undefined
          ? {}
          : { expectedRoomCount: command.request.expectedRoomCount }),
        instructionsVersion: "c7-roomplan-instructions-1.0.0",
        mode: command.request.mode,
        projectId: command.projectId,
        rights: command.request.rights,
        schemaVersion: "c7-capture-session-v1",
      },
      createdAt: c6Now,
      id: c7CaptureSessionId,
      projectId: command.projectId,
      retryable: false,
      schemaVersion: "c7-capture-session-v1",
      state: "created",
      updatedAt: c6Now,
      version: 1,
    });
    this.sessions.set(session.id, session);
    this.idempotency.set(key, { body, value: session });
    return Promise.resolve({ replayed: false, value: session });
  }

  listSessions(tenantId: string, projectId: string): Promise<readonly CaptureSession[]> {
    return Promise.resolve(
      tenantId === c6Project.tenantId && projectId === c6Project.id
        ? [...this.sessions.values()]
        : [],
    );
  }

  findSession(
    tenantId: string,
    projectId: string,
    captureSessionId: string,
  ): Promise<CaptureSession | undefined> {
    return Promise.resolve(
      tenantId === c6Project.tenantId && projectId === c6Project.id
        ? this.sessions.get(captureSessionId)
        : undefined,
    );
  }

  createArtifactUpload(
    command: CreateArtifactUploadCommand,
  ): Promise<MutationResult<CaptureArtifactUploadSession>> {
    if (this.sessions.get(command.captureSessionId) === undefined) {
      return Promise.reject(new Error("Synthetic capture session absent."));
    }
    const upload = captureArtifactUploadSessionSchema.parse({
      artifactId: c7ArtifactId,
      captureSessionId: command.captureSessionId,
      expiresAt: "2026-07-18T12:00:00.000Z",
      maximumPartCount: 10_000,
      minimumNonFinalPartSize: 5_242_880,
      partSize: 8_388_608,
      recordedPartNumbers: [],
      state: "initiated",
      uploadSessionId: c7UploadSessionId,
    });
    this.uploads.set(upload.uploadSessionId, upload);
    return Promise.resolve({ replayed: false, value: upload });
  }

  findArtifactUpload(
    tenantId: string,
    projectId: string,
    captureSessionId: string,
    uploadSessionId: string,
  ): Promise<CaptureArtifactUploadSession | undefined> {
    const upload = this.uploads.get(uploadSessionId);
    return Promise.resolve(
      tenantId === c6Project.tenantId &&
        projectId === c6Project.id &&
        upload?.captureSessionId === captureSessionId
        ? upload
        : undefined,
    );
  }

  signArtifactPart(
    command: SignArtifactPartCommand,
  ): Promise<MutationResult<SignedCaptureArtifactPart>> {
    const current = this.uploads.get(command.uploadSessionId);
    if (current === undefined) return Promise.reject(new Error("Synthetic upload absent."));
    this.uploads.set(
      command.uploadSessionId,
      captureArtifactUploadSessionSchema.parse({
        ...current,
        recordedPartNumbers: [command.request.partNumber],
        state: "uploading",
      }),
    );
    return Promise.resolve({
      replayed: false,
      value: {
        expiresAt: "2026-07-17T12:15:00.000Z",
        partNumber: command.request.partNumber,
        requiredHeaders: {
          "content-length": String(command.request.byteSize),
          "x-amz-checksum-sha256": command.request.checksumSha256,
        },
        url: "https://storage.invalid/synthetic-c7-part",
      },
    });
  }

  completeArtifactUpload(
    command: CompleteArtifactUploadCommand,
  ): Promise<MutationResult<CaptureArtifactUploadSession>> {
    const current = this.uploads.get(command.uploadSessionId);
    if (current === undefined) return Promise.reject(new Error("Synthetic upload absent."));
    const completed = captureArtifactUploadSessionSchema.parse({
      ...current,
      recordedPartNumbers: command.request.parts.map(({ partNumber }) => partNumber),
      state: "completed",
    });
    this.uploads.set(command.uploadSessionId, completed);
    return Promise.resolve({ replayed: false, value: completed });
  }

  cancelSession(command: CaptureSessionMutationCommand): Promise<MutationResult<CaptureSession>> {
    const current = this.sessions.get(command.captureSessionId);
    if (current === undefined) return Promise.reject(new Error("Synthetic session absent."));
    const cancelled = captureSessionSchema.parse({
      ...current,
      state: "cancelled",
      updatedAt: "2026-07-17T12:01:00.000Z",
      version: current.version + 1,
    });
    this.sessions.set(cancelled.id, cancelled);
    return Promise.resolve({ replayed: false, value: cancelled });
  }

  retrySession(command: CaptureSessionMutationCommand): Promise<MutationResult<CaptureSession>> {
    const current = this.sessions.get(command.captureSessionId);
    return current === undefined
      ? Promise.reject(new Error("Synthetic session absent."))
      : Promise.resolve({ replayed: false, value: current });
  }

  finalizePackage(
    _command: FinalizeCapturePackageCommand,
  ): Promise<MutationResult<CapturePackage>> {
    void _command;
    return Promise.reject(
      new Error("Package finalization is covered by the live persistence test."),
    );
  }

  findProposal(
    _tenantId: string,
    _projectId: string,
    _captureSessionId: string,
  ): Promise<CaptureProposalResult | undefined> {
    void _tenantId;
    void _projectId;
    void _captureSessionId;
    return Promise.resolve(undefined);
  }

  withdrawRights(_command: WithdrawCaptureRightsCommand): Promise<CaptureSession | undefined> {
    void _command;
    return Promise.resolve(undefined);
  }

  expireOpenSessions(_limit?: number): Promise<number> {
    void _limit;
    return Promise.resolve(0);
  }
}
