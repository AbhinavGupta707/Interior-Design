import {
  actorSchema,
  memberRoleSchema,
  modelBranchIdSchema,
  modelIdSchema,
  modelPreviewIdSchema,
  modelProfileSchema,
  projectIdSchema,
  tenantIdSchema,
  userIdSchema,
  type Actor,
} from "@interior-design/contracts";

import { authoriseProjectAction } from "../index.js";
import {
  modelActions,
  publicModelOperationTypes,
  type AuthoriseModelActionInput,
  type AuthoriseModelAuditInput,
  type CurrentModelMembership,
  type ModelAction,
  type ModelActorContext,
  type ModelAuditAuthorisationDecision,
  type ModelAuthorisationDecision,
  type ModelAuthorisationDenialReason,
  type ModelPreviewAuthority,
  type ModelResource,
  type PublicModelOperationType,
  type SupportAuditGrant,
  type SupportModelActorContext,
} from "./types.js";

type Clock = () => Date;

const SERVICE_ID_PATTERN = /^[a-z][a-z0-9.-]{2,79}$/u;
const SUPPORT_ID_PATTERN = /^[a-z][a-z0-9._-]{2,79}$/u;
const ISO_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;
const SAFE_PURPOSES = new Set(["incident-investigation", "customer-request", "security-review"]);

function denied(reason: ModelAuthorisationDenialReason): ModelAuthorisationDecision {
  return { allowed: false, reason };
}

function auditDenied(reason: ModelAuthorisationDenialReason): ModelAuditAuthorisationDecision {
  return { allowed: false, reason };
}

function safeRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return undefined;
    }
    return value as Readonly<Record<string, unknown>>;
  } catch {
    return undefined;
  }
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  try {
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) {
      return false;
    }
    const allowed = new Set([...required, ...optional]);
    return (
      required.every((key) => Object.hasOwn(value, key)) &&
      keys.every((key) => typeof key === "string" && allowed.has(key))
    );
  } catch {
    return false;
  }
}

function read(value: Readonly<Record<string, unknown>>, key: string): unknown {
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

function parsed<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  value: unknown,
): T | undefined {
  try {
    const result = schema.safeParse(value);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date;
}

function parseModelAction(value: unknown): ModelAction | undefined {
  return typeof value === "string" && (modelActions as readonly string[]).includes(value)
    ? (value as ModelAction)
    : undefined;
}

function parseActor(value: unknown): Actor | undefined {
  const record = safeRecord(value);
  return record !== undefined &&
    hasExactKeys(record, ["displayName", "role", "subject", "tenantId", "userId"])
    ? parsed(actorSchema, record)
    : undefined;
}

function sameActor(left: Actor, right: Actor): boolean {
  return (
    left.role === right.role &&
    left.subject === right.subject &&
    left.tenantId === right.tenantId &&
    left.userId === right.userId
  );
}

function parseMembership(value: unknown): CurrentModelMembership | undefined {
  const record = safeRecord(value);
  if (record === undefined || !hasExactKeys(record, ["role", "status", "tenantId", "userId"])) {
    return undefined;
  }
  const role = parsed(memberRoleSchema, read(record, "role"));
  const tenantId = parsed(tenantIdSchema, read(record, "tenantId"));
  const userId = parsed(userIdSchema, read(record, "userId"));
  const status = read(record, "status");
  if (
    role === undefined ||
    tenantId === undefined ||
    userId === undefined ||
    (status !== "active" && status !== "revoked")
  ) {
    return undefined;
  }
  return { role, status, tenantId, userId };
}

function parseResource(value: unknown): ModelResource | undefined {
  const record = safeRecord(value);
  if (
    record === undefined ||
    !hasExactKeys(record, ["modelId", "profile", "projectId", "tenantId"], ["branchId"])
  ) {
    return undefined;
  }
  const tenantId = parsed(tenantIdSchema, read(record, "tenantId"));
  const projectId = parsed(projectIdSchema, read(record, "projectId"));
  const modelId = parsed(modelIdSchema, read(record, "modelId"));
  const profile = parsed(modelProfileSchema, read(record, "profile"));
  const branchValue = read(record, "branchId");
  const branchId = branchValue === undefined ? undefined : parsed(modelBranchIdSchema, branchValue);
  if (
    tenantId === undefined ||
    projectId === undefined ||
    modelId === undefined ||
    profile === undefined ||
    (branchValue !== undefined && branchId === undefined)
  ) {
    return undefined;
  }
  return {
    ...(branchId === undefined ? {} : { branchId }),
    modelId,
    profile,
    projectId,
    tenantId,
  };
}

function sameResource(left: ModelResource, right: ModelResource): boolean {
  return (
    left.branchId === right.branchId &&
    left.modelId === right.modelId &&
    left.profile === right.profile &&
    left.projectId === right.projectId &&
    left.tenantId === right.tenantId
  );
}

function requiresBranch(action: ModelAction): boolean {
  return action !== "model:branch:create";
}

function parseOperationTypes(value: unknown): readonly PublicModelOperationType[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
    return undefined;
  }
  const allowed = publicModelOperationTypes as readonly string[];
  if (!value.every((item) => typeof item === "string" && allowed.includes(item))) {
    return undefined;
  }
  return value as readonly PublicModelOperationType[];
}

