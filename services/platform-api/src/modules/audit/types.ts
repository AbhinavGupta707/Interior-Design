import {
  modelBranchIdSchema,
  modelCommitIdSchema,
  modelIdSchema,
  modelOperationTypeSchema,
  modelProfileSchema,
  modelSnapshotIdSchema,
  projectIdSchema,
  tenantIdSchema,
  userIdSchema,
} from "@interior-design/contracts";
import { z } from "zod";

export const modelAuditPublicSchemaVersion = "c5-model-audit-public-v1" as const;

export const modelAuditActionSchema = z.enum([
  "model:snapshot:create",
  "model:branch:create",
  "model:branch:read",
  "model:branch:compare",
  "model:operation:preview",
  "model:operation:commit",
  "model:branch:restore",
  "model:operation:history",
  "model:audit:read",
]);
export type ModelAuditAction = z.infer<typeof modelAuditActionSchema>;

const safeCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/u);
const requestIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u);
const traceIdSchema = z.string().regex(/^[0-9a-f]{32}$/u);
const machineIdSchema = z.string().regex(/^[a-z][a-z0-9.-]{2,79}$/u);

export const modelAuditScopeSchema = z
  .object({
    branchId: modelBranchIdSchema,
    modelId: modelIdSchema,
    profile: modelProfileSchema,
    projectId: projectIdSchema,
    tenantId: tenantIdSchema,
  })
  .strict();
export type ModelAuditScope = z.infer<typeof modelAuditScopeSchema>;

export const modelAuditActorSchema = z.discriminatedUnion("kind", [
  z.object({ id: userIdSchema, kind: z.literal("human") }).strict(),
  z.object({ id: machineIdSchema, kind: z.literal("machine") }).strict(),
  z.object({ id: machineIdSchema, kind: z.literal("support") }).strict(),
]);
export type ModelAuditActor = z.infer<typeof modelAuditActorSchema>;

export const immutableModelAuditEventSchema = z
  .object({
    action: modelAuditActionSchema,
    actor: modelAuditActorSchema,
    branchId: modelBranchIdSchema,
    code: safeCodeSchema.optional(),
    commitId: modelCommitIdSchema.optional(),
    eventId: z.uuid(),
    modelId: modelIdSchema,
    occurredAt: z.iso.datetime({ offset: true }),
    operationTypes: z.array(modelOperationTypeSchema).min(1).max(50).optional(),
    outcome: z.enum(["accepted", "denied"]),
    profile: modelProfileSchema,
    projectId: projectIdSchema,
    requestId: requestIdSchema,
    revision: z.int().nonnegative().optional(),
    snapshotId: modelSnapshotIdSchema.optional(),
    tenantId: tenantIdSchema,
    traceId: traceIdSchema,
  })
  .strict();
export type ImmutableModelAuditEvent = z.infer<typeof immutableModelAuditEventSchema>;

export const modelAuditAccessSchema = z
  .object({
    expiresAt: z.iso.datetime({ offset: true }).optional(),
    scope: modelAuditScopeSchema,
    subjectId: z.string().trim().min(3).max(80),
    visibility: z.enum(["member", "support-redacted"]),
  })
  .strict()
  .superRefine((access, context) => {
    if ((access.visibility === "support-redacted") !== (access.expiresAt !== undefined)) {
      context.addIssue({
        code: "custom",
        message: "Support audit access, and only support audit access, must expire.",
        path: ["expiresAt"],
      });
    }
  });
export type ModelAuditAccess = z.infer<typeof modelAuditAccessSchema>;

export const modelAuditPageRequestSchema = z
  .object({
    cursor: z.string().min(1).max(500).optional(),
    limit: z.int().min(1).max(100).default(50),
  })
  .strict();
export type ModelAuditPageRequest = z.input<typeof modelAuditPageRequestSchema>;

export interface ModelAuditCursorPosition {
  readonly eventId: string;
  readonly occurredAt: string;
}

export interface ReadImmutableModelAuditPage {
  readonly before?: ModelAuditCursorPosition;
  /** At most 101: one look-ahead row beyond the frozen 100-record public ceiling. */
  readonly limit: number;
  readonly scope: ModelAuditScope;
}

/** Read-only persistence seam. It intentionally exposes no update or delete capability. */
export interface ImmutableModelAuditProjectionPort {
  listNewest(input: ReadImmutableModelAuditPage): Promise<readonly ImmutableModelAuditEvent[]>;
}

/** Append-only write seam for transactional producers; implementations must reject duplicate IDs. */
export interface AppendOnlyModelAuditPort {
  append(event: ImmutableModelAuditEvent): Promise<void>;
}

export interface PublicModelAuditRecord {
  readonly action: ModelAuditAction;
  readonly actor:
    | { readonly id: string; readonly kind: ModelAuditActor["kind"] }
    | { readonly kind: ModelAuditActor["kind"] };
  readonly code?: string;
  readonly commitId?: string;
  readonly eventId: string;
  readonly occurredAt: string;
  readonly operationTypes?: readonly z.infer<typeof modelOperationTypeSchema>[];
  readonly outcome: "accepted" | "denied";
  readonly resource: {
    readonly branchId: string;
    readonly modelId: string;
    readonly profile: z.infer<typeof modelProfileSchema>;
    readonly projectId: string;
  };
  readonly revision?: number;
  readonly schemaVersion: typeof modelAuditPublicSchemaVersion;
  readonly snapshotId?: string;
  readonly traceId: string;
  readonly visibility: "member" | "support-redacted";
}

export interface PublicModelAuditPage {
  readonly nextCursor?: string;
  readonly records: readonly PublicModelAuditRecord[];
}
