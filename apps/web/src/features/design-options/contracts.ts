import {
  createOptionJobRequestSchema,
  listOptionJobsResponseSchema,
  optionConfirmationSchema,
  projectSchema,
  sessionSchema,
} from "@interior-design/contracts";
import { z } from "zod";

export const designOptionEvidenceClassificationSchema = z.enum([
  "production-composed",
  "synthetic-fixture",
]);

export const designOptionsWorkspaceSchema = z
  .object({
    evidenceClassification: designOptionEvidenceClassificationSchema,
    jobs: listOptionJobsResponseSchema,
    project: projectSchema,
    session: sessionSchema,
  })
  .strict()
  .superRefine((workspace, context) => {
    if (workspace.jobs.projectId !== workspace.project.id) {
      context.addIssue({
        code: "custom",
        message: "The option jobs do not belong to the requested project.",
        path: ["jobs", "projectId"],
      });
    }
    if (workspace.project.tenantId !== workspace.session.actor.tenantId) {
      context.addIssue({
        code: "custom",
        message: "The project and session tenant do not match.",
        path: ["project", "tenantId"],
      });
    }
  });

export const designOptionRecoverySchema = z
  .object({
    leftOptionId: z.uuid().optional(),
    confirmations: z
      .array(
        z
          .object({ confirmation: optionConfirmationSchema, optionId: z.uuid() })
          .strict()
          .refine(({ confirmation, optionId }) => confirmation.optionId === optionId, {
            message: "The recovered confirmation must match its option.",
            path: ["confirmation", "optionId"],
          }),
      )
      .max(4)
      .optional(),
    projectId: z.uuid(),
    rightOptionId: z.uuid().optional(),
    savedAt: z.iso.datetime({ offset: true }),
    schemaVersion: z.literal("c12-design-options-recovery-v1"),
    selectedJobId: z.uuid(),
  })
  .strict()
  .superRefine(({ confirmations, projectId }, context) => {
    if (!confirmations) return;
    const optionIds = confirmations.map(({ optionId }) => optionId);
    if (new Set(optionIds).size !== optionIds.length) {
      context.addIssue({
        code: "custom",
        message: "Recovered confirmations must have unique option identifiers.",
        path: ["confirmations"],
      });
    }
    confirmations.forEach(({ confirmation }, index) => {
      if (confirmation.projectId !== projectId) {
        context.addIssue({
          code: "custom",
          message: "A recovered confirmation belongs to another project.",
          path: ["confirmations", index, "confirmation", "projectId"],
        });
      }
    });
  })
  .refine(
    ({ leftOptionId, rightOptionId }) =>
      leftOptionId === undefined || rightOptionId === undefined || leftOptionId !== rightOptionId,
    {
      message: "Recovered comparison selections must be different.",
      path: ["rightOptionId"],
    },
  );

export const designOptionLaunchContextSchema = createOptionJobRequestSchema;

export type DesignOptionEvidenceClassification = z.infer<
  typeof designOptionEvidenceClassificationSchema
>;
export type DesignOptionLaunchContext = z.infer<typeof designOptionLaunchContextSchema>;
export type DesignOptionRecovery = z.infer<typeof designOptionRecoverySchema>;
export type DesignOptionsWorkspace = z.infer<typeof designOptionsWorkspaceSchema>;

export function evidenceClassificationFromEnvironment(
  value: string | undefined,
): DesignOptionEvidenceClassification {
  return value === "synthetic-fixture" ? "synthetic-fixture" : "production-composed";
}