function parsePreviewActor(value: unknown): ModelPreviewAuthority["proposedBy"] | undefined {
  const record = safeRecord(value);
  if (record === undefined || !hasExactKeys(record, ["id", "kind", "tenantId"])) {
    return undefined;
  }
  const kind = read(record, "kind");
  const tenantId = parsed(tenantIdSchema, read(record, "tenantId"));
  const id = read(record, "id");
  if (tenantId === undefined) {
    return undefined;
  }
  if (kind === "human") {
    const humanId = parsed(userIdSchema, id);
    return humanId === undefined ? undefined : { id: humanId, kind, tenantId };
  }
  return kind === "machine" && typeof id === "string" && SERVICE_ID_PATTERN.test(id)
    ? { id, kind, tenantId }
    : undefined;
}

function parsePreview(value: unknown): ModelPreviewAuthority | undefined {
  const record = safeRecord(value);
  if (
    record === undefined ||
    !hasExactKeys(
      record,
      ["confirmationActorUserId", "expiresAt", "id", "operationTypes", "proposedBy", "resource"],
      ["consumedAt"],
    )
  ) {
    return undefined;
  }
  const id = parsed(modelPreviewIdSchema, read(record, "id"));
  const confirmationActorUserId = parsed(userIdSchema, read(record, "confirmationActorUserId"));
  const expiresAt = read(record, "expiresAt");
  const consumedAt = read(record, "consumedAt");
  const resource = parseResource(read(record, "resource"));
  const proposedBy = parsePreviewActor(read(record, "proposedBy"));
  const operationTypes = parseOperationTypes(read(record, "operationTypes"));
  if (
    id === undefined ||
    confirmationActorUserId === undefined ||
    typeof expiresAt !== "string" ||
    parseDate(expiresAt) === undefined ||
    (consumedAt !== undefined &&
      (typeof consumedAt !== "string" || parseDate(consumedAt) === undefined)) ||
    resource?.branchId === undefined ||
    proposedBy === undefined ||
    operationTypes === undefined
  ) {
    return undefined;
  }
  return {
    confirmationActorUserId,
    ...(typeof consumedAt === "string" ? { consumedAt } : {}),
    expiresAt,
    id,
    operationTypes,
    proposedBy,
    resource: { ...resource, branchId: resource.branchId },
  };
}

