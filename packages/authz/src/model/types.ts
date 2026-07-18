import type {
  Actor,
  MemberRole,
  ModelOperationType,
  ModelProfile,
} from "@interior-design/contracts";

import type { ProjectAction } from "../index.js";

export const modelActions = Object.freeze([
  "model:branch:create",
  "model:branch:read",
  "model:branch:compare",
  "model:operation:preview",
  "model:operation:commit",
  "model:branch:restore",
  "model:operation:history",
  "model:audit:read",
] as const satisfies readonly ProjectAction[]);

export type ModelAction = (typeof modelActions)[number];

export const publicModelOperationTypes = Object.freeze([
  "level.create.v1",
  "wall.create.v1",
  "wall.translate.v1",
  "opening.insert.v1",
  "space.create.v1",
  "space.rename.v1",
  "element.metadata.correct.v1",
  "element.provenance.correct.v1",
  "design.element.create.v1",
  "design.element.replace.v1",
  "design.element.remove.v1",
] as const satisfies readonly ModelOperationType[]);

export type PublicModelOperationType = (typeof publicModelOperationTypes)[number];

export interface ModelResource {
  readonly branchId?: string;
  readonly modelId: string;
  readonly profile: ModelProfile;
  readonly projectId: string;
  readonly tenantId: string;
}

export interface CurrentModelMembership {
  readonly role: MemberRole;
  readonly status: "active" | "revoked";
  readonly tenantId: string;
  readonly userId: string;
}

export interface HumanModelActorContext {
  /** Actor attributed on the requested operation; never source this from a request body. */
  readonly actor: Actor;
  /** Actor returned by the authenticated session boundary for this request. */
  readonly authenticatedActor: Actor;
  /** Membership freshly loaded for this request, including replays and confirmation. */
  readonly currentMembership: CurrentModelMembership;
  readonly kind: "human";
}

export interface MachineModelPrincipal {
  readonly delegatedByUserId: string;
  readonly serviceId: string;
  readonly tenantId: string;
}

export interface AuthenticatedMachinePrincipal extends MachineModelPrincipal {
  readonly allowedActions: readonly ModelAction[];
  readonly expiresAt: string;
}

export interface MachineModelActorContext {
  /** Machine attribution carried by the proposal envelope. */
  readonly actor: MachineModelPrincipal;
  /** Principal established by the separate internal service-authentication boundary. */
  readonly authenticatedMachine: AuthenticatedMachinePrincipal;
  /** Current human member on whose behalf the proposal is produced. */
  readonly currentMembership: CurrentModelMembership;
  readonly delegatedActor: Actor;
  readonly kind: "machine";
}

export interface SupportPrincipal {
  readonly supportAgentId: string;
}

export interface AuthenticatedSupportPrincipal extends SupportPrincipal {
  readonly expiresAt: string;
}

export interface SupportModelActorContext {
  readonly actor: SupportPrincipal;
  readonly authenticatedSupport: AuthenticatedSupportPrincipal;
  readonly kind: "support";
}

export type ModelActorContext = HumanModelActorContext | MachineModelActorContext;
export type ModelAuditActorContext = ModelActorContext | SupportModelActorContext;

export interface ModelPreviewAuthority {
  readonly confirmationActorUserId: string;
  readonly consumedAt?: string;
  readonly expiresAt: string;
  readonly id: string;
  readonly operationTypes: readonly PublicModelOperationType[];
  readonly proposedBy:
    | { readonly id: string; readonly kind: "human"; readonly tenantId: string }
    | { readonly id: string; readonly kind: "machine"; readonly tenantId: string };
  readonly resource: ModelResource & { readonly branchId: string };
}

export interface AuthoriseModelActionInput {
  readonly action: ModelAction;
  readonly context: ModelActorContext;
  readonly operationTypes?: readonly PublicModelOperationType[];
  readonly preview?: ModelPreviewAuthority;
  readonly requestedPreviewId?: string;
  readonly requestedResource: ModelResource;
  readonly requestedTargetResource?: ModelResource;
  readonly storedResource: ModelResource;
  readonly storedTargetResource?: ModelResource;
}

export type ModelAuthorisationDenialReason =
  | "cross-tenant"
  | "identity-mismatch"
  | "insufficient-role"
  | "invalid-context"
  | "machine-action-denied"
  | "machine-authentication-expired"
  | "membership-revoked"
  | "preview-actor-mismatch"
  | "preview-consumed"
  | "preview-expired"
  | "preview-resource-mismatch"
  | "resource-mismatch"
  | "unknown-action";

export type ModelAuthorisationDecision =
  | {
      readonly actor: { readonly id: string; readonly kind: "human" | "machine" };
      readonly allowed: true;
      readonly confirmationActorUserId: string;
      readonly reason: "allowed";
    }
  | { readonly allowed: false; readonly reason: ModelAuthorisationDenialReason };

export interface SupportAuditGrant {
  readonly approvedByUserId: string;
  readonly expiresAt: string;
  readonly grantId: string;
  readonly purpose: "incident-investigation" | "customer-request" | "security-review";
  /** Support access is deliberately branch-specific; model- or tenant-wide grants are invalid. */
  readonly resource: ModelResource & { readonly branchId: string };
  readonly revokedAt?: string;
  readonly supportAgentId: string;
}

export interface AuthoriseModelAuditInput {
  readonly approverMembership?: CurrentModelMembership;
  readonly context: ModelAuditActorContext;
  readonly requestedResource: ModelResource;
  readonly storedResource: ModelResource;
  readonly supportGrant?: SupportAuditGrant;
}

export type ModelAuditVisibility = "member" | "support-redacted";

export type ModelAuditAuthorisationDecision =
  | {
      readonly access: {
        readonly expiresAt?: string;
        readonly scope: ModelResource & { readonly branchId: string };
        readonly subjectId: string;
        readonly visibility: ModelAuditVisibility;
      };
      readonly allowed: true;
      readonly reason: "allowed";
    }
  | { readonly allowed: false; readonly reason: ModelAuthorisationDenialReason };
