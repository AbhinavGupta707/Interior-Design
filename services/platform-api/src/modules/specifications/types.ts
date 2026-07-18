import type {
  Actor,
  CanonicalHomeSnapshot,
  CatalogAssetVersion,
  CatalogRelease,
  C12ConfirmationSource,
  ModelOperationRequest,
  OptionOperationBundle,
  Specification,
  SpecificationLine,
  SpecificationRevision,
  SubstitutionConfirmation,
  SubstitutionPreview,
  confirmSubstitutionRequestSchema,
  createSpecificationRequestSchema,
  createSubstitutionPreviewRequestSchema,
  updateSelectionBoardRequestSchema,
} from "@interior-design/contracts";
import type { SpecificationScheduleKind } from "@interior-design/specification";
import type { z } from "zod";

import type { RequestCorrelation } from "../../correlation.js";

export type ConfirmSubstitutionRequest = z.infer<typeof confirmSubstitutionRequestSchema>;
export type CreateSpecificationRequest = z.infer<typeof createSpecificationRequestSchema>;
export type CreateSubstitutionPreviewRequest = z.infer<
  typeof createSubstitutionPreviewRequestSchema
>;
export type UpdateSelectionBoardRequest = z.infer<typeof updateSelectionBoardRequestSchema>;

export interface SpecificationClock {
  now(): Date;
}

export interface SpecificationUuidFactory {
  randomUUID(): string;
}

export interface VerifiedSpecificationCreationSource {
  readonly assets: readonly CatalogAssetVersion[];
  readonly bundle: OptionOperationBundle;
  readonly catalogRelease: CatalogRelease;
  readonly catalogReleaseSha256: string;
  readonly snapshot: CanonicalHomeSnapshot;
  readonly source: C12ConfirmationSource;
}

export interface VerifiedSubstitutionSource {
  readonly asset: CatalogAssetVersion;
  readonly branchRevision: number;
  readonly branchSnapshotId: string;
  readonly branchSnapshotSha256: string;
  readonly branchSnapshotVersion: number;
  readonly currentRevision: SpecificationRevision;
  readonly line: SpecificationLine;
  readonly snapshot: CanonicalHomeSnapshot;
  readonly specificationId: string;
}

interface ActorCommand {
  readonly actor: Actor;
  readonly correlation: RequestCorrelation;
  readonly projectId: string;
}

export interface CreateSpecificationCommand extends ActorCommand {
  readonly idempotencyKey: string;
  readonly request: CreateSpecificationRequest;
  readonly requestSha256: string;
  readonly specification: Specification;
  readonly verified: VerifiedSpecificationCreationSource;
}

export interface UpdateSelectionBoardCommand extends ActorCommand {
  readonly idempotencyKey: string;
  readonly request: UpdateSelectionBoardRequest;
  readonly requestSha256: string;
  readonly specificationId: string;
}

export interface PersistSubstitutionPreviewCommand extends ActorCommand {
  readonly idempotencyKey: string;
  readonly operation: Extract<
    ModelOperationRequest,
    { readonly type: "design.element.replace.v1" }
  >;
  readonly preview: SubstitutionPreview;
  readonly request: CreateSubstitutionPreviewRequest;
  readonly requestSha256: string;
  readonly verified: VerifiedSubstitutionSource;
}

export interface ConfirmSubstitutionCommand extends ActorCommand {
  readonly confirmationId: string;
  readonly idempotencyKey: string;
  readonly request: ConfirmSubstitutionRequest;
  readonly requestSha256: string;
  readonly sceneJobId: string;
  readonly specificationId: string;
}

export interface SpecificationSceneRequest {
  readonly branchId: string;
  readonly branchRevision: number;
  readonly modelSnapshotId: string;
  readonly modelSnapshotSha256: string;
  readonly projectId: string;
  readonly sceneJobId: string;
  readonly specificationId: string;
  readonly specificationRevision: number;
}

export interface SpecificationSceneBinding {
  readonly branchId: string;
  readonly branchRevision: number;
  readonly catalogReleaseId: string;
  readonly catalogReleaseSha256: string;
  readonly lines: readonly SpecificationLine[];
  readonly modelSnapshotId: string;
  readonly modelSnapshotSha256: string;
  readonly projectId: string;
  readonly revisionSha256: string;
  readonly sceneJobId: string;
  readonly specificationId: string;
  readonly specificationRevision: number;
}

export interface SpecificationSceneBindingResolver {
  resolveConfirmedSceneBinding(
    tenantId: string,
    projectId: string,
    sceneJobId: string,
  ): Promise<SpecificationSceneBinding | undefined>;
}

export interface SpecificationSceneJobPort {
  requestExactRevision(input: SpecificationSceneRequest): Promise<void>;
}

export interface ConfirmationPersistenceResult {
  readonly confirmation: SubstitutionConfirmation;
  readonly replayed: boolean;
  readonly sceneRequest: SpecificationSceneRequest;
}

export interface SpecificationRepository extends SpecificationSceneBindingResolver {
  confirmSubstitution(command: ConfirmSubstitutionCommand): Promise<ConfirmationPersistenceResult>;
  createSpecification(
    command: CreateSpecificationCommand,
  ): Promise<{ readonly replayed: boolean; readonly specification: Specification }>;
  findSpecification(
    tenantId: string,
    projectId: string,
    specificationId: string,
  ): Promise<Specification | undefined>;
  findSubstitutionPreview(
    tenantId: string,
    projectId: string,
    specificationId: string,
    previewId: string,
  ): Promise<SubstitutionPreview | undefined>;
  listRevisions(
    tenantId: string,
    projectId: string,
    specificationId: string,
  ): Promise<readonly SpecificationRevision[]>;
  listSpecifications(tenantId: string, projectId: string): Promise<readonly Specification[]>;
  persistSubstitutionPreview(
    command: PersistSubstitutionPreviewCommand,
  ): Promise<{ readonly preview: SubstitutionPreview; readonly replayed: boolean }>;
  recordSceneRequest(
    tenantId: string,
    projectId: string,
    sceneJobId: string,
    outcome: "requested" | "retry-required",
    safeCode?: "SCENE_REQUEST_FAILED",
  ): Promise<void>;
  resolveCreationSource(
    tenantId: string,
    projectId: string,
    request: CreateSpecificationRequest,
  ): Promise<VerifiedSpecificationCreationSource | undefined>;
  resolveSubstitutionSource(
    tenantId: string,
    projectId: string,
    specificationId: string,
    request: CreateSubstitutionPreviewRequest,
  ): Promise<VerifiedSubstitutionSource | undefined>;
  updateSelectionBoard(
    command: UpdateSelectionBoardCommand,
  ): Promise<{ readonly replayed: boolean; readonly specification: Specification }>;
}

export interface SpecificationTelemetry {
  record(event: {
    readonly count?: number;
    readonly outcome: "accepted" | "conflict" | "failed" | "replayed" | "retry-required";
    readonly stage: "confirm" | "create" | "preview" | "read" | "scene" | "schedule" | "update";
  }): void;
}

export interface SpecificationScheduleResponse {
  readonly groups: readonly {
    readonly key: string;
    readonly lines: readonly SpecificationLine[];
    readonly schedule: SpecificationScheduleKind;
  }[];
  readonly revision: number;
  readonly specificationId: string;
}