function validateResourceBoundary(
  action: ModelAction,
  input: AuthoriseModelActionInput,
):
  | { readonly requested: ModelResource; readonly stored: ModelResource }
  | ModelAuthorisationDecision {
  const requested = parseResource(input.requestedResource);
  const stored = parseResource(input.storedResource);
  if (requested === undefined || stored === undefined) {
    return denied("invalid-context");
  }
  if (!sameResource(requested, stored)) {
    return denied("resource-mismatch");
  }
  const branchRequired = requiresBranch(action);
  if (branchRequired !== (requested.branchId !== undefined)) {
    return denied("invalid-context");
  }
  if (action === "model:branch:compare") {
    const requestedTarget = parseResource(input.requestedTargetResource);
    const storedTarget = parseResource(input.storedTargetResource);
    if (
      requestedTarget?.branchId === undefined ||
      storedTarget?.branchId === undefined ||
      !sameResource(requestedTarget, storedTarget) ||
      requestedTarget.tenantId !== requested.tenantId ||
      requestedTarget.projectId !== requested.projectId ||
      requestedTarget.modelId !== requested.modelId ||
      requestedTarget.profile !== requested.profile
    ) {
      return denied("resource-mismatch");
    }
  } else if (
    input.requestedTargetResource !== undefined ||
    input.storedTargetResource !== undefined
  ) {
    return denied("invalid-context");
  }
  return { requested, stored };
}

function authoriseHuman(
  context: ModelActorContext,
  action: ModelAction,
  resource: ModelResource,
):
  | {
      readonly actor: Actor;
      readonly attribution: { readonly id: string; readonly kind: "human" };
    }
  | ModelAuthorisationDecision {
  if (context.kind !== "human") {
    return denied("invalid-context");
  }
  const actor = parseActor(context.actor);
  const authenticatedActor = parseActor(context.authenticatedActor);
  const membership = parseMembership(context.currentMembership);
  if (actor === undefined || authenticatedActor === undefined || membership === undefined) {
    return denied("invalid-context");
  }
  if (!sameActor(actor, authenticatedActor)) {
    return denied("identity-mismatch");
  }
  if (membership.status === "revoked") {
    return denied("membership-revoked");
  }
  if (
    membership.tenantId !== actor.tenantId ||
    membership.userId !== actor.userId ||
    membership.role !== actor.role
  ) {
    return denied("identity-mismatch");
  }
  if (actor.tenantId !== resource.tenantId) {
    return denied("cross-tenant");
  }
  const coreDecision = authoriseProjectAction(actor, action, {
    tenantId: resource.tenantId,
  });
  if (!coreDecision.allowed) {
    return denied(
      coreDecision.reason === "cross-tenant"
        ? "cross-tenant"
        : coreDecision.reason === "unknown-action"
          ? "unknown-action"
          : "insufficient-role",
    );
  }
  return { actor, attribution: { id: actor.userId, kind: "human" } };
}

