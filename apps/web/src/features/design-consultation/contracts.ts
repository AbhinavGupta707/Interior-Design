import { designBriefSchema, projectSchema, sessionSchema } from "@interior-design/contracts";
import { z } from "zod";

export const consultationCapabilitySchema = z
  .object({
    activeAdapter: z.literal("deterministic-local-v1"),
    evidenceClassification: z.enum(["real-backend", "fixture-presentation"]),
    externalNetworkUsed: z.literal(false),
    externalProviders: z.literal("disabled"),
  })
  .strict();

export const consultationIntakeSeedSchema = z
  .object({
    accessibilityNeeds: z.array(z.string().trim().min(1).max(120)).max(12),
    goals: z.array(z.string().trim().min(1).max(120)).min(1).max(12),
    mustChange: z.array(z.string().trim().min(1).max(120)).max(12),
    mustKeep: z.array(z.string().trim().min(1).max(120)).max(12),
    projectId: z.uuid(),
    styleWords: z.array(z.string().trim().min(1).max(120)).max(12),
    updatedAt: z.iso.datetime({ offset: true }),
    updatedBy: z.uuid(),
    version: z.int().positive(),
  })
  .strict();

export const consultationWorkspaceSchema = z
  .object({
    brief: designBriefSchema.nullable(),
    capability: consultationCapabilitySchema,
    intake: consultationIntakeSeedSchema.nullable(),
    project: projectSchema,
    session: sessionSchema,
  })
  .strict()
  .superRefine((workspace, context) => {
    if (workspace.brief && workspace.brief.projectId !== workspace.project.id) {
      context.addIssue({
        code: "custom",
        message: "The brief does not belong to the requested project.",
        path: ["brief", "projectId"],
      });
    }
    if (workspace.intake && workspace.intake.projectId !== workspace.project.id) {
      context.addIssue({
        code: "custom",
        message: "The intake does not belong to the requested project.",
        path: ["intake", "projectId"],
      });
    }
    if (workspace.project.tenantId !== workspace.session.actor.tenantId) {
      context.addIssue({
        code: "custom",
        message: "The project and session tenants do not match.",
        path: ["project", "tenantId"],
      });
    }
  });

export const consultationRecoverySchema = z
  .object({
    projectId: z.uuid(),
    proposalId: z.uuid().optional(),
    savedAt: z.iso.datetime({ offset: true }),
    schemaVersion: z.literal("c11-consultation-recovery-v1"),
    sessionId: z.uuid(),
  })
  .strict();

export type ConsultationCapability = z.infer<typeof consultationCapabilitySchema>;
export type ConsultationIntakeSeed = z.infer<typeof consultationIntakeSeedSchema>;
export type ConsultationRecovery = z.infer<typeof consultationRecoverySchema>;
export type ConsultationWorkspace = z.infer<typeof consultationWorkspaceSchema>;