function authoriseMachine(
  context: ModelActorContext,
  action: ModelAction,
  resource: ModelResource,
  now: Date,
):
  | {
      readonly actor: Actor;
      readonly attribution: { readonly id: string; readonly kind: "machine" };
    }
  | ModelAuthorisationDecision {
  if (context.kind !== "machine") {
    return denied("invalid-context");
  }
  if (action !== "model:operation:preview") {
    return denied("machine-action-denied");
  }
  const claimed = safeRecord(context.actor);
  const authenticated = safeRecord(context.authenticatedMachine);
  if (
    claimed === undefined ||
    authenticated === undefined ||
    !hasExactKeys(claimed, ["delegatedByUserId", "serviceId", "tenantId"]) ||
    !hasExactKeys(authenticated, [
      "allowedActions",
      "delegatedByUserId",
      "expiresAt",
      "serviceId",
      "tenantId",
    ])
  ) {
    return denied("invalid-context");
  }
  const claimedServiceId = read(claimed, "serviceId");
  const authenticatedServiceId = read(authenticated, "serviceId");
  const claimedTenantId = parsed(tenantIdSchema, read(claimed, "tenantId"));
  const authenticatedTenantId = parsed(tenantIdSchema, read(authenticated, "tenantId"));
  const claimedDelegate = parsed(userIdSchema, read(claimed, "delegatedByUserId"));
  const authenticatedDelegate = parsed(userIdSchema, read(authenticated, "delegatedByUserId"));
  const expiresAt = parseDate(read(authenticated, "expiresAt"));
  const allowedActionsValue = read(authenticated, "allowedActions");
  const allowedActions = Array.isArray(allowedActionsValue)
    ? allowedActionsValue.map(parseModelAction)
    : [];
  if (
    typeof claimedServiceId !== "string" ||
    typeof authenticatedServiceId !== "string" ||
    !SERVICE_ID_PATTERN.test(claimedServiceId) ||
    claimedServiceId !== authenticatedServiceId ||
    claimedTenantId === undefined ||
    claimedTenantId !== authenticatedTenantId ||
    claimedDelegate === undefined ||
    claimedDelegate !== authenticatedDelegate ||
    expiresAt === undefined ||
    allowedActions.some((candidate) => candidate === undefined)
  ) {
    return denied("identity-mismatch");
  }
  if (expiresAt <= now) {
    return denied("machine-authentication-expired");
  }
  if (!allowedActions.includes(action)) {
    return denied("machine-action-denied");
  }
  const delegate = parseActor(context.delegatedActor);
  const membership = parseMembership(context.currentMembership);
  if (delegate === undefined || membership === undefined) {
    return denied("invalid-context");
  }
  if (membership.status === "revoked") {
    return denied("membership-revoked");
  }
  if (
    delegate.userId !== claimedDelegate ||
    delegate.tenantId !== claimedTenantId ||
    membership.userId !== delegate.userId ||
    membership.tenantId !== delegate.tenantId ||
    membership.role !== delegate.role
  ) {
    return denied("identity-mismatch");
  }
  if (claimedTenantId !== resource.tenantId) {
    return denied("cross-tenant");
  }
  const coreDecision = authoriseProjectAction(delegate, action, { tenantId: resource.tenantId });
  if (!coreDecision.allowed) {
    return denied(coreDecision.reason === "cross-tenant" ? "cross-tenant" : "insufficient-role");
  }
  return {
    actor: delegate,
    attribution: { id: claimedServiceId, kind: "machine" },
  };
}

function validateCommitPreview(
  input: AuthoriseModelActionInput,
  actor: Actor,
  resource: ModelResource,
  now: Date,
): ModelAuthorisationDecision | undefined {
  const preview = parsePreview(input.preview);
  const requestedPreviewId = parsed(modelPreviewIdSchema, input.requestedPreviewId);
  if (preview === undefined || requestedPreviewId === undefined) {
    return denied("invalid-context");
  }
  if (preview.id !== requestedPreviewId || !sameResource(preview.resource, resource)) {
    return denied("preview-resource-mismatch");
  }
  if (preview.proposedBy.tenantId !== resource.tenantId) {
    return denied("preview-resource-mismatch");
  }
  if (
    preview.proposedBy.kind === "human" &&
    preview.proposedBy.id !== preview.confirmationActorUserId
  ) {
    return denied("preview-actor-mismatch");
  }
  if (preview.confirmationActorUserId !== actor.userId) {
    return denied("preview-actor-mismatch");
  }
  if (preview.consumedAt !== undefined) {
    return denied("preview-consumed");
  }
  const expiresAt = parseDate(preview.expiresAt);
  return expiresAt === undefined || expiresAt <= now ? denied("preview-expired") : undefined;
}

/**
 * Defence-in-depth policy over the frozen core action matrix.
 *
 * `storedResource`, current membership, and authenticated principals must be loaded by trusted
 * server boundaries. Request bodies must never be allowed to supply those values.
 */
function decideModelAction(
  input: AuthoriseModelActionInput,
  options: { readonly clock?: Clock } = {},
): ModelAuthorisationDecision {
  const action = parseModelAction(input.action);
  if (action === undefined) {
    return denied("unknown-action");
  }
  const resources = validateResourceBoundary(action, input);
  if ("allowed" in resources) {
    return resources;
  }
  const now = (options.clock ?? (() => new Date()))();
  if (Number.isNaN(now.valueOf())) {
    return denied("invalid-context");
  }
  const operationTypes =
    input.operationTypes === undefined ? undefined : parseOperationTypes(input.operationTypes);
  if (action === "model:operation:preview") {
    if (
      operationTypes === undefined ||
      input.preview !== undefined ||
      input.requestedPreviewId !== undefined
    ) {
      return denied("invalid-context");
    }
  } else if (input.operationTypes !== undefined && action !== "model:operation:commit") {
    return denied("invalid-context");
  }

  const authority =
    input.context.kind === "machine"
      ? authoriseMachine(input.context, action, resources.requested, now)
      : authoriseHuman(input.context, action, resources.requested);
  if ("allowed" in authority) {
    return authority;
  }
  if (action === "model:operation:commit") {
    if (input.context.kind !== "human") {
      return denied("machine-action-denied");
    }
    if (input.operationTypes !== undefined) {
      return denied("invalid-context");
    }
    const previewDecision = validateCommitPreview(input, authority.actor, resources.requested, now);
    if (previewDecision !== undefined) {
      return previewDecision;
    }
  } else if (input.preview !== undefined || input.requestedPreviewId !== undefined) {
    return denied("invalid-context");
  }
  return {
    actor: authority.attribution,
    allowed: true,
    confirmationActorUserId: authority.actor.userId,
    reason: "allowed",
  };
}

export function authoriseModelAction(
  input: AuthoriseModelActionInput,
  options: { readonly clock?: Clock } = {},
): ModelAuthorisationDecision {
  try {
    return decideModelAction(input, options);
  } catch {
    // Runtime callers, proxies, accessors and clocks are untrusted at this boundary.
    return denied("invalid-context");
  }
}

function parseSupportContext(value: unknown): SupportModelActorContext | undefined {
  const context = safeRecord(value);
  if (
    context === undefined ||
    !hasExactKeys(context, ["actor", "authenticatedSupport", "kind"]) ||
    read(context, "kind") !== "support"
  ) {
    return undefined;
  }
  const actor = safeRecord(read(context, "actor"));
  const authenticated = safeRecord(read(context, "authenticatedSupport"));
  if (
    actor === undefined ||
    authenticated === undefined ||
    !hasExactKeys(actor, ["supportAgentId"]) ||
    !hasExactKeys(authenticated, ["expiresAt", "supportAgentId"])
  ) {
    return undefined;
  }
  const actorId = read(actor, "supportAgentId");
  const authenticatedId = read(authenticated, "supportAgentId");
  const expiresAt = read(authenticated, "expiresAt");
  if (
    typeof actorId !== "string" ||
    typeof authenticatedId !== "string" ||
    typeof expiresAt !== "string" ||
    !SUPPORT_ID_PATTERN.test(actorId) ||
    actorId !== authenticatedId ||
    parseDate(expiresAt) === undefined
  ) {
    return undefined;
  }
  return {
    actor: { supportAgentId: actorId },
    authenticatedSupport: { expiresAt, supportAgentId: authenticatedId },
    kind: "support",
  };
}

function parseSupportGrant(value: unknown): SupportAuditGrant | undefined {
  const grant = safeRecord(value);
  if (
    grant === undefined ||
    !hasExactKeys(
      grant,
      ["approvedByUserId", "expiresAt", "grantId", "purpose", "resource", "supportAgentId"],
      ["revokedAt"],
    )
  ) {
    return undefined;
  }
  const approvedByUserId = parsed(userIdSchema, read(grant, "approvedByUserId"));
  const grantId = parsed(modelPreviewIdSchema, read(grant, "grantId"));
  const expiresAt = read(grant, "expiresAt");
  const revokedAt = read(grant, "revokedAt");
  const purpose = read(grant, "purpose");
  const supportAgentId = read(grant, "supportAgentId");
  const resource = parseResource(read(grant, "resource"));
  if (
    approvedByUserId === undefined ||
    grantId === undefined ||
    typeof expiresAt !== "string" ||
    parseDate(expiresAt) === undefined ||
    (revokedAt !== undefined &&
      (typeof revokedAt !== "string" || parseDate(revokedAt) === undefined)) ||
    typeof purpose !== "string" ||
    !SAFE_PURPOSES.has(purpose) ||
    typeof supportAgentId !== "string" ||
    !SUPPORT_ID_PATTERN.test(supportAgentId) ||
    resource?.branchId === undefined
  ) {
    return undefined;
  }
  return {
    approvedByUserId,
    expiresAt,
    grantId,
    purpose: purpose as SupportAuditGrant["purpose"],
    resource: { ...resource, branchId: resource.branchId },
    ...(typeof revokedAt === "string" ? { revokedAt } : {}),
    supportAgentId,
  };
}

/** Authorises bounded audit visibility; support never receives mutation authority or actor IDs. */
function decideModelAuditVisibility(
  input: AuthoriseModelAuditInput,
  options: { readonly clock?: Clock } = {},
): ModelAuditAuthorisationDecision {
  const requested = parseResource(input.requestedResource);
  const stored = parseResource(input.storedResource);
  if (
    requested?.branchId === undefined ||
    stored?.branchId === undefined ||
    !sameResource(requested, stored)
  ) {
    return auditDenied(
      requested === undefined || stored === undefined ? "invalid-context" : "resource-mismatch",
    );
  }
  const now = (options.clock ?? (() => new Date()))();
  if (Number.isNaN(now.valueOf())) {
    return auditDenied("invalid-context");
  }
  if (input.context.kind !== "support") {
    const decision = authoriseModelAction(
      {
        action: "model:audit:read",
        context: input.context,
        requestedResource: requested,
        storedResource: stored,
      },
      { clock: () => now },
    );
    if (!decision.allowed) {
      return auditDenied(decision.reason);
    }
    return {
      access: {
        scope: { ...requested, branchId: requested.branchId },
        subjectId: decision.actor.id,
        visibility: "member",
      },
      allowed: true,
      reason: "allowed",
    };
  }

  const context = parseSupportContext(input.context);
  const grant = parseSupportGrant(input.supportGrant);
  const approver = parseMembership(input.approverMembership);
  if (context === undefined || grant === undefined || approver === undefined) {
    return auditDenied("invalid-context");
  }
  const authenticationExpiry = parseDate(context.authenticatedSupport.expiresAt);
  const grantExpiry = parseDate(grant.expiresAt);
  if (
    authenticationExpiry === undefined ||
    grantExpiry === undefined ||
    authenticationExpiry <= now ||
    grantExpiry <= now ||
    grant.revokedAt !== undefined
  ) {
    return auditDenied("membership-revoked");
  }
  if (
    context.actor.supportAgentId !== grant.supportAgentId ||
    !sameResource(grant.resource, requested) ||
    approver.status !== "active" ||
    approver.role !== "owner" ||
    approver.tenantId !== requested.tenantId ||
    approver.userId !== grant.approvedByUserId
  ) {
    return auditDenied("identity-mismatch");
  }
  return {
    access: {
      expiresAt: grant.expiresAt,
      scope: { ...requested, branchId: requested.branchId },
      subjectId: context.actor.supportAgentId,
      visibility: "support-redacted",
    },
    allowed: true,
    reason: "allowed",
  };
}

export function authoriseModelAuditVisibility(
  input: AuthoriseModelAuditInput,
  options: { readonly clock?: Clock } = {},
): ModelAuditAuthorisationDecision {
  try {
    return decideModelAuditVisibility(input, options);
  } catch {
    return auditDenied("invalid-context");
  }
}
